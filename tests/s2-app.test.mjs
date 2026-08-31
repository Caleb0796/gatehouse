import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  connectSurfaceUi,
  trackDemoE2E,
  waitForDraftUpdates,
} from "../src/surface/app.js";

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

test("application assembly uses the real target and all page modules", async () => {
  const app = await read("../src/surface/app.js");

  assert.match(app, /export async function initSurface\(\{ runDifferential, target \}\)/);
  assert.match(app, /loadTarget\(TARGET_ID\)/);
  assert.match(app, /const TARGET_ID = "qs-500"/);
  assert.match(app, /runDifferential: runRealDifferential/);
  assert.doesNotMatch(app, /contracts\/fixtures|differential-(?:green|failboth|inverted)\.json/);
  for (const initializer of [
    "initBanner",
    "initPrompt",
    "initTimeline",
    "initScoreboard",
    "initInbox",
    "initSigning",
    "initSimagent",
    "createSurface",
  ]) {
    assert.match(app, new RegExp(`${initializer}\\(`));
  }
  assert.match(app, /promptRoot\.id = "demo-prompt"/);
  assert.match(app, /surface\.gate\.setDraft\(code, \{ source: "editor" \}\)/);
  assert.match(app, /initBanner\(requiredElement\("env-banner"\), \{ demoMode \}\)/);
  assert.match(app, /persistArtifact: artifact => storeArtifact\(artifact\)/);
});

