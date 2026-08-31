export const CHROME_COMMAND = 'open -na "Google Chrome" --args --enable-features=WebMCPTesting --user-data-dir="$HOME/.webmcp-profile" <url>';
export const CHATGPT_SETTINGS_PATH = "Settings → Browser → Permissions → Enable site tools";

function browserName(userAgent) {
  if (/ChatGPT/i.test(userAgent)) return "ChatGPT Browser";
  if (/(?:Chrome|CriOS)\//i.test(userAgent)) return "Chrome";
  return "Other browser";
}

export function detectEnvironment({ modelContext, isSecureContext, userAgent = "", demoMode = false }) {
  const hasWebMCP = Boolean(modelContext && typeof modelContext.registerTool === "function");
  const browser = browserName(userAgent);

  if (!isSecureContext) {
    return {
      mode: "insecure",
      tone: "danger",
      browser,
      hasWebMCP,
      title: "WebMCP blocked: insecure context",
      message: "Open Gatehouse over HTTPS or localhost before using live site tools.",
    };
  }

  if (hasWebMCP) {
    return {
      mode: "live",
      tone: "live",
      browser,
      hasWebMCP,
      title: "WebMCP live",
      message: "document.modelContext is available. Gatehouse can expose its live tool surface.",
    };
  }

  if (!demoMode) {
    return {
      mode: "unavailable",
      tone: "warning",
      browser,
      hasWebMCP,
      title: "WEBMCP UNAVAILABLE",
      message: "No in-page agent is active on this URL. Enable WebMCP or open the deterministic demo.",
    };
  }

  return {
    mode: "simulation",
    tone: "warning",
    browser,
    hasWebMCP,
    title: "SIMULATION MODE · 模拟模式",
    message: "WebMCP is unavailable here. The in-page agent will use the same tool implementations directly.",
  };
}

function appendText(doc, parent, tagName, text, className) {
  const element = doc.createElement(tagName);
  element.textContent = text;
  if (className) element.className = className;
  parent.append(element);
  return element;
}

function copyButton(doc, text, label, clipboard) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "env-banner__copy";
  button.textContent = label;
  button.addEventListener("click", async () => {
    try {
      await clipboard.writeText(text);
      button.textContent = "Copied";
    } catch {
      button.textContent = "Copy failed";
    }
  });
  return button;
}

export function init(rootEl, deps = {}) {
  const doc = deps.document || document;
  const win = deps.window || window;
  const nav = deps.navigator || navigator;
  const clipboard = deps.clipboard || nav.clipboard;
  const currentUrl = String(win.location?.href || "<url>");
  const demoMode = deps.demoMode ?? new URLSearchParams(win.location?.search || "").get("demo") === "1";
  const environment = detectEnvironment({
    modelContext: doc.modelContext,
    isSecureContext: win.isSecureContext,
    userAgent: nav.userAgent,
    demoMode,
  });

  rootEl.replaceChildren();
  rootEl.className = `env-banner env-banner--${environment.tone}`;
  rootEl.dataset.mode = environment.mode;
  rootEl.setAttribute("role", "status");

  const summary = doc.createElement("div");
  summary.className = "env-banner__summary";
  appendText(doc, summary, "strong", environment.title, "env-banner__title");
  appendText(doc, summary, "span", environment.message, "env-banner__message");
  appendText(
    doc,
    summary,
    "span",
    `${environment.browser} · secure context: ${win.isSecureContext ? "yes" : "no"} · document.modelContext: ${environment.hasWebMCP ? "detected" : "missing"}`,
    "env-banner__facts",
  );
  if (environment.mode === "unavailable") {
    const demoUrl = new URL(currentUrl);
    demoUrl.searchParams.set("demo", "1");
    const demoLink = doc.createElement("a");
    demoLink.className = "env-banner__demo-link";
    demoLink.href = demoUrl.href;
    demoLink.textContent = "Open deterministic demo";
    summary.append(demoLink);
  }

  const setup = doc.createElement("div");
  setup.className = "env-banner__setup";
  const chromeCommand = CHROME_COMMAND.replace("<url>", currentUrl);

  const chromeRow = doc.createElement("div");
  chromeRow.className = "env-banner__setup-row";
  appendText(doc, chromeRow, "code", chromeCommand);
  chromeRow.append(copyButton(doc, chromeCommand, "Copy Chrome command", clipboard));

  const chatGptRow = doc.createElement("div");
  chatGptRow.className = "env-banner__setup-row";
  appendText(doc, chatGptRow, "span", `${CHATGPT_SETTINGS_PATH} · GPT-5.6 Sol/Terra supported · Luna unavailable`);
  chatGptRow.append(copyButton(doc, CHATGPT_SETTINGS_PATH, "Copy ChatGPT path", clipboard));

  setup.append(chromeRow, chatGptRow);
  rootEl.append(summary, setup);

  return environment;
}
