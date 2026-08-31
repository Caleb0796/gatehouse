# Gatehouse CONTRACTS v2

> Frozen interfaces between build lanes. Changes only via the coordinator (version bump + changelog).

## 3. CONTRACTS v2 (frozen; changes require a coordinator-managed version bump and broadcast)

### 3.1 TargetSpec — `targets/<id>/manifest.json` (A3/A6/D2 additions)
```json
{
  "id": "marked-1234", "library": "marked", "kind": "real",
  "badVersion": "4.2.0", "goodVersion": "4.1.1",
  "badSha256": "<hex64>", "goodSha256": "<hex64>",
  "globalName": "marked",
  "issueUrl": "https://github.com/markedjs/marked/issues/NNNN",
  "licenseFile": "LICENSE.marked.txt",
  "summary": "≤200 chars",
  "demoRepros": { "broken": "<js>", "weak": "<js>", "real": "<js>" }
}
```
`demoRepros` contains the simulated agent's three-round material (broken→FAIL_BOTH, weak→PASS_BOTH, real→green). S1 ships it with the target; S4 consumes it without inventing alternatives (A6). When `kind:"seed"`, the page and README must prominently label the target as a demo target.

### 3.2 Sandbox postMessage protocol (B3/B9 hardened)
```
parent→iframe  { t:"load", bundles:[{sha256, text}] }            // once per target; iframe caches by sha (B9)
parent→iframe  { t:"run",  runId, bundleSha, globalName, code, timeoutMs }
iframe→parent  { t:"ready" } / { t:"result", runId, verdict, logs, durationMs }
```
**Parent-side hardening (B3):** accept messages only when `e.source === iframe.contentWindow`; discard every message before `ready`; accept only the first result for each runId and discard later results; if the 30-second watchdog expires, tear down and rebuild the iframe and return timeout. **Runner side:** worker messages must match the internal envelope shape or settle as error; the preamble shadows `self.postMessage = undefined` and sends through a closure-held reference (raising the cost of forgery, **not claiming to prevent it completely**—record the residual risk in the §0.4 threat model). The parent fetches each bundle and verifies its SHA-256 against the manifest, rejecting execution on mismatch. Logs are limited to 100 entries × 500 characters.

### 3.3 Repro semantics
`assert(condition, message)` is injected; `pass` means execution completes without throwing, `fail` means ReproAssertionError is thrown, `error` means any other exception, and `timeout` means the worker was terminated after the time limit. **write_repro input is limited to 8 KB** (B5; the v1 50 KB limit is obsolete).

### 3.4 RunResult / DifferentialVerdict (A3/A4 revisions)
`runDifferential(code, {targetId, timeoutMs?}) → Promise<DifferentialVerdict>`—**targetId is required**, anchoring replay to the same manifest and bundle hashes (A3).
**judge is a total function covering all 16 combinations and evaluates them in this order** (A4):
1. `bad:"fail" && good:"pass"` → `green:true, reason:"REGRESSION_DEMONSTRATED"`
2. `bad:"timeout"` → `BAD_TIMEOUT`; 3. `bad:"error"` → `BAD_ERROR`; 4. `good:"timeout"` → `GOOD_TIMEOUT`; 5. `good:"error"` → `GOOD_ERROR`
6. `bad:"pass" && good:"fail"` → `INVERTED`; 7. both fail → `FAIL_BOTH`; 8. both pass → `PASS_BOTH`
`tests/s1-differential.test.mjs` must enumerate and assert the classification of all 16 combinations (16 cases, not 7).

### 3.5 SubmissionArtifact (A3 additions)
The v1 fields plus `"issueUrl": string|null` and `"targetKind": "real"|"seed"`. It still has no name field.

Compatibility semantics: retain the v1 wire name `signedAt`, timeline event `"signed"`, and related internal identifiers, but they mean only that the browser recorded local approval. That approval is unauthenticated, does not verify identity, is not a cryptographic signature, and can be activated by automation.

