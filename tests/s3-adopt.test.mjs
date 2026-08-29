import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createRegressionTest,
  initAdopt,
} from "../src/inbox/adopt.js";

const fixture = JSON.parse(await readFile(
  new URL("../contracts/fixtures/artifact.sample.json", import.meta.url),
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

test("generates a node:test regression with build and issue provenance", () => {
  const adopted = createRegressionTest(fixture);

  assert.equal(adopted.filename, "regression-demo-lib-001.test.mjs");
  assert.match(adopted.source, /import assert from "node:assert\/strict"/);
  assert.match(adopted.source, /import test from "node:test"/);
  assert.match(adopted.source, /Reported-bad: gatehouse-demo-lib 1\.1\.0/);
  assert.match(adopted.source, /Last-good: gatehouse-demo-lib 1\.0\.0/);
  assert.match(adopted.source, /Issue: \(none\)/);
  for (const line of fixture.repro.split("\n")) {
    assert.ok(adopted.source.includes(line));
  }
});

test("makes target IDs safe for download filenames and comments", () => {
  const artifact = structuredClone(fixture);
  artifact.targetId = "../odd target\nname";
  artifact.issueUrl = "https://example.test/issue\nforged header";

  const adopted = createRegressionTest(artifact);
  assert.equal(adopted.filename, "regression-odd-target-name.test.mjs");
  assert.match(adopted.source, /Issue: https:\/\/example\.test\/issue forged header/);
});

test("renders working copy and download controls", async () => {
  const document = fakeDocument();
  const root = new Element(document, "section");
  const copied = [];
  const revoked = [];
  const cleanup = initAdopt(root, fixture, {
    clipboard: { writeText: async value => copied.push(value) },
    createObjectURL: blob => {
      assert.equal(blob.type, "text/javascript");
      return "blob:regression-test";
    },
    revokeObjectURL: value => revoked.push(value),
  });

  const copy = root.children.find(child => child.tagName === "button");
  const download = root.children.find(child => child.tagName === "a");
  await copy.listeners.click();

  assert.equal(copied[0], createRegressionTest(fixture).source);
  assert.equal(download.href, "blob:regression-test");
  assert.equal(download.download, "regression-demo-lib-001.test.mjs");
  assert.equal(download.textContent, "Download test");
  assert.equal(root.children.at(-1).textContent, "Copied");

  cleanup();
  assert.deepEqual(revoked, ["blob:regression-test"]);
});
