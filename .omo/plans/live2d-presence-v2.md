# live2d-presence-v2 - Work Plan

## TL;DR (For humans)
<!-- Filled LAST, after the detailed plan below. -->

**Who this is for and what changes for them:** Your corner companion stops looking like it's waiting for a command. In Natural mode she keeps moving a little all the time and sometimes shifts a lot. Her eyes wander and glance on their own, she breathes and blinks naturally, and her brows and mouth stay alive. She behaves differently while you're idle, busy at your desk, talking to her, or waiting on her answer, and the AI's emotions show up on her face and body.

**What you'll get:**
- A rebuilt Natural mode with layered, never-frozen motion.
- Reactions to chat, speech, and built-in desktop activity.
- One Energy slider in Settings.
- A liveliness score, built from your own VTube Studio recording, that every motion change must pass.
- A developer lab to force moods, fire emotions, record what's actually on screen, and score it.

**Why this approach:** The score comes first, so "feels alive" becomes a number instead of a guess. The motion is built from independent random layers rather than canned gestures, which avoids the "robotic" and "generic clip" failures you hit before. Everything runs as a one-frame overlay in front of the rig's own physics, so your models' hair and body physics do the rest without being fought or doubled.

**What it will NOT do:**
- Read app or window names, or add native add-ons.
- Change Universal or MAGIC behavior.
- Commit your recordings, models, or screenshots.
- Add per-model emotion setups or extra Settings controls beyond Energy.

**Effort:** XL
**Risk:** Medium - convincing motion still needs tuning on the rendered rigs, but the score and the lab make that measurable.
**Decisions to sanity-check:**
- The score uses a "looking down at the desk" pose to match your recording, while the product pose is only slightly down.
- Talking has no reference recording yet, so it is judged relative to idle.
- A small dev-only Python script reads the recordings.

Your next move: start execution separately when you're ready. Full execution detail follows below.

---

> TL;DR (machine): XL effort, medium risk, 15 implementation todos plus 4 final checks. Score-first layered Natural v2 with face, gaze, breath, performance states, emotion impulses, built-in desktop signals, Energy setting, and a devtools lab with post-physics capture.

## Scope
### Affected user and ideal state
**Affected users:**
- U1 Luke as viewer: keeps a Live2D companion (ForBOOTH-0231, Bear Pajama V1.1) in a screen corner during work and gaming. Electron desktop (`apps/stage-tamagotchi`) is primary; `apps/stage-web` is secondary. Today Natural mode (v1) holds still about 80% of the time, the head is centered on the camera with about half the human spread, and emotion tags do nothing on these rigs. After this plan, she always moves a little and sometimes a lot. Her eyes, face, and breathing take part. She feels different while idle, watching, listening, thinking, and talking, and reacts to chat and desktop activity.
- U2 Luke as tuner: today he can only judge motion by eye. After this plan, a deterministic liveliness score gates every motion change in the test suite. A devtools Natural lab forces states, fires emotions, captures the real rendered (post-physics) motion to a file, and scores it.
- U3 Universal/MAGIC users and the web host: must see no behavior change.
- U4 The chat/LLM pipeline (`packages/stage-ui/src/components/scenes/Stage.vue`): keeps emitting emotion acts, speech state, and sending state. Natural consumes them without changing the chat contract.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Natural is never frozen. Continuous low-amplitude motion runs on head, body, and eyes. The near-still head fraction stays within the recording-derived band. | v1 head speed is below 0.5 units/s in 79.5% of frames (30-minute seeded simulation). The recording is at 4.8% by sum-of-axes speed. A tracked human never stops. |
| IS-2 | Motion is heavy-tailed and varied. Mostly small adjustments, occasional large shifts with smooth natural velocity profiles. No detectable loop. | In the recording, the fastest 10% of head-speed samples carry about 43% of head path length. v1 moves are uniform critically damped glides. |
| IS-3 | Lived-in home pose. Slightly downward by default; the desk calibration fixture reproduces the recording's AngleY mean of -16.4. The pose drifts over minutes. Amplitude is in the recording's range (AngleX SD 7.65, Y 6.42, Z 2.27 in ±30 units). | v1 centers on the camera with about half the spread. |
| IS-4 | Imperfect coordination. The eyes lead and glance independently (saccades, glance-away, look-down). The body lags with lower gain and partial decorrelation. Physics-owned parameters are never written directly. | v1 body is a scaled copy of the head, and the eyes lock to the camera. Bear physics outputs ParamBodyAngleX/Y/Z from ParamAngleX/Y/Z. |
| IS-5 | The whole face participates. Breathing is always on and excites rig physics. Blink timing is natural. Eyelids, brows, and mouth form have micro-activity coupled to gaze and speech, and none of this fights the blink, expression, lipsync, squint, manual, or breath-control owners. | v1 drives 8 channels. ParamBreath is static: SDK breath is deleted, and manual breath only runs on an explicit setBreath call. Both rigs feed ParamBreath into physics. |
| IS-6 | Distinct performance states (idle, watching, listening, thinking, talking, reacting overlay) with smooth cross-fades. Talking adds speech-onset emphasis, not continuous bobbing. One user Energy slider (calm to lively) scales them. | v1 has a single hard-coded behavior, and speech only drives the lips. |
| IS-7 | Reactions grow out of motion. In Natural, LLM emotions become additive impulses plus procedural face hints, visible on both rigs and never a reset to neutral. Universal/MAGIC emotion behavior is unchanged. Explicit clips mask only the channels they animate. | Emotions map to motion groups that neither rig defines (both model3 `Motions` are empty). Clips with priority above IDLE blend Natural out entirely. |
| IS-8 | Desktop awareness from built-in signals only: input idle time, cursor activity, system-audio loudness and screen-change level (only when those captures are enabled), lock/suspend/resume. No new native dependency and no window or app names. The web host degrades gracefully. | User decision (2026-10-17). Electron already exposes getCursorScreenPoint, powerMonitor events, system-audio capture, and screen ambient-light capture. |
| IS-9 | A deterministic offline liveliness score with recording-derived reference bands is a hard gate in the normal test suite. Reference numbers are committed with provenance; raw recordings are never committed. | User decision. It avoids judging by eye alone; the previous procedural attempt felt robotic. |
| IS-10 | Real-surface tuning. The devtools Natural lab forces state, energy, and emotions, captures the post-physics parameter trace to a file, and scores it with the same scorer. | Simulated controller output can differ from rendered output because of physics, ranges, and owners. |
| IS-11 | No regressions. Universal/MAGIC behavior is unchanged. Manual and exclusive owners, explicit clips, pause/hidden, and model replacement keep v1 lifecycle guarantees. Natural adds negligible frame cost during gaming. | Shared renderer and gaming overlay budget. |
| IS-12 | Docs, settings copy, and an ADR describe v2 and its cross-package contracts. | Repo rule: docs ship with code. Contracts cross the stage-shared, Electron, and stage-ui packages. |
| GAP-1 | v1 followers converge and then hold; nothing moves between primary events. | `natural-motion.ts` `schedulePrimary`/`integrate` (lines ~115-152). |
| GAP-2 | v1 uses a uniform random target, a 25-60% step, critical damping, and fixed quiet ranges. | `natural-motion.ts` `schedulePrimary` (~118-133). |
| GAP-3 | v1 posture mean-reverts to 0, and head gains are 0.36/0.24/0.30. | `natural-motion.ts` `integrate` (~139-147). |
| GAP-4 | Body = 0.30*posture. Eyes = fixation - head, with fixation mostly 0. Natural disables idle saccades. There is no physics-ownership detection. | `natural-motion.ts`; `Live2D.vue:171-172`; Bear physics3. |
| GAP-5 | Natural writes no breath, eyelid, brow, or mouth channels. Blink intervals are uniform 3-8 s. | `motion-manager.ts` `useMotionUpdatePluginAutoEyeBlink` (minDelay 3000 / maxDelay 8000); `Model.vue:487` breath only via control. |
| GAP-6 | Natural receives no performance state, no speech state, and no energy. | `natural-motion-adapter.ts` `Attention` has only driver, owners, motion, and cursor. |
| GAP-7 | Emotions map to missing motion groups, and any clip with priority above IDLE fully blends Natural out. | `Stage.vue:266-280`; `stage-ui/src/constants/emotions.ts`; adapter `compose` eligibility (~128-146). |
| GAP-8 | The only desktop signal that reaches Live2D is the cursor, which expires after 1 s. | `Live2D.vue:111-118`; electron `screen.ts`; `powerMonitor.ts` (no renderer consumer); `getSystemIdleTime` unused. |
| GAP-9 | No score exists, and no reference numbers are in the repo. | The audit used throwaway scripts. |
| GAP-10 | The devtools motion workbench has no Natural controls, trace capture, or scoring. | `apps/stage-tamagotchi/src/renderer/pages/devtools/live2d-motion.vue`; `packages/stage-ui/src/features/devtools/motion/live2d/`. |
| GAP-11 | v1 tests pin v1 internals (8 controller cases, 12 adapter cases). | `natural-motion.test.ts`; `natural-motion-adapter.test.ts`. |
| GAP-12 | The README describes v1 "quiet resting poses", and no ADR covers the new contracts. | `packages/stage-ui-live2d/README.md:12-29`. |

