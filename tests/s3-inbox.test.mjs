import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createInboxView,
  INBOX_STORAGE_KEY,
  init,
  loadInbox,
  storeArtifact,
} from "../src/inbox/inbox.js";

const fixture = JSON.parse(await readFile(
  new URL("../contracts/fixtures/artifact.sample.json", import.meta.url),
  "utf8",
));

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

class Element {
  constructor(ownerDocument, tagName) {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
    this.children = [];
    this.listeners = {};
    this.hidden = false;
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

function findByTag(node, tagName) {
  return [node, ...node.children.flatMap(child => findByTag(child, tagName))]
    .filter(child => child.tagName === tagName);
}

test("stores signed artifacts under the frozen localStorage key", () => {
  const storage = memoryStorage();
  storeArtifact(fixture, storage);
  assert.deepEqual(loadInbox(storage), [fixture]);
  assert.equal(JSON.parse(storage.getItem(INBOX_STORAGE_KEY))[0].targetId, fixture.targetId);
});

test("builds a newest-first list with verdict badges", () => {
  const older = structuredClone(fixture);
  older.targetId = "older";
  older.signedAt = "2026-08-29T09:00:00Z";
  const newest = structuredClone(fixture);
  newest.targetId = "newest";
  newest.signedAt = "2026-08-29T11:00:00Z";
  newest.runs[0].verdict = "pass";

  const view = createInboxView([older, newest]);
  assert.deepEqual(view.map(entry => entry.artifact.targetId), ["newest", "older"]);
  assert.deepEqual(view.map(entry => entry.verdict), [
    { label: "PASS → PASS", tone: "neutral" },
    { label: "STABLE_LOCAL_DIFFERENTIAL", tone: "green" },
  ]);
});

test("signed events persist, reveal, list, and show report details", () => {
  const storage = memoryStorage();
  const handlers = new Map();
  const eventBus = {
    on(type, handler) {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
  };
  const document = fakeDocument();
  const root = new Element(document, "section");
  root.hidden = true;

  const unsubscribe = init(root, { storage, bus: eventBus });
  assert.equal(root.hidden, true);
  handlers.get("signed")({ artifact: fixture });

  assert.equal(root.hidden, false);
  assert.deepEqual(loadInbox(storage), [fixture]);
  const rendered = textTree(root);
  assert.match(rendered, /STABLE_LOCAL_DIFFERENTIAL/);
  assert.match(rendered, /gatehouse-demo-lib · demo-lib-001/);
  assert.match(rendered, /const r = demoLib\.add\(2, 2\)/);
  assert.match(rendered, /ReproAssertionError/);

  const second = structuredClone(fixture);
  second.targetId = "newest-report";
  handlers.get("signed")({ artifact: second });
  assert.match(textTree(root), /gatehouse-demo-lib · newest-report/);
  findByTag(root, "button")[1].listeners.click();
  const detail = findByTag(root, "article")[0];
  assert.match(textTree(detail), /gatehouse-demo-lib · demo-lib-001/);

  unsubscribe();
  assert.equal(handlers.has("signed"), false);
});

test("ignores corrupt stored inbox data", () => {
  assert.deepEqual(loadInbox(memoryStorage({ [INBOX_STORAGE_KEY]: "{" })), []);
  assert.deepEqual(loadInbox(memoryStorage({ [INBOX_STORAGE_KEY]: "{}" })), []);
});
