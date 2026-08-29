import { init as initBanner } from "/src/ui/banner.js";
import { init as initPrompt } from "/src/ui/prompt.js";
import { init as initScoreboard } from "/src/ui/scoreboard.js";
import { init as initTimeline } from "/src/ui/timeline.js";
import {
  DEMO_TARGET_ID,
  init as initSimagent,
  isDemoMode,
  prewarmDemo,
} from "/src/simagent/simagent.js";
import { bus } from "/src/shared/bus.js";

initBanner(document.querySelector("#env-banner"));
initPrompt(document.querySelector("#demo-prompt"));
initTimeline(document.querySelector("#timeline"), { bus });
initScoreboard(document.querySelector("#scoreboard"), { bus });

const target = {
  id: DEMO_TARGET_ID,
  library: "qs",
  demoRepros: {
    broken: "assert(false, \"I have not isolated the regression yet\");",
    weak: "const parsed = Qs.parse(\"a=b\");\nassert(parsed.a === \"b\", \"basic query parsing should work\");",
    real: "const parsed = Qs.parse(\"a%252Eb=c\");\nassert(Object.keys(parsed).length === 1 && parsed[\"a%2Eb\"] === \"c\", \"encoded dots must stay encoded by default\");",
  },
};

const demoMode = isDemoMode(location.search);
const prewarmStatus = document.querySelector("#prewarm-status");

function createMockPrewarmDeps() {
  const bundles = {
    bad: { sha256: "mock-bad-bundle", text: "globalThis.Qs = {}" },
    good: { sha256: "mock-good-bundle", text: "globalThis.Qs = {}" },
  };
  return {
    async loadTarget(id) {
      const responses = await Promise.all([
        fetch("/contracts/fixtures/differential-failboth.json"),
        fetch("/contracts/fixtures/differential-green.json"),
      ]);
      if (responses.some(response => !response.ok)) throw new Error("Mock bundle fetch failed");
      return { manifest: { ...target, id, globalName: "Qs" }, bundles };
    },
    createRunner() {
      return {
        async load() {},
        async run() { return { verdict: "pass", logs: [], durationMs: 0 }; },
        destroy() {},
      };
    },
  };
}

if (demoMode) {
  prewarmStatus.hidden = false;
  try {
    let deps;
    try {
      deps = await import("/src/sandbox/runner.js");
    } catch {
      deps = createMockPrewarmDeps();
    }
    await prewarmDemo(deps);
    prewarmStatus.textContent = `Demo ready · fixed target ${DEMO_TARGET_ID} · both bundles and worker path prewarmed`;
  } catch (error) {
    prewarmStatus.textContent = `Demo prewarm failed: ${error.message}`;
  }
}

let draft = "";
let runCount = 0;
let gateOpen = false;
const verdicts = [
  { green: false, reason: "FAIL_BOTH" },
  { green: false, reason: "PASS_BOTH" },
  { green: true, reason: "REGRESSION_DEMONSTRATED" },
];

function getToolTable() {
  const table = {
    get_target_info: {
      definition: { name: "get_target_info" },
      execute: async () => {
        runCount = 0;
        gateOpen = false;
        return { targetId: target.id, library: target.library };
      },
    },
    write_repro: {
      definition: { name: "write_repro" },
      execute: async ({ code }) => {
        draft = code;
        const reproSha256 = `mock-${String(runCount + 1).padStart(2, "0")}`;
        bus.emit("draft", { reproSha256, length: code.length });
        return { reproSha256 };
      },
    },
    run_repro: {
      definition: { name: "run_repro" },
      execute: async () => {
        const verdict = verdicts[runCount++];
        bus.emit("run", { verdict });
        if (verdict.green) {
          gateOpen = true;
          bus.emit("surface", {
            change: "registered",
            tool: "submit_report",
            reason: "differential green",
            at: Date.now(),
          });
        }
        return verdict;
      },
    },
  };
  if (gateOpen) {
    table.submit_report = {
      definition: { name: "submit_report" },
      execute: async () => {
        const artifactDraft = { targetId: target.id, repro: draft };
        bus.emit("staged", { artifactDraft });
        return { status: "staged_awaiting_human_signature" };
      },
    };
  }
  return table;
}

initSimagent(document.querySelector("#simagent"), { target, getToolTable, demoMode });

const mockEvents = [
  ["draft", { reproSha256: "95c0868307c15a55", length: 198 }],
  ["run", { verdict: { green: false, reason: "FAIL_BOTH" } }],
  ["staged", { artifactDraft: { targetId: DEMO_TARGET_ID } }],
  ["surface", { change: "registered", tool: "submit_report", reason: "differential green", at: Date.now() }],
  ["signed", { artifact: { targetId: DEMO_TARGET_ID } }],
];

const controls = document.querySelector("#timeline-controls");
for (const [type, detail] of mockEvents) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Emit ${type}`;
  button.addEventListener("click", () => bus.emit(type, detail));
  controls.append(button);
}
