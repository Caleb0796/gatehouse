import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createReceiptView,
  initReceiptPage,
  renderLoading,
  renderReceipt,
} from "../src/inbox/receipt-page.js";

const fixture = JSON.parse(await readFile(
  new URL("../contracts/fixtures/artifact.sample.json", import.meta.url),
  "utf8",
));
const html = await readFile(new URL("../receipt.html", import.meta.url), "utf8");
const pageScript = await readFile(new URL("../src/inbox/receipt-page.js", import.meta.url), "utf8");

function leafValues(value) {
  if (Array.isArray(value)) return value.flatMap(leafValues);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(leafValues);
  return [value];
}

class Element {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.children = [];
    this.attributes = new Map();
    this.textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
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

function fakeWindow(initialHash) {
  const listeners = new Map();
  return {
    location: { hash: initialHash },
    addEventListener(type, listener) {
      const entries = listeners.get(type) ?? new Set();
      entries.add(listener);
      listeners.set(type, entries);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatch(type) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

test("receipt page is static, textContent-only, and does not import the sandbox", () => {
  assert.match(html, /src="\/src\/inbox\/receipt-page\.js"/);
  assert.match(pageScript, /import \{ decodeReceipt \} from "\.\/receipt\.js"/);
  assert.doesNotMatch(`${html}\n${pageScript}`, /innerHTML/);
  assert.doesNotMatch(`${html}\n${pageScript}`, /sandbox|runner\.js|eval\(|new Function/);
  assert.match(html, /Paste this link into your GitHub issue/i);
  assert.match(html, /locally approved evidence/i);
  for (const phrase of [
    /browser-local approval is unauthenticated/,
    /does not verify identity/,
    /not a cryptographic signature/,
    /activated by automation/,
  ]) {
    assert.match(html, phrase);
    assert.match(pageScript, phrase);
  }
  assert.match(html, /rel="icon" href="data:image\/svg\+xml/);
  assert.match(pageScript, /Download receipt JSON/);
  assert.match(pageScript, /Local approval recorded at/);
  assert.doesNotMatch(`${html}\n${pageScript}`, /inspect the signed evidence|\["Signed at"/);
});

test("receipt view includes every artifact value and labels claims", () => {
  const serializedView = JSON.stringify(createReceiptView(fixture, true));
  for (const value of leafValues(fixture)) {
    assert.ok(serializedView.includes(JSON.stringify(value)), `missing artifact value: ${value}`);
  }
  assert.match(serializedView, /repro hash verified ✓/);
  assert.equal((serializedView.match(/as-claimed/g) ?? []).length, 4);
});

test("receipt view shows a failed repro hash verification", () => {
  assert.equal(createReceiptView(fixture, false).verification, "repro hash verified ✗");
});

test("receipt loading replaces old verification with a live status", () => {
  const document = fakeDocument();
  const root = new Element(document, "main");
  const oldVerification = new Element(document, "div");
  oldVerification.textContent = "repro hash verified ✓";
  root.append(oldVerification);

  renderLoading(root);

  assert.doesNotMatch(textTree(root), /repro hash verified ✓/);
  assert.match(textTree(root), /Verifying receipt…/);
  const status = root.children.find(child => child.getAttribute("role") === "status");
  assert.ok(status);
});

test("receipt page tracks the latest fragment and replaces valid, tampered, and invalid states", async () => {
  const windowObject = fakeWindow("#valid");
  const requests = new Map([
    ["#valid", deferred()],
    ["#tampered", deferred()],
    ["#invalid", deferred()],
  ]);
  const states = [];
  const disposed = [];
  const cleanup = initReceiptPage({
    root: {},
    windowObject,
    decode: hash => requests.get(hash).promise,
    renderPending: () => {
      states.push("Verifying receipt…");
      return () => disposed.push("pending");
    },
    render: (_root, _artifact, hashOk) => {
      const state = hashOk ? "repro hash verified ✓" : "repro hash verified ✗";
      states.push(state);
      return () => disposed.push(state);
    },
    renderFailure: (_root, message) => {
      const state = `error: ${message}`;
      states.push(state);
      return () => disposed.push(state);
    },
  });

  assert.equal(states.at(-1), "Verifying receipt…");
  requests.get("#valid").resolve({ artifact: fixture, reproHashOk: true });
  await flushPromises();
  assert.equal(states.at(-1), "repro hash verified ✓");

  windowObject.location.hash = "#tampered";
  windowObject.dispatch("hashchange");
  assert.equal(states.at(-1), "Verifying receipt…");
  assert.equal(disposed.filter(value => value === "repro hash verified ✓").length, 1);
  requests.get("#tampered").resolve({ artifact: fixture, reproHashOk: false });
  await flushPromises();
  assert.equal(states.at(-1), "repro hash verified ✗");

  windowObject.location.hash = "#invalid";
  windowObject.dispatch("hashchange");
  assert.equal(states.at(-1), "Verifying receipt…");
  requests.get("#invalid").resolve({ error: "receipt payload is invalid" });
  await flushPromises();
  assert.equal(states.at(-1), "error: receipt payload is invalid");

  windowObject.dispatch("pagehide");
  cleanup();
  assert.equal(windowObject.listenerCount("hashchange"), 0);
  assert.equal(windowObject.listenerCount("pagehide"), 0);
  assert.equal(disposed.filter(value => value === "error: receipt payload is invalid").length, 1);
});

test("a superseded receipt decode cannot overwrite the latest fragment", async () => {
  const windowObject = fakeWindow("#slow");
  const slow = deferred();
  const fast = deferred();
  const rendered = [];
  const cleanup = initReceiptPage({
    root: {},
    windowObject,
    decode: hash => hash === "#slow" ? slow.promise : fast.promise,
    renderPending: () => rendered.push("loading"),
    render: (_root, artifact) => rendered.push(artifact.targetId),
  });

  windowObject.location.hash = "#fast";
  windowObject.dispatch("hashchange");
  fast.resolve({ artifact: { targetId: "fast" }, reproHashOk: true });
  await flushPromises();
  slow.resolve({ artifact: { targetId: "slow" }, reproHashOk: true });
  await flushPromises();

  assert.deepEqual(rendered, ["loading", "loading", "fast"]);
  cleanup();
});

test("receipt download Blob is revoked exactly once", () => {
  const document = fakeDocument();
  const root = new Element(document, "main");
  const revoked = [];
  const cleanup = renderReceipt(root, fixture, true, {
    createObjectURL(blob) {
      assert.equal(blob.type, "application/json");
      return "blob:receipt";
    },
    revokeObjectURL: value => revoked.push(value),
  });

  cleanup();
  cleanup();
  assert.deepEqual(revoked, ["blob:receipt"]);
});
