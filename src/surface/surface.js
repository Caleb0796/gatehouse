import { bus } from "../shared/bus.js";
import { createArtifactDraft } from "./artifact.js";
import { createGate } from "./gate.js";

const EXECUTION_MODEL =
  "Repro code runs client-side against each pinned library bundle in an isolated sandbox. An assert(condition, message) helper is provided; a local differential is reproduced when the assertion fails on the reported-bad build and passes on the comparison-good build. This is reporter-side evidence; independent replay and bundle provenance are not verified.";
const MAX_TOOL_OUTPUT_LENGTH = 1500;
const ALWAYS_AVAILABLE_TOOLS = [
  "get_target_info",
  "write_repro",
  "run_repro",
  "request_human_review",
];
let currentToolTable = {};

export function getToolTable() {
  return currentToolTable;
}

function visitObjects(value, visitor) {
  if (Array.isArray(value)) {
    return value.some((item) => visitObjects(item, visitor));
  }
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (visitor(value)) {
    return true;
  }
  return Object.values(value).some((item) => visitObjects(item, visitor));
}

function removeOldestLog(output) {
  return visitObjects(output, (value) => {
    if (!Array.isArray(value.logs) || value.logs.length === 0) {
      return false;
    }
    value.logs.shift();
    return true;
  });
}

function truncateStack(output, excess) {
  return visitObjects(output, (value) => {
    if (typeof value.stack !== "string" || value.stack.length === 0) {
      return false;
    }
    value.stack = value.stack.slice(0, Math.max(0, value.stack.length - excess));
    return true;
  });
}

export function clampToolOutput(output) {
  let serialized = JSON.stringify(output);
  const clamped = JSON.parse(serialized);

  while (serialized.length > MAX_TOOL_OUTPUT_LENGTH && removeOldestLog(clamped)) {
    serialized = JSON.stringify(clamped);
  }
  while (
    serialized.length > MAX_TOOL_OUTPUT_LENGTH &&
    truncateStack(clamped, serialized.length - MAX_TOOL_OUTPUT_LENGTH)
  ) {
    serialized = JSON.stringify(clamped);
  }
  if (serialized.length > MAX_TOOL_OUTPUT_LENGTH) {
    throw new Error("Tool output exceeds 1500 characters after clamping.");
  }
  return clamped;
}

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
        "Returns the single-target prototype configuration: library name, reported-bad and comparison-good versions, their bundle SHA-256 comparison identifiers, and the client-side execution model. Bundle provenance and independent replay are not verified.",
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
          globalName: target.globalName,
          summary: target.summary,
          issueUrl: target.issueUrl ?? null,
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
        const generation = gate.beginRun();
        const verdict = await runDifferential(state.draft, { targetId: target.id });
        gate.onVerdict(verdict, generation);
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
        'Stages the reproduction and its client-side N/N differential evidence for review by the person at this page. Independent replay and bundle provenance are not verified. Returns { status: "staged_awaiting_human_signature" }. Nothing is shared anywhere until a person signs in the page UI.',
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
          return { code: "STALE_REPRO", message: "The gate-bound reproduction no longer matches the current draft." };
        }
        await stageReport(state);
        return { status: "staged_awaiting_human_signature" };
      },
    },
  };

  for (const definition of Object.values(definitions)) {
    const execute = definition.execute;
    definition.execute = (...args) => {
      const output = execute(...args);
      return output instanceof Promise ? output.then(clampToolOutput) : clampToolOutput(output);
    };
  }

  return definitions;
}

export function registerAlwaysAvailableTools(modelContext, definitions) {
  for (const name of ALWAYS_AVAILABLE_TOOLS) {
    modelContext.registerTool(definitions[name].definition ?? definitions[name]);
  }
}

function installTestHook(windowObject, toolTable, activeTools) {
  if (
    windowObject === undefined ||
    new URLSearchParams(windowObject.location.search).get("test") !== "1"
  ) {
    return;
  }

  windowObject.__gatehouseTestHook = {
    async getTools() {
      return [...activeTools].map((name) => {
        const { execute, ...definition } = toolTable[name].definition;
        return definition;
      });
    },
    async executeTool(tool, args = {}) {
      const name = typeof tool === "string" ? tool : tool?.name;
      if (!activeTools.has(name) || toolTable[name] === undefined) {
        throw new Error(`Tool is not available: ${String(name)}`);
      }
      return toolTable[name].execute(args);
    },
  };
}

export function createSurface({
  modelContext,
  target,
  runDifferential,
  requestHumanReview,
  stageReport,
  eventBus = bus,
  windowObject = typeof window === "undefined" ? undefined : window,
}) {
  const gate = createGate();
  let submitController = null;
  let definitions;
  let toolTable;
  let boundVerdict = null;
  let timeline = [];
  const activeTools = new Set(ALWAYS_AVAILABLE_TOOLS);

  const connectedGate = {
    getState: gate.getState,
    beginRun: gate.beginRun,
    async setDraft(code) {
      const wasOpen = gate.getState().gateOpen;
      const state = await gate.setDraft(code);
      boundVerdict = null;

      if (wasOpen) {
        submitController.abort();
        submitController = null;
        activeTools.delete("submit_report");
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
    onVerdict(verdict, generation) {
      const isLatestRun = gate.isLatestRun(generation);
      const wasOpen = gate.getState().gateOpen;
      const state = gate.onVerdict(verdict, generation);

      if (!isLatestRun) {
        return state;
      }
      const at = new Date().toISOString();

      eventBus.emit("run", { verdict });
      timeline = [...timeline, { at, event: "run", detail: verdict.reason }];
      if (wasOpen && !state.gateOpen) {
        boundVerdict = null;
        submitController.abort();
        submitController = null;
        activeTools.delete("submit_report");
        eventBus.emit("surface", {
          change: "revoked",
          tool: "submit_report",
          reason: "differential not green",
          at: Date.now(),
        });
      }
      if (!wasOpen && state.gateOpen) {
        boundVerdict = verdict;
        submitController = new AbortController();
        modelContext.registerTool(toolTable.submit_report.definition, {
          signal: submitController.signal,
        });
        activeTools.add("submit_report");
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
  toolTable = Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      { definition, execute: definition.execute },
    ]),
  );
  currentToolTable = toolTable;
  registerAlwaysAvailableTools(modelContext, toolTable);
  installTestHook(windowObject, toolTable, activeTools);

  return { gate: connectedGate, definitions };
}
