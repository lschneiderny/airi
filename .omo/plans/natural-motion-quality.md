# natural-motion-quality - Work Plan

## TL;DR (For humans)

**Who this is for and what changes for them:** Luke watching the corner Live2D companion for hours: idle stops doing quick back-and-forth wiggles and instead moves like a person (small steps, short pauses, calm and restless spells), and emotions read clearly because idle steps back while an emotion plays and the laugh looks like a laugh.

**What you'll get:** smoother mouth and eyelid micro-motion, idle that quiets during emotion clips (replacing the old "busier after strong emotions" boost and its three hidden settings), a chuckle with synced eye-smile and mouth pulses, eyes that only counter-rotate for real head moves, and a reshaped idle (slower, smoother wobble, human-measured pauses, slow activity spells) - each change committed and measured separately.

**Why this approach:** the emotion fixes are low-risk and independent, so they run in their own branch while the idle reshape runs in a second branch; the idle reshape ports the one variant that simulation showed closest to Luke's own recordings, re-checked on today's code before any constant is committed.

**What it will NOT do:** no idle "acts", no other clip redesigns, no new settings or UI; no gate limits change unless Luke answers the gate checkpoint.

**Effort:** Large
**Risk:** Medium - the idle reshape is expected to fail two heuristic liveliness-gate bands, which needs Luke's decision at a checkpoint.
**Decisions to sanity-check:** removing the three emotion energy settings, with a one-time strip of those keys from your saved settings so nothing else resets (adopted while you were away); the laugh's new face coupling (changes a documented "gestures never touch the face" rule); the gate checkpoint options.

Your next move: run `/ulw-execute natural-motion-quality` (this session or a new one); a plan-reviewer pass is recommended first in a new session, see the delivery note.

---

> TL;DR (machine): Large, Medium risk; 16 todos in two worktrees (emotion track E: face smoothing, boost removal, idle ducking, laugh chuckle, eye compensation; idle track I: R4 re-validation, owner gate checkpoint, gate apply, OU retune, human holds, shift regime) + combine, rendered QA, ADR; F1-F4.

## Scope
### Affected user and ideal state
**Affected user:** (U1) Luke as viewer of the widget-size corner companion for hours; (U2) Luke and agents as developers relying on motion QA (unit tests, observer golden hashes, liveliness/emotion gates T1/T2/T3) to catch regressions; (U3) downstream code (Live2D adapter, rig physics, devtools) consuming Natural frames, which must keep the same frame contract and per-seed determinism.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Idle shows no visible quick back-and-forth; yaw quick reversals (>=0.25 deg, half-swing 0.125-1 s) move from 3.85x the recordings toward 1x (best verified variant 1.46x) | research C36/C40: the fast continuous wobble is the jitter |
| IS-2 | Idle varies over tens of seconds; 60 s between-window speed CV rises from 0.10-0.17 toward the recordings' 0.775 (verified variant 0.45) | research C39/C41 |
| IS-3 | While an emotion gesture clip plays, idle continuous motion steps back so the clip reads; nothing boosts idle after strong emotions | research C11'/C19; Luke removed the boost |
| IS-4 | The happy laugh reads as a chuckle at widget size (slow lift-and-dip head motion, roll, body follow, synced eye-smile and mouth-open pulses), never as a shiver | investigation 2026-10-24; Luke chose "chuckle with face" |
| IS-5 | Mouth-form and eyelid idle noise carry no visible flicker and the lid multiplier has no zero-crossing kink | research C14 |
| IS-6 | Eyes counter-rotate only for real (slow) head moves, not the continuous wobble | research C4 |
| IS-7 | Held poses never start shivering mid-hold (commit bcdfd23cb) and the reshape keeps that property | fix 2026-10-25 |
| IS-8 | QA stays honest: gates versioned; bands change only with Luke's explicit checkpoint answer; never retuned merely to pass; golden hashes re-pinned once per intended motion change with the reason in the commit | motion-qa skill; ADR 2026-10-20-motion-qa-levels |
| IS-9 | Same seed -> same frames; new processes draw from new appended streams so existing layers' sequences are unchanged | posture.ts PostureStreams contract; natural-motion.ts streamIndex append-only comment |
| IS-10 | Luke can judge the result at widget size with a side-by-side (current main vs final branch) before accepting | motion-qa T4 is Luke's visual review |
| GAP-1 | Continuous OU (tau .20/.24/.32 s, filter .06/.07/.09 s, sd .012/.010/.005) drives reversals 3.5-3.85x human | C1'/C36 |
| GAP-2 | No tens-of-seconds activity regime; motion is stationary (CV60 .10-.17) | C39 |
| GAP-3 | Strong emotions call energy.react: idle amplitude up to +30% and shift rate +50% for 2 s; no ducking during clips | C19; energy.ts:127-135, pending-actions.ts:84-88 |
| GAP-4 | Laugh = head-only symmetric 3.5-5 Hz pitch sine, no body, no face | gestures.ts:74-82 |
| GAP-5 | Face OU unfiltered (mouthForm 11.8 reversals/s); lid uses 1 - 0.04 abs(q) | face.ts:95-96,134 |
| GAP-6 | Eye compensation gaze - K h uses the full head incl. continuous wobble | gaze.ts:20,226-227; natural-motion.ts advance() |
| GAP-7 | Reshape fails liveliness jitter (floor 1.469e-5) and speedPeakLogAsymmetry (floor 1.05) bands, both set by heuristics | C40; packages/stage-ui-live2d/scripts/extract-natural-reference.ts:45-48 |
| GAP-8 | No packaged A/B for Luke's visual acceptance | motion-qa T4 |

