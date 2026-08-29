import { loadTarget, runDifferential } from "./runner.js";

const TARGET_ID = "qs-500";
const form = document.querySelector("#repro-form");
const repro = document.querySelector("#repro");
const runButton = document.querySelector("#run");
const target = document.querySelector("#target");
const status = document.querySelector("#status");
const verdict = document.querySelector("#verdict");
const badRun = document.querySelector("#bad-run");
const goodRun = document.querySelector("#good-run");

try {
  const { manifest } = await loadTarget(TARGET_ID);
  target.textContent = `${manifest.library} ${manifest.badVersion} → ${manifest.goodVersion} · ${manifest.issueUrl}`;
  repro.value = manifest.demoRepros.real;
  status.textContent = "Ready";
  runButton.disabled = false;
} catch (error) {
  status.textContent = String(error && error.stack || error);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  runButton.disabled = true;
  status.textContent = "Running in isolated workers…";
  verdict.textContent = "Verdict: running";
  verdict.className = "";

  try {
    const result = await runDifferential(repro.value, { targetId: TARGET_ID });
    badRun.textContent = JSON.stringify(result.runs[0], null, 2);
    goodRun.textContent = JSON.stringify(result.runs[1], null, 2);
    verdict.textContent = `Verdict: ${result.reason}`;
    verdict.className = result.green ? "green" : "red";
    status.textContent = `Completed · repro SHA-256 ${result.reproSha256}`;
  } catch (error) {
    verdict.textContent = "Verdict: runner error";
    verdict.className = "red";
    status.textContent = String(error && error.stack || error);
  } finally {
    runButton.disabled = false;
  }
});
