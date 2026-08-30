import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function fixture(name) {
  return JSON.parse(await readFile(
    new URL(`../contracts/fixtures/${name}`, import.meta.url),
    "utf8",
  ));
}

test("artifact fixture uses schema v2 with complete repeated samples", async () => {
  const artifact = await fixture("artifact.sample.json");
  assert.equal(artifact.v, 2);
  assert.equal(artifact.green, true);
  assert.equal(artifact.reason, "STABLE_LOCAL_DIFFERENTIAL");
  assert.equal(artifact.stable, true);
  assert.equal(artifact.repeats, 5);
  assert.equal(Object.hasOwn(artifact, "runs"), false);
  assert.equal(artifact.samples.bad.length, artifact.repeats);
  assert.equal(artifact.samples.good.length, artifact.repeats);
  for (const sample of artifact.samples.bad) {
    assert.deepEqual(Object.keys(sample).sort(), ["bundleSha256", "durationMs", "logs", "verdict"]);
    assert.equal(sample.verdict, "fail");
    assert.equal(sample.bundleSha256, artifact.badSha256);
  }
  for (const sample of artifact.samples.good) {
    assert.deepEqual(Object.keys(sample).sort(), ["bundleSha256", "durationMs", "logs", "verdict"]);
    assert.equal(sample.verdict, "pass");
    assert.equal(sample.bundleSha256, artifact.goodSha256);
  }
});

test("differential fixtures keep summaries and add five samples per build", async () => {
  for (const name of [
    "differential-failboth.json",
    "differential-green.json",
    "differential-inverted.json",
  ]) {
    const verdict = await fixture(name);
    assert.equal(verdict.repeats, 5, name);
    assert.equal(verdict.stable, true, name);
    assert.equal(verdict.runs.length, 2, name);
    for (const version of ["bad", "good"]) {
      assert.equal(verdict.samples[version].length, verdict.repeats, `${name} ${version}`);
      assert(verdict.samples[version].every(sample => sample.version === version), `${name} ${version}`);
    }
  }
});