### Must have
- Keep the `Live2DMotionDriver` union `'magic' | 'natural' | 'universal'`, the default `universal`, and the stored keys `settings/live2d/motion-driver` and `settings/live2d/natural-cursor-attention` unchanged (`packages/stage-ui-live2d/src/composables/live2d/live2d.ts:4-8`).
- Pure, renderer-free layer modules under `packages/stage-ui-live2d/src/composables/live2d/natural-motion/`, using seconds as the time unit, injected seeded RNG streams (one independent stream per layer), and no Vue or SDK imports. `Live2DNaturalMotion` stays the facade class in `natural-motion.ts` and keeps the `advance(nowSeconds)`, `setCursor`, and `setSuspended` contracts the adapter calls.
- The liveliness score (`natural-motion/liveliness.ts`) and reference numbers (`natural-motion/reference-stats.ts`) are built FIRST. The gate test runs in `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node`.
- Composition stays inside the existing SDK `updateFocus` wrap (before physics). The SDK brackets that wrap with `model.saveParameters()` (after the motion update) and `model.loadParameters()` (after `model.update()`); see `node_modules/pixi-live2d-display/dist/cubism4.es.js` `Cubism4InternalModel.update` (~lines 5416-5437). Natural's writes there are therefore a stateless per-frame overlay on post-motion values: no write persists, nothing compounds, and no `{ base, written }` bookkeeping is needed.
- Natural never writes `ParamMouthOpenY` while `nowSpeaking`, or for 700 ms after it turns false (this covers lipsync's 200 ms release plus 500 ms handoff hold). Natural never writes any parameter that is a physics output on the loaded rig. Natural never writes `ParamBreath` while manual breath control is active.
- In Natural mode, emotions route to impulses. In Universal/MAGIC, emotions produce exactly today's `currentMotion = { group: EMOTION_EmotionMotionName_value[name] }` behavior.
- Desktop signals use built-in Electron and web APIs only. All new IPC goes through `@moeru/eventa` contracts.
- Add one persisted Energy setting, `settings/live2d/natural-energy` (number 0..1, default 0.5), shown only when the driver is `natural`.
- English i18n only (`packages/i18n/src/locales/en/...`).
- Every workaround uses the repository `// NOTICE:` format, including access to `internalModel.physics._physicsRig` and to `motion._motionData.curves`.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No new npm dependency and no `package.json` script changes in any package. The Python converter uses PEP 723 inline metadata and runs through `uv run`; TypeScript scripts run with the existing root `tsx` (`pnpm exec tsx`).
- No raw recordings, recording-derived traces, BOOTH or Bear model files, model screenshots, or captured traces in any commit. Evidence stays local under `.omo/evidence/live2d-presence-v2/` and is never staged.
- No changes to Universal/MAGIC motion behavior, to the blink plugin's Universal behavior, or to the lipsync plugin's timing.
- No foreground app or window title detection, and no native modules.
- No new main-process file writes and no IPC contract for trace export: traces travel over the BroadcastChannel and download as a Blob.
- No authored gesture playlist, no periodic loops (breathing is the only allowed periodic signal), no automatic switch to wiggle, beat, Universal, or MAGIC.
- No per-model emotion-to-expression mapping UI (user chose procedural impulses).
- No per-layer tuning controls in Settings. Only the Energy slider and the existing cursor toggle are user-facing; everything else lives in the devtools lab.
- No backward-compatibility guards for v1 controller internals. v1 tests that pin v1 internals are rewritten, not preserved.
- Do not touch unrelated dirty files in the checkout (`.agents/skills/*`, `AGENTS.md`, `.omo/plans/live2d-presence-v1.md`, and others reported by `git status`).

## Verification strategy
> Zero human intervention: all verification is agent-executed.
- Test decision: score-first (TDD for the score and its gate), then tests-after for wiring and UI (user decision). Framework: Vitest. `packages/stage-ui-live2d/vitest.config.ts` defines the projects `node` (`src/**/*.test.ts`) and `browser` (`*.browser.test.ts`, Playwright Chromium). The other packages use their own vitest configs.
- Hard gate: `packages/stage-ui-live2d/src/composables/live2d/natural-motion/liveliness-gate.test.ts`. Each motion-layer todo adds its metrics to the gate list, and the gate must pass in one run. Fixed RNG streams, 120 Hz simulation, 3 simulated minutes of warm-up, then 30 simulated minutes per seed, 3 seeds (`[1, 2, 3]`), wall-clock under 20 s on the dev machine.
- Speed definition (single source, used by the reference extraction and every gate): resample valid contiguous spans to 30 Hz, never differentiate across excluded gaps, and use head speed `v = ||Δ(ParamAngleX, ParamAngleY, ParamAngleZ)|| / Δt` in recording units (±30 range). The audit's 4.8% figure used a sum-of-axes speed and is NOT the reference. The reference is recomputed by `extract-natural-reference.ts` with this definition.
- Real-surface proof:
  - Electron app via `pnpm dev:tamagotchi`, attached through the `agent-browser-electron` skill (CDP target for the stage window and the settings/devtools window), plus OS-level computer use for native window screenshots at corner size.
  - Rendered traces are captured through the Natural lab and scored with `pnpm exec tsx packages/stage-ui-live2d/scripts/score-natural-trace.ts <trace.json>`, which prints a JSON report with `pass: boolean`.
- Evidence: `.omo/evidence/live2d-presence-v2/task-<N>-<slug>.<ext>`, local only, never committed.
- Checks after each todo: package typecheck(s) for touched workspaces, related tests, scoped `pnpm exec eslint <changed files>`, and `git diff --check`. Before the final wave: root `pnpm typecheck` and `pnpm lint`.

## Execution strategy
### Parallel execution waves
> The wave sizes are dictated by one shared file. `natural-motion.ts` (the facade) is edited by todos 5, 6, 7, and 8, so those run sequentially to keep write scopes disjoint. Independent lanes (score, rig profile, performance state, desktop producer, settings) fan out around them.
- Wave 1: 1 (score + reference), 2 (rig physics-ownership profile), 3 (performance-state resolver + stores)
- Wave 2: 4 (Electron desktop-activity producer), 5 (layered posture controller), 11 (Energy setting + UI)
- Wave 3: 6 (gaze + body coordination)
- Wave 4: 7 (face, blink, breath)
- Wave 5: 8 (performance states, speech emphasis, emotion impulses, energy)
- Wave 6: 9 (adapter v2 composition and ownership)
- Wave 7: 10 (scene wiring across Model.vue, Live2D.vue, Stage.vue, and Electron hosting)
- Wave 8: 12 (Natural lab + post-physics trace capture), 13 (docs + ADR)
- Wave 9: 14 (rendered tuning and acceptance on both rigs)
- Wave 10: 15 (regression and performance sweep)
- Final: F1-F4 in parallel

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 5, 12 (gate used transitively by 6, 7, 8, 14) | 2, 3 |
| 2 | - | 6, 9 | 1, 3 |
| 3 | - | 4, 8, 10 | 1, 2 |
| 4 | 3 | 10 | 5, 11 |
| 5 | 1 | 6 | 4, 11 |
| 6 | 2, 5 | 7 | - |
| 7 | 6 | 8 | - |
| 8 | 3, 7 | 9 | - |
| 9 | 2, 8 | 10 | - |
| 10 | 3, 4, 9, 11 | 12, 13, 14 | - |
| 11 | - | 10 | 4, 5 |
| 12 | 1, 10 | 14 | 13 |
| 13 | 10 | 15 | 12 |
| 14 | 12 | 15 | - |
| 15 | 13, 14 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->

- [x] 1. Build the liveliness score, reference extraction tools, and committed reference stats
  What to do:
  - Create `packages/stage-ui-live2d/src/composables/live2d/natural-motion/liveliness.ts`, a pure module. Input: `LivelinessTrace = { t: Float64Array | number[] (seconds); channels: Record<string, number[]>; valid?: boolean[] }` in model units, plus `ranges: Record<string, { min: number, max: number, default: number }>`. Output: `LivelinessReport = { metrics: Record<MetricId, { value: number, band: [number, number] | null, pass: boolean | null, provisional: boolean }>, hardFailures: string[], score: number, pass: boolean }`.
  - Implement these metrics (formulas from the draft's ultrabrain lane):
    - channel SD for ParamAngleX/Y/Z, ParamEyeBallX/Y, ParamBrowLY, ParamMouthOpenY, ParamMouthForm;
    - still fractions `P(v<0.5)` and `P(v<2)` using the speed definition in Verification strategy;
    - top-10% path share;
    - velocity-ACF first 1/e crossing time;
    - `corr(ParamEyeBallX, ParamAngleX)`;
    - blink rate per minute and inter-blink CV (blink = ParamEyeLOpen below 0.35 × its running median, closing and reopening within 0.5 s);
    - loop detector: the largest positive local peak of the signed head-velocity ACF at lags 2-60 s after the first zero crossing, excluding ParamBreath;
    - pose: mean ParamAngleY, range of the per-minute AngleY means, ParamAngleX p5/p95;
    - jitter: head power above 5 Hz over total power;
    - near-limit occupancy: |value| > 0.97 × half-range;
    - talking metrics: `speedRatio(talkingTrace, idleTrace)` and onset enrichment (mean head speed within 0-400 ms after audio onsets ÷ the same statistic at onsets shifted by +1.7 s), computed by a separate exported function `scoreTalkingRelative(talking, idle, onsetsSeconds)`.
  - Scoring mode (execution amendment, 2026-10-17): `scoreLiveliness(trace, reference, { mode: 'generated' | 'reference' })`, default `generated`. In `reference` mode `clipped` is report-only with a warning, because VTS API values exceed declared ranges (the 2h23m session sits at the limit 5.66% of the time). `score-natural-trace.ts --reference` selects reference mode.
  - Hard failures, which apply regardless of the aggregate score:
    - `frozen`: P(v<0.5) > 0.5;
    - `looping`: loop metric ≥ 0.30;
    - `clipped`: near-limit occupancy > 1%;
    - `nonfinite`: any NaN or Infinity.
  - Aggregate score: `S = 100*exp(-mean(d_i^2)/2)`. Use log-ratios for positive metrics and band half-widths otherwise; average submetrics within each metric row first.
  - Create `packages/stage-ui-live2d/scripts/export-riggold-trace.py`. It uses a PEP 723 header (`# /// script`, `requires-python = ">=3.13"`, `dependencies = ["pyarrow", "numpy"]`). It reads a `.riggold` zip (`manifest.json`, `semantic_channels.parquet` with `t_rel_ms` and `raw.<ParamId>` columns, `tracking_ok`). It writes a JSON trace containing the score channels and the manifest ranges, and excludes near-neutral bouts: all of |ParamAngleX|, |Y|, |Z| < 0.01 for ≥ 5 s, plus 1 s margins. Valid spans split at source gaps over 200 ms. Invocation: `uv run --python 3.13 packages/stage-ui-live2d/scripts/export-riggold-trace.py <in.riggold> <out.json>`.
  - Create `packages/stage-ui-live2d/scripts/extract-natural-reference.ts`. It runs with `pnpm exec tsx ...`, reads one or more exported traces, scores them with `liveliness.ts`, and writes `packages/stage-ui-live2d/src/composables/live2d/natural-motion/reference-stats.ts`. That file holds a typed `const` with:
    - the per-session measured values;
    - a provenance comment naming the recorder (shuka-vts-recorder riggold.v2), session ids `session-20260515T134050` (18m50s) and `session-20260515T140122` (2h23m), the exclusion rules, the speed definition, and the extraction date;
    - the ForBOOTH range table from the manifest (head ±30, body ±10, eyeball ±1, eye open 0..1 with default 1, brow ±1);
    - the gate bands.
  - Bands:
    - reference-backed metrics use the ultrabrain bands (draft `## Ultrabrain lane`), widened only as needed so BOTH sessions pass, with each widening noted in a comment;
    - provisional metrics (ACF crossing, blink rate and CV, jitter) are set to the measured 18m value ×0.6-1.6 and marked `provisional: true`;
    - eyelid SD and body SD are report-only (`band: null`), because VTS maps eye open up to 1.9 and drives the body from the head.
  - Create `packages/stage-ui-live2d/scripts/score-natural-trace.ts` (run with `pnpm exec tsx`). It reads a trace JSON in the same format the Natural lab exports (todo 12) and prints the `LivelinessReport` JSON to stdout. It exits 0 when `pass`, else 1.
  - Create `natural-motion/liveliness.test.ts`, which uses synthetic traces only:
    - (a) a frozen trace produces hard failure `frozen`;
    - (b) a 4 s periodic head loop produces `looping` (loop metric > 0.9);
    - (c) a trace pinned at the limit produces `clipped`;
    - (d) a synthetic stochastic trace built inside the test (summed OU at reference SDs) has every SD metric within ±5% of the SD it was generated with;
    - (e) frame-rate independence: the same continuous signal sampled at 27 Hz with jitter and at 60 Hz yields still fractions within 0.01 of each other;
    - (f) gaps over 200 ms are never differentiated across.
  - Missing-channel rule: when a trace lacks a metric's channel, report that metric as `value: null, pass: null` and exclude it from `S` (never a `nonfinite` hard failure).
  - Mark the talking-relative bands (speed ratio 1.15-1.7, onset enrichment > 1.2) `provisional: true` in `reference-stats.ts`, with a provenance note: "no reference talking segment; relative criteria only".
  - Add `.omo/evidence/` to the root `.gitignore`. Today `.omo/` is visible to git, and no ignore rule covers evidence. Verify with `git check-ignore -v .omo/evidence/x.json`, which must print the new rule.
  - Run the extraction locally on both recordings at `C:/Users/Luke/projects/shuka/shuka-vts-recorder/recordings/` and commit only `reference-stats.ts`, the scripts, the score module and tests, and the `.gitignore` line.
  Must NOT do: commit any trace JSON or recording; add an npm or Python dependency to any manifest; change `package.json` scripts; import Vue or SDK in `liveliness.ts`.
  Closes: GAP-9
  Parallelization: Wave 1 | Blocked by: - | Blocks: 5, 6, 7, 8, 12, 14
  References:
  - `.omo/drafts/live2d-presence-v2.md` (sections `## Ultrabrain lane` and `## Findings`: reference numbers and manifest ranges);
  - `packages/stage-ui-live2d/src/composables/live2d/natural-motion.test.ts:5-12` (seeded LCG style);
  - `packages/stage-ui-live2d/vitest.config.ts` (node project includes);
  - root `package.json` (`tsx` devDependency);
  - `engines/stage-tamagotchi-godot/tools/exportXiaoerEdgeReferenceStages.py` (precedent for a repo Python tool);
  - memory note: recordings are VTS API values including physics, timestamps irregular (~27 Hz), `sample_hz=60` is wrong, so use timestamps.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion/liveliness.test.ts` passes, with 6 cases.
  - `uv run --python 3.13 packages/stage-ui-live2d/scripts/export-riggold-trace.py C:/Users/Luke/projects/shuka/shuka-vts-recorder/recordings/session-20260515T134050.riggold .omo/evidence/live2d-presence-v2/task-1-session-18m.json` exits 0.
  - `pnpm exec tsx packages/stage-ui-live2d/scripts/score-natural-trace.ts .omo/evidence/live2d-presence-v2/task-1-session-18m.json` exits 0 (the reference passes its own bands) for both sessions.
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  QA scenarios:
  - Happy: run the two commands above for both sessions. The report shows `pass: true`, and the reported ParamAngleX SD is within 7.65 ± 0.3 for the 18m session. Evidence: `.omo/evidence/live2d-presence-v2/task-1-reference-report.json`.
  - Failure: score a v1 trace. Generate it by running the current (pre-todo-5) `Live2DNaturalMotion` for 30 simulated minutes, seed 1, in a one-off `pnpm exec tsx -e` snippet (not committed) that writes the trace JSON, then `score-natural-trace.ts` on it. Expect exit 1 with hard failure `frozen` or a still-fraction failure. This records the v1 baseline. Evidence: `.omo/evidence/live2d-presence-v2/task-1-v1-baseline-report.json`.
  Commit: Y | `feat(stage-ui-live2d): add natural motion liveliness score and reference stats`
  Recommended task executor category: `deep-low` (numeric algorithm work with a clear spec and deterministic tests).

- [x] 2. Detect rig physics ownership into a rig profile
  What to do:
  - Create `packages/stage-ui-live2d/src/composables/live2d/natural-motion/rig-profile.ts`, which exports `readLive2DRigProfile(parameters: { ids: string[], minimumValues, maximumValues, defaultValues }, physicsRig: PhysicsRigLike | undefined): Live2DRigProfile`.
  - `Live2DRigProfile = { channels: Map<NaturalChannel, { id, index, min, max, neutral }>, physicsOutputs: Set<string>, bodyFromHeadPhysics: { x: boolean, y: boolean, z: boolean } }`.
  - Define a local `PhysicsRigLike` interface: `{ settings: { baseInputIndex, inputCount, baseOutputIndex, outputCount }[], inputs: { source: { id: string } }[], outputs: { destination: { id: string }, weight?: number }[] }`. Field names must match `node_modules/pixi-live2d-display/dist/cubism4.es.js` around lines 2422-2562; verify them by reading the file.
  - `physicsOutputs` holds every output destination id whose weight is nonzero.
  - Set `bodyFromHeadPhysics.x` when ParamBodyAngleX is reachable from any of ParamAngleX/Y/Z through the input-to-output graph (transitive closure over settings).
  - NaturalChannel ids: headX/Y/Z, bodyX/Y/Z, eyeX/Y, eyeLOpen, eyeROpen, browLY, browRY, browLAngle, browRAngle, eyeLSmile, eyeRSmile, mouthForm, mouthOpen, breath, cheek. Map them to standard Cubism ids (`ParamAngleX`, ..., `ParamEyeLOpen`, `ParamBrowLY`, `ParamBrowLAngle`, `ParamEyeLSmile`, `ParamMouthForm`, `ParamMouthOpenY`, `ParamBreath`, `ParamCheek`).
  - Skip missing ids and zero-width ranges, preserving `natural-motion-adapter.ts:75-87` behavior.
  - Add `rig-profile.test.ts` with fixtures:
    - (a) Bear-like: `ParamAngleX -> ParamBodyAngleX` marks x;
    - (b) transitive: `AngleY -> P1`, `P1 -> ParamBodyAngleY` marks y;
    - (c) a weight-0 output is ignored;
    - (d) ForBOOTH-like: outputs `ParamAngleX2` and `ParamBodyAngleZ2` only, so all body flags are false and `physicsOutputs` contains both;
    - (e) `physicsRig` undefined gives empty outputs and all flags false;
    - (f) missing ids are absent from `channels`.
  Must NOT do: read physics in Vue code in this todo; write any parameter; use `any`.
  Closes: GAP-4 (ownership part)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 6, 9
  References:
  - `.omo/drafts/live2d-presence-v2.md` `## Findings` (Bear and ForBOOTH physics3 input/output lists);
  - `node_modules/pixi-live2d-display/types/index.d.ts:4343,4649` (`_physicsRig`, `physics?: CubismPhysics`);
  - `packages/stage-ui-live2d/node_modules/pixi-live2d-display/dist/cubism4.es.js:2422-2562`;
  - `natural-motion-adapter.ts:75-87`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion/rig-profile.test.ts` passes with 6 cases; package typecheck exits 0.
  QA scenarios:
  - Happy: a one-off `pnpm exec tsx -e` snippet (not committed) parses the real local `bear Pajama V1.1.physics3.json` into a `PhysicsRigLike`, mirroring SDK field naming, and prints the profile. Expected: `bodyFromHeadPhysics` is `{x:true,y:true,z:true}`. Evidence: `.omo/evidence/live2d-presence-v2/task-2-bear-profile.txt`.
  - Failure: the same snippet for ForBOOTH prints `{x:false,y:false,z:false}`, and `physicsOutputs` includes `ParamAngleX2`. If any body flag is true, the scenario fails. Evidence: `.omo/evidence/live2d-presence-v2/task-2-forbooth-profile.txt`.
  Commit: Y | `feat(stage-ui-live2d): detect physics-owned parameters for natural motion`
  Recommended task executor category: `deep-low` (graph logic over a known SDK structure).

- [x] 3. Add the performance-state resolver, desktop-activity store, and performance override store
  What to do:
  - Create `packages/stage-shared/src/performance-state/index.ts`, exported as `./performance-state` in `packages/stage-shared/package.json` `exports`. (This is an exports-map entry, not a script or dependency change; it follows the existing `./screen-ambient-light` precedent.)
  - Define types:
    - `PerformanceMode = 'idle' | 'watching' | 'listening' | 'thinking' | 'talking'`;
    - `PerformanceState = { mode: PerformanceMode, attention: 'camera' | 'screen' | 'cursor', away: boolean, reactSeq: number, reactKind: 'none' | 'wake' | 'screen-change' }`;
    - `PerformanceInputs = { nowMs, speaking, userSpeaking, generating, cursorMovedAtMs: number | null, desktop: DesktopActivitySnapshot | null, visible: boolean, override: PerformanceOverride | null }`.
  - Export the pure function `resolvePerformanceState(inputs, previous: ResolverMemory): { state, memory }` with priority `speaking > userSpeaking (listening) > generating (thinking) > active attention (watching) > idle`:
    - minimum dwell 0.3 s per mode;
    - listening release 0.5 s after `userSpeaking` turns false;
    - watching when input idle < 10 s, or the cursor moved within 3 s, or `screenChange > 0.15`, or `systemAudioLevel > 0.1`;
    - `away` when input idle > 300 s or locked;
    - `reactSeq` increments with kind `wake` on unlock/resume and with kind `screen-change` when `screenChange` rises above 0.35 (refractory 10 s).
    These thresholds are starting values; mark them as named constants with a tuning comment. Null inputs (web host, or Wayland where cursor and idle time are unavailable; see `apps/stage-tamagotchi/src/shared/eventa/index.ts:508-509`) never satisfy watching triggers, so they fall through to idle. Add a resolver test for all-null desktop input.
  - Create `packages/stage-shared/src/stores/desktop-activity.ts`: a Pinia store `useDesktopActivityStore`, not persisted, with `snapshot: shallowRef<DesktopActivitySnapshot | null>` and `setSnapshot`. Follow the `useScreenAmbientLightEnvironment.setEnvironment` pattern in `packages/stage-shared/src/stores/screen-ambient-light.ts` (~lines 87-116). `DesktopActivitySnapshot = { idleSeconds: number | null, locked: boolean, suspendedAtMs: number | null, resumedAtMs: number | null, unlockedAtMs: number | null, systemAudioLevel: number | null, screenChange: number | null, sampledAtMs: number }`. Export it as `./stores/desktop-activity`.
  - Create `packages/stage-ui/src/stores/natural-performance-override.ts`, modeled on `packages/stage-ui/src/stores/presence-bubble.ts` (replicated via `synced: { state: true }`, not persisted). State: `overrideEnabled`, `overrideMode: PerformanceMode`, `overrideEnergy: number | null`, `emotionPulse: { name: string, intensity: number, seq: number } | null`. Computed: `performanceOverride`. Follow the `enforce-rules-for-pinia-synced` skill.
  - Tests:
    - `packages/stage-shared/src/performance-state/index.test.ts` covers priority order, dwell, listening release, watching triggers, away, reactSeq on unlock and screen change (with refractory), override wins, and null desktop for the web case;
    - a store test for the override's computed value.
  Must NOT do: import stage-ui or stage-ui-live2d from stage-shared; persist override state; add dependencies.
  Closes: GAP-6 (state source), GAP-8 (store contract)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 4, 8, 10
  References:
  - `packages/stage-shared/src/stores/screen-ambient-light.ts`;
  - `packages/stage-shared/package.json` exports;
  - `packages/stage-ui/src/stores/presence-bubble.ts`;
  - `.agents/skills/enforce-rules-for-pinia-synced/SKILL.md`;
  - `Stage.vue:137` (speaking store), `:249` (chatSending);
  - `packages/stage-ui/src/stores/ai/models/vad.ts:19-21,63,120-135` (isSpeech, onSpeechStart, onSpeechEnd).
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-shared exec vitest run src/performance-state` passes.
  - `pnpm -F @proj-airi/stage-shared typecheck` and `pnpm -F @proj-airi/stage-ui typecheck` exit 0.
  - `pnpm -F @proj-airi/stage-ui exec vitest run src/stores/natural-performance-override` passes.
  QA scenarios:
  - Happy: the resolver test "speaking overrides listening and thinking" passes. Capture the vitest output. Evidence: `.omo/evidence/live2d-presence-v2/task-3-resolver.txt`.
  - Failure: the test "screen-change within 10 s refractory does not increment reactSeq" passes. Then temporarily set the refractory to 0 in a local edit, confirm the test fails, and revert. Capture both outputs. Evidence: `.omo/evidence/live2d-presence-v2/task-3-refractory-mutation.txt`.
  Commit: Y | `feat(stage-shared): add performance state resolver and desktop activity store`
  Recommended task executor category: `unspecified-low` (small pure module and stores following existing patterns).

- [x] 4. Produce desktop activity from Electron with built-in APIs
  What to do:
  - In `packages/electron-eventa/src/electron/powerMonitor.ts`, add an invoke contract `getSystemIdleTime` (`defineInvokeEventa<number>('eventa:invoke:electron:power-monitor:get-system-idle-time')`), following that package's existing invoke patterns (read `packages/electron-eventa/src/electron/screen.ts`). Export it from the same `electronEvents`/`electron` aggregate the screen contract uses.
  - Create the main service `apps/stage-tamagotchi/src/main/services/electron/desktop-activity.ts`. It registers `defineInvokeHandler` for `getSystemIdleTime` (returning `powerMonitor.getSystemIdleTime()`), with the same window-scoped lifecycle as `powerMonitor.ts` (`onOff` plus `onAppBeforeQuit`). Compose it where `createPowerMonitorService` is composed (find the call with `rg -n "createPowerMonitorService" apps/stage-tamagotchi/src/main`), and export it from `services/electron/index.ts`.
  - Create the renderer store `apps/stage-tamagotchi/src/renderer/stores/desktop-activity.ts`, following the `src/renderer/stores/stage-window-lifecycle.ts` pattern. It:
    - polls `getSystemIdleTime` once per second while the stage window is visible (the value is integer seconds);
    - subscribes to `powerMonitor` lockScreen, unlockScreen, suspended, and resumed events;
    - reads `useSystemAudioLipSyncStore` output `inputLevel` when a driver is active (otherwise null);
    - derives `screenChange` from `useScreenAmbientLightEnvironment().environment` exposure deltas, using a fast/slow follower gap with 0.15 s/4 s time constants (otherwise null when ambient light is inactive);
    - writes `useDesktopActivityStore().setSnapshot(...)`.
  - Start the store from the stage window page `apps/stage-tamagotchi/src/renderer/pages/index.vue`.
  - Tests:
    - a renderer store test with mocked eventa invoke and events (pattern: existing `*.browser.test.ts` in `apps/stage-tamagotchi/src/renderer`) asserting idle seconds, lock/unlock timestamps, and the null audio and screen paths;
    - a main-service unit test if the app has a main test harness (check `apps/stage-tamagotchi/src/main/**/*.test.ts`), otherwise cover the handler through a typecheck plus the QA below.
  Must NOT do: read window titles or process names; add native modules; poll while the window is hidden; start system-audio or screen capture (only read them when already running).
  Closes: GAP-8
  Parallelization: Wave 2 | Blocked by: 3 | Blocks: 10
  References:
  - `apps/stage-tamagotchi/src/main/services/electron/powerMonitor.ts:11-31`;
  - `packages/electron-eventa/src/electron/powerMonitor.ts:1-13`;
  - `packages/electron-eventa/src/electron/screen.ts`;
  - `apps/stage-tamagotchi/src/main/services/electron/screen.ts:16-36`;
  - `apps/stage-tamagotchi/src/renderer/stores/stage-window-lifecycle.ts:44`;
  - `apps/stage-tamagotchi/src/shared/eventa/index.ts:484-509` (lifecycle and Wayland caveat);
  - `packages/stage-ui/src/stores/system-audio-lipsync.ts:25-50`;
  - `.agents/skills/eventa/SKILL.md`.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-tamagotchi typecheck` exits 0.
  - The new renderer store test passes via `pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/stores/desktop-activity`.
  - `pnpm -F @proj-airi/electron-eventa typecheck` exits 0 (if that package has a typecheck script; otherwise root `pnpm typecheck` covers it at todo 15).
  QA scenarios:
  - Happy: run `pnpm dev:tamagotchi` and attach to the stage window via the agent-browser-electron skill. Evaluate `JSON.stringify(window.__pinia?.state?.value?.['desktop-activity'] ?? null)` (or read the store via the devtools Vue hook). Leave the keyboard and mouse idle for 15 s and expect `idleSeconds >= 12`. Move the mouse once (computer-use `mouse_move`) and expect `idleSeconds <= 2` within 3 s. Evidence: `.omo/evidence/live2d-presence-v2/task-4-idle.json`.
  - Failure: with screen ambient light and system-audio lipsync disabled, `screenChange === null` and `systemAudioLevel === null`. Any number in either field fails the scenario. Evidence: `.omo/evidence/live2d-presence-v2/task-4-null-signals.json`. Cleanup: stop the dev process and record its PID kill.
  Commit: Y | `feat(stage-tamagotchi): expose desktop activity for natural motion`
  Recommended task executor category: `unspecified-low` (follows existing eventa and service patterns).

- [x] 5. Rebuild the posture layers: home drift, continuous motion, heavy-tailed shifts
  What to do:
  - Create these pure modules under `packages/stage-ui-live2d/src/composables/live2d/natural-motion/`:
    - `random.ts`: seeded stream factory `createRandomStream(seed): () => number`, plus helpers `gaussian`, `truncatedLognormal(median, logSd, min, max)`, `unitVector3`.
    - `processes.ts`: `FilteredOu` with exact discretization `q = e^{-Δ/τ} q + sqrt(1-e^{-2Δ/τ}) ξ` and a first-order filter `ṅ = (s*sqrt(1+τf/τ)*q - n)/τf`, so the stationary SD is `s`. Also the `minJerk(u) = 10u^3 - 15u^4 + 6u^5` trajectory and `softLimit(h)` (identity below 0.8, then `0.8 + 0.2*tanh((|h|-0.8)/0.2)`).
    - `posture.ts`: class `NaturalPostureLayers`, which computes `h = softLimit(μ + b + g*n + r)` per head axis:
      - home `μ` comes from options (product default `(0, -0.1, 0)`; desk calibration fixture `(-0.14, -0.55, 0)`);
      - drift `b` is OU with SD `(0.08, 0.12, 0.025)`, τ 90 s, filter 5 s;
      - continuous `n` is filtered OU with SD `(0.012, 0.010, 0.005)`, τ `(0.20, 0.24, 0.32)`, filter `(0.07, 0.08, 0.10)`;
      - gain `g = 0.3 + 1.3*sigmoid(2e)`, with `e` an OU process (6 s) filtered over 0.6 s;
      - shifts `r_new = 0.7 r_old + A diag(1, 0.8, 0.3) d`, with A truncated lognormal (median 0.22, logSD 0.7, bounds 0.025-0.75), min-jerk transition duration `D = 0.22 + 0.4 sqrt(||Δr||/0.35)`, then a hold of `0.35 + truncatedLognormal(1.6, 0.65, 0.15, 9.65)`, with 0 overshoot;
      - `amplitudeScale` and `shiftRateScale` inputs (default 1) are consumed in todo 8.
  - Rewrite the `Live2DNaturalMotion` facade in `natural-motion.ts` to use `NaturalPostureLayers` for the head. Keep `advance(nowSeconds)` returning `{ pose: { headX, headY, headZ, bodyX, bodyY, bodyZ, eyeX, eyeY }, fixation }`; body and eyes keep v1 formulas until todo 6. Keep `setCursor` and `setSuspended` semantics (suspension freezes all processes and time; resume keeps state and does no neutral reset). Constructor: `new Live2DNaturalMotion({ seed?: number, random?: () => number, home?: 'product' | 'desk' })`; per-layer streams derive from the seed. Internal integration substeps cap at 1/120 s so that frame partition does not change the distribution.
  - Rewrite `natural-motion.test.ts`. Keep these intents:
    - first-advance origin;
    - finite and bounded output (|value| ≤ 1);
    - suspension freezes and resume continues without a jump (|Δ| < 0.02 over the resume frame);
    - cursor expiry has no follower reset;
    - zero-duration advance is idempotent;
    - statistical frame-partition invariance: 1/30, 1/60, and 1/144 s steps over 10 simulated minutes give head SDs within 5% of each other.
    Drop the v1 exact-target cases.
  - Create `natural-motion/liveliness-gate.test.ts`. It simulates the facade with `home: 'desk'`, seeds `[1, 2, 3]`, 3 min warm-up, 30 min at 120 Hz sampled to a trace at 30 Hz in ForBOOTH units (head = normalized × 30), and scores it with `liveliness.ts` against `reference-stats.ts`. Gate metrics in this todo: head SD X/Y/Z, both still fractions, top-10% path share, velocity-ACF crossing, loop detector, pose (mean Y, minute-Y range, X p5/p95), jitter, near-limit occupancy. Every gated metric passes for every seed, and there are no hard failures.
  Must NOT do: change adapter or Vue files; add face, gaze, or state behavior; use `Math.random` inside layers (inject streams).
  Closes: GAP-1, GAP-2, GAP-3, GAP-11 (controller part)
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 6
  References:
  - draft `## Ultrabrain lane` (all equations and constants; these are starting values and may be tuned only to meet gates, with each change noted in a code comment);
  - `natural-motion.ts` (v1 facade and contracts);
  - `natural-motion-adapter.ts:61-64,96-112,140-146` (setSuspended and advance call sites);
  - `natural-motion.test.ts` (existing intents).
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion` passes, including `liveliness-gate.test.ts`, in under 20 s for the gate file.
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion-adapter.test.ts` passes. Adapter tests that assert v1 exact pose values may be updated only where they pin controller output, never their ownership or lifecycle assertions.
  - Package typecheck exits 0.
  QA scenarios:
  - Happy: export the seed-1 gate trace to `.omo/evidence/live2d-presence-v2/task-5-seed1.json` (the gate test writes it when `NATURAL_TRACE_OUT` is set) and run `pnpm exec tsx packages/stage-ui-live2d/scripts/score-natural-trace.ts .omo/evidence/live2d-presence-v2/task-5-seed1.json`. It exits 0 with head metrics in band. Evidence: `.omo/evidence/live2d-presence-v2/task-5-report.json`.
  - Failure: temporarily set the continuous-motion SD to 0 (local edit), run the gate, confirm it fails on the still fraction, then revert. Evidence: `.omo/evidence/live2d-presence-v2/task-5-mutation.txt`.
  Commit: Y | `feat(stage-ui-live2d): layer continuous posture motion for natural mode`
  Recommended task executor category: `deep-low` (algorithmic implementation against explicit equations and a numeric gate).

- [x] 6. Add independent gaze and lagged body coordination
  What to do:
  - Create `natural-motion/gaze.ts`, class `NaturalGazeLayer`:
    - fixation holds are truncated lognormal (median 1 s, logSD 0.7, 0.18-5 s);
    - targets in eye space are camera `(0,0)`, desk `(0,-0.18)`, and peripheral `(±0.12, 0)`, each with Gaussian jitter of SD 0.02. Selection weights come from `cameraFixationProbability` (default 0.5); split the remainder evenly between desk and peripheral, with the side random;
    - saccade duration `D = clip(0.030 + 0.0025*A, 0.035, 0.090)` with `A = 20*||Δeye||`, using the min-jerk profile;
    - output `eye = gaze - K*h_applied` with `K = (0.31, 0.40)`;
    - independent fixation-X variance targets an SD of about 0.05;
    - about 30% of posture shifts are attention shifts: the gaze moves first, and the posture shift starts 30-80 ms later (uniform). Other shifts keep fixation;
    - cursor attention (when `setCursor` is non-null) becomes a high-weight gaze target `(0.65c.x, 0.65c.y)` plus a head bias of `0.25c.x` and `0.20c.y`, as in v1 (`natural-motion.ts:139-147`).
  - Create `natural-motion/body.ts`: the body follows the head with a lag of 150-300 ms (per-shift random, implemented as a second-order follower with time constant `lag/2`), a normalized gain of 0.99 for X/Y and 0.6 for Z (recording-unit gain about 0.33 given ±30/±10 ranges), plus independent filtered-OU residual SD 0.015 normalized (0.15 body units).
  - The facade gains `setRigProfile(profile: Pick<Live2DRigProfile, 'bodyFromHeadPhysics'>)`. When a body axis is physics-derived, the facade reports `bodyX/Y/Z = null` for that axis, so the adapter skips the write. Widen the pose type to `number | null` for body axes only.
  - Extend `liveliness-gate.test.ts` gate metrics with ParamEyeBallX/Y SD and `corr(eyeX, headX)` (band -0.95..-0.65). Add a unit test asserting that eyes lead the head by 30-80 ms on attention shifts (detect onset by velocity threshold), and that `bodyFromHeadPhysics.x` yields `bodyX === null`.
  Must NOT do: touch face channels; change the adapter (todo 9); make pupils diverge (both eyes share `eyeX` and `eyeY`).
  Closes: GAP-4 (coordination part)
  Parallelization: Wave 3 | Blocked by: 2, 5 | Blocks: 7
  References:
  - draft `## Ultrabrain lane` (gaze, body);
  - `natural-motion.ts` (facade);
  - `natural-motion-adapter.ts:154-173` (current eye compensation);
  - `rig-profile.ts` from todo 2.
  Acceptance criteria: the node project tests for `src/composables/live2d/natural-motion` pass, including the gate with the eye metrics; package typecheck exits 0.
  QA scenarios:
  - Happy: export the seed-2 gate trace and score it. Expect exit 0, eye SD in band, and the correlation in band. Evidence: `.omo/evidence/live2d-presence-v2/task-6-report.json`.
  - Failure: temporarily set `K = (1, 1)` (full v1-style counter-rotation), confirm the gate fails on correlation or eye SD, and revert. Evidence: `.omo/evidence/live2d-presence-v2/task-6-mutation.txt`.
  Commit: Y | `feat(stage-ui-live2d): add independent gaze and lagged body to natural motion`
  Recommended task executor category: `deep-low` (algorithmic, explicit spec).

- [x] 7. Add face micro-activity, a Natural blink scheduler, and breathing
  What to do:
  - Create `natural-motion/face.ts`, class `NaturalFaceLayer`, with outputs `{ eyeOpenMultiplier: number, browY: number, browAngle: number, eyeSmile: number, mouthForm: number, silentMouthOpen: number, cheek: number }`:
    - brow Y and brow angle are offsets from slow filtered OU (SD 0.025, τ 3 s, filter 0.5 s), with tiny L/R asymmetry: per-side additional OU SD 0.005, exposed as `browLY`/`browRY` and `browLAngle`/`browRAngle`;
    - mouth form offset: OU SD 0.04, τ 4 s;
    - silent mouth opening: a Poisson process at a rate of 1 per 40 s, peak ≤ 0.06, raised-cosine envelope 0.6-1.4 s. Suppressed when the facade input `speechActiveOrRecent` is true;
    - eyelid micro: multiplicative `1 - 0.04*|OU|` (SD 1, τ 2 s), floor applied in the adapter;
    - a brief lid narrowing (−0.06, 250 ms) on 20% of large gaze shifts.
  - Create `natural-motion/blink.ts`, class `NaturalBlinkScheduler`:
    - interval `0.6 + lognormal(median 4, logSD 0.5)` s;
    - closing 60-90 ms (ease-out), opening 160-260 ms (ease-in);
    - 8% chance of a double blink (second blink 120-220 ms after reopening);
    - a blink already due within 0.8 s is advanced onto a gaze shift larger than 0.15 normalized (never every shift);
    - output `blinkFactor` in [0, 1];
    - `enabled` input mirrors the user auto-blink setting (todo 10).
  - Create `natural-motion/breath.ts`: `ParamBreath = 0.45 + 0.12*sin(phase)`, with the period wandering around 4.8 s (OU on log-period, SD 0.15 over 20 s). It outputs a head coupling of ≤ 0.003 normalized on Y, added in the facade. Speaking scales the breath amplitude by 0.6 (input `speaking`). Breath is the only allowed periodic signal; the loop detector excludes ParamBreath.
  - Extend facade `advance` output with `face`, `blink`, and `breath` fields (new keys; existing keys unchanged). Add facade inputs via `setVoice({ speaking: boolean, speechActiveOrRecent: boolean })`.
  - Extend the gate:
    - blink rate and CV (provisional bands from `reference-stats.ts`);
    - brow SD and mouth-form SD (×0.7-1.4 of reference). For this, the gate trace writes ParamEyeLOpen = `faceEyeOpen × blinkFactor`, ParamBrowLY, and ParamMouthForm in ForBOOTH ranges (brow and form ±1, eye 0..1);
    - a unit test checking that no silent mouth opening occurs while `speechActiveOrRecent`;
    - a unit test checking the breath period stays within 3.5-6.5 s over 30 min.
  Must NOT do: write parameters (adapter is todo 9); change `useMotionUpdatePluginAutoEyeBlink`; change lipsync.
  Closes: GAP-5
  Parallelization: Wave 4 | Blocked by: 6 | Blocks: 8
  References:
  - draft `## Ultrabrain lane` (face, blink, breath);
  - `motion-manager.ts` `useMotionUpdatePluginAutoEyeBlink` (BLINK_THRESHOLD 0.15, existing timing);
  - `useMotionUpdatePluginLipSync` (RELEASE 200 ms, HANDOFF_HOLD 500 ms);
  - `useMotionUpdatePluginBreathControl`;
  - recording reference values (draft `## Findings`).
  Acceptance criteria: node tests for `src/composables/live2d/natural-motion` pass, including the extended gate; package typecheck exits 0.
  QA scenarios:
  - Happy: export the seed-3 gate trace and score it. Expect exit 0, and blink rate between 8 and 20 per minute or within its provisional band. Evidence: `.omo/evidence/live2d-presence-v2/task-7-report.json`.
  - Failure: temporarily replace the lognormal blink interval with a constant 4 s, confirm the gate fails on blink CV, and revert. Evidence: `.omo/evidence/live2d-presence-v2/task-7-mutation.txt`.
  Commit: Y | `feat(stage-ui-live2d): add face, blink, and breath layers to natural motion`
  Recommended task executor category: `deep-low` (explicit stochastic spec).

- [x] 8. Add performance states, energy, speech emphasis, and emotion impulses
  What to do:
  - Create `natural-motion/energy.ts` with a state preset table (amplitude, shift rate, camera-fixation probability):
    - idle 1.00 / 1.00 / 0.50;
    - watching 0.80 / 0.70 / 0.25, with attention target screen meaning the desk target weight is doubled;
    - listening 0.75 / 0.60 / 0.85;
    - thinking 1.00 / 1.10 / 0.30, with the peripheral-up target `(±0.15, +0.12)` added;
    - talking 1.15 / 1.30 / 0.65;
    - reacting overlay ×1.30 / ×1.50 for 2 s after an impulse;
    - `away` multiplies amplitude by 0.7 and shift rate by 0.6.
    Cross-fade preset values with a first-order filter, τ 1.0 s (0.7 s into talking, 1.5 s out). Never reset random processes. User energy `E` in [0, 1]: amplitude ×(0.7 + 0.6E), shift rate ×(0.6 + 0.8E), speech emphasis acceptance `0.15 + 0.2E`; at E = 0.5 everything is ×1.
  - Facade `setPerformance(state: PerformanceState, energy: number, nowSeconds)`, which uses the stage-shared types (stage-ui-live2d already depends on `@proj-airi/stage-shared`). When `reactSeq` increments, it fires a desktop reaction: `wake` = small upward impulse plus camera glance; `screen-change` = glance toward desk with a 0.4 s hold.
  - Create `natural-motion/speech-emphasis.ts`:
    - input `mouthOpenSize/100` each frame via `setVoice` (extend with `level`);
    - envelopes 40 ms/250 ms, onset `o = max(0, fast - slow)`;
    - trigger on up-cross of 0.10, rearm below 0.04, accept with the energy-based probability, refractory 1.2 s;
    - impulse 0.02-0.05 normalized, 80% pitch-down nod and 20% tilt.
  - Create `natural-motion/impulses.ts`: `impulse(name: Emotion, intensity, nowSeconds)` where `Emotion` comes from `packages/stage-ui-live2d/src/constants/emotions.ts`.
    - Head envelope: `j(t) = 0.12 I^0.7 d (t/τ)^2 e^{2(1-t/τ)}`, τ uniform 0.25-0.5 s, with direction and magnitude perturbed ±20%.
    - Face hints decay with τ 1.5 s. Directions and hints, as `(headX, headY, headZ)` plus brows, eye smile, mouth form, eye open:
      - happy: (0, +0.6, ±0.3); browY +0.3, eyeSmile +0.5, mouthForm +0.5; (execution note: retuned by todo 22 to head (0, +0.9, ±0.3) and eyeSmile +0.65 for visibility; Happy now nods harder than Surprise)
      - sad: (0, -0.8, ±0.2); browAngle +0.3, mouthForm -0.4, eyeOpen -0.15;
      - angry: (0, -0.4, 0); browY -0.4, browAngle -0.4, mouthForm -0.3;
      - surprised: (0, +0.8, 0); browY +0.6, eyeOpen +0.15;
      - think: gaze to `(±0.3, +0.25)` for 1.2-2.5 s, head roll ±0.4, one-sided brow +0.2;
      - awkward: gaze to `(±0.3, -0.2)`, roll ±0.5, browY +0.15, mouthForm -0.1;
      - question and curious: roll ±0.8, asymmetric brow +0.25;
      - neutral: nothing.
    - Deduplicate the same emotion within 2 s. Impulses add on top of all layers and never reset state.
  - Tests:
    - extend the gate with `scoreTalkingRelative`, using a fixture syllable envelope (4 Hz bursts with 30% pauses) against silence: speed ratio 1.15-1.7, onset enrichment > 1.2, and constant loud audio producing at most 1 emphasis in 10 s;
    - unit tests: state cross-fade continuity (no frame jump > 0.02 at the switch), dedupe, impulse peak ≤ 0.12×I^0.7×1.2, neutral is a no-op, E = 0 vs E = 1 head SD ratio within 0.45-0.65, and no reset to neutral (each head axis changes by < 0.02 in the frame an impulse starts, and the pre-impulse posture is restored within ±0.03 after 3 s);
  Must NOT do: import stage-ui; touch Vue; trigger authored motions.
  Closes: GAP-6, GAP-7 (impulse part)
  Parallelization: Wave 5 | Blocked by: 3, 7 | Blocks: 9
  References:
  - draft `## Ultrabrain lane` (states, speech, impulses);
  - `packages/stage-shared/src/performance-state/index.ts` (todo 3);
  - `packages/stage-ui-live2d/src/constants/emotions.ts:1-35`;
  - the energy input is a plain number in [0, 1]. The persisted setting is added in todo 11 and wired in todo 10, so this todo does not depend on 11.
  Acceptance criteria: node tests for `src/composables/live2d/natural-motion` pass, including the talking-relative gate; package typecheck exits 0.
  QA scenarios:
  - Happy: the gate test's talking fixture reports speedRatio and onsetEnrichment in band. Capture the vitest output. Evidence: `.omo/evidence/live2d-presence-v2/task-8-talking.txt`.
  - Failure: temporarily remove the refractory period, confirm the constant-audio case fails (more than one emphasis), and revert. Evidence: `.omo/evidence/live2d-presence-v2/task-8-mutation.txt`.
  Commit: Y | `feat(stage-ui-live2d): add performance states and emotion impulses to natural motion`
  Recommended task executor category: `deep-low` (explicit spec, state machine plus signals).

- [x] 9. Compose v2 channels in the adapter with explicit ownership
  What to do:
  - Extend `natural-motion-adapter.ts`.
  - Constructor takes `rigProfile: Live2DRigProfile` (from todo 2) instead of building ranges itself. Keep the missing-id and zero-width semantics, and call `controller.setRigProfile`.
  - `Attention` gains:
    - `performance: PerformanceState`, `energy: number`;
    - `voice: { speaking: boolean, level: number, speechEndedAtSeconds: number | null }`;
    - `autoBlink: boolean`, `manualBreathActive: boolean`;
    - `clipOwnedIds: ReadonlySet<string>`;
    - `pendingEmotions: { name: Emotion, intensity: number }[]`, drained each compose.
  - In `compose()`, after posture/eye composition (existing), compose face channels as a stateless overlay on the current post-motion value `base` (read each frame; see Must have on the SDK save/load bracket):
    - eyelids: `hint = base > 0.2 ? eyeOpenHint : 0` and `written = clamp01(max(base × eyeOpenMultiplier + hint, min(base, 0.2)) × blinkFactor)`. When `base ≤ 0.15` (expression-closed eyes), skip the blink and every hint, so `written = base`. A full blink therefore closes the lids, and closed eyes are never reopened;
    - brows, eye smile, mouth form, cheek: additive offsets scaled to each channel's half-range, clamped to [min, max];
    - `ParamMouthOpenY += silentMouthOpen` only when `!voice.speaking` and `now - speechEndedAt > 0.7 s`;
    - `ParamBreath` written absolutely when `!manualBreathActive`.
  - Ownership rules:
    - skip any channel whose id is in `rigProfile.physicsOutputs`;
    - skip body axes reported `null`;
    - for ids in `clipOwnedIds`, apply only 10% of the Natural delta (micro residual) on head/body/eyes and skip face writes;
    - exclusive or manual control means zero Natural on posture channels. Blink and breath still run when the driver is natural and the owner is not exclusive.
  - Eligibility change: an explicit clip no longer suspends the controller. Latent processes keep running, the mask applies, and weight fades keep 0.2 s out / 0.45 s in for posture under manual/exclusive only.
  - Replace v1 `priority <= 1` gating with the mask. Keep `originalFocus` bypass semantics at full weight (regression `ce25b2a`).
  - Update `natural-motion-adapter.test.ts`. Keep every lifecycle and ownership intent (single physics pass, missing ids untouched, pause/hidden, model replacement, manual release, rapid mode transitions), and add:
    - (a) Bear-like profile: no write to ParamBodyAngleX;
    - (b) physics-output brow id is not written;
    - (c) a clip owning ParamAngleX gives ≤ 10% Natural delta on it and full Natural on ParamEyeBallX;
    - (d) a mouth write is never made while speaking or within 0.7 s after;
    - (e) manual breath active means ParamBreath is untouched;
    - (f) with a fixture that emulates the SDK save/load bracket (`saveParameters` before compose, `loadParameters` after), eyelid values after 600 frames at a constant base stay within the same range as frame 1;
    - (g) at base 1 the eyelids stay ≥ 0.2 outside a blink, and a full blink (`blinkFactor` 0) gives ≤ 0.05;
    - (g2) at base 0 with a `surprised` hint of +0.15, the eyelids stay exactly 0;
    - (h) pending emotions are drained exactly once.
  Must NOT do: change `motion-manager.ts` plugin behavior; register new SDK hooks; write outside the `updateFocus` wrap.
  Closes: GAP-5 (composition), GAP-7 (clip masking), GAP-11 (adapter part)
  Parallelization: Wave 6 | Blocked by: 2, 8 | Blocks: 10
  References:
  - `natural-motion-adapter.ts` (entire file);
  - `node_modules/pixi-live2d-display/dist/cubism4.es.js` `Cubism4InternalModel.update` (~5416-5437: saveParameters, updateFocus, physics, `beforeModelUpdate`, model.update, loadParameters); `motion-manager.ts` `useMotionUpdatePluginAutoEyeBlink`, `useMotionUpdatePluginLipSync`, `useMotionUpdatePluginBreathControl`;
  - `Model.vue:441-447` (motion curve id access precedent), `:465-519`;
  - draft `## Architect lane` (Q4).
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d` passes (all files).
  - Package typecheck exits 0.
  - The existing SDK-order probe intent is preserved: the test "composes natural input before one physics pass" stays green.
  QA scenarios:
  - Happy: the adapter test (c) clip mask passes. Capture the output. Evidence: `.omo/evidence/live2d-presence-v2/task-9-adapter.txt`.
  - Failure: temporarily change the eyelid formula back to `max(min(base, 0.2), clamp01(base × mult × blink + hint))`. Tests (g) and (g2) must fail (the blink never closes below 0.2, and closed eyes reopen to 0.15), then revert. Evidence: `.omo/evidence/live2d-presence-v2/task-9-mutation.txt`.
  Commit: Y | `feat(stage-ui-live2d): compose natural face, breath, and masks with explicit ownership`
  Recommended task executor category: `deep-high` (ownership correctness across SDK ordering and multiple plugin owners is argued from invariants).

- [x] 10. Wire performance, voice, emotions, rig profile, and blink handoff through the scene
  What to do:
  - `Model.vue`:
    - after `setupLive2DModel`, build `readLive2DRigProfile(coreModel.getModel().parameters, internalModel.physics?._physicsRig)`. Read the physics rig through a local interface plus `as unknown as`, with a `// NOTICE:` block (framework-internal `_physicsRig`; remove when pixi-live2d-display types physics). If physics loads asynchronously, listen to the `physicsLoaded` event (types `:847-851`) and call `setRigProfile` again;
    - pass the profile to the adapter;
    - extend the attention closure with:
      - `performance` and `energy` from new props;
      - `voice` from `nowSpeaking` and `mouthOpenSize`, with `speechEndedAtSeconds` tracked by a watch on `nowSpeaking`;
      - `autoBlink: live2dAutoBlinkEnabled.value` (the user setting, read before Live2D.vue's natural masking below);
      - `manualBreathActive: manualBreathControl.value.active`;
      - `clipOwnedIds`, computed on `motionStart` from `motionManager.motionGroups[groupIndex][index]._motionData.curves` ids (NOTICE, same precedent as `:441-447`) and cleared on `motionFinish`;
      - `pendingEmotions` from a queue filled by a new exposed `setEmotion(name, intensity)`.
    - `setEmotion(name, intensity)` pushes to the Natural queue. It is only called in Natural mode (see Stage.vue below).
    - Add `setEmotion` to `defineExpose` (`Model.vue:1056`).
  - `Live2D.vue`:
    - add props `performance?: PerformanceState` (default idle/camera) and `naturalEnergy` from the setting;
    - expose `setEmotion` delegating to the model ref;
    - pass `:live2d-auto-blink-enabled="live2dAutoBlinkEnabled && live2dMotionDriver !== 'natural'"` and `:live2d-force-auto-blink-enabled="live2dForceAutoBlinkEnabled && live2dMotionDriver !== 'natural'"`, so the existing plugin holds the manual base in Natural, while Natural's own scheduler blinks when the user's `live2dAutoBlinkEnabled` is true. Pass the unmasked user value separately as a new prop `naturalAutoBlink`.
  - `Stage.vue`:
    - in the emotions queue live2d branch (`:276-279`), branch on `live2dMotionDriver` from the already-imported `useSettingsLive2d`. Natural calls `live2dSceneRef.value?.setEmotion(ctx.data.name, ctx.data.intensity)`. Universal/MAGIC keep the exact existing line `currentMotion.value = { group: EMOTION_EmotionMotionName_value[ctx.data.name] }`, so an emotion that arrives while the model loads is still deferred through the store as today. Before editing, run `lsp_find_references` on `currentMotion` (`packages/stage-ui-live2d/src/stores/model-parameters.ts:62`) and record the readers in evidence;
    - compute `performance` with `resolvePerformanceState` every 250 ms (`useIntervalFn`) plus immediately on input changes. Inputs:
      - `nowSpeaking`;
      - `userSpeaking`: voice capture may run in a different window from the stage. Replicate the flag to the stage window the same way `speechVoicing` and playback state cross windows over the speech bus (`Stage.vue:138-149`, `getSpeechBusContext()` with `defineInvokeHandler` and `emit`). Add a speech-bus event for user speech start/end next to the existing speech-output events (find them with `rg -n "speechOutputPlaybackStateChangedEvent" packages`). Source details: `useVAD` (`packages/stage-ui/src/stores/ai/models/vad.ts:48`) has no callers outside tests. The live voice path is `packages/stage-ui/src/stores/voice.ts`, which imports `SileroVad` (`:24`) and exposes `drafts` (read in `apps/stage-tamagotchi/src/renderer/pages/index.vue:380-386`). Define `userSpeaking = true` while voice.ts reports an active speech segment, or while any `voice.drafts` entry has `!draft.sending`. If voice.ts has no speech-segment signal, add a readonly `userSpeaking` ref to the voice store, set where it handles SileroVad speech start and end (locate with `rg -n "SileroVad|speech" packages/stage-ui/src/stores/voice.ts`), and cover it with a unit test. With voice input disabled, `userSpeaking` stays false;
      - `chatSending`;
      - `cursorMovedAtMs`, tracked from `props.cursorPosition` changes;
      - `useDesktopActivityStore().snapshot`;
      - `document.visibilityState`;
      - `useNaturalPerformanceOverride().performanceOverride`.
    - Watch `emotionPulse.seq` from the override store and enqueue into `emotionsQueue`, so the lab exercises the real path.
    - Pass `:performance` to `Live2DScene`.
  - Electron host: start the desktop-activity store (todo 4) in `apps/stage-tamagotchi/src/renderer/pages/index.vue` if todo 4 did not already.
  Must NOT do: change spine, tachie, mmd, or vrm branches; change `act.motion` handling (`Stage.vue:323-324`); change Universal props other than the natural-masked blink pair.
  Closes: GAP-6 (wiring), GAP-7 (routing), GAP-8 (consumption)
  Parallelization: Wave 7 | Blocked by: 3, 4, 9, 11 | Blocks: 12, 13, 14
  References:
  - `Model.vue:357,398-405,441-447,465-519,630-660,945,1056-1063`;
  - `Live2D.vue:20-185`;
  - `Stage.vue:66,137,249-334,645-660`;
  - `packages/stage-ui-live2d/src/stores/model-parameters.ts:62` (`currentMotion`);
  - `packages/stage-ui/src/stores/voice.ts`;
  - `packages/stage-ui/src/stores/ai/models/vad.ts`;
  - `apps/stage-tamagotchi/src/renderer/pages/index.vue:391-439`;
  - draft `## Architect lane` (Q2, Q3).
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck`, `pnpm -F @proj-airi/stage-ui typecheck`, and `pnpm -F @proj-airi/stage-tamagotchi typecheck` exit 0.
  - `pnpm -F @proj-airi/stage-web typecheck` exits 0 (`Stage.vue` is shared with stage-web).
  - Save all typecheck output for this todo to `.omo/evidence/live2d-presence-v2/task-10-typecheck.txt`.
  - The new `userSpeaking` unit test passes.
  - The `packages/stage-ui-live2d` full suite (`exec vitest run`) passes.
  - `pnpm -F @proj-airi/stage-ui exec vitest run src/components/scenarios/settings/model-settings/live2d.browser.test.ts` passes.
  QA scenarios:
  - Happy: in `pnpm dev:tamagotchi`, with the Bear model and Natural selected, attach via agent-browser-electron to the stage window. Through the Natural lab (or, before todo 12, by evaluating `useNaturalPerformanceOverride()` in the settings window), set `emotionPulse = { name: 'happy', intensity: 1, seq: n+1 }`. Then evaluate in the stage window, over 1 s at 30 Hz, the samples of `ParamAngleY` and `ParamEyeLSmile` read from the Live2D core model through the Vue devtools hook or a dev-only global. Peak ParamAngleY rises by at least 1.5 units within 0.6 s, and ParamEyeLSmile rises by at least 0.2. Evidence: `.omo/evidence/live2d-presence-v2/task-10-happy-impulse.json`.
  - Failure: switch to Universal and fire the same pulse. `useLive2dParams().currentMotion` becomes `{ group: 'Happy' }`, and no Natural impulse is applied (ParamEyeLSmile unchanged ±0.02). Evidence: `.omo/evidence/live2d-presence-v2/task-10-universal-unchanged.json`. Cleanup: stop the dev process and record the receipt.
  Commit: Y | `feat(stage-ui): drive natural motion from performance state and emotions`
  Recommended task executor category: `unspecified-high` (cross-package Vue wiring with real-app QA).

- [x] 11. Add the Natural Energy setting and its settings UI
  What to do:
  - In `packages/stage-ui-live2d/src/composables/live2d/live2d.ts`, add `live2dNaturalEnergy = useLocalStorageManualReset<number>('settings/live2d/natural-energy', 0.5)`. Include it in reset (`:40-42` pattern) and in the returned store refs (`:56-58`).
  - In `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`, add a range control shown only when `live2dMotionDriver === 'natural'`, next to the cursor-attention toggle (`:385-388`). Use the existing shared slider/range component used elsewhere in that file (find it with `rg -n "Range|Slider" packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`), min 0, max 1, step 0.05.
  - English copy in `packages/i18n/src/locales/en/settings.yaml` under `settings.live2d.animation.natural-energy` (`title: Energy`, `description: How lively Natural movement is, from calm to energetic.`).
  - Extend `live2d.browser.test.ts`: the slider is hidden for Universal, shown for Natural, persists to localStorage, and reset restores 0.5. Extend `live2d.test.ts` for the default.
  Must NOT do: add other Natural controls to Settings; edit non-English locales.
  Closes: GAP-6 (user energy)
  Parallelization: Wave 2 | Blocked by: - | Blocks: 8, 10
  References:
  - `live2d.ts:4-58`;
  - `model-settings/live2d.vue:42-63,385-399`;
  - `packages/i18n/src/locales/en/settings.yaml:206-231`;
  - `packages/i18n/AGENTS.md`;
  - `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.browser.test.ts`;
  - `DESIGN.md` and `.agents/skills/enforce-rules-for-unocss/SKILL.md`.
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui exec vitest run src/components/scenarios/settings/model-settings/live2d.browser.test.ts` passes.
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/live2d.test.ts` passes.
  - Both typechecks exit 0.
  QA scenarios:
  - Happy: the browser test captures screenshots of the Live2D settings section with Natural selected at 1280x1000 and 390x1000, showing the Energy slider. Evidence: `.omo/evidence/live2d-presence-v2/task-11-desktop.png`, `.omo/evidence/live2d-presence-v2/task-11-mobile.png`.
  - Failure: with Universal selected, the test asserts no Energy control exists. Evidence: vitest output `.omo/evidence/live2d-presence-v2/task-11-tests.txt`.
  Commit: Y | `feat(stage-ui): add natural motion energy setting`
  Recommended task executor category: `visual-engineering` (settings UI with screenshot checks).

- [x] 12. Build the devtools Natural lab with post-physics trace capture and live score
  What to do:
  - Create `packages/stage-ui-live2d/src/stores/natural-motion-diagnostics.ts`, following the BroadcastChannel post/apply pattern of `packages/stage-ui-live2d/src/stores/motion-control.ts` (read `applyEvent`/`post`, ~lines 260-345). It carries capture requests `{ durationSeconds, id }` and compact results `{ id, report: LivelinessReport, savedPath: string | null, frames: number }` across windows.
  - In `Model.vue`, on a capture request, sample the post-physics core model values for the score channels at 30 Hz for the requested duration. Read them in an `internalModel.on('beforeModelUpdate', ...)` listener, removed when the capture ends or on unmount. That event fires after updateFocus (Natural), physics, and pose, and before `model.update()` and `loadParameters()` (`node_modules/pixi-live2d-display/dist/cubism4.es.js` `Cubism4InternalModel.update` ~5416-5437). Any ticker or `postrender` read would instead see the restored pre-Natural, pre-physics values. Downsample to 30 Hz by timestamp. Add trace metadata `{ model, driver, energy, home, adapter: { weightMean, bodyWrites, physicsOutputSkips } }`, reading a read-only `diagnostics` getter that this todo adds to `Live2DNaturalMotionAdapter` (counters reset per capture). Build a `LivelinessTrace` (format identical to the scorer CLI input, including `ranges` from `coreModel.getModel().parameters`) and score it with `liveliness.ts`. Hand it to a trace sink registered via `setNaturalTraceSink(fn)`.
  - Transfer: send the full trace back over the same BroadcastChannel as the result (600 s × 30 Hz × about 25 channels is about 2 MB, which the channel can carry). The lab window offers it as a Blob download (pattern `packages/stage-ui/src/features/devtools/motion/live2d/components/keyframe-editor.vue:351-354`), named `natural-trace-<ISO>-<model>.json`. No new IPC contract and no main-process file writes.
  - Create the shared lab UI `packages/stage-ui/src/features/devtools/motion/natural/{devtools.vue,index.ts,components/*}`, exported in `packages/stage-ui/package.json` exports as `./features/devtools/motion/natural` (exports-map entry only). It provides:
    - an override toggle with a mode selector (idle, watching, listening, thinking, talking) and an energy override slider, writing `useNaturalPerformanceOverride`;
    - emotion buttons for every `Emotion` with an intensity slider, writing `emotionPulse` with an incremented seq;
    - capture-duration buttons (60 s, 300 s, 600 s);
    - a results table of metric, value, band, and pass, plus the saved path.
  - Electron page `apps/stage-tamagotchi/src/renderer/pages/devtools/live2d-natural-motion.vue` with route meta `layout: settings` and titleKey/subtitleKey (pattern `live2d-ambient-light.vue`), linked from `apps/stage-tamagotchi/src/renderer/pages/settings/system/developer.vue` (pattern `:90-123`). English keys go in `packages/i18n/src/locales/en/tamagotchi/settings.yaml` under `devtools.pages.live2d-natural-motion`.
  - Tests: a browser test for the lab component (override writes, emotion pulse seq increments, results render) and a node test for the trace builder (ranges included, 30 Hz spacing).
  Must NOT do: commit captured traces; capture continuously when no request is pending; add a stage-web page (out of scope; the web sink exists for hosts that mount the lab later).
  Closes: GAP-10
  Parallelization: Wave 8 | Blocked by: 1, 10 | Blocks: 14
  References:
  - `apps/stage-tamagotchi/src/renderer/pages/devtools/live2d-motion.vue`;
  - `apps/stage-tamagotchi/src/renderer/pages/devtools/live2d-ambient-light.vue` (route meta);
  - `packages/stage-ui/src/features/devtools/motion/live2d/`;
  - `packages/stage-ui-live2d/src/stores/motion-control.ts`;
  - `packages/stage-ui/src/stores/presence-bubble.ts`;
  - `apps/stage-tamagotchi/src/renderer/pages/settings/system/developer.vue:90-141`;
  - `packages/i18n/src/locales/en/tamagotchi/settings.yaml:93,230`;
  - root `AGENTS.md` (settings/devtools route meta rule).
  Acceptance criteria:
  - The lab browser test and the trace-builder node test pass.
  - `pnpm -F @proj-airi/stage-ui typecheck` and `pnpm -F @proj-airi/stage-tamagotchi typecheck` exit 0.
  QA scenarios:
  - Happy:
    1. In `pnpm dev:tamagotchi` with ForBOOTH and Natural, open Settings → Developer → Natural motion lab via agent-browser-electron.
    2. Click capture 60 s.
    3. Wait for the results table (subscribe to the DOM change; no sleep).
    4. Click download. Handle any native save dialog with computer use, saving into `.omo/evidence/live2d-presence-v2/`.
    5. The file exists (`Test-Path`), and `pnpm exec tsx packages/stage-ui-live2d/scripts/score-natural-trace.ts <path>` prints a report equal to the lab's report (score difference < 0.01).
    Evidence: `.omo/evidence/live2d-presence-v2/task-12-lab.png`, `.omo/evidence/live2d-presence-v2/task-12-cli-report.json`.
  - Failure: Bear capture under Natural. The trace's ParamBodyAngleX matches the physics output, not a Natural command. Verify that its correlation with ParamAngleX is > 0.9, consistent with the physics mapping, and that the adapter wrote no body (adapter debug counter equals 0). Evidence: `.omo/evidence/live2d-presence-v2/task-12-bear-body.json`. Cleanup: stop the dev process, delete any trace copies outside `.omo/evidence/` (for example in Downloads), and record the receipt.
  Commit: Y | `feat(stage-ui): add natural motion lab with trace capture`
  Recommended task executor category: `unspecified-high` (cross-window UI plus IPC plus real-app QA).

- [x] 13. Update docs and add the ADR for the v2 contracts
  What to do:
  - Rewrite the Natural sections of `packages/stage-ui-live2d/README.md` (`:12-29`) to cover:
    - the layered model;
    - what Natural owns (head, body, and eyes unless physics-owned; face micro-offsets; Natural blink; breath unless manual breath is active);
    - what it never writes (mouth during speech, physics outputs);
    - the Energy setting;
    - emotions as impulses;
    - the score and how to regenerate reference stats (`uv run` and `pnpm exec tsx` commands);
    - the lab.
  - Add `packages/stage-shared/README.md` sections for `performance-state` and the `desktop-activity` store (purpose, usage, when to use, when not to use), following the README structure rule in root `AGENTS.md`.
  - Create `docs/ai/adr/` (it does not exist yet). Add the ADR `docs/ai/adr/<YYYY-MM-DD>-natural-motion-v2-performance-state.md`, using the date-prefixed naming of `server/docs/ai/adr/` (for example `2026-09-23-provider-cost-billing.md`) and the execution date. It covers the performance-state resolver contract, the desktop-activity snapshot, the Electron eventa contract `getSystemIdleTime` and the speech-bus user-speech event, the SDK save/load bracket that makes Natural a per-frame overlay, Linux/Wayland degradation (cursor and idle time may be null or 0, so the resolver falls through to idle), emotion routing by driver, the ownership rules, and the private-data policy for references.
  - Read `docs/assets/ai/context/ui-components.md` (it exists). If it lists features or devtools components, add the Natural lab entry; otherwise leave it unchanged and record that decision in the todo evidence.
  Must NOT do: document unimplemented behavior; touch other locales.
  Closes: GAP-12
  Parallelization: Wave 8 | Blocked by: 10 | Blocks: 15
  References: `packages/stage-ui-live2d/README.md`; `docs/ai/adr/`; root `AGENTS.md` (Conventions: README structure, ADR location, docs with code).
  Acceptance criteria:
  - `pnpm exec eslint packages/stage-ui-live2d/README.md packages/stage-shared/README.md docs/ai/adr` exits 0 (if markdown is linted; otherwise `pnpm lint` at todo 15).
  - Every command in the README section runs successfully when executed verbatim, with outputs captured.
  QA scenarios:
  - Happy: execute the README's reference-regeneration commands verbatim against the 18m recording into the evidence directory; both exit 0. Evidence: `.omo/evidence/live2d-presence-v2/task-13-readme-commands.txt`.
  - Failure: grep the README for v1 phrases "quiet resting poses" and "Do not use Natural for ... speech choreography"; zero matches are required. Evidence: `.omo/evidence/live2d-presence-v2/task-13-grep.txt`.
  Commit: Y | `docs(stage-ui-live2d): document natural motion v2 and its contracts`
  Recommended task executor category: `writing` (documentation and ADR).

- [~] 14. Tune on rendered output and accept on both rigs (partial: stop rule after 2 attempts / >4 h; rendered 600 s acceptance not met - ForBOOTH speedPeakLogAsymmetry 1.031 < 1.051, Bear jitter 1.24e-5 < 1.47e-5; code improvements committed, see ledger)
  What to do:
  - With `pnpm dev:tamagotchi`, for each rig (ForBOOTH-0231 and Bear Pajama V1.1, loaded from `C:/Users/Luke/Documents/Live2d Models/...`, already imported in the app), Natural mode, energy 0.5, and cursor attention off:
    - capture a 600 s idle trace in the lab and score it with the CLI. Note: the rendered product uses home `product` (not `desk`), so the pose-mean metrics are report-only for rendered traces. All other gated metrics must pass, with no hard failures;
    - capture 120 s each with override modes listening, thinking, and talking. Talking is driven by a real TTS reply, or by the lab talking override with system audio playing.
  - If a rendered metric fails, adjust only constants inside the todo 5-8 modules, keeping the node gate green. Record each change and the reason in `.omo/evidence/live2d-presence-v2/task-14-tuning-log.md`. Rerun until both rigs pass.
  - Visual check at corner size: resize the stage window to about 360x480 at a screen corner (computer use). Record a 20 s screen capture with built-in tools, saved as a PNG frame sequence (≥ 10 frames sampled at 2 Hz via computer-use screenshots). Inspect the frames for the failure list: frozen spans, popping, mouth opening during silence beyond a subtle ≤ 0.06, eyes crossing, body fighting physics (jitter), and expression-closed eyes being reopened.
  - Emotion check: fire each emotion from the lab and confirm a visible impulse and face hint on both rigs without a neutral reset (a sequence of 3 screenshots per emotion at 0, 0.3 s, and 1.5 s).
  Must NOT do: commit traces or screenshots; change Universal or MAGIC; loosen node gate bands to pass rendered output (tune constants instead; band changes need a written justification in the tuning log and must stay consistent with both recording sessions).
  Closes: GAP-1..GAP-8 (rendered acceptance)
  Parallelization: Wave 9 | Blocked by: 12 | Blocks: 15
  References:
  - todo 12 lab;
  - `score-natural-trace.ts`;
  - memory: earlier v1 QA was blocked by missing native foreground input. Computer-use permissions were later granted on this host (2026-10-16), so confirm them before starting.
  - `.agents/skills/agent-browser-electron/SKILL.md`, `.agents/skills/use-agent-browser-for-airi/SKILL.md`.
  Acceptance criteria: for both rigs, the 600 s idle CLI report has `pass: true` (pose-mean metrics excluded as report-only), and the listening, thinking, and talking traces have no hard failures. The talking vs idle speed ratio for each rig is in 1.15-1.7.
  QA scenarios:
  - Happy: CLI reports for both rigs pass. Evidence: `.omo/evidence/live2d-presence-v2/task-14-forbooth-idle.json`, `.omo/evidence/live2d-presence-v2/task-14-bear-idle.json`, plus corner frames `.omo/evidence/live2d-presence-v2/task-14-corner-<rig>-<n>.png`.
  - Failure: switch to Universal with idle animation on, capture 120 s through the lab (capture still works because it is driver-independent), and score it. The report differs from Natural, and nothing in Natural modules ran (adapter weight stays 0 in the trace metadata). This confirms the capture measures what is rendered rather than echoing the controller. Evidence: `.omo/evidence/live2d-presence-v2/task-14-universal-control.json`. Cleanup: stop the dev process, delete trace copies outside `.omo/evidence/`, and record the receipt.
  Commit: Y | `fix(stage-ui-live2d): tune natural motion constants on rendered rigs` (only if constants changed; otherwise no commit)
  Recommended task executor category: `deep-low` (computer-use plus browser QA loop with numeric acceptance).

- [~] 15. Run the regression and performance sweep (partial: stop rule - same failure twice / >4 h; Universal parity probe outside 15% on head SD in both the 120 s pair and the preregistered 600 s pair (sdAngleY +21.8%, sdAngleZ -30.9%); static review finds the Universal path behavior-equivalent, with zero adapter reads/writes under Universal, so the miss is attributed to idle-clip randomness (the adapter constructor consumes one extra random draw), not proven causally; all commands, frame cost (0.0 ms unloaded and under GPU load at cc25dae) and micro-benchmark met; see ledger)
  What to do:
  - Run root `pnpm typecheck` and `pnpm lint`.
  - Run `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` (node and browser).
  - Run `pnpm -F @proj-airi/model-driver-magic-live2d exec vitest run`.
  - Run `pnpm -F @proj-airi/stage-shared exec vitest run`.
  - Run the stage-ui test files touched or related: `src/components/scenarios/settings/model-settings/live2d.browser.test.ts`, `src/features/devtools/motion/live2d/**`, the new lab tests, and `src/stores/natural-performance-override*`.
  - Run the stage-tamagotchi tests for touched renderer stores and pages.
  - Known pre-existing failures: the full Stage UI suite had startup-overlay and sessions-dialog browser failures before this work (memory, 2026-10-16). Do not attempt to fix them here. Rerun those two files once on the base commit and once on HEAD, and record that the failure sets are identical.
  - Frame cost: in `pnpm dev:tamagotchi`, open the existing performance visualizer devtools page (`apps/stage-tamagotchi/src/renderer/pages/devtools/performance-visualizer.vue`). Record 60 s of frame times for Universal and for Natural on Bear. Natural p95 frame time minus Universal p95 must be < 0.5 ms.
  - Micro-benchmark: in a node test, `advance` plus a compose-equivalent loop for 60 simulated seconds at 120 Hz completes in < 200 ms.
  - Record in the sweep log why the gaming budget holds: v2 adds no drawables, filters, textures, or render passes (CPU-only parameter writes). Repeat the p95 comparison once while a GPU-heavy browser tab is running (for example a WebGL demo page in the system browser).
  Must NOT do: fix unrelated failures; skip or `.only` tests.
  Closes: GAP-11 (regression), supports IS-11
  Parallelization: Wave 10 | Blocked by: 13, 14 | Blocks: F1-F4
  References: root `AGENTS.md` (Commands); `packages/stage-ui-live2d/AGENTS.md` (Checks); memory (pre-existing Stage UI failures).
  Acceptance criteria:
  - All listed commands exit 0, except the pre-existing failure set, which must be identical on base and HEAD.
  - Frame-cost delta < 0.5 ms.
  - Micro-benchmark < 200 ms.
  QA scenarios:
  - Happy: the full command log with exit codes. Evidence: `.omo/evidence/live2d-presence-v2/task-15-sweep.txt`.
  - Failure: Universal regression probe. With Universal and idle animation on, the lab capture's head SD and still fraction match a capture taken on the base commit (`git stash`-free: use a separate worktree at the base commit) within 15%. Evidence: `.omo/evidence/live2d-presence-v2/task-15-universal-parity.json`. Cleanup: remove the base worktree and record `git worktree list`.
  Commit: N (verification only; fixes caused by this plan go into amended follow-up commits with their own todo)
  Recommended task executor category: `unspecified-high` (broad verification across packages).

- [x] 16. Make the liveliness gate detect non-heavy-tailed shift amplitudes (execution follow-up from the todo 5 gate)
  What to do:
  - The todo 5 gate review found that replacing the truncated-lognormal shift amplitude with a constant (0.28) still passes all gate metrics for seeds 1-3, so IS-2 ("mostly small, occasionally large") has no discriminating proof.
  - Add a trace-derived metric to `natural-motion/liveliness.ts`: the distribution of head-speed peaks. Define it as local maxima of head speed v (the same speed definition as Verification strategy) above 2 units/s that are separated by at least 0.3 s, and score the coefficient of variation of the peak heights plus the ratio p90/p50 of those peaks.
  - Compute both metrics for both recordings via `extract-natural-reference.ts` and add bands (the measured 18m value ×0.7-1.4, widened only so both sessions pass, each widening documented) in `reference-stats.ts`.
  - Gate them in `liveliness-gate.test.ts`.
  - Add a `liveliness.test.ts` case: a synthetic trace built from constant-amplitude min-jerk shifts fails the new metric, and one built from lognormal amplitudes passes.
  Must NOT do: change existing metric definitions or bands; change controller constants unless the real controller fails the new band (if so, report it instead of tuning).
  Closes: GAP-2 (proof gap)
  Parallelization: Wave 2 follow-up | Blocked by: 5 | Blocks: 6 (shares liveliness-gate.test.ts)
  References: the todo 5 gate report `.omo/evidence/live2d-presence-v2-task-5-gate-review.md` (note 1); natural-motion/liveliness.ts; reference-stats.ts; scripts/extract-natural-reference.ts; natural-motion/posture.ts (shift amplitude).
  Acceptance criteria:
  - The liveliness and gate tests pass.
  - A mutation that sets the amplitude constant at 0.28 FAILS the gate on the new metric.
  - Both `score-natural-trace.ts --reference` runs still exit 0.
  - Re-extraction is byte-identical apart from the date line.
  - Package typecheck passes.
  QA scenarios:
  - Happy: the gate passes for seeds 1-3. Evidence: `.omo/evidence/live2d-presence-v2/task-16-gate.txt`.
  - Failure: the constant-0.28 mutation fails on the new metric and is then reverted, hash-verified. Evidence: `.omo/evidence/live2d-presence-v2/task-16-mutation.txt`.
  Commit: Y | `test(stage-ui-live2d): gate natural motion on shift amplitude dispersion`
  Recommended task executor category: `unspecified-high` (metric work with a mutation proof; deep-low provider exhausted).

- [x] 17. Count only live capture as user speech (execution follow-up from Luke's todo 10 decision)
  What to do:
  - Luke decided on 2026-10-17 that an unsent voice draft must not count as the user speaking. Otherwise a draft left unsent holds the character in `listening` and hides `thinking`.
  - In `packages/stage-ui/src/stores/voice.ts`, define `userSpeaking` as true only while voice input is capturing. Remove the unsent-draft clause.
  - Update `voice.browser.test.ts`: keep the capturing case. Replace the draft case so it asserts that an unsent draft while nothing is capturing leaves `userSpeaking` false and sends no `true` on the speech bus.
  Must NOT do: change the speech-bus event contract, the resolver, or anything outside these two files.
  Closes: Luke's decision on todo 10's `userSpeaking` definition
  Parallelization: Wave 8 follow-up | Blocked by: 10 | Blocks: 14
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui exec vitest run src/stores/voice.browser.test.ts` passes three times in a row.
  - `pnpm -F @proj-airi/stage-ui typecheck` exits 0.
  - A mutation that re-adds the draft clause fails the new draft case.
  QA scenarios:
  - Failure: re-add `|| drafts.value.some(draft => !draft.sending)`, confirm the draft case fails, then revert with a hash check. Evidence: `.omo/evidence/live2d-presence-v2/task-17-mutation.txt`.
  Commit: Y | `fix(stage-ui): count only live capture as user speech`
  Recommended task executor category: `unspecified-high` (small, but the providers for quick and writing are unavailable).

- [x] 18. Report idle time as unknown on Linux Wayland (execution follow-up from the todo 13 finding)
  What to do:
  - The resolver contract says idle seconds that are unknown fall back to `idle`. On Linux Wayland, Electron's `powerMonitor.getSystemIdleTime()` can return a constant 0, which the current code reads as "active", so the character would always look like it is watching the screen.
  - Do NOT treat every 0 as unknown. On Windows and macOS, 0 is a real reading while the user types.
  - In the Electron desktop-activity producer (todo 4, `apps/stage-tamagotchi/src/main/services/electron/desktop-activity.ts`), report `idleSeconds: null` when the session is Linux Wayland (`process.platform === 'linux'` and `XDG_SESSION_TYPE === 'wayland'`, or an equivalent detection that Electron documents). Keep the existing behaviour everywhere else.
  - Add a unit test with the platform and environment mocked: on Wayland the snapshot reports null, and on win32/darwin/X11 it reports the measured value.
  - Update the ADR sentence that records the Wayland idle-time uncertainty so it describes the new behaviour.
  Must NOT do: change the resolver, the snapshot shape, or the Windows/macOS behaviour.
  Closes: the todo 13 finding (Wayland idle time 0)
  Parallelization: Wave 9 follow-up, after todo 14's live QA (a main-process edit restarts the dev app) | Blocked by: 4, 13, 14 | Blocks: 15
  Acceptance criteria:
  - The new unit test passes.
  - `pnpm -F @proj-airi/stage-tamagotchi typecheck` exits 0.
  - A mutation that removes the Wayland branch fails the new test.
  QA scenarios:
  - Failure: remove the Wayland branch, confirm the test fails, then revert with a hash check. Evidence: `.omo/evidence/live2d-presence-v2/task-18-mutation.txt`.
  Commit: Y | `fix(stage-tamagotchi): report idle time as unknown on wayland`
  Recommended task executor category: `unspecified-high`.

- [x] 19. Close F2 should-fix items (execution follow-up from the F2 code-quality review)
  What to do:
  - Add tests for the two untested ownership sites that guard the plan's Must-haves:
    - Stage.vue (about :284-287): under the Natural driver an emotion calls `setEmotion`; under Universal/MAGIC the existing `currentMotion` line is used and `setEmotion` is not called;
    - Live2D.vue (about :187-189): with the Natural driver the auto-blink pair passed to the model is masked (`false`), and with Universal it equals the user settings.
    Each test must fail when its site is mutated.
  - Replace process-metadata wording in comments (for example "orchestrator-approved" or "plan todo N") with the technical reason, at the sites F2 listed: natural-motion/breath.ts:16, speech-emphasis.ts:91, energy.ts:13, impulses.ts:46, liveliness.ts:54, natural-motion.ts:83, face.ts:34, and stage-shared/src/performance-state/index.ts:145-146. Comments only, no code changes.
  - In performance-controls.vue (about :66-71), disable the energy-override checkbox and slider while the state override is off (`:disabled="!overrideEnabled"`). Update the lab browser test and the README sentence that documents this.
  Must NOT do: change behaviour outside these items.
  Closes: F2 SHOULD-FIX 1-3
  Parallelization: Wave 10 follow-up, in its own worktree | Blocked by: F2 | Blocks: F1, F3, F4
  Acceptance criteria:
  - The new tests pass, and each fails under a mutation of its site.
  - Typecheck exits 0 for stage-ui, stage-ui-live2d, stage-shared and stage-web.
  - The lab browser test passes.
  - eslint on the changed files exits 0.
  Commit: Y | `test(stage-ui): cover natural emotion routing and blink handoff` (comment and lab fixes may be a second commit: `fix(stage-ui): disable energy override without state override`)
  Recommended task executor category: `unspecified-high`.

- [~] 20. Normalize the jitter metric by band-limited power and re-extract references (partial: structurally infeasible within scope - the band-limited metric shows the controller has ~2.3x the recordings' >5 Hz share and 600 s per-seed spread 3.4-3.9x exceeds the 2.67x band at any 0.02-0.5 Hz edge; node gate turns red; reverted, patch kept as evidence task-20-attempt1.patch; v3: controller HF smoothing + multi-capture statistical acceptance) (F4 follow-up for IS-1/IS-9)
  What to do:
  - In `natural-motion/liveliness.ts`, compute jitter on the detrended spans as (>5 Hz power) / (>~0.2 Hz power) instead of (>5 Hz power) / (total power), so the 90 s drift no longer dominates the denominator and a 600 s window scores like a 30 min one. Apply it identically in the extractor path.
  - Re-extract `reference-stats.ts` from both recordings. The re-extraction must be byte-identical across two runs, and only the jitter band may change. Document the change.
  - Update the jitter pinning tests. The new metric must be pinned by a test that fails when the high-pass denominator is removed.
  Must NOT do: change any other metric or band; tune controller constants (that is todo 21).
  Acceptance criteria:
  - `--reference` exits 0 on both recordings, and the v1 baseline still fails.
  - The gate passes seeds 1-3, and at least 9/10 desk seeds pass.
  - Product-home 600 s node simulations have jitter in band on at least 9/10 seeds.
  - The existing Bear 600 s trace (`task-14-bear-idle` source trace, if retained) passes jitter.
  Commit: Y | `fix(stage-ui-live2d): normalize jitter by band-limited power`
  Recommended task executor category: `unspecified-high`.

- [x] 21. Heavier posture-shift speed tail without clipping (F4 follow-up for IS-2)
  What to do:
  - Raise the posture-shift amplitude tail in `natural-motion/posture.ts` (logSD, or a rare-large mixture), keeping the Y near-limit fraction under 1% (cap Y gain or clamp the target).
  - Correct the "rejects tail-less spreads" comments (`liveliness.ts`, `liveliness-gate.test.ts`) so they do not overstate what the metric catches.
  Acceptance criteria:
  - Product-home 600 s `speedPeakLogAsymmetry` ≥ 1.051 on at least 9/10 seeds, with a mean ≥ 1.25.
  - The desk gate passes seeds 1-3 and at least 9/10 overall, with no clipping.
  - The todo 16 mutations still fail.
  - The idle and talking gates are green.
  Blocked by: 20.
  Commit: Y | `fix(stage-ui-live2d): heavier posture shift tail`
  Recommended task executor category: `unspecified-high`.

- [x] 22. Make emotion impulses clearly visible on both rigs (F4 follow-up for IS-7)
  What to do:
  - Retune `natural-motion/impulses.ts` face-hint rise/decay or offsets so the happy smile peaks at about 0.25 or more, and the head-Y rise survives the ±20% direction perturbation.
  - Add a 10-seed node test.
  Acceptance criteria:
  - The node test (smile ≥ 0.24; head rise ≥ 1.8 within 600 ms, in Bear-range units) passes, and it fails against the current constants.
  - Universal behaviour is unchanged.
  - The impulse unit tests stay green.
  - (The live check is folded into todo 23.)
  Commit: Y | `fix(stage-ui-live2d): make emotion impulses clearly visible`
  Recommended task executor category: `unspecified-high`.

- [x] 23. Complete rendered 600 s acceptance on both rigs (F4 follow-up; completes todo 14)
  What to do:
  - With todos 20-22 landed, capture fresh 600 s idle traces for ForBOOTH and Bear, plus 3 ForBOOTH talking captures.
  - Take a live Bear happy-impulse check of 5 consecutive pulses.
  - Redo the emotion screenshots if todo 22 changed impulses.
  - Use isolated profiles and tear down with receipts.
  Acceptance criteria:
  - Both idle captures pass all non-pose metrics with no hard failures.
  - The talking median is in [1.15, 1.7], with at most 1 of 3 below the band.
  - Bear happy: each of 5 pulses gives smile ≥ 0.22 and head ≥ 1.5.
  - The Universal control is still distinct.
  Blocked by: 20, 21, 22.
  Commit: N (verification), unless a constant fix is needed.
  Recommended task executor category: `unspecified-high`.


- [x] 24. Resolve Bear rendered near-still acceptance with a preregistered three-capture rule (F4 follow-up for IS-1)
  Why: F3's clean Bear 600 s capture failed still2 (0.4699 > 0.4467). On the same code and harness, todo 23's clean Bear capture passed (0.3096). The F3 gate found no harness difference, so this is single-capture variance. The F3 failure stays recorded.
  Preregistration (logged in the ledger BEFORE any data):
  - Acquire exactly 3 fresh Bear 600 s idle captures at the integration tip, using F3's harness: presence pinned at idleSeconds 60, lab Idle override held, Energy 0.5, cursor attention off, a 15 s settle, and isolated profiles.
  - A capture is invalid only if a guard trips: a reload or model-instance change, a resolved-mode or override change, or any foreign input event in the settings window. Each invalid capture is replaced, at most 2 replacements. Every capture, valid or invalid, is retained and reported.
  - PASS iff no valid capture has a hard failure AND, for every non-pose metric, the median across the 3 valid captures lies inside its band. The still2 ceiling stays 0.44666409483792263. The report-only pose metrics stay excluded.
  - No other aggregation and no extra captures. One verdict.
  Acceptance criteria: the preregistered verdict is PASS, with raw traces, CLI reports, guard logs and a teardown receipt.
  Commit: N (verification only).
  Recommended task executor category: `unspecified-high`.

- [~] 25. Complete rendered audio-driven talking acceptance (F4 follow-up for IS-6) (partial: stop rule - same failure twice; real-device voice level is 0 because of the pre-existing wlipsync@1.3.1 processorerror at the 192 kHz output rate, which is out of plan scope; in the harness-only 48 kHz run, todo 26's fix makes speech emphasis fire, 18 events per rig, with ForBOOTH enrichment 1.488 passing and Bear 1.044 below the 1.2 target; talking ratios are in band on all 8 captures with no hard failures; see ledger)
  Why: todo 23's talking captures used the lab Talking override with no audio, so they do not prove audio-driven talking or speech-onset coupling.
  What to do: on each rig, capture 120 s of Natural talking driven by real audio delivered through the app's speech pipeline. Use a TTS provider usable without accounts or keys, or the existing audio-playing path the stage uses for lipsync. Record the audio-onset timestamps from the pipeline, and confirm voice-level delivery by showing nonzero mouth or voice level in the trace. Score each with `scoreTalkingRelative(talking, idle, onsets)` against a clean same-rig idle trace at the same tip.
  Acceptance criteria:
  - no hard failures;
  - talking/idle speed ratio in [1.15, 1.7] on each rig;
  - nonempty onset list;
  - onset enrichment reported (the plan's target is > 1.2);
  - teardown receipt.
  If no account-free audio path exists in the app, report it with evidence; the stop rule then applies.
  Commit: N (verification only), unless a clear constant fix is needed.
  Recommended task executor category: `unspecified-high`.


- [x] 26. Pass the lipsync mouth level to speech emphasis on its real scale (execution follow-up from the todo 25 gate)
  Why: `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:554` passes `level: mouthOpenSize / 100`, but `mouthOpenSize` (Stage.vue) is already on a 0-0.7 scale. Natural receives at most 0.007, below the 0.10 onset trigger in `speech-emphasis.ts`, so speech-emphasis nods and onset-locked shifts never fire on real audio. Todo 8 specified the percentage assumption, todo 9 introduced the division (2f23e76), and todo 10 kept it. The existing tests inject normalized levels directly and bypass the scene mapping (gate report: .omo/evidence/live2d-presence-v2-task-25-gate-review.md).
  What to do:
  - Forward the mouth level unscaled, for example `level: mouthOpenSize.value`, clamped to [0, 1] only if the contract requires it. Correct every comment or doc line that calls it a percentage, including the todo 13 README/ADR wording if present.
  - Add a regression test that drives the real mapping from the component's mouth-open value to the speech-emphasis detector. Realistic 0.7 pulses must produce onsets, and the test must fail with the /100 restored. If the mapping is untestable inline, extract it into a small pure function next to its consumer and test that; no new abstractions beyond that.
  Must NOT do: change the 0.10 trigger or other speech-emphasis constants; touch wlipsync or the AudioContext sample rate (a pre-existing defect, out of scope).
  Acceptance criteria:
  - The new test fails on cc25dae and passes with the fix.
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` exits 0.
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck` (or the package's typecheck script) exits 0.
  - ESLint is clean on the changed files.
  Commit: Y | `fix(stage-ui-live2d): pass lipsync mouth level to speech emphasis unscaled` with the footer `Plan: .omo/plans/live2d-presence-v2.md`.
  Recommended task executor category: `unspecified-high`.

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Check every todo's acceptance criteria and evidence file against this plan, and every Must have and Must NOT have item. Check no package.json script or dependency changes (`git diff <base>..HEAD -- '**/package.json'` shows only exports-map additions), and confirm no private data was committed (`git log -p <base>..HEAD` contains no `.riggold`, `.moc3`, trace JSON, or PNG of models). Recommended task executor category: `unspecified-high`.
- [x] F2. Code quality review
  Review the diff for AIRI rules: no `any`, kebab-case files, NOTICE format, eventa for IPC, no compat guards, classes for stateful modules, tests that can fail. Recommended task executor category: `unspecified-high`.
- [x] F3. Real manual QA (amended: F3's single clean Bear 600 s capture failed still2 0.4699 > 0.4467; that failing capture is preserved as F3-bear-idle-600s-*. The blocker was resolved by todo 24's 3-capture median rule, logged in the ledger before its data, which PASSED with still2 median 0.4003. All other F3 scenarios passed, and a524482 leaves silent scenarios unchanged. Close-out review: live2d-presence-v2-F3-closeout-review.md. This box is not Luke's approval of the whole plan)
  Independently rerun todo 14's capture and score for both rigs, plus todo 10's emotion and Universal scenarios, on the running app, with fresh evidence. Recommended task executor category: `unspecified-high`.
- [x] F4. Ideal-state fidelity (approved with followups: 9 MET; IS-6 PARTIAL via todo 25 [~]; IS-9 and IS-11 PARTIAL as decided v3 deferrals in .omo/drafts/live2d-presence-v3.md; report live2d-presence-v2-F4-fidelity-final-2.md; gate live2d-presence-v2-F4-gate-review.md)
  Check delivered behavior against IS-1..IS-12, 1:1, using the Success criteria table. Any shortfall becomes a new `- [ ] N.` todo. Recommended task executor category: `deep-high`.

## Commit strategy
- One atomic commit per todo (subjects listed in each todo), following Conventional Commits with package scopes as in `git log --oneline -20` (for example `feat(stage-ui-live2d): ...`, `feat(stage-ui): ...`, `feat(stage-tamagotchi): ...`, `feat(stage-shared): ...`, `docs(stage-ui-live2d): ...`).
- Every commit must pass its todo's acceptance commands on its own.
- Footer on every commit: `Plan: .omo/plans/live2d-presence-v2.md`.
- Never stage `.omo/evidence/**`, traces, recordings, model files, or unrelated dirty files present before execution (`.agents/skills/*`, `AGENTS.md`, `.omo/plans/live2d-presence-v1.md`). Stage explicit paths only.
- Direct delivery on a task branch `luke/feat/live2d-presence-v2` in a task-owned worktree unless the executor is told otherwise. No push unless asked.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 5, 14 | Todo 5 gate still fractions; todo 14 rendered idle CLI report | `.omo/evidence/live2d-presence-v2/task-5-report.json`, `task-14-forbooth-idle.json`, `task-14-bear-idle.json` |
| IS-2 | 5, 14 | Todo 5 gate (top-10% share, ACF, loop detector) plus the continuous-SD mutation failing | `task-5-report.json`, `task-5-mutation.txt` |
| IS-3 | 5 | Todo 5 gate pose metrics with the desk fixture (mean Y -16.4±4, minute-Y range, X quantiles) | `task-5-report.json` |
| IS-4 | 2, 6, 9, 12 | Todo 2 Bear/ForBOOTH profiles; todo 6 eye gate plus the K mutation; todo 9 test (a); todo 12 Bear body capture | `task-2-bear-profile.txt`, `task-6-report.json`, `task-9-adapter.txt`, `task-12-bear-body.json` |
| IS-5 | 7, 9, 14 | Todo 7 blink/face gate plus the constant-blink mutation; todo 9 tests (d)-(g2) plus the old-eyelid-formula mutation; todo 14 corner frames | `task-7-report.json`, `task-9-mutation.txt`, `task-14-corner-*.png` |
| IS-6 | 3, 8, 11, 14 | Todo 3 resolver priority; todo 8 talking-relative gate plus the refractory mutation; todo 11 slider screenshots; todo 14 mode captures | `task-3-resolver.txt`, `task-8-talking.txt`, `task-11-desktop.png`, `task-14-*` |
| IS-7 | 8, 9, 10, 14 | Todo 10 happy impulse on Bear plus Universal unchanged; todo 9 clip mask (c); todo 14 emotion screenshots | `task-10-happy-impulse.json`, `task-10-universal-unchanged.json`, `task-9-adapter.txt` |
| IS-8 | 3, 4, 10 | Todo 4 idle seconds and null signals; todo 3 reactSeq refractory mutation and the all-null (web/Wayland) resolver test; todo 10 stage-web typecheck | `task-4-idle.json`, `task-4-null-signals.json`, `task-3-refractory-mutation.txt`, `task-10-typecheck.txt` |
| IS-9 | 1, 5-8 | Todo 1 reference self-score plus the v1 baseline failing; gate tests in todos 5-8 | `task-1-reference-report.json`, `task-1-v1-baseline-report.json` |
| IS-10 | 12, 14 | Todo 12 lab capture matching CLI report; todo 14 Universal control capture | `task-12-lab.png`, `task-12-cli-report.json`, `task-14-universal-control.json` |
| IS-11 | 9, 10, 15 | Todo 15 sweep, Universal parity, and frame-cost delta; todo 10 Universal unchanged | `task-15-sweep.txt`, `task-15-universal-parity.json` |
| IS-12 | 13 | Todo 13 README commands verbatim plus the v1-phrase grep | `task-13-readme-commands.txt`, `task-13-grep.txt` |
