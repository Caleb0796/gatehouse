# Gatehouse — 90-second video storyboard

Target runtime: 90 seconds. Record the narration as written, with a clear natural pace and a short pause between scenes.

| Time | Picture and edit | English voice-over |
| --- | --- | --- |
| 0–10s | Cold open. Tight crop on the tool timeline. The green differential lands and `submit_report` animates into view. Hold on the new tool name, then cut to the Gatehouse title. | “Watch the tool surface change. The reproduction just failed on the reported version, passed on the last good one, and `submit_report` appeared.” |
| 10–18s | Show the report page and its four initial tools. Briefly highlight that `submit_report` is absent. | “Gatehouse is an agent-native door for open-source bug reports. At the start, the agent can investigate and run code, but it cannot submit.” |
| 18–28s | Round one, fast cut: `write_repro`, `run_repro`, then two red results labeled `FAIL_BOTH`. | “First attempt: the test fails on both pinned builds. That proves a failure, not a regression, so the door stays closed.” |
| 28–38s | Round two, fast cut: revised code, then two neutral results labeled `PASS_BOTH`. Keep the timeline moving. | “Second attempt: the test passes on both builds. The agent learned something, but the evidence still does not isolate the reported change.” |
| 38–50s | Round three, fast cut: final edit, bad build fails, good build passes, green differential. Repeat the opening close-up as `submit_report` appears. | “Third attempt: the bad build fails and the good build passes. Now the page registers `submit_report`, bound to the SHA-256 of this exact reproduction.” |
| 50–62s | Open the staged report. Move the pointer away, then show a real human clicking **Sign & submit**. | “The tool only stages the evidence. A person reviews the exact reproduction and differential, then signs before anything enters the inbox.” |
| 62–75s | Cut to the inbox. Open the signed item and click **Replay**. Show the same bad-fail, good-pass result returning. | “The signed artifact keeps the code, pinned versions, bundle hashes, results, logs, and time. Replay runs the same reproduction against the same manifest.” |
| 75–84s | Open the shareable receipt. Pan across the compact evidence, then hold on the `repro hash verified ✓` badge. | “The receipt travels with the report. Its reproduction hash can be checked, while version and bundle claims remain visible for inspection.” |
| 84–90s | Pull back to the complete page and Gatehouse wordmark. End card: **Doors, not walls.** | “Less noise for maintainers, faster feedback for good-faith reporters. Build doors, not walls.” |

## Capture notes

- Use fast cuts only for the three attempts; keep the signature, replay result, and receipt badge readable.
- Record the page at a legible zoom with the environment banner green and the timeline visible.
- Keep the final export under three minutes, include the recorded narration, and confirm audio without signing in before publication.
