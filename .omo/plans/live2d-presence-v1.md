# live2d-presence-v1 - Work Plan

> **Closed 2026-10-22 as superseded by `live2d-presence-v2`.** v2 replaced the controller that row 5 and F1-F4 would have tested, and v2 rows 14, 23 and 24 covered the same rendered scenarios. See `docs/ai/audits/2026-10-22-workstream-audit.md`, decision D2.

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** Your desktop companion gains a quieter, more inhabited motion option focused on its head, body, and eyes.

**What you'll get:** An opt-in Natural mode with optional cursor attention. Existing movement modes remain available.

**Why this approach:** Persistent resting poses and coordinated small adjustments avoid constant wandering. Existing model physics supplies secondary movement.

**What it will NOT do:** It will not copy the recordings, train a model, switch into wiggle automatically, or add speech and game reactions.

**Effort:** Medium
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** Medium - convincing motion depends on visual tuning and the rig's existing physics.
**Decisions to sanity-check:** Natural is opt-in. Cursor attention is optional. Existing modes and settings remain intact.

Your next move: review the completed plan and its review receipt, then start execution separately when ready. Full execution detail follows below.

---

> TL;DR (machine): Medium effort, medium risk, eight implementation tasks, four final checks, opt-in Natural motion with cursor coexistence.

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected user:** Luke keeps a Live2D companion in a screen corner during work and gaming.
The first iteration must feel inhabited through head, body, and eye movement.
The recordings establish the visual target. They are not a replay, training, or statistical-matching requirement.
The shared renderer also serves web clients. Existing motion choices remain available.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Natural mode has persistent rests, small adjustments, and coordinated gaze. | Constant wandering and repeated gestures miss the requested texture. |
| IS-2 | Cursor attention is optional, and Universal/MAGIC remain selectable. | The user explicitly retained existing movement options. |
| IS-3 | Natural respects both rigs and existing parameter owners. | Duplicate focus or physics destroys the intended movement. |
| IS-4 | Pause, interruption, model replacement, and mode changes have clean lifecycles. | Pops and catch-up motion break presence. |
| IS-5 | Actual moving models pass a corner-size visual rubric. | Unit tests cannot establish perceived aliveness. |
| GAP-1 | Current idle focus selects unrelated gaze targets without persistent posture. | It lacks a quiet posture baseline. |
| GAP-2 | Settings expose only Universal and MAGIC. | Natural needs an explicit opt-in choice. |
| GAP-3 | SDK focus and physics run after AIRI motion-manager plugins. | A final-plugin-only implementation can be overwritten or doubled. |
| GAP-4 | Manual pose ownership also writes mouth and eyelids. | Presence must not take over unrelated facial channels. |
| GAP-5 | Neither target rig has visual acceptance for Natural. | Different physics ownership requires real model checks. |

### Must have
- Add `natural` to `Live2DMotionDriver`. Keep the stored key and default `universal`.
- Add one persisted Natural-only cursor toggle, default true.
- Keep Universal and MAGIC behavior and saved configuration available.
- Own only head XYZ, body XYZ, and eye-ball XY in Natural.
- Keep existing blink, expression, lipsync, breath, and model physics ownership.
- Use the existing cursor coordinate conversion and model eye offsets.
- Use one renderer-local controller per loaded model.
- Validate ForBOOTH and Bear Pajama through the running desktop application.
- Cover shared settings at desktop and mobile widths.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No automatic switch to wiggle, beat mode, Universal, or MAGIC.
- No recordings, private model files, generated model ZIPs, or screenshots in a public commit.
- No recording replay feature, model training, new dataset, or statistical-imitation target.
- No new runtime dependency, service, paid API, or per-frame LLM call.
- No speech choreography, emotion scheduler, game integration, desktop perception, or arm choreography.
- No generic behavior framework, new cross-window motion bus, or whole-pose manual-store reuse for Natural.
- No extra physics pass, post-physics pose overwrite, or runtime rig modification.
- No new public component props solely for Natural. Read the existing Live2D settings store inside Model.vue.
- No changes to unrelated dirty files, deleted documentation, or other agents' work.

### Accepted decisions
- User selected **Natural mode + cursor** and approved the approach.
- Natural is opt-in. Existing saved driver selections are not migrated or reset.
- The first iteration has no user-facing tuning sliders.
- Test strategy is tests-after within each implementation task, followed by real rendered QA.
- Desktop is primary. Shared web settings receive layout and behavior coverage.
- Keep the mechanism local to `packages/stage-ui-live2d`. Do not create a new package.

### Source evidence
Line numbers describe the planning baseline. Re-read scoped files before implementation.

