import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHATGPT_SETTINGS_PATH,
  CHROME_COMMAND,
  buildChromeCommand,
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

test("detectEnvironment makes deterministic demo simulation mode explicit", () => {
  const result = detectEnvironment({
    modelContext: undefined,
    isSecureContext: true,
    userAgent: "ChatGPT/1.0",
    demoMode: true,
  });

  assert.equal(result.mode, "simulation");
  assert.equal(result.tone, "warning");
  assert.equal(result.browser, "ChatGPT Browser");
  assert.equal(result.title, "SIMULATION MODE");
});

test("detectEnvironment does not claim an in-page agent on a plain fallback URL", () => {
  const result = detectEnvironment({
    modelContext: undefined,
    isSecureContext: true,
    userAgent: "Mozilla/5.0 Chrome/151.0.0.0",
    demoMode: false,
  });

  assert.equal(result.mode, "unavailable");
  assert.equal(result.tone, "warning");
  assert.equal(result.title, "WEBMCP UNAVAILABLE");
  assert.equal(
    result.message,
    "No in-page agent is active on this URL. Enable WebMCP or open the deterministic demo.",
  );
});

test("insecure context takes precedence over an exposed API", () => {
  const result = detectEnvironment({
    modelContext,
    isSecureContext: false,
    userAgent: "Mozilla/5.0 Chrome/151.0.0.0",
    demoMode: true,
  });

  assert.equal(result.mode, "insecure");
  assert.equal(result.tone, "danger");
  assert.equal(result.hasWebMCP, true);
});

test("setup copy contains the complete tested paths", () => {
  assert.equal(
    CHROME_COMMAND,
    'open -na "Google Chrome" --args --enable-features=WebMCPTesting --user-data-dir="$HOME/.webmcp-profile" <url>',
  );
  assert.equal(
    CHATGPT_SETTINGS_PATH,
    "Settings → Browser → Permissions → Enable site tools",
  );
});

test("Chrome command shell-quotes untrusted page URLs", () => {
  const url = "https://example.test/?next=';open -a Calculator;#";
  const command = buildChromeCommand(url);

  assert.equal(
    command,
    'open -na "Google Chrome" --args --enable-features=WebMCPTesting --user-data-dir="$HOME/.webmcp-profile" \'https://example.test/?next=\'"\'"\';open -a Calculator;#\'',
  );
  assert.doesNotMatch(command, /<url>/);
});
