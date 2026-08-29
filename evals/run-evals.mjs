import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromeHarness } from "../scripts/cdp-harness.mjs";

const EVALS_DIR = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(EVALS_DIR, "cases");
const TIERS = new Set(["logic", "webmcp"]);

export function validateCaseDefinition(value, filename = "case") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filename}: case must be an object`);
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new Error(`${filename}: id must be a non-empty string`);
  }
  if (!TIERS.has(value.tier)) {
    throw new Error(`${filename}: tier must be logic or webmcp`);
  }
  if (!value.setup || typeof value.setup !== "object" || Array.isArray(value.setup)) {
    throw new Error(`${filename}: setup must be an object`);
  }
  if (!Array.isArray(value.actions) || value.actions.length === 0) {
    throw new Error(`${filename}: actions must be a non-empty array`);
  }
  if (!value.expect || typeof value.expect !== "object" || Array.isArray(value.expect)) {
    throw new Error(`${filename}: expect must be an object`);
  }
  if ("mustFail" in value && typeof value.mustFail !== "boolean") {
    throw new Error(`${filename}: mustFail must be a boolean`);
  }
  return value;
}

export async function loadCases(casesDir = CASES_DIR) {
  const filenames = (await readdir(casesDir))
    .filter((filename) => filename.endsWith(".json"))
    .sort();
  const cases = [];
  const ids = new Set();

  for (const filename of filenames) {
    const source = await readFile(join(casesDir, filename), "utf8");
    const definition = validateCaseDefinition(JSON.parse(source), filename);
    if (ids.has(definition.id)) throw new Error(`${filename}: duplicate id ${definition.id}`);
    ids.add(definition.id);
    cases.push(definition);
  }
  return cases;
}

export function parseArgs(argv) {
  const options = { headless: true, validate: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--url") {
      options.url = argv[index += 1];
      if (!options.url) throw new Error("--url requires a value");
    } else if (argument === "--headed") {
      options.headless = false;
    } else if (argument === "--validate") {
      options.validate = true;
    } else if (argument === "--help") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function printHelp() {
  console.log("Usage: node evals/run-evals.mjs --url <http(s) URL> [--headed]");
  console.log("       node evals/run-evals.mjs --validate");
}

export async function prepareEvalRun({ url, headless = true, playwright } = {}) {
  const cases = await loadCases();
  const harness = await launchChromeHarness({ url, headless, playwright });
  return {
    cases,
    chromeVersion: harness.chromeVersion,
    drivers: {
      logic: harness.logic,
      webmcp: harness.webmcp,
    },
    harness,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const cases = await loadCases();
  if (options.validate) {
    const logicCount = cases.filter(({ tier }) => tier === "logic").length;
    const webmcpCount = cases.length - logicCount;
    console.log(`Validated ${cases.length} cases (${logicCount} logic, ${webmcpCount} webmcp)`);
    return;
  }
  if (!options.url) throw new Error("--url is required unless --validate is used");

  const { chromeVersion, harness } = await prepareEvalRun(options);
  try {
    console.log(`Chrome harness ready: ${chromeVersion}; ${cases.length} cases loaded`);
    console.log("Case action execution will be added by the next S5 task.");
  } finally {
    await harness.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
