import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createReceiptView } from "../src/inbox/receipt-page.js";

const fixture = JSON.parse(await readFile(
  new URL("../contracts/fixtures/artifact.sample.json", import.meta.url),
  "utf8",
));
const html = await readFile(new URL("../receipt.html", import.meta.url), "utf8");
const pageScript = await readFile(new URL("../src/inbox/receipt-page.js", import.meta.url), "utf8");

function leafValues(value) {
  if (Array.isArray(value)) return value.flatMap(leafValues);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(leafValues);
  return [value];
}

test("receipt page is static, textContent-only, and does not import the sandbox", () => {
  assert.match(html, /src="\/src\/inbox\/receipt-page\.js"/);
  assert.match(pageScript, /import \{ decodeReceipt \} from "\.\/receipt\.js"/);
  assert.doesNotMatch(`${html}\n${pageScript}`, /innerHTML/);
  assert.doesNotMatch(`${html}\n${pageScript}`, /sandbox|runner\.js|eval\(|new Function/);
  assert.match(html, /Paste this link into your GitHub issue/i);
  assert.match(html, /locally approved evidence/i);
  for (const phrase of [
    /browser-local approval is unauthenticated/,
    /does not verify identity/,
    /not a cryptographic signature/,
    /activated by automation/,
  ]) {
    assert.match(html, phrase);
    assert.match(pageScript, phrase);
  }
  assert.match(html, /rel="icon" href="data:image\/svg\+xml/);
  assert.match(pageScript, /Download receipt JSON/);
  assert.match(pageScript, /Local approval recorded at/);
  assert.doesNotMatch(`${html}\n${pageScript}`, /inspect the signed evidence|\["Signed at"/);
});

test("receipt view includes every artifact value and labels claims", () => {
  const serializedView = JSON.stringify(createReceiptView(fixture, true));
  for (const value of leafValues(fixture)) {
    assert.ok(serializedView.includes(JSON.stringify(value)), `missing artifact value: ${value}`);
  }
  assert.match(serializedView, /repro hash verified ✓/);
  assert.equal((serializedView.match(/as-claimed/g) ?? []).length, 4);
});

test("receipt view shows a failed repro hash verification", () => {
  assert.equal(createReceiptView(fixture, false).verification, "repro hash verified ✗");
});
