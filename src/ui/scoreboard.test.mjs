import { test } from "node:test";
import assert from "node:assert/strict";
import { init } from "./scoreboard.js";

class FakeElement {
  constructor() {
    this.attributes = {};
    this.textContent = "";
  }

  replaceChildren() {
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

function setup() {
  const listeners = new Map();
  const bus = {
    on(type, listener) {
      listeners.set(type, listener);
      return () => listeners.delete(type);
    },
  };
  const root = new FakeElement();
  const dispose = init(root, { bus });
  return { root, listeners, dispose };
}

test("scoreboard counts runs, green verdicts, and gate openings per session", () => {
  const { root, listeners } = setup();
  assert.equal(root.textContent, "0 runs · 0 green · gate opened 0 · per-session");

  listeners.get("run")({ verdict: { green: false } });
  listeners.get("run")({ verdict: { green: true } });
  listeners.get("surface")({ change: "revoked", tool: "submit_report" });
  listeners.get("surface")({ change: "registered", tool: "submit_report" });

  assert.equal(root.textContent, "2 runs · 1 green · gate opened 1 · per-session");
  assert.equal(root.attributes.role, "status");
});

test("scoreboard dispose removes both listeners", () => {
  const { listeners, dispose } = setup();
  assert.equal(listeners.size, 2);
  dispose();
  assert.equal(listeners.size, 0);
});

test("scoreboard requires the shared bus dependency", () => {
  assert.throws(() => init(new FakeElement()), /deps\.bus/);
});
