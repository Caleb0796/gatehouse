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

test("schema v2 renders and replays repeated samples without reading a missing runs field", async () => {
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

  const second = schemaV2Artifact();
  second.targetId = "newest-report";
  assert.deepEqual(storeArtifact(second, storage), { ok: true });
  handlers.get("signed")({ artifact: second });
  assert.match(textTree(root), /gatehouse-demo-lib · newest-report/);
  findByTag(root, "button")[1].listeners.click();
  const detail = findByTag(root, "article")[0];
  assert.match(textTree(detail), /gatehouse-demo-lib · demo-lib-001/);

  unsubscribe();
  assert.equal(handlers.has("signed"), false);
});

test("signed events only reload artifacts already persisted by signing", () => {
  const storage = memoryStorage();
  let writes = 0;
  const setItem = storage.setItem;
  storage.setItem = (...args) => {
    writes += 1;
    setItem(...args);
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

test("sharing shows the exact public preview and requires a second confirmation", async () => {
  const storage = memoryStorage();
  const artifact = schemaV2Artifact();
  artifact.repro = 'fetch("http://127.0.0.1/internal", { headers: { Authorization: "Bearer token" } }); // ghp_abcdefgh';
  assert.deepEqual(storeArtifact(artifact, storage), { ok: true });
  const document = fakeDocument();
  const root = new Element(document, "section");
  init(root, {
    storage,
    bus: { on: () => () => {} },
    createObjectURL: () => "blob:receipt",
  });
  const share = findByTag(root, "section").find(section => section.className === "inbox-share");
  const reviewButton = findByTag(share, "button")
    .find(button => button.textContent === "Review receipt before sharing");

  await reviewButton.listeners.click();

  const reviewed = textTree(share);
  assert.match(reviewed, /shared with third parties/);
  assert.match(reviewed, /Sample logs are excluded by default/);
  assert.match(reviewed, /Possible GitHub token/);
  assert.match(reviewed, /Possible bearer credential/);
  assert.match(reviewed, /Possible private-network URL/);
  assert.doesNotMatch(reviewed, /"logs"/);
  const confirmButton = findByTag(share, "button")
    .find(button => button.textContent === "Confirm and create receipt");
  assert.ok(confirmButton);

  await confirmButton.listeners.click();

  assert.match(textTree(share), /Open receipt|Download receipt JSON/);
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