### 3.6 Surface events (`src/shared/bus.js`; S2 emits, S3/S4 listen)
```js
bus.emit("surface", { change:"registered"|"revoked", tool:"submit_report", reason:"differential green"|"repro edited"|"differential no longer green", at:Date.now() });
bus.emit("run",     { verdict: DifferentialVerdict });      // S4 timeline/scoreboard
bus.emit("draft",   { reproSha256, length, source: "tool" | "editor" }); // S4 draft status
bus.emit("staged",  { artifactDraft });                     // S2→local approval UI
bus.emit("signed",  { artifact: SubmissionArtifact });      // v1 compatibility event: S3 stores after local approval
```

`draft.source` identifies whether a draft came from the `write_repro` tool or visible editor input. UI consumers use it to synchronize tool writes while preventing an earlier asynchronous write from overwriting newer editor content.

### 3.7 Receipt URL (B5/B6 rewrite)
Encoding: `JSON.stringify(artifact)` → `CompressionStream("deflate-raw")` → base64url → `receipt.html#a=<...>`. **Budget: use a URL when the encoded result is ≤6 KB; over the limit, offer only a JSON download** (the 8 KB write_repro limit plus logs clipped to 10 entries per run makes the URL path typical).
Decode validation (B6): limit the compressed payload to 64 KB; after decompression, apply **strict validation of every schema field** (handwritten, without assertShape), and require the top-level bad/good bundle hashes to match their corresponding runs; recompute and compare `sha256(repro)`, using the label **"repro hash verified ✓"** (not a generic verified label); display version/hash fields unchanged and mark them as claimed. **Render only with `textContent`; a full-page grep must find no `innerHTML`**. Decode failure returns a friendly `{error}` page instead of throwing.

### 3.8 Frozen-layer code (landed by S0; read-only for everyone)

`src/shared/hash.js`
```js
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
```
`src/shared/bus.js`
```js
const target = new EventTarget();
export const bus = {
  emit: (type, detail) => target.dispatchEvent(new CustomEvent(type, { detail })),
  on:   (type, fn) => { const h = e => fn(e.detail); target.addEventListener(type, h); return () => target.removeEventListener(type, h); },
};
```
`src/shared/schema.js`: `assertShape(obj, spec)` performs minimal structural validation (key presence + typeof). **Use it only for postMessage envelope shape; tool input and receipt decoding require handwritten strict validation and must not depend on it** (A5). S0 lands it together with `tests/shared.test.mjs`.

### 3.9 Fixtures (landed by S0)
`contracts/fixtures/`: `differential-green.json`, `differential-failboth.json`, `differential-inverted.json`, and `artifact.sample.json`—complete-field instances of §3.4/§3.5 for S2/S3/S4/S5 mocks before integration.

### 3.10 Tool implementation table (new, A6)
`src/surface/surface.js` exports `getToolTable() → { [name]: { definition, execute } }`. modelContext registration, S4's direct calls when the simulated agent has no WebMCP, and the S5 `?test=1` hook all share this table. **Attach `window.__gatehouseTestHook = { getTools, executeTool }` only under `?test=1`**, and label every eval case run through the hook with `tier:"logic"` (see §5-S5).

### 3.11 index.html slot contract (new, A7)
```html
<header id="env-banner"></header>
<main>
  <section id="target-panel"></section>  <section id="editor-panel"></section>
  <section id="run-panel"></section>     <aside id="timeline"></aside>
  <section id="sign-panel"></section>    <section id="inbox-root" hidden></section>
</main>
<footer id="scoreboard"></footer>
```
Every module exports `init(rootEl, deps)`. S0 lands the skeleton, S2 owns assembly order and the style baseline, and other lanes recognize only their own slot id without changing the shell.

---


## Changelog
- v2 documentation translation (2026-08-31): converted explanatory text to English without changing any frozen interface.
- v2 clarification (2026-08-30): documented `signed` / `signedAt` as legacy names for unauthenticated browser-local approval, and added `draft.source` so UI consumers can distinguish tool writes from editor input.
- v2 (2026-08-29): initial frozen set, post adversarial review.
