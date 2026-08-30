function commentValue(value) {
  if (value === null) return "(none)";
  return String(value).replace(/[\r\n]+/g, " ");
}

function safeId(targetId) {
  const cleaned = String(targetId)
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return cleaned || "report";
}

function indent(source) {
  return source.split("\n").map(line => `  ${line}`).join("\n");
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
    `// Gatehouse target: ${commentValue(artifact.targetId)}`,
    `// Reported-bad: ${commentValue(artifact.library)} ${commentValue(artifact.badVersion)}`,
    `// Last-good: ${commentValue(artifact.library)} ${commentValue(artifact.goodVersion)}`,
    `// Issue: ${commentValue(artifact.issueUrl)}`,
    "",
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    "",
    ...setup,
    `${qsTarget ? "test" : "test.skip"}(${JSON.stringify(`regression: ${artifact.targetId}`)}, async () => {`,
    indent(artifact.repro),
    "});",
    "",
  ].join("\n");
  return {
    filename,
    source,
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

  heading.textContent = "Adopt as regression test";
  note.textContent = guidance;
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
