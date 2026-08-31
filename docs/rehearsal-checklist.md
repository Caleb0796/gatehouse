# Gatehouse rehearsal checklist

Use this sheet for the ten unattended judge-path rehearsals and the two clean-profile runs on unfamiliar machines. A run passes only when the full path completes without coaching or a page reload.

## Pass criteria

- Open the live URL and confirm the environment banner is green.
- Copy the demo prompt and give it to the agent without adding instructions mid-run.
- Observe three `write_repro` / `run_repro` attempts and the tool lifecycle in the timeline.
- Confirm the final differential is reported-build fail 5/5 plus reference-build pass 5/5, then confirm `submit_report` appears.
- Select **Approve & save locally**, open the inbox, and replay the report to the same differential.
- Confirm the page says that local approval is unauthenticated, does not verify identity, is not cryptographic, and can be activated by automation.
- Open the receipt and confirm the reproduction hash check is shown.

Target: at least 9 of 10 unattended runs pass. Record every attempt, including aborted or fallback runs.

## Ten-run record

Prompt versions should be immutable labels such as `demo-prompt-v1`; record the exact text separately whenever the version changes. In **Failure point**, write the first step that failed and the visible symptom. Use `None` only for a complete pass.

| Run | Date/time | Machine and OS | Browser/profile environment | Agent/model | Prompt version | Result | Failure point | Fallback used | Notes |
| ---: | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 |  |  |  |  |  | Pass / Fail |  | None / New prompt / Simulated / Video |  |
| 2 |  |  |  |  |  | Pass / Fail |  | None / New prompt / Simulated / Video |  |
| 3 |  |  |  |  |  | Pass / Fail |  | None / New prompt / Simulated / Video |  |
| 4 |  |  |  |  |  | Pass / Fail |  | None / New prompt / Simulated / Video |  |
| 5 |  |  |  |  |  | Pass / Fail |  | None / New prompt / Simulated / Video |  |
| 6 |  |  |  |  |  | Pass / Fail |  | None / New prompt / Simulated / Video |  |
| 7 |  |  |  |  |  | Pass / Fail |  | None / New prompt / Simulated / Video |  |
| 8 |  |  |  |  |  | Pass / Fail |  | None / New prompt / Simulated / Video |  |
| 9 |  |  |  |  |  | Pass / Fail |  | None / New prompt / Simulated / Video |  |
| 10 |  |  |  |  |  | Pass / Fail |  | None / New prompt / Simulated / Video |  |

Summary: **____ / 10 passed**. Prompt version selected for the judge demo: **____________**.

## Two unfamiliar-machine clean-profile runs

Run this process once on each of two machines that were not used to build Gatehouse. Do not reuse a browser profile, cached site data, an open Gatehouse tab, or a signed-in session from an earlier rehearsal.

1. Record the machine, OS, browser version, agent/model, network, and test operator below.
2. Create a new temporary browser profile using the browser's profile picker. Do not sign in or enable synchronization.
3. Enable the required site-tool setting or launch the documented Chrome WebMCP flag path. Do not install project-specific extensions.
4. Open the live URL directly in the new profile. Do not visit it first in another tab to warm its cache.
5. Confirm the environment banner is green. If it is not, stop and enter the failure tree; do not silently change the environment.
6. Run the complete pass criteria above with the selected prompt and no coaching.
7. Close and reopen the receipt in the same clean profile, then confirm it remains readable and shows the reproduction hash check.
8. Record the result and first failure point. After recording, close all windows for the temporary profile and remove that profile through the browser UI.

| Machine | Date/time | Machine and OS | Browser/version | Agent/model | Network | Prompt version | Result | Failure point / notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Unfamiliar machine A |  |  |  |  |  |  | Pass / Fail |  |
| Unfamiliar machine B |  |  |  |  |  |  | Pass / Fail |  |

Both unfamiliar-machine runs must pass before the final demo is considered ready.

## Failure tree

Follow this order. Record the original failure and every fallback in the run table.

1. **Retry with a revised prompt.** Keep the environment and build fixed, change only the prompt, assign a new prompt-version label, and restart from a fresh page load. If the full path passes, use the revised prompt for later rehearsals.
2. **Switch to simulated mode.** If the revised prompt still fails, open the deterministic simulated-agent path. Confirm the page visibly labels it as simulated mode, then run the same three-attempt, gate, local approval, inbox, replay, and receipt sequence.
3. **Play the video.** If simulated mode cannot complete, play the public narrated demo video. Confirm it is under three minutes, audible, and viewable without signing in before relying on it.

Do not skip directly to a later fallback because it worked in a previous run. A fallback shows the product path but does not convert the original unattended run into a pass.

## Final readiness check

- [ ] At least 9 of 10 unattended runs passed.
- [ ] The exact selected prompt text and its version label are frozen.
- [ ] Unfamiliar machine A passed from a clean profile.
- [ ] Unfamiliar machine B passed from a clean profile.
- [ ] The simulated fallback completed with its label visible.
- [ ] The public narrated video played without sign-in and had audible sound.
- [ ] Every failed run names its first failure point and fallback outcome.
