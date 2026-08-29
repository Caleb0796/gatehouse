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
    if (
      verdict.green === true &&
      verdict.reproSha256 === state.draftSha &&
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
