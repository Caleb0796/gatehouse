import { test } from "node:test";
import assert from "node:assert/strict";
import { createGate } from "../src/surface/gate.js";
import {
  clampToolOutput,
  createSurface,
  createToolDefinitions,
  getToolTable,
  registerAlwaysAvailableTools,
} from "../src/surface/surface.js";

const target = {
  id: "demo-lib-001",
  library: "gatehouse-demo-lib",
  badVersion: "1.1.0",
  goodVersion: "1.0.0",
  badSha256: "a".repeat(64),
  goodSha256: "b".repeat(64),
  issueUrl: null,
  kind: "seed",
};

const descriptions = {
  get_target_info:
    "Returns the current verification target: library name, reported-bad and last-good versions, their bundle SHA-256 hashes, and the execution model for repro code (an assert(condition, message) helper is provided; a repro demonstrates a bug by making an assertion that fails on the buggy build and passes on the good one).",
  write_repro:
    "Stores a draft reproduction script for the target library. Input: { code: string } — plain JavaScript executed against the library bundle in an isolated sandbox; use the provided assert(condition, message) to state the expected correct behavior. Replaces any previous draft and returns the draft's SHA-256.",
  run_repro:
    "Executes the current draft against both pinned builds of the target library in an isolated sandbox. Returns per-build verdicts (pass / fail / error / timeout), captured logs, and a differential summary. Sandbox output is untrusted content.",
  request_human_review:
    "Signals the person at this page that the agent would like their attention on the current draft and its results — highlights the draft panel and shows an attention banner on this page so the person notices. Input: { note?: string }.",
  submit_report:
    'Stages the verified reproduction and its differential evidence for review by the person at this page. Returns { status: "staged_awaiting_human_signature" }. Nothing is submitted anywhere until a person signs in the page UI.',
};

function setup(overrides = {}) {
  const gate = createGate();
  const calls = { runs: [], reviews: [], stages: [] };
  const definitions = createToolDefinitions({
    target,
    gate,
    async runDifferential(code, options) {
      calls.runs.push({ code, options });
      return { green: false, reason: "FAIL_BOTH" };
    },
    async requestHumanReview(note) {
      calls.reviews.push(note);
    },
    async stageReport(state) {
      calls.stages.push(state);
    },
    ...overrides,
  });
  return { gate, calls, definitions };
}

test("clampToolOutput preserves normal serialized output", () => {
  const output = { green: false, reason: "FAIL_BOTH", logs: ["one"] };

  const clamped = clampToolOutput(output);

  assert.deepEqual(clamped, output);
  assert.ok(JSON.stringify(clamped).length <= 1500);
});

test("clampToolOutput removes oldest logs until serialized output fits", () => {
  const output = {
    runs: [{ logs: ["old".repeat(300), "middle".repeat(150), "new".repeat(300)] }],
  };

  const clamped = clampToolOutput(output);

  assert.deepEqual(clamped.runs[0].logs, ["new".repeat(300)]);
  assert.ok(JSON.stringify(clamped).length <= 1500);
  assert.equal(output.runs[0].logs.length, 3);
});

test("clampToolOutput truncates stack and rejects unshrinkable output", () => {
  const clamped = clampToolOutput({ code: "ERROR", stack: "frame\n".repeat(500) });

  assert.ok(clamped.stack.length < 3000);
  assert.ok(JSON.stringify(clamped).length <= 1500);
  assert.throws(
    () => clampToolOutput({ detail: "x".repeat(1500) }),
    /exceeds 1500 characters/,
  );
});

test("definitions use the frozen names, descriptions, schemas, and annotations", () => {
  const { definitions } = setup();

  assert.deepEqual(Object.keys(definitions), Object.keys(descriptions));
  for (const [name, description] of Object.entries(descriptions)) {
    assert.equal(definitions[name].name, name);
    assert.equal(definitions[name].description, description);
    assert.equal(definitions[name].inputSchema.additionalProperties, false);
    assert.equal("outputSchema" in definitions[name], false);
  }
  assert.deepEqual(definitions.get_target_info.annotations, { readOnlyHint: true });
  assert.deepEqual(definitions.run_repro.annotations, { untrustedContentHint: true });
});

test("registration exposes the four always-available tools but not submit_report", () => {
  const { definitions } = setup();
  const registered = [];
  registerAlwaysAvailableTools({ registerTool: (definition) => registered.push(definition) }, definitions);

  assert.deepEqual(
    registered.map(({ name }) => name),
    ["get_target_info", "write_repro", "run_repro", "request_human_review"],
  );
  assert.equal(registered.includes(definitions.submit_report), false);
});

