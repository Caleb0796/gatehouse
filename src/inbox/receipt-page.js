import { decodeReceipt, importReceiptJson } from "./receipt.js";

function shown(value) {
  return value === null ? "(none)" : String(value);
}

function shownLogs(sample) {
  if (!Object.hasOwn(sample, "logs")) return "not included in this public receipt";
  return sample.logs.length ? sample.logs.join("\n") : "(none)";
}

export function createReceiptView(artifact, reproHashOk, metadata = {}) {
  return {
    states: [
      ["Repro source hash", reproHashOk ? "self-consistent ✓" : "not self-consistent ✗"],
      ["Build origin", "not verified"],
      ["Independent run", "not verified"],
      ["Approver identity", "not verified"],
    ],
    receipt: [
      ["Schema version", artifact.v],
      ["Canonical receipt ID", metadata.receiptId ?? "(not supplied)"],
      ["Canonical receipt SHA-256", metadata.receiptSha256 ?? "(not supplied)"],
      ["Target ID", artifact.targetId],
      ["Library", artifact.library],
      ["Target kind", artifact.targetKind],
      ["Issue URL", artifact.issueUrl],
      ["Signed at", artifact.signedAt],
      ["User agent", artifact.ua],
      ["Local differential green", artifact.green],
      ["Local differential reason", artifact.reason],
      ["Samples stable", artifact.stable],
      ["Repeats per build", artifact.repeats],
    ],
    builds: [
      ["Reported-bad version (as-claimed)", artifact.badVersion],
      ["Reported-bad SHA-256 (as-claimed)", artifact.badSha256],
      ["Reference version (as-claimed)", artifact.goodVersion],
      ["Reference SHA-256 (as-claimed)", artifact.goodSha256],
    ],
    reproduction: [
      ["Repro SHA-256", artifact.reproSha256],
      ["Repro source", artifact.repro],
    ],
    samples: [
      ...artifact.samples.bad.map((sample, index) => ({
        title: `Reported-bad sample ${index + 1}`,
        fields: [
          ["Verdict", sample.verdict],
          ["Bundle SHA-256", sample.bundleSha256],
          ["Duration (ms)", sample.durationMs],
          ["Logs", shownLogs(sample)],
        ],
      })),
      ...artifact.samples.good.map((sample, index) => ({
        title: `Reference sample ${index + 1}`,
        fields: [
          ["Verdict", sample.verdict],
          ["Bundle SHA-256", sample.bundleSha256],
          ["Duration (ms)", sample.durationMs],
          ["Logs", shownLogs(sample)],
        ],
      })),
    ],
    timeline: artifact.timeline.map((entry, index) => ({
      title: `Timeline event ${index + 1}`,
      fields: [
        ["At", entry.at],
        ["Event", entry.event],
        ["Detail", entry.detail],
      ],
    })),
  };
}

function appendFields(parent, fields) {
  const list = document.createElement("dl");
  for (const [label, value] of fields) {
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = label;
    detail.textContent = shown(value);
    list.append(term, detail);
  }
  parent.append(list);
}

function appendGroups(parent, groups) {
  for (const group of groups) {
    const heading = document.createElement("h3");
    heading.textContent = group.title;
    parent.append(heading);
    appendFields(parent, group.fields);
  }
}

function appendSection(parent, title, fields) {
  const heading = document.createElement("h2");
  heading.textContent = title;
  parent.append(heading);
  appendFields(parent, fields);
}

function appendStates(parent, states) {
  const section = document.createElement("section");
  section.className = "claim-states";
  for (const [label, value] of states) {
    const state = document.createElement("p");
    state.className = value === "not verified" || value.startsWith("not ")
      ? "verification unverified"
      : "verification verified";
    state.textContent = `${label}: ${value}`;
    section.append(state);
  }
  parent.append(section);
}

function appendJsonImport(root) {
  const section = document.createElement("section");
  const heading = document.createElement("h2");
  const guidance = document.createElement("p");
  const input = document.createElement("input");
  const status = document.createElement("p");
  section.className = "json-import";
  heading.textContent = "Import receipt JSON";
  guidance.textContent = "If the receipt was too large for a link, select the downloaded Gatehouse v2 JSON file (32KB maximum).";
  input.type = "file";
  input.accept = "application/json,.json";
  input.setAttribute("aria-label", "Import receipt JSON");
  status.className = "import-status";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    status.textContent = "Checking receipt JSON…";
    const decoded = await importReceiptJson(file);
    if (decoded.error) {
      status.textContent = `Receipt JSON could not be opened: ${decoded.error}`;
      return;
    }
    renderReceipt(root, decoded.artifact, decoded.reproHashOk, decoded);
  });
  section.append(heading, guidance, input, status);
  root.append(section);
}

export function renderReceipt(root, artifact, reproHashOk, metadata = {}) {
  const view = createReceiptView(artifact, reproHashOk, metadata);
  const heading = document.createElement("h1");
  const guidance = document.createElement("p");
  heading.textContent = "Gatehouse receipt";
  guidance.className = "guidance";
  guidance.textContent = "This page displays reporter-generated local evidence. It does not independently verify builds, rerun the repro, or establish identity.";
  root.replaceChildren(heading, guidance);
  appendStates(root, view.states);

  appendSection(root, "Receipt", view.receipt);
  appendSection(root, "Claimed builds", view.builds);
  appendSection(root, "Reproduction", view.reproduction);

  const samplesHeading = document.createElement("h2");
  samplesHeading.textContent = "Recorded samples";
  root.append(samplesHeading);
  appendGroups(root, view.samples);

  const timelineHeading = document.createElement("h2");
  timelineHeading.textContent = "Timeline";
  root.append(timelineHeading);
  appendGroups(root, view.timeline);

  const download = document.createElement("a");
  const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" }));
  download.className = "download";
  download.href = blobUrl;
  download.download = `gatehouse-receipt-${metadata.receiptId ?? artifact.reproSha256.slice(0, 16)}.json`;
  download.textContent = "Download receipt JSON";
  root.append(download);
  window.addEventListener("pagehide", () => URL.revokeObjectURL(blobUrl), { once: true });
  appendJsonImport(root);
}

function renderError(root, message) {
  const heading = document.createElement("h1");
  const guidance = document.createElement("p");
  const error = document.createElement("div");
  heading.textContent = "Gatehouse receipt";
  guidance.className = "guidance";
  guidance.textContent = "Open the complete receipt link, then paste this link into your GitHub issue.";
  error.className = "verification error";
  error.textContent = `Receipt could not be opened: ${message}`;
  root.replaceChildren(heading, guidance, error);
  appendJsonImport(root);
}

async function init() {
  const root = document.querySelector("#receipt-root");
  const decoded = await decodeReceipt(location.hash);
  if (decoded.error) renderError(root, decoded.error);
  else renderReceipt(root, decoded.artifact, decoded.reproHashOk, decoded);
}

if (typeof document !== "undefined") init();
