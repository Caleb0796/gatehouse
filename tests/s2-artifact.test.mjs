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
const runs = [
  {
    version: "bad",
    verdict: "fail",
    logs: ["ReproAssertionError: regression"],
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
];

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
    reproSha256: state.draftSha,
    runs,
  });
  const artifactDraft = createArtifactDraft({
    target,
    gateState: gate.getState(),
    verdict: { runs },
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
    "issueUrl",
    "library",
    "repro",
    "reproSha256",
    "runs",
    "signedAt",
    "targetId",
    "targetKind",
    "timeline",
    "ua",
    "v",
  ]);
  assert.equal(artifact.v, 1);
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
  assert.equal(artifact.badSha256, artifact.runs[0].bundleSha256);
  assert.equal(artifact.goodSha256, artifact.runs[1].bundleSha256);
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
