import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workflowUrl = new URL("../.github/workflows/ci.yml", import.meta.url);

test("CI runs logic evals against the production-CSP server before checking headers", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const server = workflow.indexOf("node scripts/dev-server.mjs");
  const logic = workflow.indexOf("node evals/run-evals.mjs --url http://127.0.0.1:8080/ --tier logic");
  const headers = workflow.indexOf("scripts/check-headers.sh http://127.0.0.1:8080/");

  assert.match(workflow, /^  eval:\n    runs-on: ubuntu-latest$/m);
  assert.ok(server >= 0, "production-CSP dev server is started");
  assert.ok(logic > server, "logic evals run after the server starts");
  assert.ok(headers > logic, "response headers are checked after evals");
  assert.match(workflow, /for attempt in \$\(seq 1 30\)/);
  assert.match(workflow, /if: always\(\)[\s\S]*kill "\$\(cat \/tmp\/gatehouse-dev-server\.pid\)"/);
});

test("CI runs WebMCP evals when Chrome exists and documents the skip otherwise", async () => {
  const workflow = await readFile(workflowUrl, "utf8");
  const detection = workflow.indexOf("command -v google-chrome");
  const skip = workflow.indexOf("WebMCP eval skipped::Google Chrome is unavailable on this runner");
  const required = workflow.indexOf("Google Chrome is required for the logic eval harness.");

  assert.ok(detection >= 0, "Chrome availability is detected");
  assert.ok(skip > detection, "the missing-Chrome skip is documented after detection");
  assert.ok(required > skip, "the skip notice is emitted before required logic evals fail");
  assert.match(workflow, /if: steps\.chrome\.outputs\.available == 'true'/);
  assert.match(workflow, /node evals\/run-evals\.mjs --url http:\/\/127\.0\.0\.1:8080\/ --tier webmcp/);
});
