import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  chromeLaunchContract,
  launchChromeHarness,
  parseToolResult,
} from "../scripts/cdp-harness.mjs";
import {
  bundledChromiumAdapter,
  formatResultsMarkdown,
  loadCases,
  parseArgs,
  runLogicCase,
  runWebMcpCase,
  validateCaseDefinition,
} from "./run-evals.mjs";

test("the launch contract selects real Chrome and enables WebMCP", () => {
  assert.equal(chromeLaunchContract.channel, "chrome");
  assert.deepEqual(chromeLaunchContract.args, ["--enable-features=WebMCPTesting"]);
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
        return { product: "HeadlessChrome/152.0.7977.64" };
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
    args: ["--enable-features=WebMCPTesting"],
  });
  assert.equal(navigatedUrl, "http://localhost:8080/?test=1");
  assert.equal(harness.chromeVersion, "HeadlessChrome/152.0.7977.64");
  await harness.close();
  assert.equal(closed, true);
});

test("native WebMCP execution uses JSON string arguments and parses JSON results", async () => {
  const source = await readFile(new URL("../scripts/cdp-harness.mjs", import.meta.url), "utf8");
  assert.match(source, /api\.executeTool\(tool, JSON\.stringify\(toolInput\)\)/);
  assert.match(source, /api\.executeTool\(capturedTool, JSON\.stringify\(toolInput\)\)/);
  assert.match(source, /JSON\.parse\(value\)/);
  assert.match(source, /importReceiptJson/);
  assert.doesNotMatch(source, /api\.executeTool\(tool, toolInput\)/);
});

test("native WebMCP results must be JSON strings containing valid JSON", () => {
  assert.deepEqual(parseToolResult('{"ok":true}'), { ok: true });
  assert.throws(
    () => parseToolResult({ ok: true }),
    /must return a JSON string/,
  );
  assert.throws(
    () => parseToolResult("not JSON"),
    /returned invalid JSON/,
  );
  assert.throws(
    () => parseToolResult(JSON.stringify({ detail: "x".repeat(1500) })),
    /exceeds 1500 characters/,
  );
});

test("case loader validates all 13 definitions and preserves both tiers", async () => {
  const cases = await loadCases();
  assert.equal(cases.length, 13);
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
  assert.throws(
    () => validateCaseDefinition({
      id: "bad-timeout",
      tier: "logic",
      setup: {},
      actions: [{ op: "getTools", timeoutMs: 0 }],
      expect: {},
    }),
    /timeoutMs between 1 and 120000/,
  );
});

test("case validation rejects a known case with missing expectations", async () => {
  const baseline = (await loadCases()).find(({ id }) => id === "baseline-tools");
  assert.throws(
    () => validateCaseDefinition({ ...baseline, expect: {} }, "baseline.json"),
    /expect is missing toolCount, toolNames, toolAbsent/,
  );
});

test("CLI arguments keep headless mode by default", () => {
  assert.deepEqual(
    parseArgs(["--url", "http://localhost:8080/?test=1"]),
    {
      browser: "chrome",
      headless: true,
      tier: "all",
      url: "http://localhost:8080/?test=1",
      validate: false,
    },
  );
});

test("CLI accepts a logic-only first run", () => {
  assert.deepEqual(
    parseArgs(["--url", "http://localhost:8080/dev/s2.html?mock=green", "--tier", "logic"]),
    {
      browser: "chrome",
      headless: true,
      tier: "logic",
      url: "http://localhost:8080/dev/s2.html?mock=green",
      validate: false,
    },
  );
});

test("CLI can select bundled Chromium for the logic tier", () => {
  assert.deepEqual(
    parseArgs(["--url", "http://localhost:8080/", "--tier", "logic", "--browser", "chromium"]),
    {
      browser: "chromium",
      headless: true,
      tier: "logic",
      url: "http://localhost:8080/",
      validate: false,
    },
  );
});

