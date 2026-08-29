import { createRunner } from "/src/sandbox/runner.js";
import { sha256Hex } from "/src/shared/hash.js";

document.open();
document.write(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>RUNNING · Gatehouse runner</title></head>
<body><main><h1>Gatehouse runner</h1><p id="status">Running…</p><ol id="results"></ol></main></body>
</html>`);

const status = document.querySelector("#status");
const results = document.querySelector("#results");
const checks = [];
const bundleText = "self.demoLib = { answer: 42 };";
const bundleSha = await sha256Hex(bundleText);
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
  await runner.load([{ sha256: bundleSha, text: bundleText }]);

  const passed = await runner.run({
    bundleSha,
    globalName: "demoLib",
    code: 'console.log("answer", demoLib.answer); assert(demoLib.answer === 42);',
    timeoutMs: 1_000,
  });
  check("pass", passed.verdict === "pass" && passed.logs[0] === "answer 42", `verdict=${passed.verdict}; logs=${passed.logs.join("|")}`);

  const failed = await runner.run({
    bundleSha,
    globalName: "demoLib",
    code: 'assert(false, "forced failure");',
    timeoutMs: 1_000,
  });
  check("fail", failed.verdict === "fail" && failed.logs.some(log => log.includes("forced failure")), `verdict=${failed.verdict}`);

  const timedOut = await runner.run({
    bundleSha,
    globalName: "demoLib",
    code: "while (true) {}",
    timeoutMs: 100,
  });
  const recovered = await runner.run({
    bundleSha,
    globalName: "demoLib",
    code: "assert(demoLib.answer === 42);",
    timeoutMs: 1_000,
  });
  check("timeout-recovery", timedOut.verdict === "timeout" && recovered.verdict === "pass", `timeout=${timedOut.verdict}; recovery=${recovered.verdict}`);

  const bounded = await runner.run({
    bundleSha,
    globalName: "demoLib",
    code: 'for (let i = 0; i < 105; i++) console.log("x".repeat(600));',
    timeoutMs: 1_000,
  });
  check("log-bounds", bounded.verdict === "pass" && bounded.logs.length === 100 && bounded.logs.every(log => log.length === 500), `verdict=${bounded.verdict}; count=${bounded.logs.length}; max=${Math.max(...bounded.logs.map(log => log.length))}`);
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
