import { sha256Hex } from "../shared/hash.js";

const URL_PAYLOAD_LIMIT = 6 * 1024;
const COMPRESSED_LIMIT = 64 * 1024;
const ARTIFACT_LIMIT = 32 * 1024;
const SHA256_RE = /^[a-f0-9]{64}$/;
const ARTIFACT_KEYS = [
  "badSha256",
  "badVersion",
  "goodSha256",
  "goodVersion",
  "green",
  "issueUrl",
  "library",
  "reason",
  "repeats",
  "repro",
  "reproSha256",
  "samples",
  "signedAt",
  "stable",
  "targetId",
  "targetKind",
  "timeline",
  "ua",
  "v",
];
const SAMPLE_KEYS = ["bundleSha256", "durationMs", "logs", "verdict"];
const PUBLIC_SAMPLE_KEYS = ["bundleSha256", "durationMs", "verdict"];
const SAMPLE_GROUP_KEYS = ["bad", "good"];
const TIMELINE_KEYS = ["at", "detail", "event"];
const VERDICTS = new Set(["pass", "fail", "error", "timeout"]);
const SHARE_WARNING = "These complete preview contents will be shared with third parties through the receipt link or JSON file.";
const SCHEMA_ERROR = "receipt artifact does not match the required schema v2";
const VERSION_ERROR = "receipt artifact schema v1 is not supported; regenerate it as v2";

class ReceiptLimitError extends Error {}

function hasExactKeys(value, keys) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
}

function isString(value) {
  return typeof value === "string";
}

function isIsoDate(value) {
  if (!isString(value)) return false;
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/,
  );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const [, year, month, day, hour, minute, second, offsetHour = "00", offsetMinute = "00"] = match;
  const daysInMonth = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return Number(month) >= 1
    && Number(month) <= 12
    && Number(day) >= 1
    && Number(day) <= daysInMonth
    && Number(hour) <= 23
    && Number(minute) <= 59
    && Number(second) <= 59
    && Number(offsetHour) <= 23
    && Number(offsetMinute) <= 59;
}

function utf8Length(value) {
  return new TextEncoder().encode(value).byteLength;
}

function artifactFitsLimit(artifact) {
  try {
    return utf8Length(JSON.stringify(artifact)) <= ARTIFACT_LIMIT;
  } catch {
    return false;
  }
}

function isSample(sample, expectedHash, logsMode) {
  const keys = logsMode === "included" ? SAMPLE_KEYS : PUBLIC_SAMPLE_KEYS;
  return hasExactKeys(sample, keys)
    && VERDICTS.has(sample.verdict)
    && Number.isFinite(sample.durationMs)
    && sample.durationMs >= 0
    && sample.bundleSha256 === expectedHash
    && SHA256_RE.test(sample.bundleSha256)
    && (logsMode === "omitted" || (
      Array.isArray(sample.logs)
      && sample.logs.length <= 5
      && sample.logs.every(log => isString(log) && log.length <= 200)
    ));
}

function isTimelineEntry(entry) {
  return hasExactKeys(entry, TIMELINE_KEYS)
    && isString(entry.at)
    && isString(entry.event)
    && isString(entry.detail);
}

function getLogsMode(samples) {
  const entries = [...samples.bad, ...samples.good];
  if (entries.some(sample => sample === null || typeof sample !== "object" || Array.isArray(sample))) {
    return "invalid";
  }
  const withLogs = entries.filter(sample => Object.hasOwn(sample, "logs")).length;
  if (withLogs === entries.length) return "included";
  if (withLogs === 0) return "omitted";
  return "mixed";
}

