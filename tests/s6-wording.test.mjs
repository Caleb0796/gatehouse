import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const bannedClaims = /machine-verified|impossible without|security gate|last-good|maintainers receive|REGRESSION_DEMONSTRATED|\bdemonstrat(?:e|es|ed|ing|ion|ions)\b/i;

async function documentation() {
  const docFiles = (await readdir(new URL("../docs/", import.meta.url)))
    .filter((name) => name.endsWith(".md"))
    .map((name) => new URL(`../docs/${name}`, import.meta.url));
  const files = [new URL("../README.md", import.meta.url), ...docFiles];
  return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
}

test("public documentation follows claim discipline", async () => {
  const copy = await documentation();

  assert.doesNotMatch(copy, bannedClaims);
  assert.match(copy, /single-target prototype/i);
  assert.match(copy, /nondeterminism filter/i);
  assert.match(copy, /does not (?:prevent|stop).*forgery/i);
  assert.match(copy, /reproduced 5\/5 in-browser \(client-side\)/i);
  assert.match(copy, /reporters can manually share/i);
  assert.match(copy, /repro source (?:integrity|hash)[\s\S]*build provenance[\s\S]*runtime reproduction[\s\S]*approver identity/i);
  assert.match(copy, /not verified/i);
});