| Reference | Verified contract |
| --- | --- |
| `packages/stage-ui-live2d/src/composables/live2d/live2d.ts:4-12` | Driver selection and existing settings defaults |
| `packages/stage-ui-live2d/src/components/scenes/Live2D.vue:103-120,163-172` | Cursor conversion, one-second source expiry, and Universal gating |
| `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:354-386,428-480,900-906` | Loader, SDK breath removal, plugin ordering, and focus forwarding |
| `packages/stage-ui-live2d/src/composables/live2d/motion-manager.ts:134-184,711-734` | Plugin phases and complete manual-pose ownership |
| `packages/stage-ui-live2d/src/composables/live2d/motion-control-spring.ts:64-109` | Manual spring output remains active during its release tail |
| `packages/stage-ui/src/components/scenes/Stage.vue:105-142` | MAGIC starts only when selected, unpaused, and not exclusively controlled |
| `packages/stage-ui/src/features/motions/live2d/view-target.ts:26-40` | Existing normalized head-compensated gaze convention |
| `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:51-62,354-450` | Driver selector and mode-specific settings |
| Installed `pixi-live2d-display/dist/cubism4.es.js:5416-5444` | Motion, save, expression/blink, focus, natural movement, physics, pose, draw, restore |
| Installed `pixi-live2d-display/types/index.d.ts:515-540,4641-4686` | Motion priority and public `updateFocus()` |
| Installed `pixi-live2d-display/dist/cubism4.es.js:4893-4901,1166-1176` | Existing focus normalizes to a unit-circle direction; loadParameters restores the pre-focus snapshot |
| `apps/stage-tamagotchi/src/main/index.ts:86-89` | `APP_USER_DATA_PATH` supports isolated desktop QA |
| `apps/stage-tamagotchi/src/main/app/debugger.ts:8-18` | Debugger startup environment variables |
| `apps/stage-tamagotchi/vitest.config.ts:55-75` | Chromium tests load the shipped Cubism runtime |

### Model evidence and limits
- ForBOOTH metadata lists 281 parameters and 58 physics groups.
- ForBOOTH uses separate head/body physics outputs. Do not write those output IDs.
- Bear metadata lists 176 parameters and 30 physics groups.
- Bear physics writes `ParamBodyAngleX/Y/Z` from head inputs.
- Natural writes its standard input pose before physics. Bear's body physics remains authoritative afterward.
- Do not infer independent body control from a standard parameter name.
- Both rigs must retain their original physics files and settings.
- Local rig directories:
  - `C:/Users/Luke/Documents/Live2d Models/ForBOOTH-231-Holder-only@Do-not-share-or-resell/ForBOOTH-231-Holder-only@Do-not-share-or-resell`
  - `C:/Users/Luke/Documents/Live2d Models/bear Pajama V1.1/bear Pajama V1.1`
- The reference recordings contain API-reported model parameters, not pure face-tracker inputs.
- They contain no video. Their neutral-reset sections and declared 60 Hz rate are not motion targets.
- Do not require a new replay experiment before implementing this approved first iteration.

### Motion mechanism and exact contracts

#### Local controller
Add `src/composables/live2d/natural-motion.ts` in stage-ui-live2d.
Use a lifecycle-owning class named `Live2DNaturalMotion`.
Keep its types internal to this module and its adapter. Do not export it from the package barrel.

Its output is eight normalized axes: `headX/Y/Z`, `bodyX/Y/Z`, and `eyeX/Y`.
Return filtered fixation XY alongside those axes as adapter metadata, not extra model parameters.
The class accepts a random source at construction and explicit monotonic seconds in its methods.
Use `Math.random` in production. Tests supply a deterministic sequence.
Use `advance(nowSeconds)`, `setCursor(targetOrNull, nowSeconds)`, and `setSuspended(suspended, nowSeconds)`.
The adapter advances the controller before changing a target at the same timestamp.
The class stores no Vue refs, model objects, browser timers, or animation-frame handles.

The controller retains:
- A posture target `p` with three values in `[-1,1]`.
- A fixation target with two normalized values.
- Two follower states, `u` and `x`, per head, body, and fixation axis.
- Next primary deadline and at most one follow-up deadline.
- The follow-up destination, cursor target, suspension state, and last timestamp.

Initialize posture and fixation at zero. Initialize follower states at zero.
The renderer blend hides initialization rather than copying physics output into this state.
Schedule the first primary adjustment after 1.4 active seconds.

At each primary deadline:
1. Draw a three-axis destination `r` uniformly from `[-1,1]`.
2. Draw `a` uniformly from `[0.25,0.60]`. Set `p = (1-a)*p + a*r`.
3. With probability 0.35, set fixation to `0.4*p.xy`. Otherwise retain the previous fixation.
4. With probability 0.45, schedule one follow-up after uniform `[0.18,0.40]` seconds.
5. Draw its strength `b` uniformly from `[0.08,0.20]` when scheduling it.
6. At that follow-up, set `p = (1-b)*p + b*r`. Do not change fixation.
7. Schedule the next primary deadline after `0.9 + quietSeconds`.
8. Choose quietSeconds from `[5,9]` with probability 0.15, otherwise `[1.3,4.5]`.

Draw random values only at these events. Use a documented fixed draw order.
Advance analytically to each intervening deadline before applying its target change.
The new posture remains the resting posture. Do not schedule a return to neutral.

| Axis | Target without cursor | Follower tau, seconds |
| --- | --- | --- |
| Head X/Y/Z | `p * [0.36,0.24,0.30]` | `[0.14,0.17,0.19]` |
| Body X/Y/Z | `p * [0.30,0.18,0.24]` | `[0.32,0.36,0.38]` |
| Fixation X/Y | Retained fixation target | `[0.024,0.028]` |

For a constant target `g`, integrate one axis exactly:

```text
h = dt / tau
e = exp(-h)
uNext = g + (u - g) * e
xNext = g + ((x - g) + (u - g) * h) * e
```

Both assignments use the old states. Velocity is `(u-x)/tau`.
This preserves position and velocity when a target changes.
Do not replace this with per-frame lerp or an underdamped oscillator.

