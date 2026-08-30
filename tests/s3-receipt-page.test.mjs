import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createReceiptView } from "../src/inbox/receipt-page.js";

const fixture = {
  v: 2,
  targetId: "demo-lib-001",
  library: "gatehouse-demo-lib",
  badVersion: "1.1.0",
  goodVersion: "1.0.0",
  badSha256: "a".repeat(64),
  goodSha256: "b".repeat(64),
  repro: "assert(example.value === 4)",
  reproSha256: "c".repeat(64),
  green: true,
  reason: "STABLE_LOCAL_DIFFERENTIAL",
  stable: true,
  repeats: 5,
  samples: {
    bad: Array.from({ length: 5 }, (_, index) => ({
      verdict: "fail",
      logs: [`bad ${index}`],
      durationMs: 10 + index,
      bundleSha256: "a".repeat(64),
    })),
    good: Array.from({ length: 5 }, (_, index) => ({
      verdict: "pass",
      logs: [],
      durationMs: 8 + index,
      bundleSha256: "b".repeat(64),
    })),
  },
  timeline: [{ at: "2026-08-29T10:07:00Z", event: "signed", detail: "" }],
  signedAt: "2026-08-29T10:07:00Z",
  ua: "fixture",
  issueUrl: null,
  targetKind: "seed",
};
const html = await readFile(new URL("../receipt.html", import.meta.url), "utf8");
const pageScript = await readFile(new URL("../src/inbox/receipt-page.js", import.meta.url), "utf8");

function leafValues(value) {
  if (Array.isArray(value)) return value.flatMap(leafValues);
  if (value !== null && typeof value === "object") return Object.values(value).flatMap(leafValues);
  return [value];
}

test("receipt page is static, textContent-only, and does not import the sandbox", () => {
  assert.match(html, /src="\/src\/inbox\/receipt-page\.js"/);
  assert.match(pageScript, /import \{ decodeReceipt, importReceiptJson \} from "\.\/receipt\.js"/);
  assert.doesNotMatch(`${html}\n${pageScript}`, /innerHTML/);
  assert.doesNotMatch(`${html}\n${pageScript}`, /sandbox|runner\.js|eval\(|new Function/);
  assert.match(html, /reporter-generated local evidence/i);
  assert.match(pageScript, /Download receipt JSON/);
  assert.match(pageScript, /Import receipt JSON/);
  assert.match(pageScript, /32KB maximum/);
});

test("receipt view includes every artifact value and labels claims", () => {
  const serializedView = JSON.stringify(createReceiptView(fixture, true, {
    receiptId: "v2-0123456789abcdef",
    receiptSha256: "d".repeat(64),
  }));
  for (const value of leafValues(fixture)) {
    assert.ok(serializedView.includes(JSON.stringify(value)), `missing artifact value: ${value}`);
  }
  assert.match(serializedView, /Repro source hash/);
  assert.match(serializedView, /self-consistent ✓/);
  assert.equal((serializedView.match(/as-claimed/g) ?? []).length, 4);
  assert.doesNotMatch(serializedView, /last-good/i);
});

test("receipt view separates source consistency from three unverified claims", () => {
  const view = createReceiptView(fixture, false);
  assert.deepEqual(view.states, [
    ["Repro source hash", "not self-consistent ✗"],
    ["Build origin", "not verified"],
    ["Independent run", "not verified"],
    ["Approver identity", "not verified"],
  ]);
  assert.equal(view.states.filter(([, value]) => value === "not verified").length, 3);
});

test("public projections without sample logs still render explicitly", () => {
  const publicArtifact = structuredClone(fixture);
  for (const samples of Object.values(publicArtifact.samples)) {
    for (const sample of samples) delete sample.logs;
  }
  const serializedView = JSON.stringify(createReceiptView(publicArtifact, true));
  assert.match(serializedView, /not included in this public receipt/);
});
