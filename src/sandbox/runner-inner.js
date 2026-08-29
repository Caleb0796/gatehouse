const bundles = new Map();
const verdicts = new Set(["pass", "fail", "error"]);

const clipLog = value => String(value).slice(0, 500);
const normalizeLogs = logs => Array.isArray(logs) ? logs.slice(0, 100).map(clipLog) : [];

const sendResult = (runId, verdict, logs, startedAt) => {
  parent.postMessage({
    t: "result",
    runId,
    verdict,
    logs: normalizeLogs(logs),
    durationMs: Math.round(performance.now() - startedAt),
  }, "*");
};

const run = ({ runId, bundleSha, globalName, code, timeoutMs }) => {
  const startedAt = performance.now();
  if (
    typeof runId !== "string" ||
    typeof bundleSha !== "string" ||
    typeof globalName !== "string" ||
    typeof code !== "string" ||
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    if (typeof runId === "string") sendResult(runId, "error", ["Invalid run envelope"], startedAt);
    return;
  }

  const bundleText = bundles.get(bundleSha);
  if (bundleText === undefined) {
    sendResult(runId, "error", [`Bundle not loaded: ${bundleSha}`], startedAt);
    return;
  }

  const preamble = `
    class ReproAssertionError extends Error { constructor(m){ super(m); this.name="ReproAssertionError"; } }
    const assert = (c, m) => { if (!c) throw new ReproAssertionError(m || "assertion failed"); };
    const __logs = []; const __post = self.postMessage.bind(self); self.postMessage = undefined;
    const __pushLog = value => { if (__logs.length < 100) __logs.push(String(value).slice(0, 500)); };
    const console = { log:(...a)=>__pushLog(a.map(String).join(" ")),
                      error:(...a)=>__pushLog("[error] "+a.map(String).join(" ")),
                      warn:(...a)=>__pushLog("[warn] "+a.map(String).join(" ")) };`;
  const body = `(async () => { ${bundleText}\n;\n${code}\n })()
    .then(() => __post({ __gh:1, verdict:"pass", logs:__logs }))
    .catch(e => __post({ __gh:1, verdict: e && e.name==="ReproAssertionError" ? "fail" : "error",
                         logs: __logs.concat(String(e && e.stack || e)) }));`;
  const url = URL.createObjectURL(new Blob([preamble, body], { type: "text/javascript" }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);

  let settled = false;
  const finish = (verdict, logs) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    worker.terminate();
    sendResult(runId, verdict, logs, startedAt);
  };
  const timer = setTimeout(() => finish("timeout", []), timeoutMs);

  worker.addEventListener("message", event => {
    const message = event.data;
    if (
      !message ||
      typeof message !== "object" ||
      message.__gh !== 1 ||
      !verdicts.has(message.verdict) ||
      !Array.isArray(message.logs) ||
      message.logs.some(log => typeof log !== "string")
    ) {
      finish("error", ["Invalid worker result envelope"]);
      return;
    }
    finish(message.verdict, message.logs);
  });
  worker.addEventListener("error", event => {
    finish("error", [event.message || "Worker execution error"]);
  });
};

window.addEventListener("message", event => {
  if (event.source !== parent || !event.data || typeof event.data !== "object") return;

  if (event.data.t === "load" && Array.isArray(event.data.bundles)) {
    for (const bundle of event.data.bundles) {
      if (bundle && typeof bundle.sha256 === "string" && typeof bundle.text === "string") {
        bundles.set(bundle.sha256, bundle.text);
      }
    }
    return;
  }

  if (event.data.t === "run") run(event.data);
});

parent.postMessage({ t: "ready" }, "*");
