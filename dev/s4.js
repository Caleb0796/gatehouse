import { init as initBanner } from "/src/ui/banner.js";
import { init as initTimeline } from "/src/ui/timeline.js";
import { init as initSimagent } from "/src/simagent/simagent.js";
import { bus } from "/src/shared/bus.js";

initBanner(document.querySelector("#env-banner"));
initTimeline(document.querySelector("#timeline"), { bus });

const target = {
  id: "marked-1234",
  library: "marked",
  demoRepros: {
    broken: "assert(false, 'first attempt fails on both builds')",
    weak: "assert(true, 'weak attempt passes on both builds')",
    real: "assert(marked.parse('\\\\*') === '<p>*</p>', 'regression reproduced')",
  },
};

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

initSimagent(document.querySelector("#simagent"), { target, getToolTable });

const mockEvents = [
  ["draft", { reproSha256: "95c0868307c15a55", length: 198 }],
  ["run", { verdict: { green: false, reason: "FAIL_BOTH" } }],
  ["staged", { artifactDraft: { targetId: "marked-1234" } }],
  ["surface", { change: "registered", tool: "submit_report", reason: "differential green", at: Date.now() }],
  ["signed", { artifact: { targetId: "marked-1234" } }],
];

const controls = document.querySelector("#timeline-controls");
for (const [type, detail] of mockEvents) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = `Emit ${type}`;
  button.addEventListener("click", () => bus.emit(type, detail));
  controls.append(button);
}
