# mmd-natural-full-body - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** You, with an MMD model on the desktop. Instead of standing still, she behaves like your Live2D character (blinks, breathes, glances, follows the cursor, reacts to speech, emotions and touch) and adds a real body: feet planted while she shifts her weight, a whole-body turn toward what she looks at, hair that moves when she turns or is patted, and sitting or sleeping using motions you import. Your Live2D character keeps behaving exactly as before.

**What you'll get:** The Live2D behaviour engine moved into a shared module that both renderers use, a new shared body module (look-at, foot planting, weight shifting, sit/sleep decisions), working support for every kind of facial and effect morph your models contain, an expression catalog and the same expression panel for MMD models, MMD settings for the behaviour, and a developer lab page with live diagnostics and overlays.

**Why this approach:** One shared behaviour engine means the tuning you already did for Live2D carries over and never drifts between two copies. All new body motion is applied before the hair and cloth simulation, from a clean copy of each frame's pose, so nothing builds up frame after frame and the hair reacts naturally.

**What it will NOT do:** No walking across the desktop, cursor chasing, gesture library, dancing, window perching or VRM support yet; those come in later plans. No model or motion files are added to the repository. The physics engine's internals are not touched.

**Effort:** XL
**Risk:** Medium - the frame ordering inside the MMD runtime and the move of the Live2D engine are delicate, so both are guarded by exact before/after checks.
**Decisions to sanity-check:** Natural becomes the default driver for MMD models (Classic stays available); she sits after two minutes of idle and sleeps while you are away, only when you have assigned sit/sleep motions; the classic cursor gaze now layers on top of imported head motion instead of overriding it.

Your next move: start execution with `/ulw-execute mmd-natural-full-body` here or in a new session.

---

> TL;DR (machine): XL, medium risk; extract Natural to motion-driver-natural (trace-hash equal), add motion-driver-humanoid, MMD frame pipeline + morph runtime + rig/Natural/body/touch/stance adapters, conductor routing + MMD expression catalog/panel, settings, Motion Lab, ADR; 23 todos + F1-F4.

## Scope
### Affected user and ideal state
**Affected user:**
- U1 Luke as end user: Tamagotchi (Electron, Windows) with an MMD model as desktop companion. Today the MMD model stands static unless he imports an idle VMD, its eye/head cursor gaze runs after physics, emotions are fixed morph slots, lip-sync and blink work. After: it is as alive as the Live2D Natural character and adds full-body behaviour (planted feet, weight shifts, 3D look-at with body turn, physical touch, sit/sleep).
- U2 Luke as developer/QA: tunes and verifies motion. Today only Live2D has a Natural lab and gates. After: an MMD Motion Lab, deterministic Node tests for pure layers, browser and Electron QA recipes.
- U3 The Live2D path (ForBOOTH/Bear rigs, qa-tools gates): must behave identically after Natural moves packages.
- U4 The LLM/chat runtime (ACT markers, expression tools): today expressions reach Live2D only; after, the same tools and ACT expressions drive MMD catalog entries.
- U5 The future VRM adapter author: consumes the neutral packages without MMD assumptions.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Live2D Natural output is identical after extraction: seeded trace hashes equal before/after, all stage-ui-live2d and qa-tools tests green, gate files changed in import lines only (ids, versions, thresholds byte-identical) | U3 must not regress; seeded determinism makes it provable |
| IS-2 | An MMD model runs the same Natural behaviour as Live2D (blink, breath, posture drift, saccades, cursor attention, chat glances, speech emphasis, emotion impulses/holds/mood, energy by PerformanceState) from the same Stage inputs | Parity decision |
| IS-3 | Every PMX morph type behaves as in MikuMikuDance: vertex, group (members of any type; nested groups refused with one warning, as MMD), bone, material (diffuse, specular, shininess, ambient, opacity, edge colour/size, texture/sphere/toon tints) and UV; additional-UV (UV1-4) morphs have no visual effect, matching MMD without effect shaders, and are logged once | Vivian brows and WuWa material/UV effects are inert today |
| IS-4 | MMD expressions come from a per-model catalog derived from PMX morphs, curated in the same expression panel as Live2D, persisted per model id; LLM expression tools and ACT expressions drive it; lip-sync owns vowels; blink owns blink morphs | U4 parity; one panel |
| IS-5 | Feet stay planted in mesh-local space during idle sway and weight shifts (ankle-to-anchor error < 0.05 MMD units live, < 0.01 in Node fixtures), knees stay inside PMX limits, on Ellen, Vivian, standard Chisa, long-skirt Elysia | Full-body life; nothing skates |
| IS-6 | Seeded weight shifts move the pelvis between the legs with hip and upper-body counter-motion, composed with Natural body output | 3D-only life |
| IS-7 | A 3D look-at aims eyes, head, neck and upper body at a world target (cursor on the stage plane, chat window, camera) with a body turn past a threshold and hysteresis; hair reacts because every bone write precedes physics | 3D gaze; fixes after-physics gaze |
| IS-8 | Pointer poke/pet on MMD head/body (rigid-body colliders, mesh fallback) triggers Natural poke/pet with Live2D semantics; head/body bones move before physics so hair and skirt react | Touch parity + physical response |
| IS-9 | Per-model stance clip slots (idle, sit, sleep) take imported VMDs; a pure director sits after 120 s continuous idle mode and sleeps while away; transitions cross-fade; a missing slot keeps standing; Natural ducks during stance clips | Stances from imported clips |
| IS-10 | Existing MMD features keep working: VMD import, idle/one-shot playback, emotion-to-action map, lip-sync, gaze modes on the Classic driver, physics/IK/grant/gravity toggles, material opacity, glow, lighting, background, captureFrame, cross-window settings sync, settings preview stage | No regression for U1 |
| IS-11 | The camera frames the model from skeleton-derived bounds (foot baseline to head top), so long-skirt Elysia frames like the others | Box3 misframes long skirts |
| IS-12 | Per-stage frame cost is measured; on standard Chisa in Electron the AIRI pipeline stages (all except physics.update and render) have p95 <= 4 ms and Natural FPS >= 0.95 x Classic FPS over 60 s | Heaviest model; no degradation |
| IS-13 | An MMD Motion Lab devtools page shows the rig report, overlays (IK helper, colliders/touch regions, foot anchors, look-at target), director state and per-stage timings, and a pinia diagnostics store exposes the same data to QA | U2 tuning and agent QA |
| IS-14 | The two neutral packages import no three, vue, pinia, three-mmd or stage-ui-*; use VRM humanoid names and rest-relative outputs; run in Node vitest | U5 reuse |
| IS-15 | MMD settings expose the motion driver (Natural default, Classic), Natural energy, touch toggles and stance clip slots; English strings in packages/i18n | U1 control |
| IS-16 | READMEs for both new packages, updated AGENTS.md/README/skill paths, and one ADR record the architecture | Repo convention |
| GAP-1 | Natural lives in stage-ui-live2d; the controller imports Live2DRigProfile, Live2DTouchRegion and EMOTION_VALUES | Blocks reuse (IS-1, IS-2, IS-14) |
| GAP-2 | The conductor is built for Live2D only and always reads the Live2D expression store; ACT expressions reach Live2D only | IS-4 |
| GAP-3 | MMDScene receives no performance, chat, placement or voice props and implements no StagePerformanceScene | IS-2 |
| GAP-4 | three-mmd applies only vertex morphs and group-to-vertex members | IS-3 |
| GAP-5 | No canonical humanoid, rig profile, foot contact, weight shift, look-at or director exists | IS-5..IS-9, IS-14 |
| GAP-6 | MMD gaze writes after physics and discards VMD head/eye motion; the animation manager holds one action; three-mmd's beforePhysics snapshot compounds relative writes; updateWithMixer never resets physics on clip loop | IS-7, IS-10 correctness |
| GAP-7 | frameCamera frames by the whole Box3 | IS-11 |
| GAP-8 | No MMD timings, lab, diagnostics store or QA recipe; qa-tools hard-codes the Natural directory | IS-12, IS-13, IS-1 |
| GAP-9 | MMD settings have no driver, touch or stance controls | IS-15 |
| GAP-10 | No package READMEs, ADR or guidance for the new boundaries | IS-16 |

### Must have
- Natural moves to `packages/motion-driver-natural` with zero numeric changes; trace hashes equal (todo 1 baseline, todo 5 check).
- `packages/motion-driver-humanoid` holds canonical types, look-at, foot contact, weight shift and director as pure modules with explicit time and seeded RNG (stage-shared resolver rules).
- stage-ui-mmd owns: frame pipeline, PMX morph runtime, rig adapter, Natural adapter, full-body layer wiring, touch colliders, stance slots, framing, diagnostics store.
- The stage performance conductor dispatches to the scene and expression backend of the active renderer; Live2D behaviour unchanged.
- Every bone write happens before `mmd.beforePhysics()` and is absolute from the pipeline's own clean snapshot.
- Natural is the default MMD driver; Classic keeps today's behaviour (with its gaze moved into the pose stage).
- TDD for pure math (todos 3, 4, 6, 7, 8, 9 and the pure part of 10 and 14): failing Node test committed in the same commit as the implementation, written first.
- Delivery on branch `luke/feat/mmd-natural-full-body`, one atomic commit per todo, PR against `lschneiderny/airi`.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No locomotion, window-follow movement, action/gesture library, perform_action/go_to tools, dance-to-beat, perching, window-rect sensor, drag-dangle, props or VRM adapter (M2-M5).
- No model, texture or VMD assets committed; QA zips and VMDs live only under the run root (`$RUN_TMP`).
- No access to Ammo internals (`physics.bodies`, btRigidBody); no edits to node_modules or three-mmd.
- No re-exports of moved Natural symbols from `@proj-airi/stage-ui-live2d` (the `composables/live2d/index.ts` barrel drops `Live2DNaturalMotion`, `NaturalEpisode`, `SpeechOnsetDetector`); update every importer (AGENTS.md anti-pattern).
- No numeric or behavioural edits to Natural during the move (todo 5 is move/rename only).
- No three, vue, pinia, @moeru/three-mmd or @proj-airi/stage-ui-* imports inside `packages/motion-driver-*`.
- No new third-party dependencies.
- No edits to unrelated dirty files (`.agents/skills/idea/SKILL.md`, `.agents/skills/triage/SKILL.md`, `.agents/skills/vault-sync/`, `integrations/vscode/vscode-airi/package.json`, other `.omo` drafts/plans).
- No locale edits other than `packages/i18n/src/locales/en`.
- No `any`, no suppressed lint/type errors, no skipped tests.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD for pure math (Node vitest, written first, failing run captured), tests-after for adapters, stores and UI (Node vitest where possible; Chromium browser tests for WebGL-bound code).
- Evidence: `.omo/evidence/mmd-natural-full-body/task-<N>-<slug>.<ext>` (outside ulw-loop). Each todo's QA lines name their file.
- Run root: every QA command runs with `TMPDIR="$RUN_TMP"`; scratch scripts, QA zips and QA VMDs live in `$RUN_TMP` and are deleted at the end of the todo that created them (receipt in evidence).

