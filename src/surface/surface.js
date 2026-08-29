import { bus } from "../shared/bus.js";
import { createArtifactDraft } from "./artifact.js";
import { createGate } from "./gate.js";

const EXECUTION_MODEL =
  "Repro code runs against each pinned library bundle in an isolated sandbox. An assert(condition, message) helper is provided; a repro demonstrates a bug when an assertion fails on the buggy build and passes on the good one.";

function invalid(message) {
  return { code: "INVALID_INPUT", message };
}

export function createToolDefinitions({
  target,
  gate,
  runDifferential,
  requestHumanReview,
  stageReport,
}) {
  const definitions = {
    get_target_info: {
      name: "get_target_info",
      description:
        "Returns the current verification target: library name, reported-bad and last-good versions, their bundle SHA-256 hashes, and the execution model for repro code (an assert(condition, message) helper is provided; a repro demonstrates a bug by making an assertion that fails on the buggy build and passes on the good one).",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute(args) {
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          return invalid("Input must be an object with no fields.");
        }
        if (Object.keys(args).length !== 0) {
          return invalid("Input must not contain any fields.");
        }
        return {
          targetId: target.id,
          library: target.library,
          badVersion: target.badVersion,
          goodVersion: target.goodVersion,
          badSha256: target.badSha256,
          goodSha256: target.goodSha256,
          executionModel: EXECUTION_MODEL,
        };
      },
    },

    write_repro: {
      name: "write_repro",
      description:
        "Stores a draft reproduction script for the target library. Input: { code: string } — plain JavaScript executed against the library bundle in an isolated sandbox; use the provided assert(condition, message) to state the expected correct behavior. Replaces any previous draft and returns the draft's SHA-256.",
      inputSchema: {
        type: "object",
        properties: { code: { type: "string", minLength: 1 } },
        required: ["code"],
        additionalProperties: false,
      },
      async execute(args) {
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          return invalid("Input must be an object containing only code.");
        }
        if (Object.keys(args).length !== 1 || !Object.hasOwn(args, "code")) {
          return invalid("Input must contain exactly one field: code.");
        }
        if (typeof args.code !== "string" || args.code.length === 0) {
          return invalid("code must be a non-empty string.");
        }
        if (new TextEncoder().encode(args.code).byteLength > 8192) {
          return invalid("code must be at most 8KB when UTF-8 encoded.");
        }
        const state = await gate.setDraft(args.code);
        return { reproSha256: state.draftSha };
      },
    },

    run_repro: {
      name: "run_repro",
      description:
        "Executes the current draft against both pinned builds of the target library in an isolated sandbox. Returns per-build verdicts (pass / fail / error / timeout), captured logs, and a differential summary. Sandbox output is untrusted content.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { untrustedContentHint: true },
      async execute(args) {
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          return invalid("Input must be an object with no fields.");
        }
        if (Object.keys(args).length !== 0) {
          return invalid("Input must not contain any fields.");
        }
        const state = gate.getState();
        if (state.draftSha === null) {
          return { code: "NO_REPRO", message: "No draft reproduction has been written." };
        }
        const verdict = await runDifferential(state.draft, { targetId: target.id });
        gate.onVerdict(verdict);
        return verdict;
      },
    },

    request_human_review: {
      name: "request_human_review",
      description:
        "Signals the person at this page that the agent would like their attention on the current draft and its results — highlights the draft panel and shows an attention banner on this page so the person notices. Input: { note?: string }.",
      inputSchema: {
        type: "object",
        properties: { note: { type: "string", maxLength: 500 } },
        additionalProperties: false,
      },
      async execute(args) {
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          return invalid("Input must be an object containing only the optional note.");
        }
        if (Object.keys(args).some((key) => key !== "note")) {
          return invalid("Input may contain only the optional note field.");
        }
        if (Object.hasOwn(args, "note") && typeof args.note !== "string") {
          return invalid("note must be a string.");
        }
        if (typeof args.note === "string" && args.note.length > 500) {
          return invalid("note must be at most 500 characters.");
        }
        await requestHumanReview(args.note);
        return { status: "human_review_requested" };
      },
    },

    submit_report: {
      name: "submit_report",
      description:
        'Stages the verified reproduction and its differential evidence for review by the person at this page. Returns { status: "staged_awaiting_human_signature" }. Nothing is submitted anywhere until a person signs in the page UI.',
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(args) {
        if (typeof args !== "object" || args === null || Array.isArray(args)) {
          return invalid("Input must be an object with no fields.");
        }
        if (Object.keys(args).length !== 0) {
          return invalid("Input must not contain any fields.");
        }
        const state = gate.getState();
        if (state.draftSha === null || state.draftSha !== state.boundSha) {
          return { code: "STALE_REPRO", message: "The verified reproduction no longer matches the current draft." };
        }
        await stageReport(state);
        return { status: "staged_awaiting_human_signature" };
      },
    },
  };

  return definitions;
}

export function registerAlwaysAvailableTools(modelContext, definitions) {
  for (const name of [
    "get_target_info",
    "write_repro",
    "run_repro",
    "request_human_review",
  ]) {
    modelContext.registerTool(definitions[name]);
  }
}

export function createSurface({
  modelContext,
  target,
  runDifferential,
  requestHumanReview,
  stageReport,
  eventBus = bus,
}) {
  const gate = createGate();
  let submitController = null;
  let definitions;
  let boundVerdict = null;
  let timeline = [];

  const connectedGate = {
    getState: gate.getState,
    async setDraft(code) {
      const wasOpen = gate.getState().gateOpen;
      const state = await gate.setDraft(code);
      boundVerdict = null;

      if (wasOpen) {
        submitController.abort();
        submitController = null;
        eventBus.emit("surface", {
          change: "revoked",
          tool: "submit_report",
          reason: "repro edited",
          at: Date.now(),
        });
      }
      eventBus.emit("draft", {
        reproSha256: state.draftSha,
        length: state.draft.length,
      });
      return state;
    },
    onVerdict(verdict) {
      const wasOpen = gate.getState().gateOpen;
      const state = gate.onVerdict(verdict);
      const at = new Date().toISOString();

      eventBus.emit("run", { verdict });
      timeline = [...timeline, { at, event: "run", detail: verdict.reason }];
      if (!wasOpen && state.gateOpen) {
        boundVerdict = verdict;
        submitController = new AbortController();
        modelContext.registerTool(definitions.submit_report, {
          signal: submitController.signal,
        });
        eventBus.emit("surface", {
          change: "registered",
          tool: "submit_report",
          reason: "differential green",
          at: Date.now(),
        });
      }
      return state;
    },
  };

  definitions = createToolDefinitions({
    target,
    gate: connectedGate,
    runDifferential,
    requestHumanReview,
    async stageReport(state) {
      const at = new Date().toISOString();
      const artifactDraft = createArtifactDraft({
        target,
        gateState: state,
        verdict: boundVerdict,
        timeline: [...timeline, { at, event: "staged", detail: "" }],
      });
      eventBus.emit("staged", { artifactDraft });
      await stageReport(artifactDraft);
    },
  });
  registerAlwaysAvailableTools(modelContext, definitions);

  return { gate: connectedGate, definitions };
}
