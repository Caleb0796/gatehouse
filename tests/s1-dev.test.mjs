import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("S1 dev page exposes the editor and both RunResults under CSP", async () => {
  const page = await read("../dev/s1.html");

  assert.match(page, /<textarea id="repro"/);
  assert.match(page, /<pre id="bad-run">/);
  assert.match(page, /<pre id="good-run">/);
  assert.match(page, /id="verdict"/);
  assert.match(page, /<script type="module" src="\/src\/sandbox\/s1-dev\.js"><\/script>/);
  assert.doesNotMatch(page, /<script(?:\s[^>]*)?>\s*[^<\s]/);
});

test("S1 dev module calls the formal differential interface", async () => {
  const module = await read("../src/sandbox/s1-dev.js");
  const runner = await read("../src/sandbox/runner.js");

  assert.match(module, /runDifferential\(repro\.value, \{ targetId: TARGET_ID \}\)/);
  assert.match(module, /result\.runs\[0\]/);
  assert.match(module, /result\.runs\[1\]/);
  assert.match(runner, /export async function runDifferential/);
  assert.match(runner, /reproSha256: await sha256Hex\(code\)/);
});

test("five-case browser acceptance page keeps its script external", async () => {
  const page = await read("s1-dev-browser.html");
  const script = await read("s1-dev-browser.js");

  assert.match(page, /<script type="module" src="\/tests\/s1-dev-browser\.js"><\/script>/);
  assert.doesNotMatch(page, /<script(?:\s[^>]*)?>\s*[^<\s]/);
  for (const reason of ["FAIL_BOTH", "PASS_BOTH", "EXECUTION_ERROR", "INVERTED", "STABLE_LOCAL_DIFFERENTIAL"]) {
    assert.match(script, new RegExp(reason));
  }
});