#### Cursor and eyes
Keep `useLive2DEyeFocusFor` as the coordinate conversion owner.
Do not derive eye position from desktop dimensions again.
Use its focusAt point and the loaded model's public `toModelPosition` conversion.
In Model.vue, reuse one Pixi Point rather than allocate one each frame.
Convert the local point into `tx = localX/originalWidth*2-1` and `ty = localY/originalHeight*2-1`.
Natural uses `c = [clamp(tx,-1,1), clamp(-ty,-1,1)]`.
This preserves distance from the model center and maps the center to zero.
Do not use the SDK's radial unit-circle normalization for Natural.
Leave Universal's existing `model.focus()` call unchanged.

When Natural cursor attention is enabled and the source is active:
- Set fixation target to `0.65*c`.
- Add `[0.25*c.x,0.20*c.y,0]` to the head target.
- Add `[0.08*c.x,0,0]` to the body target.
- Keep posture scheduling active. Cursor attention does not switch modes.

When the source expires or the toggle turns off, restore the retained autonomous fixation target.
Do not reset followers or posture. Reuse the existing one-second source-expiry policy.
When disabled, cursor changes must have no effect on Natural output.

Calculate eye direction from filtered fixation minus the commanded normalized head XY.
Clamp eye direction to `[-0.95,0.95]`.
During a renderer handoff, use the blended commanded head for this compensation.
Blend head/body first. Then derive Natural eyes from the returned fixation minus blended head.
Blend those eyes with the normal-path eyes using the same weight.
Do not reconstruct fixation from already-clamped eye output.
Compensation is approximate for a 2D rig, not a promise of exact world-space fixation.
Extreme reversals can saturate eyes briefly. Persistent saturation fails visual QA.

#### Renderer adapter and precedence
Add `src/composables/live2d/natural-motion-adapter.ts`.
Its lifecycle belongs to the loaded model in Model.vue.
Use the public SDK `updateFocus()` method as the composition seam.
Retain and restore the original method, including its receiver.
Add the public method to the existing narrowed Cubism4 runtime type without a type assertion or error suppression.
Use the existing motion-manager hook to latch the frame's SDK time in seconds.
Do not multiply or divide that timestamp again.

The adapter reads current settings, cursor-source activity, manual state, and the manual spring output.
Do not step the manual spring twice. Its existing final plugin remains its only step owner.
Natural is eligible only when:
- The selected driver is `natural`.
- No exclusive manual owner exists.
- Manual control and its spring release tail are inactive.
- No explicit non-idle model motion is playing.

Classify the SDK idle group and saved selected-runtime idle group as idle, using the existing definition.
A non-idle motion with priority above IDLE suspends Natural, including a body-tap motion.
Do not treat a forced saved idle loop as an explicit performance.

When Natural is selected:
- Disable automatic idle playback and the old idle-eye generator through existing scene flags.
- Stop an already-running configured idle loop once on entry.
- Do not stop a playing non-idle explicit motion on entry.
- Preserve saved idle settings and selected motion keys.
- Gate the existing idle-setting watcher so entering Natural does not stop a non-idle explicit motion.

When Natural yields:
- Suspend its autonomous scheduler and cancel the pending follow-up.
- Retain its posture target and follower state.
- Fade its contribution out in 0.20 seconds.
- Do not block or delay the existing manual/explicit-motion command.

When Natural becomes eligible again:
- Resume from retained state with a fresh 1.4-second primary hold.
- Fade its contribution in over 0.45 seconds.
- Do not restart at neutral.

At zero Natural weight, call the original SDK focus path unchanged.
At full Natural weight, replace only the eight owned channel writes.
During a transition, evaluate the normal focus path and blend its channel values with Natural.
Keep physics and pose processing after this composition.
Never write the composed pose again in `beforeModelUpdate`.
Never feed post-physics results into the posture controller.
At full Natural weight, beat-sync head writes remain in the normal path but have no visible contribution.
Do not make beat sync an automatic Natural interrupter. The user rejected automatic wiggle switching.
The SDK saves parameters before the wrapper and restores them after drawing.
Therefore, Natural's late writes must never be added to that saved snapshot.
Test two consecutive frames to prove that Natural does not feed the preceding beat spring or accumulate offsets.

Map each normalized command through the parameter's actual default and available min/max range.
Use the positive range above default for positive values, and the negative range below default for negative values.
Cache indices and ranges once per loaded model. Skip absent parameters without creating synthetic parameter IDs.
Skip zero-width parameter ranges. Do not divide by a zero range when converting normal values for blending.
Do not assume captured API values outside declared bounds are valid Natural targets.
At full Natural weight, every owned write remains within the model's declared range.

Keep the initial implementation's eight-channel ownership fixed.
Do not introduce a configurable channel graph or new model-profile file format.
Document the SDK seam with the repository's NOTICE comment, including removal conditions.

#### Interruptible blending
Retain blend weight `w`, its derivative, destination, start time, and duration.
Use cubic Bezier control points `[w, w + velocity*D/3, destination, destination]`.
Choose D as the nominal duration or the largest smaller value that keeps the second point in `[0,1]`.
If velocity is zero, use the nominal duration.
Evaluate the current weight and derivative before redirecting a transition.
If weight already equals its destination and velocity is zero, finish immediately.
A transition ends exactly at zero or one, restoring exact legacy behavior at zero.
Do not promise to smooth discontinuities already introduced by another source.

