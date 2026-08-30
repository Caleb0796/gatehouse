import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHATGPT_SETTINGS_PATH,
  CHROME_COMMAND,
  detectEnvironment,
} from "./banner.js";

const modelContext = { registerTool() {} };

test("detectEnvironment reports live WebMCP on a secure page", () => {
  const result = detectEnvironment({
    modelContext,
    isSecureContext: true,
    userAgent: "Mozilla/5.0 Chrome/151.0.0.0",
  });

  assert.equal(result.mode, "live");
  assert.equal(result.tone, "live");
  assert.equal(result.browser, "Chrome");
  assert.equal(result.hasWebMCP, true);
});

test("detectEnvironment makes fallback simulation mode explicit", () => {
  const result = detectEnvironment({
    modelContext: undefined,
    isSecureContext: true,
    userAgent: "ChatGPT/1.0",
  });

  assert.equal(result.mode, "simulation");
  assert.equal(result.tone, "warning");
  assert.equal(result.browser, "ChatGPT Browser");
  assert.match(result.title, /模拟模式/);
});

test("insecure context takes precedence over an exposed API", () => {
  const result = detectEnvironment({
    modelContext,
    isSecureContext: false,
    userAgent: "Mozilla/5.0 Chrome/151.0.0.0",
  });

  assert.equal(result.mode, "insecure");
  assert.equal(result.tone, "danger");
  assert.equal(result.hasWebMCP, true);
});

test("setup copy contains the complete tested paths", () => {
  assert.equal(
    CHROME_COMMAND,
    'open -na "Google Chrome" --args --enable-features=WebMCPTesting --user-data-dir="$HOME/.webmcp-profile" http://localhost:8080/',
  );
  assert.equal(
    CHATGPT_SETTINGS_PATH,
    "Settings → Browser → Permissions → Enable site tools",
  );
});
