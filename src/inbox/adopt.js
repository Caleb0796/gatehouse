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
  const qsTarget = artifact.targetId === "qs-500";
  const setup = qsTarget
    ? ['import qs from "qs";', "", "const Qs = qs;", ""]
    : [
        "// Template only: import the target package and bind the sandbox global used below.",
        "// Change test.skip to test after completing that integration.",
        "",
      ];
  const source = [
    "// WARNING: UNTRUSTED CODE — DO NOT RUN WITHOUT REVIEW.",
    "// This report-supplied JavaScript can use every permission granted to Node.js,",
    "// including filesystem, network, process, and environment access.",
    "// Review it in full, run it in an isolated environment, and manually remove",
    "// `.skip` only after you decide to enable a template.",
    "",
    `// Gatehouse target: ${commentValue(artifact.targetId)}`,
    `// Reported-bad: ${commentValue(artifact.library)} ${commentValue(artifact.badVersion)}`,
    `// Comparison build: ${commentValue(artifact.library)} ${commentValue(artifact.goodVersion)}`,
    `// Issue: ${commentValue(artifact.issueUrl)}`,
    "",
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    "",
    ...setup,
    `const repro = ${jsString(artifact.repro)};`,
    "",
    `${qsTarget ? "test" : "test.skip"}(${jsString(`regression: ${artifact.targetId}`)}, async () => {`,
    "  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;",
    '  const execute = new AsyncFunction("assert", "Qs", `"use strict";\\n${repro}`);',
    '  await execute(assert, typeof Qs === "undefined" ? undefined : Qs);',
    "});",
    "",
  ].join("\n");
  return {
    filename,
    source,
    enabled: qsTarget,
    ready: qsTarget,
    guidance: qsTarget
      ? "Ready to run with node --test in a project where qs is installed."
      : "Template only: add the target package import and sandbox-global binding before enabling this test.",
  };
}

export function initAdopt(rootEl, artifact, deps = {}) {
  const document = rootEl.ownerDocument;
  const clipboard = deps.clipboard ?? navigator.clipboard;
  const createObjectURL = deps.createObjectURL ?? URL.createObjectURL.bind(URL);
  const { filename, source, ready, guidance } = createRegressionTest(artifact);
  const heading = document.createElement("h4");
  const note = document.createElement("p");
  const preview = document.createElement("pre");
  const copy = document.createElement("button");
  const download = document.createElement("a");
  const status = document.createElement("span");
  const blobUrl = createObjectURL(new Blob([source], { type: "text/javascript" }));
  status.setAttribute("aria-live", "polite");

  heading.textContent = "Adopt as regression test";
  note.textContent = `Review before enabling — untrusted code. ${guidance}`;
  preview.textContent = source;
  copy.type = "button";
  copy.textContent = ready ? "Copy test" : "Copy test template";
  copy.addEventListener("click", async () => {
    try {
      await clipboard.writeText(source);
      status.textContent = ready ? "Copied" : "Template copied";
    } catch {
      status.textContent = "Copy failed";
    }
  });
  download.href = blobUrl;
  download.download = filename;
  download.textContent = ready ? "Download test" : "Download test template";
  rootEl.replaceChildren(heading, note, preview, copy, download, status);

  return () => (deps.revokeObjectURL ?? URL.revokeObjectURL.bind(URL))(blobUrl);
}
