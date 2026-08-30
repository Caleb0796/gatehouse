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

function showStagedReview(review, artifactDraft) {
  if (!review) return;
  const repeats = artifactDraft.repeats;
  const badFailures = artifactDraft.samples.bad.filter(({ verdict }) => verdict === "fail").length;
  const goodPasses = artifactDraft.samples.good.filter(({ verdict }) => verdict === "pass").length;
  review.summary.textContent = [
    "Review the exact code below before signing.",
    `Reproduction SHA-256: ${artifactDraft.reproSha256}`,
    `Reported build ${artifactDraft.badVersion}: ${badFailures}/${repeats} failed · ${artifactDraft.badSha256}`,
    `Reference build ${artifactDraft.goodVersion}: ${goodPasses}/${repeats} passed · ${artifactDraft.goodSha256}`,
  ].join("\n");
  review.repro.textContent = artifactDraft.repro;
  review.root.hidden = false;
}

export async function signArtifact({
  artifactDraft,
  gateState,
  eventBus = bus,
  now = () => new Date(),
  userAgent = () => navigator.userAgent,
  storeArtifact = storeInboxArtifact,
}) {
  const signedAt = now();
  if (
    artifactDraft === null
    || gateState.draftSha === null
    || gateState.draftSha !== gateState.boundSha
    || gateState.draftSha !== artifactDraft.reproSha256
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
    stored = await storeArtifact(artifact);
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
  status,
  review,
  getGateState,
  eventBus = bus,
  now,
  userAgent,
  storeArtifact,
}) {
  let artifactDraft = null;
  status.textContent = "未提交";
  button.disabled = true;

  const unsubscribe = eventBus.on("staged", (event) => {
    artifactDraft = event.artifactDraft;
    showStagedReview(review, artifactDraft);
    status.textContent = "待人工审阅";
    button.disabled = false;
  });
  const onClick = async () => {
    button.disabled = true;
    const result = await signArtifact({
      artifactDraft,
      gateState: getGateState(),
      eventBus,
      now,
      userAgent,
      storeArtifact,
    });
    if (Object.hasOwn(result, "artifact")) {
      status.textContent = "已签名";
      button.disabled = true;
    } else {
      status.textContent = `签名失败：${result.message}`;
      button.disabled = false;
    }
    return result;
  };
  button.addEventListener("click", onClick);

  return () => {
    button.removeEventListener("click", onClick);
    unsubscribe();
  };
}
