import { bus as sharedBus } from "../shared/bus.js";
import { initAdopt } from "./adopt.js";
import { encodeReceipt, prepareReceiptShare } from "./receipt.js";
import { initReplay } from "./replay.js";

export const INBOX_STORAGE_KEY = "gatehouse.inbox.v1";

function isDisplayableArtifact(artifact) {
  if (artifact === null || typeof artifact !== "object" || Array.isArray(artifact)) return false;
  if (artifact.v !== 1 && artifact.v !== 2) return false;
  if (
    typeof artifact.targetId !== "string"
    || typeof artifact.library !== "string"
    || typeof artifact.repro !== "string"
    || typeof artifact.signedAt !== "string"
    || !Array.isArray(artifact.timeline)
    || !artifact.timeline.every(entry => entry !== null && typeof entry === "object" && !Array.isArray(entry))
  ) {
    return false;
  }
  const samples = artifact.v === 2
    ? [artifact.samples?.bad, artifact.samples?.good]
    : [artifact.runs];
  return samples.every(group => Array.isArray(group) && group.every(
    sample => sample !== null && typeof sample === "object" && !Array.isArray(sample),
  ));
}

function hasCompleteSamples(artifact) {
  return Number.isInteger(artifact.repeats)
    && artifact.repeats > 1
    && Array.isArray(artifact.samples?.bad)
    && artifact.samples.bad.length === artifact.repeats
    && Array.isArray(artifact.samples?.good)
    && artifact.samples.good.length === artifact.repeats;
}

function verdictFor(artifact) {
  if (artifact.v !== 2) {
    return { label: "LEGACY V1 — stability not established", tone: "neutral" };
  }
  if (!hasCompleteSamples(artifact)) {
    return { label: "INCOMPLETE V2 EVIDENCE", tone: "neutral" };
  }
  if (
    artifact.green === true
    && artifact.stable === true
    && artifact.reason === "STABLE_LOCAL_DIFFERENTIAL"
  ) {
    return { label: "STABLE_LOCAL_DIFFERENTIAL", tone: "green" };
  }
  return { label: String(artifact.reason ?? "NOT STABLE"), tone: "neutral" };
}

export function loadInbox(storage = localStorage) {
  try {
    const stored = JSON.parse(storage.getItem(INBOX_STORAGE_KEY) ?? "[]");
    return Array.isArray(stored) ? stored.filter(isDisplayableArtifact) : [];
  } catch {
    return [];
  }
}

