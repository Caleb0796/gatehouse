import { bus } from "../shared/bus.js";
import { sha256Hex } from "../shared/hash.js";
import { storeArtifact } from "../inbox/inbox.js";
import { initSigning } from "./sign.js";
import { createSurface } from "./surface.js";

const allowedMocks = new Set(["green", "failboth", "inverted"]);
const requestedMock = new URLSearchParams(location.search).get("mock") || "green";
const mock = allowedMocks.has(requestedMock) ? requestedMock : "green";
const fixtureUrl = new URL(`../../contracts/fixtures/differential-${mock}.json`, import.meta.url);
const fixture = await fetch(fixtureUrl).then((response) => response.json());
const registrations = new Map();
const modelContext = document.modelContext || {
  registerTool(definition, options = {}) {
    registrations.set(definition.name, definition);
    options.signal?.addEventListener("abort", () => registrations.delete(definition.name), {
      once: true,
    });
  },
};
const target = {
  id: fixture.targetId,
  library: "gatehouse-demo-lib",
  badVersion: "1.1.0",
  goodVersion: "1.0.0",
  badSha256: fixture.samples.bad[0].bundleSha256,
  goodSha256: fixture.samples.good[0].bundleSha256,
  issueUrl: null,
  kind: "seed",
};
const output = document.querySelector("#events");
const log = (type, detail) => {
  output.textContent += `${type} ${JSON.stringify(detail)}\n`;
};
for (const type of ["draft", "run", "surface", "staged", "signed"]) {
  bus.on(type, (detail) => log(type, detail));
}
const surface = createSurface({
  modelContext,
  target,
  async runDifferential(code) {
    return { ...fixture, reproSha256: await sha256Hex(code) };
  },
  async requestHumanReview(note) {
    log("review", { note });
  },
  async stageReport() {},
});
await surface.ready;

initSigning({
  button: document.querySelector("#sign"),
  status: document.querySelector("#submission-status"),
  getGateState: surface.gate.getState,
  persistArtifact: artifact => storeArtifact(artifact),
});

document.querySelector("#environment").textContent =
  `mock=${mock}; WebMCP=${document.modelContext ? "available" : "fallback recorder"}`;
document.querySelector("#write").addEventListener("click", async () => {
  await surface.definitions.write_repro.execute({
    code: document.querySelector("#repro").value,
  });
});
document.querySelector("#run").addEventListener("click", async () => {
  await surface.definitions.run_repro.execute({});
});