test("local approval copy discloses its browser-local trust boundary", async () => {
  const app = await read("../src/surface/app.js");
  const page = await read("../index.html");

  for (const phrase of [
    "Local approval",
    "Awaiting local approval",
    "Approve & save locally",
    "browser-local approval is unauthenticated",
    "does not verify identity",
    "not a cryptographic signature",
    "automation can activate the control",
  ]) {
    assert.match(app, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(page, /locally approved and saved/);
  assert.doesNotMatch(`${app}\n${page}`, /Human signature|Sign & submit|before a report can be signed/);
});

test("browser-facing application sources contain no Han-script text", async () => {
  const sources = await Promise.all([
    "../index.html",
    "../receipt.html",
    "../src/inbox/adopt.js",
    "../src/inbox/inbox.js",
    "../src/inbox/receipt-page.js",
    "../src/inbox/replay.js",
    "../src/simagent/simagent.js",
    "../src/surface/app.js",
    "../src/surface/sign.js",
    "../src/ui/banner.js",
    "../src/ui/prompt.js",
    "../src/ui/scoreboard.js",
    "../src/ui/timeline.js",
  ].map(read));

  assert.doesNotMatch(sources.join("\n"), /\p{Script=Han}/u);
});

function createEventBus() {
  const listeners = new Map();
  return {
    emit(type, detail) {
      for (const listener of listeners.get(type) || []) listener(detail);
    },
    on(type, listener) {
      const entries = listeners.get(type) || [];
      entries.push(listener);
      listeners.set(type, entries);
      return () => entries.splice(entries.indexOf(listener), 1);
    },
  };
}

test("demo E2E marker requires all three verdicts, the dynamic tool, and staging", () => {
  const eventBus = createEventBus();
  const body = { dataset: {} };
  trackDemoE2E(eventBus, body);

  for (const reason of ["FAIL_BOTH", "PASS_BOTH", "REGRESSION_DEMONSTRATED"]) {
    eventBus.emit("run", { verdict: { reason } });
  }
  eventBus.emit("surface", { change: "registered", tool: "submit_report" });
  assert.equal(body.dataset.e2e, "submit-report-available");

  eventBus.emit("staged", {});

  assert.equal(body.dataset.e2e, "pass");
  assert.equal(
    body.dataset.e2eRuns,
    "FAIL_BOTH,PASS_BOTH,REGRESSION_DEMONSTRATED",
  );
});

test("demo E2E marker fails an out-of-order verdict sequence", () => {
  const eventBus = createEventBus();
  const body = { dataset: {} };
  trackDemoE2E(eventBus, body);

  eventBus.emit("run", { verdict: { reason: "PASS_BOTH" } });
  eventBus.emit("staged", {});

  assert.equal(body.dataset.e2e, "fail");
});

test("tool draft and run events keep the visible editor and latest verdict in sync", () => {
  const eventBus = createEventBus();
  const editor = {
    value: "old repro",
    className: "editor-panel__attention",
    classList: {
      remove(name) {
        editor.className = editor.className.replace(name, "").trim();
      },
    },
  };
  const editorView = { editor, status: { textContent: "" } };
  const runView = { output: { textContent: "old verdict" } };
  let gateState = { draft: "first agent repro", draftSha: "a".repeat(64) };
  connectSurfaceUi({ eventBus, getGateState: () => gateState, editorView, runView });

  eventBus.emit("draft", {
    reproSha256: gateState.draftSha,
    length: gateState.draft.length,
    source: "tool",
  });
  assert.equal(editor.value, "first agent repro");
  assert.equal(editorView.status.textContent, `Draft stored · ${"a".repeat(12)}`);
  assert.equal(editor.className, "");
  assert.equal(runView.output.textContent, "Draft updated · not run yet");

  gateState = { draft: "final agent repro", draftSha: "b".repeat(64) };
  eventBus.emit("draft", {
    reproSha256: gateState.draftSha,
    length: gateState.draft.length,
    source: "tool",
  });
  eventBus.emit("run", {
    verdict: {
      green: true,
      reason: "REGRESSION_DEMONSTRATED",
      runs: [
        { version: "bad", verdict: "fail", durationMs: 12 },
        { version: "good", verdict: "pass", durationMs: 10 },
      ],
    },
  });

  assert.equal(editor.value, "final agent repro");
  assert.equal(
    runView.output.textContent,
    "GREEN · REGRESSION_DEMONSTRATED\nbad: fail (12ms)\ngood: pass (10ms)",
  );
});

test("an older editor draft completion does not overwrite newer visible input", () => {
  const eventBus = createEventBus();
  const editor = {
    value: "ab",
    classList: { remove() {} },
  };
  const editorView = { editor, status: { textContent: "" } };
  const runView = { output: { textContent: "old verdict" } };
  let gateState = { draft: "a", draftSha: "a".repeat(64) };
  connectSurfaceUi({ eventBus, getGateState: () => gateState, editorView, runView });

  eventBus.emit("draft", { source: "editor" });
  assert.equal(editor.value, "ab");
  assert.equal(editorView.status.textContent, "Saving newer draft…");

  editor.value = "abc";
  gateState = { draft: "ab", draftSha: "b".repeat(64) };
  eventBus.emit("draft", { source: "editor" });
  assert.equal(editor.value, "abc");
  assert.equal(editorView.status.textContent, "Saving newer draft…");

  gateState = { draft: "abc", draftSha: "c".repeat(64) };
  eventBus.emit("draft", { source: "editor" });
  assert.equal(editor.value, "abc");
  assert.equal(editorView.status.textContent, `Draft stored · ${"c".repeat(12)}`);
});

test("a tool draft completion does not overwrite a newer pending editor draft", () => {
  const eventBus = createEventBus();
  const editor = {
    value: "new human draft",
    classList: { remove() {} },
  };
  const editorView = { editor, status: { textContent: "" } };
  const runView = { output: { textContent: "old verdict" } };
  let pendingEditorDraft = true;
  let gateState = { draft: "tool draft", draftSha: "a".repeat(64) };
  connectSurfaceUi({
    eventBus,
    getGateState: () => gateState,
    hasPendingEditorDraft: () => pendingEditorDraft,
    editorView,
    runView,
  });

  eventBus.emit("draft", { source: "tool" });
  assert.equal(editor.value, "new human draft");
  assert.equal(editorView.status.textContent, "Saving newer draft…");

  pendingEditorDraft = false;
  gateState = { draft: "new human draft", draftSha: "b".repeat(64) };
  eventBus.emit("draft", { source: "editor" });
  assert.equal(editor.value, "new human draft");
  assert.equal(editorView.status.textContent, `Draft stored · ${"b".repeat(12)}`);
});

test("draft flushing waits for an edit queued while an earlier hash is pending", async () => {
  let resolveFirst;
  let resolveSecond;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const second = new Promise(resolve => { resolveSecond = resolve; });
  let pending = first;
  let finished = false;
  const waiting = waitForDraftUpdates(() => pending).then(() => { finished = true; });

  pending = second;
  resolveFirst();
  await first;
  await Promise.resolve();
  assert.equal(finished, false);

  resolveSecond();
  await waiting;
  assert.equal(finished, true);
});

test("base stylesheet covers the shell, surface panels, and both color schemes", async () => {
  const css = await read("../src/ui/base.css");

  for (const selector of [
    "body > main",
    ".workflow",
    ".side-rail",
    "#target-panel",
    ".editor-panel__label",
    ".run-panel__actions",
    ".sign-panel__review",
    ".sign-panel__status",
    "#inbox-root",
  ]) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(css, /color-scheme: light dark/);
  assert.match(css, /prefers-color-scheme: dark/);
});
