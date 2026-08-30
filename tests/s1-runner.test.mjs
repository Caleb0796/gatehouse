import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTarget } from "../src/sandbox/runner.js";
import { createRunnerSrcdoc } from "../src/sandbox/srcdoc.js";

const sha256 = text => createHash("sha256").update(text).digest("hex");
const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("srcdoc contains only the external runner script", () => {
  const srcdoc = createRunnerSrcdoc();
  assert.equal(srcdoc, '<!doctype html><script src="/src/sandbox/runner-inner.js"></script>');
  assert.doesNotMatch(srcdoc, /allow-same-origin/);
  assert.doesNotMatch(srcdoc, /<script(?:\s[^>]*)?>\s*[^<\s]/);
});

test("loadTarget fetches local bundles and verifies both hashes", async () => {
  let badText = "self.demo = { version: 'bad' };";
  let goodText = "self.demo = { version: 'good' };";
  let manifest = {
    id: "demo-1",
    badSha256: sha256(badText),
    goodSha256: sha256(goodText),
    nested: { version: "initial" },
  };
  const requested = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    requested.push(url);
    if (url.endsWith("manifest.json")) {
      return { ok: true, status: 200, json: async () => manifest };
    }
    const text = url.endsWith("bad.js") ? badText : goodText;
    return { ok: true, status: 200, text: async () => text };
  };

  try {
    const snapshot = await loadTarget("demo-1");
    assert.deepEqual(snapshot, {
      manifest,
      bundles: {
        bad: { sha256: manifest.badSha256, text: badText },
        good: { sha256: manifest.goodSha256, text: goodText },
      },
    });
    assert.deepEqual(requested, [
      "/targets/demo-1/manifest.json",
      "/targets/demo-1/bad.js",
      "/targets/demo-1/good.js",
    ]);
    assert.ok(Object.isFrozen(snapshot));
    assert.ok(Object.isFrozen(snapshot.manifest));
    assert.ok(Object.isFrozen(snapshot.manifest.nested));
    assert.ok(Object.isFrozen(snapshot.bundles.bad));

    badText = "self.demo = { version: 'changed-bad' };";
    goodText = "self.demo = { version: 'changed-good' };";
    manifest = {
      id: "demo-1",
      badSha256: sha256(badText),
      goodSha256: sha256(goodText),
      nested: { version: "changed" },
    };
    assert.strictEqual(await loadTarget("demo-1"), snapshot);
    assert.equal(requested.length, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("loadTarget rejects a hash mismatch and unsafe target ids", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url.endsWith("manifest.json")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ badSha256: "0".repeat(64), goodSha256: sha256("good") }),
      };
    }
    return { ok: true, status: 200, text: async () => url.endsWith("bad.js") ? "bad" : "good" };
  };

  try {
    await assert.rejects(loadTarget("demo-mismatch"), /bad bundle SHA-256 mismatch/);
    await assert.rejects(loadTarget("../escape"), /Invalid target id/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parent runner enforces iframe channel and watchdog invariants", async () => {
  const parent = await read("../src/sandbox/runner.js");
  assert.match(parent, /iframe\.sandbox = "allow-scripts"/);
  assert.doesNotMatch(parent, /allow-same-origin/);
  assert.match(parent, /event\.source !== iframe\.contentWindow/);
  assert.match(parent, /if \(!ready \|\| event\.data\.t !== "result"/);
  assert.match(parent, /pending\.has\(runId\)/);
  assert.match(parent, /const WATCHDOG_MS = 30_000/);
  assert.match(parent, /rebuildAfterWatchdog/);
  assert.doesNotMatch(parent, /runId, \.\.\.input/);
});

test("inner runner validates worker messages and bounds captured logs", async () => {
  const inner = await read("../src/sandbox/runner-inner.js");
  assert.match(inner, /new Worker\(url\)/);
  assert.match(inner, /self\.postMessage = undefined/);
  assert.match(inner, /message\.__gh !== 1/);
  assert.match(inner, /worker\.terminate\(\)/);
  assert.match(inner, /logs\.slice\(0, 100\)/);
  assert.match(inner, /slice\(0, 500\)/);
});

test("browser acceptance page keeps its script external", async () => {
  const page = await read("s1-runner-browser.html");
  assert.match(page, /<script type="module" src="\/tests\/s1-runner-browser\.js"><\/script>/);
  assert.doesNotMatch(page, /<script(?:\s[^>]*)?>\s*[^<\s]/);
});
