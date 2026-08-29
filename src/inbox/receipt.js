import { sha256Hex } from "../shared/hash.js";

const URL_PAYLOAD_LIMIT = 6 * 1024;
const COMPRESSED_LIMIT = 64 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/;
const ARTIFACT_KEYS = [
  "badSha256",
  "badVersion",
  "goodSha256",
  "goodVersion",
  "issueUrl",
  "library",
  "repro",
  "reproSha256",
  "runs",
  "signedAt",
  "targetId",
  "targetKind",
  "timeline",
  "ua",
  "v",
];
const RUN_KEYS = ["bundleSha256", "durationMs", "logs", "verdict", "version"];
const TIMELINE_KEYS = ["at", "detail", "event"];

function hasExactKeys(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isString(value) {
  return typeof value === "string";
}

function isRun(run) {
  return hasExactKeys(run, RUN_KEYS)
    && (run.version === "bad" || run.version === "good")
    && ["pass", "fail", "error", "timeout"].includes(run.verdict)
    && Array.isArray(run.logs)
    && run.logs.every(isString)
    && Number.isFinite(run.durationMs)
    && run.durationMs >= 0
    && SHA256_RE.test(run.bundleSha256);
}

function isTimelineEntry(entry) {
  return hasExactKeys(entry, TIMELINE_KEYS)
    && isString(entry.at)
    && isString(entry.event)
    && isString(entry.detail);
}

function isArtifact(artifact) {
  return hasExactKeys(artifact, ARTIFACT_KEYS)
    && artifact.v === 1
    && isString(artifact.targetId)
    && isString(artifact.library)
    && isString(artifact.badVersion)
    && isString(artifact.goodVersion)
    && SHA256_RE.test(artifact.badSha256)
    && SHA256_RE.test(artifact.goodSha256)
    && isString(artifact.repro)
    && SHA256_RE.test(artifact.reproSha256)
    && Array.isArray(artifact.runs)
    && artifact.runs.every(isRun)
    && Array.isArray(artifact.timeline)
    && artifact.timeline.every(isTimelineEntry)
    && isString(artifact.signedAt)
    && isString(artifact.ua)
    && (artifact.issueUrl === null || isString(artifact.issueUrl))
    && (artifact.targetKind === "real" || artifact.targetKind === "seed");
}

async function transform(bytes, stream) {
  const readable = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(readable).arrayBuffer());
}

function toBase64Url(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(payload) {
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) throw new Error("invalid base64url payload");
  const padding = "=".repeat((4 - payload.length % 4) % 4);
  const binary = atob(payload.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function getPayload(hash) {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  const payload = new URLSearchParams(fragment).get("a");
  if (!payload) throw new Error("missing receipt payload");
  return payload;
}

export async function encodeReceipt(artifact) {
  const json = JSON.stringify(artifact);
  const compressed = await transform(
    new TextEncoder().encode(json),
    new CompressionStream("deflate-raw"),
  );
  const payload = toBase64Url(compressed);
  if (payload.length <= URL_PAYLOAD_LIMIT) return { url: `receipt.html#a=${payload}` };
  return { download: json };
}

export async function decodeReceipt(hash) {
  try {
    const payload = getPayload(hash);
    if (payload.length > Math.ceil(COMPRESSED_LIMIT * 4 / 3)) {
      return { error: "receipt payload exceeds 64KB" };
    }
    const compressed = fromBase64Url(payload);
    if (compressed.byteLength > COMPRESSED_LIMIT) {
      return { error: "receipt payload exceeds 64KB" };
    }
    const decompressed = await transform(compressed, new DecompressionStream("deflate-raw"));
    const artifact = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decompressed));
    if (!isArtifact(artifact)) return { error: "receipt artifact does not match the required schema" };
    const reproHashOk = await sha256Hex(artifact.repro) === artifact.reproSha256;
    return { artifact, reproHashOk };
  } catch {
    return { error: "receipt payload is invalid" };
  }
}