### Must have
- Two task-owned worktrees from main at or after `bcdfd23cb`: `C:/Users/Luke/projects/dtuber-wt/natural-emotion-clips` on `luke/feat/natural-emotion-clips` (Track E) and `C:/Users/Luke/projects/dtuber-wt/natural-idle-reshape` on `luke/feat/natural-idle-reshape` (Track I). Track I rebases onto the Track E tip in todo 14; nothing merges into `main` during execution (Luke merges after review).
- One Conventional Commit per implementation todo; docs describing the changed code in the same commit; observer.test.ts golden hashes re-pinned in every commit that changes motion, using hashes computed by Vitest under Node (Bun's Math differs in the last bits - never compute pins with Bun).
- TDD for behavior todos (2, 3, 4, 5, 6, 10, 12 draw contract, 13 mechanics): write the failing deterministic test first, record its failing run, then implement. Idle tuning todos (11, 12, 13 constants) are verified by gates plus a per-step metric packet.
- Every QA report carries the required limitations wording verbatim: "Scores prove direction, size relative to the recipe, release, and detectability above the rig's idle noise. They do not prove naturalness, which stays a visual review."
- T1 gate runs used as acceptance use `--fresh`; run `pnpm qa:doctor` before the first gate in each worktree; heavy runs go through the CPU slot broker (never `AIRI_CPU_SLOTS=off`).

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No idle "acts" (stretch, look-around), no redesign of clips other than the laugh, no anticipation/arc/variant work, no exaggeration ladder.
- No change to any gate id/version/metric/band/threshold/window/seed rule, `reference-stats.ts`, or `extract-natural-reference.ts` unless Luke answers option (a) at the todo 9 checkpoint; never retune a recipe or gate merely to pass (ADR 2026-10-21 :29, ADR 2026-10-20 :10).
- No new user settings, settings UI, or i18n strings; no change to Universal/MAGIC drivers; no Kirie, Godot, VRM, MMD changes; no new dependencies.
- No new random draws on existing streams; the regime gets a new `regime` stream appended to `streamIndex`; hold drawing must keep a fixed draw count per hold.
- Do not touch, stage, commit, or revert the other session's uncommitted files in the main checkout (`gaze.ts` pursuit diff, `gaze.test.ts`, touch-debug overlay/test, head-anchor, touch-gestures, `Model.vue`, natural-motion-diagnostics store, devtools, i18n settings.yaml, stage-ui-live2d package.json, pnpm-lock.yaml, README/docs/.github edits). Work only inside the two worktrees.
- Do not delete, skip, or weaken tests; update a pinned value only when the motion change is intended and the commit says why.
- Do not run T3 captures without first warning Luke and getting a visible, undisturbed desktop; never overlap T3 with builds, browser suites, root typecheck, or lint.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD for behavior (Vitest, deterministic, seeded, no sleeps; follow `.agents/skills/enforce-rules-for-vitest/SKILL.md`), gates + metric packets for idle tuning; Track gates: `pnpm qa:motion gate liveliness --level t1 --fresh`, `pnpm qa:motion gate emotion --level t1 --fresh`, `pnpm qa:motion gate emotion --level t2 --rig forbooth`, T3 per todo 15.
- Package checks per commit (run inside the worktree): `pnpm -F @proj-airi/stage-ui-live2d typecheck`, `pnpm -F @proj-airi/stage-ui-live2d exec vitest run src/composables/live2d/natural-motion src/composables/live2d/natural-motion.test.ts src/composables/live2d/natural-motion-adapter.test.ts`, `pnpm exec eslint <changed files>`, and `pnpm verify` (clean worktree, so it covers only this plan's changes). Todo 3 adds `pnpm -F @proj-airi/stage-shared typecheck` and `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` plus the stage-ui performance settings test (`pnpm -F @proj-airi/stage-ui exec vitest run src/features/performance`).
- Evidence: `.omo/evidence/natural-motion-quality/task-<N>-natural-motion-quality.<ext>` in the main checkout (git-ignored; never committed). Before removing a worktree run `pnpm -F @proj-airi/qa-tools run evidence archive --plan natural-motion-quality --from <worktree-path>`. Scratch scripts go under `.temp/` of the worktree (git-ignored).
- Metric packet (Track I): for seeds 1-3 under the liveliness gate protocol (desk home, 180 s warm-up, 1800 s scored, as `liveliness-gate.test.ts`), every gated liveliness metric with band and PASS/LOW/HIGH, plus yaw/pitch/roll quick-reversal rates at >=0.25 and >=1 deg and 60 s/10 s between-window speed CV, compared with the recordings (yaw q25 0.436/s, CV60 0.775) and the previous step.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.
Two worktree chains run side by side; within a worktree todos are sequential because they edit and re-pin the same files.
- Wave 1: 1 (setup + baselines)
- Wave 2: 2 (E face), 8 (I re-validation)
- Wave 3: 3 (E boost removal), 9 (G1 owner checkpoint)
- Wave 4: 4 (E ducking), 10 (G1 apply)
- Wave 5: 5 (E laugh), 11 (I OU retune)
- Wave 6: 6 (E eye compensation), 12 (I holds)
- Wave 7: 7 (E gate run), 13 (I regime)
- Wave 8: 14 (combine)
- Wave 9: 15 (rendered QA + A/B package)
- Wave 10: 16 (ADR + docs)
- Final: F1-F4

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2, 8 | - |
| 2 | 1 | 3 | 8 |
| 3 | 2 | 4 | 9 |
| 4 | 3 | 5 | 10 |
| 5 | 4 | 6 | 11 |
| 6 | 5 | 7 | 12 |
| 7 | 6 | 14 | 13 |
| 8 | 1 | 9 | 2 |
| 9 | 8 | 10 | 3 |
| 10 | 9 | 11 | 4 |
| 11 | 10 | 12 | 5 |
| 12 | 11 | 13 | 6 |
| 13 | 12 | 14 | 7 |
| 14 | 7, 13 | 15 | - |
| 15 | 14 | 16 | - |
| 16 | 15 | F1-F4 | - |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Create both worktrees and record baselines
  Orchestrator note (2026-10-25): Track I worktree is C:/Users/Luke/projects/dtuber-wt/natural-motion-improvements (Luke --worktree arg). Emotion T1 baseline at bcdfd23cb is FAIL 297/40 = the qa-tooling G1-G4 accepted-limitation set (verified 40/40); emotion T1 acceptance in todos 3, 5, 7, 14 means no new failing check ids vs C:/Users/Luke/projects/dtuber-wt/natural-emotion-clips/.temp/qa/20261024-215931-motion-gate-emotion-t1.
  Recommended task executor category: deep-low
  What to do / Must NOT do: From `C:/Users/Luke/projects/dtuber` run `git log -1 --oneline` and confirm HEAD is `bcdfd23cb` or a descendant that still contains it (`git merge-base --is-ancestor bcdfd23cb HEAD`). Create the worktrees with the repo tool: `pnpm wt new natural-emotion-clips --base bcdfd23cb --branch luke/feat/natural-emotion-clips` and `pnpm wt new natural-idle-reshape --base bcdfd23cb --branch luke/feat/natural-idle-reshape` (flags per scripts/dev-tools/wt.ts ~:19-25). In each worktree: confirm `git status --short` is empty, run `pnpm qa:doctor`, run the package checks in the Verification strategy, then `pnpm qa:motion gate liveliness --level t1 --fresh` and `pnpm qa:motion gate emotion --level t1 --fresh` once (in the Track E worktree only; both worktrees are identical at this point) and save run dirs. Run the hold-onset and reversal baseline: copy `C:/Users/Luke/projects/dtuber/.temp/ulw-ablation/hold-onset.ts` into the Track I worktree's `.temp/` and run it with `bun` (Bun is fine for scratch metrics, never for hash pins). Must NOT touch the main checkout's uncommitted files or commit anything.
  Closes: GAP-8 (baseline side of the A/B)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 2, 8
  References (executor has NO interview context - be exhaustive): AGENTS.md:119-126 (`pnpm wt`), .agents/skills/motion-qa/SKILL.md (commands, --fresh, slots, limitations wording), packages/stage-ui-live2d/AGENTS.md (checks), commit bcdfd23cb (hold-latched activity gain in packages/stage-ui-live2d/src/composables/live2d/natural-motion/posture.ts).
  Acceptance criteria (agent-executable): both worktrees exist on the named branches at the same commit containing bcdfd23cb; package checks exit 0; both T1 gates report PASS (liveliness 23 pass / 0 fail at bcdfd23cb); hold-onset prints 0 events per hour.
  QA scenarios (name the exact tool + invocation): happy - `git -C <wt> rev-parse --abbrev-ref HEAD` prints the branch and `git -C <wt> status --short` prints nothing; failure - `git merge-base --is-ancestor bcdfd23cb HEAD` non-zero stops the todo and reports. Evidence .omo/evidence/natural-motion-quality/task-1-natural-motion-quality.md (run dir names, gate summaries, limitations wording).
  Commit: N | -

- [x] 2. Smooth the face idle noise and the lid multiplier (Track E)
  Recommended task executor category: deep-low
  What to do / Must NOT do: In the Track E worktree, TDD. First add failing tests to `packages/stage-ui-live2d/src/composables/live2d/natural-motion/face.test.ts`: (a) over 30 min at 120 Hz with gaze shifts off, RMS of per-frame `diff(mouthForm)` < `0.25 * 0.04 * sqrt(1 - exp(-2 * dt / 4))` (dt = 1/120); (b) RMS of per-frame diff of the lid micro term (eyeOpenMultiplier with narrowing pulses absent) < `0.25 * 0.04 * sqrt(1 - exp(-2 * dt / 2))`; (c) the existing mouthForm SD band test still holds; (d) a pure check by numerical quadrature (not Monte Carlo, whose error is ~4e-4) that the soft-abs constants match the moments of abs(q) for unit-normal q (mean sqrt(2/pi), SD sqrt(1 - 2/pi)) within 1e-6; (e) eyeOpenMultiplier never exceeds 1 (existing assertion). Run and record the failure. Then in `face.ts`: change `new FilteredOu(random, 0.04, 4)` (mouthForm, ~:95) to `new FilteredOu(random, 0.04, 4, 0.3)` and `new FilteredOu(random, 1, 2)` (lid, ~:96) to `new FilteredOu(random, 1, 2, 0.3)`; replace `1 - 0.04 * Math.abs(q)` (~:134) with `1 - 0.04 * (lidSoftAbs.a * Math.hypot(q, lidSoftness) + lidSoftAbs.b)` where `lidSoftness = 0.3`, `lidSoftAbs = { a: 1.0944891587143082, b: -0.1728563303774483 }`, documented with a JSDoc stating it is a smooth stand-in for abs(q) with the same mean and SD for unit-normal q. FilteredOu draws one gaussian per step regardless of filterTau (processes.ts), so the face stream consumption is unchanged. Re-pin both idle and emotion hashes in `observer.test.ts` (run that test file, copy each `Received:` hash from the no-observer assertion, confirm the with-observer assertion then passes) and update the comment at observer.test.ts:11-12 to say the pins were recomputed for the face low-pass. Update `packages/stage-ui-live2d/README.md` Face bullet (~:51-54 region "Face adds slow brow, mouth-form, and eyelid micro-activity") to say mouth-form and eyelid micro-activity are low-passed. Must NOT change brow channels, silent-open or narrowing logic, or any gate.
  Closes: GAP-5
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 3
  References (executor has NO interview context - be exhaustive): packages/stage-ui-live2d/src/composables/live2d/natural-motion/face.ts:95-96,134,143; processes.ts (FilteredOu filterTau with variance compensation `sd * sqrt(1 + filterTau / tau)`); face.test.ts (mouthForm SD band ~:70-71, max<=1 ~:73, narrowing ~:77-87); observer.test.ts:11-22 (pins); reference-stats.ts:215-217 (sd:ParamMouthForm band floor 0.0352 - margin thin, expect ~0.039-0.040).
  Acceptance criteria (agent-executable): new tests fail before and pass after; package checks exit 0; `pnpm qa:motion gate liveliness --level t1 --fresh` PASS with `sd:ParamMouthForm` inside its band (record value).
  QA scenarios (name the exact tool + invocation): happy - vitest face.test.ts passes and the liveliness T1 report shows sd:ParamMouthForm PASS; failure - temporarily set filterTau back to 0 in a scratch copy and confirm test (a) fails (record, then discard). Evidence .omo/evidence/natural-motion-quality/task-2-natural-motion-quality.md.
  Commit: Y | fix(stage-ui-live2d): low-pass face idle noise and smooth the lid multiplier

- [x] 3. Remove the emotion energy boost and its settings (Track E)
  Orchestrator note (2026-10-25): emotion T1 at b29b05961 is 295/42 (diagnosed: sad:slight:eyelid from todo 2 low-pass; surprised:strong blinkRate/mouthForm are seed churn from boost removal, margins ~0.0015/0.0005; awkward:strong:browMean now passes by the same churn). Emotion baseline for todos 5, 7, 14 is now C:/Users/Luke/projects/dtuber-wt/natural-emotion-clips/.temp/qa/20261024-230519-motion-gate-emotion-t1.
  Recommended task executor category: deep-low
  What to do / Must NOT do: TDD. First add a failing test (in `packages/stage-ui-live2d/src/composables/live2d/natural-motion/energy.test.ts` or a pending-actions test next to the existing reacting-overlay tests) asserting that a strong emotion episode leaves `energy.amplitudeScale` and `energy.shiftRateScale` at the preset values (no reacting overlay), while a desktop reaction and a poke still apply the fixed reacting overlay (amplitude 1.3, shift rate 1.5, 2 s, energy.ts:26). Then: in `pending-actions.ts` remove the `if (started.energy) energy.react(at, action.episode.intensity)` emotion path (~:84-88) and any `energy` field on the started impulse that exists only for it (check `impulses.ts` ~:191 and remove the now-unused flag); in `energy.ts` (also update the `reacting` doc ~:26, `setPerformanceSettings`, and its call in natural-motion.ts ~:316) remove the non-desktop branch of `react()` that reads `this.settings.energySeconds/energyAmplitude/energyRate` (~:127-135) and any settings plumbing that only served it; in `packages/stage-shared/src/expression-performance/settings.ts` delete `energyAmplitude`, `energyRate`, `energySeconds` (~:89-93) and their entries in `settings.test.ts` (~:21-23); in `emotion-score.ts` remove the `energySeconds` terms from the lifetime/residue windows (~:248-270) and update their doc comments and `emotion-score.test.ts` expectations (~:514). Stored settings: the schema uses `strictObject` (stage-shared settings.ts ~:5-8) and the persisted reader in `packages/stage-ui/src/features/performance/settings.ts` (`serializer.read`, ~:26-40) returns full defaults when parsing fails, and stored documents contain every field, so removal would reset ALL of Luke's performance settings. Adopted default (Luke away when asked 2026-10-25; recommended option, preserves his data; he can veto at execution start): in that `read()` delete `naturalBands.energyAmplitude`, `naturalBands.energyRate`, `naturalBands.energySeconds` from the parsed JSON before `parseExpressionPerformanceSettings`, marked with the AGENTS.md `// NOTICE:` block (why: keys removed by this plan; root cause: strict schema + full-document persistence; source: this plan; removal condition: after one release in which stored documents have been rewritten without the keys). TDD: a stage-ui test (next to the existing performance settings tests) that a stored document containing the three keys loads with every other field preserved, and that a document with any other unknown key still falls back to defaults. Also note `trace.ts` (~:11, strict context schema) will reject traces recorded before this change; record that in the ADR, no code change. Update docs in the same commit: `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md` and `docs/ai/adr/2026-10-19-natural-emotion-revamp.md` passages describing the emotion energy boost (grep `react`, `energy`, `boost`), and `packages/stage-ui-live2d/README.md`. Re-pin emotion hashes (idle hashes must NOT change - assert by running observer.test.ts before re-pinning: only emotion tests fail). Must NOT change desktop/poke reacting overlay values or presets.
  Closes: GAP-3 (boost half)
  Parallelization: Wave 3 | Blocked by: 2 | Blocks: 4
  References (executor has NO interview context - be exhaustive): packages/stage-ui/src/features/performance/settings.ts (persisted reader ~:15-45) and its tests; packages/stage-shared/src/expression-performance/settings.ts:5-8 (strictObject); settings.test.ts:85-94 (unknown keys rejected); energy.ts:26,94,126-135,146-171; pending-actions.ts:70-90; impulses.ts (~:191 energy flag); packages/stage-shared/src/expression-performance/settings.ts:84-93, settings.test.ts:21-23; emotion-score.ts:248-270; emotion-score.test.ts (~:514); observer.test.ts:11-22.
  Acceptance criteria (agent-executable): `git grep -n -E "energyAmplitude|energyRate|energySeconds" -- packages apps ":!packages/stage-ui/src/features/performance/"` returns nothing (the NOTICE strip and its test are the only remaining mentions); new tests fail before, pass after; idle observer hashes unchanged; stage-shared + stage-ui-live2d typecheck/tests exit 0; `pnpm qa:motion gate emotion --level t1 --fresh` result recorded (PASS expected; a FAIL is reported as a finding with per-check detail, not retuned).
  QA scenarios (name the exact tool + invocation): happy - vitest energy/pending tests pass, git grep empty; failure - a poke still raises amplitudeScale to ~1.3 (asserted in test). Evidence .omo/evidence/natural-motion-quality/task-3-natural-motion-quality.md.
  Commit: Y | refactor(stage-ui-live2d): drop the emotion energy boost and its settings

- [x] 4. Duck idle continuous motion during emotion gesture clips (Track E)
  Orchestrator note (2026-10-25): HF RMS QA judged on the held duck window (attack end to clip end, shift windows excluded): medians 0.551-0.602 per kind, shake 0.574. The plan window [20,21] s includes attack, release and post-release time for 0.5-0.9 s clips (ideal duck would score 0.59-0.76 there), so 0.6x over [20,21] is a plan-QA window mismatch, not a product defect (verifier st_01a17157).
  Recommended task executor category: deep-low
  What to do / Must NOT do: TDD. First write failing tests: in `gestures.test.ts` - `continuousScale(t)` is exactly 1 before any trigger, after a refused trigger (cooldown/slight band), and from `activeUntil() + 0.3` on; equals `1 - 0.45` between attack end and clip end for a strong strength-1 clip and `1 - 0.27` for clear (band amplitude 0.6); changes per 1/120 s step by at most `depth * 1.875 / (attack * 120)` (about 0.047 at depth 0.45, attack 0.15 s; min-jerk peak slope is 1.875/span); two overlapping clips give the max depth, not the sum; trigger makes no extra random draws (compare the next drawn clip with and without a prior window). In a posture test - three `NaturalPostureLayers` on equal seeded streams with `continuousScale` 1, 0, 0.6 and home [0,0,0], run only while every axis stays inside the softLimit identity range (|pose| <= 0.8; assert it, or compare the pre-limit sum): per step `(C - B)` within 1e-12 of `0.6 * (A - B)` per axis and `shiftTarget`/`secondsUntilShift` identical across all three. Then implement: in `posture.ts` add public field `continuousScale = 1` (JSDoc: multiplies continuous motion only, not drift or shifts; the facade ducks it under gesture clips) and use it in `step()` as `this.amplitudeScale * (this.continuousScale * gain * continuous + shift[axis])`; in `gestures.ts` add `const duck = { depth: 0.45, attack: 0.15, release: 0.3 }`, `export const gestureDuckRelease = duck.release`, a private `ducks` list pushed in `trigger()` after the clip is built with `depth = duck.depth * Math.min(1, strength) * bandAmplitude[band]` and `end = at + activeSpan`, where `activeSpan` is a new per-clip value returned by `createClip` alongside `lifetime`: the first age after the clip's peak at which its head-offset norm stays below 10% of that peak, computed once per created clip by sampling `shape` at 1/120 s up to `lifetime`, capped at 2 s (NOT the tail-based `gestureLifetimes`); add a test that for every kind `activeSpan` lies after the peak and the norm at `activeSpan` is <= 10% of peak; and `continuousScale(time)` computing `1 - max(window.depth * min(minJerk((t - start)/attack), 1 - minJerk((t - end)/release)))` over live windows, retiring windows after `end + release`. In `natural-motion.ts` set `this.posture.continuousScale = this.performanceSettings.heldEmotions ? this.gestures.continuousScale(stepStart + step) : 1` immediately before `this.posture.step(...)` (~:473). Keep the existing postpone rule (`remaining > 0.5`, ~:458-464) unchanged. Update `emotion-score.ts` naturalEmotionLifetime gesture term (~:253) to add `gestureDuckRelease` and its test. Docs in the same commit: natural-emotion-revamp ADR (modulation order / gestures section) and README gestures section describe the duck. Re-pin emotion hashes only; idle hashes must stay identical (this proves the no-clip path is untouched).
  Closes: GAP-3 (duck half)
  Parallelization: Wave 4 | Blocked by: 3 | Blocks: 5
  References (executor has NO interview context - be exhaustive): posture.ts (step() continuous term, ~:124-135 after bcdfd23cb); gestures.ts:24-47 (bandAmplitude, cooldowns, gestureLifetimes), :146-202 (NaturalGestures, trigger, clipOffset, activeUntil); natural-motion.ts:434-446 (scale composition), :458-464 (postpone), :473 (posture.step), :478-485 (gesture head); processes.ts minJerk; emotion-score.ts:248-262; observer.test.ts.
  Acceptance criteria (agent-executable): new tests fail before, pass after; observer idle tests pass without re-pinning; package checks exit 0.
  QA scenarios (name the exact tool + invocation): happy - scratch `bun` script in the worktree `.temp/` triggers angry strong at t=20 s and logs the HF RMS (0.5 s moving-average residual) of the POSTURE output alone (`head - gestureHead - impulse`, or the value returned by `posture.step`) for [20,21] s with and without the duck: ducked <= 0.6x unducked (the shake clip itself is excluded so its 3 Hz content cannot mask the result); failure - with `heldEmotions` off, `continuousScale` stays 1 (unit test). Evidence .omo/evidence/natural-motion-quality/task-4-natural-motion-quality.md.
  Commit: Y | feat(stage-ui-live2d): duck idle motion under emotion gesture clips

- [x] 5. Turn the laugh into a chuckle with synced face pulses (Track E)
  Recommended task executor category: deep-low
  What to do / Must NOT do: TDD. First rewrite/add tests in `gestures.test.ts`: (a) with injected draws `[0.1, 0.9, 0.5, 0.5]` (side, cycles -> 3, frequency 2.9 Hz, amplitude 0.06*scale) pitch at a fixed age equals the closed form to 1e-12; (b) over seeds 1-40 and both bands, pitch >= 0 at every sample, the count of strict local minima of pitch inside the bounce span equals the drawn cycles, peak pitch >= 0.05*scale, no pitch zero crossing before the settle, peak norm <= 0.12 and per-frame step <= 0.02 (existing limits); (c) strong band: body roll = 0.5 x head roll and body pitch = 0; (d) `faceOffset(t)` is exactly zero at and after the lifetime and its mouthOpen peak count equals cycles; (e) facade: the gesture mouth term is 0 while `speechActiveOrRecent`; (f) `gestureLifetimes.laugh` equals `0.15 + 3 / 2.6 + 0.35`. Then implement in `gestures.ts` `createClip('laugh')`: keep the three draws in the same order (cycles, frequency, amplitude) with `cycles = 2 + floor(random() * 2)`, `frequency = between(random, 2.6, 3.2)`, `amplitude = between(random, 0.05, 0.07) * scale`; `bounceEnd = 0.15 + cycles / frequency`, `lifetime = bounceEnd + 0.35`; `lift = age < bounceEnd ? minJerk(age / 0.15) : 1 - minJerk((age - bounceEnd) / 0.35)`; `bounce = age <= 0.15 || age >= bounceEnd ? 0 : 0.5 - 0.5 * cos(2 pi frequency (age - 0.15))`; head shape `[0, amplitude * (lift - 0.8 * bounce), side * 0.5 * amplitude * lift]`; set `gestureLifetimes.laugh` accordingly and update the bound comment (~:33-36). Add a `faces` clip list (pushed for every started laugh in BOTH clear and strong bands, unlike `bodies` which are strong-only) and `faceOffset(time): { eyeSmile: number, mouthOpen: number }`; for laugh `eyeSmile = 0.35 * scale * lift`, `mouthOpen = 0.12 * scale * bounce`; other kinds contribute none. In `natural-motion.ts` after the face is composed (~:514-515), when `heldEmotions` is on add `eyeSmile` to `face.eyeSmile` (confirm the adapter clamps eyeSmile to the parameter range, since impulse, pet and hold hints also add to it - face-hints.ts ~:28,44; add a clamp test if not) and, only when not `this.face.speechActiveOrRecent` (or the controller's equivalent voice flag), add `mouthOpen` to `face.silentMouthOpen`. Update the contracts that said gestures never touch the face: `gestures.ts` class doc (~:146-147), `emotion-score.ts` (~:260-261) and add the laugh face term to `naturalFaceResidue` (~:265-270) with its test; update natural-emotion-revamp ADR gesture list and README. Re-pin emotion hashes; idle hashes unchanged. Must NOT change other clips' shapes, cooldowns, or draw order.
  Closes: GAP-4
  Parallelization: Wave 5 | Blocked by: 4 | Blocks: 6
  References (executor has NO interview context - be exhaustive): gestures.ts:29 (cooldown laugh 4 s), :33-47, :68-82 (laugh), :146-202; emotions.ts:68-79 (happy, gesture 'laugh', positive pitch = up); natural-motion.ts:478-485, :506-516; face.ts (speechActiveOrRecent, silentMouthOpen); emotion-score.ts:248-270; observer.test.ts.
  Acceptance criteria (agent-executable): new tests fail before, pass after; package checks exit 0; `pnpm qa:motion gate emotion --level t1 --fresh` result recorded (finding, not retune, on FAIL).
  QA scenarios (name the exact tool + invocation): happy - scratch `bun` script logs the laugh pitch trace and its dominant frequency (2.6-3.2 Hz) and minimum (>= 0) for seeds 1-5; failure - with speech active the mouthOpen addition is 0 (unit test). Evidence .omo/evidence/natural-motion-quality/task-5-natural-motion-quality.md.
  Commit: Y | feat(stage-ui-live2d): replace the laugh shiver with a chuckle and synced face

- [x] 6. Counter-rotate the eyes for the slow head only (Track E)
  Recommended task executor category: deep-low
  What to do / Must NOT do: TDD. First add failing tests: (a) facade test: with the posture continuous OU forced to sd 0 (patch the three private `continuous` processes through an `as unknown as` cast, per the TypeScript rules) the eye output equals today's formula, both with no cursor and with a cursor set so the head follows it (bias path); (b) with continuous wobble present and no shifts/emotions, eye command variance attributable to head wobble is ~0: compare eye x/y over 60 s between two runs differing only in continuous sd (one at 0) on equal seeds - eye series identical within 1e-12 when fixation is identical; (c) a shift still produces counter-rotation of K x shift delta. Then implement: add to `NaturalPostureLayers` a readonly getter `slowPose: Readonly<Vec3>` = `softLimit(home + drift + amplitudeScale * shift + bias)` per axis for the current step, i.e. exactly `step()`'s output with only the continuous term removed (cache the per-axis drift, shift and bias values used in `step()`; JSDoc: the head pose without continuous motion, for eye compensation; bias carries the cursor head-follow from natural-motion.ts posture.step(step, [cursorX, cursorY, 0])); in `natural-motion.ts` `integrate()` build `compensationHead = slowPose + emphasis + impulse + petHead + heldPosture + gestureHead` (same terms as `head` minus the continuous part, clamped like `head`) and store it in `Snapshot`; in `advance()` interpolate it like `head` and pass `{ x: compX, y: compY + breath.headY }` to `NaturalGazeLayer.eye(fixation, ...)` instead of the full head (keep breath coupling, as today's comment says eye compensation sees it). Must NOT change `gaze.ts` compensation constants (0.31, 0.40) or touch the other session's gaze.ts pursuit edits (they are not on this branch). Update `gaze.ts` class doc line "The eye command is `gaze - K h` for the applied head pose `h`" to say slow head pose, and the README Gaze bullet. Re-pin idle and emotion hashes.
  Closes: GAP-6
  Parallelization: Wave 6 | Blocked by: 5 | Blocks: 7
  References (executor has NO interview context - be exhaustive): gaze.ts:16-20 (K and doc), :226-227 (static eye); natural-motion.ts advance() (~:200-235: head interpolation, breath headY, `NaturalGazeLayer.eye(fixation, { x: headX, y: headY })`), integrate() (~:473-500), Snapshot interface (~:91-100); posture.ts step(); liveliness gated metrics eyeHeadCorrelation and sd:ParamEyeBallX/Y (gates.ts:66-69).
  Acceptance criteria (agent-executable): new tests fail before, pass after; package checks exit 0; `pnpm qa:motion gate liveliness --level t1 --fresh` PASS (eyeHeadCorrelation and sd:ParamEyeBall* in band; a FAIL is a design defect to report, not a band question).
  QA scenarios (name the exact tool + invocation): happy - unit tests (b)/(c); failure - liveliness T1 eye metrics recorded with values. Evidence .omo/evidence/natural-motion-quality/task-6-natural-motion-quality.md.
  Commit: Y | fix(stage-ui-live2d): counter-rotate the eyes for slow head motion only

- [x] 7. Run the Track E gates
  Recommended task executor category: deep-low
  What to do / Must NOT do: In the Track E worktree at its tip: `pnpm qa:motion gate emotion --level t1 --fresh`, `pnpm qa:motion gate liveliness --level t1 --fresh`, `pnpm qa:motion gate emotion --level t2 --rig forbooth` (env `AIRI_QA_RIG_FORBOOTH="C:/Users/Luke/Documents/Live2d Models/ForBOOTH-231-Holder-only@Do-not-share-or-resell"`), and `pnpm qa:report <runDir>` for each. Write a report with per-gate verdicts, changed metrics vs todo 1 baselines, and the limitations wording. Must NOT retune anything on failure: report failing checks as findings to the orchestrator, who asks Luke.
  Closes: GAP-3, GAP-4, GAP-5, GAP-6 (verification)
  Parallelization: Wave 7 | Blocked by: 6 | Blocks: 14
  References (executor has NO interview context - be exhaustive): .agents/skills/motion-qa/SKILL.md; packages/qa-tools/README.md; gates.ts:48-50,106,173,188.
  Acceptance criteria (agent-executable): three gate runs complete with recorded verdicts; report written.
  QA scenarios (name the exact tool + invocation): happy - all PASS; failure - any FAIL is listed with check ids and values and the todo stops for orchestrator review. Evidence .omo/evidence/natural-motion-quality/task-7-natural-motion-quality.md.
  Commit: N | -

- [x] 8. Re-validate the R4 idle variant on the current base (Track I)
  Recommended task executor category: deep-low
  What to do / Must NOT do: In the Track I worktree, port the prototype harness to scratch only: copy `C:/Users/Luke/projects/dtuber/.temp/ulw-ablation/{wander.ts,steps.ts,wander-report.mjs,human_compare.py,human_wander.py,human_steps.py}` into the worktree `.temp/ulw-ablation/` and fix relative imports. Run arms A (baseline), O (continuous OU retune only: tau x5, sd x1.6, filterTau x2, original holds - todo 11's intermediate state), S7 and R4 under the gate protocol (desk home, 120 Hz decimated to 30 Hz, 180 s warm-up + 1800 s scored, seeds 1-3), where S7 = continuous OU tau x5, sd x1.6 (`2 * 0.8`), filterTau x2, holds `clamp(exp(-0.82 + 1.02 * N(0,1)), 0.1, 15) / 1.5` from the shift stream, shift amplitude unchanged; R4 = S7 + log-gain OU regime (tau 120 s, own stream) with `rate = exp(0.8 x - 0.32)` shortening holds (`nextShiftAt -= (rate - 1) * dt` during holds) and `amp = exp(0.6 x - 0.18)` multiplying shift amplitude at shift begin, regime NOT touching continuous motion (`R_NOOU=1` in the prototype). Produce the metric packet (Verification strategy) for A, O, S7, R4 and compare with the pre-latch numbers (A q25 1.679, S7 .627, R4 .635; R4 CV60 .450; R4 fails jitter and speedPeakLogAsymmetry only). Must NOT commit; if R4's q25 ratio worsens by more than 20% or it now fails a still band at the median, stop and report to the orchestrator before todo 9 (the checkpoint then also asks whether to proceed).
  Closes: GAP-1, GAP-2 (evidence precondition)
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 9
  References (executor has NO interview context - be exhaustive): .temp/ulw-ablation/steps.ts:57-127 (installSteps, S3c/S7, R2 regime; R4 = R2 with R_BASE=S7 JSON and R_NOOU=1), wander.ts (gate protocol), .omo/ulw-research/20261024-181357/verify-wave3-step-regimes.md (tables), .omo/ulw-research/20261024-181357/report.md section 5b.
  Acceptance criteria (agent-executable): metric packet for A/S7/R4 saved; explicit go/stop line for todo 9.
  QA scenarios (name the exact tool + invocation): happy - `bun .temp/ulw-ablation/steps.ts` with arm env vars prints all three arms; failure - stop rule above reported with numbers. Evidence .omo/evidence/natural-motion-quality/task-8-natural-motion-quality.md.
  Commit: N | -

- [~] 9. Ask Luke the gate-band decision (G1 checkpoint)
  Gap: Luke's required answer not received - asked 4 times via the question tool on 2026-10-25 (all timed out; a timeout is not consent). Last evidence: task-9-natural-motion-quality.md.
  Recommended task executor category: quick
  What to do / Must NOT do: Orchestrator-owned (no code). Using the todo 8 packet (R4 on the current base), assemble the decision packet: per arm (A, O, S7, R4) and per seed, every liveliness metric with band and verdict; reversal and CV numbers vs the recordings; how the failing bands were derived (jitter: provisional first-session value x0.6-1.6; speedPeakLogAsymmetry: x0.7-1.4, packages/stage-ui-live2d/scripts/extract-natural-reference.ts:45-48); the research caveat that whether the recorded >5 Hz head content is tracker noise is unresolved (C1a), while the stillness bands were shown NOT to be a tracker frame-noise floor (keep them gated). Ask Luke through the question tool (header "Gate", required: true, wait true) with options: (a) Report-only: for generated motion, report `jitter` and `speedPeakLogAsymmetry` without gating them (precedent: generated mouth-opening SD is report-only and blink bands are overridden, liveliness.ts:91-120), version `naturalIdleLivelinessGate` to 2; every other metric, including still05/still2, stays gated with its current band; (b) Keep the gate: Track I commits only the steps (todos 11-13) whose packet passes every gated metric; the rest are recorded as not landed. A timed-out answer is not consent: hold todos 10-13, continue Track E only, and report. Note for the report: under (b) or a held answer, IS-1/IS-2 and the idle half of the todo 15 A/B may not be delivered; that is Luke's choice and is stated as such in the final summary, not as a pass.
  Closes: GAP-7 (decision)
  Parallelization: Wave 3 | Blocked by: 8 | Blocks: 10
  References (executor has NO interview context - be exhaustive): todo 8 evidence; .omo/ulw-research/20261024-181357/claim-graph.md (C1a, C17, C40); liveliness.ts:91-120; gates.ts:13-14,48-50,85; docs/ai/adr/2026-10-20-motion-qa-levels.md:28-30; docs/ai/adr/2026-10-21-scorer-validation-protocol-2.md:29.
  Acceptance criteria (agent-executable): Luke's answer recorded verbatim in the todo log and evidence file.
  QA scenarios (name the exact tool + invocation): happy - answer (a) or (b) recorded; failure - timeout recorded and todos 10-13 held. Evidence .omo/evidence/natural-motion-quality/task-9-natural-motion-quality.md.
  Commit: N | -

- [~] 10. Apply the gate decision (Track I)
  Gap: blocked by 9 (no gate answer); not started.
  Recommended task executor category: deep-low
  What to do / Must NOT do: If (a): TDD - first a failing test in liveliness.test.ts/liveliness-gate.test.ts that generated-mode scoring reports `jitter` and `speedPeakLogAsymmetry` values but excludes them from gated pass/fail, and that `naturalIdleLivelinessGate.version === 2`. Then follow both halves of the existing report-only pattern for generated mouth-opening SD: (1) in `liveliness.ts` add a `band: null` generated override for `jitter` and `speedPeakLogAsymmetry` next to `generatedMouthOpenBand` (~:105-115; doc comment: why these two are report-only for generated motion, the tracker-noise uncertainty, Luke's decision date); (2) in `gates.ts` remove `'jitter'` and `'speedPeakLogAsymmetry'` from `naturalIdleLivelinessGate.metrics` (~:65,70), bump `version` to 2 with a header comment; update `liveliness-gate.test.ts` `previousGatedMetrics` pin and band equality (~:19-48, :116-119). Note in the todo 16 ADR that null bands also drop these metrics from the composite liveliness score (liveliness.ts ~:397-408), so score values move. Commit this BEFORE running any changed gate (motion-qa rule), then run `pnpm qa:motion gate liveliness --level t1 --fresh` on the unchanged motion (must PASS). If (b): no code; record the rule "commit a step only if its packet passes every gated metric" in the todo log; mark this todo [~] with that reason. Must NOT edit reference-stats.ts, extract-natural-reference.ts, or any still band.
  Closes: GAP-7
  Parallelization: Wave 4 | Blocked by: 9 | Blocks: 11
  References (executor has NO interview context - be exhaustive): liveliness.ts:91-120 (generated overrides and report-only mouth SD), :296-388 (scoreLiveliness, gated vs reported); gates.ts:13-14,48-50,83-85; liveliness-gate.test.ts:20-40,116-119,145; packages/qa-tools/src/motion/gate/aggregate.ts:81-88 (aggregateLiveliness - check it reads the gated list, not all metrics).
  Acceptance criteria (agent-executable): (a) new test fails before, passes after; T1 liveliness PASS; qa-tools tests `pnpm qa:test --all` show no new failures vs packages/qa-tools/known-failures.json. (b) todo log records the rule.
  QA scenarios (name the exact tool + invocation): happy - T1 liveliness report no longer contains jitter/speedPeakLogAsymmetry rows and passes, while a scratch script calling `scoreLiveliness` on the run's partial traces prints both values (reported, not gated); failure - removing the override makes the new test fail. Evidence .omo/evidence/natural-motion-quality/task-10-natural-motion-quality.md.
  Commit: Y (a only) | test(stage-ui-live2d): report generated head jitter and speed-peak asymmetry without gating

- [~] 11. Retune the continuous head OU slower and smoother (Track I)
  Gap: blocked by 9 (no gate answer); not started.
  Recommended task executor category: deep-low
  What to do / Must NOT do: In `posture.ts` constructor change the three continuous `FilteredOu` constructions from `(0.012, 0.20, 0.06)`, `(0.010, 0.24, 0.07)`, `(0.005, 0.32, 0.09)` to `(0.0192, 1.00, 0.12)`, `(0.016, 1.20, 0.14)`, `(0.008, 1.60, 0.18)` (sd x1.6, tau x5, filterTau x2), replacing the tuning comment with the new rationale (research C40, todo 8 packet). Same stream, same draw count. Add a unit test asserting the stationary SD of each continuous axis over a long seeded run matches its configured sd within 5%. Run the metric packet and the full package tests; under (b) commit only if every gated liveliness metric passes, otherwise mark [~] with the packet as reason and stop Track I. Re-pin idle + emotion hashes. Update the README posture bullet.
  Closes: GAP-1
  Parallelization: Wave 5 | Blocked by: 10 | Blocks: 12
  References (executor has NO interview context - be exhaustive): posture.ts constructor (continuous FilteredOu, ~:84-92 after bcdfd23cb); processes.ts FilteredOu; liveliness.ts:270-277 (jitter), :318-328; liveliness-gate.test.ts:116,119,145; reference-stats.ts:239-246,259-261.
  Acceptance criteria (agent-executable): packet saved with per-seed verdicts; all package tests pass (including liveliness-gate.test.ts under the todo 10 decision); hashes re-pinned.
  QA scenarios (name the exact tool + invocation): happy - yaw q25 lower than todo 8 arm A; failure - a gated metric failing is reported before commit. Evidence .omo/evidence/natural-motion-quality/task-11-natural-motion-quality.md.
  Commit: Y | feat(stage-ui-live2d): slow and smooth the continuous head motion

- [~] 12. Draw posture holds from the recorded human distribution (Track I)
  Gap: blocked by 9 (no gate answer); not started.
  Recommended task executor category: deep-low
  What to do / Must NOT do: TDD for the draw contract: first a failing test that one `drawHold` call consumes exactly 2 uniform values from the shift stream (one `gaussian`, which uses two uniforms - random.ts ~:29-33; isolate `drawHold` by calling it directly through an `as unknown as` cast with a counting stream, because `beginShift` also draws a variable number via `truncatedLognormal` rejection and `unitVector3`) and returns values in `[0.1, 15] / (1.5 * shiftRateScale)`; median over 5,000 seeded holds within 10% of `exp(-0.82) / 1.5`. Then replace `drawHold()` with `Math.min(15, Math.max(0.1, Math.exp(-0.82 + 1.02 * gaussian(this.shiftRandom)))) / (1.5 * this.shiftRateScale)` (import `gaussian` from `./random`), documenting the source (Luke's desk recordings, moves above 2 deg/s merged at 0.1 s; holds median 0.37 s). Run the packet and package tests; same (b) rule as todo 11. Re-pin hashes.
  Closes: GAP-1
  Parallelization: Wave 6 | Blocked by: 11 | Blocks: 13
  References (executor has NO interview context - be exhaustive): posture.ts drawHold (~:168-170), random.ts (gaussian, truncatedLognormal), .temp/ulw-ablation/steps.ts:90-93,109-111; .omo/ulw-research/20261024-181357/verify-wave3-step-regimes.md Step 1 table.
  Acceptance criteria (agent-executable): draw-count test passes; packet saved; package tests pass; hashes re-pinned.
  QA scenarios (name the exact tool + invocation): happy - packet shows still05/still2 in band at the median; failure - draw-count test fails if a rejection loop is used. Evidence .omo/evidence/natural-motion-quality/task-12-natural-motion-quality.md.
  Commit: Y | feat(stage-ui-live2d): draw posture holds from recorded human pauses

- [~] 13. Add the shifts-only activity regime on a new stream (Track I)
  Gap: blocked by 9 (no gate answer); not started.
  Recommended task executor category: deep-low
  What to do / Must NOT do: TDD for mechanics first: (a) with the regime disabled (sRate = sAmp = 0, giving rate = amp = 1 exactly) frames are bit-identical to the todo 12 commit for a fixed seed; (b) across two different regime seeds the sequence of shift directions per `shiftCount` is identical (shift stream alignment preserved); (c) a counting wrapper shows the regime stream draws exactly once per step; (d) the regime never changes continuous motion (continuous term identical between regime seeds). Then implement in `posture.ts`: add `regime: RandomStream` to `PostureStreams`; a private unit OU `x` (tau 120 s, exact discretization, one gaussian per step from the regime stream); per step `regimeRate = exp(sRate x - sRate^2 / 2)`, `regimeAmp = exp(sAmp x - sAmp^2 / 2)` with constants `sRate = 0.8`, `sAmp = 0.6` (so setting both to 0 gives rate = amp = 1 exactly, which test (a) uses); during holds advance `nextShiftAt -= (regimeRate - 1) * dt` but never below the current time; in `beginShift` multiply the drawn amplitude by `regimeAmp` latched at that moment. In `natural-motion.ts` append `regime: 14` to `streamIndex` (append-only) and pass `stream('regime')`; update every other `NaturalPostureLayers` construction (`git grep -n "new NaturalPostureLayers"`, known: gaze.test.ts ~:29, speech-emphasis.test.ts ~:30,63) to pass a regime stream. Check interactions with the gesture postpone rule (natural-motion.ts ~:459-464), `holdCarry` (posture.ts advanceShift) and gaze-leads-shift timing (gaze.test.ts ~:28-36); the never-earlier-than-now clamp keeps postponed shifts valid. Run the packet (expect CV60 >= 0.39) and package tests; same (b) rule. Re-pin hashes. README posture bullet mentions activity spells.
  Closes: GAP-2
  Parallelization: Wave 7 | Blocked by: 12 | Blocks: 14
  References (executor has NO interview context - be exhaustive): posture.ts (PostureStreams ~:20-26, constructor, step, beginShift), natural-motion.ts streamIndex (~:41-43) and stream() helper; .temp/ulw-ablation/steps.ts:64-86 (regime prototype); processes.ts OU discretization; verify-wave3-step-regimes.md (R4 row).
  Acceptance criteria (agent-executable): tests (a)-(d) pass; packet CV60 recorded; package tests pass; hashes re-pinned.
  QA scenarios (name the exact tool + invocation): happy - packet CV60 >= 0.39 and yaw q25 <= 1.6x recordings; failure - test (a) catches any accidental draw on existing streams. Evidence .omo/evidence/natural-motion-quality/task-13-natural-motion-quality.md.
  Commit: Y | feat(stage-ui-live2d): add slow activity spells to posture shifts

- [x] 14. Combine the tracks
  Orchestrator note (2026-10-25): combined Track E only (ff luke/feat/natural-idle-reshape to 7bc5156c7) because Luke's todo 9 gate answer timed out 3 times; todos 9-13 stay open. Idle metrics unchanged from baseline (yaw >=0.25 deg reversals 3.88x recordings, CV60 0.147).
  Recommended task executor category: deep-low
  What to do / Must NOT do: In the Track I worktree, `git rebase luke/feat/natural-emotion-clips`. Resolve `posture.ts` by keeping both Track E's additive members (`continuousScale`, `slowPose`) and Track I's constants/holds/regime. Expect an `observer.test.ts` hash conflict on every replayed Track I commit: resolve each by taking either side (the intermediate commits carry stale pins), then re-pin once on the final combined tip from Vitest `Received:` values; re-run every todo's unit tests on the combined tip. Run package checks, `pnpm verify`, `pnpm qa:motion gate emotion --level t1 --fresh`, `pnpm qa:motion gate liveliness --level t1 --fresh`, the hold-onset scratch check (0 events/h), and the metric packet on the combined tip. Leave `luke/feat/natural-emotion-clips` as is; the combined branch is `luke/feat/natural-idle-reshape`. Must NOT merge into main or push.
  Closes: IS-1..IS-9 (integration)
  Parallelization: Wave 8 | Blocked by: 7, and 13 or a recorded stop of Track I (under (b) whatever Track I landed, possibly nothing; under a held todo 9 answer, combine Track E alone and say so in the todo 15 A/B package) | Blocks: 15, 16
  References (executor has NO interview context - be exhaustive): todos 2-13 commits; observer.test.ts.
  Acceptance criteria (agent-executable): rebase complete with no conflict markers (`git grep -n "<<<<<<<"` empty); all checks and both T1 gates PASS; packet saved.
  QA scenarios (name the exact tool + invocation): happy - both gates PASS; failure - a gate FAIL stops for orchestrator review with values. Evidence .omo/evidence/natural-motion-quality/task-14-natural-motion-quality.md.
  Commit: Y | test(stage-ui-live2d): re-pin golden motion hashes for the combined motion (only if the rebase changed hashes)

- [x] 15. Rendered QA and the A/B package for Luke
  Orchestrator note (2026-10-25): T3 warning delivered via question tool (no reply; recommended run-when-ready adopted). T3 emotion PASS, smoke PASS, liveliness FAIL 18/5 (idle too still on the rendered rig) attributed as pre-existing rig/render transfer, not Track E. A/B package excludes the idle reshape (todo 9 held).
  Recommended task executor category: deep-low
  What to do / Must NOT do: Warn Luke through the question tool before starting (T3 needs a visible, undisturbed desktop for several minutes per capture). On the combined tip: `pnpm qa:motion gate emotion --level t2 --rig forbooth`, `pnpm qa:motion gate liveliness --level t3 --rig forbooth`, `pnpm qa:motion gate emotion --level t3 --rig forbooth --t1-report <fresh T1 run dir from todo 14>`, and `pnpm qa:motion t3 --rig forbooth --scenario builtin:t3-smoke`; `pnpm qa:report` each. Then prepare the A/B package: a short markdown in evidence telling Luke how to run main and the combined branch side by side (`pnpm dev:tamagotchi` in the main checkout and in the Track I worktree, same model, same widget size), what to watch (idle holds, spells over a few minutes, an angry and a happy emotion, mouth/lid, eyes during idle), and T3 screenshot paths. Must NOT run T3 overlapping builds/browser suites/lint; respect the `exclusive` CPU slot.
  Closes: GAP-8; IS-10
  Parallelization: Wave 9 | Blocked by: 14 | Blocks: 16
  References (executor has NO interview context - be exhaustive): .agents/skills/motion-qa/SKILL.md (T3 rules, limitations wording); packages/qa-tools/README.md; gates.ts:173,188 (T3 emotion cells).
  Acceptance criteria (agent-executable): gate verdicts recorded with limitations wording; A/B markdown written.
  QA scenarios (name the exact tool + invocation): happy - T2/T3 verdicts PASS or findings listed; failure - an interrupted capture (cursor moved, occlusion) is rerun once and noted. Evidence .omo/evidence/natural-motion-quality/task-15-natural-motion-quality.md.
  Commit: N | -

- [x] 16. Record the design in an ADR and finish docs
  Recommended task executor category: writing
  What to do / Must NOT do: On the combined branch write `docs/ai/adr/2026-10-25-natural-idle-reshape-and-emotion-ducking.md` (context: research session .omo/ulw-research/20261024-181357; decisions: hold-latched gain, face low-pass, boost removal, duck, chuckle, slow-head eye compensation, OU retune, human holds, shifts-only regime, gate decision from todo 9 with date; consequences; measured numbers with protocols; the limitations wording). Cross-link from docs/ai/adr/2026-10-19-natural-emotion-revamp.md and 2026-10-17-natural-motion-v2-performance-state.md where their statements are superseded. Verify README sections touched by todos 2-11 are consistent. Prose rules: AGENTS.md Unique Styles. Must NOT add new behavior.
  Closes: IS-8 (record)
  Parallelization: Wave 10 | Blocked by: 15 | Blocks: F1-F4
  References (executor has NO interview context - be exhaustive): docs/ai/adr/ (existing ADR format), todos 2-15 evidence, .omo/ulw-research/20261024-181357/report.md.
  Acceptance criteria (agent-executable): ADR exists; `pnpm exec eslint` (markdown lint if configured) passes; every number in the ADR matches an evidence file.
  QA scenarios (name the exact tool + invocation): happy - grep each number from the ADR in evidence files; failure - any unmatched number fixed before commit. Evidence .omo/evidence/natural-motion-quality/task-16-natural-motion-quality.md.
  Commit: Y | docs(stage-ui-live2d): record the idle reshape and emotion ducking design

- [x] 17. Fix the F2 code-review blockers on the combined branch (follow-up)
  Recommended task executor category: deep-low
  What to do / Must NOT do: Appended by the orchestrator from F2 (st_01a171e8, .omo/evidence/natural-motion-quality/final-f2-code-review.md). On luke/feat/natural-idle-reshape in C:/Users/Luke/projects/dtuber-wt/natural-motion-improvements, after todo 15's T3 runs have finished (never edit while T3 runs). B1: energy.react(at, intensity) is only ever called with 1 - drop the dead intensity parameter, clamp and per-entry amplitude/rate (keep the fixed reacting overlay; overlapping reactions do not stack), update callers, energy.test.ts, natural-motion.test.ts:108 and ADR 2026-10-18:135; output must stay bit-identical (no hash re-pin). B2: docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md:146 still says impulses raise posture amplitude/shift rate - reword (desktop reactions and pokes only; link 2026-10-18). B3: un-export createClip (test-only export) and rewrite the activeSpan test on the public NaturalGestures API. Also fix the doc notes: gaze.ts:15 'applied head pose' -> slow head pose; README Gaze bullet lists every slow-pose term; observer.test.ts:11-13 comment names all motion changes that moved pins. New Conventional Commits on the combined branch (no history rewrite; leave luke/feat/natural-emotion-clips as is). Must NOT change motion.
  Acceptance criteria (agent-executable): observer.test.ts hashes unchanged; package checks + pnpm verify --force exit 0; git grep shows createClip not exported; F2 re-review APPROVE.
  Parallelization: after 15 | Blocks: F1-F4
  Commit: Y | refactor(stage-ui-live2d): drop the dead reaction intensity and test-only clip export

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Recommended task executor category: unspecified-high
  Read this plan and `git log bcdfd23cb..luke/feat/natural-idle-reshape` (which contains the Track E commits after todo 14); map every todo's Must / Must NOT items and acceptance commands to receipts in .omo/evidence/natural-motion-quality/.
- [x] F2. Code quality review
  Recommended task executor category: unspecified-high
  Review the combined diff for determinism (no new draws on existing streams), contract docs updated, no dead settings, AGENTS.md TypeScript rules, test quality (no sleeps, deterministic).
- [x] F3. Real manual QA
  Recommended task executor category: unspecified-high
  Re-run on the combined tip: package checks, both T1 gates `--fresh`, and inspect the T3 screenshots from todo 15; report with the limitations wording.
- [x] F4. Ideal-state fidelity
  Recommended task executor category: unspecified-high
  Check delivered behavior against IS-1..IS-10 1:1 using the Success criteria table; any shortfall becomes a new `- [ ] N.` row.

> Merged to main 2026-10-25T15:06:49.530Z: main fast-forwarded 7d011adf2 -> c227af2e7 (branch luke/feat/natural-idle-reshape rebased onto main and re-verified; ADR citations updated to rebased hashes) on Luke's "merge". Not pushed. Todos 9-13 remain [~] (no gate answer).

## Commit strategy
Track E commits (todos 2-6) on `luke/feat/natural-emotion-clips`; Track I commits (10 if option a, 11-13) on `luke/feat/natural-idle-reshape`, rebased onto Track E in todo 14, plus the ADR (16). Conventional Commits, scope `stage-ui-live2d` (todo 3 also touches `stage-shared` - keep scope `stage-ui-live2d` and mention stage-shared in the body). Every motion-changing commit re-pins observer.test.ts hashes (Node-computed) and says why in the body. No merge to main and no push without Luke.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 11, 12, 13, 14 | metric packet yaw q25 vs recordings on the combined tip | .omo/evidence/natural-motion-quality/task-14-natural-motion-quality.md |
| IS-2 | 13, 14 | metric packet CV60 >= 0.39 | .omo/evidence/natural-motion-quality/task-13-natural-motion-quality.md |
| IS-3 | 3, 4 | duck HF RMS scratch check; no-boost unit test | .omo/evidence/natural-motion-quality/task-4-natural-motion-quality.md |
| IS-4 | 5 | laugh shape tests + dominant-frequency scratch check | .omo/evidence/natural-motion-quality/task-5-natural-motion-quality.md |
| IS-5 | 2 | face diff-RMS tests + sd:ParamMouthForm PASS | .omo/evidence/natural-motion-quality/task-2-natural-motion-quality.md |
| IS-6 | 6 | eye invariance tests (b)/(c) + liveliness eye metrics | .omo/evidence/natural-motion-quality/task-6-natural-motion-quality.md |
| IS-7 | 1, 14 | hold-onset 0 events/h on base and combined tip | .omo/evidence/natural-motion-quality/task-14-natural-motion-quality.md |
| IS-8 | 9, 10, 16 | Luke's recorded G1 answer + versioned gate (a) or pass-only commits (b) + ADR | .omo/evidence/natural-motion-quality/task-10-natural-motion-quality.md |
| IS-9 | 4, 12, 13 | stream-alignment and draw-count tests | .omo/evidence/natural-motion-quality/task-13-natural-motion-quality.md |
| IS-10 | 15 | A/B package + T3 screenshots | .omo/evidence/natural-motion-quality/task-15-natural-motion-quality.md |
