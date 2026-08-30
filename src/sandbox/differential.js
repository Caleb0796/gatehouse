const executionFailed = run => run.verdict === "error" || run.verdict === "timeout";

const normalizedFailureFingerprint = run => {
  const failure = Array.isArray(run.logs) ? run.logs.at(-1) : "";
  return String(failure ?? "")
    .split(/\r?\n/, 1)[0]
    .trim()
    .replace(/\s+/g, " ");
};

export function judgePair(badRun, goodRun) {
  const bad = badRun.verdict;
  const good = goodRun.verdict;

  if (bad === "fail" && good === "pass") {
    return { green: true, reason: "STABLE_LOCAL_DIFFERENTIAL" };
  }
  if (bad === "timeout") {
    return { green: false, reason: "BAD_TIMEOUT" };
  }
  if (bad === "error") {
    return { green: false, reason: "BAD_ERROR" };
  }
  if (good === "timeout") {
    return { green: false, reason: "GOOD_TIMEOUT" };
  }
  if (good === "error") {
    return { green: false, reason: "GOOD_ERROR" };
  }
  if (bad === "pass" && good === "fail") {
    return { green: false, reason: "INVERTED" };
  }
  if (bad === "fail" && good === "fail") {
    return { green: false, reason: "FAIL_BOTH" };
  }
  return { green: false, reason: "PASS_BOTH" };
}

export function judge(badRuns, goodRuns) {
  if (
    !Array.isArray(badRuns) ||
    !Array.isArray(goodRuns) ||
    badRuns.length === 0 ||
    badRuns.length !== goodRuns.length
  ) {
    throw new TypeError("Differential samples must be non-empty arrays of equal length");
  }

  const samples = [...badRuns, ...goodRuns];
  if (samples.some(executionFailed)) {
    return { green: false, reason: "EXECUTION_ERROR" };
  }

  const badVerdicts = new Set(badRuns.map(run => run.verdict));
  const goodVerdicts = new Set(goodRuns.map(run => run.verdict));
  if (badVerdicts.size !== 1 || goodVerdicts.size !== 1) {
    return { green: false, reason: "UNSTABLE" };
  }

  if (
    badRuns[0].verdict === "fail" &&
    new Set(badRuns.map(normalizedFailureFingerprint)).size !== 1
  ) {
    return { green: false, reason: "UNSTABLE" };
  }

  return judgePair(badRuns[0], goodRuns[0]);
}
