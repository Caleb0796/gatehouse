import assert from "node:assert/strict";
import test from "node:test";
import { chromeLaunchContract, launchChromeHarness } from "../scripts/cdp-harness.mjs";
import {
  formatResultsMarkdown,
  loadCases,
  parseArgs,
  runLogicCase,
  runWebMcpCase,
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
