import assert from "node:assert/strict";
import test from "node:test";
import { judge, judgePair } from "../src/sandbox/differential.js";

const cases = [
  ["pass", "pass", false, "PASS_BOTH"],
  ["pass", "fail", false, "INVERTED"],
  ["pass", "error", false, "GOOD_ERROR"],
  ["pass", "timeout", false, "GOOD_TIMEOUT"],
  ["fail", "pass", true, "STABLE_LOCAL_DIFFERENTIAL"],
  ["fail", "fail", false, "FAIL_BOTH"],
  ["fail", "error", false, "GOOD_ERROR"],
  ["fail", "timeout", false, "GOOD_TIMEOUT"],
  ["error", "pass", false, "BAD_ERROR"],
  ["error", "fail", false, "BAD_ERROR"],
  ["error", "error", false, "BAD_ERROR"],
  ["error", "timeout", false, "BAD_ERROR"],
  ["timeout", "pass", false, "BAD_TIMEOUT"],
  ["timeout", "fail", false, "BAD_TIMEOUT"],
  ["timeout", "error", false, "BAD_TIMEOUT"],
  ["timeout", "timeout", false, "BAD_TIMEOUT"],
];

const runs = (verdict, count = 5, logs = []) => (
  Array.from({ length: count }, () => ({ verdict, logs }))
);

test("judgePair classifies all 16 verdict combinations", async t => {
  assert.equal(cases.length, 16);

  for (const [bad, good, green, reason] of cases) {
    await t.test(`${bad}/${good} -> ${reason}`, () => {
      assert.deepEqual(judgePair({ verdict: bad }, { verdict: good }), { green, reason });
    });
  }
});

test("judge rejects mixed bad samples as unstable", () => {
  const bad = [...runs("fail", 3), ...runs("pass", 2)];
  assert.deepEqual(judge(bad, runs("pass")), { green: false, reason: "UNSTABLE" });
});

test("judge accepts five matching failures against five passes", () => {
  assert.deepEqual(judge(runs("fail"), runs("pass")), {
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
  });
});

test("judge rejects mixed good samples as unstable", () => {
  const good = [...runs("pass", 4), ...runs("fail", 1)];
  assert.deepEqual(judge(runs("fail"), good), { green: false, reason: "UNSTABLE" });
});

test("judge separates execution failures from instability", () => {
  const bad = [...runs("fail", 4), ...runs("timeout", 1)];
  assert.deepEqual(judge(bad, runs("pass")), { green: false, reason: "EXECUTION_ERROR" });
});

test("judge requires one normalized bad failure fingerprint", () => {
  const matching = [
    { verdict: "fail", logs: ["ReproAssertionError: same failure\n at first"] },
    { verdict: "fail", logs: [" ReproAssertionError:  same failure \n at second"] },
  ];
  const changed = [
    ...matching,
    { verdict: "fail", logs: ["ReproAssertionError: different failure\n at third"] },
  ];

  assert.deepEqual(judge(matching, runs("pass", 2)), {
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
  });
  assert.deepEqual(judge(changed, runs("pass", 3)), { green: false, reason: "UNSTABLE" });
});
