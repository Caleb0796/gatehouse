# Evaluation results

> Mock logic baseline only. These results do not claim real sandbox or WebMCP coverage.

- URL: `http://localhost:8080/dev/s2.html?mock=green&test=1`
- Chrome: `Chrome/152.0.7977.64`
- Generated: `2026-08-29T20:51:47.238Z`

| Case | Tier | Result | Detail |
| --- | --- | --- | --- |
| happy-3-round | webmcp | not run | tier deferred |
| assert-false | logic | pass | expectations met |
| empty-repro | logic | fail | gateOpen: expected false, got true; submit_report present: expected false, got true; reason: expected "PASS_BOTH", got "REGRESSION_DEMONSTRATED"; bad verdict: expected "pass", got "fail" |
| edit-revokes-tool | webmcp | not run | tier deferred |
| stale-submit | webmcp | not run | tier deferred |
| timeout-recovers | logic | fail | gateOpen: expected false, got true; reason: expected "BAD_TIMEOUT", got "REGRESSION_DEMONSTRATED"; bad verdict: expected "timeout", got "fail" |
| good-error | logic | fail | gateOpen: expected false, got true; submit_report present: expected false, got true; reason: expected "GOOD_ERROR", got "REGRESSION_DEMONSTRATED"; good verdict: expected "error", got "pass" |
| bundle-sha-tamper | logic | fail | gateOpen: expected false, got true; submit_report present: expected false, got true; run rejected: expected true, got false; error code: expected "BUNDLE_SHA_MISMATCH", got undefined |
| baseline-tools | webmcp | not run | tier deferred |
| receipt-round-trip | logic | pass | expectations met |
| inverted | logic | pass | expectations met |
