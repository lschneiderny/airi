# Character mind travel gaze: walking as an input of the gaze arbiter

Date: 2026-11-22
Status: accepted. Slice CM9f of the [character mind roadmap](../context/character-mind-roadmap.md) implements it on the branch `luke/feat/character-mind-travel-gaze`. It builds on the [character mind ADR](2026-11-17-character-mind-direction.md) and the [glances ADR](2026-11-21-character-mind-glances.md). D16 and D17 name the forks in the plan, `.omo/plans/character-mind-cm9.md`; D16 was applied as recommended without an explicit owner answer, under the owner's standing instruction to use the recommendations. Current rules: [Autonomous behavior](../context/autonomous-behavior.md), [Body ownership](../context/body-ownership.md), and the [Glossary](../context/glossary.md).

## Context

On MMD, `MMDBody` `resolveGaze` aimed the head and eyes along the travel direction whenever the gait moved, whatever Natural chose. A held glance shows on MMD only through Natural's free fixation, so a poke, a wake, or a chat read that the gaze arbiter granted during a walk did not show, while the arbiter kept starting idle-act and cue glances nobody saw. Body ownership Target rule 3 kept this open as the one MMD channel with a second writer.

## Decision

1. **Travel is an input of the arbiter (D16).** `NaturalGazeLayer` `setTravel` takes whether she walks. `MMDNaturalAdapter` hands `MMDBody` `traveling` (the gait turns, starts, walks, or sidesteps, and is neither idle nor stopping) to `NaturalMotion` `setTravel` every frame, which applies it at the next grid step. Live2D never sets it.
2. **Travel ranks between the chat class and the model's cues.** `TRAVEL_PRIORITY` is 4.5. While she walks, a request below it (look tools, cue gestures, emotions, the screen change, a noticed cursor, idle acts) is refused and reported, and a walk that starts under such a claim ends it. The pet end, a poke, both wakes, chat reads, and the idle voice cues start as before.
3. **A glance holds over the walk for at most 1.5 s (D17).** `TRAVEL_GLANCE_MAX_SECONDS` caps the hold of a glance granted while she walks, and the `glance` report carries the capped hold. A higher claim that is running when a walk starts holds at most 1.5 s from the walk's start. Ending the walk does not lengthen a capped hold.
4. **The body shows the arbiter's choice.** `NaturalBodyIntent` `gaze.held` is true while a claim at or above travel holds. `resolveGaze` aims along the walk only while the gait moves and `held` is false; otherwise its standing order applies, and a held glance shows through the free fixation.

### What this settles

Body ownership Target rule 3 loses its MMD clause, and the MMD rule "One final owner per MMD channel under Natural" loses its gaze exception. Precedence rule 9 is rewritten, and rule 21 gains the travel rank. Existing ADR bodies are not edited.

## Deviations

- **Two more files carry the travel input.** Plan section 4 lists only `adapter.ts` and `body/index.ts` for `stage-ui-mmd`, and no `qa-tools` file. The adapter has no reference to the body, so the travel state reaches it as a new `MMDNaturalInput` field, `traveling`, which both callers fill from `MMDBody` `traveling`: `MMD.vue` (an upstream file, ADR decision 14: one input line, because the scene owns both the body and the adapter) and the headless runner `packages/qa-tools/src/t2-3d/runner/run.ts`, so that `qa:motion3d` runs perform the same arbiter as the app.
- **Travel lags the gait by one display frame.** The Natural stage runs before the body's in `MMDFramePipeline`, so the arbiter reads the gait state the previous body frame left. `resolveGaze` reads that same state in the same frame, so the two agree.
- **A running higher claim is capped at a walk's start.** The plan says a walk start "keeps a higher one". It keeps it, and applies the same 1.5 s cap from the walk's start, so a 3 s chat read granted just before the walk does not hold the eyes off the walk longer than one granted during it.

## Consequences

- Only runs in which she walks change. In the headless `walk` scenario the gaze stream skips the saccade draws of refused below-travel glances, and the eyes follow travel where a granted high glance used to be hidden. `touch` changes only if a poke lands during a walk.
- Node tests in `gaze.test.ts`, `look.test.ts`, `body/body.test.ts`, and `natural/adapter.test.ts` cover the rank, the cap, a walk start under a lower and a higher claim, `held`, and the body's aim.

## Acceptance

<!-- The orchestrator records these results. -->

- **Headless:** pending. To record: the eleven `qa:motion3d` scenarios at seed 1 at the slice's base and tip with `pnpm qa:motion3d diff`, the first differing event of `walk` (and of `touch` if it differs), the `pnpm lab:motion3d report gaze-order` and `pnpm lab:motion3d gate` statuses at both ends, the refusal events by source, and the `qa:live2d-rig` hashes for `angry` and `happy`.
- **Rendered:** pending. To record: plan section 8 check 7 on macOS, MMD on the desktop stage: a poke during a debug walk gives a `glance` `started` for `poke`, the eyes leave the walk line for at most 1.5 s, and an idle act's glance during a walk is `refused`; with event kinds and counts, 0 renderer and 0 main-process errors, and a `pnpm qa:stage capture --scenario walk` contact sheet.

Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review.

## Alternatives considered

- **Record "travel wins while she walks" as a rule and change no code (D16 b).** It keeps today's motion, but a granted poke glance stays invisible during a walk. Rejected.
- **Let a glance keep its own hold over the walk (D17 b).** A chat read can hold 3 s, long for a walk. Rejected.
