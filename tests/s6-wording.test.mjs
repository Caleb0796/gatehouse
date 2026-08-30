import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

const retiredReason = ["REGRESSION", "DEMONSTRATED"].join("_");
const bannedClaims = new RegExp(
  `machine-verified|verified report|impossible without|security gate|last-good|maintainers receive|${retiredReason}|\\bdemonstrat(?:e|es|ed|ing|ion|ions)\\b`,
  "i",
);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const url = new URL(entry.name, directory);
    return entry.isDirectory() ? filesUnder(new URL(`${entry.name}/`, directory)) : [url];
  }))).flat();
}

async function publicCopy() {
  const docFiles = (await filesUnder(new URL("../docs/", import.meta.url)))
    .filter(file => file.pathname.endsWith(".md"));
  const sourceFiles = (await filesUnder(new URL("../src/", import.meta.url)))
    .filter(file => /\.(?:html|js|md|mjs)$/.test(file.pathname));
  const files = [
    new URL("../README.md", import.meta.url),
    new URL("../package.json", import.meta.url),
    ...docFiles,
    ...sourceFiles,
  ];
  return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
}

test("public documentation and source copy follow claim discipline", async () => {
  const copy = await publicCopy();

  assert.doesNotMatch(copy, bannedClaims);
  assert.match(copy, /single-target prototype/i);
  assert.match(copy, /nondeterminism filter/i);
  assert.match(copy, /does not (?:prevent|stop).*forgery/i);
  assert.match(copy, /reproduced 5\/5 in-browser \(client-side\)/i);
  assert.match(copy, /reporters can manually share/i);
  assert.match(copy, /repro source (?:integrity|hash)[\s\S]*build provenance[\s\S]*runtime reproduction[\s\S]*approver identity/i);
  assert.match(copy, /not verified/i);
});
