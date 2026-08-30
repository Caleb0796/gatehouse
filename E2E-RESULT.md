# Browser acceptance result

**PASS** — verified locally on 2026-08-29 PDT with Google Chrome 152.

- Code acceptance: `npm test` passed 156/156 tests with zero failures.
- Native browser evaluation: 11/11 cases passed (4 native WebMCP, 7 logic integration) under the production CSP.
- Timeout recovery: the 2-second timeout completed in 2015 ms and the immediately following normal run completed in 17 ms.
- Judge path: the visible simulation completed `FAIL_BOTH` → `PASS_BOTH` → `REGRESSION_DEMONSTRATED`, staged the report, activated the visible browser-local approval control through automation, and showed the locally approved inbox item. That approval is unauthenticated, does not verify identity, and is not a cryptographic signature.
- Maintainer path: Replay returned `Replay matches recorded runs`; the inbox's actual **Open receipt** link opened a separate receipt page showing `repro hash verified ✓`; the generated `qs` regression test was available to copy or download.
- Server boundary: success, forbidden, and missing responses carried the CSP, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`; hidden files and encoded sibling traversal returned 403.

The browser evaluation is deterministic implementation evidence. It does not measure probabilistic model tool-selection accuracy; the unattended-agent rehearsal sheet remains the separate model-level evaluation plan.