export function validateReceiptArtifact(artifact, { allowOmittedLogs = true } = {}) {
  if (!hasExactKeys(artifact, ARTIFACT_KEYS)
    || artifact.v !== 2
    || !isString(artifact.targetId)
    || !isString(artifact.library)
    || !isString(artifact.badVersion)
    || !isString(artifact.goodVersion)
    || !SHA256_RE.test(artifact.badSha256)
    || !SHA256_RE.test(artifact.goodSha256)
    || !isString(artifact.repro)
    || !SHA256_RE.test(artifact.reproSha256)
    || artifact.green !== true
    || artifact.reason !== "STABLE_LOCAL_DIFFERENTIAL"
    || artifact.stable !== true
    || artifact.repeats !== 5
    || !hasExactKeys(artifact.samples, SAMPLE_GROUP_KEYS)
    || !Array.isArray(artifact.samples.bad)
    || !Array.isArray(artifact.samples.good)
    || artifact.samples.bad.length !== artifact.repeats
    || artifact.samples.good.length !== artifact.repeats
    || !Array.isArray(artifact.timeline)
    || !artifact.timeline.every(isTimelineEntry)
    || !isIsoDate(artifact.signedAt)
    || !isString(artifact.ua)
    || !(artifact.issueUrl === null || isString(artifact.issueUrl))
    || !(artifact.targetKind === "real" || artifact.targetKind === "seed")
    || !artifactFitsLimit(artifact)) {
    return false;
  }

  const logsMode = getLogsMode(artifact.samples);
  if (
    (logsMode !== "included" && logsMode !== "omitted")
    || (logsMode === "omitted" && !allowOmittedLogs)
  ) return false;
  return artifact.samples.bad.every(sample => (
    isSample(sample, artifact.badSha256, logsMode) && sample.verdict === "fail"
  )) && artifact.samples.good.every(sample => (
    isSample(sample, artifact.goodSha256, logsMode) && sample.verdict === "pass"
  ));
}

function schemaError(artifact) {
  if (artifact?.v === 1) return VERSION_ERROR;
  return SCHEMA_ERROR;
}

function cloneProjected(value, includeLogs) {
  if (Array.isArray(value)) return value.map(item => cloneProjected(item, includeLogs));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => includeLogs || key !== "logs")
    .map(([key, item]) => [key, cloneProjected(item, includeLogs)]));
}

