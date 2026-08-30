import assert from "node:assert/strict";
import test from "node:test";
import { chromeLaunchContract, launchChromeHarness } from "../scripts/cdp-harness.mjs";
import {
  classifyNativeToolRevocation,
  formatResultsMarkdown,
  loadCases,
  parseArgs,
  runLogicCase,
  runWebMcpCase,
  shouldWriteCanonicalResults,
  validateCaseDefinition,
} from "./run-evals.mjs";

test("the launch contract selects real Chrome and enables WebMCP", () => {
  assert.equal(chromeLaunchContract.channel, "chrome");
  assert.deepEqual(chromeLaunchContract.args, ["--enable-features=WebMCP"]);
});

test("launchChromeHarness passes the required options to Chromium", async () => {
  let launchOptions;
  let navigatedUrl;
  let closed = false;
  const page = {
    goto: async (url) => { navigatedUrl = url; },
    evaluate: async () => null,
    evaluateHandle: async () => null,
    reload: async () => null,
  };
  const context = {
    newPage: async () => page,
    newCDPSession: async () => ({
      send: async (method) => {
        assert.equal(method, "Browser.getVersion");
        return { product: "Chrome/152.0.7977.64" };
      },
    }),
  };
  const browser = {
    newContext: async () => context,
    close: async () => { closed = true; },
  };
  const playwright = {
    chromium: {
      launch: async (options) => {
        launchOptions = options;
        return browser;
      },
    },
  };

  const harness = await launchChromeHarness({
    url: "http://localhost:8080/?test=1",
    headless: false,
    playwright,
  });

  assert.deepEqual(launchOptions, {
    channel: "chrome",
    headless: false,
    args: ["--enable-features=WebMCP"],
  });
  assert.equal(navigatedUrl, "http://localhost:8080/?test=1");
  assert.equal(harness.chromeVersion, "Chrome/152.0.7977.64");
  await harness.close();
  assert.equal(closed, true);
});

test("case loader validates all 11 definitions and preserves both tiers", async () => {
  const cases = await loadCases();
  assert.equal(cases.length, 11);
  assert.deepEqual(new Set(cases.map(({ tier }) => tier)), new Set(["logic", "webmcp"]));
});

test("case validation rejects malformed mustFail values", () => {
  assert.throws(
    () => validateCaseDefinition({
      id: "bad",
      tier: "logic",
      setup: {},
      actions: [{}],
      expect: {},
      mustFail: "yes",
    }),
    /mustFail must be a boolean/,
  );
});

test("CLI arguments keep headless mode by default", () => {
  assert.deepEqual(
    parseArgs(["--url", "http://localhost:8080/?test=1"]),
    { headless: true, tier: "all", url: "http://localhost:8080/?test=1", validate: false },
  );
});

test("CLI accepts a logic-only first run", () => {
  assert.deepEqual(
    parseArgs(["--url", "http://localhost:8080/dev/s2.html?mock=green", "--tier", "logic"]),
    {
      headless: true,
      tier: "logic",
      url: "http://localhost:8080/dev/s2.html?mock=green",
      validate: false,
    },
  );
});

test("only a full eval run may replace the canonical results file", () => {
  assert.equal(shouldWriteCanonicalResults("all"), true);
  assert.equal(shouldWriteCanonicalResults("logic"), false);
  assert.equal(shouldWriteCanonicalResults("webmcp"), false);
});

test("results markdown records both tier pass rates and every case", async () => {
  const cases = await loadCases();
  const markdown = formatResultsMarkdown({
    url: "http://localhost:8080/dev/s2.html?mock=green&test=1",
    chromeVersion: "Chrome/152.0.7977.64",
    results: [
      { id: "assert-false", tier: "logic", status: "pass", details: "expectations met" },
      { id: "baseline-tools", tier: "webmcp", status: "pass", details: "expectations met" },
    ],
    cases,
    generatedAt: "2026-08-29T20:00:00.000Z",
  });

  assert.match(markdown, /\| webmcp \| 1 \| 1 \| 100% \|/);
  assert.match(markdown, /\| logic \| 1 \| 1 \| 100% \|/);
  assert.match(markdown, /\| overall \| 2 \| 2 \| 100% \|/);
  assert.match(markdown, /\| assert-false \| logic \| pass \| expectations met \|/);
  assert.match(markdown, /\| baseline-tools \| webmcp \| pass \| expectations met \|/);
  assert.equal(markdown.match(/^\| [^\n]+ \| (logic|webmcp) \|/gm).length, 11);
});

