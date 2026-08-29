import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_TARGET_ID,
  createToolInvoker,
  init,
  isDemoMode,
  prewarmDemo,
  run,
} from "./simagent.js";

const target = {
  demoRepros: {
    broken: "assert(false, 'broken')",
    weak: "assert(true, 'weak')",
    real: "assert(fixed, 'real')",
  },
};

test("WebMCP path discovers every tool and executes all three rounds", async () => {
  const calls = [];
  const tools = ["get_target_info", "write_repro", "run_repro", "submit_report"].map(name => ({ name }));
  const modelContext = {
    async getTools() {
      calls.push(["discover"]);
      return tools;
    },
    async executeTool(tool, args) {
      calls.push([tool.name, args]);
      return { ok: true };
    },
  };
  const waits = [];

  const result = await run(target, {
    modelContext,
    wait: async ms => waits.push(ms),
  });

  assert.equal(result.mode, "live");
  assert.deepEqual(calls.filter(([kind]) => kind === "discover").length, 8);
  assert.deepEqual(calls.filter(([kind]) => kind !== "discover"), [
    ["get_target_info", {}],
    ["write_repro", { code: target.demoRepros.broken }],
    ["run_repro", {}],
    ["write_repro", { code: target.demoRepros.weak }],
    ["run_repro", {}],
    ["write_repro", { code: target.demoRepros.real }],
    ["run_repro", {}],
    ["submit_report", {}],
  ]);
  assert.deepEqual(waits, Array(7).fill(800));
});

test("fallback path calls the current mock tool table directly", async () => {
  const calls = [];
  let reads = 0;
  const getToolTable = () => {
    reads += 1;
    return Object.fromEntries(
      ["get_target_info", "write_repro", "run_repro", "submit_report"].map(name => [
        name,
        { definition: { name }, execute: async args => calls.push([name, args]) },
      ]),
    );
  };

  const result = await run(target, { getToolTable, wait: async () => {} });

  assert.equal(result.mode, "simulated");
  assert.equal(reads, 8);
  assert.deepEqual(calls.map(([name]) => name), [
    "get_target_info",
    "write_repro",
    "run_repro",
    "write_repro",
    "run_repro",
    "write_repro",
    "run_repro",
    "submit_report",
  ]);
});

test("fallback is required only when WebMCP discovery is unavailable", () => {
  assert.throws(() => createToolInvoker({}), /getToolTable/);
});

test("a missing dynamic submit tool stops the run and reports the failed step", async () => {
  const steps = [];
  const getToolTable = () => Object.fromEntries(
    ["get_target_info", "write_repro", "run_repro"].map(name => [
      name,
      { definition: { name }, execute: async () => ({}) },
    ]),
  );

  await assert.rejects(
    run(target, { getToolTable, wait: async () => {}, onStep: step => steps.push(step) }),
    /Tool not available: submit_report/,
  );
  assert.equal(steps.at(-1).tool, "submit_report");
  assert.equal(steps.at(-1).state, "error");
});

test("demo mode only activates for demo=1", () => {
  assert.equal(isDemoMode("?demo=1"), true);
  assert.equal(isDemoMode("?demo=0"), false);
  assert.equal(isDemoMode("?target=another&demo=1"), true);
});

test("demo mode puts the agent start button first", () => {
  class FakeElement {
    constructor() {
      this.children = [];
      this.className = "";
    }

    addEventListener() {}

    append(...children) {
      this.children.push(...children);
    }

    replaceChildren(...children) {
      this.children = children;
    }

    setAttribute() {}
  }

  const document = {
    defaultView: { location: { search: "?target=ignored&demo=1" } },
    createElement: () => new FakeElement(),
  };
  const root = new FakeElement();

  const { button } = init(root, { document, target, getToolTable: () => ({}) });

  assert.equal(root.children[0], button);
  assert.equal(root.className, "simagent simagent--demo");
});

test("demo prewarm fixes the target and warms both bundles with empty runs", async () => {
  const calls = [];
  const loaded = {
    manifest: { id: DEMO_TARGET_ID, globalName: "Qs" },
    bundles: {
      bad: { sha256: "bad-sha", text: "bad bundle" },
      good: { sha256: "good-sha", text: "good bundle" },
    },
  };
  const runner = {
    async load(bundles) {
      calls.push(["load", bundles]);
    },
    async run(input) {
      calls.push(["run", input]);
      return { verdict: "pass" };
    },
    destroy() {
      calls.push(["destroy"]);
    },
  };

  const result = await prewarmDemo({
    async loadTarget(targetId) {
      calls.push(["target", targetId]);
      return loaded;
    },
    createRunner: () => runner,
  });

  assert.equal(result, loaded);
  assert.deepEqual(calls[0], ["target", DEMO_TARGET_ID]);
  assert.deepEqual(calls[1], ["load", [loaded.bundles.bad, loaded.bundles.good]]);
  assert.deepEqual(calls.slice(2, 4).map(([, input]) => input), [
    { bundleSha: "bad-sha", globalName: "Qs", code: "", timeoutMs: 2_000 },
    { bundleSha: "good-sha", globalName: "Qs", code: "", timeoutMs: 2_000 },
  ]);
  assert.deepEqual(calls.at(-1), ["destroy"]);
});

test("demo prewarm destroys the runner when a warm run fails", async () => {
  let destroyed = false;
  const loaded = {
    manifest: { globalName: "Qs" },
    bundles: {
      bad: { sha256: "bad-sha", text: "bad bundle" },
      good: { sha256: "good-sha", text: "good bundle" },
    },
  };

  await assert.rejects(prewarmDemo({
    loadTarget: async () => loaded,
    createRunner: () => ({
      load: async () => {},
      run: async () => { throw new Error("warm failed"); },
      destroy: () => { destroyed = true; },
    }),
  }), /warm failed/);
  assert.equal(destroyed, true);
});
