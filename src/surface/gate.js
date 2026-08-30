import { sha256Hex } from "../shared/hash.js";

export function createGate() {
  // This is a non-determinism filter over local self-attestation, not an anti-forgery boundary.
  const taintedDrafts = new Set();
  let runGeneration = 0;
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
    runGeneration += 1;
    state = {
      draft: code,
      draftSha,
      boundSha: null,
      gateOpen: false,
      tainted: taintedDrafts.has(draftSha),
    };
    return getState();
  }

  function beginRun() {
    runGeneration += 1;
    return runGeneration;
  }

  function isLatestRun(generation) {
    return generation === runGeneration;
  }

  function onVerdict(verdict, generation = runGeneration) {
    if (!isLatestRun(generation)) {
      return getState();
    }
    if (verdict.reproSha256 !== state.draftSha) {
      return getState();
    }
    if (verdict.green !== true || verdict.reason === "UNSTABLE") {
      taintedDrafts.add(state.draftSha);
      state = {
        ...state,
        boundSha: null,
        gateOpen: false,
        tainted: true,
      };
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

  return { getState, setDraft, beginRun, isLatestRun, onVerdict };
}
