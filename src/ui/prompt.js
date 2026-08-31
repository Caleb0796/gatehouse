export const DEMO_PROMPT = `Use the Gatehouse tools on this page to produce replayable regression evidence. Start with get_target_info. Then iterate with write_repro and run_repro until the repro fails on the reported version and passes on the last good version. When submit_report appears, call it to stage the report for my local approval.`;

export function init(rootEl, deps = {}) {
  const doc = deps.document || document;
  const clipboard = deps.clipboard || navigator.clipboard;

  rootEl.replaceChildren();
  rootEl.className = "demo-prompt";

  const heading = doc.createElement("h2");
  heading.className = "demo-prompt__heading";
  heading.textContent = "Demo prompt";

  const prompt = doc.createElement("p");
  prompt.className = "demo-prompt__text";
  prompt.textContent = DEMO_PROMPT;

  const status = doc.createElement("span");
  status.className = "demo-prompt__status";
  status.setAttribute("aria-live", "polite");

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "demo-prompt__copy";
  button.textContent = "Copy demo prompt";
  button.addEventListener("click", async () => {
    try {
      await clipboard.writeText(DEMO_PROMPT);
      status.textContent = "Prompt copied";
    } catch {
      status.textContent = "Copy failed";
    }
  });

  rootEl.append(heading, prompt, button, status);
  return DEMO_PROMPT;
}
