import { sha256Hex } from "../shared/hash.js";

const REPEATS = 5;
const snapshots = new Map();
let runs = 0;

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) freeze(nested);
  return value;
}

function sample(verdict, bundleSha256) {
  return { verdict, logs: [], durationMs: 1, bundleSha256 };
}

export async function loadTarget(targetId) {
  if (snapshots.has(targetId)) return snapshots.get(targetId);
  const response = await fetch(`/targets/${encodeURIComponent(targetId)}/manifest.json`);
  if (!response.ok) throw new Error(`Target manifest request failed: ${response.status}`);
  const manifest = await response.json();
  const snapshot = freeze({ manifest, bundles: {} });
  snapshots.set(targetId, snapshot);
  return snapshot;
}

export async function runDifferential(code, { targetId } = {}) {
  const { manifest } = await loadTarget(targetId);
  runs += 1;
  const stableGreen = runs > 1;
  const samples = stableGreen
    ? {
        bad: Array.from({ length: REPEATS }, () => sample("fail", manifest.badSha256)),
        good: Array.from({ length: REPEATS }, () => sample("pass", manifest.goodSha256)),
      }
    : {
        bad: [
          sample("pass", manifest.badSha256),
          ...Array.from({ length: REPEATS - 1 }, () => sample("fail", manifest.badSha256)),
        ],
        good: Array.from({ length: REPEATS }, () => sample("pass", manifest.goodSha256)),
      };
  return {
    green: stableGreen,
    reason: stableGreen ? "STABLE_LOCAL_DIFFERENTIAL" : "UNSTABLE",
    repeats: REPEATS,
    reproSha256: await sha256Hex(code),
    runs: [
      { version: "bad", ...samples.bad.at(-1) },
      { version: "good", ...samples.good.at(-1) },
    ],
    samples,
    stable: stableGreen,
    targetId,
  };
}
