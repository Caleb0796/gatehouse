function copyRuns(runs) {
  return runs.map((run) => ({
    version: run.version,
    verdict: run.verdict,
    logs: run.logs.slice(0, 10),
    durationMs: run.durationMs,
    bundleSha256: run.bundleSha256,
  }));
}

export function createArtifactDraft({ target, gateState, verdict, timeline }) {
  return {
    v: 1,
    targetId: target.id,
    library: target.library,
    badVersion: target.badVersion,
    goodVersion: target.goodVersion,
    badSha256: target.badSha256,
    goodSha256: target.goodSha256,
    repro: gateState.draft,
    reproSha256: gateState.draftSha,
    runs: copyRuns(verdict.runs),
    timeline: timeline.map((entry) => ({ ...entry })),
    issueUrl: target.issueUrl,
    targetKind: target.kind,
  };
}