#### Pause and teardown
Use SDK frame time for visible advancement and an active-time clock for scheduling.
Pause the active clock when the renderer is paused or document visibility is hidden.
On resume, rebase the frame timestamp without consuming the hidden interval.
An ordinary visible stall advances through scheduled events analytically.
Do not cap visible elapsed time to 50 ms or consume random values once per rendered frame.
Model replacement creates a new instance. It does not retain the previous rig's values.
Remove visibility listeners and restore the original focus method before destroying the model.
No additional RAF loop, timer, worker, subscription bus, or cross-window pose broadcast is needed.
Use one visibilitychange listener per loaded adapter and remove it during disposal.
Do not copy the existing manual spring's elapsed-time cap into the Natural clock.

#### Settings contract
Extend `Live2DMotionDriver` with `'natural'`.
Add `live2dNaturalCursorAttention` under `settings/live2d/natural-cursor-attention`, default true.
Include it in the existing resetState function.
Universal's eye-tracking flag remains independent and retains its saved value.

Add Natural to the existing driver selector.
When Natural is selected, show its cursor toggle and the existing eye-offset controls when enabled.
Disable Universal-only idle-eye and idle-motion controls without clearing their values.
Keep blink and expressions available.
MAGIC continues to use its own panel and existing ownership lifecycle.
Add English strings only in `packages/i18n/src/locales/en/settings.yaml`.
Use existing shared controls and styling. Do not redesign the settings page.

#### Tuning boundary
The numeric gains and timing above are initial implementation values, not measured perceptual truths.
Rendered QA can tune these constants within the same mechanism and eight-channel scope.
Any tuning change must identify the observed defect and rerun affected deterministic checks and the same visual scenario.
Do not add features to compensate for a failed visual result.
Stop when the rubric passes on both rigs. Do not add a polish phase afterward.
The existing idle-disable blink path is not a cleanup target. Preserve it unless Natural introduces a demonstrated regression.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after, Vitest Node and Chromium projects at existing package boundaries.
- Keep evidence under `.omo/evidence/live2d-presence-v1/`, local only.
- Read tests before edits. Do not pin prose or hide a failing test with mocks.
- Use explicit clocks, deterministic random sequences, and event-driven asynchronous assertions.
- No fixed sleeps in tests. Recording duration is itself the timed behavior in visual QA.
- Run LSP diagnostics on touched source before builds.
- Run related tests, affected workspace typechecks, root typecheck for the exported driver union, lint, and diff checks.
- Record pre-existing failures without changing unrelated code to silence them.
- A screenshot alone cannot prove motion. Capture OS video and inspect frame sequences from it.
- Mathematical tests do not prove the visual rubric. Record both forms of evidence.
- Natural works in shared web scenes too. Do not add platform gating.

### Exact command set
Run commands from `C:/Users/Luke/projects/dtuber`.

```powershell
pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion.test.ts src/composables/live2d/natural-motion-adapter.test.ts
pnpm -F @proj-airi/stage-ui-live2d exec vitest run
pnpm -F @proj-airi/model-driver-magic-live2d exec vitest run
pnpm -F @proj-airi/stage-ui exec vitest run --project node src/features/motions/live2d/use-live2d-motion-magic.test.ts src/features/motions/live2d/view-target.test.ts
pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings/live2d.browser.test.ts
pnpm -F @proj-airi/stage-ui-live2d typecheck
pnpm -F @proj-airi/stage-ui typecheck
pnpm -F @proj-airi/stage-tamagotchi typecheck
pnpm typecheck
pnpm lint
git diff --check
```

Run the complete affected stage-ui suite before final handoff because shared settings behavior changes:
`pnpm -F @proj-airi/stage-ui test:run`.
Do not add a new test runner or modify workspace configuration for this task.

### Desktop QA setup
The executor reads the computer-use and AIRI model-import skills before driving the desktop.
Use OS-level input and screenshots for Electron.
CDP can inspect runtime state, but cannot replace desktop evidence.

Create private temporary ZIPs from the two nested model directories with PowerShell Compress-Archive.
Use these exact destination names under a task-owned temporary directory:
`forbooth-presence-qa.zip` and `bear-presence-qa.zip`.
Do not modify the source directories or publish the ZIPs.

Launch through a monitor, with isolated application data:

```powershell
$env:APP_USER_DATA_PATH="$env:TEMP\airi-presence-v1-qa"
$env:APP_REMOTE_DEBUG="true"
$env:APP_REMOTE_DEBUG_PORT="19322"
$env:APP_REMOTE_DEBUG_NO_OPEN="true"
pnpm -F @proj-airi/stage-tamagotchi dev
```

If that temporary directory already exists from another run, choose a new task-owned suffix and record it.
If port 19322 is occupied, do not kill its owner. Choose and record an unused port.
Register readiness through a monitor, not a polling turn.
Identify the owned Electron windows from the launched process and their visible titles.
Use `computer({action:"capabilities"})` before any OS input.
Use `computer({action:"call",chain:[{method:"window",args:[{app:"AIRI"}]},{method:"screenshot"}]})` for the visible application.
If the application label differs, bind the discovered owned window identity and record that concrete invocation before acting.
Capture the action log, window identity, OS screenshot, application console errors, and cleanup receipt.

Navigate to Settings > Models, import the first ZIP through the real file chooser, and select Natural.
Repeat all two-rig scenarios with the second ZIP.
Keep the avatar at a representative corner size, approximately 320-480 pixels tall.
Do not change a user's existing application profile, model selection, cookies, or caches.

