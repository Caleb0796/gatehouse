async function loadRunDifferential() {
  const { runDifferential } = await import("../sandbox/runner.js");
  return runDifferential;
}

function loadStyles(document) {
  if (!document.head || document.getElementById?.("gatehouse-replay-styles")) {
    return;
  }
  const link = document.createElement("link");
  link.id = "gatehouse-replay-styles";
  link.rel = "stylesheet";
  link.href = new URL("./replay.css", import.meta.url).href;
  document.head.append(link);
}

function sameRun(recorded, current) {
  return recorded.version === current?.version
    && recorded.verdict === current.verdict
    && recorded.bundleSha256 === current.bundleSha256;
}

export function runsMatch(recordedRuns, currentRuns) {
  return recordedRuns.length === currentRuns.length
    && recordedRuns.every(recorded => sameRun(
      recorded,
      currentRuns.find(current => current.version === recorded.version),
    ));
}

export async function runReplay(artifact, runDifferential) {
  const runner = runDifferential ?? await loadRunDifferential();
  const verdict = await runner(artifact.repro, { targetId: artifact.targetId });
  return {
    consistent: runsMatch(artifact.runs, verdict.runs),
    recordedRuns: artifact.runs,
    currentRuns: verdict.runs,
  };
}

function appendField(document, parent, label, value) {
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = String(value);
  parent.append(term, detail);
}

function renderRuns(document, parent, title, runs) {
  const column = document.createElement("section");
  const heading = document.createElement("h5");
  heading.textContent = title;
  column.append(heading);

  for (const run of runs) {
    const fields = document.createElement("dl");
    appendField(document, fields, "Version", run.version);
    appendField(document, fields, "Verdict", run.verdict);
    appendField(document, fields, "Bundle SHA-256", run.bundleSha256);
    appendField(document, fields, "Duration (ms)", run.durationMs);
    appendField(document, fields, "Logs", run.logs.length ? run.logs.join("\n") : "(none)");
    column.append(fields);
  }

  parent.append(column);
}

export function renderReplayResult(rootEl, result) {
  const document = rootEl.ownerDocument;
  const status = document.createElement("p");
  const columns = document.createElement("div");
  rootEl.className = result.consistent ? "replay-result consistent" : "replay-result changed";
  status.textContent = result.consistent
    ? "Replay matches recorded runs"
    : "builds or environment changed";
  columns.className = "replay-columns";
  renderRuns(document, columns, "Recorded runs", result.recordedRuns);
  renderRuns(document, columns, "Current runs", result.currentRuns);
  rootEl.replaceChildren(status, columns);
}

export function initReplay(rootEl, artifact, deps = {}) {
  const document = rootEl.ownerDocument;
  loadStyles(document);
  const button = document.createElement("button");
  const output = document.createElement("div");
  button.type = "button";
  button.textContent = "Replay";
  output.className = "replay-output";
  button.addEventListener("click", async () => {
    button.disabled = true;
    output.textContent = "Replaying…";
    try {
      renderReplayResult(output, await runReplay(artifact, deps.runDifferential));
    } catch (error) {
      output.className = "replay-result changed";
      output.textContent = `Replay failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      button.disabled = false;
    }
  });
  rootEl.replaceChildren(button, output);
}
