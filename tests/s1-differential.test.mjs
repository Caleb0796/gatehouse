import assert from "node:assert/strict";
import test from "node:test";
import { judge } from "../src/sandbox/differential.js";

const cases = [
  ["pass", "pass", false, "PASS_BOTH"],
  ["pass", "fail", false, "INVERTED"],
  ["pass", "error", false, "GOOD_ERROR"],
  ["pass", "timeout", false, "GOOD_TIMEOUT"],
  ["fail", "pass", true, "REGRESSION_DEMONSTRATED"],
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

test("judge classifies all 16 verdict combinations", async t => {
  assert.equal(cases.length, 16);

  for (const [bad, good, green, reason] of cases) {
    await t.test(`${bad}/${good} -> ${reason}`, () => {
      assert.deepEqual(judge({ verdict: bad }, { verdict: good }), { green, reason });
    });
  }
});
