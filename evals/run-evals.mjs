import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromeHarness } from "../scripts/cdp-harness.mjs";

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(EVALS_DIR, "cases");
const TIERS = new Set(["logic", "webmcp"]);

export function validateCaseDefinition(value, filename = "case") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filename}: case must be an object`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`${filename}: id must be a non-empty string`);
  }
  if (!TIERS.has(value.tier)) {
    throw new Error(`${filename}: tier must be logic or webmcp`);
  }
  if (!value.setup || typeof value.setup !== "object" || Array.isArray(value.setup)) {
    throw new Error(`${filename}: setup must be an object`);
  }
  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    throw new Error(`${filename}: actions must be a non-empty array`);
  }
  if (!value.expect || typeof value.expect !== "object" || Array.isArray(value.expect)) {
    throw new Error(`${filename}: expect must be an object`);
  }
  if ("mustFail" in value && typeof value.mustFail !== "boolean") {
    throw new Error(`${filename}: mustFail must be a boolean`);
  }
  return value;
}

export async function loadCases(casesDir = CASES_DIR) {
  const filenames = (await readdir(casesDir))
    .filter((filename) => filename.endsWith(".json"))
    .sort();
  const cases = [];
  const ids = new Set();

  for (const filename of filenames) {
    const source = await readFile(join(casesDir, filename), "utf8");
    const definition = validateCaseDefinition(JSON.parse(source), filename);
    if (ids.has(definition.id)) throw new Error(`${filename}: duplicate id ${definition.id}`);
    ids.add(definition.id);
    cases.push(definition);
  }
  return cases;
}

export function parseArgs(argv) {
  const options = { headless: true, tier: "all", validate: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--url") {
      options.url = argv[index += 1];
      if (!options.url) throw new Error("--url requires a value");
    } else if (argument === "--headed") {
      options.headless = false;
    } else if (argument === "--tier") {
      options.tier = argv[index += 1];
      if (!options.tier || (options.tier !== "all" && !TIERS.has(options.tier))) {
        throw new Error("--tier requires logic, webmcp, or all");
      }
    } else if (argument === "--validate") {
      options.validate = true;
    } else if (argument === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

export function shouldWriteCanonicalResults(tier) {
  return tier === "all";
}

function printHelp() {
  console.log("Usage: node evals/run-evals.mjs --url <http(s) URL> [--tier logic|webmcp|all] [--headed]");
  console.log("       node evals/run-evals.mjs --validate");
}

export async function prepareEvalRun({ url, headless = true, playwright } = {}) {
  const cases = await loadCases();
  const harness = await launchChromeHarness({ url, headless, playwright });
  return {
    cases,
    chromeVersion: harness.chromeVersion,
    drivers: {
      logic: harness.logic,
      webmcp: harness.webmcp,
    },
    harness,
  };
}

function getPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function resolveTemplates(value, variables) {
  if (Array.isArray(value)) return value.map((item) => resolveTemplates(item, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveTemplates(item, variables)]),
    );
  }
  if (typeof value !== "string") return value;
  return value.replace(/\{\{([^}]+)\}\}/g, (match, path) => {
    const replacement = getPath(variables, path.trim());
    return replacement === undefined ? match : String(replacement);
  });
}

export function classifyNativeToolRevocation(error, toolName, activeTools) {
  if (
    typeof toolName !== "string"
    || activeTools.some(({ name }) => name === toolName)
  ) {
    return null;
  }

  const message = error instanceof Error ? error.message : String(error);
  const parsed = message.match(
    /^(?:page\.evaluate: )?(UnknownError|AbortError): (.+)$/,
  );
  if (!parsed) return null;

  const [, nativeErrorName, nativeMessage] = parsed;
  const isKnownRevocation = (
    nativeErrorName === "UnknownError"
    && (
      nativeMessage === "The operation failed for an unknown transient reason (e.g. out of memory)."
      || nativeMessage === `Tool not found: ${toolName}`
    )
  ) || (
    nativeErrorName === "AbortError"
    && (
      nativeMessage === "This operation was aborted"
      || nativeMessage === "This operation was aborted."
      || nativeMessage === "signal is aborted without reason"
    )
  );
  if (!isKnownRevocation) return null;

  return {
    rejected: true,
    source: "browser",
    code: "WEBMCP_TOOL_REVOKED",
    nativeErrorName,
    message,
  };
}

function caseUrl(baseUrl, definition) {
  const url = new URL(baseUrl);
  if (definition.setup.mock && url.pathname.endsWith("/dev/s2.html")) {
    url.searchParams.set("mock", definition.setup.mock);
  }
  url.searchParams.set("test", "1");
  return url.href;
}

async function loadTargetContext(harness, driver) {
  const info = await driver.executeTool("get_target_info", {});
  const target = await harness.page.evaluate(async (targetId) => {
    const response = await fetch(`/targets/${encodeURIComponent(targetId)}/manifest.json`);
    return response.ok ? response.json() : null;
  }, info.targetId);
  if (target) return target;
  const fallback = await harness.page.locator("textarea").inputValue().catch(() => "assert(true);");
  return {
    ...info,
    demoRepros: {
      broken: 'assert(false, "not isolated");',
      weak: "assert(true);",
      real: fallback,
    },
  };
}

async function executeAction(action, state, harness, driver) {
  const resolved = resolveTemplates(action, state.variables);
  const rejected = (error, fallbackCode) => {
    const message = error instanceof Error ? error.message : String(error);
    const code = error?.code
      ?? fallbackCode
      ?? (/bundle SHA-256 mismatch/i.test(message) ? "BUNDLE_SHA_MISMATCH" : undefined);
    return { rejected: true, code, message };
  };
  switch (resolved.op) {
    case "getTools":
      return driver.getTools();
    case "executeTool":
      try {
        return await driver.executeTool(resolved.name, resolved.input ?? {});
      } catch (error) {
        return rejected(error);
      }
    case "captureTool":
      return driver.captureTool(resolved.name);
    case "executeCapturedTool":
      try {
        const result = await driver.executeCapturedTool(
          state.variables[resolved.tool],
          resolved.input ?? {},
        );
        return result?.code === "STALE_REPRO"
          ? { ...result, source: "application" }
          : result;
      } catch (error) {
        let activeTools;
        try {
          activeTools = await driver.getTools();
        } catch {
          throw error;
        }
        const revocation = classifyNativeToolRevocation(
          error,
          resolved.name,
          activeTools,
        );
        if (revocation) return revocation;
        throw error;
      }
    case "probePage":
      return harness.probePage();
    case "interceptBundle":
      await harness.interceptBundle(resolved.version, resolved.mutation);
      return { installed: true };
    case "click":
      await harness.click(resolved.selector);
      return { clicked: true };
    case "readSignedArtifact":
      return harness.readSignedArtifact();
    case "replaySignedArtifact":
      return harness.replaySignedArtifact();
    case "encodeReceipt":
      return harness.encodeReceipt(state.variables[resolved.artifact]);
    case "decodeReceipt":
      return harness.decodeReceipt(state.variables[resolved.receipt]);
    case "inspectInboxReceipt":
      return harness.inspectInboxReceipt();
    default:
      throw new Error(`Unsupported action: ${resolved.op}`);
  }
}

function runByVersion(result, version) {
  return result?.runs?.find((run) => run.version === version);
}

function evaluateLogicCase(definition, variables, finalTools, timings) {
  const failures = [];
  const check = (actual, expected, label) => {
    if (expected !== undefined && actual !== expected) {
      failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };
  const names = finalTools.map(({ name }) => name);
  const gateOpen = names.includes("submit_report");
  check(gateOpen, definition.expect.gateOpen, "gateOpen");
  if (definition.expect.toolAbsent) {
    check(names.includes(definition.expect.toolAbsent), false, `${definition.expect.toolAbsent} present`);
  }

  if (["assert-false", "empty-repro", "good-error", "inverted"].includes(definition.id)) {
    const result = variables.result;
    check(result?.reason, definition.expect.reason, "reason");
    check(runByVersion(result, "bad")?.verdict, definition.expect.badVerdict, "bad verdict");
    check(runByVersion(result, "good")?.verdict, definition.expect.goodVerdict, "good verdict");
  } else if (definition.id === "timeout-recovers") {
    check(variables.timeoutRun?.reason, definition.expect.reason, "reason");
    check(runByVersion(variables.timeoutRun, "bad")?.verdict, definition.expect.badVerdict, "bad verdict");
    check(variables.recoveryRun?.reason, definition.expect.recoveryReason, "recovery reason");
    check(
      runByVersion(variables.recoveryRun, "bad")?.verdict,
      definition.expect.recoveryBadVerdict,
      "recovery bad verdict",
    );
    check(
      runByVersion(variables.recoveryRun, "good")?.verdict,
      definition.expect.recoveryGoodVerdict,
      "recovery good verdict",
    );
    check(variables.pageProbe?.alive, definition.expect.pageAlive, "page alive");
    if (!(timings.timeoutRun?.durationMs < definition.expect.maxTimeoutActionMs)) {
      failures.push(`timeout action: expected < ${definition.expect.maxTimeoutActionMs}ms, got ${timings.timeoutRun?.durationMs}ms`);
    }
    if (!(timings.recoveryRun?.durationMs < definition.expect.maxRecoveryActionMs)) {
      failures.push(`recovery action: expected < ${definition.expect.maxRecoveryActionMs}ms, got ${timings.recoveryRun?.durationMs}ms`);
    }
  } else if (definition.id === "bundle-sha-tamper") {
    const rejected = variables.result?.rejected === true || typeof variables.result?.code === "string";
    check(rejected, definition.expect.runRejected, "run rejected");
    check(variables.result?.code, definition.expect.errorCode, "error code");
  } else if (definition.id === "receipt-round-trip") {
    check(variables.greenRun?.reason, definition.expect.reason, "reason");
    check(variables.staged?.status, definition.expect.stagedStatus, "staged status");
    check(
      variables.artifact?.reproSha256 === variables.greenRun?.reproSha256
        && variables.artifact?.reproSha256 === variables.decoded?.artifact?.reproSha256,
      definition.expect.artifactHashMatchesDraft,
      "artifact hash",
    );
    check(
      JSON.stringify(variables.artifact) === JSON.stringify(variables.decoded?.artifact),
      definition.expect.receiptArtifactRoundTrip,
      "receipt round-trip",
    );
    check(variables.decoded?.reproHashOk, definition.expect.reproHashOk, "repro hash");
    check(
      variables.receiptPage?.verificationLabel,
      definition.expect.verificationLabel,
      "rendered verification label",
    );
  } else {
    failures.push(`No logic evaluator for ${definition.id}`);
  }
  return failures;
}

function evaluateWebMcpCase(definition, variables, finalTools) {
  const failures = [];
  const check = (actual, expected, label) => {
    const matches = typeof expected === "object" && expected !== null
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : actual === expected;
    if (expected !== undefined && !matches) {
      failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };
  const names = (tools) => tools.map(({ name }) => name);
  const finalNames = names(finalTools);
  check(finalNames.includes("submit_report"), definition.expect.gateOpen, "gateOpen");
  if (definition.expect.toolAbsent) {
    check(finalNames.includes(definition.expect.toolAbsent), false, `${definition.expect.toolAbsent} present`);
  }

  if (definition.id === "happy-3-round") {
    check(
      [variables.brokenRun?.reason, variables.weakRun?.reason, variables.realRun?.reason],
      definition.expect.reasons,
      "round reasons",
    );
    check(names(variables.openTools).length, definition.expect.toolCount, "open tool count");
    check(
      names(variables.openTools).includes(definition.expect.toolPresent),
      true,
      `${definition.expect.toolPresent} present`,
    );
    check(variables.staged?.status, definition.expect.stagedStatus, "staged status");
    check(
      variables.artifact?.reproSha256 === variables.realRun?.reproSha256,
      definition.expect.artifactHashMatchesRun,
      "signed artifact hash",
    );
    check(
      variables.artifact?.timeline?.at(-1)?.event,
      definition.expect.finalTimelineEvent,
      "signed artifact timeline",
    );
    check(variables.replay?.consistent, definition.expect.replayConsistent, "replay consistency");
    check(variables.replay?.label, definition.expect.replayLabel, "replay label");
  } else if (definition.id === "edit-revokes-tool") {
    check(variables.greenRun?.reason, definition.expect.reasonBeforeEdit, "reason before edit");
    check(names(variables.toolsBeforeEdit).length, definition.expect.toolCountBeforeEdit, "tool count before edit");
    check(names(variables.toolsAfterEdit).length, definition.expect.toolCountAfterEdit, "tool count after edit");
    check(
      names(variables.toolsAfterEdit).includes(definition.expect.removedTool),
      false,
      `${definition.expect.removedTool} after edit`,
    );
  } else if (definition.id === "stale-submit") {
    check(variables.greenRun?.reason, definition.expect.reasonBeforeEdit, "reason before edit");
    check(
      names(variables.toolsAfterEdit).includes("submit_report"),
      false,
      "submit_report after edit",
    );
    const controlledOutcome = definition.expect.submitOutcomes.some((expected) => (
      variables.submitResult?.source === expected.source
      && variables.submitResult?.code === expected.code
    ));
    check(controlledOutcome, true, "controlled stale submit outcome");
  } else if (definition.id === "baseline-tools") {
    check(names(variables.tools).length, definition.expect.toolCount, "baseline tool count");
    check(
      names(variables.tools).toSorted(),
      definition.expect.toolNames.toSorted(),
      "baseline tool names",
    );
  } else {
    failures.push(`No WebMCP evaluator for ${definition.id}`);
  }
  return failures;
}

async function runCase(definition, { baseUrl, harness, driver, evaluate }) {
  const startedAt = Date.now();
  await harness.navigate(caseUrl(baseUrl, definition));
  const target = await loadTargetContext(harness, driver);
  const setup = resolveTemplates(definition.setup, { target });
  const state = { timings: {}, variables: { target, ...setup } };

  for (const action of definition.actions) {
    const actionStartedAt = Date.now();
    const result = await executeAction(action, state, harness, driver);
    const durationMs = Date.now() - actionStartedAt;
    if (action.saveAs) {
      state.variables[action.saveAs] = result;
      state.timings[action.saveAs] = { durationMs };
    }
  }

  const finalTools = await driver.getTools();
  const failures = evaluate(definition, state.variables, finalTools, state.timings);
  const successDetails = definition.id === "timeout-recovers"
    ? `expectations met; timeout action ${state.timings.timeoutRun.durationMs}ms; recovery action ${state.timings.recoveryRun.durationMs}ms`
    : "expectations met";
  return {
    id: definition.id,
    tier: definition.tier,
    mustFail: definition.mustFail === true,
    status: failures.length === 0 ? "pass" : "fail",
    durationMs: Date.now() - startedAt,
    timings: state.timings,
    details: failures.length === 0 ? successDetails : failures.join("; "),
  };
}

export async function runLogicCase(definition, { baseUrl, harness }) {
  return runCase(definition, {
    baseUrl,
    harness,
    driver: harness.logic,
    evaluate: evaluateLogicCase,
  });
}

export async function runWebMcpCase(definition, { baseUrl, harness }) {
  return runCase(definition, {
    baseUrl,
    harness,
    driver: harness.webmcp,
    evaluate: evaluateWebMcpCase,
  });
}

export function formatResultsMarkdown({ url, chromeVersion, results, cases, generatedAt }) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const summary = (tier) => {
    const tierResults = tier === "overall"
      ? results
      : results.filter((result) => result.tier === tier);
    const passed = tierResults.filter((result) => result.status === "pass").length;
    const run = tierResults.filter((result) => result.status === "pass" || result.status === "fail").length;
    const rate = run === 0 ? "not run" : `${((passed / run) * 100).toFixed(0)}%`;
    return { passed, rate, run };
  };
  const lines = [
    "# Evaluation results",
    "",
    "> WebMCP cases use native `document.modelContext`; logic cases use the `?test=1` hook. Both tiers execute the real sandbox.",
    "",
    `- URL: \`${url}\``,
    `- Chrome: \`${chromeVersion}\``,
    `- Generated: \`${generatedAt}\``,
    "",
    "| Tier | Passed | Run | Pass rate |",
    "| --- | ---: | ---: | ---: |",
  ];
  for (const tier of ["webmcp", "logic", "overall"]) {
    const { passed, rate, run } = summary(tier);
    lines.push(`| ${tier} | ${passed} | ${run} | ${rate} |`);
  }
  lines.push(
    "",
    "| Case | Tier | Result | Detail |",
    "| --- | --- | --- | --- |",
  );
  for (const definition of cases) {
    const result = byId.get(definition.id);
    lines.push(
      `| ${definition.id} | ${definition.tier} | ${result?.status ?? "not run"} | ${(result?.details ?? "tier deferred").replaceAll("|", "\\|")} |`,
    );
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const cases = await loadCases();
  if (options.validate) {
    const logicCount = cases.filter(({ tier }) => tier === "logic").length;
    const webmcpCount = cases.length - logicCount;
    console.log(`Validated ${cases.length} cases (${logicCount} logic, ${webmcpCount} webmcp)`);
    return;
  }
  if (!options.url) throw new Error("--url is required unless --validate is used");

  const { chromeVersion, harness } = await prepareEvalRun(options);
  try {
    const selected = cases.filter(({ tier }) => options.tier === "all" || tier === options.tier);
    const results = [];
    for (const definition of selected) {
      try {
        const runner = definition.tier === "logic" ? runLogicCase : runWebMcpCase;
        const result = await runner(definition, { baseUrl: options.url, harness });
        results.push(result);
        console.log(`${result.status.toUpperCase()} ${result.tier} ${result.id}: ${result.details}`);
      } catch (error) {
        const result = {
          id: definition.id,
          tier: definition.tier,
          status: "fail",
          details: error.message,
        };
        results.push(result);
        console.log(`FAIL ${result.tier} ${result.id}: ${result.details}`);
      }
    }
    const markdown = formatResultsMarkdown({
      url: options.url,
      chromeVersion,
      results,
      cases,
      generatedAt: new Date().toISOString(),
    });
    if (shouldWriteCanonicalResults(options.tier)) {
      await writeFile(join(EVALS_DIR, "RESULTS.md"), markdown);
    } else {
      console.log("Partial tier run; evals/RESULTS.md was not updated");
    }
    const passed = results.filter(({ status }) => status === "pass").length;
    const failed = results.filter(({ status }) => status === "fail").length;
    console.log(`${passed}/${selected.length} selected cases passed; ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await harness.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
