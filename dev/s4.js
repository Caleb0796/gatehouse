import { init as initBanner } from "/src/ui/banner.js";
import { init as initTimeline } from "/src/ui/timeline.js";
import { bus } from "/src/shared/bus.js";

initBanner(document.querySelector("#env-banner"));
initTimeline(document.querySelector("#timeline"), { bus });

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
