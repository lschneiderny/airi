# live2d-cursor-touch-integration - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** Luke, with the character sitting in a corner of his desktop. She stops staring at a fixed angle when his mouse is far away, and approaching her from any side or at any speed looks the same: she first notices the cursor, then gives it full attention. Sometimes she simply ignores a far cursor and goes on with her own thing. Petting stays smooth at any stroke speed and screen refresh rate, she melts into the hand instead of looking up and then ducking, and pokes make her flinch right away, in a direction that matches where she was poked.

**What you'll get:** A rewritten attention behavior for the cursor, smoother eye tracking with natural catch-up jumps, sturdier pet and poke detection, repeatable automated checks that replay strokes, approaches, and pokes, and one rendered check that moves the real mouse over her in the app.

**Why this approach:** Every odd moment traced back to on/off switches (cursor present or not, petting or not) that make her gaze snap. Replacing them with one gradually changing attention level, measured from her head instead of the middle of the canvas, removes the snaps at their source. Seeded randomness gives her independence without making tests flaky.

**What it will NOT do:** add any new settings; change the Universal or MAGIC drivers; change when the app decides she is talking, thinking, or watching; make the chat react to touch.

**Effort:** Large
**Risk:** Medium - the rendered check moves the real mouse and needs an undisturbed desktop; the feel constants (eye anchor height, attention probabilities, pet roll direction) still need your eyes on both rigs.
**Decisions to sanity-check:**
- How often she engages a far cursor (about 1 in 5) and a mid-distance cursor (about 1 in 2).
- Where her eye anchor sits on the head (just below the head box's center).
- The 90 ms poke delay that keeps drags from becoming pokes.

Your next move: start execution with `/ulw-execute live2d-cursor-touch-integration` (optionally `--worktree`) once the review below approves. Full execution detail follows below.

---

> TL;DR (machine): Large, Medium risk; 12 todos + F1-F4: continuous seeded cursor attention, head-anchored radial mapping, eye pursuit, rate-independent pet classifier, melt-into-hand handoff, prompt y-aware pokes, scenario pointer events, T1 suite, T3 real-OS-pointer run, ADRs.

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected user:** Luke at his Windows desktop. The AIRI Electron stage window (transparent, always on top, click-through over transparent pixels) sits in a screen corner with the Natural motion driver and the ForBOOTH / Bear Pajama rigs. His mouse roams the whole desktop for other work and sometimes comes over to pet her head (hover strokes) or poke her (click). Today eye, head, and body motion look different depending on approach side and speed, petting flickers on and off, and pet/poke snap the gaze. After: she feels like an independent VTuber stuck in the corner of the screen who notices the cursor and then gives it full attention, sometimes ignores it when it is far, melts into petting, and flinches promptly at pokes.
**Programs that consume the result:** the Natural controller's callers (`Model.vue` adapter, `packages/qa-tools/src/motion/scenario-sink.ts` T1 sink, `packages/stage-ui-live2d/scripts/bench-natural.ts`, `packages/qa-tools/spikes/t2/loop.ts`), the T3 gates (cursor attention off, cursor parked), the web host `apps/stage-web/src/pages/index.vue` (same `Live2DScene`), the Kirie CEF host (`apps/stage-tamagotchi-kirie/src-web/src/renderer/pages/index.vue:311-314,348` passes `cursor-position` to the same `WidgetStage`; no code change, typecheck only), the T3 QA bridge handler `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts`, and the Universal driver's eye tracking (`focusAt`, `settings/live2d/model-eye-offset`).

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | A far-away cursor never pins her gaze at a fixed angle; its direction is measured from her head, radially, and its pull falls off with distance | From a corner window most of the desktop saturates today |
| IS-2 | Approach from any side or at any speed reads the same: attention onset is always "notice, then full attention"; at medium/far distance she sometimes engages and sometimes not (Luke, D2); near cursor is always noticed | Approach-direction artifacts; Luke wants an independent character |
| IS-3 | Eyes follow a moving cursor at a bounded speed with catch-up saccades; the head trails the eyes, the body trails the head; head and eyes do not point at different targets for long | Eyes are zero-lag today; head bias stays on the cursor while 20% of fixations look elsewhere |
| IS-4 | A cursor that stops moving fades out of attention gradually, with no snap back to the camera | 1 s host timeout and 3 s resolver recency snap today |
| IS-5 | Petting at any natural stroke speed (0.25 to 6 head widths/s), width, direction, and pointer rate (30-240 Hz) starts and holds one continuous pet; a cursor merely passing over the head never pets | Rate-dependent flicker, slow-stroke rejection, and overshoot loss today |
| IS-6 | Approach, pet start, petting, and pet end are continuous: she melts into the hand (eyes drift down and soften, head leans in; Luke, D1) with no look-up-then-duck and no camera snap at start or end | Binary cursor gate today |
| IS-7 | Her pet response follows vertical as well as horizontal strokes | Roll follows hand x only today |
| IS-8 | A poke reacts promptly after the press, and its direction reflects where it landed (x and y). A pet never misfires as a poke. A press that travels more than 0.05 head widths from its press point before 90 ms (a drag) never pokes, even if it returns or is released early. A press held within that distance for 90 ms counts as one poke even if it drags afterwards, because the touch has already landed | Release-time trigger, x-only direction today |
| IS-9 | Nothing regresses: the T1 idle liveliness gate passes; the controller stays seeded-deterministic and exactly neutral without cursor or touch; cursor attention off removes all cursor influence; Universal eye tracking, the web host, and the T3 smoke run keep working | Existing contracts and gates |
| IS-10 | These behaviors are machine-checkable: deterministic T1 scenarios drive cursor paths and touch, and a rendered T3 run drives the real OS cursor | QA has no touch input today |
| GAP-1 | The cursor is normalized to the padded model-canvas center and clamped per axis to plus/minus 1, with no distance term (`Model.vue:603-612`, `natural-motion.ts:213-217`) | IS-1, IS-2 |
| GAP-2 | A gaze `'cursor'` fixation resolves the live cursor every step: no pursuit velocity limit and no catch-up saccades (`natural-motion/gaze.ts:148-161`) | IS-3 |
| GAP-3 | Cursor presence is binary everywhere: the `Live2D.vue:134-141` 1000 ms timeout, the pet/aside/screen null gate in `natural-motion.ts:318`, the `Model.vue:605` aside/screen gate, saccades on null transitions in `gaze.ts:88-96`, and the resolver turning watching attention to `screen` 3000 ms after the last cursor move (`packages/stage-shared/src/performance-state/index.ts:183,263-264`) | IS-4, IS-6 |
| GAP-4 | 20% of fixations leave the cursor while the head bias stays on it (`gaze.ts:181`, `natural-motion.ts:365-369`), and posture shifts keep full amplitude during tracking | IS-3 |
| GAP-5 | Pet movement is detected per sample, so it depends on the event rate (`touch-gestures.ts:105-108`, reversalStep/2 = 0.01 head widths). Any off-head sample clears the trail (`:96-101`). Simulated: at 144 Hz, 1.2 head/s strokes flicker every ~0.5 s; plus/minus 0.6 head-width strokes never pet | IS-5 |
| GAP-6 | Before a pet qualifies she tracks the hand upward, then drops into the bow. At pet end the cursor returns and she saccades to the hand, then to the camera 1 s later (`natural-motion.ts:318`, `Live2D.vue:134-141`) | IS-6 |
| GAP-7 | Pet roll follows hand x only and there is no vertical response (`natural-motion/touch.ts:78-100`, `Model.vue:1326`) | IS-7 |
| GAP-8 | A poke fires on release (up to 400 ms) and its nudge peaks 0.25-0.5 s later (`touch-gestures.ts:122-134`, `natural-motion/impulses.ts:44,244-247`); `pokeDirection` ignores y (`natural-motion/touch.ts:34-39`) | IS-8 |
| GAP-9 | The motion-scenario contract has cursor events but no touch events (`packages/stage-shared/src/motion-scenario/schema.ts:27-38`), `scenario-sink.ts:180` sets `pet: null`, and T3 refuses pointer input (`schema.ts:67-68`) | IS-10 |

### Must have
- One continuous, seeded cursor-attention model inside the Natural controller that replaces every binary cursor gate for the Natural driver. Onset is always staged as notice, then full attention. Engagement at medium/far distance is a seeded draw per cursor episode, and she drops interest on her own.
- Cursor input as an offset from an eye anchor on the measured head box, in head widths, with radial soft saturation (no per-axis clamp).
- Velocity-limited eye pursuit with catch-up saccades; the head follows more slowly and relaxes while gaze is elsewhere.
- A pet classifier whose movement detection does not depend on pointer rate, tolerates strokes that overshoot the head into a margin zone, and still rejects a passing cursor.
- A melt-into-hand pet handoff, a two-axis pet hand, prompt y-aware pokes, and a faster poke nudge.
- `pointer` events in the motion-scenario contract, a T1 sink that plays them through the real classifier, and a rendered T3 run that drives the real OS cursor.
- Observer events for attention phases and touch, so T1 and T3 traces can be asserted.
- ADRs updated in the same commits as the code they describe.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No new user settings, settings UI, or i18n strings (Luke, D4). Existing toggles keep their meaning: `natural-cursor-attention` off removes all cursor influence; `natural-touch`, `natural-touch-pet-requires-hold`, and `natural-touch-head-scale` behave as documented.
- No change to Universal/MAGIC behavior: their 1 s cursor expiry, `focusAt`, `model.focus`, and the `model-eye-offset` semantics stay as they are.
- No change to performance-state resolver constants, modes, or attention values (`packages/stage-shared/src/performance-state/index.ts`).
- No new random draws on any path where the cursor is null and no touch is active. New randomness uses an appended stream index, so existing seeded sequences are unchanged.
- No chat or LLM reaction to touch; the `touch` scene event keeps its shape.
- No changes to Kirie, Godot, VRM, or MMD scenes; no new dependencies; no edits to lockfiles or workspace config.
- No weakening, skipping, or deleting of existing tests. An existing test whose expectation encodes a removed snap (listed per todo) is updated to the new contract, and the update is named in the commit body.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after (Luke, D5), using Vitest. Each todo implements its change and updates or adds the tests in the same todo. Agent-executed QA is always included.
- Levels (from `.agents/skills/motion-qa/SKILL.md`):
  - T0: unit tests per module.
  - T1: deterministic controller and sink scenarios; `pnpm qa:motion gate liveliness --level t1 --fresh` must stay PASS.
  - T3: rendered Electron with the real OS cursor (`pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-touch`), on ForBOOTH only per Luke's one-rig acceptance rule.
  - T4: Luke's visual review judges naturalness. Scores never claim naturalness, and every QA report states the motion-qa limitations wording.
- Package checks:
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck`
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run`
  - `pnpm -F @proj-airi/stage-shared exec vitest run`
  - `pnpm -F @proj-airi/qa-tools typecheck`
  - `pnpm -F @proj-airi/qa-tools exec vitest run`
  - `pnpm verify` after each wave.
- Evidence: `<attemptDir>/task-<N>-live2d-cursor-touch-integration.<ext>`. attemptDir is `result.currentAttemptDir` from `await agentToolkit.status()` in a JS eval cell, after importing agentToolkit with ``await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`)``. Under ulw-loop that resolves to `.omo/evidence/ulw/<session>/<goalId>/a<attempt>`; outside ulw-loop use `.omo/evidence/live2d-cursor-touch-integration/`.
- Scratch probe scripts go under the run's temp directory, never into the repo. Evidence logs keep the command, exit code, and pass/fail lines.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.
- Wave 1 (independent foundations, disjoint files): 1 classifier, 2 cursor-attention module, 3 gaze pursuit, 4 pet/poke layers, 5 scenario pointer events.
- Wave 2 (controller integration, sequential, one shared reasoning chain): 6 controller facade, 7 adapter contract and type ripple.
- Wave 3 (hosts and T1 QA, disjoint files): 8 Model.vue/Live2D.vue host wiring, 9 T1 sink touch plus T1 touch scenarios.
- Wave 4 (rendered QA and docs): 10 T3 real-OS-pointer run and 11 ADR/doc updates in parallel, then 12 motion-qa skill doc (agent configuration, separate commit).
- Then the final verification wave F1-F4.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 8, 9 | 2, 3, 4, 5 |
| 2 | - | 6 | 1, 3, 4, 5 |
| 3 | - | 6 | 1, 2, 4, 5 |
| 4 | - | 6 | 1, 2, 3, 5 |
| 5 | - | 9, 10 | 1, 2, 3, 4 |
| 6 | 2, 3, 4 | 7 (same commit), 9, 11 | - |
| 7 | 6 | 8, 9 | - |
| 8 | 1, 7 | 10, 11 | 9 |
| 9 | 1, 5, 6, 7 | 10 | 8 |
| 10 | 5, 8, 9 | 12 | 11 |
| 11 | 6, 8 | F1-F4 | 9, 10 |
| 12 | 10 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Make the pet classifier rate-independent and overshoot-tolerant, and commit hover pokes shortly after the press
  Recommended task executor category: deep-low - one pure class plus its tests; the thresholds are specified, and edge cases need careful reasoning.
  What to do:
  - In `packages/stage-ui-live2d/src/composables/live2d/touch-gestures.ts`, add an optional field `head?: { x: number, y: number, halfHeight: number }` to `Live2DTouchSample`.
    - `x`, `y`: the sample's offset from the scaled head box center, in head widths, canvas convention (x right, y down).
    - `halfHeight`: half the box height in head widths.
    - Samples without `head` behave as today: region-based, no margin zone.
  - Replace the per-sample movement test at `touch-gestures.ts:105-108` with an anchor:
    - Keep `moveAnchor`. When `hypot(sample - moveAnchor) / scale >= idleStep` (new constant `idleStep = 0.03`), set `lastHeadMoveAtMs = timeMs` and `moveAnchor = sample`.
    - Reset the anchor whenever the trail resets.
  - Slow-stroke qualification: change `petWindowMs` from 1000 to 1500 and `petStartTravel` from 0.5 to 0.35. A continuous stroke at 0.25 head widths/s then gathers 0.375 head widths in the window. The reversal rule (hover mode) and the in-head share below still reject a passing cursor.
  - Add a margin zone, new constant `headMargin = { side: 0.5, top: 0.5, bottom: 0.15 }` head widths around the true box:
    - The zone is `|x| <= 0.5 + side` and `-halfHeight - top <= y <= halfHeight + bottom`.
    - A sample inside the zone keeps the trail and counts toward travel and reversals.
    - Only a sample outside the zone (or without `head` and region not `head`) clears the trail and starts `leftHeadAtMs`.
    - While a pet is active it continues anywhere in the zone.
  - Qualification adds a third condition: the share of trail time whose sample lies inside the true box (`|x| <= 0.5 && |y| <= halfHeight`) is at least `minInHeadShare = 0.5`. Keep `petStartTravel` and the reversal rule unchanged.
  - Hover-mode poke commit:
    - Add `get pressPending(): boolean`, true while a press over the model is held and not yet resolved.
    - Poke eligibility: a pending press becomes permanently ineligible (a drag) the first time any sample's distance from the press point exceeds `pokeMaxTravel` (0.05 of scale) before the press commits. Returning toward the press point does not restore eligibility.
    - In `update(timeMs)` and `moved(sample)`, when `!requireHold`, the press is pending and eligible, `timeMs - press.timeMs >= pokeCommitMs` (new, 90), and no pet is active: emit `{ kind: 'poke', region, x, y }` once and mark the press committed.
    - `released` emits the poke only if the press is still eligible and not already committed, under today's rule (`pokeMaxMs` 400, `pokeMaxTravel` 0.05 at release).
    - A committed press that later travels or turns into a pet emits nothing more.
    - `requireHold` keeps release-only semantics.
  - Update the class doc comment (lines 51-62) to describe the anchor, the margin zone, and the press commit.
  Must NOT do: change `pokeMaxMs`, `pokeMaxTravel`, `petIdleMs`, or `petLeaveMs` values (`petWindowMs` and `petStartTravel` change only as specified above); change the `Live2DTouchEvent` union shape; touch `Model.vue` (todo 8 wires it).
  Closes: GAP-5, part of GAP-8
  Parallelization: Wave 1 | Blocked by: - | Blocks: 8, 9
  References:
  - `packages/stage-ui-live2d/src/composables/live2d/touch-gestures.ts:1-187`
  - `packages/stage-ui-live2d/src/composables/live2d/touch-gestures.test.ts:1-82`: its `at()` and `stroke()` helpers sample every 20 ms, so `head` must be optional for the existing cases to keep passing unchanged.
  - `docs/ai/adr/2026-10-18-live2d-touch-interaction.md` "Gestures" section.
  - Simulated repro from planning: 144 Hz, plus/minus 0.3 head-width strokes at 1.2 head/s toggle pet-start/pet-end every ~0.5 s; plus/minus 0.6 never pets.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables/live2d/touch-gestures.test.ts` exits 0. All 7 existing cases pass unchanged, plus new cases:
    - (a) `it.each([30, 60, 144, 240])` Hz: plus/minus 0.3 head-width strokes at 1.2 head/s for 4 s with `head` set give exactly one `pet-start` and no `pet-end`. Then resting gives exactly one `pet-end` after 600 ms.
    - (b) plus/minus 0.6 head-width strokes (overshooting into the margin) pet.
    - (c) a straight pass across the zone emits nothing.
    - (d) a wiggle only inside the margin (`|x|` between 0.55 and 0.95) emits nothing.
    - (e) a held still press emits exactly one poke at press + 90 ms (+ one sample), and its release emits nothing more.
    - (f) a press released at 50 ms emits a poke on release.
    - (g) with `requireHold`, a press that becomes a pet never pokes.
    - (h) slow strokes: plus/minus 0.15 head widths at 0.3 head/s (a reversal every second), at 60 and at 144 Hz, start exactly one pet within 1.6 s and keep it without a `pet-end` for the following 4 s of strokes.
    - (i) a press that moves 0.08 head widths at 40 ms and is released at 80 ms emits no poke.
    - (i2) a press that moves 0.08 head widths at 40 ms, returns to the press point at 70 ms, and is released at 120 ms emits no poke (no commit, no release poke).
    - (i3) a press with 0.03 head-width jitter held for 100 ms emits exactly one poke at press + 90 ms.
    - (j) a press held still for 100 ms and then dragged 0.5 head widths emits exactly one poke (at press + 90 ms) and nothing on release.
    - (k) the existing passing-cursor case still emits nothing with the new window and travel values.
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  QA scenarios:
  - Happy: run the test file above and save its output to `<attemptDir>/task-1-live2d-cursor-touch-integration.log`. PASS = all cases green.
  - Failure check: a scratch probe in the run temp dir (not committed) feeds the 144 Hz, 1.2 head/s repro to the changed class and prints the event list. PASS = exactly `pet-start` once over 4 s of strokes. Save it to `<attemptDir>/task-1-live2d-cursor-touch-integration-probe.txt`.
  Commit: Y | fix(stage-ui-live2d): keep pets steady at any pointer rate and commit hover pokes on press

- [x] 2. Add the seeded cursor-attention model with staged onset and distance-dependent engagement
  Recommended task executor category: deep-low - a new pure module whose contract is fully specified; correctness is checked by deterministic tests.
  What to do:
  - Create `packages/stage-ui-live2d/src/composables/live2d/natural-motion/cursor-attention.ts`. Export constants as named `const`s at the top, each with a one-line comment.
  - `mapCursor(offset: GazePoint)`:
    - Clamp each axis to plus/minus 100, then compute `r = hypot`, `u = offset / r` (zero vector at r = 0), and `m = r / sqrt(r*r + softRadius*softRadius)` with `softRadius = 1.2`.
    - Distance gain `g(r) = farGain + (1 - farGain) * (1 - smoothstep(ln(nearDistance), ln(gainFarDistance), ln(max(r, 1e-6))))`, with `farGain = 0.35` and `gainFarDistance = 10`. It is 1 within 2 head widths and falls to 0.35 at 10 and beyond. Far cursors pull the head and body less; the eyes may still look straight at them.
    - Return `{ distance: r, gain: g, eye: { x: cursorGaze*m*u.x, y: cursorGaze*m*u.y }, head: { x: 0.25*m*g*u.x, y: 0.20*m*g*u.y } }`, where `cursorGaze = 0.65` is this module's own constant. `gaze.ts:41` keeps its copy until todo 6 deletes it with the old `setCursor`.
    - The offset is in head widths from the eye anchor, y up.
  - `class NaturalCursorAttention`, constructed with a `RandomStream`. Its `step(dt, at, input)` takes `input = { cursor: GazePoint | null, permission: 'full' | 'fade' | 'dismiss' }` and returns `{ weight, phase: 'idle' | 'notice' | 'full' | 'ignored', oriented, events }`. `oriented` is `phase === 'notice' || phase === 'full'`; `release` and `dismiss` both set the phase to `idle`. `events` lists `{ kind: 'notice' | 'engage' | 'release' | 'dismiss', at, distance }` in order.
  - Distance bands: `nearDistance = 2`, `farDistance = 6` head widths.
  - Episodes:
    - An episode starts when a non-null cursor first appears, when it starts moving again after resting at least `restHold = 0.6` s, or when it enters a nearer band than the current episode's.
    - Clarification recorded during execution (2026-10-24, ledger `plan-clarification` task 2): once the current episode's interest has ended and its drawn cooldown has elapsed, a cursor that is moving starts a new episode (a re-engagement opportunity with a fresh engagement draw). The cooldown sentence below presupposes this trigger; without it, a cursor that never stops would be ignored forever after one episode, contradicting Luke's D2 ("sometimes she should pay attention medium/far, sometimes not").
    - Movement means anchor travel of at least `moveStep = 0.03` head widths.
  - At episode start:
    - Near: always engage.
    - Medium (2 < r <= 6): engage with probability `engageMedium = 0.55`.
    - Far (> 6): engage with probability `engageFar = 0.2`.
    - Also draw an interest span from a truncated lognormal: median `interestMedian = { medium: 2.5, far: 1.5 }` s, logSD 0.5, clamped to 0.8-8 s. A near episode keeps interest while the cursor moves.
    - A non-engaging episode is `ignored`: weight goal 0, no events, until the next episode start.
  - Staged onset of an engaging episode (Luke D2: always notice, then full attention):
    - Phase `notice` sets the weight goal to `noticeLevel = 0.35` and emits `notice`.
    - After a drawn `noticeDwell` uniform in 0.25-0.5 s, if the episode is still interested, phase `full` sets the goal to 1 and emits `engage`.
  - Interest ends when the span elapses (medium/far) or the rest decay reaches its floor. The weight goal then falls and emits `release` when the weight crosses `releaseAt = 0.3` downward. A new episode can start only after a drawn cooldown of 4-10 s, unless the cursor enters a nearer band.
  - Rest decay: goal × `rest(s)`, with `rest(s) = 1` for `s <= restHold`, else `exp(-(s - restHold) / restTau)`, `restTau = 0.8`. These values make a settled weight fall below `releaseAt` about 2.2 s after the cursor stops and to about 0.12 at 3.0 s (simulated during planning). Attention is therefore already released when the performance resolver switches watching attention to `screen` 3 s after the last cursor move (`packages/stage-shared/src/performance-state/index.ts:183`), so that switch is a silent dismiss.
  - Smoothing: `w += (goal - w) * (1 - exp(-dt / tau))`. Rising uses tau `captureTau = 0.15`. Falling uses `dismissTau = 0.12` for permission `dismiss`, `lostTau = 0.4` for a null cursor, and `fadeTau = 0.5` otherwise (including permission `fade`). Set exactly 0 when the goal is 0 and `w < 1e-4`.
  - Permission `dismiss`:
    - Forces the goal to 0.
    - On its rising edge it emits `dismiss` whenever the current episode is oriented: phase `notice` or `full`, meaning `orient` has run and gaze may be pursuing the cursor, whatever the weight. Afterwards the phase is `idle`.
    - The edge is a silent no-op only when the phase is `idle` or `ignored`, which includes after a `release` (whose `gaze.disengage` already ended pursuit). So a disabled toggle, an idle T3 gate run, or a cursor that already faded never causes a saccade or a draw.
    - Permission `fade` forces the goal to 0 with no event. In this plan the controller uses only `full` and `dismiss`; `fade` exists for host-side permission loss without a deliberate look-away.
  - A permission change from `dismiss`/`fade` back to `full` while the cursor is moving re-opens the current episode:
    - It reuses the episode's engagement draw if one was made.
    - It draws only if none was made, and only with a non-null cursor.
  - Randomness: draw only at episode starts, with a non-null cursor. The cooldown (4-10 s) and the interest span are drawn together at episode start, never at release, so a release that happens on a null-cursor step draws nothing.
  - Create `natural-motion/cursor-attention.test.ts`.
  Must NOT do: import from `gaze.ts` or the facade (pure module; import only the `GazePoint` type and `random.ts`); read wall-clock time; draw random numbers while the cursor is null.
  Closes: GAP-1 (mapping math), GAP-3 (model), IS-2 behavior
  Parallelization: Wave 1 | Blocked by: - | Blocks: 6
  References:
  - `natural-motion/gaze.ts:36-41` (`cursorWeight`, `cursorGaze`)
  - `natural-motion/random.ts` (`RandomStream`, `truncatedLognormal`, `gaussian`)
  - `natural-motion/touch.ts:79-96`: exact-rest settle pattern.
  - `natural-motion.ts:47-53,432-439`: follower style.
  - Luke's D2 quote in `.omo/drafts/live2d-cursor-touch-integration.md` Decisions.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables/live2d/natural-motion/cursor-attention.test.ts` exits 0 with cases:
    - (a) `mapCursor` keeps direction (angle equal within 1e-12) and its eye magnitude is monotonic in r; m(0.5) is 0.38 and m(3) is 0.93 within 0.01.
    - (a2) head pull falls off with distance: `|mapCursor(u*3).head| > |mapCursor(u*9).head|`, `g(1.5) = 1` and `g(20) = 0.35` within 1e-9, and `g` is non-increasing for r >= 2.
    - (b) a near moving cursor emits `notice` then `engage`, with an engage-minus-notice gap in [0.25, 0.5] s.
    - (c) over 400 seeds, a single medium episode engages in [0.45, 0.65] of runs and a far episode in [0.12, 0.28].
    - (d) a settled near cursor that stops keeps `w > 0.9` for 0.6 s, falls below 0.3 (emitting `release`) by 2.4 s after the stop, and is below 0.15 at 3.0 s, with no `dismiss` event.
    - (e) permission `dismiss` takes `w` below 0.05 within 0.4 s and emits `dismiss` once.
    - (f) a counting RandomStream wrapper records zero draws over 60 s of null cursor with permission `full`, over 60 s of null cursor with permission `dismiss`, and over 60 s of null cursor following an engaged episode (release happens on a null step).
    - (f2) `dismiss` while the phase is `idle` or `ignored` (no episode, or after `release`) emits nothing.
    - (f4) `dismiss` 200 ms after `notice` (weight about 0.26, below `releaseAt`) emits exactly one `dismiss`.
    - (f3) dismiss for 2 s then full with a moving near cursor engages within 0.6 s.
    - (g) the same seed and inputs give identical outputs.
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  QA scenarios:
  - Happy: the test run, saved to `<attemptDir>/task-2-live2d-cursor-touch-integration.log`. PASS = all cases green.
  - Failure check: case (f) fails when a deliberate extra draw is injected on the null path in a scratch copy (mutation run, not committed). Record its failing output in `<attemptDir>/task-2-live2d-cursor-touch-integration-mutation.txt`.
  Commit: Y | feat(stage-ui-live2d): add seeded cursor attention with staged onset

- [x] 3. Give gaze velocity-limited pursuit, catch-up saccades, weighted cursor fixations, and an override target
  Recommended task executor category: deep-low - one layer plus its tests; the dynamics are specified.
  What to do:
  - In `packages/stage-ui-live2d/src/composables/live2d/natural-motion/gaze.ts`, add the following beside the existing `setCursor(cursor, at)` (lines 84-96). The existing method stays working so this commit is green; todo 6 deletes it once the facade switches:
    - `setCursorTarget(target: GazePoint | null, weight: number)`: stores the mapped eye target and weight, never saccades.
    - `orient(at)`: one saccade to the cursor target, used on `notice`.
    - `disengage(at)`: if the current target is the cursor, freeze it at the current gaze point and set `nextFixationAt = min(nextFixationAt, at + 0.3)`; never saccades to the camera.
    - `dismiss(at)`: if the current target is the cursor (pursuit or a saccade toward it), set the cursor weight to 0 first, then `saccadeTo(drawTarget(), at)` immediately so the drawn target can never be the cursor. Otherwise it does nothing.
    - `setOverride(point: GazePoint | null, at)`: while set, `drawTarget` returns the jittered override and cursor pursuit is off. Setting or clearing it saccades once to the new target.
    - `get onCursor(): boolean`: true while the target is the cursor.
  - Pursuit while the target is the cursor (constants: `pursuitMaxSpeed = 1.5` eye units/s, `pursuitVelocityTau = 0.1`, `pursuitPositionTau = 0.2`, `targetVelocityTau = 0.06`, `catchUpError = 0.1`, `catchUpRefractory = 0.12`). Keep pursuit point `p` and velocity `v`. Each step:
    - Low-pass the target velocity `vt`.
    - `vc = 0.9*vt + (target - p)/pursuitPositionTau`, limited to `pursuitMaxSpeed`.
    - `v += (vc - v)*(1 - exp(-dt/pursuitVelocityTau))`, then `p += v*dt`.
    - When `|target - p| > catchUpError` and the refractory time has passed, run a min-jerk saccade to the current target, with no velocity prediction: a discontinuous target step inflates the filtered `vt`, and a predictive endpoint would overshoot and fire repeated catch-ups. On landing, set `p` to that point and `v = 0`; pursuit then re-accelerates through the velocity filter.
    - Pursuit that starts after `orient`, an override release, or any saccade also starts with `v = 0`.
    - Because `v` starts at 0 and each step blends it toward a command limited to `pursuitMaxSpeed`, the actual pursuit velocity never exceeds the limit. Document this invariant in a comment.
    - Planning simulation of this rule on the 120 Hz grid: a 0.5-unit step gives exactly one catch-up, a 0.05-unit step none, and a 4 units/s sweep stays at or below 0.8 units/s of pursuit, with repeated catch-ups (the human catch-up pattern for fast targets).
  - Saccades store fixed endpoints: `gazeAt` (lines 155-161) interpolates toward a stored point, never a live target.
  - `saccadeCount` and `saccadeSize` keep their current meaning: every saccade increments them, including catch-up saccades. A catch-up fires only at an error above 0.1 eye units, so the blink/face coupling sees a real gaze jump. Existing `gaze.test.ts` assertions on `saccadeCount` (for example 67-79) stay unchanged.
  - `drawTarget` (line 181) picks the cursor with probability `cursorWeight * weight`, and only when `weight > 0` and a target exists. With weight 0 it draws exactly the numbers it draws today.
  Must NOT do: change autonomous fixation targets, hold distributions, aside logic (lines 98-117), or `NaturalAttentionShifts`; change compensation `K`.
  Closes: GAP-2, GAP-4 (gaze side)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 6
  References:
  - `natural-motion/gaze.ts:1-230`
  - `natural-motion/gaze.test.ts:1-131`: existing cases must pass unchanged.
  - `natural-motion/processes.ts` (`minJerk`)
  - `natural-motion.ts:396-401`: the saccade event consumers, blink and face.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables/live2d/natural-motion/gaze.test.ts` exits 0. Existing cases pass unchanged, plus new cases:
    - (a) a cursor target sweeping at 4 eye units/s: outside saccade intervals, the per-step eye speed never exceeds 1.5 + 1e-9.
    - (b) a 0.5-unit target step causes exactly one catch-up saccade, and `saccadeCount` rises by 1.
    - (c) a 0.05-unit step (below `catchUpError`) is absorbed by pursuit: the gaze is within 0.01 of the target 1.0 s after the step and `saccadeCount` does not change.
    - (d) over 4000 fixation draws, the cursor share is 0.8 plus/minus 0.04 at weight 1 and 0.24 plus/minus 0.04 at weight 0.3.
    - (e) after `disengage` the next 0.25 s contain no saccade to within 0.05 of the camera point.
    - (e2) `dismiss` while pursuing the cursor leaves the cursor target: within 150 ms the gaze is more than 0.1 eye units from the cursor target, and `onCursor` is false.
    - (e3) after `setCursorTarget(target, 0)` following pursuit, 2000 forced fixation draws (stepping past each hold) never select the cursor.
    - (e4) `disengage(at)` while pursuing: `onCursor` is false at `at`, the gaze holds the frozen point (no pursuit movement while the cursor target moves) until the next fixation, which starts by `at + 0.3`, and with weight 0 that fixation is not the cursor.
    - (f) with weight 0 and a null target, the output equals a reference layer built from the same seed (equivalence with the old no-cursor path).
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0. The change is additive, so the facade still compiles.
  QA scenarios:
  - Happy: the test run, saved to `<attemptDir>/task-3-live2d-cursor-touch-integration.log`. PASS = all green.
  - Failure check: a mutation that removes the speed limit makes case (a) fail. Record it in `<attemptDir>/task-3-live2d-cursor-touch-integration-mutation.txt`, then restore.
  Commit: Y | feat(stage-ui-live2d): pursue the cursor with bounded eye speed and catch-up saccades

- [x] 4. Give the pet a two-axis hand, make poke direction y-aware, and speed up the poke nudge
  Recommended task executor category: unspecified-low - small changes across three files plus one new test file.
  What to do:
  - In `natural-motion/touch.ts`:
    - `NaturalPetLayer.set(hand: { x: number, y: number } | null)`. The hand follows both axes with `handTau`. `x` runs -1 left to 1 right; `y` runs -1 at the top edge of the head box to 1 at the bottom (canvas down).
    - `headOffset()` returns `[0, petPitch*L - petStrokePitch*L*hand.y, petRoll*L*hand.x]` with new `petStrokePitch = 0.06`.
    - Keep the exact-neutral-at-level-0 guarantee: hand and level reset together.
  - Change `pokeDirection(region, x, y)`, with `top = max(0, -y)`:
    - head: `[-0.45*sx, 0.6 - 0.9*top, 0.45*sx]`
    - body: `[-0.3*sx, 0.35 - 0.5*top, 0.2*sx]`
    - Clamp to unit length as today.
  - In `natural-motion/impulses.ts`, `nudge(direction, intensity, at, tauRange = defaultTauRange)` gains an optional tau range. Export `pokeNudgeTau = { min: 0.12, max: 0.18 }` from `touch.ts`.
  - In `natural-motion/pending-actions.ts`, the poke action carries `y`, uses `pokeDirection(region, x, y)`, and nudges with `pokeNudgeTau`.
  - Keep this commit green with the smallest call-site updates:
    - The facade `setPet(hand: number | null, now)` passes `{ x: hand, y: 0 }` to the layer.
    - `pokeDirection` takes `y = 0` as a default.
    - The pending poke action's `y` is optional with default 0.
    - Todo 6 replaces these with the real two-axis inputs and removes the defaults.
    - Each default carries the root `AGENTS.md` four-line `// NOTICE:` comment with "Removal: todo 6 of .omo/plans/live2d-cursor-touch-integration.md (facade two-axis inputs)".
  - Create `natural-motion/touch.test.ts`.
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  Must NOT do: change `petFace`, attack/release taus, `pokeStrength`, `pokeGlanceHold`, or `pokeSurpriseDedupeSeconds`; change emotion impulse taus.
  Closes: GAP-7, GAP-8 (direction and rise)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 6
  References:
  - `natural-motion/touch.ts:1-116`
  - `natural-motion/impulses.ts:44,195-198,236-248`
  - `natural-motion/pending-actions.ts:22-26,58-70`
  - `natural-motion.test.ts:554-636`: existing poke and pet cases; todo 6 updates call sites.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables/live2d/natural-motion/touch.test.ts` exits 0 with cases:
    - (a) at level 0 every hand gives a zero offset and unit face multipliers.
    - (a2) no retained hand state: pet with hand `{ x: 1, y: 1 }` until full, end it and step until the level settles to 0, then pet with hand `{ x: -1, y: -1 }`. Every step of the new pet's first 0.1 s has a roll with the sign of `petRoll * -1`, and a stroke-pitch term with the sign of `-petStrokePitch * -1`.
    - (b) at full level, `hand.y = 1` gives lower pitch than `hand.y = -1` by 0.12 plus/minus 1e-9.
    - (c) `pokeDirection('head', 0, -1)[1] < 0` and `pokeDirection('head', 0, 1)[1] > 0`.
    - (d) mirror symmetry in x for both regions.
    - (e) a `NaturalImpulses.nudge` with `pokeNudgeTau` peaks within 0.2 s of its start.
  QA scenarios:
  - Happy: the test run, saved to `<attemptDir>/task-4-live2d-cursor-touch-integration.log`. PASS = all green.
  - Failure check: case (a2) fails under a mutation that skips the hand reset at settle, because the new pet's first steps then roll toward the old hand. Record it in `<attemptDir>/task-4-live2d-cursor-touch-integration-mutation.txt`, then restore.
  Commit: Y | feat(stage-ui-live2d): follow vertical pet strokes and aim pokes by where they land

- [x] 5. Add pointer events and stroke/approach builders to the motion-scenario contract
  Recommended task executor category: quick - a schema variant, three builders, and tests in one package.
  What to do:
  - In `packages/stage-shared/src/motion-scenario/schema.ts`, add the variant `strictObject({ kind: literal('pointer'), at: seconds, phase: picklist(['move', 'down', 'up', 'leave']), x: finite number, y: finite number })`.
    - Coordinates are head widths from the head box center, canvas convention (x right, y down), matching `Live2DTouchSample.head` from todo 1.
    - Document this on the variant.
    - Extend the T3 refusal rule (lines 67-68) to `pointer` for now; todo 10 relaxes it.
    - Document on the variant that when a scenario has both `cursor` and `pointer` events, the latest event by `at` sets the cursor. There is no schema rule.
  - Keep the stage-ui T3 handler exhaustive: add `case 'pointer':` to the `dispatchEvent` switch in `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts:150-172`, next to `speech`/`cursor`, returning the rejection reason `The rendered app has no QA input for "pointer" events`. Todo 10 changes it to `return null`.
  - In `builders.ts`, add three builders, each returning events sorted by `at`:
    - `buildPointerStroke({ at, durationSeconds, rateHz, amplitude, speed, axis: 'x' | 'y', center = { x: 0, y: 0 } })`: triangle-wave strokes sampled at `rateHz`.
    - `buildPointerApproach({ at, from: 'left' | 'right' | 'top' | 'bottom', startDistance, endDistance, speed, rateHz })`: a straight path toward the head center.
    - `buildPointerPoke({ at, x, y, holdSeconds })`: a `down` and an `up` event.
  - Export everything through `motion-scenario/index.ts`.
  Must NOT do: change existing event variants or the `cursor` pairing rule; bump `version`.
  Closes: GAP-9 (contract)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 9, 10
  References:
  - `packages/stage-shared/src/motion-scenario/schema.ts:1-86`
  - `builders.ts`, `index.ts`, `scenario.test.ts`
  - `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts:150-217` (event switch, dispatched counting, and `markCaptureEvent`)
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-shared exec vitest run src/motion-scenario` exits 0 with new cases:
    - (a) a t1 scenario with pointer events validates.
    - (b) a t3 scenario with pointer events is refused with the path of the event.
    - (c) `buildPointerStroke` at 144 Hz for 1 s yields 145 move events, sorted, within plus/minus amplitude.
    - (d) `buildPointerApproach` from each side ends at `endDistance` on the correct axis.
  - `pnpm -F @proj-airi/stage-shared typecheck` and `pnpm -F @proj-airi/stage-ui typecheck` exit 0.
  QA scenarios:
  - Happy: the test run, saved to `<attemptDir>/task-5-live2d-cursor-touch-integration.log`.
  - Failure check: case (b) shows the refusal message. Copy the asserted message into the log.
  Commit: Y | feat(stage-shared): add pointer events to motion scenarios

- [x] 6. Integrate cursor attention, pursuit, and the touch handoff into the Natural controller
  Recommended task executor category: deep-high - the central integration; its ordering, neutrality, and determinism are argued from invariants across several layers.
  What to do:
  - In `packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts`:
    - Append `cursorAttention: 13` to `streamIndex` (line 41) and construct `NaturalCursorAttention` from it.
    - `setCursor(offset: GazePoint | null, nowSeconds, mode: 'live' | 'dismissed' = 'live')`: the offset is in head widths from the eye anchor, y up. Remove the plus/minus 1 clamp (line 216) and clamp to plus/minus 100.
    - `setPet(hand: { x: number, y: number } | null, nowSeconds)`.
    - `poke(region, x, y, nowSeconds)`.
  - In `integrate()`, delete the null gate at line 318. Permission is `dismiss` when mode is `dismissed`, `energy.aside`, or `energy.screen`; otherwise `full`.
    - Screen attention is a deliberate look at the screen (game/media foreground, an ACT look cue, or the resolver after 3 s without cursor movement). It therefore keeps today's one eased saccade away when attention is engaged.
    - When the cursor has already faded on its own, the dismiss edge is silent (todo 2).
  - Step attention before gaze and map its events:
    - `notice` → `gaze.orient`
    - `release` → `gaze.disengage`
    - `dismiss` → `gaze.dismiss`
  - Call `gaze.setCursorTarget(mapped.eye, attention.oriented ? w * (1 - pet.level) : 0)`.
    - `attention.oriented` (todo 2) is true only in phase `notice` or `full`.
    - Fixation eligibility is therefore separate from the fading weight. After `release` or `dismiss` the cursor cannot be selected as a fixation until a new `notice`, while the head bias, which uses `w`, keeps fading gradually.
    - An `ignored` episode never attracts fixations.
  - Head bias follower targets: `w * (1 - pet.level) * (0.4 + 0.6 * onCursor) * mapped.head`.
    - `onCursor` is a smoothed 0..1 (tau 0.3 s) of `gaze.onCursor`.
    - Slow the follower time constants (lines 50-53) to `cursorX: 0.22, cursorY: 0.26`.
  - Posture amplitude: multiply by `1 - attentionCalm * w * (1 - pet.level)`, with `attentionCalm = 0.3`.
  - Approach (hand near and above), with `approach` smoothed (tau 0.2) toward `smoothstep(1.6, 0.9, r)` while a non-null cursor is within 1.6 head widths, moving or resting, else 0. It is 0 at r >= 1.6 and 1 at r <= 0.9:
    - When the offset y > 0.2, the head-bias y target becomes `mapped.head.y * (1 - approach) - 0.05 * approach`. It falls monotonically as a hand descends and is negative (a slight tuck) once r <= 0.9. Cap the eye target y at 0.35.
    - Multiply the face `eyeOpenMultiplier` by `1 - 0.12 * approach`, through `withHints` or an explicit factor in the face composition.
  - Melt-into-hand handoff (Luke D1):
    - While `pet.level > 0.5`, call `gaze.setOverride({ x: 0.1 * hand.x, y: -0.12 }, at)`. Clear it when the level falls below 0.5.
    - After clearing, if `w > releaseAt` call `gaze.orient`; otherwise autonomous fixations resume. Never force a camera saccade.
    - A pet whose active duration exceeded 3 s calls `gaze.glance(camera, 1.2, at)` once at its end.
  - Observer events in `natural-motion/frame-types.ts`:
    - Add `NaturalAttentionEvent { kind: 'attention', at, phase: 'notice' | 'engage' | 'release' | 'dismiss', distance }`.
    - Add `NaturalTouchEvent { kind: 'touch', at, touch: 'poke' | 'pet-start' | 'pet-end', region?: 'head' | 'body' }`. Pet start/end are reported on pet target transitions inside the controller.
    - Emit them only while an observer is attached, like the existing events.
  - Update `natural-motion.test.ts`:
    - Keep unchanged and passing: `keeps disabled cursor input equivalent to autonomous output` (213), `moves exactly as before while nobody pets it` (627), and `keeps sixty seconds of untouched output identical with no gesture draws` (781).
    - Expected to pass unchanged; re-run and confirm: `keeps every output finite and within normalized bounds` (164-180; its `{x: 1, y: -1}` cursor is now 1.4 head widths), `leaves the cursor with one eased saccade when screen attention begins` (527-552; screen dismiss keeps the eased saccade), `keeps the look:"screen" cue off the cursor through a pause between speech clips` (517), and every test not listed in this todo.
    - Update to the new contract, naming each in the commit body:
      - `returns from cursor expiry gradually without resetting followers` (199): keep no-snap; re-derive the time bound from `lostTau`.
      - The aside cases at 379-467 that call `setCursor` with binary semantics (426, 433, 446): re-derive with `dismiss` and the staged onset; keep their aside-wins assertions.
      - `leaves a pause without a look cue unchanged: the gaze follows the cursor at once` (469): becomes "within 0.6 s, after notice".
      - `still follows the cursor under cursor attention` (509-515): re-derive its `offCursor` threshold from `mapCursor` of the test's `cursorAt` offsets. Under the new mapping, an eye target near x = -0.29 would be misclassified by `point.x > -0.3`.
      - `settles into a pet ... ignores the cursor ...` (602): becomes "the pet owns gaze and head"; eyes below the camera point during the pet.
      - The pet/poke call sites at 559-633 and 878-879 gain y / two-axis hands.
    - Before editing, run `lsp_find_references` on `setCursor`, `setPet`, `poke`, `pendingPokes`, and `NaturalMotionEvent` to confirm the caller set (known: `Model.vue:628-630`, `scenario-sink.ts:162-180`, `bench-natural.ts:63-78`, `spikes/t2/loop.ts:92-109`, `natural-motion-adapter.test.ts:39,88-92,675-685`).
  - Add new cases:
    - (a) a near moving cursor produces `attention` events notice then engage, in order.
    - (b) across 50 seeds a far cursor engages in some and not in others (both counts > 0).
    - (c) pet start and end: the largest per-120-Hz-step head delta is < 0.02, and no fixation within 0.05 of the camera point occurs in the 0.5 s after pet start.
    - (d) a hand descending straight from above: offset `(0, 1.6)` held 2 s, then moved to `(0, 0.5)` at 1 head/s with the same seed as a no-cursor baseline. The headY difference from the baseline is non-increasing (tolerance 1e-3) from the start of the descent, and is <= 0 once 0.6 s have passed after the cursor reaches r <= 0.9. The cursor then rests at `(0, 0.5)` until the check ends 1.5 s after arrival.
    - (d2) head pull falls off with distance: two runs with engagement forced (seeded so both engage) and the cursor held moving at offsets `(3, 0)` and `(9, 0)`. After 2 s, the headX difference from the no-cursor baseline at r = 9 is smaller than at r = 3.
    - (e) mirrored cursor paths (x → -x) with the same seed:
      - The attention event lists (kind, `at`, distance) are identical.
      - From 0.3 s after `engage` (follower settle) until the path ends, `headX(right path) - headX(left path)` is positive at every step, with the right path's cursor at x > 0. Autonomous posture is identical across the two runs, because attention, calming, and the posture streams do not depend on gaze timing, and the cursor head bias has opposite signs.
      - Over the same interval, the mean pre-compensation `fixation.x` is > 0 for the right run and < 0 for the left run.
      - Y and per-step gaze values are not compared: saccade durations depend on the distance from the previous fixation (`gaze.ts:164-175`), so mirrored destinations legitimately shift later fixation timing.
      - This isolates the cursor's directional pull from the shared, symmetric posture calming.
    - (f) frame-partition independence for a cursor path at 1/30, 1/60, and 1/144 s frames (equal within 1e-9).
    - (g) after a near cursor rests until its weight falls below `releaseAt`, switching to `screen` attention emits no `dismiss` attention event. The engaged case keeps the existing eased saccade (test 527).
    - (h) `energy.aside` dismisses within 0.4 s.
    - (i) a poke at y = -1 lowers headY.
    - (j) `setCursor(null, t, 'dismissed')` for 60 s equals the autonomous reference output (same seed, never-set cursor) exactly. This is the T3-gate equivalence.
    - (k) `screen` attention for 2 s, then `cursor` with a moving near cursor, engages within 0.6 s.
    - (n) no renewed pursuit after release or dismissal: over 50 seeds, a cursor moves to offset `(3, 0)` (eye target x about 0.6, far from every autonomous target) and is held there; the seeds whose episode engages (at least 10 must) either rest until `release` or are dismissed by `screen` attention. No new `notice` occurs while the cursor is still. The pre-compensation `fixation` stays more than 0.3 eye units from the cursor eye target at every step until the residual weight reaches 0:
      - release path: from release + 0.39 s, the 0.3 s frozen hold `disengage` allows plus the 0.09 s maximum saccade duration;
      - dismiss path: from dismiss + 0.15 s.
      - The immediate part, pursuit and cursor selection disabled at the event itself, is proven at the layer level by todo 3 (e3) and (e4).
    - (m) dismissal during notice: a near cursor appears, and 200 ms after the `notice` event the performance attention switches to `screen`. A `dismiss` event fires and the gaze leaves the cursor within 150 ms, as the unchanged test 527 already requires at the same timing.
    - (l) the real resolver timing: a near cursor engages, stops at t0, and at t0 + 3.0 s the performance state switches to watching/`screen` (as `WATCHING_CURSOR_RECENT_MS = 3000` does). A `release` attention event occurs before t0 + 2.4 s, and no `dismiss` event occurs at or after the switch. The fixed seed keeps this deterministic; the check reads attention events only, not saccade timing, which autonomous fixations may legitimately share.
  Must NOT do: add random draws on the no-cursor/no-touch path; change emotion, hold, gesture, breath, or blink layers; change rig-ownership logic.
  Closes: GAP-1 (controller side), GAP-3 (controller), GAP-4, GAP-6
  Parallelization: Wave 2 | Blocked by: 2, 3, 4 | Blocks: 7, 8, 9, 11
  References:
  - `natural-motion.ts:1-441`; specifically `streamIndex` (41), followers (50-53), `setCursor` (213-217), `poke`/`setPet` (288-308), `integrate` (311-414), `follow` (432-439).
  - `natural-motion/frame-types.ts:30-74`
  - `natural-motion/face-hints.ts` (`withHints`)
  - `natural-motion.test.ts` (case lines above)
  - `natural-motion/liveliness-gate.test.ts` (must stay green; it sets no cursor)
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables/live2d/natural-motion.test.ts src/composables/live2d/natural-motion` exits 0. This includes `liveliness-gate.test.ts`, `observer.test.ts`, and the T1 scale-hooks.
  - Delete the old `gaze.setCursor` and the todo 4 defaults (`y = 0`, the `{ x: hand, y: 0 }` wrap).
  - The signature changes break the adapter and host call sites. Todo 7 fixes them, and todos 6 and 7 land as ONE commit, so every commit stays green.
  QA scenarios:
  - Happy: the test run, saved to `<attemptDir>/task-6-live2d-cursor-touch-integration.log`. PASS = all green, with the three unchanged equivalence tests named in the log.
  - Failure check: a scratch T1 probe (not committed) drives a 2 s near cursor sweep and prints the max per-step eyeX speed outside saccades. PASS = <= 1.5/120 + 1e-9 per step. Also print the attention event list. Save to `<attemptDir>/task-6-live2d-cursor-touch-integration-probe.txt`.
  Commit: N - lands in one commit with todo 7 (shared signature change); see todo 7's commit line.

- [x] 7. Carry the new cursor, pet, and poke contract through the adapter, the Model.vue attention closure, and every caller
  Recommended task executor category: unspecified-low - a type ripple plus the head-anchored mapping in Model.vue and one rewritten test, all in the same commit as todo 6.
  What to do:
  - In `natural-motion-adapter.ts` `Live2DNaturalMotionAttention`:
    - `cursor` is documented as a head-width offset from the eye anchor (y up), or null.
    - Add `cursorDismissed: boolean` (cursor attention switched off or an ACT aside cue).
    - `pet: { x: number, y: number } | null`.
    - `pendingPokes` items gain `y`.
  - In `compose()` (lines 305-316), forward to `setCursor(cursor, time, cursorDismissed ? 'dismissed' : 'live')`, `poke(region, x, y, time)`, and `setPet(pet, time)`.
  - Update callers to the new type:
    - `packages/qa-tools/src/motion/scenario-sink.ts:156-181`: `cursorDismissed: !cursorAttention`; keep `cursor` from events.
    - `packages/stage-ui-live2d/scripts/bench-natural.ts:79`
    - `packages/qa-tools/spikes/t2/loop.ts:110`
  - Rewrite `natural-motion-adapter.test.ts` 'preserves cursor distance, reversal, expiry, and asymmetric bounds' (267-306):
    - The near/far ratio uses `mapCursor` from todo 2 instead of 0.25.
    - Keep the reversal-equality, bounds, and expiry-finite assertions.
  - Update the touch fixtures (670-685) with `y`.
  - `Model.vue` contract side, so the commit is consistent:
    - `readTouchRegions` (1243-1258) also stores the unscaled head box.
    - The `createNaturalAdapter` attention closure (601-635) maps the focus point with `toModelPosition` as today (603-608). It then computes the eye anchor `ax = head.x + head.width / 2`, `ay = head.y + eyeAnchorShare * head.height` from the unscaled head, with `eyeAnchorShare = 0.55` exported as a named constant from `composables/live2d/touch-regions.ts`.
    - `cursor = { x: (fx - ax) / head.width, y: (ay - fy) / head.width }`.
    - Without a head, fall back to anchor `(0.5 * originalWidth, 0.3 * originalHeight)` and unit `0.3 * originalWidth`.
    - `cursor` is non-null when `live2dNaturalCursorAttention` is on and `props.eyeFocusSourceActive`.
    - `cursorDismissed = !live2dNaturalCursorAttention.value || props.performance.attention === 'aside'`.
    - Remove the `!== 'aside'` and `!== 'screen'` gating at line 605; the controller decides.
  - Touch values in `Model.vue`:
    - Add `acrossRectY` next to `acrossRect` (1261-1264): -1 at the top edge to 1 at the bottom.
    - The pet hand becomes `{ x: acrossRect(x, head), y: acrossRectY(y, head) }` (1326).
    - Pokes push `y: acrossRectY(...)` for their region box (1298).
  - These exit 0: `pnpm -F @proj-airi/stage-ui-live2d typecheck`, `pnpm -F @proj-airi/stage-tamagotchi typecheck`, `pnpm -F @proj-airi/stage-web typecheck`, `pnpm -F @proj-airi/stage-tamagotchi-kirie typecheck`, and `pnpm -F @proj-airi/qa-tools typecheck`. Run the full unit sets as well: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables` and `pnpm -F @proj-airi/qa-tools exec vitest run`.
  Must NOT do: change ownership, blending, or face composition in the adapter; change Universal `focusAt`/`model.focus` (Model.vue 1343-1349) or `useLive2DEyeFocusFor`.
  Closes: GAP-1 (host mapping), GAP-3 (adapter contract), GAP-7/GAP-8 (wiring)
  Parallelization: Wave 2 | Blocked by: 6 | Blocks: 8, 9
  References:
  - `components/scenes/live2d/Model.vue:596-660,1222-1330`
  - `composables/live2d/touch-regions.ts:1-71`
  - `composables/live2d/head-anchor.ts:209-231`
  - `natural-motion-adapter.ts:21-58,295-316`
  - `natural-motion-adapter.test.ts:31-40,85-95,267-306,670-690`
  - `scenario-sink.ts:156-181`
  - `scripts/bench-natural.ts:70-85`
  - `packages/qa-tools/spikes/t2/loop.ts:100-115`
  Acceptance criteria:
  - All exit 0:
    - `pnpm -F @proj-airi/stage-ui-live2d typecheck`
    - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables/live2d/natural-motion-adapter.test.ts`
    - `pnpm -F @proj-airi/qa-tools typecheck`
  QA scenarios:
  - Happy: the three commands, saved to `<attemptDir>/task-7-live2d-cursor-touch-integration.log`.
  - Failure check: `rg -n "pet: null" packages` shows only sites that also set `cursorDismissed`. Save the output in the log.
  Commit: Y (includes todo 6) | feat(stage-ui-live2d): drive Natural cursor attention continuously from the head and melt into pets

- [x] 8. Finish host wiring: no expiry snap for Natural, one pointer source, margin-aware touch samples, prompt poke updates
  Recommended task executor category: unspecified-high - Vue scene wiring across two files, proven live on the real surface.
  What to do:
  - In `packages/stage-ui-live2d/src/components/scenes/Live2D.vue:134-141`, when `live2dMotionDriver === 'natural'`:
    - Do not start the 1000 ms clearing timeout. `activeCursorPosition` is cleared only when `props.cursorPosition` becomes null or undefined.
    - Other drivers keep the timeout exactly.
    - `eye-focus-source-active` (line 197) stays `!!activeCursorPosition` for Natural.
  - In `Model.vue`'s attention closure (from todo 7), add a fresh-pointer preference:
    - When a primary `pointermove` canvas sample is younger than 100 ms (`performance.now()`), use its model-space point instead of the `focusAt` mapping. This gives gaze and touch one input.
    - Record that sample in `onTouchPointer` before the `touchActive` gate (1314-1316), for `pointermove` only, storing only the model-space point and time.
    - The cursor is then non-null when `props.eyeFocusSourceActive` or a fresh pointer sample exists, and cursor attention is on.
  - `touchSampleFrom` (1273-1293) adds `head` from the scaled head box: center offset / width, `halfHeight = height / 2 / width`.
  - The per-frame hook (653-656) calls `touchGestures.update(performance.now())` when `touchGestures.petting || touchGestures.pressPending`.
  Must NOT do: change Universal `focusAt`/`model.focus` (1343-1349) or `useLive2DEyeFocusFor`; add settings; change presence-bubble head anchoring.
  Closes: GAP-3 (host expiry), GAP-5 (host samples), GAP-6 (host), GAP-8 (prompt commit)
  Parallelization: Wave 3 | Blocked by: 1, 7 | Blocks: 10, 11
  References:
  - `Model.vue:596-660,1222-1349,1400-1432`
  - `Live2D.vue:74-141,186-200`
  - `composables/live2d/touch-regions.ts:1-71`
  - `composables/live2d/head-anchor.ts:209-231`
  - `composables/live2d/eye-tracking.ts:37-58` (unchanged; it already applies `model-eye-offset`)
  - `apps/stage-web/src/pages/index.vue:77,116` (web host passes `cursorPosition`)
  - `apps/stage-tamagotchi/src/renderer/pages/index.vue:420-423`
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck` and `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` (Node and browser projects) exit 0.
  - `pnpm -F @proj-airi/stage-tamagotchi typecheck`, `pnpm -F @proj-airi/stage-web typecheck`, and `pnpm -F @proj-airi/stage-tamagotchi-kirie typecheck` exit 0.
  - `rg -n "clearCursorFocusTimeout" packages/stage-ui-live2d/src/components/scenes/Live2D.vue` shows the timeout started only for non-Natural drivers.
  QA scenarios:
  - Happy: the commands above, saved to `<attemptDir>/task-8-live2d-cursor-touch-integration.log`.
  - Real-surface proof of this todo's host behavior: the todo 10 `t3-touch` and `t3-touch-pass` runs (rendered Electron, real OS cursor), plus the F3 live approach check. Both run after the pointer driver exists.
  - Failure check: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables/live2d/natural-motion.test.ts -t "dismissed"` passes case (j) of todo 6, which is the contract this host relies on when cursor attention is off. Save it to the same log.
  Commit: Y | feat(stage-ui-live2d): keep the Natural cursor without an expiry snap and share one pointer input

- [x] 9. Play pointer events through the real classifier in the T1 sink and add T1 touch and approach scenarios
  Recommended task executor category: unspecified-high - QA tooling across the sink, new fixtures, and an assertion suite.
  What to do:
  - In `packages/qa-tools/src/motion/scenario-sink.ts`, instantiate `Live2DTouchGestures({ requireHold: false })`. For each `pointer` event:
    - Build a sample in head-width space: `scale = 1`, `x/y` from the event, and `head = { x, y, halfHeight: t1HeadHalfHeight }` (new constant `0.6`).
    - Region: `'head'` inside the true box, `'body'` inside `|x| <= 1.5 && y <= 4`, else `null`.
    - Route `move`/`down`/`up`/`leave` to `moved`/`pressed`/`released`/`cancelled`.
    - Pointer moves also set the cursor offset `{ x: p.x, y: -(p.y - (eyeAnchorShare - 0.5) * 2 * t1HeadHalfHeight) }`.
  - Each step, call `gestures.update(simTime * 1000)`.
  - Pokes push `{ region, x: clamp(x / 0.5), y: clamp(y / halfHeight) }` to `pendingPokes`. While petting, `pet` = the hand within the box; otherwise null.
  - Redefine `cursor` events as head-width offsets (y up) in the schema docs. Update any existing fixture under `packages/qa-tools/fixtures/scenarios/` that uses `cursor` events (`rg -n '"cursor"' packages/qa-tools/fixtures`).
  - Add `packages/qa-tools/src/motion/touch-scenarios.test.ts`. Build scenarios with the todo 5 builders and run them through `runT1` (`packages/qa-tools/src/motion/t1/runner.ts:62-110`; see `t1/runner.test.ts:28,66` for reading `trace.events` by `source`/`kind`). The sink already records every observer event (`scenario-sink.ts:185`), so todo 6's `attention`/`touch` events appear in `trace.events`. Assert:
    - (a) strokes plus/minus 0.3 at 1.2 head/s for 4 s at 60 Hz and at 144 Hz: exactly one `pet-start`, then one `pet-end` within 0.8 s after the strokes stop.
    - (b) plus/minus 0.6 strokes pet.
    - (c) a straight pass across the head emits no pet.
    - (d) approaches from left/right/top/bottom at 3 head/s from 8 to 0.6 head widths with seed fixed and engagement forced near: each emits notice before engage. Left and right runs (same seed) have identical attention event lists. Averaged over the final 1 s, the left run's pre-compensation `fixation.x` is < 0 and the right run's is > 0, and `headX(right) - headX(left) > 0` at the final step; this isolates the cursor's directional pull from shared autonomous motion. Top and bottom runs likewise give `fixation.y` of the matching sign.
    - (e) a poke held still emits a `touch` poke mark within 0.1 s after press + 0.09 s; a 50 ms click emits one on release.
    - (f) no frame-to-frame headX/headY jump > 0.02 across pet start and pet end.
  Must NOT do: change T1 emotion/liveliness gate logic or committed gate scenarios; touch T3 code (todo 10).
  Closes: GAP-9 (T1), IS-10 (T1)
  Parallelization: Wave 3 | Blocked by: 1, 5, 6, 7 | Blocks: 10
  References:
  - `packages/qa-tools/src/motion/scenario-sink.ts:140-270`
  - `packages/qa-tools/src/motion/t1/runner.ts:62-110`, `packages/qa-tools/src/motion/t1/runner.test.ts`
  - `packages/stage-ui-live2d/src/composables/live2d/natural-motion/trace.ts:149-151`
  - `packages/stage-shared/src/motion-scenario/{schema,builders}.ts`
  - `packages/stage-ui-live2d/src/composables/live2d/touch-gestures.ts`
  - `.agents/skills/motion-qa/SKILL.md` (levels and limitations wording)
  Acceptance criteria:
  - `pnpm -F @proj-airi/qa-tools exec vitest run src/motion/touch-scenarios.test.ts` exits 0.
  - `pnpm -F @proj-airi/qa-tools typecheck` exits 0.
  - `pnpm qa:motion gate liveliness --level t1 --fresh` reports PASS.
  QA scenarios:
  - Happy: the commands above, saved to `<attemptDir>/task-9-live2d-cursor-touch-integration.log`, including the gate run directory path.
  - Failure check: temporarily reverting todo 1's anchor change in a scratch worktree makes case (a) at 144 Hz fail. Record the failing output in `<attemptDir>/task-9-live2d-cursor-touch-integration-mutation.txt`; do not commit the revert.
  Commit: Y | test(qa-tools): replay pointer strokes, approaches, and pokes through the T1 sink

- [x] 10. Drive the real OS cursor in a rendered T3 touch run (closed after the plan run: harness ported onto the face-feature unit; Luke-approved real-pointer t3-touch PASS .temp/qa/20261024-121141-motion-t3-t3-touch incl. blush via Param85; t3-touch-pass PASS; gates st_01a16ebd; landed as 9d07b4266, d724ece9f, fd8693c67 after rebase onto main)
  Recommended task executor category: unspecified-high - cross-package QA harness work: bridge state, schema rule, a Windows pointer driver, the runner, a fixture, and verification.
  What to do:
  - In `packages/stage-shared/src/motion-scenario/bridge.ts` `MotionQaStateSchema` (lines 23-34), add `head: nullable(strictObject({ x, y, width, height }))`, the scaled head box in viewport CSS pixels. Also add `screen: strictObject({ x, y, devicePixelRatio })`: `window.screenX`, `window.screenY`, and `devicePixelRatio`.
    - The state handler lives in host-agnostic stage-ui (`packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts:91,238`, fed by `diagnostics.stageSnapshot()`). Produce both from DOM-only data there: the Live2D scene's head box (`Model.vue` head tracker / `headAnchor`, 1400-1432) mapped to the canvas client rect. No Electron invoke.
    - Update the strict state fixtures in the same commit: `packages/qa-tools/src/t3/bridge-client.test.ts:7`, `packages/stage-shared/src/motion-scenario/bridge.test.ts:50`, `dispatch.test.ts:22`.
  - In `schema.ts`, allow `pointer` events in t3 scenarios (keep refusing `cursor` and `speech`) and document that the T3 harness performs them with the OS cursor.
  - In `use-motion-qa-bridge.ts`, change the `pointer` case to `return null`. Pointer events count as dispatched and are stamped with `markCaptureEvent`, so `verifyT3Run`'s `dispatched === events.length` and event-identity checks (`packages/qa-tools/src/t3/verify-trace.ts:73-80`) hold; the harness performs the OS input.
  - Add `packages/qa-tools/src/t3/pointer.ts`, modeled on `cursor.ts`:
    - `pointerScriptCommand(steps)` builds a PowerShell script that plays timed `{ tMs, x, y, phase }` steps with `SetCursorPos` and `mouse_event` (LEFTDOWN/LEFTUP), timed with a `Stopwatch`.
    - It prints one JSON receipt: steps played, max timing error, and final `GetCursorPos`.
    - Add a valibot-parsed receipt and `pointer.test.ts` for the command builder and receipt parser.
    - Windows only; elsewhere the run refuses with exit 2.
    - Before any `down` step, the script keeps the cursor over the target for `pressDwellMs = 100`. This is the real system's timing: the stage window toggles click-through from a 60 Hz cursor poll and a pixel hit test (`apps/stage-tamagotchi/src/renderer/pages/index.vue:320-372`), and clicks only reach the canvas once the window stops ignoring mouse events.
    - The receipt records the foreground process, as `cursor.ts:37-39` does. A foreground window of an elevated process fails the run with a named reason.
  - In `run-t3.ts:150-168`, when the scenario has `pointer` events:
    - Configure `cursorAttention: scenario.events.some(event => event.kind === 'pointer')`.
    - Park the cursor first, as today.
    - Read `state.head` and `state.screen` after the bridge reports `modelLoaded`.
    - Convert head-width steps to physical screen pixels: `((screen.x + head.x + head.width / 2 + x * head.width) * dpr, (screen.y + head.y + head.height / 2 + y * head.width) * dpr)`.
    - Start the pointer script right after the bridge `runScenario` start, using `started.rendererStartMs` for alignment.
    - Park the cursor again in `finally`.
    - Record `cursorAttention` and the stage's fade-on-hover setting in `bridge.json`.
  - Add `packages/qa-tools/fixtures/scenarios/t3-touch.json` (levels `['t1', 't3']`):
    - Amendment recorded during execution (ledger `plan-amendment` task 10): the rendered approach starts at 1.9 head widths (near band), not 8. At the rendered head size an 8-head-width path cannot fit on a 1920 px desktop in either direction (attempt 2 refused it before moving the cursor). A near-band start keeps the notice-then-engage expectation deterministic. Far and medium approaches stay covered at T1 by todo 9 case (d).
    - an approach from the right (1.9 to 0.6 head widths at 3 head/s, per the amendment above);
    - 4 s of plus/minus 0.4 head-width x-strokes at 1.2 head/s at 60 Hz;
    - a 1.5 s rest;
    - a body poke and a head-top poke;
    - `screenshotsAt` during the pet and after each poke.
  - Add `t3-touch-pass.json`: a straight pass across the head only.
  - In `verify-trace.ts`, add touch expectations:
    - `t3-touch`: notice before engage, exactly one pet-start and one pet-end, two pokes, and trace `ParamCheek` (or the rig's cheek channel present in the trace) rising during the pet.
    - `t3-touch-pass`: zero pet events.
  Must NOT do: change T3 emotion/liveliness gates or their cursor-parked rule; reuse a personal Electron profile; kill processes the run did not start (see memory `reference/projects/dtuber-qa-tooling.md` PID-reuse lesson).
  Closes: GAP-9 (T3), IS-10 (rendered)
  Parallelization: Wave 4 | Blocked by: 5, 8, 9 | Blocks: 12
  References:
  - `packages/qa-tools/src/t3/{run-t3,cursor,verify-trace,launch,teardown,screenshot,args}.ts`
  - `packages/stage-shared/src/motion-scenario/{bridge,dispatch,schema}.ts`
  - `apps/stage-tamagotchi/src/renderer/main.ts:54`
  - `apps/stage-tamagotchi/src/renderer/window-context.ts:49-56`
  - `packages/electron-eventa/src/electron/screen.ts`
  - `.agents/skills/motion-qa/SKILL.md` (env vars `AIRI_QA_RIG_FORBOOTH`, undisturbed desktop)
  - `packages/stage-ui/src/composables/performance/use-motion-qa-bridge.ts:91,150-238`
  - `apps/stage-tamagotchi/src/renderer/pages/index.vue:320-372` (pixel click-through)
  Acceptance criteria:
  - `pnpm -F @proj-airi/qa-tools exec vitest run src/t3` exits 0.
  - `pnpm -F @proj-airi/stage-shared exec vitest run src/motion-scenario` exits 0.
  - `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-touch` exits 0 with its verify summary PASS.
  - `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-touch-pass` exits 0 with zero pet events verified.
  - `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke` still exits 0.
  - The t3-touch run's `verification.json` shows `dispatched === events.length` and zero `rejected`.
  - `pnpm qa:doctor` passes before the run.
  QA scenarios:
  - Happy: the t3-touch run. Copy its run dir path, the verify summary, and the screenshot paths into `<attemptDir>/task-10-live2d-cursor-touch-integration.log`. Warn Luke before the capture, because the desktop must stay undisturbed.
  - Failure check: the t3-touch-pass run proves the passing-cursor property on the rendered app; record its run dir in the same log.
  - The teardown receipt (no leftover Electron processes of this worktree) is appended to the log.
  Commit: Y | feat(qa-tools): drive the real OS cursor in a rendered touch run (plus a separate fix(stage-tamagotchi) or feat(stage-shared) commit if the bridge state change lands separately; keep each commit green)

- [x] 11. Update the ADRs and package docs for the new cursor-attention and touch contracts
  Recommended task executor category: writing - documentation of implemented contracts.
  What to do:
  - Update `docs/ai/adr/2026-10-18-live2d-touch-interaction.md` sections Gestures, Regions, and "Controller and adapter contract":
    - the anchor idle rule;
    - the slow-stroke qualification (window 1500 ms, travel 0.35);
    - the margin zone and the in-head share;
    - the hover poke commit at 90 ms;
    - the two-axis hand and stroke pitch;
    - y-aware poke direction and the faster nudge;
    - the melt-into-hand handoff replacing "passes a null cursor";
    - observer `touch` events.
  - Update `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md` cursor lines (51, 62, 153, 177 context):
    - Natural owns cursor recency; resolver `screen` attention fades instead of nulling; `aside` dismisses.
    - The Live2D.vue expiry no longer applies to Natural.
  - Add `docs/ai/adr/2026-10-24-live2d-cursor-attention.md`. It records the cross-package contract:
    - head-width eye-anchor offsets (`Model.vue` → adapter → controller → scenario `cursor` and `pointer` events);
    - the attention model (bands, probabilities, staged onset, interest span, cooldown, time constants);
    - pursuit constants;
    - Luke's D1/D2 decisions verbatim;
    - the no-random-draw-without-cursor invariant;
    - the T1/T3 QA hooks.
    Follow the house ADR style of the two ADRs above.
  - If `packages/stage-ui-live2d/README.md` describes Natural cursor behavior, update it. If `docs/assets/ai/context/ui-components.md` mentions these components' props, check it and update only if props changed.
  Must NOT do: change `.agents/` or other agent configuration (todo 12); restate code or add tuning claims not in code.
  Closes: documentation for GAP-1 to GAP-9
  Parallelization: Wave 4 | Blocked by: 6, 8 | Blocks: F1-F4
  References: the three ADR paths above; the root `AGENTS.md` ADR rules ("Put project/client ADRs in docs/ai/adr/") and prose rules (Unique Styles).
  Acceptance criteria:
  - `rg -n "passes a null cursor" docs/ai/adr` returns nothing.
  - The new ADR exists with Status accepted.
  - `pnpm lint` on the changed markdown files reports no errors (`pnpm exec eslint <files>`).
  QA scenarios:
  - Happy: rg checks and lint output, saved to `<attemptDir>/task-11-live2d-cursor-touch-integration.log`.
  - Failure check: every constant named in the new ADR matches its code value. Run a scratch script that greps each `name = value` pair in the ADR against the source and reports mismatches; PASS = zero mismatches.
  Commit: Y | docs(stage-ui-live2d): record continuous cursor attention and the touch handoff

- [x] 12. Document the touch QA commands in the motion-qa skill
  Recommended task executor category: quick - one agent-configuration doc edit, committed separately per the root rule.
  What to do: in `.agents/skills/motion-qa/SKILL.md` "Commands", add `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-touch` and `builtin:t3-touch-pass`, the T1 touch suite command, and one line saying the T3 touch run moves the real OS cursor and needs an undisturbed desktop.
  Must NOT do: mix this commit with runtime or ADR changes.
  Closes: discoverability for IS-10
  Parallelization: Wave 4 | Blocked by: 10 | Blocks: F1-F4
  References: `.agents/skills/motion-qa/SKILL.md`; root `AGENTS.md` ("Keep agent configuration changes in a separate commit/PR").
  Acceptance criteria: `rg -n "t3-touch" .agents/skills/motion-qa/SKILL.md` returns 2+ lines; `git show --stat HEAD` lists only that file.
  QA scenarios:
  - Happy: the rg output, saved to `<attemptDir>/task-12-live2d-cursor-touch-integration.log`.
  - Failure check: the `git show --stat` output proves isolation.
  Commit: Y | chore(agents): document the touch motion QA runs

- [x] 13. Make the head box that sets the cursor and touch unit reflect the visible head (follow-up found by todo 10)
  Recommended task executor category: deep-low - diagnose-then-fix in one shared module with a headless real-rig proof.
  What to do:
  - Evidence: on ForBOOTH the head box measured 573x738 CSS px at (-33, 97) in a 450x600 stage window while the rendered face is about 150 px wide (t3-smoke screenshot .temp/qa/20261024-012555-motion-t3-t3-smoke/screenshots/01-5.0s.png). The ForBOOTH watermark overlay text is the likely culprit: `createLive2DHeadTracker` selects drawables that move with ParamAngleX/Y/Z and unions their bounds regardless of visibility or opacity (packages/stage-ui-live2d/src/composables/live2d/head-anchor.ts:209-231).
  - Diagnose first with the real rig headlessly (T2 tooling in packages/qa-tools, Cubism Core in Node; see .agents/skills/motion-qa/SKILL.md T2): list the tracked drawable ids and their bounds, and show which inflate the box. Record the finding.
  - Fix in head-anchor.ts bounds(): union only drawables that are currently visible with opacity >= 0.01 (the same rule as touch-regions.ts live2DVisibleBounds); keep selection rules unchanged unless the diagnosis shows the selection itself is wrong (then fix minimally and document why).
  - Keep the presence bubble working: its placement uses the same tracker (Model.vue headAnchor); run its tests.
  - Add unit cases in head-anchor.test.ts: an invisible or transparent tracked drawable does not enlarge the box; a visible one does.
  Must NOT do: change the cursor-attention, gaze, touch-gesture, or controller logic; change settings.
  Closes: unit defect affecting IS-1, IS-2, IS-5 on ForBOOTH (blast radius of todo 7's head-width cursor unit)
  Parallelization: after todo 11 | Blocked by: - | Blocks: F1-F4
  References: head-anchor.ts:1-288 (+ head-anchor.test.ts), touch-regions.ts:1-71, Model.vue readTouchRegions/headAnchor, packages/qa-tools/spikes/t2 and src (T2 headless rig), ledger task 10 entries.
  Acceptance criteria (agent-executable): the headless ForBOOTH diagnosis shows the head box before/after (after width within 2x of the face drawables' width, recorded); `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` and typecheck exit 0; `pnpm qa:motion gate liveliness --level t1 --fresh` PASS.
  QA scenarios: happy = headless ForBOOTH box after fix (with the watermark expression both off and on, if the rig exposes it); failure = a scripted invisible tracked drawable no longer inflates the box. Evidence <attemptDir>/task-13-live2d-cursor-touch-integration.log.
  Commit: Y | fix(stage-ui-live2d): measure the head from visible drawables only

- [x] 14. Reconcile the 1 s cursor-expiry timer when the motion driver changes (F2-B1)
  Recommended task executor category: unspecified-low - one component plus a focused test.
  What to do: in packages/stage-ui-live2d/src/components/scenes/Live2D.vue (cursorPosition watch, ~134-145), also react to live2dMotionDriver changes: switching TO natural clears any pending expiry timer (Natural owns recency); switching FROM natural to another driver while a cursor is present arms the 1000 ms expiry as if the cursor just moved. Add a test covering both transitions with fake timers (vitest fake timers are deterministic; no real sleeps), in the package's existing component-test style (find how Live2D.vue or sibling scene components are tested; if none exist, extract the timer policy into a tiny pure helper next to the component and unit-test it).
  Must NOT do: change the Natural no-expiry rule, other drivers' 1000 ms value, or eye-focus props.
  Closes: F2-B1 (IS-4/IS-9 driver-switch edge)
  Acceptance criteria: the new test fails on HEAD a4bf4cb8c and passes after; `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` and typecheck exit 0; eslint on changed files 0.
  QA: happy = test both transitions; failure = revert-run shows the test red. Evidence task-14 log.
  Commit: Y | fix(stage-ui-live2d): reconcile the cursor expiry when the motion driver changes

- [x] 15. Name the remaining inline tuning values in the Natural controller (F2-B2)
  Recommended task executor category: quick - mechanical extraction in one file.
  What to do: in packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts (~339-346, 363-365, 380-381, 436-440, 484 per F2 report C:/Users/Luke/projects/dtuber/.omo/evidence/live2d-cursor-touch-integration-F2-gate-review.md) move the approach, smoothing, pet-glance, and pose tuning literals into named top-level constants, each with a one-line comment stating unit and purpose; values unchanged. Update the ADR only if it quotes a literal by a different name.
  Must NOT do: change any value or behavior.
  Closes: F2-B2
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables` (output identical pass counts to before), typecheck, eslint 0; `git diff` shows only extraction.
  Commit: Y | refactor(stage-ui-live2d): name the Natural controller tuning constants

- [x] 16. Correct the v2 ADR: disabling cursor attention sends a null cursor plus dismissal (F1-14)
  Recommended task executor category: writing - one doc sentence.
  What to do: docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md:~186 says disabling cursor attention keeps non-null cursor input; the code (Model.vue ~606-641) sends cursor null and cursorDismissed true. Fix the sentence to match; keep that screen and aside dismiss without nulling the cursor.
  Acceptance criteria: sentence matches code (quote both in the log); eslint on the doc 0.
  Commit: Y | docs(stage-ui-live2d): state that disabled cursor attention clears the cursor

- [x] 17. Name the pet-override threshold and document the new touch-gesture constants (F2 delta B2)
  Recommended task executor category: quick - comments and one extraction in two files.
  What to do: in packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts:~392 move the inline `0.5` in `this.pet.level > 0.5` into a named top-level constant (unitless pet level above which the pet owns the gaze override) next to the other pet constants; in packages/stage-ui-live2d/src/composables/live2d/touch-gestures.ts add a one-line doc comment (unit and purpose) to `pokeCommitMs`, `headMargin`, and `minInHeadShare` (lines ~35, 42-43), matching the file's existing `/** ... */` style. Values and behavior unchanged. Report: C:/Users/Luke/projects/dtuber/.omo/evidence/live2d-cursor-touch-integration-F2-delta-gate-review.md.
  Must NOT do: change any value or logic; touch other files.
  Closes: F2 delta B2
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables` pass counts identical before/after; typecheck and eslint on both files 0; `git diff` shows only the extraction and comments.
  Commit: Y | refactor(stage-ui-live2d): name the pet override threshold and document touch gesture constants

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Recommended task executor category: unspecified-high
  Check every todo's acceptance commands against the evidence logs. Every Must NOT have holds: `git diff 4e9d78fd9..HEAD --stat` shows no settings/i18n/lockfile/resolver changes; Universal paths unchanged; agent-config change isolated in its own commit. Output: APPROVE or a list of `- [ ] N.` rows.
- [x] F2. Code quality review
  Recommended task executor category: unspecified-high
  Review the full diff against `.agents/skills/enforce-rules-for-typescript/SKILL.md` and `.agents/skills/enforce-rules-for-vitest/SKILL.md`:
  - no `any`; named constants with comments;
  - no compatibility shims left (todo 4 defaults and the old `gaze.setCursor` gone);
  - no fixed sleeps in tests;
  - `// NOTICE:` format on any workaround;
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck`, `pnpm -F @proj-airi/qa-tools typecheck`, and `pnpm -F @proj-airi/stage-shared typecheck` green.
  Output: APPROVE or rows.
- [x] F3. Real manual QA
  Recommended task executor category: unspecified-high
  Run, record PASS/FAIL, and save each run dir under `.omo/evidence/live2d-cursor-touch-integration/final/`:
  - `pnpm verify`
  - `pnpm qa:test --all` (no new failures against the empty known-failures registry)
  - `pnpm qa:motion gate liveliness --level t1 --fresh`
  - `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke`
  - `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-touch`
  - `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-touch-pass`
  Then a live check in `pnpm dev:tamagotchi` with a temporary profile and ForBOOTH, driving the OS cursor with the todo 10 pointer driver:
  - approach from the far left and from the far right at slow (0.5 head/s) and fast (6 head/s) speeds;
  - a 144 Hz-equivalent stroke path;
  - a poke.
  Save screenshots and parameter samples. Tear down the app and record a read-back receipt. The report states the motion-qa limitations wording and that naturalness is Luke's T4 call.
- [x] F4. Ideal-state fidelity
  Recommended task executor category: unspecified-high
  Map the delivered behavior to IS-1..IS-10 one-to-one using the Success criteria table and the F3 evidence. Any row without a passing scenario becomes a new `- [ ] N.` row, never a note.

## Commit strategy
- One Conventional Commit per todo, matching the history style (`fix(stage-tamagotchi): ...`, `feat(stage-ui-live2d): ...`), with no gitmoji. Todos 6 and 7 land as one commit because they share a signature change; every commit typechecks and passes its package tests on its own.
- ADR updates (todo 11) go in their own docs commit after the code they describe, on the same branch. The agent-configuration change (todo 12) gets its own `chore(agents)` commit.
- Work on a worktree branch `luke/feat/live2d-cursor-touch` created with `pnpm wt new live2d-cursor-touch`. Run long verify runs there (memory: an outside process switched the main checkout mid-verify). Do not push or merge without Luke's okay.
- Final commit footer: `Plan: .omo/plans/live2d-cursor-touch-integration.md`.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 2, 6, 7 | todo 2 cases (a)(a2) radial map and distance gain; todo 6 cases (b) far episodes and (d2) weaker far pull; F3 live approach from the far left and far right | task-2 log, task-6 log, F3 evidence |
| IS-2 | 2, 6, 9 | todo 2 cases (b)(c); todo 6 cases (a)(e); todo 9 case (d) four-side approaches | task-2, task-6, task-9 logs |
| IS-3 | 3, 6 | todo 3 cases (a)(b)(c)(d); todo 6 probe max eye speed | task-3 log, task-6 probe |
| IS-4 | 2, 6, 8 | todo 2 case (d); todo 6 cases (g) and (l) real 3 s resolver timing, and the updated expiry test (199); todo 8 Live2D.vue no-timeout rg check | task-2, task-6, task-8 logs |
| IS-5 | 1, 8, 9 | todo 1 cases (a)-(d) at 30/60/144/240 Hz; todo 9 cases (a)(b)(c) | task-1 log and probe, task-9 log |
| IS-6 | 6, 9, 10 | todo 6 cases (c) and (d) descending-hand tuck; todo 9 case (f); todo 10 t3-touch verify (single pet-start/end, screenshots) | task-6, task-9, task-10 logs |
| IS-7 | 4, 7 | todo 4 case (b); todo 7 hand y wiring typecheck and adapter fixtures | task-4, task-7 logs |
| IS-8 | 1, 4, 6, 8, 9 | todo 1 cases (e)(f)(g); todo 4 cases (c)(e); todo 6 case (i); todo 9 case (e); todo 10 two pokes | task-1, task-4, task-6, task-9, task-10 logs |
| IS-9 | 6, 7, 9, F3 | unchanged equivalence tests (213, 627, 781) and todo 6 case (j) dismissed equivalence; T1 liveliness gate PASS; t3-smoke PASS; stage-web/tamagotchi/kirie typecheck | task-6, task-8, task-9 logs, F3 run dirs |
| IS-10 | 5, 9, 10, 12 | todo 5 schema cases; todo 9 suite; todo 10 t3-touch and t3-touch-pass runs | task-5, task-9, task-10, task-12 logs |
