const ROUNDS = [
  ["broken", "Broken attempt"],
  ["weak", "Weak attempt"],
  ["real", "Regression repro"],
];

export const DEMO_TARGET_ID = "qs-500";

export function isDemoMode(search = "") {
  return new URLSearchParams(search).get("demo") === "1";
}

export async function prewarmDemo({ loadTarget, createRunner }) {
  if (typeof loadTarget !== "function" || typeof createRunner !== "function") {
    throw new TypeError("demo prewarm requires loadTarget and createRunner");
  }

  const loaded = await loadTarget(DEMO_TARGET_ID);
  const { manifest, bundles } = loaded;
  const runner = createRunner();

  try {
    await runner.load([bundles.bad, bundles.good]);
    await Promise.all([bundles.bad, bundles.good].map(bundle => runner.run({
      bundleSha: bundle.sha256,
      globalName: manifest.globalName,
      code: "",
      timeoutMs: 2_000,
    })));
  } finally {
    runner.destroy();
  }

  return loaded;
}

function toolName(tool) {
  return tool?.name || tool?.definition?.name;
}

function validateTarget(target) {
  if (!target || typeof target !== "object" || !target.demoRepros) {
    throw new TypeError("simagent requires a target with demoRepros");
  }
  for (const [key] of ROUNDS) {
    if (typeof target.demoRepros[key] !== "string" || !target.demoRepros[key]) {
      throw new TypeError(`target.demoRepros.${key} must be a non-empty string`);
    }
  }
}

export function createToolInvoker({ modelContext, getToolTable }) {
  const hasWebMCP = modelContext
    && typeof modelContext.getTools === "function"
    && typeof modelContext.executeTool === "function";

  if (hasWebMCP) {
    return {
      mode: "live",
      async execute(name, args) {
        const tools = await modelContext.getTools();
        const tool = tools.find(candidate => toolName(candidate) === name);
        if (!tool) throw new Error(`Tool not available: ${name}`);
        // executeTool takes args as a JSON STRING, not an object: Chrome does
        // JSON.parse(args) then an isObject check. Passing an object raises
        // "UnknownError: Failed to parse input arguments". Measured 2026-08-29,
        // Chrome 152.0.7977.64.
        const raw = await modelContext.executeTool(tool, JSON.stringify(args ?? {}));
        if (typeof raw !== "string") {
          throw new TypeError("Native WebMCP executeTool must return a JSON string.");
        }
        try {
          return JSON.parse(raw);
        } catch (error) {
          throw new TypeError("Native WebMCP executeTool returned invalid JSON.", { cause: error });
        }
      },
    };
  }

  if (typeof getToolTable !== "function") {
    throw new TypeError("simagent requires getToolTable when WebMCP is unavailable");
  }

  return {
    mode: "simulated",
    async execute(name, args) {
      const entry = getToolTable()[name];
      if (!entry || typeof entry.execute !== "function") {
        throw new Error(`Tool not available: ${name}`);
      }
      return entry.execute(args);
    },
  };
}

export async function run(target, deps = {}) {
  validateTarget(target);
  const invoke = createToolInvoker(deps);
  const intervalMs = deps.intervalMs ?? 800;
  const wait = deps.wait || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const onStep = deps.onStep || (() => {});
  const steps = [
    { label: "Inspect target", tool: "get_target_info", args: {} },
    ...ROUNDS.flatMap(([key, label]) => [
      { label: `${label}: write`, tool: "write_repro", args: { code: target.demoRepros[key] } },
      { label: `${label}: run`, tool: "run_repro", args: {} },
    ]),
    { label: "Stage local evidence", tool: "submit_report", args: {} },
  ];

  const results = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    onStep({ ...step, state: "running", mode: invoke.mode });
    try {
      const result = await invoke.execute(step.tool, step.args);
      results.push({ tool: step.tool, result });
      onStep({ ...step, state: "complete", mode: invoke.mode, result });
    } catch (error) {
      onStep({ ...step, state: "error", mode: invoke.mode, error });
      throw error;
    }
    if (index < steps.length - 1) await wait(intervalMs);
  }

  return { mode: invoke.mode, results };
}

export function init(rootEl, deps = {}) {
  const doc = deps.document || document;
  const modelContext = deps.modelContext === undefined ? doc.modelContext : deps.modelContext;
  const demoMode = deps.demoMode ?? isDemoMode(deps.search ?? doc.defaultView?.location?.search);
  const hasWebMCP = modelContext
    && typeof modelContext.getTools === "function"
    && typeof modelContext.executeTool === "function";

  rootEl.replaceChildren();
  rootEl.className = demoMode ? "simagent simagent--demo" : "simagent";

  const heading = doc.createElement("h2");
  heading.textContent = "Simulated agent";

  const mode = doc.createElement("strong");
  mode.className = hasWebMCP ? "simagent__mode simagent__mode--live" : "simagent__mode simagent__mode--simulated";
  mode.textContent = hasWebMCP ? "Live WebMCP tool path" : "模拟模式 · in-page tool path";

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "simagent__start";
  button.textContent = "Run three-round agent demo";

  const status = doc.createElement("p");
  status.className = "simagent__status";
  status.textContent = "Ready";

  const list = doc.createElement("ol");
  list.className = "simagent__steps";
  list.setAttribute("aria-live", "polite");

  if (demoMode) rootEl.append(button, heading, mode, status, list);
  else rootEl.append(heading, mode, button, status, list);

  button.addEventListener("click", async () => {
    button.disabled = true;
    list.replaceChildren();
    const items = new Map();
    try {
      const result = await run(deps.target, {
        modelContext,
        getToolTable: deps.getToolTable,
        intervalMs: deps.intervalMs,
        wait: deps.wait,
        onStep(step) {
          let item = items.get(step.tool + step.label);
          if (!item) {
            item = doc.createElement("li");
            items.set(step.tool + step.label, item);
            list.append(item);
          }
          item.className = `simagent__step simagent__step--${step.state}`;
          item.textContent = `${step.label} · ${step.tool} · ${step.state}`;
        },
      });
      status.textContent = `Complete via ${result.mode === "live" ? "WebMCP" : "模拟模式"}`;
    } catch (error) {
      status.textContent = `Stopped: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });

  return { button, status };
}
