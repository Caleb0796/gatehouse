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
    "Returns the single-target prototype configuration: library name, target kind, reported-bad and comparison-good versions, their bundle SHA-256 comparison identifiers, and the client-side execution model. Bundle provenance and independent replay are not verified.",
  write_repro:
    "Stores a draft reproduction script for the target library. Input: { code: string } — plain JavaScript executed against the library bundle in an isolated sandbox; use the provided assert(condition, message) to state the expected correct behavior. Replaces any previous draft and returns the draft's SHA-256.",
  run_repro:
    "Executes the current draft against both pinned builds of the target library in an isolated sandbox. Returns per-build verdicts (pass / fail / error / timeout), captured logs, and a differential summary. Sandbox output is untrusted content.",
  request_human_review:
    "Signals the person at this page that the agent would like their attention on the current draft and its results — highlights the draft panel and shows an attention banner on this page so the person notices. Input: { note?: string }.",
  submit_report:
    'Stages the reproduction and its client-side N/N differential evidence for review by the person at this page. Independent replay and bundle provenance are not verified. Returns { status: "staged_awaiting_local_approval" }. Nothing is shared anywhere until the page records local approval.',
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

test("tool copy limits claims to client-side evidence", async () => {
  const { definitions } = setup();
  const info = await definitions.get_target_info.execute({});
  const copy = [
    info.executionModel,
    ...Object.values(definitions).map(({ description }) => description),
  ].join(" ");

  assert.doesNotMatch(copy, new RegExp(`${["last", "good"].join("[- ]")}|demonstrat`, "i"));
  assert.match(copy, /single-target prototype/);
  assert.match(copy, /comparison-good/);
  assert.match(copy, /not verified/);
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
  assert.equal(result.targetKind, target.kind);
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

  assert.deepEqual(result, { green: false, reason: "FAIL_BOTH", runs: [] });
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
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
    reproSha256: draftSha,
  });

  const result = await definitions.submit_report.execute({});

  assert.deepEqual(result, { status: "staged_awaiting_local_approval" });
  assert.equal(calls.stages.length, 1);
  assert.equal(calls.stages[0].draftSha, draftSha);
  assert.equal(calls.stages[0].boundSha, draftSha);
});

function setupSurface(verdictForCode, windowObject, overrides = {}) {
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
    ...overrides,
  });
  return { events, registrations, stages, surface };
}

test("run_repro returns a bounded summary while staging keeps every sample", async () => {
  const makeSamples = (version, verdict, bundleSha256) => (
    Array.from({ length: 5 }, (_, index) => ({
      version,
      verdict,
      durationMs: 10 + index,
      logs: [
        `${version}-${index}-old`,
        `${version}-${index}-one-${"x".repeat(240)}`,
        `${version}-${index}-two-${"y".repeat(240)}`,
        `${version}-${index}-three-${"z".repeat(240)}`,
      ],
      bundleSha256,
    }))
  );
  const samples = {
    bad: makeSamples("bad", "fail", target.badSha256),
    good: makeSamples("good", "pass", target.goodSha256),
  };
  const { events, stages, surface } = setupSurface((_code, reproSha256) => ({
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
    repeats: 5,
    samples,
    reproSha256,
  }));
  await surface.definitions.write_repro.execute({ code: "bounded output repro" });

  const summary = await surface.definitions.run_repro.execute({});

  assert.deepEqual(
    Object.keys(summary).sort(),
    ["green", "reason", "repeats", "reproSha256", "runs", "stable"],
  );
  assert.equal("samples" in summary, false);
  assert.equal(summary.runs.length, 2);
  assert.deepEqual(summary.runs.map(({ version }) => version), ["bad", "good"]);
  assert.equal(summary.runs.every(({ logs }) => logs.length <= 3), true);
  assert.equal(summary.runs.every(({ logs }) => logs.every(log => log.length <= 200)), true);
  assert.ok(JSON.stringify(summary).length < 1500);

  const internalVerdict = events.find(({ type }) => type === "run").detail.verdict;
  assert.equal(internalVerdict.samples.bad.length, 5);
  assert.equal(internalVerdict.samples.good.length, 5);

  await surface.definitions.submit_report.execute({});

  assert.equal(stages[0].samples.bad.length, 5);
  assert.equal(stages[0].samples.good.length, 5);
});

