import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const draft = await readFile(
  new URL("../src/inbox/for-maintainers.draft.md", import.meta.url),
  "utf8",
);

test("provides a required GitHub issue form field accepting a URL or JSON receipt", () => {
  assert.match(draft, /```yaml[\s\S]*- type: textarea/);
  assert.match(draft, /id: gatehouse_receipt/);
  assert.match(draft, /label: Gatehouse receipt URL or JSON/);
  assert.match(draft, /required: true/);
  assert.match(draft, /including #a=/);
  assert.match(draft, /drag the downloaded Gatehouse v2 JSON receipt/);
});

test("provides bot copy for issues without a receipt", () => {
  assert.match(draft, /For an issue submitted without a receipt, a bot can reply:/);
  assert.match(draft, /> Thanks for the report\./);
  assert.match(draft, /does not include a Gatehouse receipt/);
  assert.match(draft, /complete receipt URL—including the `#a=\.\.\.` fragment/);
  assert.match(draft, /attach the downloaded Gatehouse v2 JSON receipt/);
  assert.match(draft, /Import receipt JSON/);
});