FFmpeg is installed on the planning workstation.
Capture the owned window with `ffmpeg -f gdigrab -framerate 30 -i "title=AIRI" -t 120 -c:v libx264 -pix_fmt yuv420p .omo/evidence/live2d-presence-v1/forbooth-quiet.mp4`.
Replace only the discovered window title when necessary and record the exact executed command.
For Bear, use `bear-quiet.mp4`. For interaction scenarios, use their scenario names and `-t 30`.
Start every capture through a monitor and keep the window visible and unobscured.
Use `ffprobe -v error -show_entries format=duration -of json` on each capture.
Inspect timestamps and full-resolution frame strips from movement intervals, plus quiet rests.
Use `read` to view the extracted images. Reject blank, occluded, or misframed recordings.
Do not infer a PASS from an MP4 merely existing.

### Visual rubric
For each model, mark each item PASS or FAIL with video timestamps and image evidence:
- At least three distinct settled, nonneutral head postures appear during the two-minute quiet capture.
- Short adjustments alternate with quieter rests. The model does not continuously sweep or nod.
- Eyes visibly change or retain attention while the head moves. They are not rigidly glued to the head.
- Body response remains restrained, with model-authored follow-through intact.
- Cursor entry, reversal, and expiry do not snap to neutral or leave eyes pinned at their limit.
- Mode/manual/explicit-motion handoff does not show competing pose writers or a visible pose pop.
- Blink, expressions, mouth movement, and speech closure retain their existing behavior.
- Pause/resume and model replacement do not create a burst of catch-up movement or stale rig output.

The first four items are perceptual judgments. The executor must inspect actual moving evidence.
Do not replace them with arbitrary numerical naturalness scores.
If the behavior still reads as mechanical pose hopping, mark FAIL and tune the existing mechanism.
If this mechanism cannot satisfy the rubric, report the concrete limitation instead of declaring success.

## Execution strategy
### Parallel execution waves
One implementation wave contains eight tasks with explicit dependencies, followed by final verification.
The scope is intentionally small. Do not split it into new packages to increase parallelism.

- Task 1: deep-low, pure temporal mechanism and its deterministic tests.
- Task 2: deep-low, renderer integration after Task 1.
- Task 6: quick, remove newly observed controller-test assertion overhead after the Task 2 producer commit.
- Task 7: quick, correct local evidence lint before the final Task 2 gate.
- Task 3: visual-engineering, settings and English copy after Tasks 2 and 6.
- Task 4: deep-low, ownership and lifecycle regression coverage after Tasks 2 and 3.
- Task 8: deep-low, align the isolated QA source with the current workspace before native acceptance.
- Task 5: lead, actual desktop motion QA and bounded tuning after Tasks 4 and 8.
- Do not parallelize tasks that edit Model.vue, Live2D.vue, or the same settings store.
- Independent review-only final checks can run in parallel after all implementation tasks.
- The execution lead owns manual QA, artifact inspection, and the final completion judgment.