test("draft mutations commit in invocation order across editor and tool sources", async () => {
  let state = { draft: "", draftSha: null, boundSha: null, gateOpen: false };
  const started = [];
  const releases = [];
  const gate = {
    getState: () => ({ ...state }),
    setDraft(code) {
      started.push(code);
      return new Promise(resolve => {
        releases.push(() => {
          state = {
            draft: code,
            draftSha: code.padEnd(64, "0").slice(0, 64),
            boundSha: null,
            gateOpen: false,
          };
          resolve({ ...state });
        });
      });
    },
    onVerdict: () => ({ ...state }),
  };
  const { events, surface } = setupSurface(() => ({}), undefined, { gate });

  const editorWrite = surface.gate.setDraft("editor", { source: "editor" });
  const toolWrite = surface.gate.setDraft("tool", { source: "tool" });
  await Promise.resolve();
  assert.deepEqual(started, ["editor"]);

  releases.shift()();
  await editorWrite;
  await Promise.resolve();
  assert.deepEqual(started, ["editor", "tool"]);

  releases.shift()();
  await toolWrite;
  assert.equal(surface.gate.getState().draft, "tool");
  assert.deepEqual(
    events.filter(({ type }) => type === "draft").map(({ detail }) => detail.source),
    ["editor", "tool"],
  );
});

