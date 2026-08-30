function commentValue(value) {
  if (value === null) return "(none)";
  return String(value).replace(/[\r\n\u2028\u2029]+/g, " ");
}

function jsString(value) {
  return JSON.stringify(value)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function safeId(targetId) {
  const cleaned = String(targetId)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return cleaned || "report";
}

export function createRegressionTest(artifact) {
  const filename = `regression-${safeId(artifact.targetId)}.test.mjs`;
  const source = [
    "// WARNING: UNTRUSTED CODE — DO NOT RUN WITHOUT REVIEW.",
    "// This report-supplied JavaScript can use every permission granted to Node.js,",
    "// including filesystem, network, process, and environment access.",
    "// Review it in full, run it in an isolated environment, and manually remove",
    "// `.skip` only after you decide to enable it.",
    "",
    `// Gatehouse target: ${commentValue(artifact.targetId)}`,
    `// Reported-bad: ${commentValue(artifact.library)} ${commentValue(artifact.badVersion)}`,
    `// Comparison build: ${commentValue(artifact.library)} ${commentValue(artifact.goodVersion)}`,
    `// Issue: ${commentValue(artifact.issueUrl)}`,
    "",
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    "",
    `const repro = ${jsString(artifact.repro)};`,
    "",
    `test.skip(${jsString(`regression: ${artifact.targetId}`)}, async () => {`,
    "  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;",
    '  const execute = new AsyncFunction("assert", `"use strict";\\n${repro}`);',
    "  await execute(assert);",
    "});",
    "",
  ].join("\n");
  return { filename, source, enabled: false };
}

export function initAdopt(rootEl, artifact, deps = {}) {
  const document = rootEl.ownerDocument;
  const clipboard = deps.clipboard ?? navigator.clipboard;
  const createObjectURL = deps.createObjectURL ?? URL.createObjectURL.bind(URL);
  const { filename, source } = createRegressionTest(artifact);
  const heading = document.createElement("h4");
  const warning = document.createElement("p");
  const preview = document.createElement("pre");
  const copy = document.createElement("button");
  const download = document.createElement("a");
  const status = document.createElement("span");
  const blobUrl = createObjectURL(new Blob([source], { type: "text/javascript" }));

  heading.textContent = "Adopt as regression test";
  warning.textContent = "Review before enabling — untrusted code";
  preview.textContent = source;
  copy.type = "button";
  copy.textContent = "Copy test";
  copy.addEventListener("click", async () => {
    try {
      await clipboard.writeText(source);
      status.textContent = "Copied";
    } catch {
      status.textContent = "Copy failed";
    }
  });
  download.href = blobUrl;
  download.download = filename;
  download.textContent = "Download test";
  rootEl.replaceChildren(heading, warning, preview, copy, download, status);

  return () => (deps.revokeObjectURL ?? URL.revokeObjectURL.bind(URL))(blobUrl);
}
