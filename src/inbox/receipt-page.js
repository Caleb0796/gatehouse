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
      ["Local approval recorded at", artifact.signedAt],
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

export function renderReceipt(root, artifact, reproHashOk, deps = {}) {
  const document = root.ownerDocument;
  const view = createReceiptView(artifact, reproHashOk);
  const heading = document.createElement("h1");
  const guidance = document.createElement("p");
  const verification = document.createElement("div");
  heading.textContent = "Gatehouse receipt";
  guidance.className = "guidance";
  guidance.textContent = "Paste this link into your GitHub issue so maintainers can inspect the locally approved evidence. This browser-local approval is unauthenticated, does not verify identity, is not a cryptographic signature, and can be activated by automation.";
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
  const createObjectURL = deps.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURL = deps.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const blobUrl = createObjectURL(new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" }));
  download.className = "download";
  download.href = blobUrl;
  download.download = `gatehouse-receipt-${artifact.targetId}.json`;
  download.textContent = "Download receipt JSON";
  root.append(download);
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
      replaceView(() => render(root, decoded.artifact, decoded.reproHashOk));
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