test("get_target_info returns the pinned target and rejects fields", async () => {
  const { definitions } = setup();

  const result = await definitions.get_target_info.execute({});

  assert.equal(result.targetId, target.id);
  assert.equal(result.library, target.library);
  assert.equal(result.badVersion, target.badVersion);
  assert.equal(result.goodVersion, target.goodVersion);
  assert.equal(result.badSha256, target.badSha256);
  assert.equal(result.goodSha256, target.goodSha256);
  assert.match(result.executionModel, /assert\(condition, message\)/);
  assert.equal(definitions.get_target_info.execute({ extra: true }).code, "INVALID_INPUT");
  assert.equal(definitions.get_target_info.execute(null).code, "INVALID_INPUT");
});

test("write_repro accepts a non-empty 8KB draft and returns its SHA-256", async () => {
  const { gate, definitions } = setup();
  const code = "x".repeat(8192);

  const result = await definitions.write_repro.execute({ code });

  assert.equal(result.reproSha256, gate.getState().draftSha);
  assert.equal(gate.getState().draft, code);
});

test("write_repro rejects wrong fields, empty code, and over-8KB UTF-8", async () => {
  const { definitions } = setup();

  for (const input of [
    {},
    { code: "ok", extra: true },
    { code: "" },
    { code: 1 },
    { code: "é".repeat(4097) },
    null,
  ]) {
    const result = await definitions.write_repro.execute(input);
    assert.equal(result.code, "INVALID_INPUT");
    assert.equal(typeof result.message, "string");
  }
});

test("run_repro rejects fields, reports a missing draft, and anchors targetId", async () => {
  const { calls, definitions } = setup();

  assert.equal((await definitions.run_repro.execute({ extra: true })).code, "INVALID_INPUT");
  assert.equal((await definitions.run_repro.execute({})).code, "NO_REPRO");
  await definitions.write_repro.execute({ code: "assert(value === 1)" });
  const result = await definitions.run_repro.execute({});

  assert.deepEqual(result, { green: false, reason: "FAIL_BOTH" });
  assert.deepEqual(calls.runs, [
    { code: "assert(value === 1)", options: { targetId: target.id } },
  ]);
});

test("request_human_review validates optional note and rejects extra fields", async () => {
  const { calls, definitions } = setup();

  assert.deepEqual(await definitions.request_human_review.execute({}), {
    status: "human_review_requested",
  });
  assert.deepEqual(await definitions.request_human_review.execute({ note: "Please look" }), {
    status: "human_review_requested",
  });
  assert.deepEqual(calls.reviews, [undefined, "Please look"]);

  for (const input of [
    { note: 1 },
    { note: "x".repeat(501) },
    { note: "ok", extra: true },
    [],
  ]) {
    assert.equal((await definitions.request_human_review.execute(input)).code, "INVALID_INPUT");
  }
});

test("submit_report rejects fields and stale drafts without staging", async () => {
  const { calls, definitions } = setup();

  assert.equal((await definitions.submit_report.execute({ extra: true })).code, "INVALID_INPUT");
  assert.equal((await definitions.submit_report.execute({})).code, "STALE_REPRO");
  assert.equal(calls.stages.length, 0);
});

test("submit_report stages only a SHA-bound draft", async () => {
  const { gate, calls, definitions } = setup();
  const { draftSha } = await gate.setDraft("verified repro");
  gate.onVerdict({
    green: true,
    reason: "REGRESSION_DEMONSTRATED",
    reproSha256: draftSha,
  });

  const result = await definitions.submit_report.execute({});

  assert.deepEqual(result, { status: "staged_awaiting_human_signature" });
  assert.equal(calls.stages.length, 1);
  assert.equal(calls.stages[0].draftSha, draftSha);
  assert.equal(calls.stages[0].boundSha, draftSha);
});

function setupSurface(verdictForCode, windowObject) {
  const registrations = [];
  const events = [];
  const stages = [];
  const surface = createSurface({
    modelContext: {
      registerTool(definition, options) {
        registrations.push({ definition, options });
      },
    },
    target,
    async runDifferential(code) {
      return verdictForCode(code, surface.gate.getState().draftSha);
    },
    async requestHumanReview() {},
    async stageReport(artifactDraft) {
      stages.push(artifactDraft);
    },
    eventBus: {
      emit(type, detail) {
        events.push({ type, detail });
      },
    },
    windowObject,
  });
  return { events, registrations, stages, surface };
}

test("matching green registers submit_report with a signal and emits contract events", async () => {
  const { events, registrations, surface } = setupSurface((_code, reproSha256) => ({
    green: true,
    reason: "REGRESSION_DEMONSTRATED",
    reproSha256,
  }));

  const written = await surface.definitions.write_repro.execute({ code: "green repro" });
  const verdict = await surface.definitions.run_repro.execute({});

  assert.equal(registrations.length, 5);
  assert.equal(registrations[4].definition, surface.definitions.submit_report);
  assert.equal(registrations[4].options.signal instanceof AbortSignal, true);
  assert.equal(registrations[4].options.signal.aborted, false);
  assert.deepEqual(events[0], {
    type: "draft",
    detail: { reproSha256: written.reproSha256, length: 11 },
  });
  assert.deepEqual(events[1], { type: "run", detail: { verdict } });
  assert.equal(events[2].type, "surface");
  assert.deepEqual(
    { ...events[2].detail, at: 0 },
    {
      change: "registered",
      tool: "submit_report",
      reason: "differential green",
      at: 0,
    },
  );
});