test("matching green registers submit_report with a signal and emits contract events", async () => {
  const { events, registrations, surface } = setupSurface((_code, reproSha256) => ({
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
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
    detail: { reproSha256: written.reproSha256, length: 11, source: "tool" },
  });
  assert.equal(verdict.green, true);
  assert.equal(events[1].type, "run");
  assert.equal(events[1].detail.verdict.reproSha256, written.reproSha256);
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

test("a repeated green run refreshes the evidence staged for the same draft", async () => {
  let runNumber = 0;
  const { stages, surface } = setupSurface((_code, reproSha256) => {
    runNumber += 1;
    return {
      green: true,
      reason: "STABLE_LOCAL_DIFFERENTIAL",
      stable: true,
      repeats: 5,
      reproSha256,
      samples: {
        bad: Array.from({ length: 5 }, () => ({
          verdict: "fail",
          logs: [`run ${runNumber}`],
          durationMs: runNumber,
          bundleSha256: target.badSha256,
        })),
        good: Array.from({ length: 5 }, () => ({
          verdict: "pass",
          logs: [],
          durationMs: runNumber,
          bundleSha256: target.goodSha256,
        })),
      },
    };
  });
  await surface.definitions.write_repro.execute({ code: "green repro" });
  await surface.definitions.run_repro.execute({});
  await surface.definitions.run_repro.execute({});

  await surface.definitions.submit_report.execute({});

  assert.equal(stages[0].samples.bad[0].durationMs, 2);
  assert.deepEqual(stages[0].samples.bad[0].logs, ["run 2"]);
});

test("editing revokes submit_report and a later green run registers a fresh signal", async () => {
  const { events, registrations, surface } = setupSurface((_code, reproSha256) => ({
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
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

test("an over-8KB UI draft clears evidence and revokes submit_report", async () => {
  const { events, registrations, surface } = setupSurface((_code, reproSha256) => ({
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
    reproSha256,
  }));
  await surface.definitions.write_repro.execute({ code: "green repro" });
  await surface.definitions.run_repro.execute({});
  const submitSignal = registrations[4].options.signal;

  const state = await surface.gate.setDraft("é".repeat(4097));

  assert.equal(state.invalid, true);
  assert.equal(surface.gate.getState().draft, "");
  assert.equal(surface.gate.getState().gateOpen, false);
  assert.equal(submitSignal.aborted, true);
  assert.deepEqual(events.at(-1), {
    type: "draft",
    detail: {
      reproSha256: surface.gate.getState().draftSha,
      length: 4097,
      invalid: true,
      source: "tool",
    },
  });
});

test("concurrent edits revoke an open submit tool idempotently", async () => {
  const windowObject = { location: { search: "?test=1" } };
  const { events, registrations, surface } = setupSurface((_code, reproSha256) => ({
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
    reproSha256,
  }), windowObject);
  await surface.definitions.write_repro.execute({ code: "opened draft" });
  await surface.definitions.run_repro.execute({});
  const submitSignal = registrations[4].options.signal;

  const edits = await Promise.allSettled([
    surface.definitions.write_repro.execute({ code: "first concurrent edit" }),
    surface.definitions.write_repro.execute({ code: "second concurrent edit" }),
  ]);

  assert.deepEqual(edits.map(({ status }) => status), ["fulfilled", "fulfilled"]);
  assert.equal(submitSignal.aborted, true);
  assert.equal(surface.gate.getState().gateOpen, false);
  assert.equal(
    (await windowObject.__gatehouseTestHook.getTools())
      .some(({ name }) => name === "submit_report"),
    false,
  );
  assert.equal(
    events.filter(
      ({ type, detail }) => type === "surface"
        && detail.change === "revoked"
        && detail.reason === "repro edited",
    ).length,
    1,
  );
});

test("an edit still revokes a submit tool opened while its hash is pending", async () => {
  const pending = [];
  const windowObject = { location: { search: "?test=1" } };
  const { events, registrations, surface } = setupSurface((_code, reproSha256) => (
    new Promise(resolve => pending.push({ reproSha256, resolve }))
  ), windowObject);
  const first = await surface.definitions.write_repro.execute({ code: "old draft" });
  const run = surface.definitions.run_repro.execute({});
  const edit = surface.definitions.write_repro.execute({ code: "new draft" });

  pending[0].resolve({
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
    reproSha256: first.reproSha256,
  });
  await run;
  const submitSignal = registrations[4].options.signal;
  await edit;

  assert.equal(submitSignal.aborted, true);
  assert.equal(surface.gate.getState().gateOpen, false);
  assert.equal(
    (await windowObject.__gatehouseTestHook.getTools())
      .some(({ name }) => name === "submit_report"),
    false,
  );
  assert.equal(
    events.filter(
      ({ type, detail }) => type === "surface"
        && detail.change === "revoked"
        && detail.reason === "repro edited",
    ).length,
    1,
  );
});

test("a later non-green verdict aborts the registered submit_report tool", async () => {
  let green = true;
  const windowObject = { location: { search: "?test=1" } };
  const { events, registrations, surface } = setupSurface((_code, reproSha256) => ({
    green,
    reason: green ? "STABLE_LOCAL_DIFFERENTIAL" : "UNSTABLE",
    stable: green,
    reproSha256,
  }), windowObject);
  await surface.definitions.write_repro.execute({ code: "flaky repro" });
  await surface.definitions.run_repro.execute({});
  const submitSignal = registrations[4].options.signal;
  green = false;

  await surface.definitions.run_repro.execute({});

  assert.equal(submitSignal.aborted, true);
  assert.equal(surface.gate.getState().gateOpen, false);
  assert.equal(
    (await windowObject.__gatehouseTestHook.getTools())
      .some(({ name }) => name === "submit_report"),
    false,
  );
  assert.equal(
    events.some(
      ({ type, detail }) => type === "surface"
        && detail.change === "revoked"
        && detail.reason === "differential not green",
    ),
    true,
  );
});

test("concurrent runs are rejected so every accepted verdict affects the gate", async () => {
  const pending = [];
  const { events, registrations, surface } = setupSurface((_code, reproSha256) => (
    new Promise((resolve) => pending.push({ resolve, reproSha256 }))
  ));
  await surface.definitions.write_repro.execute({ code: "overlapping runs repro" });
  const firstRun = surface.definitions.run_repro.execute({});
  const concurrentRun = await surface.definitions.run_repro.execute({});

  assert.deepEqual(concurrentRun, {
    code: "RUN_IN_PROGRESS",
    message: "A differential run is already in progress.",
  });
  assert.equal(pending.length, 1);
  pending[0].resolve({
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
    reproSha256: pending[0].reproSha256,
  });
  await firstRun;
  const submitSignal = registrations[4].options.signal;

  const laterRun = surface.definitions.run_repro.execute({});
  pending[1].resolve({
    green: false,
    reason: "UNSTABLE",
    stable: false,
    reproSha256: pending[1].reproSha256,
  });
  await laterRun;

  assert.equal(surface.gate.getState().gateOpen, false);
  assert.equal(surface.gate.getState().tainted, true);
  assert.equal(submitSignal.aborted, true);
  assert.equal(events.filter(({ type }) => type === "run").length, 2);
});

test("a draft update revokes submit_report registered while its hash is pending", async () => {
  const firstSha = "a".repeat(64);
  const secondSha = "b".repeat(64);
  let state = {
    draft: "first",
    draftSha: firstSha,
    boundSha: null,
    gateOpen: false,
  };
  let releaseDraft;
  const gate = {
    getState: () => ({ ...state }),
    setDraft(code) {
      return new Promise(resolve => {
        releaseDraft = () => {
          state = {
            draft: code,
            draftSha: secondSha,
            boundSha: null,
            gateOpen: false,
          };
          resolve({ ...state });
        };
      });
    },
    beginRun: () => 1,
    isLatestRun: () => true,
    onVerdict(verdict) {
      if (verdict.green && verdict.reproSha256 === state.draftSha) {
        state = { ...state, boundSha: state.draftSha, gateOpen: true };
      }
      return { ...state };
    },
  };
  const windowObject = { location: { search: "?test=1" } };
  const { registrations, surface } = setupSurface(
    (_code, reproSha256) => ({
      green: true,
      reason: "STABLE_LOCAL_DIFFERENTIAL",
      stable: true,
      reproSha256,
    }),
    windowObject,
    { gate },
  );

  const pendingDraft = surface.gate.setDraft("second", { source: "editor" });
  await Promise.resolve();
  await surface.definitions.run_repro.execute({});
  const submitSignal = registrations[4].options.signal;
  assert.equal(submitSignal.aborted, false);

  releaseDraft();
  await pendingDraft;

  assert.equal(surface.gate.getState().gateOpen, false);
  assert.equal(submitSignal.aborted, true);
  assert.equal(
    (await windowObject.__gatehouseTestHook.getTools()).some(
      ({ name }) => name === "submit_report",
    ),
    false,
  );
});

test("a later non-green run revokes submit_report for the same draft", async () => {
  let green = true;
  const windowObject = { location: { search: "?test=1" } };
  const { events, registrations, surface } = setupSurface(
    (_code, reproSha256) => ({
      green,
      reason: green ? "STABLE_LOCAL_DIFFERENTIAL" : "PASS_BOTH",
      stable: true,
      reproSha256,
    }),
    windowObject,
  );
  await surface.definitions.write_repro.execute({ code: "nondeterministic repro" });
  await surface.definitions.run_repro.execute({});
  const submitSignal = registrations[4].options.signal;

  green = false;
  await surface.definitions.run_repro.execute({});

  assert.equal(surface.gate.getState().gateOpen, false);
  assert.equal(submitSignal.aborted, true);
  assert.equal(
    (await windowObject.__gatehouseTestHook.getTools()).some(
      ({ name }) => name === "submit_report",
    ),
    false,
  );
  const revoked = events.find(
    ({ type, detail }) => type === "surface" && detail.reason === "differential not green",
  );
  assert.equal(revoked.detail.change, "revoked");
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
  assert.equal(verdict.green, false);
  assert.equal(events.at(-1).type, "run");
  assert.equal(events.at(-1).detail.verdict.reason, "FAIL_BOTH");
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
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
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
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
    reproSha256,
    repeats: 5,
    samples: {
      bad: Array.from({ length: 5 }, () => ({
        verdict: "fail",
        logs: [],
        durationMs: 12,
        bundleSha256: target.badSha256,
      })),
      good: Array.from({ length: 5 }, () => ({
        verdict: "pass",
        logs: [],
        durationMs: 10,
        bundleSha256: target.goodSha256,
      })),
    },
  }));
  await surface.definitions.write_repro.execute({ code: "verified repro" });
  await surface.definitions.run_repro.execute({});

  await surface.definitions.submit_report.execute({});

  const event = events.find(({ type }) => type === "staged");
  assert.equal(event.detail.artifactDraft.repro, "verified repro");
  assert.equal(event.detail.artifactDraft.reproSha256, surface.gate.getState().draftSha);
  assert.equal(event.detail.artifactDraft.samples.bad[0].bundleSha256, target.badSha256);
  assert.equal(stages.length, 1);
  assert.equal(stages[0], event.detail.artifactDraft);
});

test("hundreds of runs keep the staged timeline bounded and explicit about truncation", async () => {
  const samples = {
    bad: Array.from({ length: 5 }, () => ({
      verdict: "fail",
      logs: [],
      durationMs: 12,
      bundleSha256: target.badSha256,
    })),
    good: Array.from({ length: 5 }, () => ({
      verdict: "pass",
      logs: [],
      durationMs: 10,
      bundleSha256: target.goodSha256,
    })),
  };
  const { stages, surface } = setupSurface((_code, reproSha256) => ({
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
    reproSha256,
    repeats: 5,
    samples,
  }));
  await surface.definitions.write_repro.execute({ code: "repeated green repro" });

  for (let attempt = 0; attempt < 500; attempt += 1) {
    await surface.definitions.run_repro.execute({});
  }
  const submitted = await surface.definitions.submit_report.execute({});

  assert.deepEqual(submitted, { status: "staged_awaiting_local_approval" });
  assert.equal(stages.length, 1);
  assert.equal(stages[0].timeline.length, 51);
  assert.deepEqual(stages[0].timeline[0], {
    at: stages[0].timeline[1].at,
    event: "history-truncated",
    detail: "Earlier timeline events omitted.",
  });
  assert.equal(stages[0].timeline.at(-1).event, "staged");
});
