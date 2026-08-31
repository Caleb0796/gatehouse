import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  initReplay,
  runReplay,
  samplesMatch,
} from "../src/inbox/replay.js";

const badSha256 = "a".repeat(64);
const goodSha256 = "b".repeat(64);
const reproSha256 = "c".repeat(64);

function samples() {
  return {
    bad: Array.from({ length: 5 }, (_, index) => ({
      verdict: "fail",
      logs: [`bad ${index}`],
      durationMs: 12 + index,
      bundleSha256: badSha256,
    })),
    good: Array.from({ length: 5 }, (_, index) => ({
      verdict: "pass",
      logs: [],
      durationMs: 10 + index,
      bundleSha256: goodSha256,
    })),
  };
}

const fixture = {
  v: 2,
  targetId: "demo-lib-001",
  library: "gatehouse-demo-lib",
  badVersion: "1.1.0",
  goodVersion: "1.0.0",
  badSha256,
  goodSha256,
  repro: "assert(example.value === 4)",
  reproSha256,
  green: true,
  reason: "STABLE_LOCAL_DIFFERENTIAL",
  stable: true,
  repeats: 5,
  samples: samples(),
  timeline: [{ at: "2026-08-29T10:07:00Z", event: "signed", detail: "" }],
  signedAt: "2026-08-29T10:07:00Z",
  ua: "fixture",
  issueUrl: null,
  targetKind: "seed",
};

const green = {
  green: true,
  reason: "STABLE_LOCAL_DIFFERENTIAL",
  stable: true,
  repeats: 5,
  samples: samples(),
  reproSha256,
  targetId: fixture.targetId,
};

const failBoth = structuredClone(green);
failBoth.green = false;
failBoth.reason = "FAIL_BOTH";
for (const sample of failBoth.samples.good) sample.verdict = "fail";

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
  assert.equal(result.recordedSamples, fixture.samples);
  assert.equal(result.currentSamples, green.samples);
});

test("compares every v2 sample without treating timing or logs as drift", () => {
  const current = structuredClone(fixture.samples);
  current.bad[0].durationMs += 500;
  current.bad[0].logs = ["different machine output"];
  assert.equal(samplesMatch(fixture.samples, current), true);
  current.good[2].bundleSha256 = "0".repeat(64);
  assert.equal(samplesMatch(fixture.samples, current), false);
});

test("replays public projections even when all recorded logs are absent", async () => {
  const publicArtifact = structuredClone(fixture);
  for (const group of Object.values(publicArtifact.samples)) {
    for (const sample of group) delete sample.logs;
  }
  const result = await runReplay(publicArtifact, async () => green);
  assert.equal(result.consistent, true);
});

test("explicitly refuses v1 replay artifacts", async () => {
  await assert.rejects(
    () => runReplay({ v: 1 }, async () => green),
    /schema v2/,
  );
});

test("renders recorded and current samples in a green matching frame", async () => {
  const document = fakeDocument();
  const root = new Element(document, "section");
  initReplay(root, fixture, { runDifferential: async () => green });

  await root.children[0].listeners.click();

  assert.equal(root.children[1].className, "replay-result consistent");
  assert.match(textTree(root), /Replay matches recorded samples/);
  assert.match(textTree(root), /Recorded samples/);
  assert.match(textTree(root), /Current samples/);
});

test("renders changed samples in a yellow warning frame", async () => {
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

test("allows long SHA and log values to shrink and wrap inside both replay columns", async () => {
  const styles = await readFile(
    new URL("../src/inbox/replay.css", import.meta.url),
    "utf8",
  );
  assert.match(styles, /grid-template-columns: repeat\(auto-fit, minmax\(min\(16rem, 100%\), 1fr\)\)/);
  assert.match(styles, /\.replay-columns > section,[\s\S]*\.replay-columns dd \{[\s\S]*min-width: 0/);
  assert.match(styles, /\.replay-columns dd \{[\s\S]*overflow-wrap: anywhere/);
  assert.match(styles, /\.replay-columns dd \{[\s\S]*white-space: pre-wrap/);
});
