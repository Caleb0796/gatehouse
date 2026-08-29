import { test } from "node:test";
import assert from "node:assert/strict";
import { createToolInvoker, run } from "./simagent.js";

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
