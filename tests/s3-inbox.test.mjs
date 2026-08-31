import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createInboxView,
  INBOX_STORAGE_KEY,
  init,
  initReceiptShare,
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
    setItemCalls: [],
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      this.setItemCalls.push({ key, value });
      values.set(key, value);
    },
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
    this.attributes = new Map();
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

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

function fakeDocument() {
  const document = {
    baseURI: "https://gatehouse.test/app/index.html",
    createElement: tagName => new Element(document, tagName),
  };
  return document;
}

function schemaV2Artifact() {
  return structuredClone(fixture);
}

function legacyArtifact() {
  const artifact = structuredClone(fixture);
  artifact.v = 1;
  artifact.runs = ["bad", "good"].map(version => ({
    version,
    ...artifact.samples[version].at(-1),
  }));
  delete artifact.green;
  delete artifact.reason;
  delete artifact.stable;
  delete artifact.repeats;
  delete artifact.samples;
  return artifact;
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
  assert.deepEqual(storeArtifact(fixture, storage), { ok: true });
  assert.deepEqual(loadInbox(storage), [fixture]);
  assert.equal(JSON.parse(storage.getItem(INBOX_STORAGE_KEY))[0].targetId, fixture.targetId);
});

test("reports thrown and silent storage failures instead of confirming them", () => {
  const quotaStorage = memoryStorage();
  quotaStorage.setItem = () => {
    throw new DOMException("quota full", "QuotaExceededError");
  };
  const thrown = storeArtifact(fixture, quotaStorage);
  assert.equal(thrown.ok, false);
  assert.match(thrown.error, /QuotaExceededError: quota full/);

  const silentStorage = memoryStorage();
  silentStorage.setItem = () => {};
  assert.deepEqual(storeArtifact(fixture, silentStorage), {
    ok: false,
    error: "Artifact storage could not be confirmed after write.",
  });
});

test("builds a newest-first list with verdict badges", () => {
  const older = schemaV2Artifact();
  older.targetId = "older";
  older.signedAt = "2026-08-29T09:00:00Z";
  const newest = schemaV2Artifact();
  newest.targetId = "newest";
  newest.signedAt = "2026-08-29T11:00:00Z";
  newest.green = false;
  newest.stable = false;
  newest.reason = "UNSTABLE";

  const view = createInboxView([older, newest]);
  assert.deepEqual(view.map(entry => entry.artifact.targetId), ["newest", "older"]);
  assert.deepEqual(view.map(entry => entry.verdict), [
    { label: "UNSTABLE", tone: "neutral" },
    { label: "STABLE_LOCAL_DIFFERENTIAL", tone: "green" },
  ]);
});

test("signed events reload and render persisted v2 samples without storing twice", async () => {
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

  const unsubscribe = init(root, {
    storage,
    bus: eventBus,
    runDifferential: async () => ({
      green: true,
      reason: "STABLE_LOCAL_DIFFERENTIAL",
      stable: true,
      repeats: 5,
      targetId: fixture.targetId,
      reproSha256: fixture.reproSha256,
      runs: ["bad", "good"].map(version => ({
        version,
        ...structuredClone(fixture.samples[version].at(-1)),
      })),
      samples: schemaV2Artifact().samples,
    }),
  });
  assert.equal(root.hidden, true);
  const artifact = schemaV2Artifact();
  assert.deepEqual(storeArtifact(artifact, storage), { ok: true });
  handlers.get("signed")({ artifact });

  assert.equal(root.hidden, false);
  assert.deepEqual(loadInbox(storage), [artifact]);
  assert.equal(storage.setItemCalls.length, 1);
  const rendered = textTree(root);
  assert.match(rendered, /STABLE_LOCAL_DIFFERENTIAL/);
  assert.match(rendered, /gatehouse-demo-lib · demo-lib-001/);
  assert.match(rendered, /const r = demoLib\.add\(2, 2\)/);
  assert.match(rendered, /ReproAssertionError/);
  assert.match(rendered, /Recorded samples/);
  assert.match(rendered, /Reported build 5/);
  assert.match(rendered, /Comparison build 5/);
  const replay = findByTag(root, "button").find(button => button.textContent === "Replay");
  await replay.listeners.click();
  assert.match(textTree(root), /Replay matches recorded samples/);
  assert.match(rendered, /Locally approved reports/);
  assert.match(rendered, /Local approval recorded at/);
  assert.doesNotMatch(rendered, /Signed report inbox|Signed at/);

  const second = schemaV2Artifact();
  second.targetId = "newest-report";
  assert.deepEqual(storeArtifact(second, storage), { ok: true });
  handlers.get("signed")({ artifact: second });
  assert.equal(storage.setItemCalls.length, 2);
  assert.match(textTree(root), /gatehouse-demo-lib · newest-report/);
  let listButtons = findByTag(root, "button").slice(0, 2);
  assert.equal(listButtons[0].getAttribute("aria-current"), "true");
  assert.equal(listButtons[1].getAttribute("aria-current"), null);
  assert.match(textTree(listButtons[0]), /Selected/);
  assert.doesNotMatch(textTree(listButtons[1]), /Selected/);

  listButtons[1].listeners.click();
  listButtons = findByTag(root, "button").slice(0, 2);
  assert.equal(listButtons[0].getAttribute("aria-current"), null);
  assert.equal(listButtons[1].getAttribute("aria-current"), "true");
  assert.doesNotMatch(textTree(listButtons[0]), /Selected/);
  assert.match(textTree(listButtons[1]), /Selected/);
  const detail = findByTag(root, "article")[0];
  assert.match(textTree(detail), /gatehouse-demo-lib · demo-lib-001/);
  assert.equal(findByTag(root, "time")[1].dateTime, fixture.signedAt);

  unsubscribe();
  assert.equal(handlers.has("signed"), false);
});

