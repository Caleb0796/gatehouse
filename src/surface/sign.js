import { storeArtifact as storeInboxArtifact } from "../inbox/inbox.js";
import { bus } from "../shared/bus.js";
import { assertArtifactSize } from "./artifact.js";

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
    status.textContent = "未提交";
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
