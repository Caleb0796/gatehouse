import { sha256Hex } from "../shared/hash.js";

export function createGate() {
  let state = {
    draft: "",
    draftSha: null,
    boundSha: null,
    gateOpen: false,
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
    };
    return getState();
  }

  function onVerdict(verdict) {
    if (verdict.reproSha256 !== state.draftSha) return getState();

    if (verdict.green === true) {
      state = {
        ...state,
        boundSha: state.draftSha,
        gateOpen: true,
      };
    } else {
      state = {
        ...state,
        boundSha: null,
        gateOpen: false,
      };
    }
    return getState();
  }

  return { getState, setDraft, onVerdict };
}
