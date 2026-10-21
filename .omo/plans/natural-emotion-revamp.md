# natural-emotion-revamp - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** You, watching the companion in the corner of your screen. When she gets angry, sad, happy, shy, or sleepy, her whole face and body show it, and she stays that way while she's talking about it instead of flashing the feeling for a second. An anger mark or hearts never appear on a blank face again, including when you preview them in Settings.

**What you'll get:**
- Strong, readable faces for each emotion that hold for the sentence and then fade.
- A held head and body posture per emotion.
- Short emotion-specific gestures: a laugh bounce, a surprise jolt, an angry shake, a shy look-away, a sleepy nod-off.
- Blinking, breathing, gaze, and speech nods that follow the mood.
- Three new emotions: love, flustered, sleepy.
- A strength slider per emotion for each model.
- A switch to compare against today's behavior.

**Why this approach:** Your rigs' emotional stamps are only decorations, so the app has to supply the face itself, the way your tracked face would in VTube Studio. The emotion is held for exactly as long as the speech or stamp that caused it, using the same timing machinery expressions already use. That keeps it in sync with the stamp and replayable for debugging.

**What it will NOT do:**
- Change Universal or MAGIC motion modes.
- Add a detailed per-parameter face editor or character-card settings.
- Touch your rig files.

**Effort:** Large
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** Medium - the face and gesture values are educated starting points with no recorded reference, so how good it looks depends on the rendered tuning pass and your QA.
**Decisions to sanity-check:**
- The body now leans a little at normal-strength emotions, not only at strong ones.
- A Blush or Hearts expression saved as a default never makes her look flustered or in love; only toggling it on in preview does.
- On other renderers, love falls back to Happy, flustered to Awkward, and sleepy to Idle.

Your next move: run the plan review, then start execution with `/ulw-execute natural-emotion-revamp`. Full execution detail follows below.

---

> TL;DR (machine): Large, Medium risk; 12 todos in 4 waves + F1-F4: emotion vocabulary (+love/flustered/sleepy), decider HoldCommand, hold performer, Natural held layer (face/posture/modulation), gesture clips, per-model strength + heldEmotions switch, conductor/Model plumbing incl. preview manual hold, ADR, rendered ForBOOTH acceptance.

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected user:**
- **U1 (Luke):** watches the Live2D companion in the corner of his screen while chatting, with Natural motion selected. He tunes a model in Settings and previews its expressions.
  - Today: an emotion shows as a ~1.7 s weak face nudge, and an emotional stamp (the anger mark, tears, hearts) sits on a neutral face.
  - After: each emotion is a held, whole-body state with emotion-shaped gestures, and stamps always arrive with their face.
- **U2 (the LLM):** reads the emotion list in the runtime prompt and emits ACT markers and expression tool calls. After this work it can also use `love`, `flustered`, and `sleepy`.
- **U3 (maintainers):** rely on seeded Natural determinism, the liveliness gate, and affect-trace replay. These must keep working.

