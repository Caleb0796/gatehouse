import { judgePair } from "/src/sandbox/differential.js";
import { createRunner, loadTarget } from "/src/sandbox/runner.js";

document.open();
document.write(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>RUNNING · Gatehouse target</title></head>
<body><main><h1>qs #500 target</h1><p id="status">Running…</p><ol id="results"></ol></main></body>
</html>`);

const status = document.querySelector("#status");
const results = document.querySelector("#results");
const checks = [];
const runner = createRunner();

const check = (id, pass, evidence) => {
  checks.push({ id, pass, evidence });
  const item = document.createElement("li");
  item.dataset.check = id;
  item.dataset.pass = String(pass);
  item.textContent = `${pass ? "PASS" : "FAIL"} · ${evidence}`;
  results.append(item);
};

try {
  const { manifest, bundles } = await loadTarget("qs-500");
  check(
    "target",
    manifest.id === "qs-500" && manifest.kind === "real",
    `${manifest.library} ${manifest.badVersion} → ${manifest.goodVersion} · bundle SHA-256 verified`,
  );
  await runner.load([bundles.bad, bundles.good]);

  for (const [name, expected] of [
    ["broken", "FAIL_BOTH"],
    ["weak", "PASS_BOTH"],
    ["real", "STABLE_LOCAL_DIFFERENTIAL"],
  ]) {
    const code = manifest.demoRepros[name];
    const badRun = await runner.run({
      bundleSha: bundles.bad.sha256,
      globalName: manifest.globalName,
      code,
      timeoutMs: 2_000,
    });
    const goodRun = await runner.run({
      bundleSha: bundles.good.sha256,
      globalName: manifest.globalName,
      code,
      timeoutMs: 2_000,
    });
    const verdict = judgePair(badRun, goodRun);
    const pass = verdict.reason === expected && verdict.green === (name === "real");
    check(name, pass, `${manifest.badVersion}:${badRun.verdict} · ${manifest.goodVersion}:${goodRun.verdict} · ${verdict.reason}`);
  }
} catch (error) {
  check("harness", false, String(error && error.stack || error));
} finally {
  runner.destroy();
}

const go = checks.length === 4 && checks.every(result => result.pass);
const summary = checks.map(result => `${result.id}:${result.pass ? "PASS" : "FAIL"}`).join(" · ");
status.textContent = `${go ? "GO" : "NO-GO"} · ${summary}`;
document.title = `${go ? "GO" : "NO-GO"} · ${summary}`;
document.close();
