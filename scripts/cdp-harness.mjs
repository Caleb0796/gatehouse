const CHROME_CHANNEL = "chrome";
const WEBMCP_FLAG = "--enable-features=WebMCP";

function parseToolResult(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function importPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      "Playwright is not installed. Ask the coordinator to add it to package.json and package-lock.json.",
      { cause: error },
    );
  }
}

function assertHttpUrl(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Evaluation URL must use http: or https:");
  }
  return parsed.href;
}

export async function launchChromeHarness({
  url,
  headless = true,
  playwright,
} = {}) {
  const targetUrl = assertHttpUrl(url);
  const { chromium } = playwright ?? await importPlaywright();
  const browser = await chromium.launch({
    channel: CHROME_CHANNEL,
    headless,
    args: [WEBMCP_FLAG],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const version = await cdp.send("Browser.getVersion");
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

    const getWebMcpTools = () => page.evaluate(async () => {
      const api = document.modelContext;
      if (!api || typeof api.getTools !== "function") {
        throw new Error("Native document.modelContext.getTools() is unavailable");
      }
      const tools = await api.getTools();
      return tools.map(({ annotations, description, inputSchema, name, origin, title }) => ({
        annotations,
        description,
        inputSchema,
        name,
        origin,
        title,
      }));
    });

    const executeWebMcpTool = async (name, input = {}) => parseToolResult(
      await page.evaluate(async ({ name: toolName, input: toolInput }) => {
        const api = document.modelContext;
        if (!api || typeof api.getTools !== "function" || typeof api.executeTool !== "function") {
          throw new Error("Native document.modelContext tool execution is unavailable");
        }
        const tools = await api.getTools();
        const tool = tools.find(({ name }) => name === toolName);
        if (!tool) throw new Error(`WebMCP tool not found: ${toolName}`);
        return api.executeTool(tool, JSON.stringify(toolInput));
      }, { name, input }),
    );

    const captureWebMcpTool = (name) => page.evaluateHandle(async (toolName) => {
      const api = document.modelContext;
      if (!api || typeof api.getTools !== "function") {
        throw new Error("Native document.modelContext.getTools() is unavailable");
      }
      const tools = await api.getTools();
      const tool = tools.find(({ name }) => name === toolName);
      if (!tool) throw new Error(`WebMCP tool not found: ${toolName}`);
      return tool;
    }, name);

    const executeCapturedWebMcpTool = async (tool, input = {}) => parseToolResult(
      await page.evaluate(async ({ tool: capturedTool, input: toolInput }) => {
        const api = document.modelContext;
        if (!api || typeof api.executeTool !== "function") {
          throw new Error("Native document.modelContext.executeTool() is unavailable");
        }
        return api.executeTool(capturedTool, JSON.stringify(toolInput));
      }, { tool, input }),
    );

    const getLogicTools = () => page.evaluate(async () => {
      const hook = window.__gatehouseTestHook;
      if (!hook || typeof hook.getTools !== "function") {
        throw new Error("Gatehouse ?test=1 getTools hook is unavailable");
      }
      const tools = await hook.getTools();
      if (Array.isArray(tools)) return tools;
      return Object.entries(tools).map(([name, entry]) => ({
        name,
        ...(entry.definition ?? entry),
      }));
    });

    const executeLogicTool = (name, input = {}) => page.evaluate(
      async ({ name: toolName, input: toolInput }) => {
        const hook = window.__gatehouseTestHook;
        if (!hook || typeof hook.executeTool !== "function") {
          throw new Error("Gatehouse ?test=1 executeTool hook is unavailable");
        }
        return hook.executeTool(toolName, toolInput);
      },
      { name, input },
    );

    return {
      browser,
      chromeVersion: version.product,
      page,
      logic: {
        executeTool: executeLogicTool,
        getTools: getLogicTools,
      },
      webmcp: {
        captureTool: captureWebMcpTool,
        executeCapturedTool: executeCapturedWebMcpTool,
        executeTool: executeWebMcpTool,
        getTools: getWebMcpTools,
      },
      probePage: () => page.evaluate(() => ({ alive: true, at: performance.now() })),
      reset: () => page.reload({ waitUntil: "domcontentloaded" }),
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export const chromeLaunchContract = Object.freeze({
  channel: CHROME_CHANNEL,
  args: Object.freeze([WEBMCP_FLAG]),
});
