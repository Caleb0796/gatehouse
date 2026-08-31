import { storeArtifact as storeInboxArtifact } from "../inbox/inbox.js";
import { bus } from "../shared/bus.js";
import { assertArtifactEvidence, assertArtifactSize } from "./artifact.js";

function revoked(eventBus, at) {
  eventBus.emit("surface", {
    change: "revoked",
    tool: "submit_report",
    reason: "repro edited",
    at,
  });
}

function storeError(result) {
  if (result?.error instanceof Error) return result.error.message;
  if (typeof result?.error === "string" && result.error) return result.error;
  return "Artifact storage could not be confirmed.";
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
    "Comparison build",
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
  persistArtifact = storeInboxArtifact,
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
      message: "The staged reproduction no longer matches the gate-bound draft.",
    };
  }

  const at = signedAt.toISOString();
  const artifact = {
    ...artifactDraft,
    timeline: [...artifactDraft.timeline, { at, event: "signed", detail: "" }],
    signedAt: at,
    ua: userAgent(),
  };
  assertArtifactEvidence(artifact);
  assertArtifactSize(artifact);
  let stored;
  try {
    stored = await persistArtifact(artifact);
  } catch (error) {
    stored = { ok: false, error };
  }
  if (stored?.ok !== true) {
    return {
      code: "ARTIFACT_STORE_FAILED",
      message: storeError(stored),
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
    } else if (result.code === "ARTIFACT_STORE_FAILED") {
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
