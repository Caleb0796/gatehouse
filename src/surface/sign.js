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

export function signArtifact({
  artifactDraft,
  gateState,
  eventBus = bus,
  now = () => new Date(),
  userAgent = () => navigator.userAgent,
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
}) {
  let artifactDraft = null;
  status.textContent = "未提交";
  button.disabled = true;

  const unsubscribe = eventBus.on("staged", (event) => {
    artifactDraft = event.artifactDraft;
    status.textContent = "未提交";
    button.disabled = false;
  });
  const onClick = () => {
    const result = signArtifact({
      artifactDraft,
      gateState: getGateState(),
      eventBus,
      now,
      userAgent,
    });
    if (Object.hasOwn(result, "artifact")) {
      status.textContent = "已签名";
      button.disabled = true;
    }
    return result;
  };
  button.addEventListener("click", onClick);

  return () => {
    button.removeEventListener("click", onClick);
    unsubscribe();
  };
}
