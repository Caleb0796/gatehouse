import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);

test("CI runs logic evals against the production-CSP server before checking headers", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const install = workflow.indexOf("npx playwright install --with-deps chromium");
  const server = workflow.indexOf("node scripts/dev-server.mjs");
  const logic = workflow.indexOf(
    "node evals/run-evals.mjs --url http://127.0.0.1:8080/ --tier logic --browser chromium",
  );
  const headers = workflow.indexOf("scripts/check-headers.sh http://127.0.0.1:8080/");

  assert.match(workflow, /^  eval:\n    runs-on: ubuntu-latest$/m);
  assert.match(workflow, /^  eval:\n    runs-on: ubuntu-latest\n    timeout-minutes: 10$/m);
  assert.equal(
    workflow.match(/if \[ -L node_modules \]; then unlink node_modules; fi/g)?.length,
    2,
    "both jobs remove the repository's local-only node_modules symlink before npm ci",
  );
  assert.ok(install >= 0 && install < server, "bundled Chromium is installed before the server starts");
  assert.ok(server >= 0, "production-CSP dev server is started");
  assert.ok(logic > server, "logic evals run after the server starts");
  assert.ok(headers > logic, "response headers are checked after evals");
  assert.match(workflow, /for attempt in \$\(seq 1 30\)/);
  assert.match(workflow, /if: always\(\)[\s\S]*kill "\$\(cat \/tmp\/gatehouse-dev-server\.pid\)"/);
});

test("CI always runs logic evals and only skips native WebMCP when Chrome is absent", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const logic = workflow.indexOf("--tier logic --browser chromium");
  const detection = workflow.indexOf("command -v google-chrome");
  const skip = workflow.indexOf("WebMCP eval skipped::Google Chrome is unavailable on this runner");
  const required = workflow.indexOf("Google Chrome is required for the logic eval harness.");

  assert.ok(logic >= 0 && logic < detection, "logic evals do not depend on Google Chrome detection");
  assert.ok(detection >= 0, "Chrome availability is detected");
  assert.ok(skip > detection, "the missing-Chrome skip is documented after detection");
  assert.equal(required, -1, "missing Google Chrome does not fail the logic tier");
  assert.match(workflow, /if: steps\.chrome\.outputs\.available == 'true'/);
  assert.match(workflow, /node evals\/run-evals\.mjs --url http:\/\/127\.0\.0\.1:8080\/ --tier webmcp/);
});
