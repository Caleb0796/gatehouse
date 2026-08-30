import { sha256Hex } from "../shared/hash.js";

export function createGate() {
  // This is a non-determinism filter over local self-attestation, not an anti-forgery boundary.
  const taintedDrafts = new Set();
  let state = {
    draft: "",
    draftSha: null,
    boundSha: null,
    gateOpen: false,
    tainted: false,
  };

  function getState() {
    return { ...state };
  }

  async function setDraft(code) {
    const draftSha = await sha256Hex(code);
    state = {
      draft: code,
      draftSha,
      boundSha: null,
      gateOpen: false,
      tainted: taintedDrafts.has(draftSha),
    };
    return getState();
  }

  function onVerdict(verdict) {
    if (verdict.reproSha256 !== state.draftSha) {
      return getState();
    }
    if (verdict.green !== true || verdict.reason === "UNSTABLE") {
      taintedDrafts.add(state.draftSha);
      state = { ...state, tainted: true };
    }
    if (
      verdict.green === true &&
      verdict.stable === true &&
      !taintedDrafts.has(state.draftSha) &&
      (!state.gateOpen || state.boundSha !== state.draftSha)
    ) {
      state = {
        ...state,
        boundSha: state.draftSha,
        gateOpen: true,
      };
    }
    return getState();
  }

  return { getState, setDraft, onVerdict };
}
