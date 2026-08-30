# Gatehouse judge demo and D4 copy calibration

## Current Devpost description draft

Recheck every sentence against the final deployed commit before submission.

### Why is this use case a strong fit for WebMCP?

Open-source maintainers need useful bug reports, while agents can cheaply produce reports that have never been executed. Gatehouse puts the acceptance workflow where the reporter's agent already works: in the web page. The page initially exposes tools for inspecting the target, writing a reproduction, running it, and requesting a person's attention. Only after the current reproduction fails on the pinned reported-bad build and passes on the pinned last-good build does the page register `submit_report`. Editing the reproduction or producing a later non-green result revokes that tool. WebMCP is not a transport wrapper here; its live tool surface is the workflow state, and the reporter's browser performs the verification work.

### How does it create a better user experience?

Reporters get immediate, specific feedback instead of waiting for a maintainer to answer “cannot reproduce.” A failed attempt can distinguish a script that fails on both versions from one that passes on both, helping a good-faith reporter isolate the change. Maintainers receive a locally approved artifact with the exact reproduction, pinned versions and bundle hashes, both execution results, bounded logs, and a timeline. They can replay it against the same target, open a compact receipt, and export a regression-test starting point. Gatehouse does not replace the project's issue tracker; the receipt is designed to travel through the workflow maintainers already use.

### What can people and agents do together that was difficult before?

The agent iterates on executable evidence before the report enters a review queue: it reads the target, writes a minimal reproduction, executes it against both versions, interprets the differential, and revises the code. The page enforces the project's acceptance bar through tool availability. Once the evidence demonstrates the regression, `submit_report` can stage it but cannot itself record local approval. A separate visible page control records that browser-local approval. The control is unauthenticated, does not verify identity, is not a cryptographic signature, and can be activated by automation. Reporter, agent, and maintainer therefore meet around the same replayable evidence before triage begins.

### Briefly explain how you implemented WebMCP

The top-level document registers four tools with `document.modelContext.registerTool()`. `run_repro` loads locally vendored `qs` 6.12.0 and 6.12.1 bundles, verifies their SHA-256 hashes, and runs the same reproduction against both inside Workers nested in an opaque-origin sandboxed iframe. Worker termination enforces the timeout. A complete differential judge opens the gate only for bad-build `fail` plus good-build `pass`. That green result registers `submit_report` with an `AbortSignal` and binds it to the reproduction hash; editing or a later non-green result closes the registration. The tool stages an artifact, the page can record browser-local approval through a separate visible control, and the browser can replay or encode the result as a receipt. Native-Chrome and logic browser evals cover the tool lifecycle and failure cases.

## Two-minute judge path

Use the frozen prompt selected by the rehearsal sheet. Start from a clean profile on the live URL, keep the environment banner and timeline visible, and do not coach the agent after pasting the prompt.

### Before starting the timer

- Open the live URL and confirm that the environment banner is green. If it is not, follow the rehearsal failure tree instead of changing the environment during the demo.
- Confirm that the page begins with the four investigation tools and that `submit_report` is absent.
- Put the frozen demo prompt on the clipboard and reset the page to an empty inbox state prepared for the demo.

### 0:00–0:15 — Open the door

1. Start the timer with the complete page visible.
2. Point out the green environment banner and the four initial tools.
3. Click **Copy demo prompt**, paste it to the agent once, and let the agent proceed without additional instructions.

Expected view: the target, editor, run panel, and tool timeline are all visible; `submit_report` is not yet present.

### 0:15–0:55 — Let the agent iterate

1. Watch the agent call `get_target_info` to read the pinned target and execution model.
2. On round one, watch `write_repro` and `run_repro` produce `FAIL_BOTH`. Point to the result, then to the still-closed tool surface.
3. On round two, watch the revised repro produce `PASS_BOTH`. Point out that a passing script alone does not demonstrate the regression.
4. On round three, watch the final repro fail on the reported-bad build and pass on the last-good build.

Expected view: all three attempts appear in order on the timeline, and only the third result is a green differential.

### 0:55–1:15 — Show the tool surface change

1. Hold on the timeline as `submit_report` appears.
2. Let the agent call `submit_report`.
3. Show the staged status and move the pointer to the local approval area.

