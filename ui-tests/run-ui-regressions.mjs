import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createGatehouseServer } from "../scripts/dev-server.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUTPUT_DIR = fileURLToPath(new URL("../test-results/ui/", import.meta.url));
const STORAGE_KEY = "gatehouse.inbox.v1";
const VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
  { width: 320, height: 568 },
];

const fixture = JSON.parse(await readFile(
  new URL("../contracts/fixtures/artifact.sample.json", import.meta.url),
  "utf8",
));
const manifest = JSON.parse(await readFile(
  new URL("../targets/qs-500/manifest.json", import.meta.url),
  "utf8",
));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createArtifact({ signedAt, long = false }) {
  const suffix = long ? "x".repeat(4_096) : "";
  const repro = `${manifest.demoRepros.real}${long ? `\n// ${suffix}` : ""}`;
  return {
    v: 1,
    targetId: manifest.id,
    library: long ? `qs-${suffix}` : manifest.library,
    badVersion: manifest.badVersion,
    goodVersion: manifest.goodVersion,
    badSha256: manifest.badSha256,
    goodSha256: manifest.goodSha256,
    repro,
    reproSha256: sha256(repro),
    runs: [
      {
        version: "bad",
        verdict: "fail",
        logs: [long ? `ReproAssertionError:${suffix}` : "ReproAssertionError: regression"],
        durationMs: 12,
        bundleSha256: manifest.badSha256,
      },
      {
        version: "good",
        verdict: "pass",
        logs: [],
        durationMs: 10,
        bundleSha256: manifest.goodSha256,
      },
    ],
    timeline: [
      { at: signedAt, event: "run", detail: long ? suffix : "REGRESSION_DEMONSTRATED" },
      { at: signedAt, event: "staged", detail: "" },
      { at: signedAt, event: "signed", detail: "" },
    ],
    signedAt,
    ua: long ? `Gatehouse UI test/${suffix}` : "Gatehouse UI test",
    issueUrl: long ? `https://example.test/issues/${suffix}` : manifest.issueUrl,
    targetKind: "real",
  };
}

function safeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function startServer() {
  const server = createGatehouseServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function waitForApp(page) {
  await page.waitForFunction(() => document.body.dataset.appReady === "true");
}

async function waitForPaint(page) {
  await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function assertNoDocumentOverflow(page, label) {
  await waitForPaint(page);
  const layout = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")]
      .map(element => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName,
          className: element.className,
          left: rect.left,
          right: rect.right,
        };
      })
      .filter(({ left, right }) => left < -0.5 || right > window.innerWidth + 0.5)
      .slice(0, 8),
  }));
  assert.ok(
    layout.scrollWidth <= layout.innerWidth,
    `${label}: document is ${layout.scrollWidth}px wide in a ${layout.innerWidth}px viewport; ${JSON.stringify(layout.offenders)}`,
  );
}

async function assertNoElementOverflow(page, selector, label) {
  await waitForPaint(page);
  const offenders = await page.locator(selector).evaluateAll(elements => elements.flatMap(root => [
    root,
    ...root.querySelectorAll("*"),
  ]).filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({
    tag: element.tagName,
    className: element.className,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  })));
  assert.deepEqual(offenders, [], `${label}: ${JSON.stringify(offenders)}`);
}

async function assertEnglishPage(page, label) {
  assert.doesNotMatch(await page.locator("body").innerText(), /\p{Script=Han}/u, label);
}

async function runCase(browser, baseUrl, name, run) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  const diagnostics = [];
  page.on("console", message => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", error => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", request => {
    if (request.url().startsWith(baseUrl)) {
      diagnostics.push(`requestfailed: ${request.url()} · ${request.failure()?.errorText}`);
    }
  });
  page.on("response", response => {
    if (response.url().startsWith(baseUrl) && response.status() >= 400) {
      diagnostics.push(`response: ${response.status()} ${response.url()}`);
    }
  });

  let traceSaved = false;
  try {
    await run(page, context);
    assert.deepEqual(diagnostics, [], `unexpected browser diagnostics:\n${diagnostics.join("\n")}`);
    console.log(`PASS ${name}`);
  } catch (error) {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const prefix = `${OUTPUT_DIR}${safeName(name)}`;
    await page.screenshot({ path: `${prefix}.png`, fullPage: true }).catch(() => {});
    await context.tracing.stop({ path: `${prefix}.zip` }).catch(() => {});
    traceSaved = true;
    error.message += `\nEvidence: ${prefix}.png and ${prefix}.zip`;
    throw error;
  } finally {
    if (!traceSaved) await context.tracing.stop().catch(() => {});
    await context.close();
  }
}

