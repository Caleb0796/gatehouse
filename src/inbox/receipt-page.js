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
    verification: reproHashOk
      ? "Repro hash self-consistent ✓"
      : "Repro hash not self-consistent ✗",
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
      ["Local approval recorded at", artifact.signedAt],
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
  const document = parent.ownerDocument;
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
  const document = parent.ownerDocument;
  for (const group of groups) {
    const heading = document.createElement("h3");
    heading.textContent = group.title;
    parent.append(heading);
    appendFields(parent, group.fields);
  }
}

function appendSection(parent, title, fields) {
  const document = parent.ownerDocument;
  const heading = document.createElement("h2");
  heading.textContent = title;
  parent.append(heading);
  appendFields(parent, fields);
}

function appendStates(parent, states) {
  const document = parent.ownerDocument;
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
  const document = root.ownerDocument;
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
  const document = root.ownerDocument;
  const view = createReceiptView(artifact, reproHashOk, metadata);
  const heading = document.createElement("h1");
  const guidance = document.createElement("p");
  heading.textContent = "Gatehouse receipt";
  guidance.className = "guidance";
  const verification = document.createElement("p");
  guidance.textContent = "Paste this link into your GitHub issue so maintainers can inspect the locally approved evidence. This browser-local approval is unauthenticated, does not verify identity, is not a cryptographic signature, and can be activated by automation.";
  verification.className = `verification ${reproHashOk ? "verified" : "unverified"}`;
  verification.textContent = view.verification;
  root.replaceChildren(heading, guidance, verification);
  appendStates(root, view.states.slice(1));

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
  const createObjectURL = metadata.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURL = metadata.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const blobUrl = createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" }));
  download.className = "download";
  download.href = blobUrl;
  download.download = `gatehouse-receipt-${metadata.receiptId ?? artifact.reproSha256.slice(0, 16)}.json`;
  download.textContent = "Download receipt JSON";
  root.append(download);
  appendJsonImport(root);
  return once(() => revokeObjectURL(blobUrl));
}

export function renderError(root, message) {
  const document = root.ownerDocument;
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
  return () => {};
}

export function renderLoading(root) {
  const document = root.ownerDocument;
  const heading = document.createElement("h1");
  const guidance = document.createElement("p");
  const status = document.createElement("p");
  heading.textContent = "Gatehouse receipt";
  guidance.className = "guidance";
  guidance.textContent = "Open the complete receipt link, then paste this link into your GitHub issue.";
  status.setAttribute("role", "status");
  status.textContent = "Verifying receipt…";
  root.replaceChildren(heading, guidance, status);
  return () => {};
}

function once(dispose) {
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    if (typeof dispose === "function") dispose();
  };
}

export function initReceiptPage({
  root = document.querySelector("#receipt-root"),
  windowObject = window,
  decode = decodeReceipt,
  render = renderReceipt,
  renderFailure = renderError,
  renderPending = renderLoading,
} = {}) {
  let generation = 0;
  let disposed = false;
  let disposeView = () => {};

  const replaceView = (renderView) => {
    disposeView();
    disposeView = once(renderView() ?? (() => {}));
  };

  const verifyCurrentHash = async () => {
    const currentGeneration = generation + 1;
    generation = currentGeneration;
    const hash = windowObject.location.hash;
    replaceView(() => renderPending(root));

    let decoded;
    try {
      decoded = await decode(hash);
    } catch (error) {
      decoded = { error: error instanceof Error ? error.message : String(error) };
    }
    if (disposed || currentGeneration !== generation) return;

    if (decoded.error) {
      replaceView(() => renderFailure(root, decoded.error));
    } else {
      replaceView(() => render(root, decoded.artifact, decoded.reproHashOk, decoded));
    }
  };

  const onHashChange = () => {
    void verifyCurrentHash();
  };
  const cleanup = once(() => {
    disposed = true;
    generation += 1;
    windowObject.removeEventListener("hashchange", onHashChange);
    windowObject.removeEventListener("pagehide", cleanup);
    disposeView();
    disposeView = () => {};
  });

  windowObject.addEventListener("hashchange", onHashChange);
  windowObject.addEventListener("pagehide", cleanup);
  void verifyCurrentHash();
  return cleanup;
}

if (typeof document !== "undefined") initReceiptPage();
