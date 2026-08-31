import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_PROMPT, init } from "./prompt.js";

class FakeElement {
  constructor() {
    this.children = [];
    this.attributes = {};
    this.listeners = new Map();
    this.textContent = "";
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }
}

test("demo prompt is fixed, actionable, and copied verbatim", async () => {
  const root = new FakeElement();
  const writes = [];
  init(root, {
    document: { createElement: () => new FakeElement() },
    clipboard: { writeText: async text => writes.push(text) },
  });

  assert.match(DEMO_PROMPT, /get_target_info/);
  assert.match(DEMO_PROMPT, /write_repro/);
  assert.match(DEMO_PROMPT, /run_repro/);
  assert.match(DEMO_PROMPT, /submit_report/);
  assert.match(DEMO_PROMPT, /local approval/);
  assert.doesNotMatch(DEMO_PROMPT, /signature/);

  await root.children[2].listeners.get("click")();
  assert.deepEqual(writes, [DEMO_PROMPT]);
  assert.equal(root.children[3].textContent, "Prompt copied");
});

test("demo prompt reports clipboard failure", async () => {
  const root = new FakeElement();
  init(root, {
    document: { createElement: () => new FakeElement() },
    clipboard: { writeText: async () => { throw new Error("denied"); } },
  });

  await root.children[2].listeners.get("click")();
  assert.equal(root.children[3].textContent, "Copy failed");
});
