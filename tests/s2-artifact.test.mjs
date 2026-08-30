import assert from "node:assert/strict";
import test from "node:test";
import { createArtifactDraft } from "../src/surface/artifact.js";
import { createGate } from "../src/surface/gate.js";
import { signArtifact } from "../src/surface/sign.js";

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
  return {
    events,
    emit(type, detail) {
      events.push({ type, detail });
    },
  };
}

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

  const { artifact } = signArtifact({
    artifactDraft,
    gateState: gate.getState(),
    eventBus,
    now: () => new Date("2026-08-29T20:01:00.000Z"),
    userAgent: () => "test-agent",
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
  const { artifact } = signArtifact({
    artifactDraft,
    gateState: gate.getState(),
    eventBus: recordingBus(),
    now: () => new Date("2026-08-29T20:01:00.000Z"),
    userAgent: () => "test-agent",
  });

  assert.equal(artifact.reproSha256, gate.getState().draftSha);
  assert.equal(artifact.badSha256, artifact.samples.bad[0].bundleSha256);
  assert.equal(artifact.goodSha256, artifact.samples.good[0].bundleSha256);
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

  assert.throws(
    () => signArtifact({
      artifactDraft,
      gateState: gate.getState(),
      eventBus,
      now: () => new Date("2026-08-29T20:01:00.000Z"),
      userAgent: () => "é".repeat(17_000),
    }),
    /32KB size limit/,
  );
  assert.equal(eventBus.events.some(({ type }) => type === "signed"), false);
});

test("editing after staging makes the click-time SHA check refuse signing", async () => {
  const { gate, artifactDraft } = await staged();
  await gate.setDraft("assert(add(3, 3) === 6)");
  const eventBus = recordingBus();

  const result = signArtifact({
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
