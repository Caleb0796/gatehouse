import { init as initInbox } from "../inbox/inbox.js";
import { loadTarget, runDifferential as runRealDifferential } from "../sandbox/runner.js";
import { bus } from "../shared/bus.js";
import { init as initSimagent, isDemoMode } from "../simagent/simagent.js";
import { init as initBanner } from "../ui/banner.js";
import { init as initScoreboard } from "../ui/scoreboard.js";
import { init as initTimeline } from "../ui/timeline.js";
import { initSigning } from "./sign.js";
import { createSurface, getToolTable, MAX_REPRO_BYTES } from "./surface.js";

const TARGET_ID = "qs-500";

function requiredElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required slot: #${id}`);
  return element;
}

function appendText(parent, tagName, text, className) {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function createFallbackModelContext() {
  const registrations = new Map();
  return {
    registerTool(definition, options = {}) {
      registrations.set(definition.name, definition);
      options.signal?.addEventListener(
        "abort",
        () => registrations.delete(definition.name),
        { once: true },
      );
    },
  };
}

function renderTarget(rootEl, target) {
  rootEl.className = "panel target-panel";
  appendText(rootEl, "p", "Executed, replayable bug reports", "eyebrow");
  appendText(rootEl, "h1", "Gatehouse");
  appendText(rootEl, "p", target.summary, "target-panel__summary");

  const versions = document.createElement("dl");
  versions.className = "target-panel__versions";
  for (const [label, value] of [
    ["Target", `${target.library} · ${target.id}`],
    ["Reported bad", `${target.badVersion} · ${target.badSha256}`],
    ["Reference build", `${target.goodVersion} · ${target.goodSha256}`],
  ]) {
    appendText(versions, "dt", label);
    appendText(versions, "dd", value);
  }
  rootEl.append(versions);

  if (target.issueUrl) {
    const issue = document.createElement("a");
    issue.href = target.issueUrl;
    issue.textContent = "View upstream issue";
    issue.rel = "noreferrer";
    rootEl.append(issue);
  }
}

function renderEditor(rootEl, initialCode) {
  rootEl.className = "panel editor-panel";
  appendText(rootEl, "h2", "Reproduction editor");
  appendText(
    rootEl,
    "p",
    "Write JavaScript that fails an assertion on the reported build and passes on the reference build.",
    "panel__help",
  );
  const label = appendText(rootEl, "label", "Repro code", "editor-panel__label");
  label.htmlFor = "repro-editor";
  const editor = document.createElement("textarea");
  editor.id = "repro-editor";
  editor.rows = 9;
  editor.spellcheck = false;
  editor.value = initialCode;
  const status = appendText(rootEl, "p", "Draft ready", "editor-panel__status");
  status.setAttribute("aria-live", "polite");
  rootEl.insertBefore(editor, status);
  return { editor, status };
}

function renderRunPanel(rootEl, demoMode) {
  rootEl.className = "panel run-panel";
  appendText(rootEl, "h2", "Differential run");
  const actions = document.createElement("div");
  actions.className = "run-panel__actions";
  const runButton = appendText(actions, "button", "Run bad vs good", "button button--primary");
  runButton.type = "button";
  const reviewButton = appendText(actions, "button", "Request human review", "button");
  reviewButton.type = "button";
  const output = appendText(rootEl, "pre", "Not run yet", "run-panel__output");
  output.setAttribute("aria-live", "polite");
  rootEl.insertBefore(actions, output);
  let simagentRoot = null;
  if (demoMode) {
    simagentRoot = document.createElement("section");
    simagentRoot.className = "simagent-host";
    rootEl.append(simagentRoot);
  }
  return { runButton, reviewButton, output, simagentRoot };
}

function renderSignPanel(rootEl) {
  rootEl.className = "panel sign-panel";
  appendText(rootEl, "h2", "Human signature");
  appendText(
    rootEl,
    "p",
    "A green differential can stage a report, but only a person can sign it.",
    "panel__help",
  );
  const reviewRoot = document.createElement("section");
  reviewRoot.className = "sign-panel__review";
  reviewRoot.hidden = true;
  appendText(reviewRoot, "h3", "Exact staged report");
  const reviewSummary = appendText(reviewRoot, "p", "", "sign-panel__review-summary");
  const reviewRepro = appendText(reviewRoot, "pre", "", "sign-panel__review-repro");
  rootEl.append(reviewRoot);
  const status = appendText(rootEl, "p", "未提交", "sign-panel__status");
  status.setAttribute("aria-live", "polite");
  const button = appendText(rootEl, "button", "Sign & submit", "button button--primary");
  button.type = "button";
  return {
    button,
    status,
    review: { root: reviewRoot, repro: reviewRepro, summary: reviewSummary },
  };
}

function formatRun(result) {
  if (result.code) return `${result.code}: ${result.message}`;
  const runs = Array.isArray(result.runs)
    ? result.runs.map(run => `${run.version}: ${run.verdict} (${run.durationMs}ms)`).join("\n")
    : "No per-build results";
  return `${result.green ? "GREEN" : "NOT GREEN"} · ${result.reason}\n${runs}`;
}

export function trackDemoE2E(eventBus, body) {
  const expectedReasons = ["FAIL_BOTH", "PASS_BOTH", "STABLE_LOCAL_DIFFERENTIAL"];
  let runIndex = 0;
  let submitRegistered = false;
  body.dataset.e2e = "ready";

  const unsubscribeRun = eventBus.on("run", ({ verdict }) => {
    if (verdict?.reason !== expectedReasons[runIndex]) {
      body.dataset.e2e = "fail";
      return;
    }
    runIndex += 1;
    body.dataset.e2e = `round-${runIndex}`;
    body.dataset.e2eRuns = expectedReasons.slice(0, runIndex).join(",");
  });
  const unsubscribeSurface = eventBus.on("surface", detail => {
    if (
      detail?.change === "registered"
      && detail.tool === "submit_report"
      && runIndex === expectedReasons.length
    ) {
      submitRegistered = true;
      body.dataset.e2e = "submit-report-available";
    }
  });
  const unsubscribeStaged = eventBus.on("staged", () => {
    body.dataset.e2e = runIndex === expectedReasons.length && submitRegistered
      ? "pass"
      : "fail";
  });

  return () => {
    unsubscribeRun();
    unsubscribeSurface();
    unsubscribeStaged();
  };
}

export async function initSurface({ runDifferential, target }) {
  const demoMode = isDemoMode(window.location.search);
  initBanner(requiredElement("env-banner"));
  initTimeline(requiredElement("timeline"), { bus });
  initScoreboard(requiredElement("scoreboard"), { bus });
  initInbox(requiredElement("inbox-root"), { bus, runDifferential });
  if (demoMode) trackDemoE2E(bus, document.body);

  renderTarget(requiredElement("target-panel"), target);
  const initialCode = target.demoRepros?.broken || "";
  const editorView = renderEditor(requiredElement("editor-panel"), initialCode);
  const runView = renderRunPanel(requiredElement("run-panel"), demoMode);
  const signView = renderSignPanel(requiredElement("sign-panel"));
  const modelContext = document.modelContext || createFallbackModelContext();
  const surface = createSurface({
    modelContext,
    target,
    runDifferential,
    async requestHumanReview(note) {
      editorView.status.textContent = note
        ? `Human review requested: ${note}`
        : "Human review requested";
      editorView.editor.focus();
      editorView.editor.classList.add("editor-panel__attention");
    },
    async stageReport() {},
  });

  if (runView.simagentRoot) {
    initSimagent(runView.simagentRoot, {
      target,
      modelContext,
      getToolTable,
      demoMode,
    });
  }

  initSigning({
    button: signView.button,
    status: signView.status,
    review: signView.review,
    getGateState: surface.gate.getState,
  });

  let draftUpdate = Promise.resolve();
  let draftValid = true;
  const storeDraft = code => {
    draftUpdate = draftUpdate.then(async () => {
      const state = await surface.gate.setDraft(code);
      draftValid = state.invalid !== true;
      if (!draftValid) {
        editorView.status.textContent = `Draft not stored · maximum ${MAX_REPRO_BYTES / 1024}KB UTF-8`;
        runView.runButton.disabled = true;
        return;
      }
      editorView.status.textContent = `Draft stored · ${state.draftSha.slice(0, 12)}`;
      editorView.editor.classList.remove("editor-panel__attention");
      runView.runButton.disabled = false;
    });
    return draftUpdate;
  };

  editorView.editor.addEventListener("input", () => {
    storeDraft(editorView.editor.value);
  });
  runView.runButton.addEventListener("click", async () => {
    runView.runButton.disabled = true;
    runView.output.textContent = "Running both pinned builds…";
    try {
      await draftUpdate;
      if (!draftValid) {
        runView.output.textContent = `Run blocked: repro code exceeds ${MAX_REPRO_BYTES / 1024}KB UTF-8.`;
        return;
      }
      const result = await surface.definitions.run_repro.execute({});
      runView.output.textContent = formatRun(result);
    } catch (error) {
      runView.output.textContent = `Run failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      runView.runButton.disabled = !draftValid;
    }
  });
  runView.reviewButton.addEventListener("click", async () => {
    await surface.definitions.request_human_review.execute({ note: "Please review this repro." });
  });

  await storeDraft(initialCode);
  document.body.dataset.appReady = "true";
  return surface;
}

async function bootstrap() {
  const { manifest } = await loadTarget(TARGET_ID);
  await initSurface({ runDifferential: runRealDifferential, target: manifest });
}

if (typeof document !== "undefined") {
  bootstrap().catch((error) => {
    document.body.dataset.appReady = "error";
    const root = document.getElementById("run-panel") || document.body;
    root.textContent = `Gatehouse failed to initialize: ${error instanceof Error ? error.message : String(error)}`;
  });
}
