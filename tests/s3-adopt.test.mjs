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

function textTree(node) {
  return [node.textContent, ...node.children.flatMap(textTree)].join(" ");
}

test("generates a node:test regression with build and issue provenance", () => {
  const adopted = createRegressionTest(fixture);

  assert.equal(adopted.filename, "regression-demo-lib-001.test.mjs");
  assert.equal(adopted.enabled, false);
  assert.match(adopted.source, /import assert from "node:assert\/strict"/);
  assert.match(adopted.source, /import test from "node:test"/);
  assert.match(adopted.source, /Reported-bad: gatehouse-demo-lib 1\.1\.0/);
  assert.match(adopted.source, /Comparison build: gatehouse-demo-lib 1\.0\.0/);
  assert.match(adopted.source, /Issue: \(none\)/);
  assert.ok(adopted.source.includes(JSON.stringify(fixture.repro)));
});

test("exports untrusted repro code disabled with a prominent Node warning", () => {
  const { source } = createRegressionTest(fixture);

  assert.match(source, /^\/\/ WARNING: UNTRUSTED CODE/);
  assert.match(source, /every permission granted to Node\.js/);
  assert.match(source, /isolated environment/);
  assert.match(source, /manually remove/);
  assert.match(source, /test\.skip\(/);
  assert.doesNotMatch(source, /(^|\n)\s*test\(/);
});

test("keeps callback-breaking repro text inert until the skipped test is enabled", () => {
  const artifact = structuredClone(fixture);
  artifact.repro = '}); globalThis.compromised = true; test("injected", () => {});';
  const { source } = createRegressionTest(artifact);

  assert.ok(source.includes(JSON.stringify(artifact.repro)));
  assert.doesNotMatch(source, /(^|\n)\s*}\); globalThis\.compromised/);
  assert.equal((source.match(/test\.skip\(/g) ?? []).length, 1);
  assert.doesNotMatch(source, /(^|\n)\s*test\(/);
});

test("makes target IDs safe for download filenames and comments", () => {
  const artifact = structuredClone(fixture);
  artifact.targetId = "../odd target\nname\u2028globalThis.lineSeparatorInjected = true;//";
  artifact.issueUrl = "https://example.test/issue\r\nforged header\u2029globalThis.paragraphSeparatorInjected = true;//";

  const adopted = createRegressionTest(artifact);
  assert.equal(
    adopted.filename,
    "regression-odd-target-name-globalThis.lineSeparatorInjected-true.test.mjs",
  );
  assert.match(
    adopted.source,
    /Issue: https:\/\/example\.test\/issue forged header globalThis\.paragraphSeparatorInjected = true;\/\//,
  );
  assert.doesNotMatch(adopted.source, /[\r\n\u2028\u2029]globalThis\.(?:line|paragraph)SeparatorInjected/);
  assert.equal(adopted.source.includes("\u2028"), false);
  assert.equal(adopted.source.includes("\u2029"), false);
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
  assert.match(textTree(root), /Review before enabling — untrusted code/);
  assert.equal(root.children.at(-1).textContent, "Copied");

  cleanup();
  assert.deepEqual(revoked, ["blob:regression-test"]);
});
