import { decodeReceipt } from "./receipt.js";

function shown(value) {
  return value === null ? "(none)" : String(value);
}

export function createReceiptView(artifact, reproHashOk) {
  return {
    verification: `repro hash verified ${reproHashOk ? "✓" : "✗"}`,
    receipt: [
      ["Schema version", artifact.v],
      ["Target ID", artifact.targetId],
      ["Library", artifact.library],
      ["Target kind", artifact.targetKind],
      ["Issue URL", artifact.issueUrl],
      ["Signed at", artifact.signedAt],
      ["User agent", artifact.ua],
    ],
    builds: [
      ["Reported-bad version (as-claimed)", artifact.badVersion],
      ["Reported-bad SHA-256 (as-claimed)", artifact.badSha256],
      ["Last-good version (as-claimed)", artifact.goodVersion],
      ["Last-good SHA-256 (as-claimed)", artifact.goodSha256],
    ],
    reproduction: [
      ["Repro SHA-256", artifact.reproSha256],
      ["Repro source", artifact.repro],
    ],
    runs: artifact.runs.map((run, index) => ({
      title: `Run ${index + 1}`,
      fields: [
        ["Version", run.version],
        ["Verdict", run.verdict],
        ["Bundle SHA-256", run.bundleSha256],
        ["Duration (ms)", run.durationMs],
        ["Logs", run.logs.length ? run.logs.join("\n") : "(none)"],
      ],
    })),
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

export function renderReceipt(root, artifact, reproHashOk) {
  const view = createReceiptView(artifact, reproHashOk);
  const heading = document.createElement("h1");
  const guidance = document.createElement("p");
  const verification = document.createElement("div");
  heading.textContent = "Gatehouse receipt";
  guidance.className = "guidance";
  guidance.textContent = "Paste this link into your GitHub issue so maintainers can inspect the signed evidence.";
  verification.className = `verification ${reproHashOk ? "verified" : "unverified"}`;
  verification.textContent = view.verification;
  root.replaceChildren(heading, guidance, verification);

  appendSection(root, "Receipt", view.receipt);
  appendSection(root, "Claimed builds", view.builds);
  appendSection(root, "Reproduction", view.reproduction);

  const runsHeading = document.createElement("h2");
  runsHeading.textContent = "Recorded runs";
  root.append(runsHeading);
  appendGroups(root, view.runs);

  const timelineHeading = document.createElement("h2");
  timelineHeading.textContent = "Timeline";
  root.append(timelineHeading);
  appendGroups(root, view.timeline);

  const download = document.createElement("a");
  const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" }));
  download.className = "download";
  download.href = blobUrl;
  download.download = `gatehouse-receipt-${artifact.targetId}.json`;
  download.textContent = "Download receipt JSON";
  root.append(download);
  window.addEventListener("pagehide", () => URL.revokeObjectURL(blobUrl), { once: true });
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
}

async function init() {
  const root = document.querySelector("#receipt-root");
  const decoded = await decodeReceipt(location.hash);
  if (decoded.error) renderError(root, decoded.error);
  else renderReceipt(root, decoded.artifact, decoded.reproHashOk);
}

if (typeof document !== "undefined") init();
