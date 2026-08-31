# Evaluation results

> WebMCP cases use native `document.modelContext`; logic cases use the `?test=1` hook. Sandbox cases execute the real runner; `retry-until-lucky` injects a deterministic non-green→green runner sequence to verify taint behavior through the native tool surface.

- URL: `https://gatehouse-app.vercel.app/?test=1`
- Chrome: `Chrome/152.0.7977.64`
- Generated: `2026-08-31T19:16:25.565Z`

| Tier | Passed | Run | Pass rate |
| --- | ---: | ---: | ---: |
| webmcp | 6 | 6 | 100% |
| logic | 7 | 7 | 100% |
| overall | 13 | 13 | 100% |

| Case | Tier | Result | Detail |
| --- | --- | --- | --- |
| happy-3-round | webmcp | pass | expectations met |
| assert-false | logic | pass | expectations met |
| empty-repro | logic | pass | expectations met |
| edit-revokes-tool | webmcp | pass | expectations met |
| stale-submit | webmcp | pass | expectations met |
| timeout-recovers | logic | pass | expectations met; timeout action 20050ms; recovery action 71ms |
| good-error | logic | pass | expectations met |
| bundle-sha-tamper | logic | pass | expectations met |
| baseline-tools | webmcp | pass | expectations met |
| receipt-round-trip | logic | pass | expectations met |
| inverted | logic | pass | expectations met |
| flaky-random | webmcp | pass | expectations met |
| retry-until-lucky | webmcp | pass | expectations met |
