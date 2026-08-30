import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const matrix = [
  {
    id: "RT-01",
    file: "../tests/s1-stability.test.mjs",
    patterns: [/Math\.random/, /reopenedAfterTaint/, /gate\.tainted, true/],
  },
  {
    id: "RT-02",
    file: "../tests/s4-banner.test.mjs",
    patterns: [/dynamicPart/, /CHROME_COMMAND\.includes\(dynamicPart\), false/],
  },
  {
    id: "RT-05",
    file: "../tests/s3-adopt.test.mjs",
    patterns: [/UNTRUSTED CODE/, /test\\\.skip\\\(/, /adopted\.enabled, false/],
  },
  {
    id: "RT-07",
    file: "../tests/s1-runner.test.mjs",
    patterns: [/Object\.isFrozen\(snapshot\)/, /strictEqual\(await loadTarget/, /requested\.length, 3/],
  },
  {
    id: "RT-08",
    file: "../tests/s3-inbox.test.mjs",
    patterns: [/quotaStorage/, /silentStorage/, /thrown\.ok, false/],
  },
];

test("red-team RT-01/02/05/07/08 regressions remain covered by the acceptance suite", async () => {
  const verified = [];
  for (const entry of matrix) {
    const source = await readFile(new URL(entry.file, import.meta.url), "utf8");
    for (const pattern of entry.patterns) {
      assert.match(source, pattern, `${entry.id} lost ${pattern} in ${entry.file}`);
    }
    verified.push(entry.id);
  }
  assert.deepEqual(verified, ["RT-01", "RT-02", "RT-05", "RT-07", "RT-08"]);
});
