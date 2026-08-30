# Gatehouse

Gatehouse is an agent-native door and single-target prototype for pinned browser-JS regressions. A reporter's agent must produce a reproduction that fails on every run against the reported build and passes on every run against the reference build before the page exposes `submit_report`.

In January 2026, curl closed its six-year bug bounty after a flood of AI-generated reports, while other projects published policies against the same problem. curl is evidence of the pain—not Gatehouse's target user; this v1 prototype pins one browser-runnable npm target and turns a good-faith agent's effort into executed, replayable regression evidence.

## Live URL

> Deployment pending: the public Vercel URL will be added here.

## 评委两分钟动线（demo 脚本）

1. 打开 live URL → 环境横幅确认绿色。
2. 点「Copy demo prompt」→ 粘给 agent。
3. 看 agent：get_target_info → 三轮 write_repro/run_repro（时间线上工具面变化可见）→ 绿灯 → submit_report 浮现。
4. 人点 Sign & submit → 切收件箱 → Replay 同差分 → 审阅公开回执内容后手动分享。

## Run it

Install and serve the static app with its production Content Security Policy headers:

```sh
npm ci
npm run dev
```

Then use one of three environment paths:

1. **ChatGPT desktop browser:** open Settings → Browser → Permissions, enable site tools, use GPT-5.6 Sol or Terra (Luna does not expose WebMCP), press Cmd+Shift+B, and enter the full `http://localhost:8080` URL.
2. **Local Google Chrome:** start a separate test profile with `open -na "Google Chrome" --args --enable-features=WebMCPTesting --user-data-dir="$HOME/.webmcp-profile" http://localhost:8080`.
3. **Simulated demo:** open `http://localhost:8080/?demo=1` and use the visibly labeled simulated mode when WebMCP is unavailable. It follows the same tool table and fixed three-round demo path.

`localhost` and `127.0.0.1` are secure contexts for this workflow; LAN and `.local` addresses do not expose WebMCP. Keep the development server running so local testing uses the same CSP as deployment.

## Evals

The 13-case harness passed in the environment below. Logic-tier cases use the page's explicit `?test=1` hook; WebMCP-tier cases exercise native tool discovery and JSON-string tool execution, so the two rates remain separate. The stochastic case records the observed result rather than claiming a probability filter is an absolute guarantee; the retry case injects a deterministic non-green→green sequence and confirms that the tainted draft stays closed through the native tool surface. A separate CI-equivalent logic run also passed 7/7 in Playwright `HeadlessChrome/151.0.7922.34`.

| Tier | Cases | Passed | Pass rate | Environment |
| --- | ---: | ---: | ---: | --- |
| WebMCP | 6 | 6 | 100% | Chrome 152.0.7977.64, `--enable-features=WebMCPTesting` |
| Logic | 7 | 7 | 100% | Chrome 152.0.7977.64, `?test=1` hook |

## How it works

The top-level page initially registers four tools with `document.modelContext.registerTool()`: `get_target_info`, `write_repro`, `run_repro`, and `request_human_review`. Reproduction code runs without network access against pinned reported and reference library bundles inside a Worker nested in an opaque-origin sandboxed iframe. The page terminates each fresh Worker on timeout and accepts a stable local differential only when the reported build fails 5/5 and the reference build passes 5/5 in-browser (client-side).

A stable local differential registers `submit_report` and binds it to the SHA-256 of the exact reproduction. Editing the reproduction aborts that tool registration. Submission still requires a visible human signature; the resulting artifact carries the reproduction, pinned versions and bundle hashes, all run results, logs, and a timestamp. A signed report can be replayed against the same manifest and shared as a self-contained receipt.

## Threat model

Gatehouse is designed for honest-but-lazy agents: it raises the cost of low-effort, non-reproducing reports and gives good-faith reporters fast feedback. It does not defend against a malicious client, and it does not claim that browser-side evidence establishes trust on its own. Server-side re-execution is an upgrade path.

The gate is a nondeterminism filter, not an anti-forgery mechanism. Repeated runs can reject flaky evidence; they cannot stop a deterministic script from fabricating a verdict. Results are local self-attestation by the reporter until an independent service re-runs them.

Reproduction code and the harness execute with equal authority inside the same Worker. A malicious reproduction could theoretically forge its own verdict; hiding the Worker's reply channel and validating message envelopes only raises the cost of that forgery. The iframe-to-parent channel separately checks the source window, readiness, envelope shape, and first result for each run to reduce interference from unrelated page content, not to make malicious reproduction code trustworthy.

## NOTICE

Gatehouse is licensed under the MIT License; see [LICENSE](LICENSE).

Gatehouse bundles qs 6.12.0 as the reported build and qs 6.12.1 as the comparison build. qs is distributed under the BSD 3-Clause License; the bundled license text is at [`targets/qs-500/LICENSE.qs.txt`](targets/qs-500/LICENSE.qs.txt).

Third-party target bundles retain their upstream copyrights and licenses. Their inclusion is for deterministic regression reproduction and does not change Gatehouse's license.

## Exact environment

The README v1 was checked with:

- Node.js 22.23.1 on macOS; the package declares `engines.node` as `>=20`.
- Google Chrome 152.0.7977.64. Automated WebMCP evals require Chrome 151 or newer with `--enable-features=WebMCPTesting`.
- Vanilla ES2022 modules, `node:test`, and the repository's lockfile; no framework or build step is required.

Run the repository acceptance suite with:

```sh
npm test
```

## For maintainers

Gatehouse doesn't replace your issue tracker — it mints evidence that travels through it.

Reporters can manually share a Gatehouse receipt through the project's ordinary GitHub issue form. The shared receipt displays the exact reproduction, claimed pinned results, and explicit verification limits; it does not execute code. In the reporter-side signed inbox, the same artifact can be replayed against the local manifest or exported as a disabled, untrusted regression-test starting point.

A receipt keeps four claims separate:

| Claim | Receipt status without independent re-execution |
| --- | --- |
| Repro source integrity | Repro source hash is self-consistent |
| Build provenance | `not verified` |
| Runtime reproduction | Reproduced 5/5 in-browser (client-side); independent reproduction `not verified` |
| Approver identity | Local approval recorded; identity `not verified` |

> A draft GitHub issue-form field and no-receipt reply are included in [`src/inbox/for-maintainers.draft.md`](src/inbox/for-maintainers.draft.md); projects must review and install them manually.