test("editing revokes submit_report and a later green run registers a fresh signal", async () => {
  const { events, registrations, surface } = setupSurface((_code, reproSha256) => ({
    green: true,
    reason: "REGRESSION_DEMONSTRATED",
    reproSha256,
  }));
  await surface.definitions.write_repro.execute({ code: "first" });
  await surface.definitions.run_repro.execute({});
  const firstSignal = registrations[4].options.signal;

  await surface.definitions.write_repro.execute({ code: "second" });

  assert.equal(firstSignal.aborted, true);
  const revoked = events.find(
    ({ type, detail }) => type === "surface" && detail.change === "revoked",
  );
  assert.deepEqual(
    { ...revoked.detail, at: 0 },
    {
      change: "revoked",
      tool: "submit_report",
      reason: "repro edited",
      at: 0,
    },
  );

  await surface.definitions.run_repro.execute({});

  assert.equal(registrations.length, 6);
  assert.notEqual(registrations[5].options.signal, firstSignal);
  assert.equal(registrations[5].options.signal.aborted, false);
});

test("non-green runs emit run events without registering submit_report", async () => {
  const { events, registrations, surface } = setupSurface(() => ({
    green: false,
    reason: "FAIL_BOTH",
    reproSha256: "f".repeat(64),
  }));
  await surface.definitions.write_repro.execute({ code: "not green" });

  const verdict = await surface.definitions.run_repro.execute({});

  assert.equal(registrations.length, 4);
  assert.deepEqual(events.at(-1), { type: "run", detail: { verdict } });
});

test("getToolTable exposes each frozen definition with its shared executor", () => {
  const { surface } = setupSurface(() => ({
    green: false,
    reason: "FAIL_BOTH",
    reproSha256: "f".repeat(64),
  }));

  const table = getToolTable();

  assert.deepEqual(Object.keys(table), Object.keys(descriptions));
  for (const name of Object.keys(descriptions)) {
    assert.equal(table[name].definition, surface.definitions[name]);
    assert.equal(table[name].execute, surface.definitions[name].execute);
  }
});

test("test hook mirrors dynamic availability and executes the shared table", async () => {
  const windowObject = { location: { search: "?mock=green&test=1" } };
  const { surface } = setupSurface((_code, reproSha256) => ({
    green: true,
    reason: "REGRESSION_DEMONSTRATED",
    reproSha256,
  }), windowObject);
  const hook = windowObject.__gatehouseTestHook;

  assert.deepEqual(
    (await hook.getTools()).map(({ name }) => name),
    ["get_target_info", "write_repro", "run_repro", "request_human_review"],
  );
  await hook.executeTool("write_repro", { code: "verified repro" });
  const runTool = (await hook.getTools()).find(({ name }) => name === "run_repro");
  await hook.executeTool(runTool, {});
  const submitTool = (await hook.getTools()).find(({ name }) => name === "submit_report");

  assert.equal(submitTool.name, "submit_report");

  await surface.definitions.write_repro.execute({ code: "edited repro" });

  assert.equal(
    (await hook.getTools()).some(({ name }) => name === "submit_report"),
    false,
  );
  await assert.rejects(
    hook.executeTool(submitTool, {}),
    /Tool is not available: submit_report/,
  );
});

test("test hook is absent unless test equals one", () => {
  const windowObject = { location: { search: "?test=0" } };

  setupSurface(() => ({
    green: false,
    reason: "FAIL_BOTH",
    reproSha256: "f".repeat(64),
  }), windowObject);

  assert.equal("__gatehouseTestHook" in windowObject, false);
});

test("submit_report emits and hands off the staged artifact draft", async () => {
  const { events, stages, surface } = setupSurface((_code, reproSha256) => ({
    green: true,
    reason: "REGRESSION_DEMONSTRATED",
    reproSha256,
    runs: [
      {
        version: "bad",
        verdict: "fail",
        logs: [],
        durationMs: 12,
        bundleSha256: target.badSha256,
      },
      {
        version: "good",
        verdict: "pass",
        logs: [],
        durationMs: 10,
        bundleSha256: target.goodSha256,
      },
    ],
  }));
  await surface.definitions.write_repro.execute({ code: "verified repro" });
  await surface.definitions.run_repro.execute({});

  await surface.definitions.submit_report.execute({});

  const event = events.find(({ type }) => type === "staged");
  assert.equal(event.detail.artifactDraft.repro, "verified repro");
  assert.equal(event.detail.artifactDraft.reproSha256, surface.gate.getState().draftSha);
  assert.equal(event.detail.artifactDraft.runs[0].bundleSha256, target.badSha256);
  assert.equal(stages.length, 1);
  assert.equal(stages[0], event.detail.artifactDraft);
});