async function testPlainToDemo(page, baseUrl) {
  await page.goto(`${baseUrl}/?source=ui-regression`);
  await waitForApp(page);

  assert.equal(await page.locator("#env-banner").getAttribute("data-mode"), "unavailable");
  assert.equal(await page.locator(".env-banner__title").textContent(), "WEBMCP UNAVAILABLE");
  assert.equal(
    await page.locator(".env-banner__message").textContent(),
    "No in-page agent is active on this URL. Enable WebMCP or open the deterministic demo.",
  );
  assert.equal(await page.locator(".simagent__start").count(), 0);

  const link = page.locator(".env-banner__demo-link");
  const href = new URL(await link.getAttribute("href"));
  assert.equal(href.pathname, "/");
  assert.equal(href.searchParams.get("source"), "ui-regression");
  assert.equal(href.searchParams.get("demo"), "1");
  await link.click();
  await page.waitForURL(url => url.searchParams.get("demo") === "1");
  await waitForApp(page);

  assert.equal(await page.locator("#env-banner").getAttribute("data-mode"), "simulation");
  assert.equal(await page.locator(".simagent__start").textContent(), "Run three-round agent demo");
  await assertEnglishPage(page, "deterministic demo should be English-only");
}

async function testCompleteDemoWorkflow(page, baseUrl) {
  await page.goto(`${baseUrl}/?demo=1`);
  await waitForApp(page);
  await page.getByRole("button", { name: "Run three-round agent demo" }).click();
  await page.locator('body[data-e2e="pass"]').waitFor({ timeout: 20_000 });

  assert.equal(await page.locator(".simagent__status").textContent(), "Complete via in-page tools");
  const review = page.locator(".sign-panel__review");
  await review.waitFor({ state: "visible" });
  const reviewText = await review.innerText();
  assert.match(reviewText, /Exact staged report/);
  assert.match(reviewText, new RegExp(manifest.badSha256));
  assert.match(reviewText, new RegExp(manifest.goodSha256));
  assert.match(reviewText, new RegExp(sha256(manifest.demoRepros.real)));
  assert.match(reviewText, /encoded dots must stay encoded by default/);
  await assertEnglishPage(page, "staged workflow should be English-only");

  const railLayout = await page.evaluate(() => {
    const approval = document.querySelector("#sign-panel").getBoundingClientRect();
    const timeline = document.querySelector("#timeline").getBoundingClientRect();
    return { approvalBottom: approval.bottom, approvalTop: approval.top, timelineTop: timeline.top };
  });
  assert.ok(railLayout.approvalTop < railLayout.timelineTop);
  assert.ok(railLayout.approvalBottom <= railLayout.timelineTop);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertNoDocumentOverflow(page, `Staged workflow at ${viewport.width}x${viewport.height}`);
    await assertNoElementOverflow(page, ".sign-panel__review", `Exact staged report at ${viewport.width}x${viewport.height}`);
  }

  await page.getByRole("button", { name: "Approve & save locally" }).click();
  await page.getByText("Locally approved", { exact: true }).waitFor();
  await page.locator("#inbox-root").waitFor({ state: "visible" });
  await page.locator(".inbox-replay button").click();
  await page.getByText("Replay matches recorded runs", { exact: true }).waitFor();

  const receipt = page.locator(".inbox-receipt a", { hasText: "Open receipt" });
  await receipt.waitFor({ state: "visible" });
  const receiptUrl = await receipt.getAttribute("href");
  await page.goto(receiptUrl);
  await page.getByText("repro hash verified ✓", { exact: true }).waitFor();
  await assertEnglishPage(page, "receipt should be English-only");
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertNoDocumentOverflow(page, `E2E receipt at ${viewport.width}x${viewport.height}`);
  }
}

async function testDarkModePrompt(page, baseUrl) {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto(`${baseUrl}/?demo=1`);
  await waitForApp(page);
  const colors = await page.evaluate(() => {
    const prompt = document.querySelector(".demo-prompt");
    const button = document.querySelector(".demo-prompt__copy");
    return {
      promptBackground: getComputedStyle(prompt).backgroundColor,
      promptText: getComputedStyle(prompt).color,
      buttonBackground: getComputedStyle(button).backgroundColor,
      buttonText: getComputedStyle(button).color,
    };
  });

  assert.deepEqual(colors, {
    promptBackground: "rgb(238, 245, 255)",
    promptText: "rgb(23, 32, 51)",
    buttonBackground: "rgb(255, 255, 255)",
    buttonText: "rgb(23, 32, 51)",
  });
}

