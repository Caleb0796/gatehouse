import { test } from "node:test";
import assert from "node:assert/strict";
import { CHROME_COMMAND, init } from "../src/ui/banner.js";

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.listeners = new Map();
    this.className = "";
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

test("Chrome command excludes the dynamic page URL", async () => {
  const dynamicPart = "#;id`whoami`$(id)|cat&next=\n\"'";
  const currentUrl = `http://localhost:8080/${dynamicPart}`;
  const writes = [];
  const root = new FakeElement("aside");

  init(root, {
    document: {
      createElement: tagName => new FakeElement(tagName),
      modelContext: undefined,
    },
    window: {
      isSecureContext: true,
      location: { href: currentUrl },
    },
    navigator: { userAgent: "Mozilla/5.0 Chrome/151.0.0.0" },
    clipboard: { writeText: async text => writes.push(text) },
  });

  const setup = root.children[1];
  const chromeRow = setup.children[0];
  const pageUrlRow = setup.children[1];
  await chromeRow.children[1].listeners.get("click")();

  assert.equal(writes[0], CHROME_COMMAND);
  assert.equal(CHROME_COMMAND.includes(dynamicPart), false);
  assert.equal(pageUrlRow.children[0].textContent, "Page URL");
  assert.equal(pageUrlRow.children[1].textContent, currentUrl);
});
