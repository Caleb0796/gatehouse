import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const draft = await readFile(
  new URL("../src/inbox/for-maintainers.draft.md", import.meta.url),
  "utf8",
);

test("provides a required GitHub issue form receipt URL field", () => {
  assert.match(draft, /```yaml[\s\S]*- type: textarea/);
  assert.match(draft, /id: gatehouse_receipt_url/);
  assert.match(draft, /label: Gatehouse receipt URL/);
  assert.match(draft, /required: true/);
  assert.match(draft, /including the #a= fragment/);
});

test("provides bot copy for issues without a receipt", () => {
  assert.match(draft, /For an issue submitted without a receipt, a bot can reply:/);
  assert.match(draft, /> Thanks for the report\./);
  assert.match(draft, /does not include a Gatehouse receipt URL/);
  assert.match(draft, /complete receipt URL—including the `#a=\.\.\.` fragment/);
});
