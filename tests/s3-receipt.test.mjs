import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import test from "node:test";
import {
  decodeReceipt,
  encodeReceipt,
  importReceiptJson,
  prepareReceiptShare,
  scanReceiptSecrets,
  validateReceiptArtifact,
} from "../src/inbox/receipt.js";
import { sha256Hex } from "../src/shared/hash.js";

const badSha256 = "a".repeat(64);
const goodSha256 = "b".repeat(64);

function payloadFromUrl(url) {
  return new URLSearchParams(url.slice(url.indexOf("#") + 1)).get("a");
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function sample(verdict, bundleSha256, index, logs = []) {
  return { verdict, logs, durationMs: 10 + index, bundleSha256 };
}

async function validArtifact(repro = "assert(example.value === 4, 'regression')") {
  return {
    v: 2,
    targetId: "demo-lib-001",
    library: "gatehouse-demo-lib",
    badVersion: "1.1.0",
    goodVersion: "1.0.0",
    badSha256,
    goodSha256,
    repro,
    reproSha256: await sha256Hex(repro),
    green: true,
    reason: "STABLE_LOCAL_DIFFERENTIAL",
    stable: true,
    repeats: 5,
    samples: {
      bad: Array.from({ length: 5 }, (_, index) => sample(
        "fail",
        badSha256,
        index,
        [`bad sample ${index}`, `detail ${index}`],
      )),
      good: Array.from({ length: 5 }, (_, index) => sample(
        "pass",
        goodSha256,
        index,
        [`good sample ${index}`],
      )),
    },
    timeline: [
      { at: "2026-08-29T10:05:00Z", event: "green", detail: "STABLE_LOCAL_DIFFERENTIAL" },
      { at: "2026-08-29T10:07:00Z", event: "signed", detail: "" },
    ],
    signedAt: "2026-08-29T10:07:00Z",
    ua: "fixture",
    issueUrl: null,
    targetKind: "seed",
  };
}

async function confirmedEncode(artifact, options = {}) {
  const review = await prepareReceiptShare(artifact, options);
  assert.equal(review.error, undefined);
  const encoded = await encodeReceipt(artifact, {
    ...options,
    confirmed: true,
    expectedReceiptId: review.receiptId,
  });
  return { review, encoded };
}

test("round-trips and interoperates with node:zlib raw deflate", async () => {
  const artifact = await validArtifact();
  const { review, encoded } = await confirmedEncode(artifact);
  assert.ok("url" in encoded);
  assert.ok(encoded.url.length <= 6 * 1024);
  assert.deepEqual(
    JSON.parse(inflateRawSync(Buffer.from(payloadFromUrl(encoded.url), "base64url"))),
    review.publicArtifact,
  );

  const nodePayload = base64Url(deflateRawSync(review.canonicalJson));
  const decoded = await decodeReceipt(`#a=${nodePayload}`);
  assert.deepEqual(decoded.artifact, review.publicArtifact);
  assert.equal(decoded.reproHashOk, true);
  assert.equal(decoded.receiptId, review.receiptId);
  assert.equal(decoded.receiptSha256, review.receiptSha256);
  assert.equal(decoded.receiptHashOk, null);
});

test("reports repro consistency and rejects a mismatched receipt-link hash", async () => {
  const artifact = await validArtifact();
  const matching = (await confirmedEncode(artifact)).encoded;
  const matchingResult = await decodeReceipt(matching.url.slice(matching.url.indexOf("#")));
  assert.equal(matchingResult.reproHashOk, true);
  assert.equal(matchingResult.receiptHashOk, true);
  const changedHash = matching.url.replace(/h=[a-f0-9]{64}/, `h=${"f".repeat(64)}`);
  assert.deepEqual(await decodeReceipt(changedHash.slice(changedHash.indexOf("#"))), {
    error: "receipt content hash does not match the link",
  });

  artifact.reproSha256 = "0".repeat(64);
  const mismatched = (await confirmedEncode(artifact)).encoded;
  assert.equal((await decodeReceipt(mismatched.url.slice(mismatched.url.indexOf("#")))).reproHashOk, false);
});

test("requires a reviewed public preview and matching second confirmation", async () => {
  const artifact = await validArtifact();
  const review = await encodeReceipt(artifact);
  assert.equal(review.confirmationRequired, true);
  assert.match(review.shareWarning, /shared with third parties/);
  assert.match(review.shareWarning, /logs are excluded/i);
  assert.equal(review.logsIncluded, false);
  assert.ok(review.preview.includes(artifact.repro));
  assert.equal("url" in review, false);
  assert.equal("download" in review, false);

  artifact.repro += "\n// changed after review";
  artifact.reproSha256 = await sha256Hex(artifact.repro);
  const refused = await encodeReceipt(artifact, {
    confirmed: true,
    expectedReceiptId: review.receiptId,
  });
  assert.equal(refused.code, "CONFIRMATION_REQUIRED");
  assert.equal("url" in refused, false);
  assert.equal("download" in refused, false);
});

test("projects before hashing and recursively removes every sample log by default", async () => {
  const artifact = await validArtifact();
  const first = await prepareReceiptShare(artifact);
  assert.doesNotMatch(first.canonicalJson, /"logs"/);
  assert.doesNotMatch(JSON.stringify(first.publicArtifact), /"logs"/);

  artifact.samples.bad[0].logs = ["a different private log"];
  artifact.samples.good[4].logs = ["another private log"];
  const changedLogs = await prepareReceiptShare(artifact);
  assert.equal(changedLogs.receiptId, first.receiptId);
  assert.equal(changedLogs.receiptSha256, first.receiptSha256);

  artifact.repro += "\n// public change";
  artifact.reproSha256 = await sha256Hex(artifact.repro);
  const changedPublicContent = await prepareReceiptShare(artifact);
  assert.notEqual(changedPublicContent.receiptId, first.receiptId);

  const withLogs = await prepareReceiptShare(artifact, { includeLogs: true });
  assert.match(withLogs.canonicalJson, /"logs"/);
  assert.equal(withLogs.logsIncluded, true);
  assert.match(withLogs.shareWarning, /logs are included/i);
});

test("flags common credentials and private URLs in the repro as a best-effort scan", async () => {
  const repro = [
    "ghp_0123456789abcdef",
    "Authorization: Bearer abc.def.ghi",
    "AKIA1234567890ABCDEF",
    "http://192.168.10.20/internal",
  ].join("\n");
  const warnings = scanReceiptSecrets(repro);
  assert.deepEqual(warnings.map(({ code }) => code), [
    "GITHUB_TOKEN",
    "BEARER_TOKEN",
    "AWS_ACCESS_KEY",
    "PRIVATE_URL",
  ]);
  assert.ok(warnings.every(({ message }) => /best-effort/.test(message)));

  const artifact = await validArtifact(repro);
  const review = await prepareReceiptShare(artifact);
  assert.deepEqual(review.secretWarnings, warnings);

  for (const privateUrl of [
    "http://169.254.169.254/latest/meta-data/",
    "http://[fd00::1]/admin",
    "http://[fe80::1]/metadata",
    "http://[::ffff:127.0.0.1]/mapped-loopback",
    "http://[::ffff:10.0.0.1]/mapped-private",
    "http://[::]/unspecified",
  ]) {
    assert.deepEqual(scanReceiptSecrets(privateUrl).map(({ code }) => code), ["PRIVATE_URL"]);
  }
});

test("measures the complete encoded fragment and downloads public JSON above 6KB", async () => {
  const artifact = await validArtifact();
  artifact.repro = randomBytes(12000).toString("base64");
  artifact.reproSha256 = await sha256Hex(artifact.repro);
  const { review, encoded } = await confirmedEncode(artifact);
  assert.equal(encoded.code, "URL_BUDGET_EXCEEDED");
  assert.equal(encoded.download, review.canonicalJson);
  assert.doesNotMatch(encoded.download, /"logs"/);
  assert.match(encoded.guidance, /import it on the receipt page/i);
  assert.ok(new TextEncoder().encode(encoded.download).byteLength <= 32 * 1024);
});

test("rejects compressed payloads above 64KB", async () => {
  const payload = base64Url(new Uint8Array(64 * 1024 + 1));
  assert.deepEqual(await decodeReceipt(`#a=${payload}`), {
    error: "receipt payload exceeds the 64KB compressed limit",
  });
});

test("stops decompression once output exceeds the 32KB artifact limit", async () => {
  const payload = base64Url(deflateRawSync(JSON.stringify({ padding: "x".repeat(40 * 1024) })));
  assert.deepEqual(await decodeReceipt(`#a=${payload}`), {
    error: "receipt data exceeds the 32KB decompressed limit",
  });
});

test("returns an error instead of throwing for a damaged payload", async () => {
  const result = await decodeReceipt("#a=bm90LWRlZmxhdGU");
  assert.deepEqual(result, { error: "receipt payload is invalid" });
});

test("strictly validates schema v2 fields, sample counts, logs, hashes, dates, and UTF-8 size", async () => {
  const artifact = await validArtifact();
  assert.equal(validateReceiptArtifact(artifact), true);

  const mutations = [
    value => { delete value.issueUrl; },
    value => { value.v = 1; },
    value => { value.signedAt = "not-a-date"; },
    value => { value.signedAt = "2026-02-30T10:07:00Z"; },
    value => { value.samples.bad.pop(); },
    value => { value.samples.bad[0].logs = Array(6).fill("log"); },
    value => { value.samples.good[0].logs = ["x".repeat(201)]; },
    value => { value.samples.bad[4].bundleSha256 = "f".repeat(64); },
    value => { value.samples.bad[0].verdict = "pass"; },
    value => { value.samples.good[0].verdict = "fail"; },
    value => { value.repeats = 4; value.samples.bad.pop(); value.samples.good.pop(); },
    value => { value.samples.bad[0] = null; },
    value => { delete value.samples.good[2]; },
    value => { delete value.samples.bad[0].logs; },
  ];
  for (const mutate of mutations) {
    const invalid = structuredClone(artifact);
    mutate(invalid);
    assert.equal(validateReceiptArtifact(invalid), false);
  }

  const oversized = structuredClone(artifact);
  oversized.repro = "é".repeat(17_000);
  oversized.reproSha256 = await sha256Hex(oversized.repro);
  assert.equal(validateReceiptArtifact(oversized), false);
});

test("explicitly rejects v1 instead of guessing an upgrade", async () => {
  const v1 = { v: 1 };
  const payload = base64Url(deflateRawSync(JSON.stringify(v1)));
  assert.deepEqual(await decodeReceipt(`#a=${payload}`), {
    error: "receipt artifact schema v1 is not supported; regenerate it as v2",
  });
});

test("imports downloaded JSON with size, schema, and repro-hash checks", async () => {
  const artifact = await validArtifact();
  const review = await prepareReceiptShare(artifact);
  const imported = await importReceiptJson(review.canonicalJson);
  assert.deepEqual(imported.artifact, review.publicArtifact);
  assert.equal(imported.reproHashOk, true);
  assert.equal(imported.receiptId, review.receiptId);
  assert.equal(imported.receiptHashOk, null);

  assert.deepEqual(await importReceiptJson('{"v":2}'), {
    error: "receipt artifact does not match the required schema v2",
  });
  assert.deepEqual(await importReceiptJson("not JSON"), {
    error: "receipt JSON is invalid",
  });
  assert.deepEqual(await importReceiptJson("x".repeat(32 * 1024 + 1)), {
    error: "receipt JSON exceeds the 32KB size limit",
  });
});

test("gives actionable JSON fallbacks when compression streams are unavailable", async () => {
  const artifact = await validArtifact();
  const review = await prepareReceiptShare(artifact);
  const encoded = await encodeReceipt(artifact, {
    confirmed: true,
    expectedReceiptId: review.receiptId,
    Compression: null,
  });
  assert.equal(encoded.code, "COMPRESSION_UNAVAILABLE");
  assert.equal(encoded.download, review.canonicalJson);
  assert.match(encoded.guidance, /Download the JSON receipt/);

  const unavailable = await decodeReceipt("#a=eA", { Decompression: null });
  assert.equal(unavailable.code, "DECOMPRESSION_UNAVAILABLE");
  assert.match(unavailable.error, /import the JSON receipt/i);

  class UnsupportedDecompression {
    constructor() {
      throw new TypeError("unsupported format");
    }
  }
  const unsupported = await decodeReceipt("#a=eA", { Decompression: UnsupportedDecompression });
  assert.equal(unsupported.code, "DECOMPRESSION_UNAVAILABLE");
  assert.match(unsupported.error, /deflate-raw/);
});
