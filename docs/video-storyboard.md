# Gatehouse — 90-second video storyboard

Target runtime: 90 seconds. Record the narration as written, with a clear natural pace and a short pause between scenes.

| Time | Picture and edit | English voice-over |
| --- | --- | --- |
| 0–10s | Cold open. Tight crop on the tool timeline. The stable local differential lands and `submit_report` animates into view. Hold on the new tool name, then cut to the Gatehouse title. | “Watch the tool surface change. The reproduction failed five out of five times on the reported build and passed five out of five on the reference build in this browser, so `submit_report` appeared.” |
| 10–18s | Show the report page and its four initial tools. Briefly highlight that `submit_report` is absent. | “Gatehouse is an agent-native door and single-target prototype for pinned browser-JavaScript regressions. At the start, the agent can investigate and run code, but it cannot submit.” |
| 18–28s | Round one, fast cut: `write_repro`, `run_repro`, then two red results labeled `FAIL_BOTH`. | “First attempt: the test fails on both pinned builds in this browser. That is not a regression differential, so the door stays closed.” |
| 28–38s | Round two, fast cut: revised code, then two neutral results labeled `PASS_BOTH`. Keep the timeline moving. | “Second attempt: the test passes on both builds. The agent learned something, but the evidence still does not isolate the reported change.” |
| 38–50s | Round three, fast cut: final edit, reported build fails 5/5, reference build passes 5/5, stable local differential. Repeat the opening close-up as `submit_report` appears. | “Third attempt: reproduced five out of five in-browser, client-side, on both sides of the differential. Now the page registers `submit_report`, bound to the SHA-256 of this exact reproduction.” |
| 50–62s | Open the staged report. Move the pointer away, then show a real human clicking **Sign & submit**. | “The tool only stages the evidence. A person reviews the exact reproduction and differential, then signs before anything enters the inbox.” |
| 62–75s | Cut to the inbox. Open the signed item and click **Replay**. Show the same bad-fail, good-pass result returning. | “The signed artifact keeps the code, pinned versions, bundle hashes, results, logs, and time. Replay runs the same reproduction against the same manifest.” |
| 75–84s | Open the shareable receipt. Pan across its four separate status rows: source integrity, build provenance, runtime reproduction, and approver identity. Hold on `repro source hash is self-consistent`; the other claims show `not verified` where no independent check occurred. | “Reporters can manually share the receipt. Its source hash is self-consistent; build provenance, independent reproduction, and approver identity remain not verified.” |
| 84–90s | Pull back to the complete page and Gatehouse wordmark. End card: **Doors, not walls.** | “Less noise for maintainers, faster feedback for good-faith reporters. Build doors, not walls.” |

## Capture notes

- Use fast cuts only for the three attempts; keep the signature, replay result, and receipt badge readable.
- Record the page at a legible zoom with the environment banner green and the timeline visible.
- Keep the final export under three minutes, include the recorded narration, and confirm audio without signing in before publication.
- State the honest boundary in the final narration or on screen: the gate filters nondeterminism but does not prevent deterministic forgery.
