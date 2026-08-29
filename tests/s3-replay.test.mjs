import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  initReplay,
  runReplay,
  runsMatch,
} from "../src/inbox/replay.js";

const fixture = JSON.parse(await readFile(
  new URL("../contracts/fixtures/artifact.sample.json", import.meta.url),
  "utf8",
));
const green = JSON.parse(await readFile(
  new URL("../contracts/fixtures/differential-green.json", import.meta.url),
  "utf8",
));
const failBoth = JSON.parse(await readFile(
  new URL("../contracts/fixtures/differential-failboth.json", import.meta.url),
  "utf8",
));

class Element {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }
}

function fakeDocument() {
  const document = {
    createElement: tagName => new Element(document, tagName),
  };
  return document;
}

function textTree(node) {
  return [node.textContent, ...node.children.flatMap(textTree)].join(" ");
}

test("replays the stored repro against its target", async () => {
  const calls = [];
  const result = await runReplay(fixture, async (...args) => {
    calls.push(args);
    return green;
  });

  assert.deepEqual(calls, [[fixture.repro, { targetId: fixture.targetId }]]);
  assert.equal(result.consistent, true);
  assert.equal(result.recordedRuns, fixture.runs);
  assert.equal(result.currentRuns, green.runs);
});

test("compares verdicts and bundle hashes without treating timing as drift", () => {
  const current = structuredClone(fixture.runs);
  current[0].durationMs += 500;
  current[0].logs = ["different machine output"];
  assert.equal(runsMatch(fixture.runs, current), true);
  current[1].bundleSha256 = "0".repeat(64);
  assert.equal(runsMatch(fixture.runs, current), false);
});

test("renders recorded and current runs in a green matching frame", async () => {
  const document = fakeDocument();
  const root = new Element(document, "section");
  initReplay(root, fixture, { runDifferential: async () => green });

  await root.children[0].listeners.click();

  assert.equal(root.children[1].className, "replay-result consistent");
  assert.match(textTree(root), /Replay matches recorded runs/);
  assert.match(textTree(root), /Recorded runs/);
  assert.match(textTree(root), /Current runs/);
});

test("renders changed runs in a yellow warning frame", async () => {
  const document = fakeDocument();
  const root = new Element(document, "section");
  initReplay(root, fixture, { runDifferential: async () => failBoth });

  await root.children[0].listeners.click();

  assert.equal(root.children[1].className, "replay-result changed");
  assert.match(textTree(root), /builds or environment changed/);
  assert.match(textTree(root), /FAIL_BOTH|fail/);
});

test("keeps the frozen runner import path for integration", async () => {
  const source = await readFile(
    new URL("../src/inbox/replay.js", import.meta.url),
    "utf8",
  );
  assert.match(source, /import\("\.\.\/sandbox\/runner\.js"\)/);
});

test("defines visible green and yellow replay frames in an external stylesheet", async () => {
  const styles = await readFile(
    new URL("../src/inbox/replay.css", import.meta.url),
    "utf8",
  );
  assert.match(styles, /\.replay-result\.consistent[\s\S]*border-color: #2e7d32/);
  assert.match(styles, /\.replay-result\.changed[\s\S]*border-color: #b7791f/);
});
