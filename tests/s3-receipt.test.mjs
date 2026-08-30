import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import test from "node:test";
import { decodeReceipt, encodeReceipt } from "../src/inbox/receipt.js";
import { sha256Hex } from "../src/shared/hash.js";

const fixture = JSON.parse(await readFile(
  new URL("../contracts/fixtures/artifact.sample.json", import.meta.url),
  "utf8",
));

function payloadFromUrl(url) {
  return url.slice(url.indexOf("#a=") + 3);
}

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

async function validArtifact() {
  const artifact = structuredClone(fixture);
  artifact.reproSha256 = await sha256Hex(artifact.repro);
  return artifact;
}

test("round-trips and interoperates with node:zlib raw deflate", async () => {
  const artifact = await validArtifact();
  const encoded = await encodeReceipt(artifact);
  assert.ok("url" in encoded);
  assert.deepEqual(JSON.parse(inflateRawSync(Buffer.from(payloadFromUrl(encoded.url), "base64url"))), artifact);

  const nodePayload = base64Url(deflateRawSync(JSON.stringify(artifact)));
  assert.deepEqual(await decodeReceipt(`#a=${nodePayload}`), { artifact, reproHashOk: true });
});

test("reports matching and mismatched repro hashes", async () => {
  const artifact = await validArtifact();
  const matching = await encodeReceipt(artifact);
  assert.equal((await decodeReceipt(matching.url.slice(matching.url.indexOf("#")))).reproHashOk, true);

  artifact.reproSha256 = "0".repeat(64);
  const mismatched = await encodeReceipt(artifact);
  assert.equal((await decodeReceipt(mismatched.url.slice(mismatched.url.indexOf("#")))).reproHashOk, false);
});

test("falls back to a JSON download above the 6KB URL budget", async () => {
  const artifact = await validArtifact();
  artifact.repro = randomBytes(12000).toString("base64");
  artifact.reproSha256 = await sha256Hex(artifact.repro);
  const encoded = await encodeReceipt(artifact);
  assert.deepEqual(encoded, { download: JSON.stringify(artifact) });
});

test("rejects compressed payloads above 64KB", async () => {
  const payload = base64Url(new Uint8Array(64 * 1024 + 1));
  assert.deepEqual(await decodeReceipt(`#a=${payload}`), { error: "receipt payload exceeds 64KB" });
});

test("rejects a compression bomb above the decompressed 64KB limit", async () => {
  const artifact = await validArtifact();
  artifact.repro = "a".repeat(70 * 1024);
  artifact.reproSha256 = await sha256Hex(artifact.repro);
  const compressed = deflateRawSync(JSON.stringify(artifact));
  assert.ok(compressed.byteLength < 64 * 1024);

  assert.deepEqual(await encodeReceipt(artifact), { download: JSON.stringify(artifact) });
  assert.deepEqual(await decodeReceipt(`#a=${base64Url(compressed)}`), {
    error: "receipt payload exceeds 64KB",
  });
});

test("returns an error instead of throwing for a damaged payload", async () => {
  const result = await decodeReceipt("#a=bm90LWRlZmxhdGU");
  assert.deepEqual(result, { error: "receipt payload is invalid" });
});

test("rejects an artifact with a missing field", async () => {
  const artifact = await validArtifact();
  delete artifact.issueUrl;
  const payload = base64Url(deflateRawSync(JSON.stringify(artifact)));
  assert.deepEqual(await decodeReceipt(`#a=${payload}`), {
    error: "receipt artifact does not match the required schema",
  });
});

test("rejects receipts without exactly one bad and one good run", async () => {
  const artifact = await validArtifact();
  artifact.runs[1] = structuredClone(artifact.runs[0]);
  const payload = base64Url(deflateRawSync(JSON.stringify(artifact)));

  assert.deepEqual(await decodeReceipt(`#a=${payload}`), {
    error: "receipt artifact does not match the required schema",
  });
});

test("rejects receipts whose claimed build hashes differ from run evidence", async () => {
  const artifact = await validArtifact();
  artifact.badSha256 = "c".repeat(64);
  const payload = base64Url(deflateRawSync(JSON.stringify(artifact)));

  assert.deepEqual(await decodeReceipt(`#a=${payload}`), {
    error: "receipt artifact does not match the required schema",
  });
});
