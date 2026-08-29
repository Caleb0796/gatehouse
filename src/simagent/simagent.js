const ROUNDS = [
  ["broken", "Broken attempt"],
  ["weak", "Weak attempt"],
  ["real", "Regression repro"],
];

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
        return modelContext.executeTool(tool, args);
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
    { label: "Stage verified report", tool: "submit_report", args: {} },
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
  const hasWebMCP = modelContext
    && typeof modelContext.getTools === "function"
    && typeof modelContext.executeTool === "function";

  rootEl.replaceChildren();
  rootEl.className = "simagent";

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

  rootEl.append(heading, mode, button, status, list);

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
