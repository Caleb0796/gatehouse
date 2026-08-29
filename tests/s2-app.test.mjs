import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = path => readFile(new URL(path, import.meta.url), "utf8");

test("index keeps every frozen application slot and an external module", async () => {
  const page = await read("../index.html");

  for (const id of [
    "env-banner",
    "target-panel",
    "editor-panel",
    "run-panel",
    "timeline",
    "sign-panel",
    "inbox-root",
    "scoreboard",
  ]) {
    assert.match(page, new RegExp(`id=["']${id}["']`));
  }
  assert.match(page, /<script type="module" src="\/src\/surface\/app\.js"><\/script>/);
  assert.doesNotMatch(page, /<script(?:\s[^>]*)?>\s*[^<\s]/);
});

test("application assembly uses the real target and all six modules", async () => {
  const app = await read("../src/surface/app.js");

  assert.match(app, /export async function initSurface\(\{ runDifferential, target \}\)/);
  assert.match(app, /loadTarget\(TARGET_ID\)/);
  assert.match(app, /const TARGET_ID = "qs-500"/);
  assert.match(app, /runDifferential: runRealDifferential/);
  assert.doesNotMatch(app, /contracts\/fixtures|differential-(?:green|failboth|inverted)\.json/);
  for (const initializer of [
    "initBanner",
    "initTimeline",
    "initScoreboard",
    "initInbox",
    "initSigning",
    "createSurface",
  ]) {
    assert.match(app, new RegExp(`${initializer}\\(`));
  }
});

test("base stylesheet covers the shell, surface panels, and both color schemes", async () => {
  const css = await read("../src/ui/base.css");

  for (const selector of [
    "body > main",
    "#target-panel",
    ".editor-panel__label",
    ".run-panel__actions",
    ".sign-panel__status",
    "#inbox-root",
  ]) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(css, /color-scheme: light dark/);
  assert.match(css, /prefers-color-scheme: dark/);
});