Rigs: ForBOOTH (`C:/Users/Luke/Documents/Live2d Models/ForBOOTH-231-Holder-only@Do-not-share-or-resell`) and Bear Pajama (`C:/Users/Luke/Documents/Live2d Models/bear Pajama V1.1`). Every emotional `.exp3.json` on both rigs drives exactly one decoration switch parameter: ForBOOTH `expression1` Angry = `Param60`, Crying Eyes = `Param13`, Hearts = `Param47`/`Param51`, Blush (`脸红2`) = `Param85`, Sleepy (`expression13`) = `Param69`; Bear `anger` = `Param9`, `cry` = `Param12`, `love` = `Param95`, `red` = `Param97`. None moves brows, eyes, or mouth. Both rigs expose ParamBrowLY/RY, ParamBrowLAngle/RAngle, ParamEyeLSmile/RSmile, ParamEyeLOpen/ROpen, and ParamMouthForm; only Bear has ParamCheek. Luke's acceptance rule: a rendered gate passing on one rig counts for the other. ForBOOTH is the QA rig.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Each emotion reads unmistakably on the whole face at corner size (brows, eyes, mouth, cheek where present), even when the rig's stamp is decoration-only | The reported defect: an anger mark on a neutral face |
| GAP-1 | Natural face hints are about 20% of half-range (`impulses.ts:57-66`) and exist only for 8 emotions | The face does not read as the emotion |
| IS-2 | The emotional face and posture hold while the emotion is active (the turn's speech, or ~4 s without a turn), then ease out over ~0.6 s; the existing mood leaves a faint afterglow | A corner vtuber stays in a state; it doesn't blink one in |
| GAP-2 | The face holds a fixed 1.2-1.8 s (`settings.ts:72-74`), and Natural receives no lifetime or release signal (conductor scene interface `use-stage-performance-conductor.ts:68-73`) | The face ends long before the stamp or the sentence |
| IS-3 | A stamp mapped to an emotion never shows on a neutral face, whatever turned it on: LLM tool, ACT marker, automatic pick, or a Settings preview toggle | The reported preview mismatch |
| GAP-3 | Explicit expression signals emit only a slot command (`picker.ts:32-39`, `planner.ts:103-116`, `selection.ts:103-108`), the conductor's `expression()` dispatches only slots (`use-stage-performance-conductor.ts:232`), and the manual toggle goes straight to the store (`expression-store.ts:121-153`) | Nothing tells Natural the stamp's emotion |
| IS-4 | The body takes part: a held head/lean bias per emotion (small at clear, larger at strong) that the body follows, and emotion-shaped gestures (laugh bounce, surprise recoil, angry shake or drop, awkward sway, love tilt, flustered look-away, sleepy nod-off) with bounded variation and cooldowns | Alive, not robotic or identical |
| GAP-4 | Body motion is pinned to strong only (`impulses.ts:170-171`, tests `natural-motion.test.ts:13-87`), and every emotion uses the same pulse shape | Clear-band emotions look stiff; repeats look the same |
| IS-5 | Gaze (camera fixation, desk weight), blink interval, breath period, idle amplitude, speech-nod size, and nod acceptance all follow the held emotion | A whole-body state, not a face sticker |
| GAP-5 | No hooks for blink rate (`blink.ts:101-103`), breath period (`breath.ts:66`), nod size (`speech-emphasis.ts:95`), or emotion-specific gaze; only mood's 4 adjustments exist (`natural-motion.ts:328-334`) | Layers ignore the emotion |
| IS-6 | `love`, `flustered`, and `sleepy` are accepted by ACT, listed in the LLM prompt, mappable in the catalog, pulseable in the lab, and performed in Natural; other renderers fall back sensibly (love->Happy, flustered->Awkward, sleepy->Idle/neutral) | Owner decision; hearts, blush, and sleepy stamps need emotions |
| GAP-6 | The vocabulary is closed in ~12 places (see todo 1) | The new names would be dropped |
| IS-7 | Settings show one strength slider per emotion for the selected model (0-2, default 1; 0 disables that emotion's Natural performance), plus a switch to turn held emotions off for A/B comparison | Owner decision: per-model tuning without a recipe editor |
| GAP-7 | No per-model emotion setting; only global switches (`live2d.vue:892-935`) | No tuning surface |
| IS-8 | With no emotion active, Natural output is bit-identical to today and the liveliness gate stays green. With held emotions switched off, emotion behavior equals today's. Universal/MAGIC behavior for existing emotions is unchanged | No regressions |
| GAP-8 | New layers could add random draws or change composition on the idle path | Determinism tests (`natural-motion.test.ts:329-337`, `mood.test.ts:20`) and the gate would break |
| IS-9 | Emotion switches glide (happy to sad without a snap); a same-emotion accent does not saturate the face; petting overrides the held face on the channels it shapes | Layers don't fight |
| GAP-9 | Composition is purely additive (`natural-motion.ts:415-432`) | Saturation and fighting |
| IS-10 | Affect traces still parse and replay; replaying a recorded trace reproduces the new holds | Maintainer tooling keeps working |
| GAP-10 | `PerformanceDecision` has no `holds` field (`types.ts:50-53`), and fixtures compare decisions with `toEqual` | Traces and tests would drift |
| IS-11 | A new ADR and the package READMEs describe the held-emotion contract and explicitly supersede the old non-goals | Docs match code |
| GAP-11 | `docs/ai/adr/2026-10-18-expression-performance.md:416` ("No gesture library and no second settings document") and `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md:177` ("Only the Energy slider ...") contradict the approved scope | Stale docs mislead later work |

### Must have
- A pure, clock-free decider contract: `HoldCommand` in `PerformanceDecision.holds`, emitted by both the picker and the planner.
- A hold performer that reuses the slot-lease functions in `slots.ts`, plus a manual (preview) hold source.
- A Natural hold layer: face recipes, posture bias, and modulation of blink, breath, gaze, amplitude, nod size, and acceptance, all from ONE typed per-emotion table (`natural-motion/emotions.ts`, `satisfies Record<PerformanceEmotion, ...>`).
- A Natural gesture engine on a NEW random stream index `gestures: 12` appended to `streamIndex` (`natural-motion.ts:73`).
- The new emotion names `love`, `flustered`, `sleepy` everywhere the vocabulary is closed.
- A per-model strength setting `settings/live2d/natural-emotion-strength` and a `heldEmotions` switch in the performance document, both with UI and English i18n.
- A new ADR, README updates, and superseding notes.
- Rendered QA on ForBOOTH.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No change to Universal or MAGIC behavior for the existing nine emotions; the new names only add fallback entries.
- No per-parameter recipe editor, no character-card fields, and no new settings beyond `heldEmotions` + `held` tunables (no UI for the tunables) + the per-model strength record.
- No new random draws, and no changed draw order, on the idle path. Existing stream indices 0-11 keep their meaning.
- No edits to rig files, `.model3.json`, or `.vtube.json`; rigs are loaded as temporary ZIP imports in QA.
- No edits to locales other than English (`packages/i18n/src/locales/en/**`).
- No `package.json`/lockfile changes, no new dependencies, and no `tsconfig` suppressions.
- The main checkout `C:/Users/Luke/projects/dtuber` was cleaned and committed on 2026-10-19 (`0c2b567`, `37d1268`, `0096d06`, `961253b`). Work only in the task worktree. Never edit, stage, or commit in the main checkout, except that the orchestrator updates this plan and its draft under `.omo/`.
- No compatibility shims for old stored settings: new settings fields are optional with defaults, so stored documents stay valid.
- No Kirie (`apps/stage-tamagotchi-kirie/**`) edits beyond what typecheck forces. If typecheck forces one, stop and report it instead of editing.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after within each todo (owner decision), using Vitest. Every todo ships its own tests in the same commit. Tests follow `.agents/skills/enforce-rules-for-vitest/SKILL.md`: no sleeps, seeded randomness, real stores, no private-field reads.
- Package commands (run from the worktree root):
  - `pnpm -F @proj-airi/stage-shared exec vitest run`
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` (node + browser projects)
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project node <path>` / `--project browser <path>`
  - `pnpm -F @proj-airi/pipelines-audio exec vitest run`
  - typecheck: `pnpm -F <pkg> typecheck`
  - Root `pnpm typecheck` and `pnpm lint` ONLY in todo 12 and in F-wave runs (memory pressure: never run two heavyweight checks at once).
- Baseline: before todo 1, run the four package suites on the base commit and record failures to `.omo/evidence/natural-emotion-revamp/task-0-baseline.txt`. `.omo/slop/report.md:46-49` lists earlier stage-shared and stage-ui failures; a failure present at base is pre-existing, never "fixed" by deletion or skip.
- Worktree prerequisites: in a fresh worktree, run `pnpm install --frozen-lockfile`, then `pnpm run build:packages` (packages resolve dist folders; pipelines-audio and core-agent dist must exist before downstream typecheck). Restore `integrations/vscode/vscode-airi/package.json` if install modifies it.
- Rendered QA (todo 12, F3):
  - Run Electron from the worktree with an isolated profile: `APP_USER_DATA_PATH=<temp dir>`, remote debugging on a free port, no saved profile reuse (pattern: `.omo/plans/live2d-presence-v1.md:352-358`).
  - Import ForBOOTH as a temporary ZIP of the rig folder, select the Natural motion driver, turn on the Expression setting, and confirm catalog mappings through the UI.
  - Fire emotions from the devtools Natural lab (`packages/stage-ui/src/features/devtools/motion/natural/components/emotion-pulses.vue`).
  - Capture post-physics parameter traces through the lab trace capture (`.omo/plans/live2d-presence-v2.md:600-635`) and screenshots at the corner window size, using CDP or `.agents/skills/use-vishot/SKILL.md`.
  - Evidence goes to `.omo/evidence/natural-emotion-revamp/task-<N>-<name>.<ext>`.
- Evidence: `.omo/evidence/natural-emotion-revamp/task-<N>-<name>.<ext>`. Command receipts must include the exact command, exit code, and pass/fail counts.

## Execution strategy
Integration branch `luke/feat/natural-emotion-revamp` lives in the worktree `C:/Users/Luke/projects/dtuber-wt/natural-emotion-revamp`. It is created from the current `main` tip, which must contain the repo-prep commit `961253b74025f77d3c76b75497efd0e658c20390`. Later `main` commits that only change `.omo/plans/natural-emotion-revamp.md` or its draft are expected; anything else on `main` beyond that commit must be reported before branching.
- Create it with:
  - `git -C C:/Users/Luke/projects/dtuber merge-base --is-ancestor 961253b74025f77d3c76b75497efd0e658c20390 main` (exit 0 required);
  - `git -C C:/Users/Luke/projects/dtuber worktree add -b luke/feat/natural-emotion-revamp C:/Users/Luke/projects/dtuber-wt/natural-emotion-revamp main`.
- Record the resolved base SHA in `.omo/evidence/natural-emotion-revamp/task-0-baseline.txt`.
- Delivery is direct (no push, no PR). Parallel todos run in per-todo worktrees branched from the integration branch and are fast-forwarded or cherry-picked after an independent gate.

Worker routing note: in this environment some omo categories have routed to unavailable providers. If a category fails at dispatch, re-route to a working category (`deep-low` or `unspecified-high`); that is a harness failure, not an attempt.

### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.
- **Wave 0 (contracts, vocabulary first):** todo 1, then todos 2 and 3 in parallel. They touch different packages: 2 is stage-ui-live2d `natural-motion/`, 3 is stage-shared.
- **Wave 1 (parallel, isolated lanes):** todos 4 (stage-shared deciders), 5 (stage-ui-live2d `expression/hold.ts`), 6 (stage-ui-live2d `natural-motion/hold.ts`, `blink.ts`, `breath.ts`, `speech-emphasis.ts`), 7 (stage-ui-live2d `natural-motion/gestures.ts`), 8 (settings store, UI, i18n).
  - Execution ownership correction: todos 6 and 7 both edit `natural-motion/emotions.ts`. Split todo 7 into independently verified units: 7a implements the gesture engine, tests, and any required `GestureKind` union addition, but does not populate table mappings; 7b populates the gesture mappings after the held-recipe changes from todo 6 and the verified 7a engine have landed. The initial five lanes remain parallel, with only the final gesture-table mapping stage serialized. Root alone integrates each verified unit.
- **Wave 2 (integration, serial):** todo 9 (facade `natural-motion.ts`), then todo 10 (adapter, Model.vue, Live2D.vue, conductor).
- **Wave 3 (docs + acceptance, parallel):** todos 11 and 12.
- **Final wave:** F1-F4.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 2,3,8 | - |
| 2 | 1 | 6,7,9 | 3 |
| 3 | 1 | 4,5,6,8,9 | 2 |
| 4 | 3 | 10 | 5,6,7,8 |
| 5 | 3 | 10 | 4,6,7,8 |
| 6 | 2,3 | 9 | 4,5,7,8 |
| 7 | 2 | 9 | 4,5,6,8 |
| 8 | 1,3 | 10 | 4,5,6,7 |
| 9 | 3,6,7 | 10 | - |
| 10 | 4,5,8,9 | 11,12 | - |
| 11 | 10 | F1-F4 | 12 |
| 12 | 10 | F1-F4 | 11 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Add the love, flustered, and sleepy emotions to every closed vocabulary
  What to do:
  - Before editing, record the baseline suite results (see Verification strategy) to `task-0-baseline.txt`.
  - Add `Love = 'love'`, `Flustered = 'flustered'`, `Sleepy = 'sleepy'` to BOTH `Emotion` enums: `packages/stage-ui-live2d/src/constants/emotions.ts:1-11` and `packages/stage-ui/src/constants/emotions.ts:1-11`.
  - In both files, give `EMOTION_EmotionMotionName_value` the fallbacks love->`EmotionHappyMotionName`, flustered->`EmotionAwkwardMotionName`, sleepy->`EmotionNeutralMotionName` (`Idle`).
  - VRM maps: in stage-ui-live2d copy love->'happy', flustered->undefined, sleepy->undefined; in stage-ui copy love->'happy', flustered->'neutral', sleepy->'relaxed'.
  - Spine `EMOTION_SpineAnimationName_value` (stage-ui `constants/emotions.ts:49-59` and `packages/stage-ui-spine/src/constants/emotions.ts:56-66`): love->Happy's value, flustered->Awkward's value, sleepy->Neutral's value.
  - MMD `EMOTION_ACTION_NAME` (`packages/stage-ui-mmd/src/constants/actions.ts:12-22`) and `EMOTION_MORPHS` (`packages/stage-ui-mmd/src/constants/morphs.ts:85-120`): copy Happy's entry for love, Awkward's for flustered, Neutral's for sleepy.
  - Leave non-exhaustive subsets, such as Tachie (`packages/stage-ui-tachie/src/constants/emotions.ts`), unchanged unless typecheck requires an entry; if it does, use the same fallbacks.
  - Add a prompt-description record `EMOTION_PromptName_value` in `packages/stage-ui/src/constants/emotions.ts`. It holds exactly the current motion-name strings for the nine existing emotions, plus 'Love', 'Flustered', 'Sleepy'. Switch `packages/stage-ui/src/composables/use-airi-runtime-prompt.ts:52-54` to use it, so the prompt text for existing emotions stays byte-identical.
  - ACT: add the names to `emotionValues` in `packages/pipelines-audio/src/llm-streaming-control/payloads.ts:6-16`. Add cases in `toStageEmotionPayload` (`packages/stage-ui/src/components/scenes/Stage.vue:346-369`).
  - Performance: add to `PerformanceEmotion` (`packages/stage-shared/src/expression-performance/types.ts:4`), the mapping picklist (`catalog.ts:15-18`), the accepted-name guard (`reaction-strength.ts:49-51`), and the trace picklist (`trace.ts:7-14`).
  - Mood coefficients (`packages/stage-ui-live2d/src/composables/live2d/natural-motion/mood.ts:5-15`): love [0.6, 0.2, -0.1], flustered [0.2, 0.5, 0.4], sleepy [0, -0.6, -0.2].
  - Impulse table (`impulses.ts:57-66`):
    - love: `{ head: [0, 0.3, 0.6], sided: [2], hints: { eyeSmile: 0.5, mouthForm: 0.4 } }`
    - flustered: `{ head: [0.4, -0.3, 0.3], sided: [0, 2], hints: { eyeSmile: 0.3, browAngle: 0.2 }, glance: { x: 0.35, y: -0.15 } }`
    - sleepy: `{ head: [0, -0.5, 0.2], sided: [2], hints: { eyeOpen: -0.15 } }`
  - Mapping picker options: `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d-expression-entry.vue:41-43`.
  - English labels: `packages/i18n/src/locales/en/settings.yaml:322-330`, the lab emotion names in `packages/i18n/src/locales/en/tamagotchi/settings.yaml:230-273`, and any emotion-name keys in `packages/i18n/src/locales/en/base.yaml:41-50,64-78` that enumerate per-emotion labels.
  Must NOT do: change any value for the existing nine emotions; edit non-English locales; change motion-group behavior for existing emotions.
  Closes: GAP-6 (part of IS-6, IS-8)
  Parallelization: Wave 0 | Blocked by: - | Blocks: 2, 3, 8
  References:
  - `packages/stage-ui-live2d/src/constants/emotions.ts:1-47`, `packages/stage-ui/src/constants/emotions.ts:1-59`
  - `packages/pipelines-audio/src/llm-streaming-control/payloads.ts:1-60` (+ tests `payloads.test.ts:12-38`, `index.test.ts:6-14`)
  - `packages/stage-ui/src/components/scenes/Stage.vue:346-369`
  - `packages/stage-ui/src/composables/use-airi-runtime-prompt.ts:41-57`
  - `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts:193-212` (validates against `EMOTION_VALUES` and plays `EMOTION_EmotionMotionName_value` for Universal/MAGIC)
  - `packages/stage-ui/src/features/devtools/motion/natural/components/emotion-pulses.vue:40-48` (iterates stage-ui-live2d `EMOTION_VALUES`)
  - `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:430-434` (Universal motion discovery)
  - `packages/stage-ui-mmd/src/constants/morphs.test.ts:7-20`
  - `packages/stage-ui-live2d/src/composables/live2d/natural-motion/impulses.test.ts:48-53` (iterates `EMOTION_VALUES` for head-peak bounds)
  Acceptance criteria:
  - `pnpm -F @proj-airi/pipelines-audio exec vitest run` passes with new cases: `normalizeActPayload({emotion:'Love'})` yields name `love`, and `'Sleepy '` yields `sleepy`.
  - `pnpm -F @proj-airi/stage-shared exec vitest run` passes, and a catalog mapping `{ emotion: 'flustered' }` parses.
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node` passes, including `impulses.test.ts` bounds for the new emotions.
  - stage-ui: a node test asserts that the runtime prompt contains `- love (Emotion for feeling Love)` and that the existing nine lines are byte-identical to the base output.
  - Typecheck passes for stage-shared, stage-ui-live2d, stage-ui, stage-ui-mmd, stage-ui-spine, stage-ui-tachie, and pipelines-audio (`pnpm -F <pkg> typecheck`).
  QA scenarios:
  - Happy: run the four suites; receipt `task-1-tests.txt`.
  - Failure: `normalizeActPayload({emotion:'lovey'})` still yields no emotion (unsupported names are dropped); asserted in the payload tests; receipt in `task-1-tests.txt`.
  - Grep receipt `task-1-vocab.txt`: `git grep -n "'curious'"` across packages, where every closed list that contains `curious` also contains `sleepy`.
  Commit: Y | feat(stage-shared): add love, flustered, and sleepy emotions
  Recommended task executor category: deep-low - mechanical but wide, with many exhaustive records; decisions are fully specified.

- [x] 2. Consolidate the per-emotion Natural tables into one typed module
  What to do:
  - Create `packages/stage-ui-live2d/src/composables/live2d/natural-motion/emotions.ts` exporting `naturalEmotions satisfies Record<PerformanceEmotion, NaturalEmotionSpec>`.
  - `NaturalEmotionSpec` = `{ impulse?: EmotionSpec (moved from impulses.ts:43-66), mood: readonly [number, number, number] (moved from mood.ts:5-15), held?: HeldSpec, gesture?: GestureKind }`.
  - `HeldSpec` and `GestureKind` are declared in this file with the shapes todos 6 and 7 fill. Until then, every `held` and `gesture` entry is undefined; neutral has neither.
  - `impulses.ts` and `mood.ts` read from this table. This is a pure move with no value changes.
  - Declare `HeldSpec` exactly:
    - `face: { browY: number, browAngle: number, oneSidedBrow?: number, eyeSmile: number, mouthForm: number, eyeOpenMultiplier: number, eyeOpenHint: number, cheek: number, mouthOpen: number }`
    - `posture: Vec3`, `sided: (0 | 1 | 2)[]`
    - `modulation: { blinkInterval: number, breathPeriod: number, amplitude: number, cameraFixation: number, deskWeight: number, nodSize: number, nodAcceptance: number }`
    - Multipliers equal 1 at rest; `cameraFixation`, `deskWeight`, and `nodAcceptance` are additive deltas that equal 0 at rest.
  Must NOT do: change any numeric value, the draw order, or the call order in `impulses.ts`/`mood.ts`.
  Closes: groundwork for GAP-1/4/5/8
  Parallelization: Wave 0 | Blocked by: 1 | Blocks: 6, 7, 9
  References:
  - `packages/stage-ui-live2d/src/composables/live2d/natural-motion/impulses.ts:43-66`
  - `natural-motion/mood.ts:5-15`
  - `natural-motion.test.ts:329-337` (bit-identity), `mood.test.ts:20`
  - `natural-motion/liveliness-gate.test.ts`
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node` passes with zero changed expectations.
  - `pnpm -F @proj-airi/stage-ui-live2d typecheck` passes.
  - Deleting any emotion key from `naturalEmotions` makes typecheck fail.
  QA scenarios:
  - Happy: suites green, receipt `task-2-tests.txt`.
  - Failure (mutation): temporarily remove the `sleepy` row, run typecheck, and record the TS error in `task-2-mutation.txt`, then restore.
  Commit: Y | refactor(stage-ui-live2d): consolidate Natural emotion tables
  Recommended task executor category: deep-low - a contained refactor with strict no-behavior-change proof.

- [x] 3. Add the hold contract and held-emotion settings to stage-shared
  What to do:
  - In `packages/stage-shared/src/expression-performance/types.ts`:
    - Add `HoldCommand = { emotion: PerformanceEmotion | null, strength: number, holdSeconds: number, until: 'speech' | 'hold', turnId?: string }`; `emotion: null` releases the hold.
    - Add the required field `holds: HoldCommand[]` to `PerformanceDecision` (`:50-53`).
  - Update every construction of a decision in picker, planner, scheduler, selection, and trace replay to include `holds: []` (no hold logic yet; todo 4 adds it).
  - In `settings.ts`:
    - Add `heldEmotions: optional(boolean(), true)` next to the switches at `:180-189`. False means today's emotion behavior.
    - Add `held: optional(heldSchema, ...)` with `turnlessSeconds` (default 4), `onsetTau` (default 0.25 s), `releaseTau` (default 0.6 s), `accentScale` (default 0.5, range 0-1), `postureTau` (default 0.6 s), using the existing `seconds()`/`unit()` helpers.
    - Export the `HoldCommand` type through the package index.
  - Update decider, trace, and settings test fixtures that use `toEqual` on decisions to include `holds: []`.
  Must NOT do: emit any non-empty holds; change trace signal schemas; remove or rename existing settings.
  Closes: GAP-10 (contract), part of GAP-2/GAP-7
  Parallelization: Wave 0 | Blocked by: 1 | Blocks: 4, 5, 6, 8, 9
  References:
  - `packages/stage-shared/src/expression-performance/types.ts:4-69`
  - `settings.ts:55-75` (band schema helpers), `:180-217`
  - `picker.ts:30-78`, `planner.ts:51-160`
  - `trace.ts:86-113` (replay output)
  - `settings.test.ts`, `picker.test.ts`, `planner.test.ts`, `trace.test.ts`
  - stage-ui consumers of `PerformanceDecision`: `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts:472-489` (spread keeps holds)
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-shared exec vitest run` passes; failures not in `task-0-baseline.txt` count as regressions.
  - `pnpm -F @proj-airi/stage-shared typecheck` and `pnpm -F @proj-airi/stage-ui typecheck` pass.
  - A settings test asserts that `parseExpressionPerformanceSettings({})` yields `heldEmotions: true` and `held.turnlessSeconds: 4`, and that a stored document without these fields still parses.
  QA scenarios:
  - Happy: suites green, receipt `task-3-tests.txt`.
  - Failure: `parseExpressionPerformanceSettings({ held: { turnlessSeconds: -1 } })` returns `success: false` with the default document (asserted).
  Commit: Y | feat(stage-shared): add emotion hold contract and held-emotion settings
  Recommended task executor category: deep-low - contract change with fixture fan-out inside one package.

- [x] 4. Emit holds from both deciders and derive emotions from explicit expressions
  What to do: in stage-shared, both picker and planner:
  - (a) **Emotion signal with an accepted episode:** push `{ emotion, strength: episode.intensity, holdSeconds, until, turnId }`. Turn-bound signals use `holdSeconds = settings.naturalBands[episode.band].faceHold` and `until: 'speech'`; turnless ones use `holdSeconds = settings.held.turnlessSeconds` and `until: 'hold'`. An escalation pushes a hold with the higher strength.
  - (b) **Neutral that resets reaction state:** push `{ emotion: null, strength: 0, holdSeconds: 0, until: 'hold', turnId }`.
  - (c) **Clear signal with no slot:** push a null hold. A clear naming a slot pushes nothing.
  - (d) **Expression signal whose resolved entry has at least one mapping:**
    - Pick the primary mapping by highest `weight`; ties go to the earliest in the array.
    - Run `acceptReaction(state.reaction, mapping.emotion, ctx.settings.bands ? ctx.settings.intensity[mapping.minBand] : 0.6, signal.at, ctx.settings)` exactly as the emotion path does (`picker.ts:52-61`).
    - Push the episode, if any, and a hold whose `holdSeconds`/`until` equal the slot command's own (`selection.ts:107`), with the same turnId.
    - Do NOT run automatic picks, and keep the existing explicit slot command and occupant updates unchanged.
    - Entries without mappings behave exactly as today.
    - When `heldEmotions` is false, mapped explicit expressions also keep the old slot-only behavior: do not mutate reaction state or emit a derived episode/hold. This preserves the global A/B contract in IS-8; direct emotion episodes still support the old impulse behavior.
  - Put the shared logic in one exported helper in `selection.ts` (`explicitExpressionReaction`) used by both deciders.
  - Add trace tests: (1) a recorded expression signal replays to the same episode and hold; (2) a replay of an emotion-only trace equals the live decisions, including holds.
  Must NOT do: change slot outputs for any existing scenario; read clocks or randomness outside the decider state; touch stage-ui.
  Closes: GAP-2 (decision side), GAP-3 (decision side), GAP-10
  Parallelization: Wave 1 | Blocked by: 3 | Blocks: 10
  References:
  - `packages/stage-shared/src/expression-performance/picker.ts:30-78`
  - `planner.ts:51-160` (expression case `:103-116`, emotion path `:140-158`)
  - `selection.ts:45-120`, `reaction-strength.ts:40-70`
  - `catalog.ts:11-46` (mappings, minBand defaults: clear for faces, strong for effects)
  - `settings.ts:38-43` (intensity nominals: slight 0.25, clear 0.6, strong 0.9)
  - `trace.ts:12-19,86-113`, `trace.test.ts`
  - `profile.ts:67-74` (mapping weight multipliers already applied by the conductor before the decider)
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-shared exec vitest run` passes with new tests:
    - picker and planner emotion `happy` @0.6 with turnId produce a hold of strength 0.6, `until: 'speech'`;
    - a turnless one gets `holdSeconds 4`, `until: 'hold'`;
    - neutral and a slotless clear each produce a null hold;
    - an expression mapped `[{ angry, weight 1, minBand strong }, { sad, weight 0.5 }]` produces an angry episode (band strong) plus a hold mirroring its slot lifetime;
    - an unmapped prop produces no episode and no hold;
    - a slot-named clear produces no hold.
  - Existing slot expectations are unchanged.
  QA scenarios:
  - Happy: suite receipt `task-4-tests.txt`.
  - Failure: an expression whose entry is unknown returns an empty decision (`holds: []`), asserted.
  Commit: Y | feat(stage-shared): decide emotion holds and derive emotions from expressions
  Recommended task executor category: deep-low - pure, well-specified decider logic with replay tests.

- [x] 5. Build the emotion hold performer with lease and manual sources
  What to do:
  - Create `packages/stage-ui-live2d/src/composables/live2d/expression/hold.ts` exporting `class EmotionHoldPerformer`, with:
    - `applyHolds(commands: HoldCommand[], now)`: a null emotion releases; otherwise create a lease via `createLease` from `slots.ts`, carrying the emotion in `expressionId` as `emotion:<name>`, or generalize `SlotLease` with a type parameter without changing its existing behavior.
    - `onSpeech(event, turnId, now)` and `setMuted(muted)`: same semantics as `expression-store.ts` speech fan-out, using `applySpeechEvent`.
    - `setSlotSettings(settings: SlotLeaseSettings)`.
    - `setManual(hold: { emotion, strength } | null)`.
    - `current(now): { emotion: PerformanceEmotion, strength: number } | null`: manual wins over the lease, and an expired lease (`isLeaseExpired`) is released at read time.
  - Add `packages/stage-ui-live2d/src/composables/live2d/expression/hold.test.ts` covering:
    - a speech lease lasts through clip-start/clip-end until turn-end + speechGrace;
    - clip-stopped releases;
    - a hold lease ends at holdSeconds;
    - muted uses holdSeconds;
    - holdCap bounds everything;
    - a newer hold replaces an older one;
    - manual overrides and then falls back to the lease when cleared;
    - a hold created or replaced after clip-start adopts the active speech fact and lasts through that clip instead of expiring as unstarted;
    - invalid commands (non-finite holdSeconds, unknown until) are dropped with `console.warn`, mirroring `expression-store.ts:225-228`.
  Must NOT do: depend on the expression store or catalog; change `slots.ts` behavior (generalization only); touch Model.vue (todo 10 wires it).
  Closes: GAP-2 (performer side), GAP-3 (manual source)
  Parallelization: Wave 1 | Blocked by: 3 | Blocks: 10
  References:
  - `packages/stage-ui-live2d/src/composables/live2d/expression/slots.ts:1-80`, `slots.test.ts`
  - `packages/stage-ui-live2d/src/stores/expression-store.ts:200-270` (release, applySlots validation, onSpeech/tickLeases)
  - `settings.ts` slots section (speechGrace, unstartedExpiry, holdCap)
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/expression` passes, including the existing `slots.test.ts` unchanged.
  - Package typecheck passes.
  QA scenarios:
  - Happy: receipt `task-5-tests.txt`.
  - Failure: `applyHolds([{ emotion:'happy', strength:0.6, holdSeconds:NaN, until:'hold' }], 0)` leaves `current()` null, asserted.
  Commit: Y | feat(stage-ui-live2d): add emotion hold performer
  Recommended task executor category: deep-low - small stateful class reusing existing lease functions.

- [x] 6. Build the Natural hold layer and the blink, breath, and nod scale hooks
  What to do:
  - **New file** `packages/stage-ui-live2d/src/composables/live2d/natural-motion/hold.ts`, exporting `class NaturalHoldLayer` with:
    - `set(held: { emotion, strength } | null)`;
    - `setSettings(held settings from todo 3)`;
    - `setStrengths(record: Partial<Record<PerformanceEmotion, number>>)`;
    - `step(dt)`;
    - outputs:
      - `level` (0..1, the current blend weight);
      - `face(): HeldFaceOffsets` (same keys as `HeldSpec.face`, already multiplied by effective strength and level);
      - `posture(): Vec3`;
      - `modulation(): HeldModulation` (multipliers lerped from 1 by level x strength, deltas scaled from 0);
      - `emotion` (the current target emotion or null).
  - Behavior:
    - Effective strength = command strength x per-model strength (default 1, clamp 0-2). Zero means no output for that emotion.
    - On a target change, interpolate every channel from its current value toward the new target with onset tau `held.onsetTau`. On release, decay to the neutral value with `held.releaseTau`. These are exact exponential steps, like `mood.ts` step.
    - Posture uses tau `held.postureTau`.
    - The side for `sided` axes and `oneSidedBrow` is derived deterministically from the emotion name plus a per-layer counter: `(hash(emotion) + changes) % 2`, with no random draw.
    - With no hold and level 0, every output is exactly the neutral value (0 offsets, multipliers 1).
  - **Fill `held` in `natural-motion/emotions.ts`** with these starting values. Face values are in adapter face units, where an offset is a fraction of the parameter half-range: bipolar brows/mouth -1..1 means 1 = full travel; unipolar eyeSmile/cheek 0..1 means 2 = full travel.

    | Emotion | Face | Posture [yawX, pitchY, rollZ] / sided | Modulation |
    | --- | --- | --- | --- |
    | happy | browY 0.5, eyeSmile 1.6, mouthForm 1.0, cheek 0.4 | [0, 0.10, 0.06] / [2] | blink 1.0, breath 0.9, amplitude 1.15, camera +0.15, desk 0, nodSize 1.3, nodAcceptance +0.15 |
    | sad | browY -0.2, browAngle 0.9, mouthForm -0.8, eyeOpenMultiplier 0.75 | [0, -0.18, 0.04] / [2] | blink 1.3, breath 1.15, amplitude 0.7, camera -0.25, desk +0.3, nodSize 0.7, nodAcceptance -0.15 |
    | angry | browY -0.7, browAngle -1.0, mouthForm -0.7, eyeOpenMultiplier 0.85 | [0, -0.10, 0] / [] | blink 1.2, breath 0.8, amplitude 0.85, camera +0.1, desk 0, nodSize 1.4, nodAcceptance +0.1 |
    | surprised | browY 1.0, eyeOpenHint 0.25, mouthForm -0.1, mouthOpen 0.3 | [0, 0.06, 0] / [] | blink 2.0, breath 0.8, amplitude 1.0, camera +0.2, desk 0, nodSize 1.0, nodAcceptance 0 |
    | think | oneSidedBrow 0.4, browAngle -0.2, mouthForm -0.2, eyeOpenMultiplier 0.9 | [0.08, 0.08, 0.08] / [0, 2] | blink 1.1, breath 1.0, amplitude 0.8, camera -0.3, desk 0, nodSize 0.8, nodAcceptance -0.1 |
    | awkward | browY 0.2, browAngle 0.4, eyeSmile 0.4, mouthForm 0.3 | [0.10, -0.04, 0.06] / [0, 2] | blink 0.8, breath 0.9, amplitude 1.05, camera -0.3, desk +0.15, nodSize 0.9, nodAcceptance 0 |
    | question | oneSidedBrow 0.6 | [0, 0, 0.14] / [2] | all neutral except camera +0.1 |
    | curious | browY 0.4, oneSidedBrow 0.3, eyeOpenHint 0.1, mouthForm 0.2 | [0, 0.04, 0.12] / [2] | camera +0.15, amplitude 1.05, others neutral |
    | love | browY 0.3, browAngle 0.3, eyeSmile 1.4, mouthForm 0.8, cheek 0.8 | [0, 0.04, 0.10] / [2] | blink 1.1, breath 1.0, amplitude 0.95, camera +0.25, desk 0, nodSize 1.1, nodAcceptance +0.05 |
    | flustered | browY 0.2, browAngle 0.6, eyeSmile 0.6, mouthForm 0.4, cheek 1.6, eyeOpenMultiplier 0.9 | [0.12, -0.10, 0.06] / [0, 2] | blink 0.7, breath 0.75, amplitude 1.1, camera -0.35, desk +0.25, nodSize 0.9, nodAcceptance 0 |
    | sleepy | browY -0.2, browAngle 0.2, eyeOpenMultiplier 0.45 | [0, -0.14, 0.08] / [2] | blink 1.6, breath 1.35, amplitude 0.6, camera -0.2, desk +0.2, nodSize 0.6, nodAcceptance -0.25 |

    Unlisted face fields are 0 (eyeOpenMultiplier 1). Neutral has no held spec. These are starting values; todo 12 may tune them only within +-50% of each listed value, and every change is recorded.
  - **Layer hooks**, each with an exact-identity default that adds no random draws:
    - `NaturalBlinkScheduler.intervalScale = 1`: multiply only the deterministic result of `drawInterval()` (`blink.ts:101-103`) by the scale, after the draw.
    - `NaturalBreathLayer.periodScale = 1`: phase advance uses `this.period * this.periodScale` (`breath.ts:66`).
    - `NaturalSpeechEmphasis.sizeScale = 1`: multiply `magnitude` (`speech-emphasis.ts:95`) after the draw.
  - Tests:
    - `hold.test.ts`: release returns to exact neutral; an onset reaches 95% within 3 x onsetTau; a happy-to-sad switch is continuous (no step above `dt/onsetTau x range`); strength 0 is an exact identity; per-model strength scaling.
    - Blink, breath, and emphasis: scale 1 is bit-identical to base over 10 000 seeded steps; scale 2 doubles the mean blink interval within 5%.
  Must NOT do: touch `natural-motion.ts` (todo 9 wires it); add draws; change defaults.
  Closes: GAP-1, GAP-5 (layer side), part of GAP-4/GAP-9
  Parallelization: Wave 1 | Blocked by: 2, 3 | Blocks: 9
  References:
  - `natural-motion/face.ts:7-32` (`NaturalFaceOutput` keys), `touch.ts:18-113` (held-level pattern), `mood.ts:66-73` (exact decay)
  - `natural-motion-adapter.ts:73-108,337-355` (face units, eyelid compose, clamps)
  - `blink.ts:24-104`, `breath.ts:36-70`, `speech-emphasis.ts:63-100`
  - `rig-profile.ts:1-22`
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion` passes.
  - The liveliness gate test is unchanged and green.
  - Typecheck passes.
  QA scenarios:
  - Happy: receipt `task-6-tests.txt`.
  - Failure: `set({ emotion:'happy', strength: NaN })` is ignored (the layer stays neutral), asserted.
  Commit: Y | feat(stage-ui-live2d): add Natural held-emotion layer and layer scale hooks
  Recommended task executor category: deep-low - numeric layer with exact specs and identity tests.

- [x] 7. Build the Natural gesture clips
  What to do:
  - Create `packages/stage-ui-live2d/src/composables/live2d/natural-motion/gestures.ts` with `class NaturalGestures(random: RandomStream)`:
    - `trigger(kind: GestureKind, strength, band, at): boolean`: false when on cooldown, when the band is slight, or when strength <= 0.
    - `headOffset(time): Vec3` and `bodyOffset(time): Vec3`: sum active clips and drop expired ones, like `headPulseOffset` (`impulses.ts:87-101`).
    - `activeUntil`, so the facade can postpone posture shifts.
  - Band amplitude: slight 0, clear 0.6, strong 1. Body only at strong, at 0.5 x the head shape on yaw/roll.
  - Draw all parameters once at trigger time, in a fixed order, from the given stream.
  - Clips (normalized head units; side means a random +-1 drawn first):
    - **laugh** (happy): 2-4 pitch oscillations; amplitude 0.04-0.06 x strength; frequency 3.5-5 Hz; envelope `impulseEnvelope` with tau 0.15 multiplied by exponential decay over the 0.6-1.0 s duration; cooldown 4 s.
    - **recoil** (surprised): pitch +0.10 x strength with a 0.12 s rise, then a 0.6 s settle with overshoot 0.2; cooldown 3 s.
    - **shake** (angry, 50%): yaw +-0.06, 2-3 cycles at 3 Hz with a raised-cosine window; **drop** (angry, 50%): pitch -0.08, tau 0.15. Cooldown 5 s.
    - **sway** (awkward): yaw to side 0.08 via `minJerk` over 0.4 s, roll sway 0.04 at 0.8 Hz for 1.5 s, return over 0.5 s; cooldown 4 s.
    - **tilt-in** (love): roll side 0.08 and pitch +0.03, tau 0.5; cooldown 5 s.
    - **look-away** (flustered): yaw side 0.10 over 0.25 s, roll jitter 2 cycles amplitude 0.02 at 5 Hz, hold 0.8 s, return over 0.6 s; cooldown 4 s.
    - **nod-off** (sleepy): pitch -0.08 over 1.2 s, then a catch-back of +0.04 with tau 0.3; cooldown 8 s.
  - Set `gesture` in `natural-motion/emotions.ts`: happy laugh, surprised recoil, angry shake-or-drop, awkward sway, love tilt-in, flustered look-away, sleepy nod-off. Sad, think, question, curious, and neutral have none.
  - Tests in `gestures.test.ts`:
    - two instances with the same seed and the same triggers are bit-identical;
    - cooldown blocks a retrigger and allows one after it;
    - every clip returns to exactly 0 after its duration;
    - every peak is <= 0.12 normalized;
    - slight never triggers;
    - body is zero unless strong.
  Must NOT do: touch `natural-motion.ts` or `impulses.ts`; use `Math.random`.
  Closes: GAP-4 (gesture part)
  Parallelization: Wave 1 | Blocked by: 2 | Blocks: 9
  References:
  - `natural-motion/impulses.ts:69-101` (`impulseEnvelope`, `headPulseOffset`)
  - `natural-motion/processes.ts:34-44` (`minJerk`, `softLimit`)
  - `natural-motion/random.ts` (`createRandomStream`, `gaussian`)
  - `natural-motion.ts:144-147` (cooldown precedent)
  - `posture.ts:93-95` (`postponeShift`)
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion/gestures.test.ts` passes.
  - Typecheck passes.
  QA scenarios:
  - Happy: receipt `task-7-tests.txt`.
  - Failure: `trigger('laugh', 0.9, 'strong', 0)` then `trigger('laugh', 0.9, 'strong', 2)` returns false the second time, asserted.
  Commit: Y | feat(stage-ui-live2d): add Natural emotion gesture clips
  Recommended task executor category: deep-low - self-contained deterministic shape functions.

- [x] 8. Add per-model emotion strength settings and the held-emotions switch to the UI
  What to do:
  - In `packages/stage-ui-live2d/src/composables/live2d/live2d.ts`:
    - Add `live2dNaturalEmotionStrength = useLocalStorageManualReset<Record<string, Partial<Record<PerformanceEmotion, number>>>>('settings/live2d/natural-emotion-strength', {})`.
    - Reset it in the same reset function as the head scale (`:72`) and export it alongside it (`:92`).
  - In `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue`, inside the Natural section next to the head-scale slider (`:440-466`):
    - Add a collapsible group "Emotion strength" with one slider per non-neutral emotion (11), range 0-2, step 0.05, default 1, for `stageModelSelected`.
    - Replace the record on write, exactly like `naturalTouchHeadScale` (`:166-170`).
    - Add a "Reset to default" button that removes the model's entry.
    - Show the group only when the motion driver is Natural, matching the neighbouring Natural controls.
  - Add a `heldEmotions` checkbox among the performance switches (`:892-935`), bound to the synced performance document (`packages/stage-ui/src/features/performance/settings.ts`).
  - English strings in `packages/i18n/src/locales/en/settings.yaml`:
    - `settings.live2d.animation.natural-emotion-strength.{title,description,reset}`;
    - per-emotion labels: reuse the performance emotion labels at `:322-330`, extended in todo 1;
    - the held-emotions switch label and description near `:334-355`.
  - Follow `.agents/skills/enforce-rules-for-unocss/SKILL.md` and `DESIGN.md`; reuse existing slider/checkbox components.
  - Browser test, extending the existing Live2D settings browser test file:
    - moving the love slider for model A to 1.5 writes `{A:{love:1.5}}`;
    - model B is unaffected;
    - reset removes A;
    - the held-emotions checkbox toggles `document.heldEmotions`.
  Must NOT do: expose `held.*` tunables in the UI; edit non-English locales; change existing controls.
  Closes: GAP-7 (IS-7)
  Parallelization: Wave 1 | Blocked by: 1, 3 | Blocks: 10
  References:
  - `packages/stage-ui-live2d/src/composables/live2d/live2d.ts:1-95`
  - `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:40-50,160-175,421-466,892-935`
  - `packages/stage-ui/src/features/performance/settings.ts:12-27`
  - `packages/stage-ui/src/features/performance/settings.browser.test.ts`
  - `docs/assets/ai/context/ui-components.md` (update only if a shared component API changes; it should not)
  - `packages/i18n/AGENTS.md`
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project browser <the live2d settings browser test>` passes.
  - `pnpm -F @proj-airi/stage-ui typecheck` and `pnpm -F @proj-airi/stage-ui-live2d typecheck` pass.
  QA scenarios:
  - Happy: browser test receipt `task-8-tests.txt`, plus a screenshot of the Natural section with the group expanded, `task-8-settings.png`.
  - Failure: a stored value of `{"A":{"love":"x"}}` renders the slider at 1 and does not throw (asserted in the browser test).
  Commit: Y | feat(stage-ui): add per-model emotion strength and held-emotion switch
  Recommended task executor category: visual-engineering - settings UI with layout and i18n.

- [x] 9. Wire held emotions and gestures into the Natural facade
  What to do, in `packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts`:
  - Append `gestures: 12` to `streamIndex` (`:73`).
  - Construct `NaturalHoldLayer` (no stream) and `NaturalGestures(stream('gestures'))`.
  - Add public methods `setHeldEmotion(held: { emotion, strength } | null, nowSeconds)` (advance, then store; applied on the next grid step like `setPet` `:294-297`) and `setEmotionStrengths(record)`.
  - Forward `held` settings and the `heldEmotions` switch in `setPerformanceSettings` (`:272-277`).
  - **When `heldEmotions` is true**, in `integrate()` (`:314-373`):
    - (1) Step the hold layer after mood.
    - (2) After the energy and mood adjustments (`:323-334`), apply modulation:
      - `posture.amplitudeScale *= mod.amplitude`;
      - `gaze.cameraFixationProbability = clamp01(prob + mod.cameraFixation)`;
      - desk target weight `+= mod.deskWeight` (renormalize the weights the same way energy does);
      - `emphasisAcceptance = clamp01(acc + mod.nodAcceptance)`;
      - `blink.intervalScale = mod.blinkInterval`;
      - `breath.periodScale = mod.breathPeriod`;
      - `emphasis.sizeScale = mod.nodSize`.
    - (3) Add `hold.posture()` to BOTH `head` and `followerHead` (`:348,353`), so the body follows the held bias at every band (the owner decision overturns "clear keeps body at 0").
    - (4) Add `gestures.headOffset` to `head` only and `gestures.bodyOffset` to the body lean (`:364-367`). While a gesture is active, call `posture.postponeShift(remaining)` when the remaining time is > 0.5 s.
    - (5) In `startPending` for emotion actions (`:392-402`), after `impulses.trigger`, call `gestures.trigger(naturalEmotions[e].gesture, ...)` when the emotion has a gesture.
      - For emotions WITH a gesture, the impulse must not push its head pulse: add an option `trigger(episode, at, { head: false })` to `NaturalImpulses` that keeps all random draws and the face hints but skips the head/body pulses.
      - Skip everything (impulse, gesture, mood) when that emotion's per-model strength is 0.
    - (6) In `withHints` (`:415-432`):
      - add held face offsets;
      - scale impulse hints by `(1 - held.accentScale x hold.level)` when the impulse emotion equals `hold.emotion`;
      - multiply eyelid `eyeOpenMultiplier` by the held multiplier and add `eyeOpenHint` and `mouthOpen` (`silentMouthOpen`) from the hold;
      - pet priority: scale the held face contribution by `(1 - pet.level)` on the channels pet defines (eyeOpenMultiplier, eyeSmile, mouthForm, cheek, browY).
  - **When `heldEmotions` is false**, none of the above runs and output is bit-identical to the pre-change controller.
  - Tests in `natural-motion.test.ts`:
    - (a) No held emotion and no emotion: bit-identical to the pre-change controller over 60 s seeded, with gestures stream draws = 0.
    - (b) `heldEmotions:false`: the existing band tests `:13-87` pass unchanged; keep them and pin the switch to false in them.
    - (c) New, `heldEmotions:true`:
      - a clear happy with a hold gives a held mean brow/eyeSmile/mouthForm offset of at least 50% of the recipe x 0.6 over the hold window;
      - body peak at clear is > 0 and < body peak at strong;
      - after release, offsets return within 5 x releaseTau to < 1% of peak. Exact exponential decay leaves 1.83% after four time constants and 0.67% after five; preserve the specified release tau rather than adding a tail snap.
    - (d) Happy-to-sad switch: no frame-to-frame jump above the step bound.
    - (e) Pet during a held happy: eyeSmile is closer to the pet target than without the pet.
    - (f) A strength-0 emotion produces output identical to no emotion.
    - (g) The liveliness gate test stays green.
  Must NOT do: change the adapter or Model.vue (todo 10); alter stream indices 0-11; add draws when nothing is triggered.
  Closes: GAP-1, GAP-4, GAP-5, GAP-8, GAP-9 (facade)
  Parallelization: Wave 2 | Blocked by: 3, 6, 7 | Blocks: 10
  References:
  - `packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts:60-170,255-440`
  - `natural-motion/impulses.ts:150-200`, `touch.ts:67-113`, `energy.ts:99-139` (target weight normalization)
  - `gaze.ts:53-58,97-104`, `posture.ts:51-111`
  - `natural-motion.test.ts:13-87,329-337`, `liveliness-gate.test.ts:138`
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` (node + browser) passes; failures must also exist in `task-0-baseline.txt`.
  - Typecheck passes.
  QA scenarios:
  - Happy: receipt `task-9-tests.txt`.
  - Failure (mutation): temporarily drop the accent scaling, show that test (c)'s saturation assertion fails (`task-9-mutation.txt`), then restore.
  Commit: Y | feat(stage-ui-live2d): perform held emotions and gestures in Natural
  Recommended task executor category: deep-high - central composition with determinism invariants and several interacting rules.

- [x] 10. Plumb holds, preview, and strengths from the conductor to Natural
  What to do:
  - **Conductor** (`packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts`):
    - Normalize the effective decider context's `heldEmotions` to false outside Natural without mutating the stored document. The existing conductor calls deciders for every driver, so this prevents expression-derived reaction state from changing later Universal/MAGIC slot decisions.
    - Add `applyHolds(commands: HoldCommand[], now: number)` to `StagePerformanceScene` (`:68-73`).
    - In `emotion()` (`:203-211`), `expression()` (`:231-233`), the clear path (`:236-...`), and `dispatch()` (`:428-434`), send `decision.holds` via `scene.applyHolds` when the driver is natural.
    - `expression()` must also dispatch `decision.episodes` to `scene.setEmotion` when the driver is natural; today it dispatches slots only.
  - **Live2D.vue** (`packages/stage-ui-live2d/src/components/scenes/Live2D.vue:158-164`):
    - Expose `applyHolds`.
    - Read `live2dNaturalEmotionStrength` from the settings store and pass `naturalEmotionStrength` (the record entry for the model id) to Model.vue, like `naturalEnergy` (`:88,204`).
  - **Model.vue** (`packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue`):
    - Create one `EmotionHoldPerformer` per mounted model.
    - Expose `applyHolds` (`:1366-1370`), and fan out `onSpeech`/`setMuted` to both the expression store and the performer.
    - Keep the performer's slot settings in sync with the expression store's.
    - Compute the manual (preview) hold: take the most recent id in `expressionStore.manualActive` that is NOT in `expressionStore.restSet` and whose catalog entry has mappings. Use its primary mapping (highest weight, earliest on ties), with strength = `performanceSettings.intensity[mapping.minBand]`, or null. Pass it with `performer.setManual`.
    - Add `heldEmotion: performer.current(now)` and `emotionStrengths` to the Natural attention object (`:585-600`).
    - Clear the performer when the model unmounts or changes (where `pendingNaturalEmotions` is cleared, `:565`).
  - **Adapter** (`natural-motion-adapter.ts`):
    - Add `heldEmotion` and `emotionStrengths` to `Live2DNaturalMotionAttention` (`:36-49`).
    - In `compose()`, call `controller.setEmotionStrengths(attention.emotionStrengths)` before any controller call that can advance time, including suspension/performance setters. Those setters can start an already queued episode, which must see the latest per-model strength.
    - After `setPet` (`:299`), call `controller.setHeldEmotion(active ? attention.heldEmotion : null, this.time)`.
  - Tests:
    - Conductor node test (existing conductor test file):
      - an LLM `expression('Angry')` whose entry maps to angry dispatches one episode and one hold to a fake scene;
      - under the universal driver, holds are not dispatched;
      - a mapped explicit expression followed by an emotion under Universal/MAGIC preserves the old slot-only reaction history and existing slot outputs;
      - a slotless clear dispatches a null hold.
    - Adapter tests: a held emotion is ignored while inactive; an emotion queued on one frame and changed to per-model strength 0 before the next compose tick produces no impulse, gesture or mood dose. Compare actual output/state with a no-emotion control, not only setter call order.
    - Model-level browser test, if one exists for Model.vue wiring; otherwise a node test of the manual-hold selection helper, exported from a small pure function in `expression/hold.ts`: rest-set ids are excluded, and the latest toggle wins.
  Must NOT do: change expression-store semantics; dispatch holds for non-natural drivers; touch Universal/MAGIC paths.
  Closes: GAP-2, GAP-3 (runtime), IS-7 wiring
  Parallelization: Wave 2 | Blocked by: 4, 5, 8, 9 | Blocks: 11, 12
  References:
  - `use-stage-performance-conductor.ts:59-80,193-240,420-499`
  - `Live2D.vue:52-90,155-210`
  - `Model.vue:130-170,560-600,1160-1200,1360-1372`
  - `natural-motion-adapter.ts:36-49,263-300`
  - `expression-store.ts:121-176,323-340`
  - Preview route: `live2d-expression-entry.vue:173` -> `live2d.vue:87-98` -> `apps/stage-tamagotchi/src/renderer/pages/settings/models/index.vue:388` -> `apps/stage-tamagotchi/src/renderer/pages/index.vue:359` (`applySettingsCommand` in the stage window)
  - `Stage.vue:300-319`
  Acceptance criteria:
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project node` for the conductor tests passes.
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` passes.
  - Typecheck passes for stage-ui, stage-ui-live2d, and `@proj-airi/stage-tamagotchi`.
  QA scenarios:
  - Happy: receipt `task-10-tests.txt`.
  - Failure: `expression('NotExposed')` dispatches nothing to the scene (no episode, hold, or slot), asserted.
  Commit: Y | feat(stage-ui): route emotion holds and expression emotions to Natural
  Recommended task executor category: deep-low - integration across known seams with fakes for tests.

- [x] 11. Write the ADR and update the READMEs
  What to do:
  - Create `docs/ai/adr/2026-10-19-natural-emotion-revamp.md`, following the format of `docs/ai/adr/2026-10-18-expression-performance.md`. Cover:
    - context (decoration-only stamps);
    - the decision (hold contract, performer, held layer, gestures, priority order pet > hold > accent > mood, the body at clear, the per-model strength, the new emotions and their fallbacks, preview manual holds excluding the rest set);
    - the per-emotion table, by reference to `natural-motion/emotions.ts`;
    - consequences.
  - It must state that it supersedes `2026-10-18-expression-performance.md:416` (gesture library) and `2026-10-17-natural-motion-v2-performance-state.md:177` (only the Energy slider). Add a one-line "Superseded in part by 2026-10-19-natural-emotion-revamp" note under each of those lines, and update the band table text at `2026-10-18-expression-performance.md:107-133` where it says the body moves only at strong.
  - Update:
    - `packages/stage-ui-live2d/README.md` sections "Natural layers", "Emotions by intensity band", "Mood" (held emotions, gestures, strength setting);
    - `packages/stage-shared/README.md` (HoldCommand);
    - `packages/stage-ui/README.md` only if its emotion or settings description changes.
  - Follow the prose rules in the root `AGENTS.md`, under Unique Styles.
  Must NOT do: document unimplemented behavior; edit agent configuration files.
  Closes: GAP-11
  Parallelization: Wave 3 | Blocked by: 10 | Blocks: F1-F4
  References: the two ADRs above; the package READMEs; `server/AGENTS.md` ADR rules (naming only).
  Acceptance criteria: `git diff --check` is clean; every file path cited in the new ADR exists (scripted check: extract backticked paths and `test -e` each); root `pnpm lint` in todo 12 covers markdown formatting.
  QA scenarios:
  - Happy: the path-check and diff-check receipt `task-11-lint.txt`.
  - Failure check: `git grep -n "No gesture library"` shows the superseded note adjacent; receipt `task-11-grep.txt`.
  Commit: Y | docs(stage-ui-live2d): document held Natural emotions
  Recommended task executor category: writing - ADR and README prose.

- [x] 12. Run rendered acceptance on ForBOOTH and the regression sweep (accepted partial by Luke 2026-10-19: rule 1 22/22, rules 2/3 noise-limited; see ledger)
  What to do:
  - **(a) Regression sweep** on the integration tip, run serially:
    - the four package suites;
    - `pnpm -F @proj-airi/stage-ui-mmd exec vitest run`;
    - root `pnpm typecheck`;
    - `pnpm lint`.
    - Compare against `task-0-baseline.txt`; new failures block. Save the receipts to `task-12-sweep.txt`.
  - **(b) Rendered acceptance**, Electron isolated as in Verification strategy:
    - Import ForBOOTH and select Natural with cursor attention off and the OS cursor parked; turn the Expression setting on.
    - In the catalog editor, confirm these mappings and screenshot them: `expression1` (Angry) -> angry, kind effect, minBand strong; `expression2` (Crying Eyes) -> sad; `expression7` (Hearts 1) -> love; `脸红2` (Blush) -> flustered; `expression13` (Sleepy) -> sleepy; `expression5` (Star Eyes) -> happy, kind effect.
    - For EACH of the 11 non-neutral emotions at clear and at strong:
      - fire a lab pulse;
      - capture a 7 s post-physics parameter trace at 30 Hz, including the required t = 6.4 s release sample;
      - take screenshots at t=0.5 s and t=3 s at the corner window size.
  - **Preregistered pass rules** (write them to `task-12-prereg.json` BEFORE capturing). For each emotion and band:
    - (1) Over t in [0.5 s, 3.5 s], every recipe channel with |value| >= 0.3 has a mean deviation from the pre-pulse 1 s baseline of the correct sign and at least 40% of the recipe x band nominal (clear 0.6, strong 0.9) x half-range.
      - For `eyeOpenMultiplier`, use `1 - multiplier` as the value and expect a decrease in ParamEyeLOpen/ROpen relative to the baseline open level, ignoring frames inside a blink (blink factor < 0.95 is visible in the trace as both lids dipping together; exclude any 0.4 s window around such a dip).
      - Skip channels absent on the rig (ParamCheek on ForBOOTH) and physics-owned channels; list the skips in the results.
    - (2) Turnless holds end by t = 4 s + 4 x 0.6 s, with the channels back within 10% of baseline by t = 6.4 s.
    - (3) ParamAngle bias of the correct sign at clear and strong; a nonzero body (ParamBodyAngle or the physics-derived body) at clear.
  - **Preview check:** toggle `expression1` (Angry) in Settings, capture 3 s, and confirm the angry brows (rule 1 for angry at strong). Then save `脸红2` (Blush) as a rest default, reload, and confirm no flustered face (brows within the baseline band).
  - **LLM/ACT check:** send a chat turn, or inject an ACT marker through the stage queue in devtools, with `<|ACT:{"expression":"Angry"}|>`, and confirm the angry face for the turn.
  - **A/B check:** with `heldEmotions` off, a happy pulse shows only the old ~1.7 s hint, and the held face is absent.
  - Tuning rule: if a rule fails because a value is too weak or too strong, adjust ONLY the failing emotion's values in `natural-motion/emotions.ts`, within +-50% of the todo-6 starting values, re-run that emotion, and log every change in `task-12-tuning.md`. Two failed tuning rounds on one emotion stop the todo and report it as partial.
  - Bear inherits the result under Luke's one-rig rule; no Bear capture is required.
  Must NOT do: edit rig files; reuse Luke's real profile; skip preregistration; tune outside +-50%.
  Closes: proves IS-1..IS-9 on the real surface
  Parallelization: Wave 3 | Blocked by: 10 | Blocks: F1-F4
  References:
  - `.omo/plans/emotion-expression-performance.md:87-97,568-582` (rendered QA conventions)
  - `.omo/plans/live2d-presence-v1.md:352-382` (isolated Electron, ffmpeg)
  - `.omo/plans/live2d-presence-v2.md:600-635` (trace capture)
  - `packages/stage-ui/src/features/devtools/motion/natural/components/emotion-pulses.vue`
  - `.agents/skills/use-agent-browser-for-airi/SKILL.md`, `.agents/skills/agent-browser-electron/SKILL.md`, `.agents/skills/use-vishot/SKILL.md`
  - ForBOOTH path in Scope
  Acceptance criteria:
  - All regression commands exit 0, or each failure appears in the baseline.
  - `task-12-results.json` shows every preregistered rule PASS for all 22 emotion x band cells, plus the preview, rest-set, ACT, and A/B checks.
  - Screenshots `task-12-<emotion>-<band>-{0.5,3}.png` exist.
  QA scenarios:
  - Happy: as above.
  - Failure: the rest-set check (a saved Blush default does not hold flustered) and the A/B-off check are the negative controls; both are recorded in `task-12-results.json`.
  Commit: Y (only if tuning changed values) | fix(stage-ui-live2d): tune held emotion recipes from rendered QA
  Recommended task executor category: unspecified-high - long Electron QA session with CDP, capture, and judgment-free preregistered scoring.

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Read this plan and `git log a..b` on the integration branch. Every todo's Must/Must NOT items and acceptance commands are satisfied with receipts in `.omo/evidence/natural-emotion-revamp/`, and nothing outside scope changed. Check in particular: no non-English locale edits; no `package.json` or lockfile changes; no Kirie edits; stream indices 0-11 unchanged. Verdict APPROVE/REJECT with file:line evidence.
  Recommended task executor category: unspecified-high
- [x] F2. Code quality review
  Review the diff against `.agents/skills/enforce-rules-for-typescript/SKILL.md`, `enforce-rules-for-vitest`, `enforce-rules-for-unocss`, and the root `AGENTS.md`: kebab-case files, no `any`, no sleeps in tests, `// NOTICE:` on any workaround, and no unused exports. Re-run the four package suites and the package typechecks (serially).
  Recommended task executor category: unspecified-high
- [x] F3. Real manual QA
  An independent agent repeats todo 12's preview, ACT, A/B, and rest-set checks plus 4 sampled emotion x band cells (angry strong, sad clear, love clear, sleepy strong) on ForBOOTH in a fresh isolated profile, and attaches screenshots. It does not reuse todo 12's captures.
  Recommended task executor category: unspecified-high
- [x] F4. Ideal-state fidelity
  Check the delivered behavior against IS-1..IS-11 one row at a time, using the Success criteria table. Any IS row without passing evidence becomes a new `- [ ] N.` todo, never a note. Results are surfaced to Luke for his QA and explicit okay before completion.
  Recommended task executor category: unspecified-high

## Commit strategy
- One Conventional Commit per todo (messages given in each todo), without gitmoji, on `luke/feat/natural-emotion-revamp`. Code, its tests, and the docs describing that code go in the same commit.
- Every commit must leave the touched packages' typecheck and tests green.
- No commits to `main`, no push, and no PR (direct delivery). Merging to `main` waits for Luke's okay after F1-F4 and his QA.
- Before each commit, restore `integrations/vscode/vscode-airi/package.json` if pnpm install touched it, and stage only the todo's files.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 6, 9, 12 | Rule (1) for all 11 emotions x 2 bands; facade test (c) | `task-12-results.json`, `task-12-*-3.png`, `task-9-tests.txt` |
| IS-2 | 3, 4, 5, 9, 10 | Rule (2) turnless release; hold performer lease tests; conductor hold dispatch | `task-12-results.json`, `task-5-tests.txt`, `task-10-tests.txt` |
| IS-3 | 4, 5, 10, 12 | Preview check (Angry toggle shows angry brows); ACT expression check; decider expression-derived episode test | `task-12-results.json`, `task-4-tests.txt` |
| IS-4 | 6, 7, 9, 12 | Rule (3) head bias and body at clear; gesture determinism/cooldown tests; facade body clear < strong | `task-12-results.json`, `task-7-tests.txt`, `task-9-tests.txt` |
| IS-5 | 6, 9 | Blink/breath/emphasis scale tests; facade modulation applied with hold | `task-6-tests.txt`, `task-9-tests.txt` |
| IS-6 | 1, 2, 12 | Payload tests for the new names; prompt test; rendered love/flustered/sleepy cells | `task-1-tests.txt`, `task-12-results.json` |
| IS-7 | 8, 10 | Settings browser test (per-model write/reset, held switch); strength-0 identity test | `task-8-tests.txt`, `task-8-settings.png`, `task-9-tests.txt` |
| IS-8 | 2, 6, 9, 12 | Idle bit-identity tests; heldEmotions:false band tests unchanged; liveliness gate; A/B-off rendered check; regression sweep vs baseline | `task-9-tests.txt`, `task-12-results.json`, `task-12-sweep.txt` |
| IS-9 | 6, 9 | Happy-to-sad continuity; accent mutation test; pet priority test | `task-6-tests.txt`, `task-9-tests.txt`, `task-9-mutation.txt` |
| IS-10 | 3, 4 | Trace replay tests with expression and emotion fixtures including holds | `task-4-tests.txt` |
| IS-11 | 11 | ADR path check; superseded notes present | `task-11-lint.txt`, `task-11-grep.txt` |
