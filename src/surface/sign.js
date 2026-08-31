import { bus } from "../shared/bus.js";

function revoked(eventBus, at) {
  eventBus.emit("surface", {
    change: "revoked",
    tool: "submit_report",
    reason: "repro edited",
    at,
  });
}

function appendReviewField(document, parent, label, value) {
  const term = document.createElement("dt");
  const detail = document.createElement("dd");
  term.textContent = label;
  detail.textContent = value;
  parent.append(term, detail);
}

function clearReview(review) {
  if (!review) return;
  review.hidden = true;
  review.replaceChildren();
}

function showReview(review, artifactDraft) {
  if (!review) return;
  const document = review.ownerDocument;
  const heading = document.createElement("h3");
  const guidance = document.createElement("p");
  const fields = document.createElement("dl");
  const repro = document.createElement("pre");
  heading.textContent = "Exact staged report";
  guidance.textContent = "Review the exact reproduction and pinned build hashes before saving this report locally.";
  appendReviewField(document, fields, "Reproduction SHA-256", artifactDraft.reproSha256);
  appendReviewField(
    document,
    fields,
    "Reported-bad build",
    `${artifactDraft.badVersion} · ${artifactDraft.badSha256}`,
  );
  appendReviewField(
    document,
    fields,
    "Last-good build",
    `${artifactDraft.goodVersion} · ${artifactDraft.goodSha256}`,
  );
  repro.textContent = artifactDraft.repro;
  review.replaceChildren(heading, guidance, fields, repro);
  review.hidden = false;
}

export async function signArtifact({
  artifactDraft,
  gateState,
  currentDraft,
  persistArtifact,
  eventBus = bus,
  now = () => new Date(),
  userAgent = () => navigator.userAgent,
}) {
  if (typeof persistArtifact !== "function") {
    throw new TypeError("signArtifact requires a persistArtifact callback");
  }

  const signedAt = now();
  const visibleDraft = currentDraft === undefined ? gateState.draft : currentDraft;
  if (
    artifactDraft === null
    || gateState.draftSha === null
    || gateState.draftSha !== gateState.boundSha
    || gateState.draftSha !== artifactDraft.reproSha256
    || visibleDraft !== gateState.draft
    || visibleDraft !== artifactDraft.repro
  ) {
    revoked(eventBus, signedAt.getTime());
    return {
      code: "STALE_REPRO",
      message: "The staged reproduction no longer matches the verified draft.",
    };
  }

  const at = signedAt.toISOString();
  const artifact = {
    ...artifactDraft,
    timeline: [...artifactDraft.timeline, { at, event: "signed", detail: "" }],
    signedAt: at,
    ua: userAgent(),
  };
  try {
    await persistArtifact(artifact);
  } catch {
    return {
      code: "LOCAL_SAVE_FAILED",
      message: "The report could not be saved locally.",
    };
  }
  eventBus.emit("signed", { artifact });
  return { artifact };
}

export function initSigning({
  button,
  review,
  status,
  getGateState,
  getCurrentDraft,
  persistArtifact,
  beforeSign = () => undefined,
  eventBus = bus,
  now,
  userAgent,
}) {
  let artifactDraft = null;
  clearReview(review);
  status.textContent = "Awaiting local approval";
  button.disabled = true;

  const unsubscribeStaged = eventBus.on("staged", (event) => {
    artifactDraft = event.artifactDraft;
    showReview(review, artifactDraft);
    status.textContent = "Awaiting local approval";
    button.disabled = false;
  });
  const unsubscribeDraft = eventBus.on("draft", () => {
    if (artifactDraft === null) return;
    artifactDraft = null;
    clearReview(review);
    status.textContent = "Draft changed · run and stage again";
    button.disabled = true;
  });
  const onClick = async () => {
    button.disabled = true;
    await beforeSign();
    const gateState = getGateState();
    const result = await signArtifact({
      artifactDraft,
      gateState,
      currentDraft: getCurrentDraft ? getCurrentDraft() : gateState.draft,
      persistArtifact,
      eventBus,
      now,
      userAgent,
    });
    if (Object.hasOwn(result, "artifact")) {
      status.textContent = "Locally approved";
    } else if (result.code === "LOCAL_SAVE_FAILED") {
      status.textContent = "Local save failed · try again";
      button.disabled = false;
    } else {
      artifactDraft = null;
      clearReview(review);
      status.textContent = "Draft changed · run and stage again";
    }
    return result;
  };
  button.addEventListener("click", onClick);

  return () => {
    button.removeEventListener("click", onClick);
    unsubscribeStaged();
    unsubscribeDraft();
  };
}
