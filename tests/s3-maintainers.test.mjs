import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const guide = await readFile(
  new URL("../docs/for-maintainers.md", import.meta.url),
  "utf8",
);

test("provides a required GitHub issue form receipt URL field", () => {
  assert.match(guide, /```yaml[\s\S]*- type: textarea/);
  assert.match(guide, /id: gatehouse_receipt_url/);
  assert.match(guide, /label: Gatehouse receipt URL/);
  assert.match(guide, /required: true/);
  assert.match(guide, /including the #a= fragment/);
  assert.match(guide, /inspect the browser-recorded evidence, its unauthenticated local approval, and the reproduction hash/);
  for (const phrase of [
    /does not verify identity/,
    /not a cryptographic signature/,
    /automation can activate it/,
  ]) {
    assert.match(guide, phrase);
  }
  assert.doesNotMatch(guide, /receipt URL[\s\S]*inspect and replay/);
});

test("provides bot copy for issues without a receipt", () => {
  assert.match(guide, /For an issue submitted without a receipt, a bot can reply:/);
  assert.match(guide, /> Thanks for the report\./);
  assert.match(guide, /does not include a receipt URL/);
  assert.match(guide, /complete receipt URL—including the `#a=\.\.\.` fragment/);
  assert.match(guide, /record local approval/);
});
