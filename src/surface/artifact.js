const MAX_ARTIFACT_BYTES = 32 * 1024;

function copySample(sample) {
  return {
    verdict: sample.verdict,
    logs: sample.logs.slice(0, 5).map((log) => log.slice(0, 200)),
    durationMs: sample.durationMs,
    bundleSha256: sample.bundleSha256,
  };
}

function copySamples(samples) {
  return {
    bad: samples.bad.map(copySample),
    good: samples.good.map(copySample),
  };
}

export function assertArtifactSize(artifact) {
  if (new TextEncoder().encode(JSON.stringify(artifact)).byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error("Artifact exceeds the 32KB size limit.");
  }
}

export function createArtifactDraft({ target, gateState, verdict, timeline }) {
  const artifact = {
    v: 2,
    targetId: target.id,
    library: target.library,
    badVersion: target.badVersion,
    goodVersion: target.goodVersion,
    badSha256: target.badSha256,
    goodSha256: target.goodSha256,
    repro: gateState.draft,
    reproSha256: gateState.draftSha,
    green: verdict.green,
    reason: verdict.reason,
    stable: verdict.stable,
    repeats: verdict.repeats,
    samples: copySamples(verdict.samples),
    timeline: timeline.map((entry) => ({ ...entry })),
    issueUrl: target.issueUrl,
    targetKind: target.kind,
  };
  assertArtifactSize(artifact);
  return artifact;
}
