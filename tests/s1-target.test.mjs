import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const sha256 = text => createHash("sha256").update(text).digest("hex");

test("qs target matches the frozen TargetSpec contract", async () => {
  const manifest = JSON.parse(await read("../targets/qs-500/manifest.json"));

  assert.deepEqual(Object.keys(manifest), [
    "id",
    "library",
    "kind",
    "badVersion",
    "goodVersion",
    "badSha256",
    "goodSha256",
    "globalName",
    "issueUrl",
    "licenseFile",
    "summary",
    "demoRepros",
  ]);
  assert.deepEqual({
    id: manifest.id,
    library: manifest.library,
    kind: manifest.kind,
    badVersion: manifest.badVersion,
    goodVersion: manifest.goodVersion,
    globalName: manifest.globalName,
    issueUrl: manifest.issueUrl,
    licenseFile: manifest.licenseFile,
  }, {
    id: "qs-500",
    library: "qs",
    kind: "real",
    badVersion: "6.12.0",
    goodVersion: "6.12.1",
    globalName: "Qs",
    issueUrl: "https://github.com/ljharb/qs/issues/500",
    licenseFile: "LICENSE.qs.txt",
  });
  assert.ok(manifest.summary.length <= 200);
  assert.deepEqual(Object.keys(manifest.demoRepros), ["broken", "weak", "real"]);
  for (const repro of Object.values(manifest.demoRepros)) {
    assert.equal(typeof repro, "string");
    assert.ok(new TextEncoder().encode(repro).length <= 8 * 1024);
  }
});

test("qs target bundles are pinned, bounded, and licensed", async () => {
  const [manifestText, bad, good, license] = await Promise.all([
    read("../targets/qs-500/manifest.json"),
    read("../targets/qs-500/bad.js"),
    read("../targets/qs-500/good.js"),
    read("../targets/qs-500/LICENSE.qs.txt"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(sha256(bad), manifest.badSha256);
  assert.equal(sha256(good), manifest.goodSha256);
  assert.ok(Buffer.byteLength(bad) < 300_000);
  assert.ok(Buffer.byteLength(good) < 300_000);
  assert.match(bad, /var g;if\(typeof window/);
  assert.match(good, /var g;if\(typeof window/);
  assert.match(license, /^BSD 3-Clause License/);
  assert.match(license, /Copyright \(c\) 2014, Nathan LaFreniere/);
});

test("target browser acceptance page keeps its script external", async () => {
  const page = await read("s1-target-browser.html");
  assert.match(page, /<script type="module" src="\/tests\/s1-target-browser\.js"><\/script>/);
  assert.doesNotMatch(page, /<script(?:\s[^>]*)?>\s*[^<\s]/);
});