Expected view: `submit_report` appears only after the green differential and the tool stages evidence without recording local approval.

### 1:15–1:35 — Record local approval

1. Briefly scan the staged reproduction and its bad/good results.
2. Click **Approve & save locally**.
3. Point out the locally approved state, then open the inbox.

Expected view: the locally approved report is present in the inbox with its reproduction and differential evidence.

### 1:35–2:00 — Replay for the maintainer

1. Open the newest inbox item.
2. Click **Replay**.
3. Hold on the new bad-build failure and good-build pass beside the recorded result.
4. End with: “Gatehouse does not replace the issue tracker. It mints evidence that travels through it.”

Expected view: replay returns the same green differential. Stop here; asynchronous or optional work is outside the two-minute path.

## D4 Devpost four-answer snapshot calibration

Perform this check against the exact public commit and deployed build that will be submitted. Begin with the coordinator's current four Devpost draft answers. For every mismatch, delete the unsupported clause or make the smallest factual correction; do not add a new claim during calibration.

### Snapshot record

- [ ] Public app repository commit: `________________________`
- [ ] Public demo-target repository commit, if used: `________________________`
- [ ] Live URL and deployment identifier: `________________________`
- [ ] Browser and agent/model used for the final walk-through: `________________________`
- [ ] Evals result file and run timestamp: `________________________`

### Answer 1 — Why is this a strong fit for WebMCP?

- [ ] The deployed page visibly starts without `submit_report` and registers it only after a bad-fail/good-pass differential.
- [ ] The final copy describes a missing tool, not a disabled button or a rejected call.
- [ ] The sandbox execution observed in the submitted build is client-side; remove or narrow the cost claim if any submitted path depends on hosted execution.
- [ ] The prompt-injection sentence is limited to the registration-state mechanism and does not imply protection from a malicious client.

### Answer 2 — How does it create a better user experience?

- [ ] A locally approved item actually reaches the inbox with repro code, pinned bad/good evidence, and logs.
- [ ] **Replay** runs successfully from the inbox against the same target manifest.
- [ ] Adopt-as-test is visible and produces a usable test file; delete that sentence if the control or output is absent.
- [ ] The page shows distinct feedback for `PASS_BOTH` and `FAIL_BOTH`; make the quoted feedback match the final UI text exactly.
- [ ] The answer promises executed, replayable evidence but does not imply that browser-side evidence is trusted against a malicious reporter.

### Answer 3 — What can people and agents do together?

- [ ] The final deployed path shows the agent write, run, read the differential, and revise a repro before staging it.
- [ ] The visible **Approve & save locally** control remains separate from `submit_report`, and the copy states that it is unauthenticated and automatable.
- [ ] Editing after a green run closes the bound tool in the final build; narrow the SHA-binding claim if this test fails.
- [ ] Any statement about saving maintainer time is framed as the intended workflow benefit, not as a measured result unless final evidence supports it.
- [ ] The answer stays within the shipped reporter-agent, browser-sandbox, and browser-local approval workflow.

### Answer 4 — How was WebMCP implemented?

- [ ] The submitted source uses `document.modelContext.registerTool()` at the top level, and the stated browser/environment versions match the final README.
- [ ] The initial tool names, annotations, and count exactly match the tool table in the submitted commit.
- [ ] The production run uses an opaque-origin sandboxed iframe with a nested Worker, same-origin-only requests under the production CSP, and Worker termination for timeout.
- [ ] A green result means bad build `fail` plus good build `pass` in the shipped judge function.
- [ ] `submit_report` is bound to the exact repro SHA-256, and an edit revokes its registration through `AbortSignal` in the deployed build.
- [ ] The final tool descriptions keep workflow ordering out of their text.
- [ ] The local-approval sentence says that the control is unauthenticated, does not verify identity, is not cryptographic, and can be activated by automation.

### Final copy check

- [ ] Read all four answers sentence by sentence beside the deployed page and submitted source; every retained implementation claim has a visible result, source location, or final eval.
- [ ] Record each deletion or factual correction for the coordinator: `____________________________________________________________`.
- [ ] Confirm that optional asynchronous work is absent from the two-minute demo instructions.
- [ ] Run the required wording-discipline grep over this file and the final four answers; it returns zero matches.