test("bundled Chromium adapter removes the Chrome channel and WebMCP flag", async () => {
  let launchOptions;
  const adapter = bundledChromiumAdapter({
    chromium: {
      async launch(options) {
        launchOptions = options;
        return { close: async () => {} };
      },
    },
  });

  await adapter.chromium.launch({
    channel: "chrome",
    headless: false,
    args: ["--enable-features=WebMCPTesting"],
  });

  assert.deepEqual(launchOptions, { headless: false });
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
  assert.equal(markdown.match(/^\| [^\n]+ \| (logic|webmcp) \|/gm).length, 13);
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

test("WebMCP retry case calls one draft repeatedly and keeps submit closed after taint", async () => {
  const definition = (await loadCases()).find(({ id }) => id === "retry-until-lucky");
  const baselineTools = [
    { name: "get_target_info" },
    { name: "request_human_review" },
    { name: "run_repro" },
    { name: "write_repro" },
  ];
  let routeInstalled = false;
  let routeRemoved = false;
  let runCount = 0;
  let writeCount = 0;
  const harness = {
    async navigate() {
      assert.equal(routeInstalled, true);
    },
    webmcp: {
      async getTools() {
        return baselineTools;
      },
      async executeTool(name) {
        if (name === "get_target_info") return { targetId: "demo-lib-001" };
        if (name === "write_repro") {
          writeCount += 1;
          return { reproSha256: "a".repeat(64) };
        }
        if (name === "run_repro") {
          runCount += 1;
          const green = runCount > 1;
          return {
            green,
            reason: green ? "STABLE_LOCAL_DIFFERENTIAL" : "UNSTABLE",
            stable: green,
            repeats: 5,
            runs: [
              { version: "bad", verdict: "fail" },
              { version: "good", verdict: "pass" },
            ],
          };
        }
        throw new Error(`unexpected tool: ${name}`);
      },
    },
    page: {
      async route(pattern, handler) {
        assert.equal(pattern, "**/src/sandbox/runner.js");
        assert.equal(typeof handler, "function");
        routeInstalled = true;
      },
      async unroute(pattern, handler) {
        assert.equal(pattern, "**/src/sandbox/runner.js");
        assert.equal(typeof handler, "function");
        routeRemoved = true;
      },
      async evaluate() {
        return {
          id: "demo-lib-001",
          demoRepros: { broken: "assert(false);", weak: "assert(true);", real: "assert(true);" },
        };
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
  assert.equal(writeCount, 1);
  assert.equal(runCount, 20);
  assert.equal(routeRemoved, true);
});

test("flaky oracle fails if submit_report opens before a later non-green run", async () => {
  const definition = (await loadCases()).find(({ id }) => id === "flaky-random");
  const baselineTools = [
    { name: "get_target_info" },
    { name: "request_human_review" },
    { name: "run_repro" },
    { name: "write_repro" },
  ];
  let runCount = 0;
  let gateOpen = false;
  const harness = {
    async navigate() {},
    webmcp: {
      async getTools() {
        return gateOpen ? [...baselineTools, { name: "submit_report" }] : baselineTools;
      },
      async executeTool(name) {
        if (name === "get_target_info") return { targetId: "demo-lib-001" };
        if (name === "write_repro") return { reproSha256: "a".repeat(64) };
        if (name === "run_repro") {
          runCount += 1;
          gateOpen = runCount === 1;
          return {
            green: gateOpen,
            reason: gateOpen ? "STABLE_LOCAL_DIFFERENTIAL" : "UNSTABLE",
            stable: gateOpen,
            repeats: 5,
            runs: [
              { version: "bad", verdict: "fail" },
              { version: "good", verdict: "pass" },
            ],
          };
        }
        throw new Error(`unexpected tool: ${name}`);
      },
    },
    page: {
      async evaluate() {
        return {
          id: "demo-lib-001",
          demoRepros: { broken: "assert(false);", weak: "assert(true);", real: "assert(true);" },
        };
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

  assert.equal(result.status, "fail");
  assert.match(result.details, /submit_report ever opened/);
});

test("flaky oracle rejects malformed or internally inconsistent run responses", async () => {
  const definition = (await loadCases()).find(({ id }) => id === "flaky-random");
  const baselineTools = [
    { name: "get_target_info" },
    { name: "request_human_review" },
    { name: "run_repro" },
    { name: "write_repro" },
  ];
  const harness = {
    async navigate() {},
    webmcp: {
      getTools: async () => baselineTools,
      async executeTool(name) {
        if (name === "get_target_info") return { targetId: "demo-lib-001" };
        if (name === "write_repro") return { code: "INVALID_INPUT" };
        if (name === "run_repro") return { code: "NO_REPRO" };
        throw new Error(`unexpected tool: ${name}`);
      },
    },
    page: {
      async evaluate() {
        return {
          id: "demo-lib-001",
          demoRepros: { broken: "assert(false);", weak: "assert(true);", real: "assert(true);" },
        };
      },
      locator() {
        return { inputValue: async () => "assert(true);" };
      },
    },
  };

  await assert.rejects(
    runWebMcpCase(definition, {
      baseUrl: "http://localhost:8080/?test=1",
      harness,
    }),
    /malformed differential summary/,
  );

  harness.webmcp.executeTool = async (name) => {
    if (name === "get_target_info") return { targetId: "demo-lib-001" };
    if (name === "write_repro") return { reproSha256: "a".repeat(64) };
    if (name === "run_repro") {
      return {
        green: false,
        reason: "UNSTABLE",
        stable: true,
        repeats: 5,
        runs: [
          { version: "bad", verdict: "pass" },
          { version: "good", verdict: "pass" },
        ],
      };
    }
    throw new Error(`unexpected tool: ${name}`);
  };
  await assert.rejects(
    runWebMcpCase(definition, {
      baseUrl: "http://localhost:8080/?test=1",
      harness,
    }),
    /inconsistent differential summary/,
  );

  harness.webmcp.executeTool = async (name) => {
    if (name === "get_target_info") return { targetId: "demo-lib-001" };
    if (name === "write_repro") return { reproSha256: "a".repeat(64) };
    if (name === "run_repro") {
      return {
        green: true,
        reason: "STABLE_LOCAL_DIFFERENTIAL",
        stable: true,
        repeats: 5,
        runs: [
          { version: "bad", verdict: "pass" },
          { version: "good", verdict: "pass" },
        ],
      };
    }
    throw new Error(`unexpected tool: ${name}`);
  };
  await assert.rejects(
    runWebMcpCase(definition, {
      baseUrl: "http://localhost:8080/?test=1",
      harness,
    }),
    /inconsistent differential summary/,
  );
});

test("an eval action deadline rejects a driver that never settles", async () => {
  const baseline = (await loadCases()).find(({ id }) => id === "baseline-tools");
  const definition = {
    ...baseline,
    actions: [{ op: "getTools", saveAs: "tools", timeoutMs: 20 }],
  };
  const harness = {
    async navigate() {},
    webmcp: {
      async executeTool(name) {
        assert.equal(name, "get_target_info");
        return { targetId: "demo-lib-001" };
      },
      getTools() {
        return new Promise(() => {});
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

  await assert.rejects(
    runWebMcpCase(definition, {
      baseUrl: "http://localhost:8080/?test=1",
      harness,
    }),
    /baseline-tools: getTools timed out after 20ms/,
  );
});

test("WebMCP stale submit treats native revocation as STALE_REPRO", async () => {
  const definition = (await loadCases()).find(({ id }) => id === "stale-submit");
  let gateOpen = false;
  let writes = 0;
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
          return { reason: "STABLE_LOCAL_DIFFERENTIAL" };
        }
        throw new Error(`unexpected tool: ${name}`);
      },
      async captureTool() {
        return { name: "submit_report" };
      },
      async executeCapturedTool() {
        throw new Error("UnknownError: revoked native tool");
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
});
