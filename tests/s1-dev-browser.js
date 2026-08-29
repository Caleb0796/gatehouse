import { loadTarget, runDifferential } from "/src/sandbox/runner.js";

document.open();
document.write(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>RUNNING · Gatehouse S1 acceptance</title></head>
<body><main><h1>Gatehouse S1 acceptance</h1><p id="status">Running…</p><ol id="results"></ol></main></body>
</html>`);

const status = document.querySelector("#status");
const results = document.querySelector("#results");
const checks = [];
const { manifest } = await loadTarget("qs-500");
const cases = [
  ["assert-false", 'assert(false, "forced");', "FAIL_BOTH", false],
  ["empty", "", "PASS_BOTH", false],
  ["timeout", "while (true) {}", "BAD_TIMEOUT", false],
  ["inverted", 'const parsed = Qs.parse("a%252Eb=c"); assert(parsed["a.b"] === "c", "bad behavior only");', "INVERTED", false],
  ["real", manifest.demoRepros.real, "REGRESSION_DEMONSTRATED", true],
];

const check = (id, pass, evidence) => {
  checks.push({ id, pass, evidence });
  const item = document.createElement("li");
  item.dataset.check = id;
  item.dataset.pass = String(pass);
  item.textContent = `${pass ? "PASS" : "FAIL"} · ${evidence}`;
  results.append(item);
};

for (const [id, code, reason, green] of cases) {
  let heartbeats = 0;
  const heartbeat = id === "timeout" ? setInterval(() => heartbeats += 1, 10) : undefined;

  try {
    const result = await runDifferential(code, {
      targetId: "qs-500",
      timeoutMs: id === "timeout" ? 150 : 2_000,
    });
    if (heartbeat) clearInterval(heartbeat);
    const runsValid = result.runs.length === 2 && result.runs.every(run => (
      ["bad", "good"].includes(run.version) &&
      ["pass", "fail", "error", "timeout"].includes(run.verdict) &&
      typeof run.durationMs === "number" &&
      typeof run.bundleSha256 === "string"
    ));
    const responsive = id !== "timeout" || heartbeats > 0;
    check(
      id,
      result.reason === reason && result.green === green && runsValid && responsive,
      `${result.runs[0].verdict}/${result.runs[1].verdict} → ${result.reason}; heartbeats=${heartbeats}`,
    );
  } catch (error) {
    if (heartbeat) clearInterval(heartbeat);
    check(id, false, String(error && error.stack || error));
  }
}

const go = checks.length === 5 && checks.every(result => result.pass);
const summary = checks.map(result => `${result.id}:${result.pass ? "PASS" : "FAIL"}`).join(" · ");
status.textContent = `${go ? "GO" : "NO-GO"} · ${summary}`;
document.title = `${go ? "GO" : "NO-GO"} · ${summary}`;
document.close();
