import { validateReceiptArtifact } from "./receipt.js";

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

function sameSample(recorded, current) {
  return recorded.verdict === current?.verdict
    && recorded.bundleSha256 === current.bundleSha256;
}

function sampleGroupMatches(recorded, current) {
  return Array.isArray(recorded)
    && Array.isArray(current)
    && recorded.length === current.length
    && recorded.every((sample, index) => sameSample(sample, current[index]));
}

export function samplesMatch(recordedSamples, currentSamples) {
  return recordedSamples !== null
    && currentSamples !== null
    && typeof recordedSamples === "object"
    && typeof currentSamples === "object"
    && sampleGroupMatches(recordedSamples.bad, currentSamples.bad)
    && sampleGroupMatches(recordedSamples.good, currentSamples.good);
}

export async function runReplay(artifact, runDifferential) {
  if (!validateReceiptArtifact(artifact)) {
    throw new TypeError("Replay requires a valid schema v2 receipt artifact.");
  }
  const runner = runDifferential ?? await loadRunDifferential();
  const verdict = await runner(artifact.repro, { targetId: artifact.targetId });
  return {
    consistent: verdict.green === artifact.green
      && verdict.reason === artifact.reason
      && verdict.stable === artifact.stable
      && verdict.repeats === artifact.repeats
      && verdict.targetId === artifact.targetId
      && verdict.reproSha256 === artifact.reproSha256
      && samplesMatch(artifact.samples, verdict.samples),
    recordedSamples: artifact.samples,
    currentSamples: verdict.samples,
  };
}

function appendField(document, parent, label, value) {
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = String(value);
  parent.append(term, detail);
}

function renderSamples(document, parent, title, samples) {
  const column = document.createElement("section");
  const heading = document.createElement("h5");
  heading.textContent = title;
  column.append(heading);

  for (const [build, entries] of [["reported-bad", samples.bad], ["reference", samples.good]]) {
    for (const [index, sample] of entries.entries()) {
      const fields = document.createElement("dl");
      appendField(document, fields, "Sample", `${build} ${index + 1}`);
      appendField(document, fields, "Verdict", sample.verdict);
      appendField(document, fields, "Bundle SHA-256", sample.bundleSha256);
      appendField(document, fields, "Duration (ms)", sample.durationMs);
      appendField(
        document,
        fields,
        "Logs",
        sample.logs?.length ? sample.logs.join("\n") : "not included",
      );
      column.append(fields);
    }
  }

  parent.append(column);
}

export function renderReplayResult(rootEl, result) {
  const document = rootEl.ownerDocument;
  const status = document.createElement("p");
  const columns = document.createElement("div");
  rootEl.className = result.consistent ? "replay-result consistent" : "replay-result changed";
  status.textContent = result.consistent
    ? "Replay matches recorded samples"
    : "builds or environment changed";
  columns.className = "replay-columns";
  renderSamples(document, columns, "Recorded samples", result.recordedSamples);
  renderSamples(document, columns, "Current samples", result.currentSamples);
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