async function stageVerifiedReport(page, baseUrl) {
  await page.goto(`${baseUrl}/?test=1`);
  await waitForApp(page);
  return page.evaluate(async () => {
    const target = await fetch("/targets/qs-500/manifest.json").then(response => response.json());
    const hook = window.__gatehouseTestHook;
    await hook.executeTool("write_repro", { code: target.demoRepros.real });
    const run = await hook.executeTool("run_repro", {});
    const staged = await hook.executeTool("submit_report", {});
    return { run, staged };
  });
}

async function testPersistenceFailure(page, baseUrl, errorName) {
  const result = await stageVerifiedReport(page, baseUrl);
  assert.equal(result.run.reason, "REGRESSION_DEMONSTRATED");
  assert.equal(result.staged.status, "staged_awaiting_local_approval");
  const approve = page.getByRole("button", { name: "Approve & save locally" });
  await assert.doesNotReject(() => approve.waitFor({ state: "visible" }));
  assert.equal(await approve.isEnabled(), true);

  await page.evaluate((name) => {
    window.__gatehouseOriginalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function blockedSetItem() {
      throw new DOMException("storage denied by UI regression", name);
    };
  }, errorName);
  await approve.click();
  await page.locator(".sign-panel__status").filter({ hasText: "Local save failed · try again" }).waitFor();

  assert.equal(await approve.isEnabled(), true);
  assert.equal(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), null);
  assert.equal(await page.locator("#inbox-root").isHidden(), true);
  assert.equal(await page.locator(".timeline__item--signed").count(), 0);

  await page.evaluate(() => {
    Storage.prototype.setItem = window.__gatehouseOriginalSetItem;
    delete window.__gatehouseOriginalSetItem;
  });
  await approve.click();
  await page.locator(".sign-panel__status").filter({ hasText: "Locally approved" }).waitFor();

  const persisted = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].timeline.filter(entry => entry.event === "signed").length, 1);
  assert.equal(await page.locator("#inbox-root").isVisible(), true);
  assert.equal(await page.locator(".timeline__item--signed").count(), 1);
}

async function encodeOnPage(page, artifact) {
  return page.evaluate(async value => {
    const { encodeReceipt } = await import("/src/inbox/receipt.js");
    return encodeReceipt(value);
  }, artifact);
}

async function replaceHashAndDispatch(page, hash) {
  return page.evaluate(nextHash => {
    const oldURL = location.href;
    history.replaceState(null, "", nextHash);
    dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: location.href }));
    return {
      text: document.querySelector("#receipt-root").textContent,
      status: document.querySelector('[role="status"]')?.textContent ?? null,
    };
  }, hash);
}

async function testReceiptHashChanges(page, baseUrl) {
  await page.goto(`${baseUrl}/receipt.html`);
  const valid = await encodeOnPage(page, fixture);
  const tamperedArtifact = structuredClone(fixture);
  tamperedArtifact.repro += "\n// tampered";
  const tampered = await encodeOnPage(page, tamperedArtifact);
  assert.ok(valid.url);
  assert.ok(tampered.url);
  const validHash = new URL(valid.url, baseUrl).hash;
  const tamperedHash = new URL(tampered.url, baseUrl).hash;

  await page.goto(`${baseUrl}/receipt.html${validHash}`);
  await page.getByText("repro hash verified ✓", { exact: true }).waitFor();

  let synchronous = await replaceHashAndDispatch(page, tamperedHash);
  assert.equal(synchronous.status, "Verifying receipt…");
  assert.doesNotMatch(synchronous.text, /repro hash verified ✓/);
  await page.getByText("repro hash verified ✗", { exact: true }).waitFor();

  synchronous = await replaceHashAndDispatch(page, validHash);
  assert.equal(synchronous.status, "Verifying receipt…");
  assert.doesNotMatch(synchronous.text, /repro hash verified ✗/);
  await page.getByText("repro hash verified ✓", { exact: true }).waitFor();

  await page.evaluate(({ validHash: latest, tamperedHash: stale }) => {
    const dispatch = (hash) => {
      const oldURL = location.href;
      history.replaceState(null, "", hash);
      dispatchEvent(new HashChangeEvent("hashchange", { oldURL, newURL: location.href }));
    };
    dispatch(stale);
    dispatch("#a=invalid");
    dispatch(latest);
  }, { validHash, tamperedHash });
  await page.getByText("repro hash verified ✓", { exact: true }).waitFor();
  assert.doesNotMatch(await page.locator("#receipt-root").textContent(), /Receipt could not be opened|repro hash verified ✗/);
}

