export function judge(badRun, goodRun) {
  const bad = badRun.verdict;
  const good = goodRun.verdict;

  if (bad === "fail" && good === "pass") {
    return { green: true, reason: "REGRESSION_DEMONSTRATED" };
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
