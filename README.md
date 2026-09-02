# Gatehouse

Gatehouse is an agent-native front door and single-target prototype for open-source bug reports. A reporter's agent must produce a reproduction that fails 5/5 on a pinned reported build and passes 5/5 on a pinned reference build before the page registers `submit_report`.

The result is executed, replayable regression evidence: the exact reproduction, both bundle hashes, per-build results, bounded logs, and a browser-local approval record. Gatehouse does not replace an issue tracker; it mints evidence that can travel through one.

That approval is unauthenticated: it does not verify identity, is not a cryptographic signature, and can be activated by automation. The exported v1 wire names `signed`, `signedAt`, and related internal identifiers are retained for compatibility; they mean only that the visible local-approval control recorded the artifact in that browser.

## Why this uses WebMCP

Gatehouse uses the tool surface itself as workflow state:

- The page initially exposes four focused tools: `get_target_info`, `write_repro`, `run_repro`, and `request_human_review`.
- A fifth tool, `submit_report`, is dynamically registered only after the current reproduction produces five reported-build failures and five reference-build passes.
- The registration is bound to the SHA-256 of that exact reproduction. Editing it or producing a later non-green result revokes the tool through an `AbortSignal`.
- The tool stages evidence; a separate visible page control records browser-local approval.

This is more than a form exposed as a tool. WebMCP discovery communicates the page's live acceptance state to the agent, while the human interface shows the same reproduction, differential, and tool lifecycle.

## Live demo