Implementation skills to load when their workflow runs: TypeScript rules, Vue best practices, Vitest rules, UnoCSS rules, i18n guidance, computer-use, and AIRI model import.
Do not load unrelated skills or spawn an implementer during this planning session.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | None | 2 | None |
| 2 | 1,6,7 for final gate | 3,4 | None |
| 6 | 1; Task 2 producer available | 2,3,4 | None |
| 7 | 1; Task 2 evidence available | 2,4 | None |
| 3 | 2,6 | 4 | None |
| 4 | 2,3 | 5 | None |
| 8 | 4 | 5 | None |
| 5 | 4,8 | F1-F4 | None |
| F1-F4 | 1-8 | Final delivery | Each other, read-only except lead QA |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Implement the local Natural motion controller and deterministic tests
  - Recommended task executor category: deep-low - the temporal contract is specified above and can be checked numerically.
  - What to do: add `natural-motion.ts` and `natural-motion.test.ts` under stage-ui-live2d composables.
  - Implement the posture scheduler, exact followers, cursor target changes, suspension, and normalized eye output.
  - Must NOT do: add Vue/store dependencies, mouth/eyelid axes, per-frame randomness, a new package, or a learned generator.
  - Closes: GAP-1 and the generator portion of GAP-4.
  - Parallelization: implementation wave, blocked by none, blocks Task 2.
  - References: mechanism contract above; `animation.ts:12-31`; `motion-control-spring.ts:64-109`; `view-target.ts:26-40`.
  - Acceptance: same seed and timestamped input changes produce equal output at common times across 30,60,144 Hz and irregular schedules.
  - Acceptance: controller targets and output stay bounded, target changes preserve position/velocity, and long holds retain nonneutral posture.
  - Acceptance: suspension cancels follow-up work and resumes with a fresh hold without replaying hidden elapsed time.
  - QA happy: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion.test.ts -t "preserves posture and frame partition invariance"`.
  - QA edge: the same command with `-t "preserves continuity through cursor reversal and suspension"`.
  - Binary PASS: assertions verify complete numeric trajectories with tolerance 1e-9, bounded outputs, and deterministic event counts.
  - Include cursor-disabled input changes, visible long frames, events exactly on deadlines, and repeated suspension.
  - Evidence: `.omo/evidence/live2d-presence-v1/task-1-controller.txt`.
  - Commit: Y, `feat(stage-ui-live2d): add natural posture and gaze controller`.

- [x] 6. Remove controller test timing sensitivity without weakening coverage
  - Recommended task executor category: quick - a bounded test-only change removes repeated matcher overhead.
  - Discovered during Task 2: the new controller partition test exceeded its 5000 ms limit under concurrent check load.
  - What to do: change only `natural-motion.test.ts` to aggregate finite/bounds observations across every existing sampled frame.
  - Keep all frame schedules, timestamps, pose axes, bounds, trajectory comparisons, suspension cases, and tolerance unchanged.
  - Assert the aggregate after sampling instead of constructing two Vitest matchers for every value of every frame.
  - Must NOT do: raise timeouts, reduce frames, remove assertions' meaning, skip tests, or alter production code.
  - Closes: a flaky-tests regression introduced by Task 1.
  - Parallelization: implementation wave, blocked by 1 and the Task 2 producer commit, blocks final Task 2 verification and Tasks 3 and 4.
  - References: `natural-motion.test.ts`, `task-2-adapter.md` timing-failure evidence, and the original Task 1 probe.
  - QA happy: run the unchanged targeted controller test command and the direct-source probe.
  - QA edge: run the complete default stage-ui-live2d suite while its package typecheck runs, matching the observed contention scenario.
  - Binary PASS: all tests and probe assertions pass in one run, with the original timeout and coverage intact.
  - Capture before/after test duration as supporting evidence, not a new timing assertion.
  - Evidence: `.omo/evidence/live2d-presence-v1/task-6-test-runtime.md`.
  - Commit: Y, `test(stage-ui-live2d): remove natural motion matcher overhead`.

- [x] 7. Correct local QA evidence lint without suppressions
  - Recommended task executor category: quick - format three local evidence artifacts without changing production behavior.
  - Discovered during Task 2: root lint reports 16 errors in task-1-probe.ts, task-2-probe.ts, and task-1-verified.md.
  - What to do: use stdout writes for probe JSON, add the required class-member spacing, and pretty-format the recorded JSON block.
  - Keep all probe assertions, output data, command receipts, and historical failures intact.
  - Must NOT do: suppress lint rules, ignore the evidence directory, delete a failing artifact, or modify product code.
  - Closes: local evidence lint failures introduced by this execution.
  - Parallelization: implementation wave, blocked by 1 and existing Task 2 producer evidence, blocks final Task 2 verification and Task 4.
  - References: task-2-adapter.md recovered root lint locations.
  - QA happy: run both actual Bun probes and scoped ESLint on the three evidence files.
  - QA edge: run the original root pnpm lint command with no new ignore or suppression.
  - Binary PASS: both probes preserve their asserted results and root lint exits zero, with unrelated existing warnings reported.
  - Evidence: .omo/evidence/live2d-presence-v1/task-7-evidence-lint.md.
  - Commit: N, local evidence remains uncommitted.

- [x] 2. Compose Natural before SDK physics with explicit lifecycle ownership
  - Recommended task executor category: deep-low - integration follows the verified SDK order and existing lifecycle.
  - What to do: add `natural-motion-adapter.ts` and `natural-motion-adapter.test.ts`.
  - Update Model.vue, Live2D.vue, and live2d.ts only where the approved driver contract requires it.
  - Add the driver union value and Natural cursor setting, retaining the existing default and saved keys.
  - Read the driver setting inside Model.vue rather than adding a new public component prop.
  - Install the scoped updateFocus wrapper, map real parameter ranges, and restore the wrapper on disposal.
  - Implement the blending, explicit-motion/manual precedence, configured-idle suppression, and pause rules above.
  - Continue calling the existing manual spring exactly once per frame.
  - Restore Universal's configured idle behavior when returning to Universal. Do not clear saved selections.
  - Must NOT do: change MAGIC generation, add a physics pass, write output-only parameter IDs, or bypass existing expressions/lipsync.
  - Closes: GAP-3, GAP-4, and lifecycle portions of GAP-2.
  - Parallelization: implementation wave, blocked by 1, blocks 3 and 4.
  - References: Model.vue:385-480,866-906; motion-manager.ts:134-184,711-799; installed SDK update loop and declarations.
  - Acceptance: full Natural owns only eight channels, normal SDK focus does not double-add, and physics sees the composed inputs once.
  - Acceptance: zero Natural weight preserves legacy focus output exactly.
  - Acceptance: missing parameters are skipped, asymmetric ranges are honored, and nonzero defaults are preserved.
  - QA happy: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion-adapter.test.ts -t "composes natural input before one physics pass"`.
  - QA edge: the same command with `-t "releases ownership across interruption and model replacement"`.
  - Binary PASS: final parameter values, call order, untouched mouth/eyelids, exact legacy output, and restored methods/listeners match assertions.
  - The fake model must simulate the real update order, including save/load and late SDK focus. A mocked plugin-call assertion is insufficient.
  - Test Bear-style body overwrite and ForBOOTH-style separate physics outputs without requiring private assets.
  - Test explicit non-idle clip priority in the SDK-order integration fixture, including interruption during a Natural blend.
  - Test that cursor center maps to zero and cursor distance does not collapse to a constant unit-circle target.
  - Evidence: `.omo/evidence/live2d-presence-v1/task-2-adapter.txt`.
  - Commit: Y, `feat(stage-ui-live2d): integrate natural motion ownership`.