test("logic runner selects the case mock and evaluates hook results", async () => {
  const definition = (await loadCases()).find(({ id }) => id === "assert-false");
  let navigatedUrl;
  const tools = [
    { name: "get_target_info" },
    { name: "write_repro" },
    { name: "run_repro" },
    { name: "request_human_review" },
  ];
  const harness = {
    async navigate(url) {
      navigatedUrl = url;
    },
    logic: {
      async getTools() {
        return tools;
      },
      async executeTool(name) {
        if (name === "get_target_info") return { targetId: "demo-lib-001" };
        if (name === "write_repro") return { reproSha256: "a".repeat(64) };
        if (name === "run_repro") {
          return {
            green: false,
            reason: "FAIL_BOTH",
            runs: [
              { version: "bad", verdict: "fail" },
              { version: "good", verdict: "fail" },
            ],
          };
        }
        throw new Error(`unexpected tool: ${name}`);
      },
    },
    page: {
      async evaluate() {
        return null;
      },
      locator() {
        return { inputValue: async () => "assert(true);" };
      },
    },
  };

  const result = await runLogicCase(definition, {
    baseUrl: "http://localhost:8080/dev/s2.html?mock=green&test=1",
    harness,
  });

  assert.equal(result.status, "pass");
  assert.match(navigatedUrl, /mock=failboth/);
  assert.match(navigatedUrl, /test=1/);
});

test("timeout case records the timeout action and immediately proves runner recovery", async () => {
  const definition = (await loadCases()).find(({ id }) => id === "timeout-recovers");
  let runCount = 0;
  const tools = [
    { name: "get_target_info" },
    { name: "request_human_review" },
    { name: "run_repro" },
    { name: "write_repro" },
  ];
  const harness = {
    async navigate() {},
    logic: {
      async getTools() {
        return tools;
      },
      async executeTool(name) {
        if (name === "get_target_info") return { targetId: "demo-lib-001" };
        if (name === "write_repro") return { reproSha256: "a".repeat(64) };
        if (name === "run_repro") {
          runCount += 1;
          return runCount === 1
            ? {
                reason: "BAD_TIMEOUT",
                runs: [
                  { version: "bad", verdict: "timeout" },
                  { version: "good", verdict: "timeout" },
                ],
              }
            : {
                reason: "PASS_BOTH",
                runs: [
                  { version: "bad", verdict: "pass" },
                  { version: "good", verdict: "pass" },
                ],
              };
        }
        throw new Error(`unexpected tool: ${name}`);
      },
    },
    async probePage() {
      return { alive: true };
    },
    page: {
      async evaluate() {
        return null;
      },
      locator() {
        return { inputValue: async () => "assert(true);" };
      },
    },
  };

  const result = await runLogicCase(definition, {
    baseUrl: "http://localhost:8080/?test=1",
    harness,
  });

  assert.equal("timeoutMs" in definition.setup, false);
  assert.equal(runCount, 2);
  assert.equal(result.status, "pass");
  assert.match(result.details, /timeout action \d+ms; recovery action \d+ms/);
});

test("receipt case opens the inbox receipt and enforces its verification label", async () => {
  const definition = (await loadCases()).find(({ id }) => id === "receipt-round-trip");
  const reproSha256 = "a".repeat(64);
  const tools = [
    { name: "get_target_info" },
    { name: "request_human_review" },
    { name: "run_repro" },
    { name: "submit_report" },
    { name: "write_repro" },
  ];
  const artifact = { reproSha256 };
  let verificationLabel = "not verified";
  const harness = {
    async navigate() {},
    logic: {
      async getTools() {
        return tools;
      },
      async executeTool(name) {
        if (name === "get_target_info") return { targetId: "demo-lib-001" };
        if (name === "write_repro") return { reproSha256 };
        if (name === "run_repro") {
          return { reason: "REGRESSION_DEMONSTRATED", reproSha256 };
        }
        if (name === "submit_report") {
          return { status: "staged_awaiting_local_approval" };
        }
        throw new Error(`unexpected tool: ${name}`);
      },
    },
    async click() {},
    async readSignedArtifact() {
      return artifact;
    },
    async encodeReceipt() {
      return { url: "receipt.html#a=fixture" };
    },
    async decodeReceipt() {
      return { artifact, reproHashOk: true };
    },
    async inspectInboxReceipt() {
      return { verificationLabel };
    },
    page: {
      async evaluate() {
        return null;
      },
      locator() {
        return { inputValue: async () => "assert(true);" };
      },
    },
  };

  const mismatch = await runLogicCase(definition, {
    baseUrl: "http://localhost:8080/?test=1",
    harness,
  });
  assert.equal(mismatch.status, "fail");
  assert.match(mismatch.details, /rendered verification label/);

  verificationLabel = "repro hash verified ✓";
  const matching = await runLogicCase(definition, {
    baseUrl: "http://localhost:8080/?test=1",
    harness,
  });
  assert.equal(matching.status, "pass");
});

test("WebMCP runner evaluates the native baseline tool surface", async () => {
  const definition = (await loadCases()).find(({ id }) => id === "baseline-tools");
  const tools = [
    { name: "get_target_info" },
    { name: "request_human_review" },
    { name: "run_repro" },
    { name: "write_repro" },
  ];
  const harness = {
    async navigate() {},
    webmcp: {
      async getTools() {
        return tools;
      },
      async executeTool(name) {
        assert.equal(name, "get_target_info");
        return { targetId: "demo-lib-001" };
      },
    },
    page: {
      async evaluate() {
        return null;
      },
      locator() {
        return { inputValue: async () => "assert(true);" };
      },
    },
  };

  const result = await runWebMcpCase(definition, {
    baseUrl: "http://localhost:8080/?test=1",
    harness,
  });

  assert.equal(result.status, "pass");
  assert.equal(result.tier, "webmcp");
});