### QA kit (shared by all todos)
- K1 Node tests:
  - `pnpm -F @proj-airi/motion-driver-natural exec vitest run`
  - `pnpm -F @proj-airi/motion-driver-humanoid exec vitest run`
  - `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project node`
  - `pnpm -F @proj-airi/stage-ui-mmd exec vitest run --project browser`
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --config vitest.node.config.ts`
  - `pnpm -F @proj-airi/qa-tools exec vitest run --project node` (unset `QA_RUN_DIR` first; qa-tools AGENTS.md)
  - `pnpm -F @proj-airi/qa-tools exec tsx scripts/check-doc-paths.ts` (doc path audit)
  - `pnpm -F @proj-airi/stage-ui exec vitest run <path>`
  - Typecheck per package: `pnpm -F <name> typecheck`; whole change: `pnpm verify`.
- K2 Natural trace hash: `$RUN_TMP/natural-trace-hash.ts` (written in todo 1) run from the repo root with `pnpm exec tsx $RUN_TMP/natural-trace-hash.ts --controller <absolute path to the controller .ts> --out <file>`. It imports the controller by ABSOLUTE FILE PATH inside the EXECUTING worktree: set `WT=$(git rev-parse --show-toplevel)` in that worktree (the integration worktree `C:/Users/Luke/projects/dtuber-wt/mmd-natural-full-body` or the wave worktree doing the todo; never the main checkout `C:/Users/Luke/projects/dtuber`) and pass todo 1: `$WT/packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts`; todo 5: `$WT/packages/motion-driver-natural/src/natural-motion.ts`. Baseline, post-edit and mutation runs all use the same `$WT` so the controller's own workspace imports resolve from its package; bare `@proj-airi/*` specifiers from `$RUN_TMP` do not resolve. It constructs `new <Controller>({ seed })` explicitly for seeds 1..5 (an absent seed draws from `Math.random`, natural-motion.ts:198) and runs programs P1 idle (`advance` only), P2 cursor sweep (`setCursor(offset, now)` with x = sin(2*pi*0.25 t), y = 0), P3 speech + emotions (`setVoice` level pulses at 4 Hz for 6 s from t=3 s; `impulse({ id, emotion: 'happy', nominal: 0.7, intensity: 0.7, band: 'clear', escalation: false }, 5)` and the same with `surprised` at 20 s), with `setPerformance` idle state at t=0, advancing `advance(now)` at 1/120 s for 60 s, JSON-serialising each returned frame and writing sha256 per (seed, program). Entry points: `advance` natural-motion.ts:226, `setVoice` :283, `setCursor` :290, `setPerformance` :362, `impulse` :374. Baseline `$RUN_TMP/natural-baseline.json`.
- K3 QA model zips: `python -I $RUN_TMP/make-qa-zip.py "<model dir>" "<pmx file name>" "$RUN_TMP/<id>.zip"` zips exactly one PMX plus every non-PMX file under the model dir, preserving relative paths (the ZIP loader picks the first PMX, `packages/stage-ui-mmd/src/utils/mmd-zip-loader.ts:60-78`). Models (local only):
  - Ellen: `C:/Users/Luke/Downloads/random models/MMD/ZZZ_Ellen/艾莲.pmx`
  - Vivian: `C:/Users/Luke/Downloads/random models/MMD/ZZZ_Vivian_v2.3/薇薇安.pmx`
  - Standard Chisa: `C:/Users/Luke/Downloads/random models/MMD/WuWa_Chisa_v1.03/鸣潮_千咲1.02.pmx`
  - Long-skirt Elysia: `C:/Users/Luke/Downloads/random models/MMD/HI3_Elysia-Herrscher_v2.0_by-ShendiYu/爱莉希雅律者2.0/爱莉希雅长裙 3.0.pmx`
- K4 QA VMD: `python -I $RUN_TMP/make-qa-vmd.py <out.vmd> <pose>` writes a VMD 0002 file (30-byte signature `Vocaloid Motion Data 0002`, 20-byte model name, uint32 bone keyframe count, 111-byte bone frames: 15-byte Shift-JIS name, uint32 frame, 3 float position, 4 float quaternion, 64-byte interpolation filled with the linear default 20,20,107,107 pattern; zero morph/camera/light/shadow counts). Poses: `sit` (センター y -6.5 at frames 0 and 60, 左足/右足 x -80 deg, 左ひざ/右ひざ x +80 deg), `sleep` (sit + 頭 x +25 deg, 上半身 x +15 deg), loop length 60 frames; `nod` (one-shot: 頭 x 0 at frame 0, +20 deg at 15, 0 at 30).
- K5 Web stage: start `pnpm -F @proj-airi/stage-web exec vite --port 5183 --strictPort` through `tool.monitor` (filter `Local:`; plain http boots the model chooser, per the 2026-10-24 Live2D touch QA recipe in memory), drive with omowright from the `browser` skill (owned engine, task-owned profile): goto `http://localhost:5183/`, set `localStorage['onboarding/completed']='true'`, `localStorage['onboarding/skipped']='false'`, reload, goto `/settings/models`, `setInputFiles('input[accept*=".zip"]', <zip>)`, click the imported card. Diagnostics read path (also proves cross-window sync): in `page.evaluate` open `new BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')` and collect snapshot messages; wait until a snapshot has `loadedModelKey`. Debug commands (todo 4 contract) are posted on the same channel as `{ type: 'command', ... }`. Emotion pulses: `document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('natural-performance-override').pulseEmotion('happy', 0.7)` (store `packages/stage-ui/src/stores/natural-performance-override.ts:25,46`; root element `#app` in `apps/stage-web/index.html:79`). Stop: close browser, kill the vite PID, verify `kill -0` fails and port 5183 is free.
- K6 Electron stage: start `pnpm dev:tamagotchi` through `tool.monitor` with remote debugging as documented in `.agents/skills/agent-browser-electron/SKILL.md`; attach to the main window target (`/#/`) and the settings window per that skill; before import snapshot the localStorage keys `airi-cards`, `onboarding/completed`, `onboarding/skipped`, `settings/stage/model` (list from `packages/scenarios-stage-tamagotchi-electron/src/scenarios/display-model-from-file.ts:25-30`); set onboarding flags as in `packages/qa-tools/src/t3/onboarding.ts`; open `/settings/models` and upload the zip through the file input per `.agents/skills/use-agent-browser-for-airi/references/input-file.md`; read diagnostics and post commands over the same BroadcastChannel from the main window target; pulse emotions through the `natural-performance-override` store as in K5. Cleanup: delete the imported model through the settings model card delete action, restore the snapshotted keys, stop the dev process (verify `kill -0` fails). The Vishot `display-model-from-file` scenario is NOT used for timed QA because it captures after 3 s and removes the model (display-model-from-file.ts:131-142).

## Execution strategy
### Parallel execution waves
- Wave 1 (independent foundations): 1, 2, 3, 4
- Wave 2: 5 (after 1), 6, 7, 8, 9, 10 (after 2)
- Wave 3: 11 (after 5), 12 (after 3, 4, 5, 10), 15 (after 10, 12), 13 (after 4, 6, 7, 8, 10, 12, 15), 14 (after 3, 11)
- Wave 4: 16 (after 11, 12, 14), 17 (after 10, 12, 13, 16), 18 (after 9, 13, 17), 19 (after 11, 14, 16; parallel with 17-18)
- Wave 5: 20 (after 16, 17, 18, 19), 21 (after 13, 16, 17, 18), 22 (after 5, 16-21), 23 (after 20, 21)
- Final: F1-F4 in parallel after 23.
- Write scopes: todos in one wave touch disjoint files except where the matrix sequences them. `MMD.vue` owner order: wave 1 todo 4; wave 3 todos 12 -> 15 -> 13; wave 4 todos 16 -> 17 -> 18 (16 props/expose, 17 pointer listeners, 18 stance wiring); wave 5 todo 21 (overlays). Todos 12 and 14 share only the morph-runtime `setChannel` seam from todo 3 and neither edits `morph-runtime/`. `Stage.vue` owner order: 11 -> 16. `mmd.vue` settings owner order: 19 -> 20.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 5 | 2, 3, 4 |
| 2 | - | 6, 7, 8, 9, 10 | 1, 3, 4 |
| 3 | - | 12, 14 | 1, 2, 4 |
| 4 | - | 12, 13 | 1, 2, 3 |
| 5 | 1 | 11, 12, 22 | 6, 7, 8, 9, 10 |
| 6 | 2 | 13 | 5, 7, 8, 9, 10 |
| 7 | 2 | 13 | 5, 6, 8, 9, 10 |
| 8 | 2 | 13 | 5, 6, 7, 9, 10 |
| 9 | 2 | 18 | 5, 6, 7, 8, 10 |
| 10 | 2 | 12, 13, 15, 17 | 5, 6, 7, 8, 9 |
| 11 | 5 | 14, 16, 19 | 12, 15 |
| 12 | 3, 4, 5, 10 | 13, 15, 16, 17 | 11, 14 |
| 13 | 4, 6, 7, 8, 10, 12, 15 | 17, 18, 21 | 11, 14 |
| 14 | 3, 11 | 16, 19 | 12, 13, 15 |
| 15 | 10, 12 | 13, 23 | 11, 14 |
| 16 | 11, 12, 14 | 17, 19, 20, 21, 22 | - |
| 17 | 10, 12, 13, 16 | 18, 20, 21 | 19 |
| 18 | 9, 13, 17 | 20, 21 | 19 |
| 19 | 11, 14, 16 | 20 | 17, 18 |
| 20 | 16, 17, 18, 19 | 22, 23 | 21 |
| 21 | 13, 16, 17, 18 | 22, 23 | 20 |
| 22 | 5, 16, 17, 18, 19, 20, 21 | F1-F4 | 23 |
| 23 | 15, 20, 21 | F1-F4 | 22 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [ ] 1. Capture Natural baseline hashes and decouple the controller from Live2D types in place
  What to do / Must NOT do:
  - Preflight (Commit strategy branch guard): `git branch --show-current` prints `luke/feat/mmd-natural-full-body` (or a wave branch based on it) and `git merge-base --is-ancestor main HEAD` exits 0; otherwise stop and report.
  - Before any edit, write `$RUN_TMP/natural-trace-hash.ts` (K2) importing `Live2DNaturalMotion` from `packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts` (read its public methods for advance, performance, cursor, voice, emotion episode inputs) and write `$RUN_TMP/natural-baseline.json`.
  - In `packages/stage-ui-live2d/src/composables/live2d/natural-motion/frame-types.ts` add `export type NaturalTouchRegion = 'head' | 'body'` and `export interface NaturalRigTraits { bodyFromHeadPhysics: { x: boolean, y: boolean, z: boolean } }`.
  - `natural-motion.ts`: replace `import type { Live2DRigProfile }` (line 12) with `NaturalRigTraits`; `setRigProfile(profile: Pick<Live2DRigProfile,'bodyFromHeadPhysics'>)` (line 444) becomes `setRigTraits(traits: NaturalRigTraits)`; field at line 170 typed `NaturalRigTraits['bodyFromHeadPhysics']`; `poke(region: Live2DTouchRegion, ...)` (line 418) takes `NaturalTouchRegion`; replace `EMOTION_VALUES` (line 18, loop at line 388) with `PERFORMANCE_EMOTIONS` from `@proj-airi/stage-shared/expression-performance` (identical order: happy, sad, angry, think, surprised, awkward, question, curious, neutral, love, flustered, sleepy).
  - `natural-motion/touch.ts` (lines 1, 37, 55) and `natural-motion/pending-actions.ts` (lines 3, 27): use `NaturalTouchRegion` from `./frame-types` instead of importing `../touch-gestures`.
  - `touch-gestures.ts` stays untouched: its own `Live2DTouchRegion = 'head' | 'body'` is structurally identical, so Live2D callers (touch-debug.ts, touch-regions.ts, adapter) keep compiling without an alias.
  - `natural-motion/impulses.test.ts:6`: replace `EMOTION_VALUES` from `../../../constants/emotions` with `PERFORMANCE_EMOTIONS`.
  - Update the adapter call site (`natural-motion-adapter.ts`, the `setRigProfile` call) to `setRigTraits({ bodyFromHeadPhysics: profile.bodyFromHeadPhysics })`.
  - Must NOT change any number, stream index (`streamIndex` in natural-motion.ts), or layer order.
  Closes: GAP-1
  Parallelization: Wave 1 | Blocked by: - | Blocks: 5
  References: `packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts:12,13,18,170,388,418,444`; `natural-motion/touch.ts:1,37,55`; `natural-motion/pending-actions.ts:3,27`; `touch-gestures.ts:1-4`; `packages/stage-shared/src/expression-performance/types.ts` (PERFORMANCE_EMOTIONS); `packages/stage-ui-live2d/src/constants/emotions.ts` (EMOTION_VALUES order); `packages/stage-ui-live2d/AGENTS.md`.
  Acceptance criteria: `rg -n "Live2DRigProfile|Live2DTouchRegion|constants/emotions|touch-gestures" packages/stage-ui-live2d/src/composables/live2d/natural-motion.ts packages/stage-ui-live2d/src/composables/live2d/natural-motion/{touch,pending-actions,frame-types,blink,body,breath,cursor-attention,emotions,energy,face,face-hints,gaze,gestures,hold,impulses,interpolation,mood,mood-modulation,placement,posture,processes,random,speech-emphasis}.ts packages/stage-ui-live2d/src/composables/live2d/natural-motion/*.test.ts` prints nothing for the files that move in todo 5 (rig-profile/trace/liveliness/gates/emotion-score/reference-stats/speech-fixture tests may still match and stay); K1 stage-ui-live2d node suite and qa-tools node suite pass; `pnpm -F @proj-airi/stage-ui-live2d typecheck` exits 0.
  QA scenarios:
  - Happy: K2 after the edit writes `$RUN_TMP/natural-after-1.json`; `node -e` comparing it to the baseline prints `EQUAL 15/15`. Evidence `.omo/evidence/mmd-natural-full-body/task-1-trace-diff.txt`.
  - Failure: temporarily change `streamIndex.gaze` from 4 to 15 in `natural-motion.ts`, run K2 and show mismatches for every seed/program; restore the single value by hand and confirm a K2 rerun prints `EQUAL 15/15`. Evidence `task-1-trace-mutation.txt`.
  Commit: Y | refactor(stage-ui-live2d): decouple Natural controller from Live2D rig and touch types
  Recommended task executor category: deep-low - mechanical edits whose correctness hinges on a determinism probe the worker can run.

- [ ] 2. Scaffold motion-driver-humanoid with canonical humanoid types and import guard
  What to do / Must NOT do:
  - Create `packages/motion-driver-humanoid` mirroring `packages/motion-driver-magic` structure but with SOURCE exports (like `packages/stage-shared/package.json:17-29`): `package.json` (`@proj-airi/motion-driver-humanoid`, private, type module, exports `./types`, `./look-at`, `./foot-contact`, `./weight-shift`, `./director` -> `./src/<name>/index.ts`; scripts `test: vitest run`, `typecheck: tsc --noEmit`; deps `@proj-airi/stage-shared` workspace; devDeps `@proj-airi/cpu-slots`, `vitest`), `tsconfig.json`, `vitest.config.ts` (`withCpuSlots`, Node, `src/**/*.test.ts`), `README.md` (purpose, usage, when to use, when not to use), `AGENTS.md` + `CLAUDE.md` containing only `@AGENTS.md`.
  - `src/types/index.ts`: `HumanoidBoneName` union of VRM humanoid names used here (hips, spine, chest, upperChest, neck, head, leftEye, rightEye, leftUpperLeg, leftLowerLeg, leftFoot, leftToes, right* equivalents, leftShoulder, leftUpperArm, leftLowerArm, leftHand, right* equivalents); `Vec3 = { x, y, z }`; `RestRelativeRotation = { yaw, pitch, roll }` in radians in the bone's parent frame; `RigTraits` (legLength, footBaselineY, kneeBendSign: 1 | -1, eyeYawLimit, eyePitchLimit, presentBones: HumanoidBoneName[]); `BodyIntent { stance: 'stand' | 'sit' | 'sleep', attention: { kind: 'camera' | 'cursor' | 'chat' | 'screen' | 'aside', point: Vec3 | null }, facingYaw: number }`. Doc comments state units (model units, radians, seconds).
  - Add both new package paths to root `vitest.config.ts` projects (next to `packages/motion-driver-magic`).
  - Add an eslint override in root `eslint.config.ts` for `packages/motion-driver-{natural,humanoid}/src/**` (not motion-driver-magic) with `no-restricted-imports` banning `three`, `three/*`, `vue`, `pinia`, `@moeru/three-mmd*`, `@proj-airi/stage-ui*`.
  - Run `pnpm install` once to link the workspace package (lockfile importer entry only).
  - Must NOT depend on three.
  Closes: GAP-5, GAP-10 (README)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 6, 7, 8, 9, 10
  References: `packages/motion-driver-magic/{package.json,tsconfig.json,vitest.config.ts,README.md}`; `packages/stage-shared/package.json:17-29`; root `vitest.config.ts` projects (motion-driver-magic entry); root `eslint.config.ts`; root `AGENTS.md` (README, AGENTS/CLAUDE pair, kebab-case).
  Acceptance criteria: `pnpm -F @proj-airi/motion-driver-humanoid typecheck` exits 0; `pnpm -F @proj-airi/motion-driver-humanoid exec vitest run` passes a types smoke test (`src/types/index.test.ts` asserting the bone list has no duplicates); `pnpm exec eslint packages/motion-driver-humanoid` exits 0.
  QA scenarios:
  - Happy: commands above, output to `task-2-checks.txt`.
  - Failure: add a scratch `import { Vector3 } from 'three'` in a temp file under `packages/motion-driver-humanoid/src`, run `pnpm exec eslint` on it and capture the `no-restricted-imports` error, delete the file. Evidence `task-2-guard.txt`.
  Commit: Y | feat(motion-driver-humanoid): add canonical humanoid types package
  Recommended task executor category: quick - scaffold following an existing package pattern.

- [ ] 3. Build the PMX morph runtime (pure core TDD + three appliers)
  What to do / Must NOT do:
  - New dir `packages/stage-ui-mmd/src/composables/mmd/morph-runtime/`.
  - `expand.ts` (pure, TDD first): input = PMX morph list shape (`type`, group `indices`/`ratios`, bone/material/uv elements) + per-morph requested weights; output = effective weights per morph type. Group own vertex weight stays on its own morph target (three-mmd bakes group vertex children, dist index.js ~L2062-2075); bone/material/UV children get `own + sum(group_w * ratio)` (ratios may be negative, no clamp); nested groups refused once at load with `console.warn`; Flip and Impulse morphs ignored with one warning.
  - `combine.ts` (pure, TDD first): per PMX morph, combine logical channel layers by priority devtools > lipSync (mouth morphs) > blink (eye morphs) > expression > clip > naturalFace: within a layer `max`, across layers `final = lerp(lower, upper, upperAlpha)`; lip-sync while speaking `vowel = lerp(expr, lip, speakEnv)` and mouth expressions x `(1 - 0.7 * speakEnv)`; blink `blink * (1 - exprEyeClosure)` maxed with an expression's own blink; additive channels summed then clamped [0,1].
  - `material.ts`: each frame, for every material touched by a material morph with non-zero weight this frame or last frame, build a fresh state with `createMMDMaterialEvaluatedState(material.descriptor)`, apply each element with `applyMMDMaterialMorph(state, element, weight)` (element material index -1 targets all materials; three-mmd implements Multiply type 0 and Add type 1 and all fields including texture/sphere/toon tints), then `material.applyMMDMaterialState(state)` (`MMDToonMaterial`, `dist/materials/toon.d.ts`; it writes diffuse, specular, ambient, opacity, shininess and the six tint uniforms, see `applyMMDMaterialState` in `dist/mmd-toon-material-CQmnUdOk.js`). Edge colour/size elements apply to the generated outline material of that part when present (outline tagging in `src/utils/mmd-materials.ts`), else no-op. Opacity composition: add `composeMMDMaterialOpacity(material, evaluatedOpacity, override)` to `src/utils/mmd-materials.ts` setting `opacity = override ?? evaluatedOpacity` and `transparent = descriptor transparency || opacity < 1`; while the morph runtime is mounted the MMD.vue `materialOpacity` watcher only updates the overrides record the runtime reads each frame, and every frame the runtime composes opacity for each MMD material (morphed or not) through this helper; `applyMMDMaterialOpacity` (mmd-materials.ts:80-98, which restores the cached original) stays only for the no-runtime path (before load completes). `applyMMDMaterialState` does not touch `emissiveIntensity`, so glow (`setMMDMaterialGlow`) needs no reapplication. The pure part (dirty-material and weight bookkeeping) is TDD first; the applier is covered by a browser test that a tint element at weight 1 changes `textureMultiplicativeColor` and weight 0 restores the descriptor values exactly.
  - `bone-morph.ts` (pure TDD first): convert PMX bone-morph offsets at load `dp = (x, y, -z)`, `dq = (-x, -y, z, w)` (post-parse does not flip bone morphs); apply absolutely from the clean pose: `pos = clean + sum(w * dp)`, `quat = clean * prod(slerp(I, dq, w))` in morph-index order. Use plain `{x,y,z,w}` math helpers in the pure file; the three applier converts.
  - `uv.ts`: type-3 UV morph writes `uv = baseUv + sum(w * offset.xy)` over affected vertices with `addUpdateRange` + `needsUpdate`; additional-UV (UV1-4) morphs are parsed, have no visual effect (as in MMD without effect shaders) and log once per model.
  - `index.ts`: `createMMDMorphRuntime(mmd: MMD)` returning `{ setChannel(layer, morphName, weight), applyBoneStage(cleanPose), applySurfaceStage(), resetToBase(), morphs: descriptor[] }`.
  - Must NOT be wired into MMD.vue here (todo 12/14 integrate).
  Closes: GAP-4
  Parallelization: Wave 1 | Blocked by: - | Blocks: 12, 14
  References: `node_modules/.pnpm/@moeru+three-mmd@0.2.0-beta_ecb8a19c92060be1056b4cb5481cf7c6/node_modules/@moeru/three-mmd/dist/index.js` (buildGeometry morph loop ~L2062-2075, material morph types ~L352-357, alpha morph enable ~L2278, post-parse ~L3066-3086), `dist/materials/index.d.ts` (applyMMDMaterialMorph), `dist/materials/toon.d.ts:8-31`, `dist/pmxObject-CVRQYFiE.d.ts:498-678`; `packages/stage-ui-mmd/src/composables/mmd/morph.ts`; `packages/stage-ui-mmd/src/utils/mmd-materials.ts`; PMX audit `H:/temp/pmx-audit-popb8wsa/audit.md` (Vivian bone-morph brows, WuWa material/UV morphs).
  Acceptance criteria: Node tests (written first, first run failing captured) cover: nested group refused; group+own add; negative ratio; combine priority table rows; vowel lerp; blink with expression eye closure; dirty-material bookkeeping (a material returns to clean once its weight is 0 for one frame); index -1 all materials; bone-morph conversion and absolute application with zero drift over 1000 applications; browser test `material.browser.test.ts` covers on a real `MMDToonMaterial`: tint at weight 1 and exact restore at weight 0; an alpha material morph at weight 1 sets opacity 0 with no user override; a user override 0.5 wins over the morph; removing the override restores the morph value; morph weight back to 0 restores the descriptor opacity; `pnpm -F @proj-airi/stage-ui-mmd exec vitest run` (both projects) green; typecheck exits 0.
  QA scenarios:
  - Happy: Node suite output `task-3-node.txt` incl. the initial failing run `task-3-tdd-red.txt`.
  - Failure: mutate the combine priority (swap lipSync and expression) in a scratch run; the priority test fails; restore. Evidence `task-3-mutation.txt`.
  Commit: Y | feat(stage-ui-mmd): add PMX morph runtime for group, bone, material and UV morphs
  Recommended task executor category: deep-low - several interacting rules the worker can settle from the dist code and audit.

- [ ] 4. Replace updateWithMixer with an MMD frame pipeline that owns a clean pose snapshot
  What to do / Must NOT do:
  - New `packages/stage-ui-mmd/src/composables/mmd/frame-pipeline.ts`: class `MMDFramePipeline` constructed with `{ mmd, mixer }` and named stage hooks `poseStages: Array<{ id, run(ctx) }>` and `surfaceStages`.
  - Per frame (`step(dt)`): `dt = Math.min(dt, 1/20)`; `mmd.beforeUpdate()`; restore every bone position/quaternion from the clean snapshot (preallocated arrays initialised from bind pose at load) and `mesh.morphTargetInfluences.fill(0)`; flush queued mixer commands (play/fadeIn/fadeOut/setIdle queued by the manager instead of executed immediately); `mixer.update(dt)`; `mmd.updateAnimation(mixer)`; capture clean snapshot (bones + clip morph influences + per-clip effective weights); run pose stages in registration order; `mmd.beforePhysics(opts)`; `physics.reset()` when a looping action wrapped this frame or `requestPhysicsReset()` was called (teleport/model transform change); `physics.update(dt)` when physics enabled; `mmd.afterPhysics(opts)`; run surface stages.
  - Time each stage with `performance.now()`; keep a 600-sample ring buffer per stage; expose `timings(): Record<stageId, { lastMs, p95Ms }>`.
  - `animation-manager.ts`: keep its public API, route `playAction`/`playIdle`/`setIdleMotion` through the pipeline's command queue, replace `update()` body with `pipeline.step(delta)`; register clips' foot-IK track presence (`.bones[左足ＩＫ].position` / `右足ＩＫ`) at `registerClip` for later contact blending.
  - Second commit of this todo (separate, after the pipeline commit is green): move Classic gaze (`gaze.ts`) into a pose stage writing `bone.quaternion = clean * delta` instead of `rest * delta` (fixes discarding VMD head/eye motion, `gaze.ts` applyBone), with a Node test asserting gaze composes with a clip that animates 頭. This is an intended Classic behaviour change recorded in the ADR (todo 22).
  - New pinia store `packages/stage-ui-mmd/src/stores/motion-diagnostics.ts`, id `mmd-motion-diagnostics`, publishing a snapshot at 10 Hz from MMD.vue on `BroadcastChannel('airi-stores-stage-ui-mmd-motion-diagnostics')` like `packages/stage-ui-live2d/src/stores/natural-motion-diagnostics.ts:143-149`. Snapshot contract (all fields present from this todo, sections `null` until their todo fills them): `loadedModelKey: string | null`, `driver: 'natural' | 'classic'`, `fps: { last: number, mean60s: number }` (from RAF intervals, 600-sample ring), `timings: Record<stageId, { lastMs, p95Ms }>`, `rig` (todo 10), `natural: { events: number, energy: number } | null` (todo 12), `feet: { maxError: number, errorL: number, errorR: number, contact: number } | null` (todo 13), `lookAt: { target, yaw, pitch, turning: boolean, turns: number } | null` (todo 13), `director: { stance, sinceMs, reason, clockOffsetMs } | null` (todo 18), `touch: { lastRegion, hitBody, petActive, headScreenPoint: { x, y } | null, events: number } | null` (todo 17), `animation: { idle: string | null, currentAction: string | null, actionsStarted: number }` (this todo), `measurement: { state: 'idle' | 'running' | 'done', durationMs, frames, fps, stages: Record<stageId, { meanMs, p95Ms, maxMs }> } | null` (this todo). Commands received on the same channel as `{ type: 'command', name, value }`: `startMeasurement` (clears and starts a full-run aggregation that keeps EVERY frame interval and stage duration in growable arrays until stopped; independent of the 600-sample rolling buffers), `stopMeasurement` (computes fps = frames / seconds and p95 over all collected samples, sets state `done`), `setDebugFlag` (`{ flag: 'disableFootContact' | 'disableLookAt', on: boolean }`, todo 13 consumes), `advanceDirectorClock` (ms, todo 18 consumes), `setOverlay` (todo 21 consumes). Unknown commands are ignored with one warning. Node test: a 3600-frame synthetic run with one 50 ms stage spike in the first second reports `maxMs >= 50` and frames 3600 after stop.
  - Pure-ish invariants TDD first in Node: build a fixture skeleton (three `Bone`/`Skeleton`/`SkinnedMesh`, pure JS) with standard JP names and ~20-unit bind positions plus a minimal PMX-shaped object (bones with ik/flag/transformOrder/appendTransform, `rigidBodies: []`, limits in post-parse space) and run the real `new MMD(pmx, mesh)` with physics off.
  - Must NOT change the MMD.vue public props/expose.
  Closes: GAP-6, GAP-8 (timings, diagnostics store)
  Parallelization: Wave 1 | Blocked by: - | Blocks: 12, 13
  References: three-mmd `dist/index.js` (MMD.beforeUpdate/beforePhysics/afterPhysics/update/updateWithMixer/updateAnimation/updateBones; ~L2938-3028; MMDAnimationManager.updateMMD ~L4549 physics.reset on loop); `packages/stage-ui-mmd/src/composables/mmd/{animation-manager.ts,animation-manager.test.ts,gaze.ts}`; `packages/stage-ui-mmd/src/components/scenes/MMD.vue:341-373` (renderLoop), `424-472` (loadModel); `packages/stage-ui-live2d/src/stores/natural-motion-diagnostics.ts:143-149`.
  Acceptance criteria: Node tests (red run captured first): constant inputs for 1000 frames keep every bone within 1e-6 position and `1 - |dot| < 1e-9` rotation of frame 1; a pose stage writing a fixed delta does not compound; clean snapshot equals mixer output (tracked bones) or bind (untracked); a fadeIn from no action never picks up pose-stage offsets; loop wrap triggers physics reset (spy on a fake physics service). Existing `animation-manager.test.ts` passes unchanged in intent. Browser project still green.
  QA scenarios:
  - Happy: K5 with Ellen zip (K3): a snapshot has `loadedModelKey` set, `timings` has one entry per registered stage with finite `p95Ms`, and `fps.mean60s > 30`. Evidence `task-4-web.json`.
  - Baseline: K6 with standard Chisa, Classic driver: post `startMeasurement`, wait until a collected snapshot shows `measurement.state === 'running'` with `durationMs >= 60000`, post `stopMeasurement`, record the `done` measurement as the Classic baseline for todo 23. Evidence `task-4-chisa-baseline.json`.
  - Failure: Node test variant with relative writes (scratch) shows drift > 1e-3 after 1000 frames, proving the test detects compounding; revert. Evidence `task-4-mutation.txt`.
  Commit: Y | two commits: feat(stage-ui-mmd): run MMD frames through a pipeline with a clean pose snapshot; fix(stage-ui-mmd): compose classic gaze with clip head motion before physics
  Recommended task executor category: deep-high - correctness is argued from three-mmd snapshot invariants across mixer, IK and physics.

- [ ] 5. Move the pure Natural modules into motion-driver-natural
  What to do / Must NOT do:
  - Create `packages/motion-driver-natural` (source exports `.` -> `./src/index.ts` and `./*` -> `./src/*.ts`; scripts test/typecheck; deps `@proj-airi/stage-shared`, `@moeru/std`, `es-toolkit` only as actually imported; `vitest.config.ts` Node with `withCpuSlots`; README; AGENTS.md + CLAUDE.md `@AGENTS.md`). Already covered by todo 2's eslint override glob.
  - `git mv` into `packages/motion-driver-natural/src/`: `natural-motion.ts` -> `natural-motion.ts`, and `natural-motion/{blink,body,breath,cursor-attention,emotions,energy,face,face-hints,frame-types,gaze,gestures,hold,impulses,interpolation,mood,mood-modulation,pending-actions,placement,posture,processes,random,speech-emphasis,touch}.ts` with their `*.test.ts` files.
  - Rename public symbols `Live2DNaturalMotion` -> `NaturalMotion`, `Live2DNaturalMotionFrame/Options/Pose/Voice` -> `NaturalMotionFrame/Options/Pose/Voice` everywhere.
  - Keep in stage-ui-live2d: `natural-motion-adapter.ts`, `natural-motion/{rig-profile,trace,liveliness,reference-stats,gates,emotion-score,speech-fixture}.ts`, `natural-chat-input.ts`, `touch-gestures.ts`, stores; their imports switch to `@proj-airi/motion-driver-natural/<module>`. The wildcard export `./composables/live2d/natural-motion/*` keeps serving the remaining files.
  - Before editing, run `lsp_find_references` on `Live2DNaturalMotion`, `NaturalEpisode`, `SpeechOnsetDetector` and `EMOTION_VALUES` to confirm the importer list below; the barrel `packages/stage-ui-live2d/src/composables/live2d/index.ts:9-11` drops those three re-exports.
  - Update every importer in the same commit: `packages/stage-ui/src/components/scenes/stage-emotion-routing.browser.test.ts:3,10,383`, `packages/stage-ui-live2d/src/{components/scenes/Live2D.vue,components/scenes/live2d/Model.vue,components/scenes/live2d/natural-voice-level.test.ts,composables/live2d/index.ts,composables/live2d/natural-motion-adapter.ts,composables/live2d/natural-chat-input.ts}`, `packages/stage-ui-live2d/scripts/*.ts`, `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` (NaturalEpisode, SpeechOnsetDetector imports), and all qa-tools importers (`spikes/t2/loop.ts`, `src/motion/{scenario-sink,t1/runner,t2/runner,touch-scenarios.test,t3/t3-screen-attention.test,aggregate.test,ks.test}.ts`, `src/motion/gate/*`, `src/motion/validation/*`, `src/report/{cells,panel-units,panel-units.test,trajectory-svg}.ts`).
  - qa-tools path constants: `src/motion/cache/cache.test.ts:22` and `src/motion/cache/guard.test.ts:26` must include both `packages/motion-driver-natural/src` and the remaining `packages/stage-ui-live2d/src/composables/live2d/natural-motion` sources; `src/motion/gate/cli.ts:133` keeps pointing at `gates.ts` (unchanged location).
  - Add `@proj-airi/motion-driver-natural` workspace dependency to stage-ui-live2d, stage-ui and qa-tools package.json; `pnpm install` once.
  - Must NOT edit numerics, stream indices, or test assertions beyond import paths and renamed symbols. Files that stay in stage-ui-live2d and import moved modules (`natural-motion/gates.ts:4,8` imports `./emotions`; `emotion-score.ts:4,9-13`; `trace.ts:3,5`; `reference-stats.ts`, `speech-fixture.ts:1`) receive IMPORT-LINE-ONLY edits pointing at `@proj-airi/motion-driver-natural/<module>`; gate ids, versions, thresholds and assertions stay byte-identical.
  Closes: GAP-1, GAP-8 (qa-tools paths)
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 11, 12, 22
  References: notepad lane natural-blast-radius (importer table); `packages/stage-ui-live2d/package.json:17-20`; `packages/stage-ui-live2d/src/composables/live2d/node-import.test.ts:12-23`; `packages/qa-tools/src/motion/cache/{cache,guard}.test.ts`; `packages/qa-tools/src/motion/gate/cli.ts:133`; `packages/stage-ui-live2d/scripts/{bench-natural,extract-natural-reference,score-natural-captures,score-natural-trace}.ts`.
  Acceptance criteria: `rg -n -g '*.ts' -g '*.vue' "Live2DNaturalMotion" packages apps` prints nothing; `rg -n -g '*.ts' -g '*.vue' -g '!packages/qa-tools/src/motion/cache/**' "composables/live2d/natural-motion/(blink|body|breath|cursor-attention|emotions|energy|face|gaze|gestures|hold|impulses|mood|placement|posture|processes|random|speech-emphasis|touch)" packages apps` prints nothing; `git diff -U0 main -- packages/qa-tools/gates packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts` contains only changed lines matching `^[-+]import ` (checked by a one-line `node` filter over the diff that prints `IMPORT-ONLY` or the offending lines); K1 suites for motion-driver-natural, stage-ui-live2d, qa-tools (`--project node`), the doc-path audit, the conductor tests (`pnpm -F @proj-airi/stage-ui exec vitest run src/composables/performance`) and `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenes/stage-emotion-routing.browser.test.ts` pass; `pnpm verify` exits 0.
  QA scenarios:
  - Happy: K2 run in the executing worktree with `--controller $WT/packages/motion-driver-natural/src/natural-motion.ts` writes `natural-after-5.json`; comparison prints `EQUAL 15/15` against `natural-baseline.json`. Evidence `task-5-trace-diff.txt`.
  - Failure: temporarily append the comment line `// readFileSync` to `packages/motion-driver-natural/src/gaze.ts`, run `pnpm -F @proj-airi/qa-tools exec vitest run --project node src/motion/cache/guard.test.ts` and capture the failing `reads no file directly on the worker side` assertion naming that file (proves the guard now covers the new directory); remove the line and rerun green. Evidence `task-5-guard.txt`.
  - Cleanup: delete `$RUN_TMP/natural-trace-hash.ts` and baseline files after the diff; receipt in `task-5-trace-diff.txt`.
  Commit: Y | refactor(motion-driver-natural): move pure Natural motion into a shared package
  Recommended task executor category: deep-low - wide mechanical move whose proof is the trace hash and suites.

- [ ] 6. Implement humanoid look-at distribution and body-turn hysteresis (TDD)
  What to do / Must NOT do:
  - `packages/motion-driver-humanoid/src/look-at/index.ts`: `createLookAt(options)` with `step(input, dt)`; input = target yaw/pitch (radians, in the stance frame), current facing yaw; output = per-bone `RestRelativeRotation` for spine, chest, neck, head plus eye targets and `facingYaw` command.
  - Distribution defaults (yaw share / limit deg, pitch share / up-down limit deg): spine .10/10, .05/5-5; chest .15/10, .10/8-8; neck .30/25, .35/20-25; head .45/35, .50/25-30. Critically damped springs omega torso 3, neck 5, head 7 rad/s.
  - Body turn: start when |yaw| > 60 deg for 0.5 s or immediately past 90 deg; turn until ~15 deg remains; stop under 20 deg; refractory 1.5 s; emits `turnSteps` (alternating foot, 0.35-0.45 s each, at most 45 deg per step pair) for todo 13.
  - Eye aim helper: given eye world positions and target, per-eye yaw/pitch clamped to `RigTraits.eyeYawLimit/eyePitchLimit` (defaults 0.35/0.25 rad).
  - Explicit time, no clocks, no Math.random.
  Closes: GAP-5
  Parallelization: Wave 2 | Blocked by: 2 | Blocks: 13
  References: notepad lane ultrabrain-details section 4; `packages/stage-ui-mmd/src/composables/mmd/gaze.ts` (EYE_YAW_LIMIT/EYE_PITCH_LIMIT); `packages/stage-shared/AGENTS.md` (resolver rules).
  Acceptance criteria: tests written first (red captured) assert joint limits never exceeded for random targets (seeded), eye ray within 0.5 deg of reachable targets, a target oscillating 50-65 deg at 1 Hz never triggers a turn, 120 deg target triggers exactly one turn and settles, refractory honored, springs frame-rate independent (60 vs 144 Hz results within 1e-3 rad after 2 s). K1 humanoid suite green.
  QA scenarios:
  - Happy: suite output `task-6-node.txt` + red run `task-6-tdd-red.txt`.
  - Failure: scratch mutation removing the hysteresis stop threshold makes the oscillation test fail. Evidence `task-6-mutation.txt`.
  Commit: Y | feat(motion-driver-humanoid): add look-at distribution with body-turn hysteresis
  Recommended task executor category: deep-low - algorithm with clear invariants.

- [ ] 7. Implement foot contact, leg reach and knee pre-bend planning (TDD)
  What to do / Must NOT do:
  - `src/foot-contact/index.ts`: per foot anchors in mesh-local space (position + yaw), contact weight `c` eased over 0.3 s, re-anchor when `c` rises from 0 at the last solved ankle position with Y snapped to `RigTraits.footBaselineY`; `c = enabled * (1 - clipFootTrackWeight) * duck`.
  - Leg reach: `L = |hip-knee| + |knee-ankle|`, `rMax = 0.985 L`; required drop `d = max(0, (h.y - g.y) - sqrt(rMax^2 - rho^2))`; when `rho > rMax` scale lateral shift down; applied drop `max(dL, dR, smoothed)` capped at `0.06 L`.
  - Knee pre-bend: when no clip animates the knee, a 4 deg bend with sign `RigTraits.kneeBendSign` (CCD returns without bending on collinear chains, three-mmd dist ~L2782).
  - Step planner for body turns: consumes look-at `turnSteps` and produces arc foot targets lifting 0.3 units.
  - Outputs plain positions/yaws; no quaternions.
  Closes: GAP-5
  Parallelization: Wave 2 | Blocked by: 2 | Blocks: 13
  References: notepad lane ultrabrain-details section 2; PMX audit leg IK and knee limits (`H:/temp/pmx-audit-popb8wsa/report.md` IK chains); three-mmd dist IK solver ~L2756-2860.
  Acceptance criteria: tests first (red captured): sweeping lateral pelvis +-0.6 over 600 frames keeps anchor error < 0.01 with no creep; drop stays in [0, 0.06L]; hip-ankle distance <= rMax + 1e-4; contact eases without snap (max per-frame anchor jump 0); clip foot weight 1 gives c = 0; pre-bend sign follows kneeBendSign. Humanoid suite green.
  QA scenarios:
  - Happy: `task-7-node.txt`, `task-7-tdd-red.txt`.
  - Failure: scratch mutation removing the reach clamp makes the hip-ankle bound test fail. Evidence `task-7-mutation.txt`.
  Commit: Y | feat(motion-driver-humanoid): add foot contact and leg reach planning
  Recommended task executor category: deep-low - geometric planner with explicit invariants.

- [ ] 8. Implement seeded weight shift (TDD)
  What to do / Must NOT do:
  - `src/weight-shift/index.ts`: `createWeightShift({ seed })`, support states left/both/right, dwell 6-18 s log-uniform, transitions 1.2-2.0 s smootherstep; output `s` in [-1,1] and derived pelvis lateral offset `0.45 s * (hipY / 11.5)`, lower-body roll `-4 deg * s`, yaw `3 deg * s`, base drop `0.06 |s|`, upper-body counter-roll `+2.5 deg * s`, chest `+1 deg * s`; ambient sway lateral `0.04 sin(2pi .23 t) + 0.025 sin(2pi .37 t)`, fore-aft `0.03 sin(2pi .19 t)`; `duck` multiplier input.
  - Composition helper with Natural body: Natural body x 10 deg split 0.6 spine / 0.4 chest; Natural low-pass body roll feeds pelvis lateral at 0.15 units per normalized unit; breath to chest pitch +-0.6 deg.
  - Seeded via the same RandomStream contract as Natural (import types from `@proj-airi/motion-driver-natural/random` is NOT allowed: humanoid must not depend on natural; implement a local mulberry32-style stream in `src/random.ts`).
  Closes: GAP-5
  Parallelization: Wave 2 | Blocked by: 2 | Blocks: 13
  References: notepad lane ultrabrain-details section 3; architect lane (no edge between natural and humanoid).
  Acceptance criteria: tests first (red): equal seeds give equal sequences; dwell and transition bounds hold over 1 h simulated; output bounded; duck 0 yields zero offsets. Suite green.
  QA scenarios:
  - Happy: `task-8-node.txt`, `task-8-tdd-red.txt`.
  - Failure: scratch seed-ignoring mutation fails the equal-seed test. Evidence `task-8-mutation.txt`.
  Commit: Y | feat(motion-driver-humanoid): add seeded weight shift
  Recommended task executor category: quick - formula module with listed constants.

- [ ] 9. Implement the stance and attention director (TDD)
  What to do / Must NOT do:
  - `src/director/index.ts`: pure `decideBody(input, memory) -> { intent: BodyIntent, memory }`; input `{ nowMs, performance: { mode, attention, away }, cursorPoint, chatPoint, cameraPoint, slots: { sit: boolean, sleep: boolean } }`.
  - Stance: sleep while `away` and sleep slot present; sit after 120 000 ms continuous `mode === 'idle'` and sit slot present; stand on any other mode; minimum dwell 3 000 ms between stance changes; missing slot keeps stand.
  - Attention: map PerformanceState attention camera/screen/cursor/aside to points (cursor point when attention cursor and present; chat point when the Natural chat glance is active is handled by todo 12, not here); export named constants with doc comments.
  - Explicit time, returns memory, never reads clocks or stores.
  Closes: GAP-5
  Parallelization: Wave 2 | Blocked by: 2 | Blocks: 18
  References: `packages/stage-shared/src/performance-state/index.ts` (PerformanceMode, attention, away); `packages/stage-shared/AGENTS.md`.
  Acceptance criteria: tests first (red): 119 s idle stays stand, 120 s sits, any talking frame stands, away sleeps, missing slots never sit/sleep, dwell prevents flapping, clock stepping back is clamped. Suite green.
  QA scenarios:
  - Happy: `task-9-node.txt`, `task-9-tdd-red.txt`.
  - Failure: scratch mutation dropping the dwell makes the flapping test fail. Evidence `task-9-mutation.txt`.
  Commit: Y | feat(motion-driver-humanoid): add stance and attention director
  Recommended task executor category: quick - small pure decider with listed rules.

- [ ] 10. Add the MMD rig adapter and rig profile reader
  What to do / Must NOT do:
  - `packages/stage-ui-mmd/src/composables/mmd/rig/`: `bone-map.ts` canonical `HumanoidBoneName` -> ordered MMD candidates (hips: 下半身 driven via センター/グルーブ for translation; spine 上半身; chest 上半身2; neck 首; head 頭; eyes 左目/右目 (fallback 両目); legs 左足/左ひざ/左足首/左つま先 and right; leg IK 左足ＩＫ/右足ＩＫ with half-width IK fallback; toe IK 左つま先ＩＫ/右つま先ＩＫ; arms 左肩/左腕/左ひじ/左手首 and right).
  - `rig-profile.ts` (pure part tested in Node with PMX-shaped fixtures): reads `mmd.pmx` (post-parse) to produce `MMDRigProfile`: present/missing canonical bones, leg IK chains with knee limit sign (from link limits; M5/M7/M10 differ), leg length from bind positions, footBaselineY from ankle bind Y, rest arm angle, eye bone source, physics-owned bones (bones of rigid bodies with physicsMode 1/2) and mode-2 helper bones, missing waist-cancel flag; converts to humanoid `RigTraits`.
  - Pose stages never write physics-owned bones.
  - Publish the profile to the diagnostics store `rig` section.
  Closes: GAP-5
  Parallelization: Wave 2 | Blocked by: 2 | Blocks: 12, 13, 15, 17
  References: PMX audit `H:/temp/pmx-audit-popb8wsa/{report.md,audit.md,audit.json}` (bone coverage, IK, physics, Vivian helpers, Ellen waist-cancel); `packages/stage-ui-mmd/src/composables/mmd/gaze.ts` (bone candidate lists); three-mmd `dist/pmxObject-CVRQYFiE.d.ts` (bone, IK, rigid body fields).
  Acceptance criteria: Node tests with fixtures modeled on Ellen (no 腰キャンセル), Vivian (mode-2 bodies on 左足2/ひざ2), Carlotta (positive knee limit sign) produce expected profiles; typecheck green.
  - This todo does not edit MMD.vue; publishing the profile to diagnostics happens in todo 12 (first MMD.vue writer of wave 3), whose QA reads it live.
  QA scenarios:
  - Happy: Node suite over PMX-shaped fixtures for Ellen, Vivian and Carlotta (bone names, IK links and limits, rigid bodies copied as literals from `H:/temp/pmx-audit-popb8wsa/audit.json`; no model files read by tests): profiles list all core bones, `waistCancel: false` for Ellen, Vivian's `左足2/右足2/左ひざ2/右ひざ2` in `physicsOwned`. Evidence `task-10-node.txt`.
  - Failure: fixture missing 左足ＩＫ reports `legIk.left: null` (test). Evidence `task-10-node.txt`.
  Commit: Y | feat(stage-ui-mmd): add MMD rig profile and humanoid bone map
  Recommended task executor category: unspecified-high - multi-file adapter grounded in the audit.

- [ ] 11. Route the stage performance conductor to the active renderer's scene and expression backend
  What to do / Must NOT do:
  - In `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` replace the direct `useExpressionStore()` reads (lines ~650-679) with an `expressionBackend: () => StageExpressionBackend | undefined` option (catalog, modelId, eligible/active expressions, performer commands) and make `scene` and `driver` renderer-aware.
  - Define `StageExpressionBackend` in `packages/stage-ui/src/features/performance/` with the exact members the conductor uses today; implement it for Live2D by wrapping `useExpressionStore` (same behaviour).
  - `Stage.vue:305-310`: pass `scene: () => renderer === 'live2d' ? live2dSceneRef.value : renderer === 'mmd' ? mmdSceneRef.value : undefined` and the matching backend; `driver` returns Live2D's driver for live2d and `'natural'` for mmd when the MMD driver setting is natural.
  - `NaturalEpisode`/`SpeechOnsetDetector` imports already come from `@proj-airi/motion-driver-natural` (todo 5); `useNaturalMotionDiagnostics` affect-trace stays Live2D-only behind a renderer check.
  - Live2D behaviour must be identical; MMD wiring of the backend is todo 16.
  Closes: GAP-2
  Parallelization: Wave 3 | Blocked by: 5 | Blocks: 14, 16, 19
  References: lane conductor-coupling sections 1, 3; `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts:1-13,83-90,196,216-256,306-317,448-469,650-702`; `use-stage-performance-conductor.test.ts`; `packages/stage-ui/src/components/scenes/Stage.vue:305-310,344-372,439-456`; `packages/stage-ui/src/tools/expression.ts`.
  Acceptance criteria: existing conductor tests pass with only construction changes; new tests prove no scene calls when renderer is neither live2d nor mmd, and an affect-trace request (`use-stage-performance-conductor.ts:695-702`) is answered for live2d and ignored for mmd; `pnpm -F @proj-airi/stage-ui typecheck` 0.
  QA scenarios:
  - Happy: `pnpm -F @proj-airi/stage-ui exec vitest run src/composables/performance` output `task-11-tests.txt`.
  - Failure: test asserting that with renderer `vrm` an ACT expression produces no scene dispatch and does not throw. Evidence same file.
  Commit: Y | refactor(stage-ui): select the performance scene and expression backend by renderer
  Recommended task executor category: deep-low - cross-module refactor with an existing test suite as the contract.

- [ ] 12. Add the MMD Natural adapter
  What to do / Must NOT do:
  - `packages/stage-ui-mmd/src/composables/mmd/natural/adapter.ts`: owns a `NaturalMotion` instance constructed with `{ seed: fnv1a32(modelKey) }` (32-bit FNV-1a over the UTF-16 code units of the stage model id; helper in the same folder with a Node test), advances it each frame with monotonic seconds, feeds performance, voice (speaking, speechActiveOrRecent, level), chat input, cursor (head-width units computed from the projected head bone span: head-top estimate from 頭 bind position + 1.5 x neck-to-head length), placement inwardness (via `@proj-airi/stage-shared/stage-placement`), touch.
  - Pose stage `natural`: head deltas split neck 0.4 / head 0.6 at +-30 deg span, body to spine/chest at +-10 deg span (rest-relative, absolute from clean); eyes left for todo 13's eye stage when look-at is active, otherwise eyes at Natural span; breath to chest pitch.
  - Surface stage: face offsets -> morph-runtime `naturalFace` layer (brows -> 困る/真面目/怒り candidates per side where present, lids -> まばたき partial, smile -> 笑い/にこり, mouth form -> vowel blend kept below lip-sync), blink factor -> blink layer, using morph slots from `src/constants/morphs.ts` extended with brow/lid channels.
  - Driver selection: `natural` (default) uses this adapter; `classic` keeps gaze/blink/emote composables. Setting key `settings/mmd/motion-driver` in `src/stores/mmd.ts` (default `'natural'`).
  - Publish `natural: { events, energy, headYaw }` (headYaw = the 頭 local yaw written this frame, radians) and the todo 10 rig profile (`rig` section) to diagnostics.
  Closes: GAP-3 (motion side), IS-2
  Parallelization: Wave 3 (first MMD.vue writer of the wave) | Blocked by: 3, 4, 5, 10 | Blocks: 13, 15, 16, 17
  References: `packages/motion-driver-natural/src/natural-motion.ts` (API), `frame-types.ts` (frame), `packages/stage-ui-live2d/src/composables/live2d/natural-motion-adapter.ts` (feeding pattern, voice, chat, placement), `packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:20-24,70-73` (input wiring), `packages/stage-ui-mmd/src/constants/morphs.ts`, `src/composables/mmd/{blink,lip-sync,expression}.ts`.
  Acceptance criteria: Node test with the todo 4 fixture: Natural frames move head/neck/spine within spans and never touch physics-owned bones; zero drift after 1000 frames with constant Natural output; Classic path test still passes.
  QA scenarios:
  - Happy: K5 with Ellen, Natural driver, cursor moved across the canvas via `page.mouse.move` in 10 steps: snapshot `natural.events > 0` and `lookAt.yaw` (or, before todo 13, the head yaw added to the snapshot `natural` section as `headYaw`) has the sign of the cursor side; two screenshots left/right. Evidence `task-12-web.json`, `task-12-left.png`, `task-12-right.png`.
  - Failure: switch `settings/mmd/motion-driver` to `classic` and confirm diagnostics `driver: 'classic'` and Natural events stay 0. Evidence `task-12-classic.json`.
  - Rig live: K5 with Vivian and Ellen: snapshot `rig` lists all core bones, Ellen `waistCancel: false`, Vivian helpers in `physicsOwned`. Evidence `task-12-rig-vivian.json`, `task-12-rig-ellen.json`.
  Commit: Y | feat(stage-ui-mmd): drive MMD models with the shared Natural motion
  Recommended task executor category: deep-low - adapter mapping with clear source pattern.

- [ ] 13. Wire full-body layers: weight shift, foot contact, look-at chain and eyes
  What to do / Must NOT do:
  - `packages/stage-ui-mmd/src/composables/mmd/body/`: pose stages registered after `natural` in order `weight-shift` -> `foot-contact` -> `look-at` -> `eyes`.
  - weight-shift: write グルーブ position (lateral, drop, fore-aft) and 下半身 roll/yaw absolutely from clean; upper-body counter-roll composed with Natural body; resolve sign conventions from bone world axes at load (three-mmd Z flip).
  - foot-contact: compute anchors via todo 7 planner; write 左足ＩＫ/右足ＩＫ local position/rotation `lerp(clean, planted, c)` in the IK bone's parent space (`ik.parent.updateWorldMatrix(true,false)`), call `mmd.ikSolver.setEnabled(legIkIndex, true)` after `updateAnimation` when `c > 0`; knee pre-bend into clean knee when no clip animates ひざ; skip when the rig lacks leg IK.
  - look-at: world target from director/Natural attention (cursor ray hit on the plane z = head z, chat window point projected from screen DIP when available, camera position); apply todo 6 outputs by premultiplying in parent frame; Natural head additive x0.5 when a target exists; facing yaw on センター Y with foot step arcs from todo 7.
  - eyes (last): per-eye closed-loop aim from eye world positions, Natural saccade high-pass x0.3 added.
  - Duck all body layers by active clip weights (stance clips from todo 18, any one-shot).
  - Publish `feet` (anchor error per foot, c), `lookAt` (target, yaw, turn state) to diagnostics.
  Closes: GAP-5, GAP-6
  Parallelization: Wave 3 (last MMD.vue writer of the wave) | Blocked by: 4, 6, 7, 8, 10, 12, 15 | Blocks: 17, 18, 21
  References: lane ultrabrain-details sections 1-4; three-mmd dist IK solver and grant solver (~L2418-2430, ~L2756-2860); todo 4 pipeline; todo 10 rig profile.
  Acceptance criteria: Node fixture tests: anchor error < 0.01 during 600 frames of weight shift; knee limits honored; eye ray within 0.5 deg; no drift. Browser test (`*.browser.test.ts`) mounting the pipeline with the fixture skeleton and real `MMDIKSolver` confirms foot IK solves to anchors.
  QA scenarios:
  - Happy: K5 on Ellen, Vivian, standard Chisa, long-skirt Elysia (K3 zips) for 60 s each with cursor sweeps: diagnostics `feet.maxError < 0.05` per model, `lookAt.turns` >= 1 after moving the cursor far left for 2 s; screenshots at t=0/30/60 s. Evidence `task-13-<model>.json`, `task-13-<model>-<t>.png`.
  - Failure: post `{ type: 'command', name: 'setDebugFlag', value: { flag: 'disableFootContact', on: true } }` and show `feet.maxError` grows above 0.2 within 60 s on Ellen (proves the metric detects skating); post `on: false` after. Evidence `task-13-no-contact.json`.
  Commit: Y | feat(stage-ui-mmd): add planted feet, weight shift and 3D look-at to MMD models
  Recommended task executor category: deep-high - several coupled stages whose correctness depends on IK/physics ordering invariants.

- [ ] 14. Derive an MMD expression catalog and expression store
  What to do / Must NOT do:
  - `packages/stage-ui-mmd/src/stores/expression-store.ts` + `src/utils/expression-catalog/derive.ts`: one `CatalogEntry` per PMX morph (id = `mmd:<morph index>:<name>`, label = morph name, `fileName` = morph name, `parameterIds` = [morph name], `area` from PMX panel (eyebrow/eye -> 'eyes' or 'whole-look' heuristics: eyebrow+eye -> eyes, mouth -> mouth, other -> effects for material/UV morphs, hidden panel 0 -> hidden), `kind` defaults: vowels/blink/wink -> system (not LLM-eligible), material/UV morphs -> effect, others -> face; emotion mappings from name tokens reusing `packages/stage-ui-live2d/src/utils/expression-catalog/tokens.ts` semantics where applicable (import the shared helper only if it lives in stage-shared; otherwise implement the MMD token table locally).
  - Curated overrides and persistence use the SAME key strings and serialized shape as Live2D: `expression-catalog:${modelId}` and `expression-rest:${modelId}` (`packages/stage-ui-live2d/src/stores/expression-catalog-persistence.ts:24-31`), parsed with the shared `CuratedOverrideSchema` / merge helpers from `@proj-airi/stage-shared/expression-performance`; stage model ids are unique across renderers (`display-model-*`), so the shared panel (todo 19) needs no renderer branch. Implement the read/write locally in stage-ui-mmd (no import from stage-ui-live2d).
  - Slot application: face/effect/prop leases with fades into morph-runtime `expression` layer; combos expand members.
  - Implement `StageExpressionBackend` (todo 11) for MMD.
  - Expose the same settings API shape as the Live2D store: `modelId`, `settingsSnapshot` (renderer-neutral `ExpressionPanelSnapshot` defined in this todo under `packages/stage-ui-mmd/src/stores/expression-store.ts` with entries, groups, active ids, rest ids) and `applySettingsCommand(command)` (curate, set rest, set active, create combo, reset), so todo 19 can transport it across windows exactly like `live2dExpressions`.
  Closes: GAP-2, IS-4 (data side)
  Parallelization: Wave 3 | Blocked by: 3, 11 | Blocks: 16, 19
  References: lane conductor-coupling section 2; `packages/stage-shared/src/expression-performance/{catalog,combos,settings}.ts`; `packages/stage-ui-live2d/src/stores/{expression-store,expression-catalog-persistence,expression-slot-leases}.ts`; `packages/stage-ui-live2d/src/utils/expression-catalog/*`; PMX audit morph lists.
  Acceptance criteria: Node tests: derivation for an Ellen-like morph list yields vowels as system, 笑い as face with happy mapping, material morphs as effect; persistence round-trip per model id; slot lease fade reaches target and releases.
  - This todo does not edit MMD.vue or Stage.vue; mounting the store against a live model happens in todo 16, whose QA reads it live.
  QA scenarios:
  - Happy: Node tests derive the catalog from the standard-Chisa morph list (fixture built from `H:/temp/pmx-audit-popb8wsa/audit.json` names/panels/types, copied into the test as a literal) and assert > 100 entries with expected kind counts; a lease applied through the store emits the expected `setChannel('expression', ...)` calls on a fake morph runtime. Evidence `task-14-node.txt`.
  - Failure: an unknown expression id is ignored without throwing and logs once (test). Evidence `task-14-node.txt`.
  Commit: Y | feat(stage-ui-mmd): derive an expression catalog from PMX morphs
  Recommended task executor category: unspecified-high - store and derivation following the Live2D pattern.

- [ ] 15. Frame the camera from skeleton bounds
  What to do / Must NOT do:
  - `MMD.vue` `frameCamera()`: compute bounds from the rig profile (foot baseline Y from ankle/toe bones, head top from 頭 world position + 1.5 x neck-head length, width from shoulder span x 2.2) instead of `Box3.setFromObject(modelGroup)`; fall back to Box3 only when the rig lacks 頭 or ankles.
  - Keep the 1.2 margin and both-axis fit.
  Closes: GAP-7
  Parallelization: Wave 3 (after 12, before 13: sole MMD.vue writer between them) | Blocked by: 10, 12 | Blocks: 13, 23
  References: `packages/stage-ui-mmd/src/components/scenes/MMD.vue` frameCamera (~lines 230-260); PMX audit 6.2 (Elysia mesh min Y -17.8).
  Acceptance criteria: Node test of the pure bounds function with an Elysia-like fixture (mesh far below feet) returns bounds from the skeleton.
  QA scenarios:
  - Happy: K5 screenshots of long-skirt Elysia and Ellen: in both, the head top lies within the top 20% of the canvas and the feet within the bottom 15% (pixel check on the captured PNG alpha). Evidence `task-15-elysia.png`, `task-15-ellen.png`, `task-15-check.json`.
  - Failure: fixture without 頭 falls back to Box3 (test). Evidence `task-15-node.txt`.
  Commit: Y | fix(stage-ui-mmd): frame MMD models from their skeleton instead of the mesh bounds
  Recommended task executor category: quick - one function plus a small helper.

- [ ] 16. Implement StagePerformanceScene for MMD and pass the Live2D stage inputs to MMDScene
  What to do / Must NOT do:
  - `MMD.vue` props: add `performance`, `naturalEnergy`, `performanceSettings`, `screenPlacement`, `chatTarget`, `chatActivity`, `mouthOpenSize`, `nowSpeaking` with the same types as `Live2DScene`, ALL optional with the defaults `Live2DScene` uses (preview-stage passes none); feed them to the Natural adapter.
  - `defineExpose` adds `setEmotion(episode)` for Natural episodes (keep the existing `(name, intensity)` behaviour for the Classic path as `setClassicEmotion` and update Stage.vue's call), `applySlots`, `applyHolds`, `onSpeech`, `setMuted`, `getMood` matching `StagePerformanceScene`.
  - Emotion-to-action mapping keeps working on BOTH drivers: today `MMD.vue:507-513` plays the `emotionActionMap` motion on every emotion; the conductor's Natural branch skips `playMotion` (`use-stage-performance-conductor.ts:226-230`), so the MMD scene's Natural `setEmotion(episode)` itself plays the mapped motion for `episode.emotion` when it is registered (same rule and one-shot semantics as Classic), and body layers duck under it via the clip weight.
  - `Stage.vue`: pass the props to `<MMDScene>` (lines ~1000-1015) exactly as for Live2D (lines ~923-948); `emotionsQueue` mmd branch -> conductor when driver natural, Classic path otherwise; ACT expressions route to the conductor for mmd (lines ~344-352, 449-451); pass MMD expression backend from todo 14.
  - `preview-stage.vue` keeps working (Natural runs; no conductor).
  - Speech level for MMD: Stage's shared wlipsync level loop is Live2D-only today (`Stage.vue:709` syncLipSyncLoop, `:718` setupLipSync, `:847` renderer watcher). Add a computed `usesSharedSpeechLevel = renderer === 'live2d' || renderer === 'mmd'` and use it at those three gates, so `mouthOpenSize` is produced for MMD and `performanceConductor.sampleVoiceLevel` (`Stage.vue:684`) feeds speech onsets for MMD too; MMD's own vowel lip-sync (`useMMDLipSync`) keeps driving the mouth morphs; the Natural adapter's `voice.level` reads the `mouthOpenSize` prop.
  Closes: GAP-3, GAP-2
  Parallelization: Wave 4 (first MMD.vue and Stage.vue writer of the wave) | Blocked by: 11, 12, 14 | Blocks: 17, 20, 21, 22
  References: lane conductor-coupling sections 1, 4, 5; `packages/stage-ui-live2d/src/components/scenes/Live2D.vue:165-178`; `packages/stage-ui/src/components/scenes/Stage.vue:278-289,305-310,344-372,439-518,923-948,1000-1015`; `apps/stage-tamagotchi/src/renderer/pages/index.vue:430-455,498-503`; `packages/stage-ui/src/components/scenarios/settings/model-settings/preview-stage.vue:5,240`.
  Acceptance criteria: Stage tests (existing) pass; a Stage browser test with renderer mmd plays a synthesized tone through the speech destination (pattern: `packages/stage-ui-mmd/src/composables/mmd/lip-sync.browser.test.ts:9-51`) and asserts `mouthOpenSize > 0` reaches `MMDScene` and the conductor's voice sampling receives a non-zero level, and that switching to renderer vrm stops the loop; extend `packages/stage-ui/src/components/scenes/stage-emotion-routing.browser.test.ts` with an mmd case: an ACT `{"emotion":"happy","expression":"<label>"}` reaches the MMD scene's `applySlots` and a Natural episode; a preview-stage render test mounts `MMDScene` without the new props; `pnpm -F @proj-airi/stage-ui typecheck` 0.
  QA scenarios:
  - Happy: K6 Electron with Ellen: `pulseEmotion('happy', 0.7)` on the `natural-performance-override` store (Stage.vue:580-587 routes it through the emotion queue with source `'devtools'`); within 1 s the snapshot `natural.events` increases and a face morph on the happy mapping is > 0.2 (read through the expression store snapshot). Evidence `task-16-electron.json`.
  - Failure: with a Live2D model selected, the same pulse still produces a Live2D Natural impulse (read `live2d-natural-motion-diagnostics`), proving no Live2D regression. Evidence `task-16-live2d.json`.
  - Catalog live: K5 with standard Chisa: the MMD expression store snapshot lists > 100 entries; applying an `effect` entry through the store changes that material's `color` or opacity read back with `page.evaluate`. Evidence `task-16-catalog.json`.
  - Regression (both drivers): import the K4 `nod` VMD, map `happy` to it in the MMD settings emotion-to-action map, then `pulseEmotion('happy', 0.7)` under Natural and again under Classic; each time the snapshot `animation.currentAction === '<nod motion name>'` within 1 s and `actionsStarted` increments. Evidence `task-16-action-natural.json`, `task-16-action-classic.json`.
  Commit: Y | feat(stage-ui): drive MMD scenes through the stage performance conductor
  Recommended task executor category: deep-low - integration across Stage and scene with known contracts.

- [ ] 17. Add rigid-body touch regions with physical response
  What to do / Must NOT do:
  - `packages/stage-ui-mmd/src/composables/mmd/touch/`: build colliders from `mmd.pmx.rigidBodies` (post-parse; shapes sphere/box/capsule with `shapeSize`, `shapePosition`, `shapeRotation`, bound to `boneIndex`): store body-to-bone offset at load; at pointer events compute world transforms from bone matrices and raycast (three `Ray` against analytic shapes); region head = bodies on 頭/首 or their children chains, body = 上半身/上半身2/下半身 chains; fallback: mesh raycast + bone weight lookup.
  - Feed Natural `poke(region, x, y, now)` and pet (hover by default, `settings/mmd/natural-touch-pet-requires-hold`), master toggle `settings/mmd/natural-touch` (default true), mirroring `packages/stage-ui-live2d/src/composables/live2d/live2d.ts:17-25` semantics; emit `touch` event from MMDScene like Live2DScene.
  - Physical response comes only from moving head/body bones through Natural before physics (no Ammo access).
  - Publish `touch` (`lastRegion`, `hitBody`, `petActive`, `events`, and `headScreenPoint` = projection of the head collider centre into canvas client pixels each snapshot) to diagnostics.
  Closes: IS-8
  Parallelization: Wave 4 (after 16) | Blocked by: 10, 12, 13, 16 | Blocks: 18, 20, 21
  References: physics-ammo dist helper `createGeometry` (shape sizes: box size*2, capsule(r,h), sphere) at `node_modules/.pnpm/@moeru+three-mmd-physics-am_81aba66471607cd279deb70e7a896c67/node_modules/@moeru/three-mmd-physics-ammo/dist/index.js` ~@1838769; `packages/stage-ui-live2d/src/composables/live2d/{touch-gestures,touch-regions}.ts`; `packages/motion-driver-natural/src/touch.ts`.
  Acceptance criteria: Node test: ray through a sphere/box/capsule fixture hits with correct region; miss returns null.
  QA scenarios:
  - Happy: K5 with Ellen: diagnostics exposes `touch.headScreenPoint`; `page.mouse.click` there yields a poke event and head pitch change > 2 deg within 0.6 s; hover 2 s yields pet-start. Evidence `task-17-poke.json`, `task-17-pet.json`.
  - Failure: click on empty canvas yields no touch event. Evidence `task-17-miss.json`.
  Commit: Y | feat(stage-ui-mmd): add poke and pet touch on MMD models via rigid-body colliders
  Recommended task executor category: unspecified-high - geometry plus wiring across known modules.

- [ ] 18. Add stance clip slots driven by the director
  What to do / Must NOT do:
  - `src/stores/mmd.ts`: per-model record ref `stanceSlots` persisted at `settings/mmd/stance-slots` `{ [modelId]: { idle?: motionName, sit?: motionName, sleep?: motionName } }` (motion names from the imported VMD list).
  - Base layer in the animation manager: stance actions loop, cross-fade 0.6 s; idle slot replaces `idleMotionName` per model when set.
  - Idle/stance separation rule: a motion assigned to this model's sit or sleep slot is never played as the standing idle. When `idleMotionName` (auto-set by the import handler at `packages/stage-ui/src/components/scenarios/settings/model-settings/mmd.vue:113-122` to the first imported VMD) equals a motion in a sit/sleep slot, the standing base is the per-model idle slot if set, else the rest pose. Node test covers it.
  - Each frame call todo 9 `decideBody` with PerformanceState, slot availability and time; apply stance; duck Natural body/head amplitude by the stance clip weight (head attention kept at 0.5) and foot contact `c` by clip foot-track weight.
  - Publish `director` (stance, sinceMs, reason, clockOffsetMs) to diagnostics; handle the `advanceDirectorClock` command by adding its ms to a debug offset applied to the director's `nowMs` only (never to Natural or physics), with a Node test that the offset changes only the director input.
  Closes: IS-9
  Parallelization: Wave 4 (after 17) | Blocked by: 9, 13, 17 | Blocks: 20, 21
  References: `packages/stage-ui-mmd/src/stores/mmd.ts` (availableMotions, idleMotionName, addMotion); `src/composables/mmd/animation-manager.ts`; todo 9 director; K4 QA VMD.
  Acceptance criteria: Node test with the fixture: stance switch cross-fades without pose pops (max per-frame bone delta < 5 deg).
  QA scenarios:
  - Happy: K5 with Ellen: import the K4 `sit` VMD through the existing MMD settings motion import (`settings.mmd.animation.import-motion` in `mmd.vue`), assign it to the sit slot through the store (pinia store id `mmd`: in `page.evaluate` set its `stanceSlots` record for the selected model id to `{ sit: '<imported motion name>' }`; the settings picker is verified in todo 20), keep the stage idle; record the standing baseline `director.centerY` (センター world Y, added to the `director` section) once `director.stance === 'stand'` and the auto-selected idle is confirmed suppressed (`animation.idle !== '<sit motion name>'`); post `advanceDirectorClock` 60000: after 2 s the snapshot still shows `stance === 'stand'` and `centerY` within 0.1 of baseline; post `advanceDirectorClock` 60000 again (120 s total): within 2 s `stance === 'sit'` and `centerY` is lower than the baseline by > 4 units. Evidence `task-18-sit.json`, `task-18-sit.png`.
  - Failure: without a sleep slot, `away` keeps `stance: 'stand'`. Evidence `task-18-no-slot.json`.
  - Cleanup: remove the imported QA VMD from IndexedDB through the settings delete action; receipt in evidence.
  Commit: Y | feat(stage-ui-mmd): add sit and sleep stance slots driven by the body director
  Recommended task executor category: unspecified-high - store, manager and director wiring.

- [ ] 19. Generalize the expression panel for Live2D and MMD
  What to do / Must NOT do:
  - Extract the renderer-neutral panel from `Live2dExpressionsSection` into `packages/stage-ui/src/components/scenarios/settings/model-settings/expressions/` with a `ExpressionPanelSource` contract (snapshot: entries, groups, active ids, rest ids; commands: curate, set active/rest, create combo, reset) implemented by Live2D's store and the MMD store from todo 14; keep the emotion-first layout.
  - Live2D settings use the shared panel with identical behaviour; MMD settings (`mmd.vue`) gain the panel.
  - Electron cross-window transport (the settings window does not own the stage's store): add `mmdExpressions?: ExpressionPanelSnapshot` to `ModelSettingsRuntimeSnapshot` in `packages/stage-ui/src/components/scenarios/settings/model-settings/runtime.ts` (next to `live2dExpressions`, line 18); in `apps/stage-tamagotchi/src/renderer/pages/index.vue` the `mmd` branch of `modelSettingsRuntimeSnapshot` (lines 277-289) sets `modelId: mmdExpressionStore.modelId` and `mmdExpressions: mmdExpressionStore.settingsSnapshot`; add `applyMMDExpressionCommand` to `apps/stage-tamagotchi/src/renderer/composables/model-settings-runtime-owner.ts` (mirroring `applyLive2DExpressionCommand`, lines 22 and 74) and pass it at `index.vue:383-390`; `mmd.vue` reads `runtimeSnapshot.mmdExpressions ?? store.settingsSnapshot` and emits `mmdExpressionCommand` when remote, mirroring `live2d.vue:90-101`; `panel.vue` re-emits it like `live2dExpressionCommand` (lines 41, 115) and the settings window's runtime client forwards it the same way Live2D commands are forwarded (follow the path exercised in `apps/stage-tamagotchi/src/renderer/composables/model-settings-runtime.browser.test.ts:87`). Extend that browser test with an MMD command round trip.
  - Update `docs/assets/ai/context/ui-components.md` and the matching story if the shared component API changes (root AGENTS.md rule).
  Closes: IS-4 (UI side)
  Parallelization: Wave 4 (after 16; parallel with 17 and 18, disjoint files) | Blocked by: 11, 14, 16 | Blocks: 20
  References: `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:20,90-100,917-934`; the component file defining `Live2dExpressionsSection` (find with `rg -n "Live2dExpressionsSection" packages/stage-ui/src`); `DESIGN.md`; `.agents/skills/enforce-rules-for-unocss/SKILL.md`; existing browser/settings tests under `packages/stage-ui/src/components/scenarios/settings/model-settings/`.
  Acceptance criteria: existing Live2D settings tests pass; new browser test renders the panel with an MMD source fixture and curates an entry; stage-ui typecheck 0.
  QA scenarios:
  - Happy: K5 with standard Chisa: open `/settings/models`, MMD panel shows expression groups; toggling LLM exposure on one entry persists after reload (`localStorage['expression-catalog:<model id>']` contains the override with `exposedToLlm` set, and the reloaded panel shows the toggled state). Screenshots desktop 1280 and mobile 390 widths. Evidence `task-19-desktop.png`, `task-19-mobile.png`, `task-19-persist.json`.
  - Failure: Live2D panel screenshot before/after shows identical layout (pixel diff under 1% on a fixed model). Evidence `task-19-live2d-diff.json`.
  - Electron: K6 with standard Chisa: in the SETTINGS window target, set one face entry as the rest expression through the panel; within 2 s the MAIN window's MMD expression store (read via its pinia `$pinia._s`) lists it in `rest` ids and the entry's morph weight in the main window is > 0.5; toggling it back clears both. Evidence `task-19-electron.json`.
  Commit: Y | refactor(stage-ui): share the expression panel between Live2D and MMD
  Recommended task executor category: visual-engineering - UI extraction with screenshot verification.

- [ ] 20. Add MMD motion settings and English strings
  What to do / Must NOT do:
  - `packages/stage-ui/src/components/scenarios/settings/model-settings/mmd.vue`: section "Motion" with driver radio (Natural default, Classic), Natural energy slider (shared `settings/expression-performance` energy or an MMD key mirroring `settings/live2d/natural-energy`: use `settings/mmd/natural-energy`, default equal to Live2D default), touch toggles (`settings/mmd/natural-touch`, `settings/mmd/natural-touch-pet-requires-hold`), stance slot pickers (idle/sit/sleep selects over imported motions).
  - Strings in `packages/i18n/src/locales/en/settings.yaml` under `settings.mmd.motion.*`; run `pnpm -F @proj-airi/i18n build` if consumers read dist (memory note).
  - Must NOT edit other locales.
  Closes: GAP-9
  Parallelization: Wave 5 | Blocked by: 16, 17, 18, 19 | Blocks: 22, 23
  References: `mmd.vue:100-137,320-350`; `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue` (Natural controls); `packages/stage-ui-live2d/src/composables/live2d/live2d.ts:11-25,72,106`; `packages/i18n/AGENTS.md`.
  Acceptance criteria: settings browser test toggles driver and reads the store; i18n typecheck/build ok.
  QA scenarios:
  - Happy: K5: switch driver to Classic in settings, diagnostics shows `driver: 'classic'`; switch back; with the K4 `sit` VMD imported, choose it in the sit-slot picker and read the `mmd` store `stanceSlots` entry equal to that motion name; screenshots desktop/mobile. Evidence `task-20-*.png`, `task-20-driver.json`, `task-20-slot.json`.
  - Failure: a stance slot pointing to a deleted motion shows the "none" state and the director keeps standing. Evidence `task-20-missing.json`.
  Commit: Y | feat(stage-ui): add MMD motion settings
  Recommended task executor category: visual-engineering - settings UI.

- [ ] 21. Add the MMD Motion Lab devtools page with overlays
  What to do / Must NOT do:
  - `packages/stage-ui/src/features/devtools/motion/mmd/devtools.vue` (+ `index.ts`) mirroring `features/devtools/motion/natural/devtools.vue`: rig report table, director/lookAt/feet/touch/timings panels from the `mmd-motion-diagnostics` store, overlay toggles sent over `@moeru/eventa` events (IK helper via `mmd.ikSolver.createHelper()`, collider wireframes, foot anchors, look-at target), a `debugAdvanceMs` control for the director.
  - Overlays rendered by MMD.vue into its scene only while enabled.
  - Tamagotchi page `apps/stage-tamagotchi/src/renderer/pages/devtools/mmd-motion.vue` with `<route lang="yaml"> meta: layout: settings </route>` registered like `live2d-natural-motion.vue` in the devtools index and settings layout icons.
  - English strings under the devtools i18n namespace.
  Closes: GAP-8, IS-13
  Parallelization: Wave 5 | Blocked by: 13, 16, 17, 18 | Blocks: 22, 23
  References: `packages/stage-ui/src/features/devtools/motion/natural/{devtools.vue,devtools.browser.test.ts,index.ts}`; `apps/stage-tamagotchi/src/renderer/pages/devtools/{live2d-natural-motion.vue,index.vue}`; `apps/stage-tamagotchi/src/renderer/layouts/settings.vue`; `.agents/skills/eventa/SKILL.md`; memory note on the Live2D touch-debug overlay pattern (`touchOverlaySetEvent`).
  Acceptance criteria: browser test renders the lab with a fixture diagnostics store; stage-tamagotchi typecheck 0.
  QA scenarios:
  - Happy: K6 Electron with Vivian: open `/#/devtools/mmd-motion`, enable IK and collider overlays; screenshot of the main stage shows overlay lines; lab shows timings. Evidence `task-21-lab.png`, `task-21-stage-overlay.png`.
  - Failure: disabling overlays removes overlay objects (scene child count back to baseline via CDP evaluate). Evidence `task-21-off.json`.
  - Live2D: with a Live2D model, the Live2D Natural lab still answers an affect-trace request (diagnostics store round trip). Evidence `task-21-live2d-trace.json`.
  Commit: Y | feat(stage-ui): add an MMD Motion Lab devtools page
  Recommended task executor category: visual-engineering - devtools UI and overlays.

- [ ] 22. Document the new packages, boundaries and architecture
  What to do / Must NOT do:
  - ADR `docs/ai/adr/2026-10-30-3d-character-motion.md`: context, decisions (Natural extraction, humanoid package, pipeline snapshot rule, morph runtime policy, touch without Ammo internals, stance slots, Natural default), consequences, follow-ups (M2-M5, Ammo impulse API upstream, texture/sphere/toon tint uniforms).
  - Update `packages/stage-ui-live2d/AGENTS.md` and `README.md` (Natural now lives in motion-driver-natural), `packages/stage-ui-mmd/AGENTS.md` and `README.md` (pipeline order, morph runtime, rig, natural, body, touch, diagnostics, checks), `packages/qa-tools/AGENTS.md`/`README.md` gate paths, `.agents/skills/motion-qa/SKILL.md:61` path, root `AGENTS.md` WHERE TO LOOK rows for the two packages; READMEs of both new packages complete.
  - ADR files referencing old paths stay historical (no rewrite).
  Closes: GAP-10
  Parallelization: Wave 5 | Blocked by: 5, 16, 17, 18, 19, 20, 21 | Blocks: F1-F4
  References: lane natural-blast-radius section 4; root `AGENTS.md` (docs rules, agent config separate commit); `docs/ai/adr/2026-10-26-natural-screen-aware-attention.md` (format).
  Acceptance criteria: `rg -n "stage-ui-live2d/src/composables/live2d/natural-motion/(blink|gaze|posture|impulses)" packages/*/AGENTS.md packages/*/README.md .agents/skills` prints nothing; `pnpm -F @proj-airi/qa-tools exec tsx scripts/check-doc-paths.ts` exits 0; markdown lint via `pnpm lint` on changed files passes.
  QA scenarios:
  - Happy: link check script (`node` over changed markdown resolving relative links) prints 0 broken. Evidence `task-22-links.txt`.
  - Failure: the same script flags a deliberately broken scratch link in a temp copy. Evidence `task-22-links-mutation.txt`.
  Commit: Y | docs: record the 3D character motion architecture (agent guidance updates in a separate `docs(agents)` commit per AGENTS.md)
  Recommended task executor category: writing - docs and ADR.

- [ ] 23. Run cross-model real-surface QA and the frame budget check
  What to do / Must NOT do:
  - Electron (K6) with standard Chisa: for each driver (Natural, then Classic) post `startMeasurement`, run 60 s (measured by the snapshot's `measurement.durationMs` reaching 60000 while running), post `stopMeasurement`, read `measurement`; acceptance uses `measurement.stages[*].p95Ms` over the full interval for every AIRI stage (all except physics.update and render) and `measurement.fps` Natural / Classic; compare Classic with the todo 4 baseline (`task-4-chisa-baseline.json`).
  - Electron with Ellen, Vivian, long-skirt Elysia: 60 s each with cursor sweeps, one poke, a sit stance (K4 VMD): record `feet.maxError`, look-at turns, touch events, framing check, console errors.
  - stage-web (K5) smoke with Ellen to confirm web parity.
  - If p95 > 4 ms or FPS ratio < 0.95: profile with the lab timings, fix inside the offending stage in this todo (no scope growth), rerun.
  - Must NOT commit QA assets.
  Closes: IS-12 proof, IS-5/7/8/9/11 live proof
  Parallelization: Wave 5 | Blocked by: 15, 20, 21 | Blocks: F1-F4
  References: QA kit K3-K6; `.agents/skills/{use-vishot,agent-browser-electron,motion-qa}/SKILL.md`; `apps/stage-web/README.md:5-17`.
  Acceptance criteria: evidence JSON shows p95 <= 4 ms per AIRI stage, FPS ratio >= 0.95, feet.maxError < 0.05 on all four models, zero uncaught console errors.
  QA scenarios:
  - Happy: `task-23-chisa-perf.json`, `task-23-<model>.json`, screenshots `task-23-<model>.png`.
  - Failure: with Natural forced to an artificial 10 ms busy loop in a scratch build (not committed), the budget check reports FAIL, proving the gate is live; revert. Evidence `task-23-gate-mutation.json`.
  - Cleanup: Vishot `cleanup()` receipts, vite PID killed, port free, `$RUN_TMP` QA zips/VMDs deleted. Evidence `task-23-cleanup.txt`.
  Commit: N (fixes found here commit with the stage they touch: `fix(stage-ui-mmd): ...`)
  Recommended task executor category: unspecified-high - multi-surface QA with targeted fixes.

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
  Every todo's acceptance criteria and evidence files exist; Must NOT have list verified by `git diff --stat main...HEAD` and `rg` checks (no assets, no Ammo internals, no shims, no other locales); branch guard verified: `git branch --contains <each plan commit>` lists `luke/feat/mmd-natural-full-body` and `git log --oneline origin/main..main` shows no plan commit (nothing landed on `main`).
  Recommended task executor category: unspecified-high
- [ ] F2. Code quality review
  `pnpm verify` green; review against `.agents/skills/enforce-rules-for-typescript`, `enforce-rules-for-vitest`, `enforce-rules-for-unocss`; no `any`, no suppressed errors; import guard on motion-driver-* holds.
  Recommended task executor category: unspecified-high
- [ ] F3. Real manual QA
  Fresh Electron run (K6) on Ellen and standard Chisa: idle 2 min, cursor sweeps, poke/pet, ACT emotion + expression, sit slot, Classic toggle; screenshots and diagnostics; Live2D model smoke (Natural lab loads, expression panel works).
  Recommended task executor category: unspecified-high
- [ ] F4. Ideal-state fidelity
  Check IS-1..IS-16 one by one against evidence; any shortfall becomes a new numbered todo.
  Recommended task executor category: unspecified-high

## Commit strategy
- Branch guard (binding for every todo, every wave and every worker): execution runs from the worktree `C:/Users/Luke/projects/dtuber-wt/mmd-natural-full-body`, whose branch `luke/feat/mmd-natural-full-body` is the integration base. Before the first edit of each todo and before every commit or merge, run `git branch --show-current` in the integration worktree; it must print `luke/feat/mmd-natural-full-body` (a wave worktree branched from it may print its own wave branch, and lands only into `luke/feat/mmd-natural-full-body`). Any other output, especially `main`, means STOP: make no edit, commit, merge or push, and report the mismatch. Never merge, push or fast-forward anything into `main` during this plan.
- Branch `luke/feat/mmd-natural-full-body` from `main`; one commit per todo with the listed Conventional Commit subject; each commit passes `pnpm verify` on its own (rebase-only merges).
- Agent guidance edits (`AGENTS.md`, `.agents/skills/*`) go in a separate `docs(agents): ...` commit inside todo 22.
- Plan footer on the final commit: `Plan: .omo/plans/mmd-natural-full-body.md`.
- Open a PR against `lschneiderny/airi` after F1-F4 approve; never push to upstream.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 1, 5 | K2 trace hash EQUAL 15/15 after 1 and 5 | task-1-trace-diff.txt, task-5-trace-diff.txt |
| IS-2 | 12, 16 | Natural attention follows cursor on Ellen; ACT emotion reaches MMD; speech level reaches MMD and the conductor | task-12-web.json, task-16-electron.json |
| IS-3 | 3, 14, 16 | morph runtime Node + browser suites; effect entry changes material on Chisa | task-3-node.txt, task-16-catalog.json |
| IS-4 | 11, 14, 16, 19 | ACT expression reaches MMD slots; panel persists curation; Electron settings-window curation updates the running MMD model | task-16-electron.json, task-19-persist.json, task-19-electron.json |
| IS-5 | 7, 13, 23 | feet.maxError < 0.05 on four models | task-13-<model>.json, task-23-<model>.json |
| IS-6 | 8, 13 | weight-shift suite; live screenshots t=0/30/60 | task-8-node.txt, task-13-<model>-<t>.png |
| IS-7 | 6, 13 | lookAt.turns >= 1 after far-left cursor; eye ray test | task-13-<model>.json, task-6-node.txt |
| IS-8 | 17 | poke at head screen point changes head pitch > 2 deg; hover pets | task-17-poke.json, task-17-pet.json |
| IS-9 | 9, 18 | sit slot + 120 s idle -> stance sit; no slot -> stand | task-18-sit.json, task-18-no-slot.json |
| IS-10 | 4, 12, 16, 20, 23 | Classic driver path, existing tests, F3 regression run | task-12-classic.json, task-23-<model>.json |
| IS-11 | 15 | head/feet bands on Elysia and Ellen | task-15-check.json |
| IS-12 | 4, 23 | Chisa p95 <= 4 ms and FPS ratio >= 0.95 | task-23-chisa-perf.json |
| IS-13 | 4, 21 | lab + overlays screenshots; diagnostics store reads | task-21-lab.png, task-21-stage-overlay.png |
| IS-14 | 2, 5 | eslint guard failure scenario; Node suites | task-2-guard.txt, task-5-trace-diff.txt |
| IS-15 | 12, 17, 18, 20 | driver switch via settings; missing slot state | task-20-driver.json, task-20-missing.json |
| IS-16 | 2, 5, 22 | link check 0 broken; READMEs present | task-22-links.txt |
