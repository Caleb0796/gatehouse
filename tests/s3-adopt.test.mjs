import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  createRegressionTest,
  initAdopt,
} from "../src/inbox/adopt.js";

const run = promisify(execFile);

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
  assert.equal(adopted.ready, false);
  assert.match(adopted.source, /import assert from "node:assert\/strict"/);
  assert.match(adopted.source, /import test from "node:test"/);
  assert.match(adopted.source, /Template only: import the target package/);
  assert.match(adopted.source, /test\.skip\(/);
  assert.match(adopted.guidance, /sandbox-global binding/);
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

test("generates a runnable qs-500 node:test with the sandbox Qs global bound", async t => {
  const artifact = structuredClone(fixture);
  artifact.targetId = "qs-500";
  artifact.library = "qs";
  artifact.repro = [
    'const parsed = Qs.parse("a%252Eb=c");',
    'assert(Object.keys(parsed).length === 1 && parsed["a%2Eb"] === "c", "encoded dots must stay encoded by default");',
  ].join("\n");
  const adopted = createRegressionTest(artifact);

  assert.equal(adopted.ready, true);
  assert.match(adopted.source, /import qs from "qs"/);
  assert.match(adopted.source, /const Qs = qs/);
  assert.match(adopted.source, /\ntest\(/);
  assert.doesNotMatch(adopted.source, /test\.skip\(/);

  const directory = await mkdtemp(join(tmpdir(), "gatehouse-adopt-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const packageDirectory = join(directory, "node_modules", "qs");
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(join(packageDirectory, "package.json"), JSON.stringify({
    name: "qs",
    version: "0.0.0",
    main: "index.js",
  }));
  await writeFile(
    join(packageDirectory, "index.js"),
    'module.exports = { parse: () => ({ "a%2Eb": "c" }) };\n',
  );
  const testFile = join(directory, adopted.filename);
  await writeFile(testFile, adopted.source);

  await assert.doesNotReject(run(process.execPath, ["--test", testFile], { cwd: directory }));
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
  assert.equal(download.textContent, "Download test template");
  assert.equal(root.children.at(-1).textContent, "Template copied");

  cleanup();
  assert.deepEqual(revoked, ["blob:regression-test"]);
});
