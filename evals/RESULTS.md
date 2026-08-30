# Evaluation results

> WebMCP cases use native `document.modelContext`; logic cases use the `?test=1` hook. Both tiers execute the real sandbox.

- URL: `http://127.0.0.1:8080/?test=1`
- Chrome: `Chrome/152.0.7977.64`
- Generated: `2026-08-30T02:37:50.602Z`

| Tier | Passed | Run | Pass rate |
| --- | ---: | ---: | ---: |
| webmcp | 4 | 4 | 100% |
| logic | 7 | 7 | 100% |
| overall | 11 | 11 | 100% |

| Case | Tier | Result | Detail |
| --- | --- | --- | --- |
| happy-3-round | webmcp | pass | expectations met |
| assert-false | logic | pass | expectations met |
| empty-repro | logic | pass | expectations met |
| edit-revokes-tool | webmcp | pass | expectations met |
| stale-submit | webmcp | pass | expectations met |
| timeout-recovers | logic | pass | expectations met; timeout action 2015ms; recovery action 17ms |
| good-error | logic | pass | expectations met |
| bundle-sha-tamper | logic | pass | expectations met |
| baseline-tools | webmcp | pass | expectations met |
| receipt-round-trip | logic | pass | expectations met |
| inverted | logic | pass | expectations met |
