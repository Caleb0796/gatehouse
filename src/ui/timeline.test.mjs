import { test } from "node:test";
import assert from "node:assert/strict";
import { init } from "./timeline.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.className = "";
    this.textContent = "";
    this.classList = {
      add: (...names) => {
        this.className = [...new Set([...this.className.split(" ").filter(Boolean), ...names])].join(" ");
      },
    };
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
}

function setup() {
  const listeners = new Map();
  const bus = {
    on(type, fn) {
      listeners.set(type, fn);
      return () => listeners.delete(type);
    },
  };
  const document = { createElement: tagName => new FakeElement(tagName) };
  const root = new FakeElement("aside");
  const dispose = init(root, { bus, document, now: () => Date.UTC(2026, 7, 29, 20, 0, 0) });
  return { root, listeners, dispose };
}

test("timeline consumes all five bus event types with distinct styles", () => {
  const { root, listeners } = setup();
  const events = {
    surface: { change: "revoked", tool: "submit_report", reason: "repro edited", at: Date.UTC(2026, 7, 29, 20, 0, 1) },
    run: { verdict: { green: false, reason: "FAIL_BOTH" } },
    draft: { reproSha256: "abcdef1234567890", length: 42 },
    staged: { artifactDraft: { targetId: "marked-1234" } },
    signed: { artifact: { targetId: "marked-1234" } },
  };

  for (const [type, detail] of Object.entries(events)) listeners.get(type)(detail);

  const list = root.children[1];
  assert.equal(list.children.length, 5);
  assert.deepEqual(
    list.children.map(item => item.className),
    Object.keys(events).map(type => `timeline__item timeline__item--${type}`),
  );
  assert.match(list.children[1].children[1].children[1].textContent, /FAIL_BOTH/);
  assert.match(list.children[2].children[1].children[1].textContent, /abcdef123456/);
  assert.equal(list.children[4].children[1].children[0].textContent, "Local approval recorded");
  assert.match(list.children[4].children[1].children[1].textContent, /Approval recorded/);
});

test("green runs are described as local evidence", () => {
  const { root, listeners } = setup();

  listeners.get("run")({ verdict: { green: true } });

  assert.equal(
    root.children[1].children[0].children[1].children[1].textContent,
    "Stable local differential · green",
  );
});

test("submit_report registration receives the gate-opened memory-anchor style", () => {
  const { root, listeners } = setup();

  listeners.get("surface")({
    change: "registered",
    tool: "submit_report",
    reason: "differential green",
    at: Date.UTC(2026, 7, 29, 20, 0, 1),
  });

  const item = root.children[1].children[0];
  assert.match(item.className, /timeline__item--gate-opened/);
  assert.equal(item.attributes["aria-label"], "Gate opened: submit_report registered");
});

test("dispose removes all timeline listeners", () => {
  const { listeners, dispose } = setup();
  assert.equal(listeners.size, 5);
  dispose();
  assert.equal(listeners.size, 0);
});

test("timeline keeps only the latest activity and marks truncation", () => {
  const { root, listeners } = setup();

  for (let index = 0; index < 10_000; index += 1) {
    listeners.get("draft")({ reproSha256: String(index), length: index });
  }

  const list = root.children[1];
  assert.equal(list.children.length, 50);
  assert.equal(list.children[0].dataset.event, "history-truncated");
  assert.equal(list.children[0].textContent, "Earlier activity omitted.");
  assert.match(list.children.at(-1).children[1].children[1].textContent, /9999 characters/);
});

test("timeline requires the shared bus dependency", () => {
  const root = new FakeElement("aside");
  assert.throws(() => init(root, { document: { createElement: tagName => new FakeElement(tagName) } }), /deps\.bus/);
});
