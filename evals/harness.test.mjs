import assert from "node:assert/strict";
import test from "node:test";
import { chromeLaunchContract, launchChromeHarness } from "../scripts/cdp-harness.mjs";
import { loadCases, parseArgs, validateCaseDefinition } from "./run-evals.mjs";

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
    { headless: true, url: "http://localhost:8080/?test=1", validate: false },
  );
});