test("signed events only reload artifacts already persisted by signing", () => {
  const storage = memoryStorage();
  let writes = 0;
  const setItem = storage.setItem;
  storage.setItem = (...args) => {
    writes += 1;
    setItem.apply(storage, args);
  };
  const handlers = new Map();
  const eventBus = {
    on(type, handler) {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
  };
  const document = fakeDocument();
  const root = new Element(document, "section");
  const artifact = schemaV2Artifact();

  init(root, { storage, bus: eventBus });
  assert.deepEqual(storeArtifact(artifact, storage), { ok: true });
  assert.equal(writes, 1);
  handlers.get("signed")({ artifact });

  assert.equal(writes, 1);
  assert.deepEqual(loadInbox(storage), [artifact]);
  assert.equal(root.hidden, false);
});

test("sharing prepares the public projection before exposing receipt controls", async () => {
  const artifact = schemaV2Artifact();
  const document = fakeDocument();
  const root = new Element(document, "section");
  let prepared = false;
  await initReceiptShare(root, artifact, {
    prepareReceiptShare: async value => {
      assert.equal(value, artifact);
      prepared = true;
      return { receiptId: "v2-0123456789abcdef" };
    },
    encodeReceipt: async (value, options) => {
      assert.equal(value, artifact);
      assert.equal(prepared, true);
      assert.deepEqual(options, {
        confirmed: true,
        expectedReceiptId: "v2-0123456789abcdef",
      });
      return { url: "receipt.html#a=fixture&h=" + "d".repeat(64) };
    },
  });
  assert.match(textTree(root), /Open receipt/);
});

test("marks schema v1 and incomplete v2 evidence without upgrading either to stable", () => {
  assert.deepEqual(createInboxView([legacyArtifact()])[0].verdict, {
    label: "LEGACY V1 — stability not established",
    tone: "neutral",
  });

  const singleSample = schemaV2Artifact();
  singleSample.repeats = 1;
  singleSample.samples.bad = singleSample.samples.bad.slice(0, 1);
  singleSample.samples.good = singleSample.samples.good.slice(0, 1);
  assert.deepEqual(createInboxView([singleSample])[0].verdict, {
    label: "INCOMPLETE V2 EVIDENCE",
    tone: "neutral",
  });
});

test("ignores corrupt stored inbox data", () => {
  assert.deepEqual(loadInbox(memoryStorage({ [INBOX_STORAGE_KEY]: "{" })), []);
  assert.deepEqual(loadInbox(memoryStorage({ [INBOX_STORAGE_KEY]: "{}" })), []);
  const storage = memoryStorage({
    [INBOX_STORAGE_KEY]: JSON.stringify([null, 42, {}, fixture]),
  });
  assert.deepEqual(loadInbox(storage), [fixture]);
  assert.deepEqual(storeArtifact(fixture, storage), { ok: true });
  assert.deepEqual(loadInbox(storage), [fixture, fixture]);
});

test("offers a small signed artifact as an openable and copyable receipt link", async () => {
  const document = fakeDocument();
  const root = new Element(document, "section");
  const copied = [];
  await initReceiptShare(root, fixture, {
    clipboard: { writeText: async value => copied.push(value) },
  });

  const open = findByTag(root, "a")[0];
  const copy = findByTag(root, "button")[0];
  assert.match(open.href, /^https:\/\/gatehouse\.test\/app\/receipt\.html#a=[A-Za-z0-9_-]+&h=[a-f0-9]{64}$/);
  assert.equal(open.textContent, "Open receipt");
  assert.equal(copy.textContent, "Copy receipt link");
  assert.equal(findByTag(root, "p").at(-1).getAttribute("aria-live"), "polite");
  assert.match(textTree(root), /fits the 6 KB sharing limit/);

  await copy.listeners.click();
  assert.deepEqual(copied, [open.href]);
  assert.match(textTree(root), /Receipt link copied/);
});

test("explains and downloads the JSON fallback when a receipt exceeds 6 KB", async () => {
  const document = fakeDocument();
  const root = new Element(document, "section");
  const revoked = [];
  const json = JSON.stringify(fixture);
  const cleanup = await initReceiptShare(root, fixture, {
    encodeReceipt: async () => ({ download: json }),
    createObjectURL: blob => {
      assert.equal(blob.type, "application/json");
      assert.equal(blob.size, new Blob([json]).size);
      return "blob:receipt-json";
    },
    revokeObjectURL: value => revoked.push(value),
  });

  const download = findByTag(root, "a")[0];
  assert.equal(download.href, "blob:receipt-json");
  assert.equal(download.download, "gatehouse-receipt-demo-lib-001.json");
  assert.equal(download.textContent, "Download receipt JSON");
  assert.match(textTree(root), /exceeds the 6 KB link limit/);
  assert.match(textTree(root), /share the JSON file instead/);

  cleanup();
  assert.deepEqual(revoked, ["blob:receipt-json"]);
});

test("releases generated detail downloads on redraw and dispose", () => {
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
  const revoked = [];
  let nextBlob = 0;
  const unsubscribe = init(root, {
    storage,
    bus: eventBus,
    encodeReceipt: async () => ({ url: "receipt.html#a=fixture" }),
    createObjectURL: () => `blob:adopt-${nextBlob += 1}`,
    revokeObjectURL: value => revoked.push(value),
  });

  storeArtifact(fixture, storage);
  handlers.get("signed")({ artifact: fixture });
  storeArtifact(structuredClone(fixture), storage);
  handlers.get("signed")({ artifact: fixture });
  assert.deepEqual(revoked, ["blob:adopt-1"]);

  unsubscribe();
  assert.deepEqual(revoked, ["blob:adopt-1", "blob:adopt-2"]);
});