export function storeArtifact(artifact, storage = localStorage) {
  try {
    const artifacts = loadInbox(storage);
    const serializedArtifact = JSON.stringify(artifact);
    const storedArtifacts = [...artifacts, artifact];
    storage.setItem(INBOX_STORAGE_KEY, JSON.stringify(storedArtifacts));

    const confirmed = loadInbox(storage);
    const confirmedArtifact = confirmed.at(-1);
    if (
      confirmed.length !== storedArtifacts.length
      || confirmedArtifact?.targetId !== artifact.targetId
      || confirmedArtifact?.signedAt !== artifact.signedAt
      || JSON.stringify(confirmedArtifact) !== serializedArtifact
    ) {
      return { ok: false, error: "Artifact storage could not be confirmed after write." };
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
}

export function createInboxView(artifacts) {
  return [...artifacts].reverse().map(artifact => ({
    artifact,
    title: `${artifact.library} · ${artifact.targetId}`,
    signedAt: artifact.signedAt,
    verdict: verdictFor(artifact),
  }));
}

function appendField(document, parent, label, value) {
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = value === null ? "(none)" : String(value);
  parent.append(term, detail);
}

function initShare(document, root, artifact, deps) {
  const prepare = deps.prepareReceiptShare ?? prepareReceiptShare;
  const encode = deps.encodeReceipt ?? encodeReceipt;
  const heading = document.createElement("h4");
  const reviewButton = document.createElement("button");
  const output = document.createElement("div");
  heading.textContent = "Share receipt";
  reviewButton.type = "button";
  reviewButton.textContent = "Review receipt before sharing";
  reviewButton.addEventListener("click", async () => {
    reviewButton.disabled = true;
    const review = await prepare(artifact);
    if (review.error) {
      output.textContent = `Receipt unavailable: ${review.error}`;
      reviewButton.disabled = false;
      return;
    }

    const warning = document.createElement("p");
    const identity = document.createElement("p");
    const preview = document.createElement("pre");
    const secretList = document.createElement("ul");
    const confirmButton = document.createElement("button");
    const result = document.createElement("div");
    warning.textContent = review.shareWarning;
    identity.textContent = `Canonical receipt ID: ${review.receiptId}`;
    preview.textContent = review.preview;
    for (const secretWarning of review.secretWarnings) {
      const item = document.createElement("li");
      item.textContent = secretWarning.message;
      secretList.append(item);
    }
    confirmButton.type = "button";
    confirmButton.textContent = "Confirm and create receipt";
    confirmButton.addEventListener("click", async () => {
      confirmButton.disabled = true;
      const encoded = await encode(artifact, {
        confirmed: true,
        expectedReceiptId: review.receiptId,
      });
      if (encoded.error) {
        result.textContent = encoded.error;
        confirmButton.disabled = false;
        return;
      }
      if (typeof encoded.url === "string") {
        const link = document.createElement("a");
        link.href = encoded.url;
        link.textContent = "Open receipt";
        result.replaceChildren(link);
        return;
      }
      const download = document.createElement("a");
      const guidance = document.createElement("p");
      const createObjectURL = deps.createObjectURL ?? URL.createObjectURL.bind(URL);
      download.href = createObjectURL(new Blob([encoded.download], { type: "application/json" }));
      download.download = encoded.filename;
      download.textContent = "Download receipt JSON";
      guidance.textContent = encoded.guidance;
      result.replaceChildren(download, guidance);
    });
    output.replaceChildren(warning, identity, preview, secretList, confirmButton, result);
  });
  root.replaceChildren(heading, reviewButton, output);
}

function renderDetail(document, root, entry, deps) {
  const heading = document.createElement("h3");
  const fields = document.createElement("dl");
  const reproHeading = document.createElement("h4");
  const repro = document.createElement("pre");
  const evidenceHeading = document.createElement("h4");

  heading.textContent = entry.title;
  appendField(document, fields, "Schema version", entry.artifact.v);
  appendField(document, fields, "Signed at", entry.artifact.signedAt);
  appendField(document, fields, "Target kind", entry.artifact.targetKind);
  appendField(document, fields, "Issue URL", entry.artifact.issueUrl);
  appendField(document, fields, "Reported-bad version", entry.artifact.badVersion);
  appendField(document, fields, "Reported-bad SHA-256", entry.artifact.badSha256);
  appendField(document, fields, "Comparison version", entry.artifact.goodVersion);
  appendField(document, fields, "Comparison SHA-256", entry.artifact.goodSha256);
  appendField(document, fields, "Repro SHA-256", entry.artifact.reproSha256);
  appendField(document, fields, "User agent", entry.artifact.ua);
  reproHeading.textContent = "Reproduction";
  repro.textContent = entry.artifact.repro;
  evidenceHeading.textContent = entry.artifact.v === 2 ? "Recorded samples" : "Recorded run";
  root.replaceChildren(heading, fields, reproHeading, repro, evidenceHeading);

  if (entry.artifact.v !== 2) {
    const legacy = document.createElement("p");
    legacy.textContent = "Legacy schema v1 — single-run evidence; stability not established.";
    root.append(legacy);
  }

  const sampleGroups = entry.artifact.v === 2
    ? [
      ["Reported build", entry.artifact.samples?.bad],
      ["Comparison build", entry.artifact.samples?.good],
    ]
    : [["Legacy run", entry.artifact.runs]];
  for (const [groupLabel, samples] of sampleGroups) {
    if (!Array.isArray(samples)) continue;
    samples.forEach((run, index) => {
      const runFields = document.createElement("dl");
      appendField(document, runFields, "Sample", `${groupLabel} ${index + 1}`);
      appendField(document, runFields, "Verdict", run.verdict);
      appendField(document, runFields, "Bundle SHA-256", run.bundleSha256);
      appendField(document, runFields, "Duration (ms)", run.durationMs);
      appendField(
        document,
        runFields,
        "Logs",
        Array.isArray(run.logs) && run.logs.length ? run.logs.join("\n") : "(none)",
      );
      root.append(runFields);
    });
  }

  const timelineHeading = document.createElement("h4");
  timelineHeading.textContent = "Timeline";
  root.append(timelineHeading);
  for (const event of entry.artifact.timeline ?? []) {
    const eventFields = document.createElement("dl");
    appendField(document, eventFields, "At", event.at);
    appendField(document, eventFields, "Event", event.event);
    appendField(document, eventFields, "Detail", event.detail);
    root.append(eventFields);
  }

  const share = document.createElement("section");
  share.className = "inbox-share";
  root.append(share);
  initShare(document, share, entry.artifact, deps);

  const replay = document.createElement("section");
  replay.className = "inbox-replay";
  root.append(replay);
  if (entry.artifact.v === 2) {
    if (hasCompleteSamples(entry.artifact)) {
      initReplay(replay, entry.artifact, { runDifferential: deps.runDifferential });
    } else {
      replay.textContent = "Replay unavailable: repeated-sample evidence is incomplete.";
    }
  } else {
    replay.textContent = "Replay unavailable: legacy schema v1 is not stable evidence.";
  }

  const adopt = document.createElement("section");
  adopt.className = "inbox-adopt";
  root.append(adopt);
  initAdopt(adopt, entry.artifact, deps);
}

function render(root, entries, selectedIndex, select, deps) {
  const document = root.ownerDocument;
  const heading = document.createElement("h2");
  const list = document.createElement("ol");
  const detail = document.createElement("article");
  heading.textContent = "Signed report inbox";
  list.className = "inbox-list";
  detail.className = "inbox-detail";
  root.replaceChildren(heading, list, detail);

  if (!entries.length) {
    const empty = document.createElement("p");
    empty.textContent = "No signed reports yet.";
    detail.append(empty);
    return;
  }

  entries.forEach((entry, index) => {
    const item = document.createElement("li");
    const button = document.createElement("button");
    const title = document.createElement("span");
    const verdict = document.createElement("span");
    const signedAt = document.createElement("time");
    button.type = "button";
    button.className = index === selectedIndex ? "selected" : "";
    button.addEventListener("click", () => select(index));
    title.textContent = entry.title;
    verdict.className = `verdict-badge ${entry.verdict.tone}`;
    verdict.textContent = entry.verdict.label;
    signedAt.textContent = entry.signedAt;
    button.append(title, verdict, signedAt);
    item.append(button);
    list.append(item);
  });

  renderDetail(document, detail, entries[selectedIndex] ?? entries[0], deps);
}

export function init(rootEl, deps = {}) {
  const storage = deps.storage ?? localStorage;
  const eventBus = deps.bus ?? sharedBus;
  let artifacts = loadInbox(storage);
  let selectedIndex = 0;

  const draw = () => {
    const entries = createInboxView(artifacts);
    rootEl.hidden = entries.length === 0;
    render(rootEl, entries, selectedIndex, index => {
      selectedIndex = index;
      draw();
    }, deps);
  };

  const unsubscribe = eventBus.on("signed", () => {
    artifacts = loadInbox(storage);
    selectedIndex = 0;
    draw();
  });

  draw();
  return unsubscribe;
}
