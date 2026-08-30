import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("..", import.meta.url));
const port = 40_000 + process.pid % 10_000;
let browser;
let server;

const waitForServer = child => new Promise((resolve, reject) => {
  let output = "";
  const timer = setTimeout(() => reject(new Error(`Dev server did not start:\n${output}`)), 5_000);
  child.stdout.on("data", chunk => {
    output += chunk;
    if (!output.includes("gatehouse dev server:")) return;
    clearTimeout(timer);
    resolve();
  });
  child.stderr.on("data", chunk => {
    output += chunk;
  });
  child.once("exit", code => {
    clearTimeout(timer);
    reject(new Error(`Dev server exited with code ${code}:\n${output}`));
  });
});

const sourceFiles = async directory => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  return (await Promise.all(entries.map(entry => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : [path];
  }))).flat();
};

test.before(async () => {
  server = spawn(process.execPath, ["scripts/dev-server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForServer(server);
  browser = await chromium.launch({ headless: true });
});

test.after(async () => {
  await browser?.close();
  server?.kill();
});

test("runDifferential filters flaky scripts and keeps the pinned qs regression stable", { timeout: 120_000 }, async () => {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/index.html`);

  const result = await page.evaluate(async () => {
    const { loadTarget, runDifferential } = await import("/src/sandbox/runner.js");
    const countGreen = async code => {
      let green = 0;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const verdict = await runDifferential(code, { targetId: "qs-500" });
        if (verdict.green) green += 1;
      }
      return green;
    };

    const { manifest } = await loadTarget("qs-500");
    const randomGreen = await countGreen("assert(Math.random() < 0.5)");
    const clockGreen = await countGreen("assert(Date.now() % 2 === 0)");
    const real = await runDifferential(manifest.demoRepros.real, { targetId: "qs-500" });

    return { randomGreen, clockGreen, real };
  });

  await page.close();
  assert.equal(result.randomGreen, 0);
  assert.equal(result.clockGreen, 0);
  assert.equal(result.real.green, true);
  assert.equal(result.real.stable, true);
  assert.equal(result.real.reason, "STABLE_LOCAL_DIFFERENTIAL");
  assert.equal(result.real.repeats, 5);
  assert.equal(result.real.samples.bad.length, 5);
  assert.equal(result.real.samples.good.length, 5);
});

test("retired green reason is absent from executable sources and tests", async () => {
  const retiredReason = ["REGRESSION", "DEMONSTRATED"].join("_");
  const files = (
    await Promise.all(["src", "tests", "evals"].map(path => sourceFiles(`${root}/${path}`)))
  ).flat();
  const matches = [];

  for (const file of files) {
    const contents = await readFile(file, "utf8");
    if (contents.includes(retiredReason)) matches.push(file.slice(root.length + 1));
  }

  assert.deepEqual(matches, []);
});