The stable production deployment is [gatehouse-app.vercel.app](https://gatehouse-app.vercel.app/). Vercel's hash-specific deployment URLs are immutable snapshots, so use the stable domain for the current application. To run the same static application locally with the deployment Content Security Policy:

```sh
npm ci
npm run dev
```

Open `http://127.0.0.1:8080/?demo=1` for the deterministic fallback demo, or use one of the native WebMCP environments below.

## Two-minute judge path

1. Open the app and confirm the environment banner reports either live WebMCP or the clearly labeled simulation fallback.
2. Select **Copy demo prompt** and give that unchanged prompt to the browsing agent.
3. Watch three `write_repro` / `run_repro` rounds produce `FAIL_BOTH`, `PASS_BOTH`, then `STABLE_LOCAL_DIFFERENTIAL`.
4. Hold on the activity timeline as `submit_report` appears, then let the agent call it to stage the evidence.
5. Review the visible final reproduction and differential, select **Approve & save locally**, then use **Replay** from the locally approved report inbox.
6. Open the self-contained receipt and confirm the `Repro hash self-consistent ✓` label.

The scripted fallback uses the same tool table and sandbox but does not involve an LLM. It is labeled as simulation so it is never confused with the native WebMCP path.

## Native WebMCP environments

### ChatGPT in-app browser

1. Enable site tools in **Settings → Browser → Permissions**.
2. Open the full live URL, <https://gatehouse-app.vercel.app/>, in ChatGPT's built-in browser.
3. Follow the **Two-minute judge path** above. The page banner remains the source of truth for whether `document.modelContext` is available.

### Google Chrome

Gatehouse was verified with Google Chrome 152.0.7977.64. For local testing, enable `chrome://flags/#enable-webmcp-testing`, restart Chrome, and open `http://127.0.0.1:8080`.

The live URL works in Google Chrome too once the flag is enabled.

`localhost` and `127.0.0.1` are secure contexts for this workflow. The development server binds to loopback only and serves the production CSP headers.

## Evaluation evidence

The repository contains 13 browser-evaluation definitions. The latest recorded full-browser result covers all 13: six use native `document.modelContext.getTools()` / `executeTool()` in real Google Chrome, and seven use the explicit `?test=1` logic hook. The native tier includes random and retry-until-lucky repros that exercise the nondeterminism and taint behavior. Both tiers execute the real opaque-origin sandbox and pinned target bundles.

| Tier | Passed | Cases | Environment |
| --- | ---: | ---: | --- |
| Native WebMCP | 6 | 6 | Chrome 152.0.7977.64, `--enable-features=WebMCPTesting` |
| Logic integration | 7 | 7 | Chrome 152.0.7977.64, `?test=1` hook |
| Total | 13 | 13 | Production CSP, real `qs` bundles |

See [the generated results](evals/RESULTS.md). These are implementation evaluations, not a claim about probabilistic model tool-selection accuracy.

Run the code-level acceptance suite:

```sh
npm test
npm run eval:validate
```

With `npm run dev` running and Chrome 151 or newer installed, run the full browser evaluation:

```sh
npm run eval:chrome
```

## How it works

1. The top-level page registers the always-available tools with `document.modelContext.registerTool()`.
2. The parent fetches the selected target's local bad and good bundles and rejects a SHA-256 mismatch.
3. Reproduction code runs in a Worker nested inside an opaque-origin `<iframe sandbox="allow-scripts">`. The Worker is terminated on timeout; production CSP restricts requests to same-origin resources.
4. The differential runner samples each build five times. It returns `STABLE_LOCAL_DIFFERENTIAL` only for reported-build fail 5/5 plus reference-build pass 5/5; mixed samples return `UNSTABLE`, and execution failures return `EXECUTION_ERROR`.
5. A stable result registers the SHA-bound `submit_report`; any edit or later non-green result for that draft revokes that registration through its `AbortSignal`.
6. The agent stages the report, a separate visible control records local approval, and the browser stores the artifact locally.
7. Maintainers can replay the artifact against the same target manifest, export a regression-test starting point, and share a compressed receipt URL.

The main implementation is intentionally framework-free:

```text
src/sandbox/   bundle verification, Worker runner, differential judge
src/surface/   WebMCP tools, dynamic gate, local approval
src/inbox/     locally approved artifacts, replay, receipt, test export
src/simagent/  deterministic three-round fallback
evals/         native-WebMCP and logic browser evaluations
targets/       pinned real regression and upstream license
```

## Real regression target

The current target is [`qs` issue #500](https://github.com/ljharb/qs/issues/500): version 6.12.0 unintentionally changed the default handling of encoded dots in keys, and 6.12.1 restored the previous behavior. Gatehouse vendors both browser bundles, verifies their hashes before every run, and carries their version and hash provenance into the locally approved artifact.

The target bundle is distributed under BSD-3-Clause; its upstream notice is preserved in [`targets/qs-500/LICENSE.qs.txt`](targets/qs-500/LICENSE.qs.txt). Gatehouse itself is MIT licensed; see [LICENSE](LICENSE).

## Threat model

Gatehouse is designed for honest-but-lazy agents. It raises the cost of low-effort, non-reproducing reports and gives good-faith reporters immediate, structured feedback. The gate is a nondeterminism filter plus local self-attestation; it does not prevent forgery by a malicious client, and browser-side evidence is not an independent trust boundary. Server-side re-execution remains an upgrade path.

Reproduction code and the harness have equal authority inside the same Worker. A malicious reproduction could attempt to forge its Worker result; hiding the reply channel and validating envelopes raises the cost but does not make that channel trustworthy. The iframe-to-parent channel separately checks the source window, readiness, run identifier, envelope shape, and first result for each run.

Receipt verification is intentionally narrow: the receipt page recomputes and labels the reproduction hash. Build versions and bundle hashes are visibly marked as claims; recorded results and logs remain evidence pending an independent replay.

## For maintainers

The locally approved artifact can be replayed in one action, exported as a Node regression-test starting point, or encoded into a self-contained receipt URL for an ordinary GitHub issue. Reporters can manually share a link-sized receipt or its JSON fallback. A ready-to-copy issue-form field and no-receipt reply are included in [`docs/for-maintainers.md`](docs/for-maintainers.md).

The receipt keeps claim boundaries explicit: repro source integrity is checked for self-consistency; build provenance is `not verified`; runtime reproduction is labeled “Reproduced 5/5 in-browser (client-side)” while independent reproduction remains `not verified`; approver identity is `not verified`.

## Reproducibility

- Node.js: 22.23.1 used for the recorded results; `engines.node` requires Node 20 or newer.
- Browser: Google Chrome 152.0.7977.64; native automated WebMCP evals require Chrome 151 or newer.
- Dependencies: locked by `package-lock.json`; `npm ci` installs Playwright 1.62.1.
- Runtime: vanilla ES2022 modules with no build step.
- Deployment headers: `vercel.json` and `scripts/check-headers.sh` keep the hosted CSP, `no-store`, and `nosniff` policies aligned with local testing.

The commit history begins during the WebMCP Challenge submission period and preserves the implementation timeline. Release rehearsal, demo, and video materials are in [`docs/`](docs/).
