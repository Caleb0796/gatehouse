import { sha256Hex } from "../shared/hash.js";
import { judge } from "./differential.js";
import { createRunnerSrcdoc } from "./srcdoc.js";

const SHA256 = /^[a-f0-9]{64}$/;
const TARGET_ID = /^[a-z0-9][a-z0-9._-]*$/i;
const RUN_VERDICTS = new Set(["pass", "fail", "error", "timeout"]);
const WATCHDOG_MS = 30_000;
const targetSnapshots = new Map();

const freezeDeep = value => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeDeep(child);
  return Object.freeze(value);
};

const fetchText = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fetch failed (${response.status}): ${url}`);
  return response.text();
};

const verifyBundle = async (label, text, expectedSha256) => {
  if (!SHA256.test(expectedSha256)) throw new Error(`Invalid ${label} SHA-256 in manifest`);
  const actualSha256 = await sha256Hex(text);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`${label} bundle SHA-256 mismatch: expected ${expectedSha256}, got ${actualSha256}`);
  }
  return { sha256: actualSha256, text };
};

export async function loadTarget(id) {
  if (typeof id !== "string" || !TARGET_ID.test(id)) throw new TypeError("Invalid target id");
  if (targetSnapshots.has(id)) return targetSnapshots.get(id);

  const snapshotPromise = (async () => {
    const base = `/targets/${id}`;
    const manifestResponse = await fetch(`${base}/manifest.json`);
    if (!manifestResponse.ok) {
      throw new Error(`Fetch failed (${manifestResponse.status}): ${base}/manifest.json`);
    }
    const manifest = await manifestResponse.json();
    if (!manifest || typeof manifest !== "object") throw new Error("Invalid target manifest");

    const [badText, goodText] = await Promise.all([
      fetchText(`${base}/bad.js`),
      fetchText(`${base}/good.js`),
    ]);
    const [bad, good] = await Promise.all([
      verifyBundle("bad", badText, manifest.badSha256),
      verifyBundle("good", goodText, manifest.goodSha256),
    ]);

    return freezeDeep({ manifest, bundles: { bad, good } });
  })();
  targetSnapshots.set(id, snapshotPromise);

  try {
    return await snapshotPromise;
  } catch (error) {
    if (targetSnapshots.get(id) === snapshotPromise) targetSnapshots.delete(id);
    throw error;
  }
}

const validBundle = bundle => (
  bundle &&
  typeof bundle === "object" &&
  SHA256.test(bundle.sha256) &&
  typeof bundle.text === "string"
);

const validRun = run => (
  run &&
  typeof run === "object" &&
  SHA256.test(run.bundleSha) &&
  typeof run.globalName === "string" &&
  typeof run.code === "string" &&
  Number.isFinite(run.timeoutMs) &&
  run.timeoutMs > 0 &&
  run.timeoutMs <= WATCHDOG_MS
);

export function createRunner() {
  let iframe;
  let ready = false;
  let readyPromise;
  let resolveReady;
  let destroyed = false;
  const loadedBundles = new Map();
  const pending = new Map();

  const postLoadedBundles = () => {
    if (!ready || loadedBundles.size === 0) return;
    iframe.contentWindow.postMessage({ t: "load", bundles: [...loadedBundles.values()] }, "*");
  };

  const mount = () => {
    ready = false;
    iframe?.remove();
    readyPromise = new Promise(resolve => {
      resolveReady = resolve;
    });
    iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.sandbox = "allow-scripts";
    iframe.srcdoc = createRunnerSrcdoc();
    document.body.append(iframe);
  };

  const settle = (runId, result, reject) => {
    const entry = pending.get(runId);
    if (!entry) return;
    pending.delete(runId);
    clearTimeout(entry.watchdog);
    if (reject) entry.reject(result);
    else entry.resolve(result);
  };

  const rebuildAfterWatchdog = () => {
    for (const runId of [...pending.keys()]) {
      settle(runId, {
        verdict: "timeout",
        logs: ["Sandbox iframe watchdog exceeded 30000ms"],
        durationMs: WATCHDOG_MS,
      });
    }
    mount();
  };

  const onMessage = event => {
    if (destroyed || event.source !== iframe.contentWindow || !event.data || typeof event.data !== "object") {
      return;
    }

    if (event.data.t === "ready") {
      if (ready) return;
      ready = true;
      resolveReady();
      postLoadedBundles();
      return;
    }

    if (!ready || event.data.t !== "result" || typeof event.data.runId !== "string") return;
    const { runId } = event.data;
    if (!pending.has(runId)) return;

    if (
      !RUN_VERDICTS.has(event.data.verdict) ||
      !Array.isArray(event.data.logs) ||
      event.data.logs.some(log => typeof log !== "string") ||
      !Number.isFinite(event.data.durationMs) ||
      event.data.durationMs < 0
    ) {
      settle(runId, {
        verdict: "error",
        logs: ["Invalid iframe result envelope"],
        durationMs: 0,
      });
      return;
    }

    settle(runId, {
      verdict: event.data.verdict,
      logs: event.data.logs.slice(0, 100).map(log => log.slice(0, 500)),
      durationMs: event.data.durationMs,
    });
  };

  window.addEventListener("message", onMessage);
  mount();

  return {
    async load(bundles) {
      if (!Array.isArray(bundles) || bundles.some(bundle => !validBundle(bundle))) {
        throw new TypeError("Invalid bundle list");
      }
      for (const bundle of bundles) loadedBundles.set(bundle.sha256, bundle);
      await readyPromise;
      if (destroyed) throw new Error("Sandbox runner is destroyed");
      postLoadedBundles();
    },

    async run(input) {
      if (!validRun(input)) throw new TypeError("Invalid run request");
      await readyPromise;
      if (destroyed) throw new Error("Sandbox runner is destroyed");

      const runId = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        const watchdog = setTimeout(rebuildAfterWatchdog, WATCHDOG_MS);
        pending.set(runId, { resolve, reject, watchdog });
        iframe.contentWindow.postMessage({
          t: "run",
          runId,
          bundleSha: input.bundleSha,
          globalName: input.globalName,
          code: input.code,
          timeoutMs: input.timeoutMs,
        }, "*");
      });
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const runId of [...pending.keys()]) {
        settle(runId, new Error("Sandbox runner is destroyed"), true);
      }
      window.removeEventListener("message", onMessage);
      iframe.remove();
    },
  };
}

export async function runDifferential(code, { targetId, timeoutMs = 2_000 } = {}) {
  if (typeof code !== "string") throw new TypeError("Repro code must be a string");

  const { manifest, bundles } = await loadTarget(targetId);
  const runner = createRunner();

  try {
    await runner.load([bundles.bad, bundles.good]);
    const [badRun, goodRun] = await Promise.all([
      runner.run({
        bundleSha: bundles.bad.sha256,
        globalName: manifest.globalName,
        code,
        timeoutMs,
      }),
      runner.run({
        bundleSha: bundles.good.sha256,
        globalName: manifest.globalName,
        code,
        timeoutMs,
      }),
    ]);
    const verdict = judge(badRun, goodRun);

    return {
      ...verdict,
      runs: [
        { version: "bad", ...badRun, bundleSha256: bundles.bad.sha256 },
        { version: "good", ...goodRun, bundleSha256: bundles.good.sha256 },
      ],
      reproSha256: await sha256Hex(code),
      targetId,
    };
  } finally {
    runner.destroy();
  }
}
