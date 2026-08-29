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

function assertSupportedChrome(product) {
  const major = Number.parseInt(product.match(/^Chrome\/(\d+)/)?.[1] ?? "", 10);
  if (!Number.isInteger(major) || major < 151) {
    throw new Error(`Chrome 151 or newer is required, got ${product}`);
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
    assertSupportedChrome(version.product);
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

    const installArtifactCapture = () => page.evaluate(async () => {
      const { bus } = await import("/src/shared/bus.js");
      window.__gatehouseEvalSignedArtifact = null;
      window.__gatehouseEvalUnsubscribe?.();
      window.__gatehouseEvalUnsubscribe = bus.on("signed", ({ artifact }) => {
        window.__gatehouseEvalSignedArtifact = artifact;
      });
    });

    const navigate = async (nextUrl = targetUrl) => {
      await page.goto(assertHttpUrl(nextUrl), { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        () => document.body.dataset.appReady === "true"
          && typeof window.__gatehouseTestHook?.executeTool === "function",
      );
      await installArtifactCapture();
    };

    const interceptBundle = async (version, mutation) => {
      if (version !== "bad" && version !== "good") {
        throw new Error(`Unknown bundle version: ${version}`);
      }
      if (mutation !== "append-byte") {
        throw new Error(`Unknown bundle mutation: ${mutation}`);
      }
      const matcher = new RegExp(`/targets/[^/]+/${version}\\.js(?:\\?.*)?$`);
      await page.route(matcher, async (route) => {
        const response = await route.fetch();
        const body = await response.body();
        await route.fulfill({ response, body: Buffer.concat([body, Buffer.from(" ")]) });
      }, { times: 1 });
    };

    const readSignedArtifact = () => page.evaluate(
      () => window.__gatehouseEvalSignedArtifact,
    );

    const encodeReceipt = (artifact) => page.evaluate(async (value) => {
      const receipt = await import("/src/inbox/receipt.js");
      return receipt.encodeReceipt(value);
    }, artifact);

    const decodeReceipt = (receipt) => page.evaluate(async (value) => {
      const codec = await import("/src/inbox/receipt.js");
      if (typeof value?.url !== "string") return { error: "receipt has no URL" };
      const hash = value.url.slice(value.url.indexOf("#"));
      return codec.decodeReceipt(hash);
    }, receipt);

    const click = async (selector) => {
      const locator = page.locator(selector);
      if (await locator.count() > 0) {
        await locator.click();
        return;
      }
      if (selector === "#sign-panel button") {
        await page.locator("#sign").click();
        return;
      }
      throw new Error(`Element not found: ${selector}`);
    };

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
      click,
      decodeReceipt,
      encodeReceipt,
      interceptBundle,
      navigate,
      probePage: () => page.evaluate(async () => {
        const startedAt = performance.now();
        await new Promise((resolve) => setTimeout(resolve, 0));
        return {
          alive: true,
          at: performance.now(),
          recoveryMs: performance.now() - startedAt,
        };
      }),
      readSignedArtifact,
      reset: () => navigate(targetUrl),
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