export function projectReceiptArtifact(artifact, { includeLogs = false } = {}) {
  return cloneProjected(artifact, includeLogs);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort()
    .map(key => [key, canonicalize(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function isPrivateIpv4(parts) {
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168);
}

function mappedIpv4(host) {
  if (!host.startsWith("::ffff:")) return null;
  const suffix = host.slice("::ffff:".length);
  if (suffix.includes(".")) return suffix.split(".").map(Number);
  const words = suffix.split(":").map(word => Number.parseInt(word, 16));
  if (words.length !== 2 || words.some(word => !Number.isInteger(word) || word < 0 || word > 0xffff)) {
    return null;
  }
  return [words[0] >> 8, words[0] & 0xff, words[1] >> 8, words[1] & 0xff];
}

function isPrivateHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost"
    || host === "::"
    || host === "::1"
    || host.endsWith(".localhost")
    || host.endsWith(".local")
  ) return true;

  const mapped = mappedIpv4(host);
  if (mapped !== null) return isPrivateIpv4(mapped);

  const parts = host.split(".").map(Number);
  if (parts.length === 4 && parts.every(part => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return isPrivateIpv4(parts);
  }

  const firstHextet = Number.parseInt(host.split(":", 1)[0], 16);
  return Number.isInteger(firstHextet)
    && ((firstHextet >= 0xfc00 && firstHextet <= 0xfdff)
      || (firstHextet >= 0xfe80 && firstHextet <= 0xfebf));
}

function receiptText(value, seen = new WeakSet()) {
  if (typeof value === "string") return value;
  if (value === null || typeof value !== "object" || seen.has(value)) return "";
  seen.add(value);
  return (Array.isArray(value) ? value : Object.values(value))
    .map(item => receiptText(item, seen))
    .join("\n");
}

export function scanReceiptSecrets(value) {
  const text = receiptText(value);
  const warnings = [];
  const add = (code, message) => {
    if (!warnings.some(warning => warning.code === code)) warnings.push({ code, message });
  };

  if (/\bghp_[A-Za-z0-9_]{4,}\b/.test(text)) {
    add("GITHUB_TOKEN", "Possible GitHub token detected by a best-effort scan.");
  }
  if (/\bBearer\s+[^\s"'`]+/i.test(text)) {
    add("BEARER_TOKEN", "Possible bearer credential detected by a best-effort scan.");
  }
  if (/\bAKIA[0-9A-Z]{4,}\b/.test(text)) {
    add("AWS_ACCESS_KEY", "Possible AWS access key detected by a best-effort scan.");
  }
  for (const match of text.matchAll(/https?:\/\/[^\s"'`<>]+/gi)) {
    try {
      const url = new URL(match[0].replace(/[),.;]+$/, ""));
      if (isPrivateHostname(url.hostname)) {
        add("PRIVATE_URL", "Possible private-network URL detected by a best-effort scan.");
      }
    } catch {
      // The scanner is intentionally best-effort; invalid URL-like text is ignored.
    }
  }
  return warnings;
}

export async function prepareReceiptShare(artifact, { includeLogs = false } = {}) {
  if (!validateReceiptArtifact(artifact)) return { error: schemaError(artifact) };
  const publicArtifact = projectReceiptArtifact(artifact, { includeLogs });
  if (!validateReceiptArtifact(publicArtifact)) return { error: SCHEMA_ERROR };
  const json = canonicalJson(publicArtifact);
  const receiptSha256 = await sha256Hex(json);
  const logsIncluded = getLogsMode(publicArtifact.samples) === "included";
  return {
    publicArtifact,
    canonicalJson: json,
    preview: JSON.stringify(publicArtifact, null, 2),
    receiptId: `v2-${receiptSha256.slice(0, 16)}`,
    receiptSha256,
    shareWarning: `${SHARE_WARNING} ${logsIncluded ? "Sample logs are included." : "Sample logs are excluded by default."}`,
    secretWarnings: scanReceiptSecrets(publicArtifact),
    confirmationRequired: true,
    logsIncluded,
  };
}

async function transform(bytes, stream, maxBytes) {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new ReceiptLimitError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
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
  const params = new URLSearchParams(fragment);
  const payload = params.get("a");
  const expectedHash = params.get("h");
  if (!payload) throw new Error("missing receipt payload");
  if (expectedHash !== null && !SHA256_RE.test(expectedHash)) throw new Error("invalid receipt hash");
  return { payload, expectedHash };
}

function downloadResult(prepared, code, guidance) {
  return {
    download: prepared.canonicalJson,
    filename: `gatehouse-receipt-${prepared.receiptId}.json`,
    code,
    guidance,
    receiptId: prepared.receiptId,
    receiptSha256: prepared.receiptSha256,
    secretWarnings: prepared.secretWarnings,
  };
}

export async function encodeReceipt(artifact, {
  includeLogs = false,
  confirmed = false,
  expectedReceiptId = null,
  Compression = globalThis.CompressionStream,
} = {}) {
  const prepared = await prepareReceiptShare(artifact, { includeLogs });
  if (prepared.error) return prepared;
  if (!confirmed) return prepared;
  if (expectedReceiptId !== prepared.receiptId) {
    return {
      ...prepared,
      error: "Receipt contents changed or were not reviewed. Review the complete public preview and confirm again.",
      code: "CONFIRMATION_REQUIRED",
    };
  }
  if (typeof Compression !== "function") {
    return downloadResult(
      prepared,
      "COMPRESSION_UNAVAILABLE",
      "Compressed receipt links are unavailable in this browser. Download the JSON receipt and share the file instead.",
    );
  }

  let compressed;
  try {
    compressed = await transform(
      new TextEncoder().encode(prepared.canonicalJson),
      new Compression("deflate-raw"),
      COMPRESSED_LIMIT,
    );
  } catch {
    return downloadResult(
      prepared,
      "COMPRESSION_UNAVAILABLE",
      "This browser could not create a compressed receipt link. Download the JSON receipt and share the file instead.",
    );
  }
  const payload = toBase64Url(compressed);
  const fragment = `a=${payload}&h=${prepared.receiptSha256}`;
  const url = `receipt.html#${fragment}`;
  if (url.length <= URL_PAYLOAD_LIMIT) {
    return {
      url,
      receiptId: prepared.receiptId,
      receiptSha256: prepared.receiptSha256,
      secretWarnings: prepared.secretWarnings,
    };
  }
  return downloadResult(
    prepared,
    "URL_BUDGET_EXCEEDED",
    "This receipt is too large for a 6KB link. Download the JSON receipt and ask the maintainer to import it on the receipt page.",
  );
}

async function decodedArtifact(bytes, expectedHash, invalidError = "receipt payload is invalid") {
  if (bytes.byteLength > ARTIFACT_LIMIT) {
    return { error: "receipt data exceeds the 32KB decompressed limit" };
  }
  let artifact;
  try {
    artifact = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return { error: invalidError };
  }
  if (!validateReceiptArtifact(artifact)) return { error: schemaError(artifact) };
  const json = canonicalJson(artifact);
  const receiptSha256 = await sha256Hex(json);
  if (expectedHash !== null && expectedHash !== receiptSha256) {
    return { error: "receipt content hash does not match the link" };
  }
  const reproHashOk = await sha256Hex(artifact.repro) === artifact.reproSha256;
  return {
    artifact,
    reproHashOk,
    receiptId: `v2-${receiptSha256.slice(0, 16)}`,
    receiptSha256,
    receiptHashOk: expectedHash === null ? null : true,
  };
}

export async function decodeReceipt(hash, { Decompression = globalThis.DecompressionStream } = {}) {
  try {
    const { payload, expectedHash } = getPayload(hash);
    if (payload.length > Math.ceil(COMPRESSED_LIMIT * 4 / 3)) {
      return { error: "receipt payload exceeds the 64KB compressed limit" };
    }
    const compressed = fromBase64Url(payload);
    if (compressed.byteLength > COMPRESSED_LIMIT) {
      return { error: "receipt payload exceeds the 64KB compressed limit" };
    }
    if (typeof Decompression !== "function") {
      return {
        error: "Compressed receipt links are unavailable in this browser. Download and import the JSON receipt instead.",
        code: "DECOMPRESSION_UNAVAILABLE",
      };
    }
    let stream;
    try {
      stream = new Decompression("deflate-raw");
    } catch {
      return {
        error: "This browser cannot open deflate-raw receipt links. Download and import the JSON receipt instead.",
        code: "DECOMPRESSION_UNAVAILABLE",
      };
    }
    let decompressed;
    try {
      decompressed = await transform(
        compressed,
        stream,
        ARTIFACT_LIMIT,
      );
    } catch (error) {
      if (error instanceof ReceiptLimitError) {
        return { error: "receipt data exceeds the 32KB decompressed limit" };
      }
      return { error: "receipt payload is invalid" };
    }
    return await decodedArtifact(decompressed, expectedHash);
  } catch {
    return { error: "receipt payload is invalid" };
  }
}

async function jsonInputBytes(input) {
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    if (input.size > ARTIFACT_LIMIT) throw new ReceiptLimitError();
    return new Uint8Array(await input.arrayBuffer());
  }
  throw new TypeError("receipt JSON input must be text, bytes, or a file");
}

export async function importReceiptJson(input) {
  try {
    const bytes = await jsonInputBytes(input);
    if (bytes.byteLength > ARTIFACT_LIMIT) {
      return { error: "receipt JSON exceeds the 32KB size limit" };
    }
    return await decodedArtifact(bytes, null, "receipt JSON is invalid");
  } catch (error) {
    if (error instanceof ReceiptLimitError) {
      return { error: "receipt JSON exceeds the 32KB size limit" };
    }
    return { error: "receipt JSON is invalid" };
  }
}
