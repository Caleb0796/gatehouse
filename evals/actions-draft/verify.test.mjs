import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const workflow = await readFile(join(DIRECTORY, "verify.yml"), "utf8");

test("workflow is restricted to receipt comments and least required permissions", () => {
  assert.match(workflow, /issue_comment:\n\s+types: \[created\]/);
  assert.match(workflow, /permissions:\n\s+contents: read\n\s+issues: write/);
  assert.match(workflow, /github\.event\.issue\.pull_request == null/);
  assert.match(workflow, /contains\(github\.event\.comment\.body, '\/receipt\.html#a='\)/);
  assert.match(workflow, /GATEHOUSE_ORIGIN: \$\{\{ vars\.GATEHOUSE_ORIGIN \}\}/);
});

test("workflow uses real Chrome with WebMCP for the replay", () => {
  assert.match(workflow, /playwright@1\.62\.1/);
  assert.match(workflow, /channel: "chrome"/);
  assert.match(workflow, /headless: true/);
  assert.match(workflow, /args: \["--enable-features=WebMCP"\]/);
  assert.match(workflow, /window\.__gatehouseTestHook\?\.executeTool/);
  assert.match(workflow, /hook\.executeTool\("write_repro"/);
  assert.match(workflow, /hook\.executeTool\("run_repro"/);
});

test("labeling happens only after all receipt and replay checks", () => {
  const receiptCheck = workflow.indexOf("receipt repro hash does not match its code");
  const targetCheck = workflow.indexOf("headless replay used a different target");
  const verdictCheck = workflow.indexOf("verdict changed");
  const labelStep = workflow.indexOf("- name: Add server-verified label");
  assert(receiptCheck >= 0 && receiptCheck < labelStep);
  assert(targetCheck >= 0 && targetCheck < labelStep);
  assert(verdictCheck >= 0 && verdictCheck < labelStep);
  assert.match(workflow.slice(labelStep), /github\.rest\.issues\.addLabels/);
});

test("embedded verification module has valid JavaScript syntax", () => {
  const match = workflow.match(
    /node --input-type=module <<'VERIFY_SCRIPT'\n([\s\S]*?)\n\s+VERIFY_SCRIPT/,
  );
  assert(match, "embedded verification module was not found");
  const source = match[1].replace(/^          /gm, "");
  const checked = spawnSync(
    process.execPath,
    ["--input-type=module", "--check"],
    { encoding: "utf8", input: source },
  );
  assert.equal(checked.status, 0, checked.stderr);
});
