import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("SYNC-0 page keeps scripts external under production CSP", async () => {
  const page = await read("../dev/s1.html");
  assert.match(page, /<script type="module" src="\/src\/sandbox\/spike\.js"><\/script>/);
  assert.doesNotMatch(page, /<script(?:\s[^>]*)?>\s*[^<\s]/);
});

test("SYNC-0 harness preserves the opaque iframe and termination invariants", async () => {
  const parent = await read("../src/sandbox/spike.js");
  const inner = await read("../src/sandbox/spike-inner.js");

  assert.match(parent, /document\.open\(\)/);
  assert.match(parent, /document\.close\(\)/);
  assert.match(parent, /iframe\.sandbox = "allow-scripts"/);
  assert.doesNotMatch(parent, /allow-same-origin/);
  assert.match(parent, /<script src="\/src\/sandbox\/spike-inner\.js"><\/script>/);
  assert.match(inner, /new Worker\(url\)/);
  assert.match(inner, /while \(true\) \{\}/);
  assert.match(inner, /worker\.terminate\(\)/);
  assert.match(inner, /nextMessage\(probe, 2_000\)/);
  assert.match(inner, /typeof self\.dayjs/);
});