async function seedInbox(page, baseUrl, artifacts) {
  await page.goto(`${baseUrl}/`);
  await waitForApp(page);
  await page.evaluate(({ key, values }) => localStorage.setItem(key, JSON.stringify(values)), {
    key: STORAGE_KEY,
    values: artifacts,
  });
  await page.reload();
  await waitForApp(page);
  await page.locator("#inbox-root").waitFor({ state: "visible" });
}

async function testInboxResponsiveAndSelection(page, baseUrl) {
  const ordinary = createArtifact({ signedAt: "2026-08-29T10:00:00.000Z" });
  const long = createArtifact({ signedAt: "2026-08-29T11:00:00.000Z", long: true });
  await seedInbox(page, baseUrl, [ordinary, long]);

  let buttons = page.locator(".inbox-list > li > button");
  assert.equal(await buttons.count(), 2);
  assert.equal(await buttons.nth(0).getAttribute("aria-current"), "true");
  assert.match(await buttons.nth(0).textContent(), /Selected/);
  assert.equal(await buttons.nth(1).getAttribute("aria-current"), null);
  assert.doesNotMatch(await buttons.nth(1).textContent(), /Selected/);

  await buttons.nth(1).click();
  buttons = page.locator(".inbox-list > li > button");
  assert.equal(await buttons.nth(0).getAttribute("aria-current"), null);
  assert.equal(await buttons.nth(1).getAttribute("aria-current"), "true");
  assert.match(await buttons.nth(1).textContent(), /Selected/);
  assert.equal(await buttons.nth(1).locator("time").getAttribute("datetime"), ordinary.signedAt);
  await buttons.nth(0).click();

  await page.locator(".inbox-replay button").click();
  await page.getByText("Replay matches recorded runs", { exact: true }).waitFor();

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertNoDocumentOverflow(page, `Inbox/Replay at ${viewport.width}x${viewport.height}`);
    if (viewport.width === 375 || viewport.width === 320) {
      await page.locator(".inbox-list > li > button").nth(1).click();
      await assertNoDocumentOverflow(page, `ordinary Inbox at ${viewport.width}x${viewport.height}`);
      if (viewport.width === 375) {
        await page.locator(".inbox-list > li > button").nth(0).click();
        await page.locator(".inbox-replay button").click();
        await page.getByText("Replay matches recorded runs", { exact: true }).waitFor();
      }
    }
  }

  const encoded = await encodeOnPage(page, long);
  assert.ok(encoded.url, "long legal artifact should remain shareable as a Receipt URL");
  await page.goto(new URL(encoded.url, `${baseUrl}/`).href);
  await page.getByText("repro hash verified ✓", { exact: true }).waitFor();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertNoDocumentOverflow(page, `Receipt at ${viewport.width}x${viewport.height}`);
  }
}

const { server, baseUrl } = await startServer();
let browser;
const failures = [];
try {
  browser = await chromium.launch({ headless: true });
  const cases = [
    ["plain URL opens deterministic demo", page => testPlainToDemo(page, baseUrl)],
    ["complete demo workflow", page => testCompleteDemoWorkflow(page, baseUrl)],
    ["dark-mode demo prompt contrast", page => testDarkModePrompt(page, baseUrl)],
    ["QuotaExceededError approval recovery", page => testPersistenceFailure(page, baseUrl, "QuotaExceededError")],
    ["SecurityError approval recovery", page => testPersistenceFailure(page, baseUrl, "SecurityError")],
    ["Receipt follows latest fragment", page => testReceiptHashChanges(page, baseUrl)],
    ["Inbox selection and responsive layouts", page => testInboxResponsiveAndSelection(page, baseUrl)],
  ];
  for (const [name, run] of cases) {
    try {
      await runCase(browser, baseUrl, name, run);
    } catch (error) {
      failures.push({ name, error });
      console.error(`FAIL ${name}\n${error.stack || error}`);
    }
  }
} finally {
  await browser?.close();
  await closeServer(server);
}

if (failures.length) {
  throw new AggregateError(failures.map(({ error }) => error), `${failures.length} UI regression case(s) failed`);
}

console.log(`PASS ${VIEWPORTS.length} viewport sizes · ${ROOT}`);