test("happy WebMCP runner submits, signs, reads, and replays the artifact", async () => {
  const definition = (await loadCases()).find(({ id }) => id === "happy-3-round");
  const reasons = ["FAIL_BOTH", "PASS_BOTH", "REGRESSION_DEMONSTRATED"];
  const reproSha256 = "a".repeat(64);
  const calls = [];
  let gateOpen = false;
  let signed = false;
  let replayed = false;
  const baselineTools = [
    { name: "get_target_info" },
    { name: "request_human_review" },
    { name: "run_repro" },
    { name: "write_repro" },
  ];
  const artifact = {
    reproSha256,
    timeline: [{ event: "signed" }],
  };
  const harness = {
    async navigate() {},
    webmcp: {
      async getTools() {
        return gateOpen ? [...baselineTools, { name: "submit_report" }] : baselineTools;
      },
      async executeTool(name) {
        calls.push(name);
        if (name === "get_target_info") return { targetId: "demo-lib-001" };
        if (name === "write_repro") return { reproSha256 };
        if (name === "run_repro") {
          const reason = reasons.shift();
          if (reason === "REGRESSION_DEMONSTRATED") gateOpen = true;
          return { reason, reproSha256 };
        }
        if (name === "submit_report") {
          return { status: "staged_awaiting_local_approval" };
        }
        throw new Error(`unexpected tool: ${name}`);
      },
    },
    async click(selector) {
      assert.equal(selector, "#sign-panel button");
      signed = true;
    },
    async readSignedArtifact() {
      assert.equal(signed, true);
      return artifact;
    },
    async replaySignedArtifact() {
      assert.equal(signed, true);
      replayed = true;
      return { consistent: true, label: "Replay matches recorded runs" };
    },
    page: {
      async evaluate() {
        return null;
      },
      locator() {
        return { inputValue: async () => "assert(true);" };
      },
    },
  };

  const result = await runWebMcpCase(definition, {
    baseUrl: "http://localhost:8080/?test=1",
    harness,
  });

  assert.equal(result.status, "pass");
  assert.equal(calls.includes("submit_report"), true);
  assert.equal(replayed, true);
});

test("WebMCP stale submit distinguishes browser revocation from application staleness", async () => {
  const definition = (await loadCases()).find(({ id }) => id === "stale-submit");
  let gateOpen = false;
  let writes = 0;
  let outcome = "browser";
  const baselineTools = [
    { name: "get_target_info" },
    { name: "request_human_review" },
    { name: "run_repro" },
    { name: "write_repro" },
  ];
  const harness = {
    async navigate() {},
    webmcp: {
      async getTools() {
        return gateOpen ? [...baselineTools, { name: "submit_report" }] : baselineTools;
      },
      async executeTool(name) {
        if (name === "get_target_info") return { targetId: "demo-lib-001" };
        if (name === "write_repro") {
          writes += 1;
          if (writes > 1) gateOpen = false;
          return { reproSha256: "a".repeat(64) };
        }
        if (name === "run_repro") {
          gateOpen = true;
          return { reason: "REGRESSION_DEMONSTRATED" };
        }
        throw new Error(`unexpected tool: ${name}`);
      },
      async captureTool() {
        return { name: "submit_report" };
      },
      async executeCapturedTool() {
        if (outcome === "application") {
          return { code: "STALE_REPRO", message: "draft changed" };
        }
        if (outcome === "unrelated") throw new Error("network failed");
        throw new Error(
          "page.evaluate: UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).",
        );
      },
    },
    page: {
      async evaluate() {
        return null;
      },
      locator() {
        return { inputValue: async () => "assert(true);" };
      },
    },
  };

  const result = await runWebMcpCase(definition, {
    baseUrl: "http://localhost:8080/?test=1",
    harness,
  });

  assert.equal(result.status, "pass");

  gateOpen = false;
  writes = 0;
  outcome = "application";
  const applicationResult = await runWebMcpCase(definition, {
    baseUrl: "http://localhost:8080/?test=1",
    harness,
  });
  assert.equal(applicationResult.status, "pass");

  gateOpen = false;
  writes = 0;
  outcome = "unrelated";
  await assert.rejects(
    runWebMcpCase(definition, {
      baseUrl: "http://localhost:8080/?test=1",
      harness,
    }),
    /network failed/,
  );
});

test("native revocation classification requires both a removed tool and a known error", () => {
  const observed = new Error(
    "page.evaluate: UnknownError: The operation failed for an unknown transient reason (e.g. out of memory).",
  );
  assert.deepEqual(
    classifyNativeToolRevocation(observed, "submit_report", []),
    {
      rejected: true,
      source: "browser",
      code: "WEBMCP_TOOL_REVOKED",
      nativeErrorName: "UnknownError",
      message: observed.message,
    },
  );
  assert.equal(
    classifyNativeToolRevocation(observed, "submit_report", [{ name: "submit_report" }]),
    null,
  );
  assert.equal(
    classifyNativeToolRevocation(new Error("network failed"), "submit_report", []),
    null,
  );
});