- [x] 3. Expose opt-in Natural and its cursor toggle in shared settings
  - Recommended task executor category: visual-engineering - this changes a shared settings interaction and layout.
  - What to do: update shared model-settings/live2d.vue, its browser test, and English settings.yaml.
  - Add Natural to the existing selector and show the Natural-only cursor toggle.
  - Keep Universal/MAGIC controls and stored values intact. Gate controls according to the settings contract.
  - Update live2d.test.ts for the new setting/reset behavior without weakening existing defaults.
  - Create `packages/stage-ui-live2d/README.md` with purpose, usage, when to use, and when not to use.
  - Document Natural's scope, the retained old modes, and its model-physics limitation there.
  - Must NOT do: add tuning sliders, change other locales, redesign settings, or restore unrelated deleted documentation.
  - Closes: GAP-2.
  - Parallelization: implementation wave, blocked by 2 and 6, blocks 4.
  - References: shared live2d.vue:51-62,354-450; live2d.ts:4-65; live2d.test.ts:27-72; existing live2d.browser.test.ts.
  - QA happy: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings/live2d.browser.test.ts -t "selects Natural and preserves mode settings"`.
  - QA edge: the same command with `-t "keeps natural controls usable at narrow width"`.
  - Use real Pinia and existing browser setup. Exercise widths 1280 and 390 in light and dark mode.
  - Binary PASS: selection and cursor toggle persist, reset restores defaults, and controls do not overlap or leave the viewport.
  - Capture and inspect screenshots for all four width/theme combinations.
  - Evidence: `.omo/evidence/live2d-presence-v1/task-3-settings.txt` and `task-3-settings-{desktop,mobile}-{light,dark}.png`.
  - Commit: Y, `feat(stage-ui): expose natural Live2D motion settings`.

- [x] 4. Verify adjacent motion behavior and complete package checks
  - Recommended task executor category: deep-low - this checks observable integration regressions against existing contracts.
  - What to do: extend existing motion tests only where the new ownership path leaves a regression uncovered.
  - Cover rapid Natural/Universal/MAGIC changes, manual spring release, non-idle clips, hidden/resume, and model disposal.
  - Use the existing integration boundaries. Do not add test-only product exports or a production diagnostics service.
  - Run the exact command set above and affected stage-ui tests.
  - Must NOT do: edit pre-existing failing tests green, skip browser coverage, or conceal type errors.
  - Closes: GAP-3 and GAP-4 regression risks.
  - Parallelization: implementation wave, blocked by 2 and 3, blocks 5.
  - References: motion-manager.test.ts, live2d.test.ts, motion-control-spring.test.ts, MAGIC driver tests, use-live2d-motion-magic.test.ts, view-target.test.ts.
  - QA happy: run the complete stage-ui-live2d suite and the two named MAGIC integration files.
  - QA edge: run `natural-motion-adapter.test.ts -t "preserves manual release and rapid mode transitions"`.
  - Binary PASS: all new and related regressions pass, diagnostics are clean, and all failures outside scope are identified with their existing cause.
  - Evidence: `.omo/evidence/live2d-presence-v1/task-4-checks.txt`.
  - Commit: Y if test changes are needed, `test(stage-ui-live2d): cover natural motion handoffs`; otherwise record no code change.

- [x] 8. Align isolated QA with current workspace version
  - Executor: deep-low. The user identified the launched baseline as the wrong version.
  - Read the current main workspace without editing, staging, committing, or stashing its changes.
  - Overlay its current apps/packages source changes into the existing isolated QA checkout.
  - Preserve all thirteen Natural feature paths and merge the separate English locale hunks.
  - Include required untracked source files. Exclude private assets, caches, and unrelated tooling/document deletions.
  - Record every copied path, source hash, overlap resolution, and excluded path in local evidence.
  - Keep the overlay uncommitted and distinguish it from feature-owned changes during final landing.
  - Verify source hashes, unchanged feature hunks, relevant tests, and combined workspace typechecks.
  - Independent verification must confirm the snapshot before native QA resumes.
  - Evidence: .omo/evidence/live2d-presence-v1/task-8-workspace-alignment.md.
  - Blocks task 5. Prior module receipts remain historical evidence, not combined-version acceptance.
  - Commit: N. Never commit the user's existing changes.

- [ ] 5. Run both-rig desktop motion QA and tune only demonstrated defects
  - Recommended task executor category: visual-engineering - the execution lead performs this real-surface task and judges the rendered result.
  - What to do: launch the isolated Electron instance and import both original local rigs through the actual UI.
  - Run scenarios N1-N5 below for each rig. Inspect moving evidence and apply the full visual rubric.
  - If a scenario fails, tune only the approved mechanism or fix its integration defect, then rerun affected tests and that scenario.
  - Must NOT do: replace moving evidence with unit tests, silently switch to a different model, or add out-of-scope behavior.
  - Closes: GAP-5 and final perceptual coverage for all other gaps.
  - Parallelization: implementation wave, blocked by 4, blocks F1-F4.
  - References: desktop QA setup, visual rubric, local rig paths, current Model.vue lifecycle, and existing motion devtool.
  - N1 happy: Settings > Models > Natural, cursor attention off. Capture 120 seconds with the exact FFmpeg command above.
  - N1 PASS: every quiet-motion rubric item passes with cited timestamps on each model.
  - N2 edge: enable Natural cursor attention. Move the OS pointer left of the avatar, right of it, then away. Capture 30 seconds.
  - N2 PASS: attention changes smoothly, source expiry restores autonomous gaze, and no sustained eye saturation remains.
  - N3 regression: use Settings > Models to switch Natural > Universal > MAGIC > Natural during visible movement.
  - N3 PASS: old modes still work, Natural never chooses them automatically, and no stale owner or pose pop appears.
  - N4 interruption: open `/devtools/live2d-motion`, claim manual control, move head/body controls, then release.
  - N4 PASS: manual control takes precedence, release settles once, and Natural resumes without a neutral reset.
  - The supplied manifests do not register non-idle motion clips. Their arbitration is proved in Task 2's SDK-order integration fixture.
  - Do not modify either private model or create a clip feature just to make desktop QA possible.
  - N5 lifecycle: minimize and restore the owned app, switch the selected model, and repeat the Natural selection.
  - N5 PASS: no hidden-time catch-up, stale model values, blank stage, or duplicated update owner appears.
  - N6 web regression: start `pnpm -F @proj-airi/stage-web dev`, open its reported local URL in a task-owned browser, import either rig, and select Natural.
  - N6 PASS: Natural moves, its cursor toggle works, and switching back to Universal preserves old controls. Capture browser actions and screenshots.
  - The executor binds the reported URL and records exact browser calls before the scenario. Do not use a guessed port.
  - For both rigs, capture pre-physics commanded and post-physics rendered channel samples through QA-only inspection.
  - Bear PASS: body physics remains active and visibly supplies torso response, even when it replaces Natural's body command.
  - Do not replace Bear's physics input or add a rig-specific mapping as a default response to that overwrite.
  - If Bear remains visibly rigid or unstable, fail the scenario and report the limitation rather than silently reduce the stated outcome.
  - Bind each desktop action to the observed accessibility reference or screenshot coordinate before execution.
  - Record literal computer-tool invocations and screenshots in `desktop-actions.jsonl`; do not leave the action log as prose.
  - Evidence: `.omo/evidence/live2d-presence-v1/{forbooth,bear}-{quiet,cursor,modes,manual,lifecycle}.mp4`, extracted frame images, and `visual-verdict.md`.
  - Teardown: stop owned captures and app processes, close the computer session, remove task-owned user data and temporary ZIPs.
  - Keep only local evidence artifacts and a cleanup receipt. Do not upload them.
  - Commit: Y only for verified tuning fixes, `fix(stage-ui-live2d): tune natural motion from rendered evidence`.

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
  - Recommended task executor category: unspecified-high - read-only check of scope and delivered contracts.
  - Compare the full scoped diff with every Must-have and Must-NOT-have.
  - PASS only if each required contract has implementation and evidence, with no unrelated edits.
  - Evidence: `.omo/evidence/live2d-presence-v1/f1-compliance.md`.
- [ ] F2. Code quality review
  - Recommended task executor category: unspecified-high - read-only review of boundaries and regression evidence.
  - Check diagnostics, package tests, typechecks, lint, lifecycle ownership, and the exact SDK seam.
  - PASS only if no new unhandled failure or competing writer remains.
  - Evidence: `.omo/evidence/live2d-presence-v1/f2-quality.md`.
- [ ] F3. Real manual QA
  - Recommended task executor category: visual-engineering - lead-owned inspection of the real desktop evidence.
  - Reuse valid Task 5 captures. Rerun only when source changes invalidate them.
  - PASS only if both rigs pass N1-N5, N6 passes on web, frame strips were viewed, and owned resources are cleaned up.
  - Evidence: `.omo/evidence/live2d-presence-v1/f3-manual.md`.
- [ ] F4. Ideal-state fidelity
  - Recommended task executor category: unspecified-high - read-only check against the user's modest first-iteration outcome.
  - Map IS-1 through IS-5 to implementation and actual evidence.
  - Reject a result that is numerically correct but still visibly mechanical.
  - Do not demand recording replication, additional gestures, or advanced integrations.
  - Evidence: `.omo/evidence/live2d-presence-v1/f4-fidelity.md`.

## Commit strategy
The user authorized commits through the ultrawork directive.
Read `git log --oneline -20` and `git log -5 --` for touched paths before each message.
Use one verified increment per commit, with tests and documentation beside its implementation.
Stage only owned paths or hunks. Preserve the existing dirty workspace.
Do not stage `.omo/` wholesale or commit model assets, recordings, temporary ZIPs, or visual captures.
Planning artifacts form one separate documentation commit after plan approval and review.
Execution does not start from approval of this plan. It requires a separate `/ulw-execute live2d-presence-v1` request.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 1,2,5 | Controller trajectories plus N1 rendered rubric on both rigs | task-1-controller.txt, both quiet videos, visual-verdict.md |
| IS-2 | 2,3,5 | Settings persistence, N2 cursor, N3 mode switching | task-3-settings.txt, both cursor/modes videos |
| IS-3 | 2,4,5 | Adapter ordering/ranges and clip priority, N4 manual priority, intact physics | task-2-adapter.txt, task-4-checks.txt, both manual videos |
| IS-4 | 1,2,4,5 | Suspension, release-tail and disposal tests, N5 lifecycle | task-4-checks.txt, both lifecycle videos, cleanup receipt |
| IS-5 | 3,5,F3,F4 | Four settings screenshots and both-rig moving evidence | task-3-settings images, visual-verdict.md, f3-manual.md, f4-fidelity.md |
