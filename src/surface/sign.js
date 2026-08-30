import { bus } from "../shared/bus.js";

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
  currentDraft,
  eventBus = bus,
  now = () => new Date(),
  userAgent = () => navigator.userAgent,
}) {
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
  eventBus.emit("signed", { artifact });
  return { artifact };
}

export function initSigning({
  button,
  status,
  getGateState,
  getCurrentDraft,
  beforeSign = () => undefined,
  eventBus = bus,
  now,
  userAgent,
}) {
  let artifactDraft = null;
  status.textContent = "Awaiting local approval";
  button.disabled = true;

  const unsubscribeStaged = eventBus.on("staged", (event) => {
    artifactDraft = event.artifactDraft;
    status.textContent = "Awaiting local approval";
    button.disabled = false;
  });
  const unsubscribeDraft = eventBus.on("draft", () => {
    if (artifactDraft === null) return;
    artifactDraft = null;
    status.textContent = "Draft changed · run and stage again";
    button.disabled = true;
  });
  const onClick = async () => {
    button.disabled = true;
    await beforeSign();
    const gateState = getGateState();
    const result = signArtifact({
      artifactDraft,
      gateState,
      currentDraft: getCurrentDraft ? getCurrentDraft() : gateState.draft,
      eventBus,
      now,
      userAgent,
    });
    if (Object.hasOwn(result, "artifact")) {
      status.textContent = "Locally approved";
    } else {
      artifactDraft = null;
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
