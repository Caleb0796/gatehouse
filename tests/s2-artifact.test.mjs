import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactDraft } from "../src/surface/artifact.js";
import { createGate } from "../src/surface/gate.js";
import { initSigning, signArtifact } from "../src/surface/sign.js";

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
const samples = {
  bad: Array.from({ length: 5 }, (_, index) => ({
    verdict: "fail",
    logs: [
      `bad ${index} ${"x".repeat(250)}`,
      "two",
      "three",
      "four",
      "five",
      "discarded",
    ],
    durationMs: 12 + index,
    bundleSha256: target.badSha256,
  })),
  good: Array.from({ length: 5 }, (_, index) => ({
    verdict: "pass",
    logs: [],
    durationMs: 10 + index,
    bundleSha256: target.goodSha256,
  })),
};

function recordingBus() {
  const events = [];
  const listeners = new Map();
  return {
    events,
    emit(type, detail) {
      events.push({ type, detail });
      for (const listener of listeners.get(type) || []) listener(detail);
    },
    on(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
      return () => entries.splice(entries.indexOf(listener), 1);
    },
  };
}

function buttonStub() {
  const listeners = new Map();
  return {
    disabled: false,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    click() {
      return listeners.get("click")();
    },
  };
}

const storeSuccessfully = async () => ({ ok: true });

async function staged() {
  const gate = createGate();
  const state = await gate.setDraft("assert(add(2, 2) === 4)");
  gate.onVerdict({
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
    reproSha256: state.draftSha,
    repeats: 5,
    samples,
  });
  const artifactDraft = createArtifactDraft({
    target,
    gateState: gate.getState(),
    verdict: {
      green: true,
      reason: "STABLE_LOCAL_DIFFERENTIAL",
      stable: true,
      repeats: 5,
      samples,
    },
    timeline: [{ at: "2026-08-29T20:00:00.000Z", event: "staged", detail: "" }],
  });
  return { gate, artifactDraft };
}

test("signed artifacts contain every SubmissionArtifact field", async () => {
  const { gate, artifactDraft } = await staged();
  const eventBus = recordingBus();

  const { artifact } = await signArtifact({
    artifactDraft,
    gateState: gate.getState(),
    eventBus,
    now: () => new Date("2026-08-29T20:01:00.000Z"),
    userAgent: () => "test-agent",
    storeArtifact: storeSuccessfully,
  });

  assert.deepEqual(Object.keys(artifact).sort(), [
    "badSha256",
    "badVersion",
    "goodSha256",
    "goodVersion",
    "green",
    "issueUrl",
    "library",
    "reason",
    "repeats",
    "repro",
    "reproSha256",
    "samples",
    "signedAt",
    "stable",
    "targetId",
    "targetKind",
    "timeline",
    "ua",
    "v",
  ]);
  assert.equal(artifact.v, 2);
  assert.equal(artifact.reason, "STABLE_LOCAL_DIFFERENTIAL");
  assert.equal(artifact.repeats, 5);
  assert.equal(artifact.stable, true);
  assert.equal(artifact.targetKind, "seed");
  assert.equal(artifact.issueUrl, null);
  assert.equal(artifact.signedAt, "2026-08-29T20:01:00.000Z");
  assert.equal(artifact.ua, "test-agent");
  assert.deepEqual(eventBus.events.at(-1), { type: "signed", detail: { artifact } });
});

test("artifact repro and all pinned hashes match the staged evidence", async () => {
  const { gate, artifactDraft } = await staged();
  const { artifact } = await signArtifact({
    artifactDraft,
    gateState: gate.getState(),
    eventBus: recordingBus(),
    now: () => new Date("2026-08-29T20:01:00.000Z"),
    userAgent: () => "test-agent",
    storeArtifact: storeSuccessfully,
  });

  assert.equal(artifact.reproSha256, gate.getState().draftSha);
  assert.equal(artifact.badSha256, artifact.samples.bad[0].bundleSha256);
  assert.equal(artifact.goodSha256, artifact.samples.good[0].bundleSha256);
});

test("artifact creation rejects any sample whose bundle hash drifts", async () => {
  const gate = createGate();
  const state = await gate.setDraft("assert(add(2, 2) === 4)");
  const drifted = structuredClone(samples);
  drifted.bad[4].bundleSha256 = target.goodSha256;

  assert.throws(
    () => createArtifactDraft({
      target,
      gateState: state,
      verdict: {
        green: true,
        reason: "STABLE_LOCAL_DIFFERENTIAL",
        stable: true,
        repeats: 5,
        samples: drifted,
      },
      timeline: [],
    }),
    /bad sample bundle SHA-256 does not match/,
  );
});

test("signing rechecks every sample hash before storage", async () => {
  const { gate, artifactDraft } = await staged();
  const eventBus = recordingBus();
  let storeCalls = 0;
  artifactDraft.samples.good[2].bundleSha256 = target.badSha256;

  await assert.rejects(
    () => signArtifact({
      artifactDraft,
      gateState: gate.getState(),
      eventBus,
      now: () => new Date("2026-08-29T20:01:00.000Z"),
      userAgent: () => "test-agent",
      storeArtifact: async () => {
        storeCalls += 1;
        return { ok: true };
      },
    }),
    /good sample bundle SHA-256 does not match/,
  );
  assert.equal(storeCalls, 0);
  assert.equal(eventBus.events.some(({ type }) => type === "signed"), false);
});

test("artifact keeps every sample and clamps each sample's logs", async () => {
  const { artifactDraft } = await staged();

  assert.equal(artifactDraft.samples.bad.length, 5);
  assert.equal(artifactDraft.samples.good.length, 5);
  assert.equal(artifactDraft.samples.bad[0].logs.length, 5);
  assert.equal(artifactDraft.samples.bad[0].logs[0].length, 200);
  assert.equal(samples.bad[0].logs.length, 6);
  assert.ok(new TextEncoder().encode(JSON.stringify(artifactDraft)).byteLength <= 32 * 1024);
});

