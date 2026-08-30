import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createGate } from "../../src/surface/gate.js";
import { createToolDefinitions } from "../../src/surface/surface.js";

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const workflow = await readFile(join(DIRECTORY, "verify.yml"), "utf8");

function embeddedFunction(name, dependencies) {
  const match = workflow.match(new RegExp(
    `          function ${name}\\([^\\n]+\\) \\{[\\s\\S]*?\\n          \\}`,
  ));
  assert(match, `embedded ${name} helper was not found`);
  const source = match[0].replace(/^          /gm, "");
  return Function(
    ...Object.keys(dependencies),
    `"use strict";\n${source}\nreturn ${name};`,
  )(...Object.values(dependencies));
}

function requireRecord(value, name) {
  assert(value && typeof value === "object" && !Array.isArray(value), `${name} must be an object`);
}

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
  assert.match(workflow, /args: \["--enable-features=WebMCPTesting"\]/);
  assert.match(workflow, /document\.modelContext\?\.getTools/);
  assert.match(workflow, /api\.executeTool\(tool, JSON\.stringify\(args\)\)/);
  assert.match(workflow, /typeof value !== "string"/);
  assert.match(workflow, /return JSON\.parse\(value\)/);
  assert.match(workflow, /execute\("write_repro", \{ code: repro \}\)/);
  assert.match(workflow, /execute\("run_repro", \{\}\)/);
  assert.doesNotMatch(workflow, /__gatehouseTestHook/);
  assert.doesNotMatch(workflow, /did not demonstrate/i);
});

test("workflow validates v2 repeated samples before replaying", () => {
  assert.match(workflow, /artifact\.v, 2/);
  assert.match(workflow, /artifact\.repeats, 5/);
  assert.match(workflow, /samples\.length, artifact\.repeats/);
  assert.match(workflow, /artifact\.stable, true/);
  assert.match(workflow, /artifact\.reason, "STABLE_LOCAL_DIFFERENTIAL"/);
  assert.match(workflow, /leaked logs into the public receipt/);
  assert.match(workflow, /artifact v2 must not use the v1 runs field/);
  assert.match(workflow, /receipt content hash does not match its public projection/);
  assert.match(workflow, /MAX_DECOMPRESSED_BYTES = 32 \* 1024/);
});

test("workflow expectations match the bounded production replay summary", async () => {
  const gate = createGate();
  const code = "assert(example.value === 4)";
  const draft = await gate.setDraft(code);
  const definitions = createToolDefinitions({
    target: {
      id: "demo",
      badSha256: "a".repeat(64),
      goodSha256: "b".repeat(64),
    },
    gate,
    runDifferential: async () => ({
      green: true,
      reason: "STABLE_LOCAL_DIFFERENTIAL",
      stable: true,
      repeats: 5,
      reproSha256: draft.draftSha,
      samples: {
        bad: Array.from({ length: 5 }, () => ({
          verdict: "fail",
          durationMs: 1,
          logs: [],
          bundleSha256: "a".repeat(64),
        })),
        good: Array.from({ length: 5 }, () => ({
          verdict: "pass",
          durationMs: 1,
          logs: [],
          bundleSha256: "b".repeat(64),
        })),
      },
    }),
    requestHumanReview: async () => {},
    stageReport: async () => {},
  });

  const replay = await definitions.run_repro.execute({});

  assert.deepEqual(replay.runs.map(({ version, verdict }) => ({ version, verdict })), [
    { version: "bad", verdict: "fail" },
    { version: "good", verdict: "pass" },
  ]);
  assert.equal(replay.runs.some(run => Object.hasOwn(run, "bundleSha256")), false);
  const runsByVersion = embeddedFunction("runsByVersion", { assert, requireRecord });
  const indexed = runsByVersion(replay.runs, "replay.runs");
  assert.equal(indexed.bad.verdict, "fail");
  assert.equal(indexed.good.verdict, "pass");
  assert.doesNotMatch(workflow, /replayRuns\[version\]\.bundleSha256/);
  assert.doesNotMatch(workflow, /requireSha\(run\.bundleSha256/);
  assert.match(workflow, /target\.badSha256, artifact\.badSha256/);
  assert.match(workflow, /target\.goodSha256, artifact\.goodSha256/);
});

test("workflow rejects receipt metadata that does not match the live target", () => {
  const assertTargetMatchesArtifact = embeddedFunction(
    "assertTargetMatchesArtifact",
    { assert, requireRecord },
  );
  const artifact = {
    targetId: "demo",
    library: "demo-lib",
    targetKind: "seed",
    badVersion: "2.0.0",
    goodVersion: "1.0.0",
    badSha256: "a".repeat(64),
    goodSha256: "b".repeat(64),
    issueUrl: null,
  };

  assert.doesNotThrow(() => assertTargetMatchesArtifact({ ...artifact }, artifact));
  for (const field of [
    "targetId",
    "library",
    "targetKind",
    "badVersion",
    "goodVersion",
    "badSha256",
    "goodSha256",
    "issueUrl",
  ]) {
    const target = { ...artifact, [field]: field === "issueUrl" ? "https://example.test" : "tampered" };
    assert.throws(() => assertTargetMatchesArtifact(target, artifact));
  }
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