test("artifact rejects serialized evidence above 32KB", async () => {
  const gate = createGate();
  const state = await gate.setDraft("assert(add(2, 2) === 4)");

  assert.throws(
    () => createArtifactDraft({
      target,
      gateState: state,
      verdict: {
        green: true,
        reason: "STABLE_LOCAL_DIFFERENTIAL",
        stable: true,
        repeats: 5,
        samples,
      },
      timeline: [{ at: "2026-08-29T20:00:00.000Z", event: "run", detail: "é".repeat(17_000) }],
    }),
    /32KB size limit/,
  );
});

test("signing cannot push the final artifact above 32KB", async () => {
  const { gate, artifactDraft } = await staged();
  const eventBus = recordingBus();

  await assert.rejects(
    () => signArtifact({
      artifactDraft,
      gateState: gate.getState(),
      eventBus,
      now: () => new Date("2026-08-29T20:01:00.000Z"),
      userAgent: () => "é".repeat(17_000),
      storeArtifact: storeSuccessfully,
    }),
    /32KB size limit/,
  );
  assert.equal(eventBus.events.some(({ type }) => type === "signed"), false);
});

test("editing after staging makes the click-time SHA check refuse signing", async () => {
  const { gate, artifactDraft } = await staged();
  await gate.setDraft("assert(add(3, 3) === 6)");
  const eventBus = recordingBus();

  const result = await signArtifact({
    artifactDraft,
    gateState: gate.getState(),
    eventBus,
    now: () => new Date("2026-08-29T20:02:00.000Z"),
    userAgent: () => "test-agent",
  });

  assert.equal(result.code, "STALE_REPRO");
  assert.equal(eventBus.events.some(({ type }) => type === "signed"), false);
  assert.deepEqual(eventBus.events, [{
    type: "surface",
    detail: {
      change: "revoked",
      tool: "submit_report",
      reason: "repro edited",
      at: new Date("2026-08-29T20:02:00.000Z").getTime(),
    },
  }]);
});

test("signing waits for inbox confirmation before showing success", async () => {
  const { gate, artifactDraft } = await staged();
  const eventBus = recordingBus();
  const button = buttonStub();
  const status = { textContent: "" };
  let confirmStore;
  const storeArtifact = () => new Promise(resolve => {
    confirmStore = resolve;
  });
  const dispose = initSigning({
    button,
    status,
    getGateState: gate.getState,
    eventBus,
    now: () => new Date("2026-08-29T20:03:00.000Z"),
    userAgent: () => "test-agent",
    storeArtifact,
  });
  eventBus.emit("staged", { artifactDraft });

  const signing = button.click();

  assert.equal(button.disabled, true);
  assert.equal(status.textContent, "待人工审阅");
  assert.equal(eventBus.events.some(({ type }) => type === "signed"), false);

  confirmStore({ ok: true });
  await signing;

  assert.equal(status.textContent, "已签名");
  assert.equal(button.disabled, true);
  assert.equal(eventBus.events.filter(({ type }) => type === "signed").length, 1);
  dispose();
});

test("staging shows the exact artifact and evidence before enabling signature", async () => {
  const { gate, artifactDraft } = await staged();
  const eventBus = recordingBus();
  const button = buttonStub();
  const status = { textContent: "" };
  const review = {
    root: { hidden: true },
    repro: { textContent: "" },
    summary: { textContent: "" },
  };
  initSigning({
    button,
    status,
    review,
    getGateState: gate.getState,
    eventBus,
    storeArtifact: storeSuccessfully,
  });

  eventBus.emit("staged", { artifactDraft });

  assert.equal(review.root.hidden, false);
  assert.equal(review.repro.textContent, artifactDraft.repro);
  assert.match(review.summary.textContent, new RegExp(artifactDraft.reproSha256));
  assert.match(review.summary.textContent, /Reported build 1\.1\.0: 5\/5 failed/);
  assert.match(review.summary.textContent, /Reference build 1\.0\.0: 5\/5 passed/);
  assert.equal(status.textContent, "待人工审阅");
  assert.equal(button.disabled, false);
});

test("storage failure keeps the staged artifact available for retry", async () => {
  const { gate, artifactDraft } = await staged();
  const eventBus = recordingBus();
  const button = buttonStub();
  const status = { textContent: "" };
  const storedArtifacts = [];
  let storeResult = { ok: false, error: "QuotaExceededError: quota full" };
  initSigning({
    button,
    status,
    getGateState: gate.getState,
    eventBus,
    now: () => new Date("2026-08-29T20:04:00.000Z"),
    userAgent: () => "test-agent",
    storeArtifact: async artifact => {
      storedArtifacts.push(artifact);
      return storeResult;
    },
  });
  eventBus.emit("staged", { artifactDraft });

  const failed = await button.click();

  assert.equal(failed.code, "ARTIFACT_STORE_FAILED");
  assert.equal(status.textContent, "签名失败：QuotaExceededError: quota full");
  assert.equal(button.disabled, false);
  assert.equal(eventBus.events.some(({ type }) => type === "signed"), false);

  storeResult = { ok: true };
  await button.click();

  assert.equal(status.textContent, "已签名");
  assert.equal(button.disabled, true);
  assert.equal(storedArtifacts.length, 2);
  assert.equal(storedArtifacts[0].reproSha256, artifactDraft.reproSha256);
  assert.equal(storedArtifacts[1].reproSha256, artifactDraft.reproSha256);
  assert.equal(eventBus.events.filter(({ type }) => type === "signed").length, 1);
});
