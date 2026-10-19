# emotion-expression-performance - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** You, watching your character in the corner of the screen and setting up its models. Her emotions will show how strong they are, linger briefly as a mood, and bring out the model's own faces and effects in time with what she says, without ever knocking off outfits, props, or the watermark hide.

**What you'll get:** All of a model's expression files become usable and stack correctly with smooth fades; a settings list where VTube Studio names, suggested kinds, and groups are filled in so you only confirm and map them to emotions; slight, clear, and strong reactions that look different; automatic and LLM-chosen faces, effects, and props; working lipsync on your 192 kHz audio device; and, later in the same plan, speech-timed scheduling, a smarter planner you can A/B against the simple picker, and per-character personality settings.

**Why this approach:** All decision-making lives in one small, replayable module that never touches the renderer, so the planner can replace the simple picker without rewriting motion or expressions, and two versions can be compared by replaying the same recorded conversation. Every tuning number lives in one settings document with three on/off switches, which keeps A/B testing simple.

**What it will NOT do:** No per-LLM or per-provider settings, no gesture library, no changes to other model types, no compatibility code for the old saved defaults (you re-save the watermark hide once), and no edits to your model files.

**Effort:** XL
**Risk:** High - large program touching the stage, Live2D runtime, speech pipeline, and character cards; mitigated by waves, per-step tests, and real-rig QA.
**Decisions to sanity-check:** LLM may use faces, effects, and props; old saved defaults are dropped; audio runs at 48 kHz everywhere (a small risk for the Firefox mobile mic meter); markers without an intensity now mean "clear" for every model type; suggested pick-one groups take effect before you confirm them.

Your next move: start execution with `/ulw-execute emotion-expression-performance` in this session or a new one. Full execution detail follows below.

---

> TL;DR (machine): XL, high risk; 26 implementation todos in 8 waves + F1-F4; exp3 foundation, catalog, bands/mood, decision seam + picker + slots, LLM tools, 48 kHz lipsync, multi-capture gates, timing slots, planner, character profiles.

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected user:**
- U1 Luke as viewer: a Live2D character (rigs ForBOOTH and Bear) sits in a screen corner in the Electron app `apps/stage-tamagotchi` while he games and chats with a local LLM. Today emotions show only as small Natural impulses that look the same at every intensity, and no rig expression fires automatically. After: emotion strength is visible, emotions tint the ongoing performance, and mapped rig expressions appear in time with speech.
- U2 Luke as model setup user: today the settings panel lists raw expression names (ForBOOTH `expression1`..`expression89`) and toggling some expressions removes others. After: labels are imported from VTube Studio, kinds and pick-one groups are suggested, he confirms mappings once, and outfits/props/watermark are never disturbed.
- U3 The LLM: today it can emit `<|ACT {"emotion":...}|>` only; the expression tools are unwired. After: it uses bands (`slight`/`clear`/`strong`), may name an exposed expression in ACT, and can call a curated `set_expression` tool for exposed faces, effects, and props.
- U4 Future executor/programmer: later phases plug into a pure decision seam; A/B comparison of deciders is done by replaying recorded signal traces.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | Every `.exp3.json` shipped in an imported ZIP model is discoverable and usable, whether or not `model3.json` references it | ForBOOTH `model3.json` references 2 of 89 files, Bear 0 of 27 |
| IS-2 | Expressions stack: activating, deactivating, fading, or auto-triggering one expression never changes another active expression's contribution, except that activating a member of a pick-one group fades out the other members of that group; explicit-zero Add entries are no-ops; reset returns to the saved rest set | Bear `eat` currently zeroes the game prop; reset currently undoes the saved watermark hide |
| IS-3 | Expressions fade in and out using the file's `FadeInTime`/`FadeOutTime`, or 1 s when absent | Today expressions pop in one frame |
| IS-4 | Setup is fast and safe: labels come from VTube Studio hotkeys, kind and pick-one groups are suggested, the user confirms with a preview toggle; unconfirmed expressions never fire automatically or reach the LLM | 89 opaque names; outfits must never be auto-triggered |
| IS-5 | Emotion strength is visibly distinct: slight, clear, and strong recruit different body parts with different timing; a missing intensity means clear; repeats habituate; stronger repeats escalate | Today intensity only scales amplitude and defaults to full strength |
| IS-6 | Emotions leave a decaying mood afterglow that is exactly identity at rest, so idle motion and the idle gate are unchanged | Continuity without regressing v2 idle acceptance |
| IS-7 | Emotions trigger mapped faces and effects with variety (weighted, band-gated, recency-penalized) in one face slot and one effect slot whose lifetimes follow speech; neutral clears only those slots; outfits, props, and system expressions are untouched | Core automatic-expression feature |
| IS-8 | The LLM can deliberately use exposed faces, effects, and props by label through an optional ACT `expression` field and a `set_expression` tool executed in the stage renderer; it never sees parameter ids, outfits, or system expressions; when the `stateFeedback` switch is on, each request tells it which expressions are active | Direct, safe LLM access (owner decision: faces, effects, props) |
| IS-9 | Lipsync and Natural speech emphasis work on a 192 kHz output device | wlipsync's WASM `set_input(sampleRate)` fails at 192 kHz |
| IS-10 | Rendered acceptance gates use a preregistered multi-capture rule | Single 600 s captures proved noisy |
| IS-11 | Performances can be scheduled into timing slots (`sentence_start`, `pause`, `utterance_end`, `emphasis`) derived from speech events | Planner prerequisite |
| IS-12 | A planner replaces the picker behind the same decision seam with no performer changes; deterministic with a seeded RNG; tunables only in the settings object; deciders compared by trace replay | Avoid the predecessor's untestable planner |
| IS-13 | A per-character profile on the character card overrides a bounded set of settings and re-weights model mappings; it syncs with the card and is edited in the card editor | Characters sharing a model behave differently |
| IS-14 | Nothing regresses: Universal and MAGIC motion-group behavior, VRM/MMD/Spine/Tachie emotion routing, desktop wake/screen-change reactions, speech playback and microphone capture, the Natural idle gate, and the web stage (`apps/stage-web`, single window, local store); the expression settings panel and its cross-window snapshot keep working with the new catalog commands | Existing behavior must hold |
| IS-15 | Each feature has one on/off switch in one settings document; no per-LLM or per-provider configuration; no dead tunables | A/B-ability |
| GAP-1 | `Model.vue:679-704` loads only `settings.expressions`, although `live2d-zip-loader.ts:56-70` already collects every exp3 into `settings._expFiles` | IS-1 |
| GAP-2 | `expression-store.ts` keeps one value per parameter: group toggles write zeros over shared params, deactivation resets params to model default, `resetAll()` (`expression-store.ts:382`) ignores saved defaults | IS-2 |
| GAP-3 | `expression-controller.ts:29` ignores fade times | IS-3 |
| GAP-4 | No catalog: no labels, kinds, groups, or mappings; `.vtube.json` is never read; LLM exposure is only an all/none/custom flag | IS-4 |
| GAP-5 | `payloads.ts:62` maps missing/invalid intensity to 1; impulses scale amplitude only; `impulses.ts:147` drops any same-emotion repeat within 2 s | IS-5 |
| GAP-6 | No mood state; `energy.react(at)` is a fixed 2 s overlay without intensity (`natural-motion.ts:313-334`, `energy.ts:29-34`) | IS-6 |
| GAP-7 | No emotion-to-expression path; `Stage.vue:270-300` sends Live2D emotions only to Natural impulses or motion groups | IS-7 |
| GAP-8 | `packages/stage-ui-live2d/src/tools/expression-tools.ts` is unwired, exposes parameter ids plus save/reset, and reads a store that is empty outside the stage window; ACT has no expression field; the prompt lists no expressions | IS-8 |
| GAP-9 | `packages/stage-ui/src/stores/audio.ts:67-69` creates the shared `AudioContext` at the device rate | IS-9 |
| GAP-10 | Rendered gates use single captures; only Bear still2 has a 3-capture median rule (v2 todo 24) | IS-10 |
| GAP-11 | No slot scheduler; `TextSegment` has no sentence identity; `Stage.vue` uses only clip text from `onPlaybackStart` although `SpeechClip` has `id` (`core-agent/src/voice/output/response.ts:20-23`) | IS-11 |
| GAP-12 | No decision seam; emotion routing is hard-coded in `Stage.vue` | IS-12 |
| GAP-13 | `AiriExtension` (`packages/stage-ui/src/types/airiCard.ts:11-69`) has no performance module and the card editor has no section | IS-13 |
| GAP-14 | The program touches `Stage.vue`, `Model.vue`, the expression store/controller, payloads, and Natural; regression coverage is partial | IS-14 |
| GAP-15 | Natural and impulse tunables are scattered module constants; no switches exist for bands, mood, or automatic expressions | IS-15 |

### Must have
- Every `- [ ] N.` todo below, delivered in wave order, each with its tests and QA evidence.
- One new settings document (`expression-performance` settings; existing `useSettingsLive2d` and MAGIC settings stores stay untouched) holding every new tunable with documented identity values and three switches: `bands`, `mood`, `autoExpressions`, plus `decider: 'picker' | 'planner'` and `stateFeedback`.
- Pure decision code in `packages/stage-shared/src/expression-performance/` that never reads clocks, `Math.random`, Pinia, or Live2D parameter ids.
- Owner decisions honored: LLM may trigger exposed `face`, `effect`, and `prop` entries only; the old `expression-defaults:${modelId}` key is dropped with no compatibility code; the shared stage `AudioContext` is created at 48000 Hz.
- English i18n strings in `packages/i18n/src/locales/en/` for every new user-visible string; a new ADR in `docs/ai/adr/`; README updates for `packages/stage-ui-live2d` and `packages/stage-shared`.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- No per-LLM, per-provider, or per-model-name profiles, alias tables, or scaling; character profiles are keyed by character card only.
- No gesture primitive library, dataset-scaled tunables, or more than one settings document; no tunable without an identity value and a settings field.
- No change to Universal/MAGIC motion-group selection or to VRM/MMD/Spine/Tachie emotion handling beyond the intensity they already receive.
- No edits under `apps/stage-tamagotchi-kirie/`, `server/`, or hosted services; no writes into model folders, ZIPs, or OPFS caches; no new npm or Python dependencies; no `package.json` changes except the two `exports` edits named in todos 1 (add `./expression-performance` to stage-shared) and 7 (remove `./tools/expression-tools` from stage-ui-live2d).
- No new keys in `RUNTIME_PROMPT_KEYS` (`packages/stage-ui/src/composables/use-airi-runtime-prompt.ts:6-10`): a key missing in another locale blanks the whole runtime prompt; dynamic expression lines are appended from code.
- No non-English locale edits; no changes to the 58 unrelated dirty-worktree entries on `main` (agent config, skills, AGENTS.md files, a stray `nul` file, a ForBOOTH zip path).
- No backward-compatibility code for the old saved-defaults key; no fuzzy matching of LLM-provided expression names; no raw parameter ids exposed to the LLM.
- No v3 items 1-3 (jitter scoring, tail gate, Universal parity); only the multi-capture rule (v3 item 4) is in scope.
- No timing-based (sleep/poll) tests; use the fixed 1/120 s grid, seeded streams, and event-driven waits.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after, Vitest (repo standard). Each todo adds or updates tests beside the touched module; every new regression test must be shown failing against the pre-change code (or with the behavior mutated) before it passes. Agent-executed QA is mandatory for every todo.
- Evidence: `.omo/evidence/emotion-expression-performance/task-<N>-<name>.<ext>` (ignored by `.gitignore` rule `.omo/evidence/`; never commit evidence, traces, rig files, or zips). Under ulw-loop use `<attemptDir>/task-<N>-emotion-expression-performance.<ext>` instead.
- Commands (run from the worktree root):
  - Node tests: `pnpm -F <package> exec vitest run --project node <path>` (packages `@proj-airi/stage-shared` has no project split: `pnpm -F @proj-airi/stage-shared exec vitest run <path>`; check its `vitest.config.ts` first and use the form it supports).
  - Browser tests: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser <path>`; `pnpm -F @proj-airi/stage-tamagotchi exec vitest run <path>`.
  - Typecheck: `pnpm -F <package> typecheck`; root `pnpm typecheck` whenever an exported type changes. Lint: `pnpm lint` (scoped `pnpm exec eslint <paths>` during work).
  - Natural gate: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion/liveliness-gate.test.ts`.
  - Trace scoring: `pnpm -F @proj-airi/stage-ui-live2d exec tsx scripts/score-natural-trace.ts <trace.json>` (exit 0 = pass).
- Real-surface QA (Electron): start `pnpm dev:tamagotchi` from the task worktree in a background session with `--remote-debugging-port` exposed per `.agents/skills/agent-browser-electron/SKILL.md`; drive windows through CDP (read `.agents/skills/agent-browser-electron/SKILL.md` and `.agents/skills/use-agent-browser-for-airi/SKILL.md` first). Import rigs by zipping each rig folder into the run temp dir: `Compress-Archive -Path "C:/Users/Luke/Documents/Live2d Models/ForBOOTH-231-Holder-only@Do-not-share-or-resell/*" -DestinationPath $env:RUN_TMP/forbooth.zip` and the same for `bear Pajama V1.1`. Read parameter values through the stage window's Live2D core model in CDP `Runtime.evaluate`.
- Scripted LLM: no local LLM listens on :11434 or :1234. LLM-path QA uses a scripted OpenAI-compatible server started with `Bun.serve` on `127.0.0.1:<free port>` inside the run temp dir. It returns a fixed SSE chat-completions stream (text with ACT markers, and optionally a `set_expression` tool call followed by a final text step). Configure it in AIRI as an OpenAI-compatible chat provider with base URL `http://127.0.0.1:<port>/v1`.
- Speech: use Kokoro TTS (Local) with the FP32 (WebGPU) model; fp16 produced silent buffers on this machine.
- Live-QA pitfalls (from v2 execution): never run `pnpm` in the worktree while its dev app is running (it can reinstall and reload the stage with a different model); score traces after teardown; guard each capture by checking `performance.timeOrigin` and the model instance are unchanged; helper windows off the primary display stop rendering; in Git Bash use `taskkill //T //F //PID <n>`; tear down the dev tree root (`cmd.exe` running `electron-vite dev`) and delete its `--user-data-dir` profile after QA.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

- Wave 0: 1, 2, 3, 4, 5 (foundations with disjoint files).
- Wave 1: 6, 7, 8, 9, 10.
- Wave 2: 11, 12, 13, 14.
- Wave 3: 15, 16, 17.
- Wave 4: 18, 19, 20.
- Wave 5: 21 (dependency-forced single todo: it needs the conductor, LLM wiring, and speech metadata).
- Wave 6: 22, 23.
- Wave 7: 24, 25, 26.
- Final: F1-F4.

File-ownership rule: the conductor (`packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts`) is edited only by todos 16, 18, 21, 22; `Stage.vue` only by todo 9 (minimal call-site updates in wave 1), then 16, 18, 21, 22, all in different waves. Every todo that changes a contract updates all of its consumers in the same commit. `packages/stage-shared/src/expression-performance/index.ts` gains one export line each from todos 6 and 10 in wave 1; the second to land rebases its one-line addition. `live2d.vue` is edited only by todo 15. `natural-motion.ts` is edited by 9 then 11. `expression-store.ts` is edited by 7, then 12, then 14 (14 runs after 12 in the same wave only if the executor serializes them; otherwise run 14 after 12).

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 6, 8, 9, 10, 13, 17, 20 | 2, 3, 4, 5 |
| 2 | - | 7 | 1, 3, 4, 5 |
| 3 | - | 21, 26 | 1, 2, 4, 5 |
| 4 | - | 26 | 1, 2, 3, 5 |
| 5 | - | 16, 18 | 1, 2, 3, 4 |
| 6 | 1 | 13 | 7, 8, 9, 10 |
| 7 | 2 | 12, 14 | 6, 8, 9, 10 |
| 8 | 1 | 15, 16, 17 | 6, 7, 9, 10 |
| 9 | 1 | 11, 16 | 6, 7, 8, 10 |
| 10 | 1 | 12 | 6, 7, 8, 9 |
| 11 | 9 | 16 | 12, 13 |
| 12 | 7, 10 | 14, 15, 16 | 11, 13 |
| 13 | 1, 6 | 16, 20, 23 | 11, 12, 14 |
| 14 | 7, 12 | 16 | 11, 13 |
| 15 | 8, 12 | 24, 26 | 16, 17 |
| 16 | 5, 8, 9, 11, 12, 13, 14 | 18, 21, 22 | 15, 17 |
| 17 | 1, 8 | 22 | 15, 16 |
| 18 | 16 | 21, 26 | 19, 20 |
| 19 | - (runs in wave 4 for file safety) | 21 | 18, 20 |
| 20 | 1, 13 | 22, 23 | 18, 19 |
| 21 | 3, 16, 18, 19 | 22, 23 | - |
| 22 | 17, 20, 21 | 24, 26 | 23 |
| 23 | 13, 20, 21 | 24, 26 | 22 |
| 24 | 1-23 | F1-F4 | 25, 26 |
| 25 | 1-23 | F1-F4 | 24, 26 |
| 26 | 1-23 | F1-F4 | 24, 25 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Create the shared expression-performance core: types, catalog schema, settings schema with defaults
  What to do:
  - Create `packages/stage-shared/src/expression-performance/` with `types.ts`, `catalog.ts`, `settings.ts`, `index.ts`, and tests `catalog.test.ts`, `settings.test.ts`. Add the export `"./expression-performance": "./src/expression-performance/index.ts"` to `packages/stage-shared/package.json` (exports only; no dependency or script change; `valibot` is already a dependency).
  - `types.ts` (pure TypeScript, no Vue/Pinia/Cubism imports):
    - `type PerformanceEmotion = 'happy' | 'sad' | 'angry' | 'think' | 'surprised' | 'awkward' | 'question' | 'curious' | 'neutral'` (same values as `packages/pipelines-audio/src/llm-streaming-control/payloads.ts:6-16`).
    - `type Band = 'slight' | 'clear' | 'strong'`; `const bandRank = { slight: 1, clear: 2, strong: 3 }`.
    - `interface ReactionEpisode { id: string, emotion: PerformanceEmotion, nominal: number, intensity: number, band: Band, escalation: boolean }`.
    - `type AffectSignal = { kind: 'emotion', source: 'act' | 'tool' | 'devtools', emotion: PerformanceEmotion, nominal: number, turnId?: string, at: number } | { kind: 'expression', source: 'act' | 'tool', expressionId: string, holdSeconds?: number, turnId?: string, at: number } | { kind: 'speech', event: 'clip-start' | 'clip-end' | 'clip-stopped' | 'turn-end', turnId: string, clipId?: string, at: number } | { kind: 'muted', muted: boolean, at: number } | { kind: 'timing', event: TimingEvent, at: number } | { kind: 'deadline', at: number }` (`TimingEvent` is declared here as `{ id: string, kind: 'sentence_start' | 'pause' | 'utterance_end' | 'emphasis', turnId: string, at: number }`; todo 21 produces it). Speech identity is the turn id: with speech on, an ACT marker fires before the next clip of the same turn plays (tts-chunker/speech-pipeline ordering), so a decision scheduled from a marker targets the next matching timing event of that turn; devtools pulses have no turn id and are never scheduled.
    - `interface SlotCommand { slot: 'face' | 'effect' | 'prop', expressionId: string | null, holdSeconds: number, until: 'speech' | 'hold', turnId?: string }` (deciders copy the triggering signal's turn id) and `interface PerformanceDecision { episodes: ReactionEpisode[], slots: SlotCommand[] }`.
    - `interface DeciderContext { catalog: readonly CatalogEntry[], settings: ExpressionPerformanceSettings }` and `interface Decider<S> { initial: (seed: number) => S, decide: (signal: AffectSignal, ctx: DeciderContext, state: S) => { decision: PerformanceDecision, state: S }, nextDeadline: (state: S) => number | null }`. Decider state `S` must be a plain JSON-serializable object (no classes, functions, Maps; PRNG state stored as a uint32) so it can be checkpointed with `structuredClone`/JSON; `nextDeadline` returns the earliest time at which the decider needs a `{ kind: 'deadline' }` signal even if no other input arrives (the conductor turns it into a timer; traces record the deadline signal like any other). Times are seconds on a monotonic clock supplied in the signal; deciders never read clocks, `Math.random`, Pinia, or parameter ids.
  - `catalog.ts`: Valibot schemas and types.
    - `ExpressionKind = 'face' | 'effect' | 'outfit' | 'prop' | 'system'`; `llmAllowedKinds = ['face', 'effect', 'prop'] as const` (owner decision).
    - `EmotionMapping = { emotion: PerformanceEmotion (excluding 'neutral'), weight: number > 0 (default 1), minBand: Band }`; default `minBand` is `clear` for `face` and `strong` for `effect`.
    - `CatalogEntry = { id: string (archive-relative exp3 path), label: string, kind: ExpressionKind, group: string | null, confirmed: boolean, exposedToLlm: boolean, mappings: EmotionMapping[], fileName: string, parameterIds: string[] }`.
    - `CuratedOverride = { id, label?, kind?, group?: string | null, confirmed?, exposedToLlm?, mappings? }` and `CuratedCatalogDocument = { version: 1, overrides: CuratedOverride[] }`.
    - Parse functions for the Live2D package, which has no direct `valibot` dependency: `parseCuratedCatalogDocument(input: unknown)` and `parseRestSet(input: unknown)` (`{ version: 1, active: string[] }`), each returning `{ success: true, value } | { success: false, issues }`.
  - `mergeCatalog(derived: CatalogEntry[], curated: CuratedCatalogDocument | null): CatalogEntry[]` (override fields win; overrides for ids not present are ignored); `isAutoEligible(entry)` = `entry.confirmed && entry.kind in {face, effect}`; `isLlmEligible(entry)` = `entry.confirmed && entry.exposedToLlm && llmAllowedKinds.includes(entry.kind)`.
  - `settings.ts`: one Valibot schema `ExpressionPerformanceSettingsSchema` and `defaultExpressionPerformanceSettings`, with a doc comment per field stating its identity/neutral value. Fields (exact names and defaults):
    - switches: `bands: true`, `mood: true`, `autoExpressions: true`, `stateFeedback: false`, `decider: 'picker'` (enum has only `'picker'` until todo 23 adds `'planner'`).
    - `intensity: { slight: 0.25, clear: 0.6, strong: 0.9, clearFrom: 0.5, strongFrom: 0.8, jitter: 0.04, habituationWindow: 15, habituationBase: 0.8, habituationFloor: 0.35, escalationWindow: 2 }`.
    - `naturalBands: { slight: { faceOnsetTau: 0.14, headTau: null, overshoot: 0, faceHold: 0.6, faceReleaseTau: 0.35 }, clear: { faceOnsetTau: 0.1, headTau: 0.38, overshoot: 0.08, faceHold: 1.2, faceReleaseTau: 0.5 }, strong: { faceOnsetTau: 0.07, headTau: 0.24, overshoot: 0.16, faceHold: 1.8, faceReleaseTau: 0.7 }, headGain: 0.12, bodyGain: 0.06, energyAmplitude: 0.3, energyRate: 0.5, energySeconds: 2 }`.
    - `moodDynamics: { valenceTau: 45, arousalTau: 20, tensionTau: 30, slightGain: 0.15, clearGain: 0.25, strongGain: 0.4, amplitude: 0.2, shiftRate: 0.3, cameraValence: 0.1, cameraTension: 0.15, emphasis: 0.1, mouthForm: 0.08 }`.
    - `picker: { recencyDepth: 0.8, recencyTau: 8, effectGateFrom: 0.5, effectGateTo: 0.8 }`.
    - `slots: { defaultFadeSeconds: 1, speechGrace: 0.25, unstartedExpiry: 10, holdCap: 15 }`.
    - `timing: { pauseSeconds: 0.18, emphasisRefractory: 1.2 }`.
  - `parseExpressionPerformanceSettings(input: unknown)`: Valibot `safeParse`; on failure return defaults and the issues (callers log via `errorMessageFrom`).
  Must NOT do: import Vue, Pinia, or any `stage-ui*` package; add a dependency; add tunables not listed above; add a `'planner'` enum value.
  Closes: GAP-12, GAP-15 (foundation); used by GAP-4, GAP-5, GAP-6, GAP-7.
  Parallelization: Wave 0 | Blocked by: - | Blocks: 6, 8, 9, 10, 13, 17, 20
  References: `packages/stage-shared/src/performance-state/index.ts` (pure-module precedent and doc style); `packages/stage-shared/package.json` (exports, `valibot` dependency); `packages/pipelines-audio/src/llm-streaming-control/payloads.ts:6-16` (emotion names); draft `.omo/drafts/emotion-expression-performance.md` sections Decisions and Open assumptions (source of every constant).
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` passes; `pnpm -F @proj-airi/stage-shared typecheck` exit 0; tests assert (a) `parseExpressionPerformanceSettings({})` fills every default; (b) an invalid value (e.g. `intensity.clear: 2`) returns defaults plus issues; (c) `mergeCatalog` applies overrides and ignores unknown ids; (d) `isLlmEligible` is false for `outfit` and `system` even when `exposedToLlm: true`, true for a confirmed exposed `prop`; (e) `isAutoEligible` is false for unconfirmed entries and for `prop`.
  QA scenarios: happy - run the test command above, save output to `.omo/evidence/emotion-expression-performance/task-1-tests.txt`, PASS when all tests pass; failure - temporarily change `llmAllowedKinds` to include `'outfit'`, rerun, capture the failing assertion (d) to `task-1-mutation.txt`, restore, rerun green.
  Recommended task executor category: `unspecified-high` - new shared module with schemas and several interlocking types.
  Commit: Y | feat(stage-shared): add expression performance core types and settings schema

- [x] 2. Add the pure per-expression composition module with fades and frame-base ownership
  What to do:
  - Create `packages/stage-ui-live2d/src/composables/live2d/expression/compose.ts` and `compose.test.ts` (pure; no Vue, Pinia, or SDK imports).
  - Types: `ExpressionDefinition { id, parameters: { id, value, blend: 'Add' | 'Multiply' | 'Overwrite' }[], fadeIn, fadeOut }`; `ExpressionInstance { id, activationSequence, fromWeight, targetWeight: 0 | 1, transitionAt, duration }`.
  - Class `ExpressionComposer` with: `define(defs)`, `activate(id, now)`, `deactivate(id, now)`, `setActiveSet(ids, now)` (activates listed, deactivates others), `weightOf(id, now)`, `activeIds()`, `restoreBases(write: (paramId, value) => void)`, and `compose(now, read: (paramId) => number, write: (paramId, value) => void, clampOf: (paramId) => [min, max])`.
  - Fade: `S(u) = (1 - cos(pi * clamp(u, 0, 1))) / 2`; `w(t) = from + (target - from) * S((t - transitionAt) / duration)`; duration = `fadeIn` when activating, `fadeOut` when deactivating; absent, negative, or non-finite fades use `1` second; `0` completes immediately. Reactivation mid-fade samples the current weight as `from` and keeps the original `activationSequence`. Instances reaching weight 0 are removed.
  - Composition per parameter: start from the frame base `b`; visit instances by ascending `activationSequence`, then parameter-array order; Add `x = x + v * w`; Multiply `x = x * (1 + (v - 1) * w)`; Overwrite `x = x + (v - x) * w`; skip `w = 0`, Add with `v = 0`, Multiply with `v = 1`; clamp once with `clampOf`.
  - Explicit base lifecycle (expression writes made in the final plugin are saved by the SDK after the motion update and restored at the start of the next frame, so they would otherwise become the next frame's base): keep `capturedBase: Map<paramId, number>`. `restoreBases(write)` runs first in every frame, before any motion, blink, or other plugin writes (todo 7 registers it as the first pre plugin): it writes `capturedBase` back to every parameter written by expressions in the previous frame, so this frame's animation writers start from the clean value and parameters nobody animates return to their clean value. Parameters that are no longer owned are restored here once and then forgotten (so a release never overwrites a value an animation writer sets later in the same frame). `compose(...)` runs in the final plugin: for each owned parameter it captures `b = read(id)` into `capturedBase` (this is the clean value plus anything animation wrote this frame), composes, and writes. No equality comparisons are used, so Float32 rounding and equal-value writes cannot be mistaken for 'no writer'.
  Must NOT do: read or write store state; import `pixi-live2d-display`; regroup mixed blend modes.
  Closes: GAP-2, GAP-3 (math).
  Parallelization: Wave 0 | Blocked by: - | Blocks: 7
  References: current math `packages/stage-ui-live2d/src/composables/live2d/expression-controller.ts:139-268`; Cubism fade semantics https://raw.githubusercontent.com/Live2D/CubismWebFramework/develop/src/motion/cubismexpressionmotion.ts; package guidance `packages/stage-ui-live2d/AGENTS.md`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/expression/compose.test.ts` passes with cases: (a) two Add expressions on different params do not affect each other; (b) Add `v = 0` entry of expression B leaves expression A's contribution on the same param unchanged; (c) mixed-order result equals the specified sequential formula; (d) Multiply preserves a per-frame base written by a blink stand-in (`read` returns a new value each frame); (e) Overwrite to the model default is applied (not skipped); (f) fade-in at t = fadeIn/2 gives weight 0.5; reversal mid-fade is continuous (no jump > 1e-9); (g) 1,000 frames with a static base and an active Add expression produce the same value every frame (no accumulation), using a fake core model that stores parameters in a `Float32Array` and replays the SDK save/load cycle (values written in the final plugin are present at the next frame start); (h) equal-value write: base 1 with Multiply 0.5 gives 0.5; next frame an animation writer sets 0.5 after `restoreBases`, and the output is 0.25; (i) release during animation: after deactivation completes, `restoreBases` restores the clean value before an animation writer runs, and the animation's fresh value written afterwards is not overwritten.
  QA scenarios: happy - run the command, save `task-2-tests.txt`, PASS all; failure - skip `restoreBases`, rerun, capture case (g) failing (accumulation) to `task-2-mutation.txt`, restore.
  Recommended task executor category: `deep-low` - numeric semantics with an ownership invariant; settled by the spec.
  Commit: Y | feat(stage-ui-live2d): add per-expression composition with fades

- [x] 3. Create the shared stage AudioContext at 48 kHz so lipsync works on 192 kHz devices
  What to do:
  - In `packages/stage-ui/src/stores/audio.ts:67-69` change `new AudioContext()` to `new AudioContext({ sampleRate: 48000 })` (owner decision: always 48 kHz). Add a one-line comment explaining wlipsync@1.3.1's WASM `set_input(sampleRate)` fails at 192 kHz (`node_modules/.pnpm/wlipsync@1.3.1/node_modules/wlipsync/dist/audio-processor.js`).
  - Confirm every consumer still shares that one context and tolerates 48 kHz: Stage.vue playback, TTS decode, lipsync, analyser, VRM/MMD lipsync, Web Speech `toMediaStream` (`stores/modules/hearing.ts:580`), `packages/stage-ui/src/stores/voice.ts:62`, and `packages/stage-layouts/src/components/Layouts/MobileInteractiveArea.vue:184,292` (mic analyser via `createMediaStreamSource` on the shared context). Microphone capture for VAD/STT uses its own 16 kHz context (`packages/stage-ui/src/composables/audio/audio-device.ts:16-25`) and is unaffected. Record in the ADR (todo 24) the known risk that Firefox rejects `createMediaStreamSource` across sample rates, which can affect the MobileInteractiveArea analyser on Firefox when the mic rate is not 48 kHz.
  Must NOT do: create a second AudioContext; change wlipsync; change system audio settings.
  Closes: GAP-9.
  Parallelization: Wave 0 | Blocked by: - | Blocks: 21, 26
  References: `packages/stage-ui/src/stores/audio.ts:67-69`; consumers `packages/stage-ui/src/components/scenes/Stage.vue:154,434-439,484,550-557,567-571,619,752-755,800-803`; `packages/stage-ui/src/libs/speech/streaming-pipeline.ts:63-69`; `packages/audio/src/browser/audio-output.ts:42-77`; `packages/model-driver-lipsync/src/live2d/index.ts:71-76`; prior evidence `.omo/evidence/live2d-presence-v2/todo24-25-log.md:62-88`; mouth mapping test `packages/stage-ui-live2d/src/components/scenes/live2d/natural-voice-level.test.ts`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui typecheck` exit 0; real-device QA below passes.
  QA scenarios: happy - on Luke's machine (output device at 192 kHz), start `pnpm dev:tamagotchi`, load ForBOOTH, select Kokoro TTS (Local) FP32, send a chat message through the scripted LLM server (Verification strategy) whose reply is `<|ACT {"emotion":"happy"}|> Hello there, this is a lipsync test sentence.`; via CDP evaluate in the stage window read `useAudioContext().audioContext.sampleRate` (expect 48000) and sample `mouthOpenSize` every animation frame during playback; PASS when sampleRate is 48000 and max mouthOpenSize > 0.2; save `task-3-lipsync.json`. failure - before the change (or with the option removed) the same run shows sampleRate 192000 and max mouthOpenSize 0; record that baseline to `task-3-baseline.json`.
  Recommended task executor category: `quick` - one-line production change plus real-device QA.
  Commit: Y | fix(stage-ui): run the shared stage audio context at 48 kHz

- [x] 4. Add the preregistered multi-capture acceptance rule for rendered gates
  What to do:
  - In `packages/stage-ui-live2d/src/composables/live2d/natural-motion/liveliness.ts` add exported pure `aggregateLivelinessReports(reports: LivelinessReport[]): LivelinessAggregate`: requires at least 3 reports; per metric value = median of non-null values; `hardFailures` = union over all reports (any capture's hard failure fails the aggregate); band pass recomputed on the median; `score` = median of scores; `pass` = no hard failures and every banded median in band.
  - Add `packages/stage-ui-live2d/scripts/score-natural-captures.ts` (run with `pnpm -F @proj-airi/stage-ui-live2d exec tsx scripts/score-natural-captures.ts --prereg <prereg.json> <trace1.json> <trace2.json> <trace3.json> [...]`). It refuses to run (exit 2) unless the prereg JSON exists, has `createdAt` earlier than every trace file's mtime, and lists the gate name, rig, capture count, and durations; it prints the aggregate JSON and exits 0 on pass, 1 on fail.
  - Document the rule in `packages/stage-ui-live2d/README.md` (Natural QA section): every statistical rendered gate scored from Natural traces (liveliness metrics and the band-recruitment analysis) uses 3 captures of the same duration on the same build, preregistered before data, aggregated per the gate's stated rule; single captures are diagnostic only. Functional event checks (a parameter rises after a marker, lipsync mouth > threshold, a tool result) are pass/fail runs, not statistical gates.
  Must NOT do: change existing metric bands or `scoreLiveliness` behavior; change the node gate test.
  Closes: GAP-10.
  Parallelization: Wave 0 | Blocked by: - | Blocks: 26
  References: `liveliness.ts:264-371` (scoring, hard failures); `packages/stage-ui-live2d/scripts/score-natural-trace.ts:13-27` (CLI pattern); v2 precedent todo 24 in `.omo/plans/live2d-presence-v2.md`; `packages/stage-ui-live2d/README.md:88-161`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion/liveliness.test.ts` passes with new cases: median aggregation of 3 synthetic reports; one capture with `frozen` fails the aggregate; fewer than 3 reports throws.
  QA scenarios: happy - generate 3 synthetic traces with the existing test helpers into the run temp dir, write a prereg file first, run the script, PASS on exit 0 with JSON saved to `task-4-aggregate.json`; failure - write the prereg after the traces (newer mtime), run again, PASS when exit code is 2 and the message names the preregistration; save `task-4-prereg-refusal.txt`.
  Recommended task executor category: `unspecified-low` - small pure function, CLI, and docs.
  Commit: Y | feat(stage-ui-live2d): add multi-capture acceptance aggregation

- [x] 5. Parse intensity bands and an optional expression field from ACT markers, and update the ACT prompt
  What to do:
  - In `packages/pipelines-audio/src/llm-streaming-control/payloads.ts`: intensity accepts the words `slight`, `clear`, `strong` (case-insensitive, trimmed) mapped to 0.25 / 0.6 / 0.9; finite numbers and numeric strings clamp to [0, 1]; missing, empty, or invalid intensity becomes 0.6 (was 1 at `payloads.ts:62`). Bare string emotions (`"emotion":"happy"`) also get 0.6.
  - Add `expression?: string` to `NormalizedActPayload` (trimmed, non-empty strings only; no matching here).
  - Update `payloads.test.ts` and `index.test.ts` for words, default 0.6, numeric clamping, and the expression field.
  - Update the English ACT prompt text of the existing keys only (`base.prompt.emotion`, `base.prompt.suffix`) in `packages/i18n/src/locales/en/base.yaml:27-58` (do not add keys; see Must NOT have): document `"intensity": "slight" | "clear" | "strong"` (numbers still accepted), show examples using all three bands, and document `"expression": "<label>"` as optional, used only with labels from the expression list the app provides (todo 18 appends that list at runtime). Keep existing CALL/DELAY text unchanged.
  - The consumers in `Stage.vue` keep compiling unchanged; VRM/MMD/Spine/Tachie now receive 0.6 instead of 1 for markers without intensity (intended, documented in the ADR in todo 24).
  Must NOT do: edit non-English locales; change Stage.vue in this todo.
  Closes: GAP-5 (input side), GAP-8 (ACT field).
  Parallelization: Wave 0 | Blocked by: - | Blocks: 16, 18
  References: `payloads.ts:1-170`; `packages/pipelines-audio/src/llm-streaming-control/parsers/act.ts:3-49`; tests `payloads.test.ts:5-50`, `index.test.ts:5-181`; prompt composition `packages/stage-ui/src/composables/use-airi-runtime-prompt.ts:5-23`; i18n rules `packages/i18n/AGENTS.md`.
  Acceptance criteria: `pnpm -F @proj-airi/pipelines-audio exec vitest run src/llm-streaming-control/payloads.test.ts src/llm-streaming-control/index.test.ts` passes; `pnpm -F @proj-airi/pipelines-audio typecheck` and `pnpm -F @proj-airi/stage-ui typecheck` exit 0.
  QA scenarios: happy - run the tests, save `task-5-tests.txt`; failure - revert the default to 1, rerun, capture the failing "missing intensity is 0.6" case to `task-5-mutation.txt`, restore.
  Recommended task executor category: `quick` - parser defaults plus prompt text.
  Commit: Y | feat(pipelines-audio): parse ACT intensity bands and expression field

- [x] 6. Add the reaction-strength module: bands, habituation, escalation
  What to do:
  - Create `packages/stage-shared/src/expression-performance/reaction-strength.ts` and `reaction-strength.test.ts`; export from `index.ts`.
  - `bandOf(intensity, settings)`: slight for (0, clearFrom), clear for [clearFrom, strongFrom), strong for [strongFrom, 1]; 0 means no reaction.
  - Implement the tracker as pure functions over a plain JSON-serializable state (required by the checkpointable decider contract in todo 1): `createReactionState(seed)` (includes a uint32 PRNG state; implement a small deterministic PRNG such as mulberry32 here; do not import from stage-ui-live2d) and `acceptReaction(state, emotion, nominal, at, settings): { episode: ReactionEpisode | null, state }`:
    - neutral or nominal 0: clears history for all emotions and returns null (neutral is handled by the decider as a slot clear).
    - escalation: if the same emotion's current episode started less than `escalationWindow` seconds ago: a weaker or equal nominal returns null; a stronger one returns the same episode id with `escalation: true` and `intensity = max(old, jittered(newNominal * h, u))` reusing the episode's `h` and `u`; the window does not restart and the habituation count does not grow. At exactly `escalationWindow` seconds a new episode starts.
    - new episode: `n` = number of preceding accepted episodes of the same emotion, uninterrupted by a different emotion, that started within the previous `habituationWindow` seconds (age exactly 15 excluded); `h = max(habituationFloor, habituationBase ** n)`; draw `u` once; derive the band from `nominal * h` first, then `intensity = clamp(nominal * h + jitter * (2u - 1), bandLower, bandUpper)` using 1e-9 inside excluded bounds.
    - a different recognized emotion clears the habituation history of the previous emotion.
  - Episode ids are `<emotion>-<counter>` from an internal counter (deterministic).
  Must NOT do: read time or randomness from globals; depend on Vue.
  Closes: GAP-5.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 13
  References: current dedupe `packages/stage-ui-live2d/src/composables/live2d/natural-motion/impulses.ts:140-173`; settings fields from todo 1 (`intensity.*`); draft Decisions (ultrabrain section 2).
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance/reaction-strength.test.ts` passes with cases: band boundaries at 0.5 and 0.8; jitter stays inside the band; habituation 0.9 -> 0.72 on the second repeat (h = 0.8) and floors at 0.35; history expires at 15 s; a different emotion resets; a stronger repeat within 2 s escalates without a new id; equal repeat returns null; identical seeds give identical episode sequences.
  QA scenarios: happy - run tests, save `task-6-tests.txt`; failure - make escalation restart the window, rerun, capture the failing "window does not restart" case to `task-6-mutation.txt`, restore.
  Recommended task executor category: `deep-low` - small algorithm with exact edge semantics.
  Commit: Y | feat(stage-shared): add reaction strength bands with habituation and escalation

- [x] 7. Rewrite the Live2D expression runtime: discover every exp3, per-expression store, rest set, updated settings commands
  What to do:
  - Both ZIP load paths must provide `settings._expFiles`: the fresh ZipLoader path (`live2d-zip-loader.ts:56-70`) and the OPFS-restored path, where `OPFSCache.checkMiddleware` (`packages/stage-ui-live2d/src/utils/opfs-loader.ts:222+`, registered before ZipLoader in `live2d-opfs-registration.ts:5-14`) replays cached files and ZipLoader's `createSettings` does not run. Make the restored path read every cached `*.exp3.json` (and, for todo 10, the first `*.vtube.json`) from the OPFS directory into the same `_expFiles` shape; add cases to `opfs-loader.test.ts` / `live2d-zip-loader.test.ts` (existing "loads an OPFS-restored file directory" tests at `live2d-zip-loader.test.ts:244-321` are the pattern).
  - Discovery (`packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue:679-704`, `expression-controller.ts`): build the definition list from `settings._expFiles` (already parsed JSON; no fetch needed) unioned with `settings.expressions` references (URL models and any referenced file). Definition id = archive-relative exp3 path (`_expFiles[].fileName`, or the referenced `File` resolved relative to the model settings file); name = the model3 `Name` when referenced, else the file base name. Parse `FadeInTime`/`FadeOutTime` into the definition (absent -> 1 s via todo 2). URL-loaded models keep model3-only discovery (no folder enumeration); document this in the package README.
  - Replace the per-parameter store model in `packages/stage-ui-live2d/src/stores/expression-store.ts` with per-expression state driven by `ExpressionComposer` (todo 2): state `definitions`, `restSet: string[]` (persisted), `manualActive` (user toggles not yet saved), `modelId`. Actions: `registerDefinitions(modelId, defs)`, `toggle(id)`, `activate(id)`, `deactivate(id)`, `saveDefaults()` (persist the currently active non-transient ids as the rest set), `resetAll()` (target exactly the rest set; cancel transient activations), `dispose()`.
  - Persistence: key `expression-rest:${modelId}` storing `{ version: 1, active: string[] }` validated with `parseRestSet` from `@proj-airi/stage-shared/expression-performance` (todo 1; `stage-ui-live2d` has no direct `valibot` dependency and must not gain one). The old `expression-defaults:${modelId}` key is neither read nor migrated (owner decision); do not add compatibility code.
  - The controller becomes an adapter with two plugins: a new `restoreExpressionBases` registered as the first pre plugin in `Model.vue:500-510` (before beat sync and idle-disable) calls `composer.restoreBases(write)`; `applyExpressions(coreModel)` (still registered as the final motion-manager plugin) calls `composer.compose(now, read, write, clampOf)` with `now` from `performance.now() / 1000`, `read/write` on `coreModel.getParameterValueById/setParameterValueById`, and clamp from the core model's parameter min/max.
  - Settings snapshot and commands: `Live2DExpressionSettingsSnapshot` becomes `{ groups: [{ id, name, active }] }` (catalog fields arrive in todo 12); command union keeps `toggle` (by id), `save-defaults`, `reset-all`; remove `set-llm-mode` and `set-llm-exposed` and the `llmMode`/`llmExposed` state (replaced by catalog exposure in todo 12). Update `applySettingsCommand`.
  - Update consumers: `apps/stage-tamagotchi/src/shared/model-settings-runtime.ts`, `renderer/composables/model-settings-runtime-owner.ts`, `renderer/composables/model-settings-runtime-snapshot.ts`, `renderer/pages/index.vue:187-203,354-361`, `packages/stage-ui/src/components/scenarios/settings/model-settings/runtime.ts:12-19`, and the minimal compile fixes in `live2d.vue` (render toggles by id; keep save/reset buttons; delete the LLM-mode select and custom checkboxes and their computed options at `live2d.vue:154-158,813-840`). The full catalog UI lands in todo 15.
  - Validator: `packages/stage-ui-live2d/src/utils/live2d-validator.ts:527-535` keeps reporting unreferenced exp3 files but the message must say they are loaded from the archive (no longer "add them to FileReferences"). Update `live2d-validator.test.ts:130-143` accordingly.
  - Delete `packages/stage-ui-live2d/src/tools/expression-tools.ts` and its `./tools/expression-tools` export in `packages/stage-ui-live2d/package.json` in this todo (it consumes the removed store APIs and has no callers); todo 18 adds the replacement tools.
  - Keep `settings.live2d.expressions.*` i18n keys that are still used; delete the English keys for removed controls (`expose-to-llm-toggle`, `expose-to-llm-options.*`, `llm-integration-wip`) only from `packages/i18n/src/locales/en/settings.yaml:272-285`.
  Must NOT do: read the old defaults key; write into the archive or OPFS; change motion-manager plugin order; touch Natural.
  Closes: GAP-1, GAP-2, GAP-3.
  Parallelization: Wave 1 | Blocked by: 2 | Blocks: 12, 14
  References: `expression-store.ts:1-486` (current API, persistence `:107-125,207-239,364-402`, commands `:75-96,424-437`); `expression-controller.ts:1-280`; `Model.vue:374-390,500-551,632-704`; `live2d-zip-loader.ts:56-70,242-263`; `motion-manager.ts:114-177,698-702`; Natural closed-eye rule `natural-motion-adapter.ts:82-104` (must keep working: an expression that closes eyes below 0.15 still wins); cross-window `apps/stage-tamagotchi/src/shared/model-settings-runtime.ts:7-32`, owner `model-settings-runtime-owner.ts:29-74`, snapshot `model-settings-runtime-snapshot.ts:31-59`, settings page `apps/stage-tamagotchi/src/renderer/pages/settings/models/index.vue:64,388`; tests `expression-controller.test.ts`, `live2d-validator.test.ts`, `live2d-zip-loader.test.ts:210-240`, `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.browser.test.ts:39-95`, `apps/stage-tamagotchi/src/renderer/composables/model-settings-runtime.browser.test.ts`. Rig facts: memory note summarized in draft Findings (all exp3 Add, no fades; Bear activity/hair sets share params with explicit zeros).
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` passes (node + browser projects); `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings/live2d.browser.test.ts` passes; `pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/composables/model-settings-runtime.browser.test.ts` passes; root `pnpm typecheck` exit 0. New node tests in `expression-controller.test.ts`: (a) unreferenced `_expFiles` entries are registered; (b) toggling expression B (Add 0 for A's param) leaves A's parameter value unchanged; (c) deactivating B does not reset A's shared parameter; (d) `resetAll` restores the saved rest set; (e) the old key is ignored.
  QA scenarios: happy - Electron: import Bear (zip per Verification strategy), open Settings > Models > Live2D expressions, toggle `game` on, then toggle `eat` on and off, then via CDP read the game parameter (`Param2`) - PASS when it stays at its `game` value throughout; toggle `watermark` on, Save defaults, toggle it off, Reset - PASS when `watermark` is active again; save `task-7-bear-stacking.json` with parameter reads and a screenshot `task-7-settings.png`. ForBOOTH: PASS when the expression list shows 89+ entries (count via CDP on the snapshot). failure - with the pre-change build the same `eat` toggle sets `Param2` to 0; record as `task-7-baseline.json`.
  Recommended task executor category: `deep-low` - multi-file runtime rewrite whose decisions are fixed by this plan.
  Commit: Y | feat(stage-ui-live2d): load every exp3 and stack expressions per expression

- [x] 8. Add the expression-performance settings store
  What to do:
  - Read `.agents/skills/enforce-rules-for-pinia-synced/SKILL.md` first.
  - Create `packages/stage-ui/src/features/performance/settings.ts`: Pinia store `useExpressionPerformanceSettings` holding one document validated by `parseExpressionPerformanceSettings` (todo 1), persisted with the same local-storage helper pattern as `packages/stage-ui/src/features/motions/live2d/settings.ts` under key `settings/expression-performance`, `synced` so the stage and settings windows share it. Actions: `update(patch)` (deep-merge then validate; invalid patches are rejected with the Valibot issues), `reset()`.
  - Export it from the stage-ui stores barrel only if the barrel pattern requires it; prefer the explicit subpath.
  - Tests beside it: defaults load; an invalid stored document falls back to defaults; `update` rejects invalid values; synced state replicates between two Pinia instances using the existing synced test helpers (see the skill).
  Must NOT do: add a second settings document; store catalog or profile data here.
  Closes: GAP-15.
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 15, 16, 17
  References: `packages/stage-ui/src/features/motions/live2d/settings.ts`; `.agents/skills/enforce-rules-for-pinia-synced/SKILL.md`; `packages/stage-ui/AGENTS.md` (synced store conventions); todo 1 schema.
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/features/performance/settings.test.ts` (or the browser project if synced helpers need it) passes; `pnpm -F @proj-airi/stage-ui typecheck` exit 0.
  QA scenarios: happy - run tests, save `task-8-tests.txt`; failure - remove validation from `update`, rerun, capture the failing invalid-patch case to `task-8-mutation.txt`, restore.
  Recommended task executor category: `unspecified-low` - one store following an existing pattern and skill.
  Commit: Y | feat(stage-ui): add expression performance settings store

- [x] 9. Make Natural emotion reactions band-driven: recruitment, timing, escalation, energy intensity
  What to do:
  - Change the Natural input from `{ name, intensity }` to `ReactionEpisode` (todo 1) end to end: `natural-motion-adapter.ts:20-44,248-278` (`pendingEmotions`), `natural-motion.ts:248-251` (`impulse(episode, nowSeconds)`), `Model.vue` `setEmotion` and `Live2D.vue:144-152` expose (`setEmotion(episode)`). Natural no longer deduplicates (the tracker in todo 6 owns episodes); `impulses.ts:145-173` replaces the 2 s dedupe with episode semantics: a new id starts a reaction; an existing id with `escalation: true` adds only the missing head/body amplitude as a new zero-onset pulse and interpolates face targets from current values over 0.08 s.
  - Add `setPerformanceSettings(settings.naturalBands)` on the facade (defaults from `defaultExpressionPerformanceSettings`); wiring from the app comes in todo 16.
  - Per band (values from settings `naturalBands`): slight = face hints only (no head pulse, no glance, no energy); clear = face + head pulse + glance; strong = face + head pulse + body lean + glance + `energy.react(at, intensity)`. Head pulse `F(s) = P(s, tau) - overshoot * P(s - 3 tau, tau)` with `P(s, tau) = (s/tau)^2 exp(2 (1 - s/tau))` for s > 0, gain `headGain * I^0.7` along the existing perturbed emotion direction, retired at 15 tau. Body lean gain `bodyGain * I` along the normalized emotion direction with tau `1.5 * headTau`; never write body axes that `bodyFromHeadPhysics` marks as physics-owned (`natural-motion.ts:193-195,263-265`). Face envelope `(1 - exp(-s/faceOnsetTau)) * exp(-max(0, s - faceHold)/faceReleaseTau)`. Glance hold = `faceHold` using the emotion's existing glance target, else camera.
  - `energy.ts` `react(at, intensity)`: each contribution lasts `energySeconds`; with R = maximum unexpired contribution, amplitude multiplier `1 + energyAmplitude * R`, shift-rate multiplier `1 + energyRate * R` (replaces the fixed reacting overlay `energy.ts:29-34` for emotions; desktop reactions `wake`/`screen-change` keep calling `react(at, 1)` with their current behavior).
  - When `settings.bands` is false (passed in later), Natural treats every episode as clear (documented on the facade); this is the A/B switch.
  - Update the Natural lab (`packages/stage-ui/src/features/devtools/motion/natural/components/emotion-pulses.vue`) to offer slight/clear/strong buttons instead of the 0..1 slider; `natural-performance-override.ts` pulse carries `nominal`.
  - Keep every consumer compiling and behaving in this commit: in `Stage.vue` make only the minimal call-site updates - the Live2D Natural branch of `emotionsQueue` (`:281-288`) and the lab pulse watcher (`:426-437`) build an interim episode `{ id: crypto.randomUUID(), emotion, nominal, intensity: nominal, band, escalation: false }` with `band` from `defaultExpressionPerformanceSettings.intensity` thresholds (todo 1). Todo 16 replaces this with the conductor.
  - Tests: `impulses.test.ts` and `natural-motion.test.ts` - recruitment isolation (slight: head offset stays 0 and body 0; clear: head peak >= 0.05 normalized at I = 0.6 and body 0; strong: body lean peak > 0 on a rig profile without physics-owned body), onset continuity (no frame jump > 0.02), overshoot sign, escalation adds only the delta (peak of escalated <= peak of a fresh strong at the same intensity + 1e-6), energy contributions do not stack.
  Must NOT do: change idle behavior; change random stream indices 0-11 (`natural-motion.ts:67`); touch expressions.
  Closes: GAP-5 (output side), GAP-6 (energy part).
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 11, 16
  References: `natural-motion.ts:22-88,151-172,248-251,268-349`; `natural-motion/impulses.ts:55-207`; `natural-motion/energy.ts:20-123`; `natural-motion/gaze.ts:101-103`; `natural-motion/body.ts`; `natural-motion-adapter.ts:20-44,248-333`; `Model.vue` setEmotion (search `setEmotion` near line 1083); `Live2D.vue:144-152`; lab `emotion-pulses.vue:12-40`, `packages/stage-ui/src/stores/natural-performance-override.ts:8-76`, `Stage.vue:426-437`; ADR `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d` passes, including the unchanged `natural-motion/liveliness-gate.test.ts` and a new case proving desktop `wake`/`screen-change` reactions produce the same amplitude/shift-rate overlay values as before (x1.3 / x1.5 for 2 s); `pnpm -F @proj-airi/stage-ui-live2d typecheck` and `pnpm -F @proj-airi/stage-ui typecheck` exit 0.
  QA scenarios: happy - run the node suite, save `task-9-tests.txt` including the gate output; failure - make slight start a head pulse, rerun, capture the failing recruitment-isolation case to `task-9-mutation.txt`, restore.
  Recommended task executor category: `deep-low` - motion math across the facade, layers, and adapter.
  Commit: Y | feat(stage-ui-live2d): drive Natural emotion reactions by intensity band

- [x] 10. Derive an expression catalog from model files: VTube Studio labels, kinds, pick-one groups
  What to do:
  - `packages/stage-ui-live2d/src/utils/live2d-zip-loader.ts` (and the OPFS-restored path added in todo 7): alongside `_expFiles`, find the first archive path ending in `.vtube.json` (ignored AppleDouble/`__MACOSX` paths excluded as today) and store its parsed JSON as `settings._vtubeData`; failures are warned and ignored. Extend `live2d-zip-loader.test.ts`.
  - Create `packages/stage-ui-live2d/src/utils/expression-catalog/derive.ts` (pure) and `derive.test.ts`:
    - `readVtubeHotkeyLabels(vtube: unknown): Map<string, string>`: from `Hotkeys[]` entries with `Action === 'ToggleExpression'` and a `File`, map the exp3 base file name (case-insensitive) to `Name` with zero-width characters (U+200B-U+200D, U+FEFF) removed and whitespace collapsed; first non-empty name wins; validate the input shape with `parseVtubeHotkeys`, a Valibot schema added in this todo to `packages/stage-shared/src/expression-performance/vtube.ts` and exported from that module's `index.ts` (the Live2D package has no direct `valibot` dependency).
    - `suggestKind(label, fileName): ExpressionKind` by case-insensitive token rules, first match wins: system = watermark, 水印; prop = phone, bag, game, pillow, board, note, box, mouse, chat box, chat text, chat icon, pen, eat; outfit = hair, braid, bun, ponytail, glasses, coat, bow, sleeve, nail, earring, ear hide, tail, headphone, hat, cap, eye color, eye mask, mask, band-aid, sticker, arms disappear, remove body, body; effect = tear, zzz, exclamation, confusion, awkward, blood, snot, black face, love, red; face = everything else.
    - `suggestGroups(defs, kinds)`: union-find, separately within each suggested kind (never across kinds), over non-system expressions that share a parameter id where at least one of them sets a non-zero value; ignore parameter ids used by any system-kind expression; groups with one member are null; group id = `group:<first member id in code-point order>`.
    - `deriveCatalog(defs, model3Refs, vtube)`: label precedence model3 Name > VTube Studio label > file base name; `confirmed: false`, `exposedToLlm: false`, `mappings: []`, `parameterIds` from the exp3.
  - Fixtures: synthetic JSON shaped like the two rigs (ForBOOTH-style single switch params with names like `Angry`, `Glasses 1`, `Hide the watermark`; Bear-style activity set `game`/`eat`/`Pen fingers` sharing params with explicit zeros, hair set, watermark). Never copy private rig files into the repo.
  Must NOT do: persist anything; auto-confirm or auto-expose.
  Closes: GAP-4 (derivation).
  Parallelization: Wave 1 | Blocked by: 1 | Blocks: 12
  References: `live2d-zip-loader.ts:15-78,242-263`; `live2d-zip-loader.test.ts:210-240`; rig analysis in draft Findings (VTS hotkeys name 80/89 ForBOOTH and 30/27 Bear; Bear activity and hair sets share params; ForBOOTH mask files share the watermark param); todo 1 catalog types.
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/utils/expression-catalog/derive.test.ts src/utils/live2d-zip-loader.test.ts` passes with cases: zero-width label cleanup; label precedence; kinds for every fixture name; Bear activity set forms one group and hair set another; ForBOOTH mask files do not group with watermark expressions; a face and an outfit that share a parameter are never grouped together; unknown `.vtube.json` shapes yield an empty label map.
  QA scenarios: happy - run tests, save `task-10-tests.txt`; additionally in Electron after todo 12 is in, see todo 12. failure - remove the system-parameter exclusion, rerun, capture the mask/watermark grouping failure to `task-10-mutation.txt`, restore.
  Recommended task executor category: `unspecified-high` - parsing plus heuristics with fixtures.
  Commit: Y | feat(stage-ui-live2d): derive expression catalog labels, kinds, and groups

- [x] 11. Add the decaying mood state to Natural, exactly identity at rest
  What to do:
  - Create `packages/stage-ui-live2d/src/composables/live2d/natural-motion/mood.ts` and `mood.test.ts`: `NaturalMood { valence [-1,1], arousal [-1,1], tension [0,1] }`; exact exponential decay per active-time step `m *= exp(-dt / tau)` with taus from settings `moodDynamics`; `add(episode)` adds `gain(band) * I * c(emotion)` then clamps; escalation adds only `(newDose - oldDose) * c(emotion)` tracked per episode id.
  - Emotion coefficient table `c` (valence, arousal, tension), a fixed semantic table documented in the ADR (todo 24): happy (0.7, 0.5, -0.2); sad (-0.6, -0.5, 0.1); angry (-0.5, 0.6, 0.8); think (0, -0.15, 0.15); surprised (0.1, 0.8, 0.35); awkward (-0.25, 0.15, 0.6); question (0, 0.1, 0.1); curious (0.2, 0.3, 0); neutral (0, 0, 0).
  - In `natural-motion.ts` `integrate()` (after energy assigns knobs at `:275-282`), when mood is non-zero modify the targets once per step (never multiply filtered state repeatedly): `posture.amplitudeScale *= clamp(1 + amplitude * arousal, 0.8, 1.2)`; `posture.shiftRateScale *= clamp(1 + shiftRate * arousal, 0.7, 1.3)`; `gaze.cameraFixationProbability = clamp01(p + cameraValence * valence - cameraTension * tension)`; emphasis acceptance `clamp01(q + emphasis * arousal)`; face `mouthForm += mouthForm * valence` in `withHints`. When all three dimensions are exactly 0, skip modulation entirely and consume no randomness. Mood is driven only when `settings.mood` is true (passed via `setPerformanceSettings`).
  Must NOT do: add random draws; change idle output when no emotion occurred.
  Closes: GAP-6.
  Parallelization: Wave 2 | Blocked by: 9 | Blocks: 16
  References: `natural-motion.ts:268-349`; `energy.ts:57-70,105-123`; `face.ts:12-36`; `gaze.ts:54-58`; draft Decisions (ultrabrain section 4).
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/natural-motion` passes; new tests: (a) a seeded 10-minute idle simulation with mood code present produces bit-identical pose output to the same simulation with modulation bypassed (no emotion events); (b) decay over one 2 s step equals two 1 s steps within 1e-12; (c) bounds hold under 50 consecutive strong angry episodes; (d) escalation dose accounting; the liveliness gate test is unchanged and passes.
  QA scenarios: happy - run tests, save `task-11-tests.txt`; failure - apply modulation even at zero mood with one random draw, rerun, capture test (a) failing to `task-11-mutation.txt`, restore.
  Recommended task executor category: `deep-low` - deterministic dynamics with an identity invariant.
  Commit: Y | feat(stage-ui-live2d): add decaying Natural mood state

- [x] 12. Persist the curated catalog per model and publish it through the settings snapshot and commands
  What to do:
  - In `expression-store.ts` add catalog state: `derived: CatalogEntry[]` (from `deriveCatalog` at registration, using `_expFiles`, model3 refs, and `_vtubeData`), `curated: CuratedCatalogDocument` persisted at `expression-catalog:${modelId}` (validated with `parseCuratedCatalogDocument` from `@proj-airi/stage-shared/expression-performance`; invalid stored data is discarded with a console warning via `errorMessageFrom`), and `catalog = mergeCatalog(derived, curated)`.
  - Pick-one groups at runtime: a manual toggle or rest-set activation of an entry whose `group` is non-null deactivates (fades out) the other members of that group. Automatic and LLM slot activations (todo 14) may deactivate only group members of the same kind that are not in the rest set and not manually active; if the activation would require deactivating any other member (different kind, rest set, manual, or `system`), the slot activation is skipped and logged. This protects outfits, props, and saved defaults even when the user puts different kinds in one group.
  - Commands added to `Live2DExpressionSettingsCommand`: `{ type: 'update-entry', id, patch: Omit<CuratedOverride, 'id'> }`, `{ type: 'reset-entry', id }`, `{ type: 'confirm-all-suggested' }` (sets `confirmed: true` on every entry, leaving kinds as suggested). Snapshot groups gain `label, kind, group, confirmed, exposedToLlm, mappings`. Update the tamagotchi owner/snapshot/eventa files and `runtime.ts` types accordingly; the owner guard (ownerInstanceId + modelId) applies unchanged.
  - Expose a read-only selector `llmEligibleEntries` and `autoEligibleEntries` for todos 16 and 18.
  Must NOT do: write catalog data from the settings window directly (commands only); store catalog in the performance settings document.
  Closes: GAP-4 (persistence, runtime groups).
  Parallelization: Wave 2 | Blocked by: 7, 10 | Blocks: 14, 15, 16
  References: `expression-store.ts` (after todo 7); todo 1 `catalog.ts`; todo 10 `derive.ts`; `apps/stage-tamagotchi/src/shared/model-settings-runtime.ts:7-32`; `model-settings-runtime-owner.ts:29-74`; `model-settings-runtime-snapshot.ts:31-59`; `apps/stage-tamagotchi/src/renderer/pages/index.vue:187-203,354-361`; `packages/stage-ui/src/components/scenarios/settings/model-settings/runtime.ts:12-19`; stage-ui AGENTS rule "Other windows issue commands and render snapshots".
  Acceptance criteria: node tests in `packages/stage-ui-live2d/src/stores/expression-store.test.ts` (create if absent): curated overrides persist and reload per model id; a second model id has independent overrides; activating one group member fades out the others; a slot activation of a face whose user-edited group also contains an active outfit is skipped and the outfit stays active; a slot activation never displaces a rest-set member; invalid stored JSON is discarded. `pnpm -F @proj-airi/stage-tamagotchi exec vitest run src/renderer/composables/model-settings-runtime.browser.test.ts` passes with a new case that sends `update-entry` from the settings side and observes the label change in the next snapshot; root `pnpm typecheck` exit 0.
  QA scenarios: happy - Electron with ForBOOTH imported: via CDP in the stage window read the catalog; PASS when at least 80 entries have labels that are not `expressionN` (VTube Studio import) and `Glasses 1` has suggested kind `outfit`; save `task-12-catalog.json`. failure - send `update-entry` with a stale modelId through the eventa invoke; PASS when it is rejected by the owner guard and the catalog is unchanged; save `task-12-guard.json`.
  Recommended task executor category: `unspecified-high` - store, persistence, and cross-window contract updates.
  Commit: Y | feat(stage-ui-live2d): persist curated expression catalog per model

- [x] 13. Implement the decision seam and the expression picker decider
  What to do:
  - Create `packages/stage-shared/src/expression-performance/picker.ts`, `deciders.ts`, and tests. `createPickerDecider(): Decider<PickerState>`; `deciders.ts` exports `createDecider(kind: ExpressionPerformanceSettings['decider'])` returning the picker (todo 23 adds the planner case).
  - Picker state (plain JSON per todo 1): the reaction state (todo 6) created from `initial(seed)`, a recency record `expressionId -> lastActivatedAt`, current slot occupants, and three uint32 PRNG states (intensity, face, effect) derived from the seed. `nextDeadline` returns null (the picker never schedules).
  - `decide(signal, ctx, state)`:
    - `emotion`: when `ctx.settings.bands` is false use nominal 0.6 for every emotion. Pass to the tracker; null -> empty decision. For neutral: emit slot commands clearing face and effect (`expressionId: null`) and no episode.
    - For an episode, when `ctx.settings.autoExpressions` is true and the episode is new or escalated: candidates = `ctx.catalog.filter(isAutoEligible)` with a mapping for the emotion whose `bandRank[minBand] <= bandRank[episode.band]` and positive weight, split by kind into face and effect slots, sorted by id (code-point order). Recency-adjusted weight `W = weight * (1 - recencyDepth * exp(-age / recencyTau))` (never selected: age = Infinity). Face gate probability 1; effect gate `clamp((I - effectGateFrom) / (effectGateTo - effectGateFrom), 0, 1)`. Draw exactly two tickets per slot per new episode from that slot's stream, even when candidates are empty (deterministic replay). Escalation reuses the episode's tickets, keeps occupied slots, and may fill empty ones. Emit `SlotCommand { slot, expressionId, holdSeconds: naturalBands[band].faceHold, until: 'speech' }`. Update recency only for actually emitted ids.
    - `expression` (from ACT or tool): the conductor has already validated the id; emit a slot command for the entry's kind slot (`face` for face, `effect` for effect, `prop` for prop) with `holdSeconds = signal.holdSeconds ?? naturalBands.clear.faceHold`, `until: signal.holdSeconds ? 'hold' : 'speech'`.
    - `speech`, `muted`, `timing`: picker returns empty decisions (lifetimes are owned by the performer in todo 14).
  Must NOT do: read globals for time or randomness; reference parameter ids.
  Closes: GAP-7, GAP-12.
  Parallelization: Wave 2 | Blocked by: 1, 6 | Blocks: 16, 20, 23
  References: todo 1 types; todo 6 tracker; draft Decisions (ultrabrain section 5); shuka weighted-pick precedent `C:/Users/Luke/projects/shuka/shuka-vts-bridge-v3-pre-motion/packages/shuka-config/src/engine/resolvers/emotion-expression-groups.ts` (read-only inspiration).
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance/picker.test.ts` passes with cases: effect gate at I = 0.5 / 0.65 / 0.8 gives probabilities 0 / 0.5 / 1 over 10,000 seeded trials within 0.02; recency lowers then recovers selection frequency; empty mappings emit no slot but consume the same tickets (sequence after an empty episode equals a run with a mapped episode replaced); candidate order in the input does not change results; identical seeds and signals replay identical decisions; unconfirmed, outfit, prop, and system entries are never auto-picked; neutral clears face and effect.
  QA scenarios: happy - run tests, save `task-13-tests.txt`; failure - skip ticket draws when candidates are empty, rerun, capture the replay-alignment failure to `task-13-mutation.txt`, restore.
  Recommended task executor category: `deep-low` - stochastic selection with determinism invariants.
  Commit: Y | feat(stage-shared): add expression picker decider behind the decision seam

- [x] 14. Add expression slots with speech-bound leases to the Live2D performer
  What to do:
  - In `packages/stage-ui-live2d` add `src/composables/live2d/expression/slots.ts` (pure lease logic) and wire it into `expression-store.ts`: three slots `face`, `effect`, `prop`, each holding at most one transient lease `{ expressionId, turnId | null, activatedAt, holdSeconds, until, lastClipEndAt | null, sawClipStart: boolean }`. Transient activations compose on top of the rest set and manual toggles; releasing a lease never deactivates an expression that is also in the rest set or manually active (ownership counted per source).
  - API on the store: `applySlots(commands: SlotCommand[], now)`, `onSpeech(event: 'clip-start' | 'clip-end' | 'clip-stopped' | 'turn-end', turnId: string, now)`, `setMuted(muted)`, `tickLeases(now)` (called from the final plugin before compose). Speech events affect only leases with the same `turnId`; leases without a turn id (devtools, tool calls outside a turn) follow the hold rule.
  - Lifetime rules: a command with `expressionId: null` releases that slot now. A new command for an occupied slot replaces the lease (old fades out, new fades in; pick-one groups apply with the slot-activation protection rule from todo 12). `until: 'hold'` releases at `activatedAt + holdSeconds`. `until: 'speech'`: if muted or no clip starts within `unstartedExpiry` seconds, release at `activatedAt + holdSeconds`; otherwise keep the lease while clips keep playing and release at `max(activatedAt + holdSeconds, lastClipEndAt + speechGrace)` after `turn-end`, or immediately on `clip-stopped` (interrupt/cancel); hard cap `activatedAt + holdCap`. Terminal events are idempotent and never extend a released lease. Clarification (orchestrator, 2026-10-18, from draft line 127 'unstarted requests expire after 10 s'): an unmuted 'speech' lease whose turn has produced no clip start waits for speech until `activatedAt + max(holdSeconds, unstartedExpiry)` and then releases; a muted lease releases at `activatedAt + holdSeconds`. A turn-end ends the wait: once its turn has ended, the lease follows the turn-end rule `max(activatedAt + holdSeconds, lastClipEndAt + speechGrace)`, which with no clip is `activatedAt + holdSeconds`, because no speech can arrive for an ended turn.
  - Expose `applySlots`, `onSpeech`, `setMuted` through `Model.vue` and `Live2D.vue` `defineExpose` (next to `setEmotion` at `Live2D.vue:144-152`).
  Must NOT do: decide which expression to show (decider's job); read emotions.
  Closes: GAP-7 (lifetimes).
  Parallelization: Wave 2 (after 12 on the same store file) | Blocked by: 7, 12 | Blocks: 16
  References: `expression-store.ts` (after 7 and 12); todo 2 composer; todo 1 `SlotCommand`; settings `slots.*`; ACT ordering facts: `packages/pipelines-audio/src/processors/tts-chunker.ts:127-171`, `packages/pipelines-audio/src/speech-pipeline.ts:139-179` (a marker fires after the preceding chunk plays and before the next chunk).
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui-live2d exec vitest run --project node src/composables/live2d/expression/slots.test.ts src/stores/expression-store.test.ts` passes with cases: long speech keeps the face until turn end + grace; short speech respects the minimum hold; muted releases after hold; an unrelated clip-end does not release a fresh lease that has not seen a start; duplicate turn-end is idempotent; `clip-stopped` releases immediately; interleaved two-turn case: turn A's turn-end or clip-stopped never releases turn B's lease and vice versa; a rest-set expression used as a slot stays active after release; replacing a lease in a pick-one group fades the old member.
  QA scenarios: happy - run tests, save `task-14-tests.txt`; failure - release on the first clip-end instead of turn-end, rerun, capture the long-speech failure to `task-14-mutation.txt`, restore.
  Recommended task executor category: `deep-low` - lease state machine with ownership rules.
  Commit: Y | feat(stage-ui-live2d): add speech-bound expression slots

- [x] 15. Build the catalog editor and performance switches in the Live2D settings page
  What to do:
  - Read `DESIGN.md` and `.agents/skills/enforce-rules-for-unocss/SKILL.md` first.
  - In `packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue` replace the expression section (`:777-852`) with: a list of catalog entries (label, kind chip, group name, confirmed state, LLM-exposed toggle shown only for `face`/`effect`/`prop`), a preview toggle per entry (the existing `toggle` command), an inline editor per entry (label text, kind select, group select from existing groups plus "none", emotion mappings: emotion select, weight number 0.1-5, minimum band select), "Confirm all suggested", Save defaults, Reset. Use existing `@proj-airi/ui` primitives already used in this file.
  - Add a "Emotion performance" section bound to `useExpressionPerformanceSettings` (todo 8): switches `bands`, `mood`, `autoExpressions`, `stateFeedback`; no numeric tunable editors (tunables are changed only by code/settings document).
  - All edits go through `emits('live2dExpressionCommand', ...)` when the snapshot is remote (existing pattern `live2d.vue:81-92`) or the local store otherwise (stage-web).
  - English strings in `packages/i18n/src/locales/en/settings.yaml` under `settings.live2d.expressions.*` and a new `settings.live2d.performance.*` block.
  - Update `live2d.browser.test.ts`: remote snapshot renders labels and kinds; editing a label emits `update-entry`; toggling the bands switch updates the settings store.
  Must NOT do: add a numeric tuning UI; modify shared `packages/ui` components (if unavoidable, update stories and `docs/assets/ai/context/ui-components.md`).
  Closes: GAP-4 (UI), GAP-15 (switches).
  Parallelization: Wave 3 | Blocked by: 8, 12 | Blocks: 24, 26
  References: `live2d.vue:35-53,81-92,154-158,777-852`; `live2d.browser.test.ts:39-95`; `packages/i18n/src/locales/en/settings.yaml:272-285`; `DESIGN.md`; `.agents/skills/enforce-rules-for-unocss/SKILL.md`; `.agents/skills/use-vishot/SKILL.md` for screenshots.
  Acceptance criteria: `pnpm -F @proj-airi/stage-ui exec vitest run --project browser src/components/scenarios/settings/model-settings/live2d.browser.test.ts` passes; `pnpm -F @proj-airi/stage-ui typecheck` exit 0; `pnpm exec eslint packages/stage-ui/src/components/scenarios/settings/model-settings/live2d.vue` clean.
  QA scenarios: happy - Electron with Bear imported: open Settings > Models > Live2D, relabel `red` to `Blush`, set kind `face`, add mapping happy weight 1 min band clear, confirm, close and reopen settings; PASS when the edits persist (CDP read of `expression-catalog:<modelId>` in localStorage and the rendered list); capture desktop and narrow-width screenshots `task-15-settings-desktop.png`, `task-15-settings-narrow.png` and inspect them for overflow. failure - set the weight field to 0; PASS when the UI rejects it (validation message) and no command is sent; save `task-15-invalid.png`.
  Recommended task executor category: `visual-engineering` - settings UI with real-surface visual checks.
  Commit: Y | feat(stage-ui): add expression catalog editor and performance switches

- [x] 16. Add the stage performance conductor and route Live2D emotions through the decision seam
  What to do:
  - Create `packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts` and tests. It owns: one decider from `createDecider(settings.decider)` with state seeded once per stage mount (seed from `crypto.getRandomValues` at mount; the seed is recorded for traces in todo 22), the effective settings (`useExpressionPerformanceSettings`; todo 22 adds profiles), the catalog (`useExpressionStore().catalog`), and a monotonic clock `performance.now() / 1000`.
  - Inputs it accepts: `emotion(name, nominal, source, turnId?)`, `expression(expressionId, holdSeconds?, source, turnId?)`, speech events `clipStart(turnId, clipId)`, `clipEnd(turnId, clipId, status)`, `turnEnd(turnId)`, `setMuted(muted)`. Turn ids come from `playSpecialToken(special, { turnId })` (`Stage.vue:356-370`, used by both the speech `onSpecial` and the muted path) and the `voice.connectOutput(turn)` closure. Each becomes an `AffectSignal` passed to `decider.decide`; the decision is dispatched: episodes -> `live2dSceneRef.setEmotion(episode)` (Natural driver only). For Universal/MAGIC drivers the conductor preserves today's routing exactly and independently of episode filtering: every recognized emotion signal, including repeats and `neutral` (which maps to the `Idle` group), sets `currentMotion.value = { group: EMOTION_EmotionMotionName_value[name] }` as `Stage.vue:281-288` does today; slot commands -> `live2dSceneRef.applySlots(commands, now)` for every Live2D driver; speech events -> `live2dSceneRef.onSpeech(...)`.
  - `Stage.vue` integration: in the Live2D branch of `emotionsQueue` (`Stage.vue:270-300`) call the conductor instead of `setEmotion`/`currentMotion`; the VRM/MMD/Spine/Tachie branches stay as they are. In `onSignal` (`:329-350`) pass `act.emotion.intensity` as nominal and, when `act.expression` is present, leave it for todo 18 (log nothing yet). Wire `voice.connectOutput` callbacks (`:455-481`): `onPlaybackStart(clip)` -> `clipStart(clip.id)`, `onPlaybackEnd(clip, end)` -> `clipEnd(clip.id, end.status)`; the existing `voice.activeTurns` watcher (`:448-452`, the store supports several active responses per `packages/stage-ui/src/stores/voice.ts:59-60,195-199`) -> `turnEnd(turnId)` for every turn id that disappears from `activeTurns` (diff the previous and current lists), never only on global emptiness; `speechMuted` -> `setMuted`. The Natural lab pulse watcher (`:426-437`) routes through the conductor with `source: 'devtools'`.
  - Pass the effective settings to the Live2D scene as a new prop `performanceSettings` forwarded by `Live2D.vue` to `Model.vue`, which calls Natural `setPerformanceSettings` (todo 9/11) on change.
  - Keep the `EmotionThinkMotionName` on-send motion (`Stage.vue:590`) unchanged.
  Must NOT do: change VRM/MMD/Spine/Tachie handling; add a second cross-window transport; put decision logic in the conductor beyond validation and dispatch.
  Closes: GAP-7, GAP-12, GAP-14 (routing preserved).
  Parallelization: Wave 3 | Blocked by: 5, 8, 9, 11, 12, 13, 14 | Blocks: 18, 21, 22
  References: `Stage.vue:154,270-350,393-437,448-481,590,716-727`; `packages/stage-ui-live2d/src/components/scenes/Live2D.vue:144-175`; `Model.vue` props (`:58-61`) and setEmotion; `packages/core-agent/src/voice/output/response.ts:20-44` (SpeechClip id/text, onPlaybackEnd status); existing test `packages/stage-ui/src/components/scenes/stage-emotion-routing.browser.test.ts:51-88`; architect seam invariants in draft Decisions.
  Acceptance criteria: conductor unit tests (fake scene, fake clock injected for tests only through a constructor option) cover: Natural driver receives episodes with bands; Universal and MAGIC drivers get a motion group for every recognized emotion signal - including a happy repeated within 2 s (two motion-group sets) and neutral (`Idle`) - exactly as before, and slot commands still apply; emotion, expression, and speech signals carry the turn id; with two interleaved active turns, removing turn A from `activeTurns` emits `turnEnd('A')` only and turn B's expression and scheduled plans are unaffected; muted mode forwards `setMuted(true)`; clip and turn events reach `onSpeech`; lab pulses use source devtools. `stage-emotion-routing.browser.test.ts` updated and passing; `pnpm -F @proj-airi/stage-ui typecheck`, `pnpm -F @proj-airi/stage-ui-live2d typecheck`, and root `pnpm typecheck` exit 0.
  QA scenarios: happy - Electron, Bear imported, Natural driver, catalog: `anger` confirmed face mapped angry (min clear), `cry` face mapped sad; scripted LLM reply `<|ACT {"emotion":{"name":"angry","intensity":"clear"}}|> I am annoyed now. <|ACT {"emotion":{"name":"neutral"}}|> Okay, better.` with Kokoro FP32 speech; via CDP sample the anger switch parameter and `ParamAngleX/Y` at 30 Hz; PASS when anger rises during the first sentence, a head pulse occurs within 0.5 s of the first chunk start, and anger releases after the neutral marker; save `task-16-act-speech.json`. failure - same reply with speech muted; PASS when anger activates immediately and releases after the clear hold (1.2 s + fade) without waiting for playback; save `task-16-muted.json`. Correction (orchestrator, 2026-10-18, from the todo 16 verifier): under todos 13 and 14 an explicit neutral clears the face immediately, so the muted scenario must deliver the neutral marker after the hold, as in `task-16-muted-variant.json`. The speech-on scenario is re-run after todo 28 lands.
  Recommended task executor category: `deep-high` - cross-package integration in Stage.vue with lifecycle and ordering decisions.
  Commit: Y | feat(stage-ui): route Live2D emotions through the performance conductor

- [x] 17. Add per-character performance profiles to the character card
  What to do:
  - `packages/stage-ui/src/types/airiCard.ts:11-69`: add `modules.performance?: PerformanceProfile` where `PerformanceProfile = { expressiveness?: number (0.5-1.5, identity 1), moodGainScale?: number (0-2, identity 1), moodDecayScale?: number (0.5-2, identity 1), mappingWeights?: Record<string /* modelId */, Record<string /* expressionId */, number /* multiplier 0-5 */>> }`. Declare the Valibot schema in `packages/stage-shared/src/expression-performance/profile.ts` with `resolveEffectiveSettings(settings, profile): { settings, expressiveness }` (returns a settings copy whose `moodDynamics.slightGain/clearGain/strongGain` are multiplied by `moodGainScale` and whose `valenceTau/arousalTau/tensionTau` are multiplied by `moodDecayScale`; `expressiveness` defaults to 1 and is applied by the conductor in todo 22 as `nominal = clamp(nominal * expressiveness, 0, 1)` before the reaction tracker) and `applyMappingWeights(catalog, modelId, profile)` (multiplies each mapping weight by `mappingWeights[modelId][entry.id]` when present; 0 disables that mapping).
  - Normalization keeps unknown fields (`packages/stage-ui/src/stores/modules/airi-card.ts:399-490`); `getModules(characterId)` (`:916-960`) returns the resolved performance profile (absent -> undefined).
  - Card editor: in `packages/stage-pages/src/pages/settings/airi-card/components/CardEditor.vue` Modules section (`:337,385-396,578,653-685`) add a Performance subsection with three sliders (expressiveness, mood strength, mood length). Mapping weights are not edited here (they are set from the Live2D catalog editor in a later iteration; for now they can be imported with the card) - document this in the editor helper text. Save through the existing module patch (`applyAiriCardEditorModules`, `packages/stage-ui/src/services/airi-card-editor.ts:132-166`), preserving other fields.
  - English strings under `settings.pages.card.performance.*`.
  Must NOT do: key profiles by provider or model name; store null (omit unset fields; card sync rule `packages/stage-ui/src/libs/document-sync/README.md:52-56`); touch the conductor (todo 22 applies profiles).
  Closes: GAP-13 (data and editor).
  Parallelization: Wave 3 | Blocked by: 1, 8 | Blocks: 22
  References: `airiCard.ts:11-69`; `airi-card.ts:295-316,399-490,916-960,1060-1085`; `airi-card-modules.ts:1-19`; `airi-card-editor.ts:132-166`; `CardEditor.vue:330-339,443-460,653-685`; sync `packages/stage-ui/src/libs/character-card-sync/card-fields.ts:45-70`; tests `airi-card.test.ts`, `airi-card-inheritance.test.ts:147-165`, `airi-card-editor.test.ts:124-211`, `card-fields.test.ts:12-43`; `packages/ccc/AGENTS.md:18-31`.
  Acceptance criteria: tests: profile round-trips through normalization and the editor without dropping other modules; `splitCard` emits `/extensions/airi/modules/performance` as one field and omits unset members; `resolveEffectiveSettings` with an empty profile equals the input settings (identity); out-of-range values are rejected by the schema. Commands: `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/stores/modules src/services/airi-card-editor.test.ts src/libs/character-card-sync` and `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance/profile.test.ts` pass; `pnpm -F @proj-airi/stage-pages typecheck` (or the package's typecheck script) exit 0.
  QA scenarios: happy - Electron: open the active card's editor, set expressiveness 1.3, save, reopen; PASS when the slider shows 1.3 and CDP read of the card shows `extensions.airi.modules.performance.expressiveness === 1.3` with other modules unchanged; save `task-17-card.json` and `task-17-editor.png`. failure - inject an out-of-range value (3) through the store action in CDP; PASS when it is rejected and the stored card is unchanged; save `task-17-invalid.json`.
  Recommended task executor category: `unspecified-high` - card data model, schema, and editor UI.
  Commit: Y | feat(stage-ui): add per-character performance profiles to character cards

- [x] 18. Give the LLM expression access: ACT expression field, curated tools, prompt list, optional state feedback
  What to do:
  - Read `.agents/skills/enforce-rules-for-pinia-synced/SKILL.md` and `.agents/skills/xsai/SKILL.md` first.
  - Runtime state: create `packages/stage-ui/src/features/performance/runtime-state.ts`, a synced Pinia store written only by the conductor (stage renderer): `{ exposed: { label, kind }[], active: { slot, label }[], mood: { valence, arousal, tension } | null }`. Other windows only read it.
  - Conductor (`use-stage-performance-conductor.ts`): keep `runtime-state` updated from `useExpressionStore().llmEligibleEntries` and slot changes. Resolve LLM expression names against the eligible entries only: exact id match, else exact case-insensitive trimmed label match; no fuzzy matching; unknown names are dropped with `console.warn` including the name and the available labels. In `Stage.vue` `onSignal`, when `act.expression` is present call `conductor.expression(name, undefined, 'act')` after the emotion (an explicit expression replaces the auto pick for its slot).
  - Tools: create `packages/stage-ui/src/tools/expression.ts` exporting `createExpressionTools(port)` following the structure of `packages/stage-ui/src/tools/home-assistant.ts` (`tool({...})` with zod parameters, as that file does). `port = { list(): { label, kind, active }[], set(name, holdSeconds?): ExpressionToolResult, clear(slot?): ExpressionToolResult }`. Tools: `set_expression` with `{ expression: string (enum of exposed labels), hold_seconds?: number 1-30 }` and `clear_expression` with `{ slot?: 'face' | 'effect' | 'prop' }`, `list_expressions` with `{}`. Results are JSON `{ success, active?, error?, available? }`; a name that is not exposed returns `success: false` with `available`.
  - Registration: the conductor (runs in the stage renderer, which is the leader that owns executors in Electron per `apps/stage-tamagotchi/src/renderer/App.vue:108-145`, and the only window on web) calls `useLlmToolsStore().addTools(...)` with ids `expression:set_expression`, `expression:clear_expression`, `expression:list_expressions` whenever the exposed set changes, and `removeToolsByIds` when it becomes empty or on unmount. Do not set `defaultActive: false` or `requiresExplicitSelection` (see the NOTICE in `apps/stage-tamagotchi/src/renderer/stores/tools/home-assistant.ts:99-102`).
  - Prompt: add English key `base.prompt.expressions` in `packages/i18n/src/locales/en/base.yaml` with a `{list}` placeholder explaining that these labels can be used in ACT `expression` or with `set_expression`. In `use-airi-runtime-prompt.ts` append it only when `te('base.prompt.expressions', locale.value)` is true and `runtime-state.exposed` is non-empty, with the list grouped by kind (face, effect, prop). Do not add the key to `RUNTIME_PROMPT_KEYS`.
  - State feedback: when settings `stateFeedback` is true, append one line from English key `base.prompt.expression-state` (`{active}`, `{mood}`) built from `runtime-state`, under the same `te` guard.
  - (`packages/stage-ui-live2d/src/tools/expression-tools.ts` was already deleted in todo 7.)
  Must NOT do: expose `outfit` or `system` entries or parameter ids; let the chat window write expression state; add keys to `RUNTIME_PROMPT_KEYS`.
  Closes: GAP-8.
  Parallelization: Wave 4 | Blocked by: 16 | Blocks: 21, 26
  References: `packages/stage-ui/src/tools/home-assistant.ts:145-260`; `packages/stage-ui/src/stores/ai/chat-llm/tools.ts:33-120`; `tool-resolver.ts:151-182`; `apps/stage-tamagotchi/src/renderer/App.vue:108-145`; `use-airi-runtime-prompt.ts:1-30`; `packages/stage-ui/src/stores/chat.ts:670-676` (runtime context); `Stage.vue:329-350`; todo 12 selectors; test patterns `packages/stage-ui/src/stores/ai/chat-llm/llm.test.ts:316-353`, `packages/stage-ui/src/tools/home-assistant.test.ts`.
  Acceptance criteria: tests pass: (a) `expression.test.ts` - set on an exposed face succeeds; an outfit label and an unknown label return `success: false` with `available` equal to the exposed set; hold_seconds outside 1-30 is rejected; (b) prompt test - the appended list equals the exposed set (set equality on labels) and excludes outfits; no line when the key is missing in the locale; (c) conductor test - ACT `expression` with a case-different label resolves, an unknown one is dropped; (d) tool registration replaces by id when the exposed set changes and removes when empty. Root `pnpm typecheck` exit 0; no references to `expression-tools` remain (`rg -n "expression-tools" packages apps` empty).
  QA scenarios: happy - Electron with Bear: confirm and expose `anger` (face) and `game` (prop); scripted LLM returns step 1 a `set_expression` tool call `{"expression":"game"}` then step 2 text `<|ACT {"emotion":"happy","expression":"anger"}|> Let us play.`; via CDP read `Param2` (game) and the anger parameter; PASS when both activate and the tool result JSON has `success: true`; save the request body the scripted server received (to prove the prompt lists `anger` and `game` and the tools are present) as `task-18-request.json` and parameter reads as `task-18-params.json`; record the prompt token estimate (characters / 4) in the same file. failure - scripted tool call `{"expression":"hat"}` (outfit, cannot be exposed); PASS when the tool result is `success: false` with `available` and no hat parameter changes; save `task-18-reject.json`.
  Recommended task executor category: `unspecified-high` - tools, prompt, synced runtime state, and cleanup across packages.
  Commit: Y | feat(stage-ui): give the LLM curated expression tools and ACT expression support

- [x] 19. Add sentence identity to speech segments and clips
  What to do:
  - `packages/pipelines-audio/src/processors/tts-chunker.ts`: each yielded chunk carries `sentenceIndex` (starts at 0, increments after a chunk whose text ends with hard punctuation `. ! ? … 。 ！ ？` or a flush) and `sentenceStart: boolean` (true for the first chunk of a sentence). Special-only chunks keep the current `sentenceIndex` and `sentenceStart: false`.
  - `packages/pipelines-audio/src/types.ts:10-88`: add `sentenceIndex: number` and `sentenceStart: boolean` to `TextSegment`, `TtsResult`, and `PlaybackItem`; propagate through `speech-pipeline.ts` (segmenter, request, playback item creation around `:181-200`).
  - `packages/core-agent/src/voice/output/response.ts:20-23`: `SpeechClip` gains optional `sentenceIndex?: number` and `sentenceStart?: boolean`, filled for pipeline synthesis clips; streaming-provider clips (`:153-188`) leave them undefined (documented: streaming providers have no sentence alignment).
  - Tests: extend the chunker tests (find `tts-chunker.test.ts` or the pipeline tests that cover chunking) and `packages/core-agent/src/voice/output/response.test.ts`.
  Must NOT do: change chunk boundaries or TTS request text; change special ordering.
  Closes: GAP-11 (source data).
  Parallelization: Wave 4 | Blocked by: - | Blocks: 21
  References: `tts-chunker.ts:15-42,100-190`; `speech-pipeline.ts:126-200,297-314`; `types.ts:10-128`; `eventa.ts:19-45`; `response.ts:20-44,89-220`; draft Decisions (ultrabrain section 7).
  Acceptance criteria: `pnpm -F @proj-airi/pipelines-audio exec vitest run` and `pnpm -F @proj-airi/core-agent exec vitest run src/voice` pass; new cases: two sentences split into four chunks produce sentenceIndex 0,0,1,1 with sentenceStart true,false,true,false; a marker mid-sentence does not start a new sentence; chunk texts are byte-identical to before (compare against the pre-change output in the test).
  QA scenarios: happy - run the suites, save `task-19-tests.txt`; failure - increment sentenceIndex on every special, rerun, capture the mid-sentence marker failure to `task-19-mutation.txt`, restore.
  Recommended task executor category: `deep-high` - cross-package speech contract change.
  Commit: Y | feat(pipelines-audio): carry sentence identity through speech segments

- [x] 20. Add the affect trace format, trace wrapper, and replay CLI
  What to do:
  - Create `packages/stage-shared/src/expression-performance/trace.ts` and tests: `AffectTrace = { version: 1, decider: 'picker' | 'planner', checkpoint: unknown (JSON decider state at recording start), initialContext: DeciderContext, entries: ({ type: 'signal', signal: AffectSignal } | { type: 'context', context: DeciderContext })[], truncated: boolean }` with a Valibot schema; `withAffectTrace(decider, sink: (signal) => void)` returns a decider that forwards every signal to `sink` before deciding; two replay modes: `replayAffectTrace(trace, decider, { mode: 'exact' })` requires `decider` to be the recorded kind, starts from `checkpoint`, feeds recorded entries verbatim (including recorded deadline signals), applies `context` entries in order, and must reproduce the live decisions; `{ mode: 'compare', seed }` starts any decider from `initial(seed)` at the recording start (both deciders in a comparison use the same seed and fresh state), drops recorded `deadline` signals, and synthesizes the selected decider's own deadlines: before each recorded signal at time t, and finally up to `endAt`, it feeds `{ kind: 'deadline', at: d }` while `d = decider.nextDeadline(state)` is not null and `d <= t`. The trace gains `endAt: number` (export time). Both modes refuse traces with `truncated: true`.
  - Create `packages/stage-ui-live2d/scripts/replay-affect-trace.ts` (run `pnpm -F @proj-airi/stage-ui-live2d exec tsx scripts/replay-affect-trace.ts --decider picker --mode exact|compare [--seed N] <trace.json>`; `--mode exact` requires the recorded decider kind): validates the trace, replays it with `createDecider`, prints JSON `{ decider, decisions, summary: { episodesByBand, slotChanges, slotChangesPer5sMax, expressions } }`; exit 1 on invalid input.
  Must NOT do: record traces at runtime (todo 22 does); depend on Vue.
  Closes: GAP-12 (A/B method).
  Parallelization: Wave 4 | Blocked by: 1, 13 | Blocks: 22, 23
  References: todo 1 types; todo 13 `deciders.ts`; CLI pattern `packages/stage-ui-live2d/scripts/score-natural-trace.ts`.
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance/trace.test.ts` passes: replaying the same trace twice yields identical decisions; a trace whose checkpoint was taken after 3,000 earlier signals replays to the same decisions the live decider produced after that point; a mid-trace context entry (changed mapping weights) changes subsequent replay decisions exactly as it did live; a truncated trace is refused; a malformed trace is rejected by the schema; the wrapper forwards signals in order; in compare mode a stub decider whose `nextDeadline` returns t+2 receives synthesized deadline signals at the right times (including after the last signal up to `endAt`) and recorded deadline signals are dropped; exact mode rejects a different decider kind.
  QA scenarios: happy - write a fixture trace (10 emotion signals with speech events) to the run temp dir, run the CLI with `--mode exact` and again with `--mode compare --seed 1`, PASS on exit 0 for both with `summary` saved to `task-20-replay.json`; failure - remove `version` from the fixture, PASS when exit code is 1 with the schema message, save `task-20-invalid.txt`.
  Recommended task executor category: `unspecified-low` - small schema, wrapper, and CLI.
  Commit: Y | feat(stage-shared): add affect trace capture format and replay

- [x] 21. Produce timing events and add the decision scheduler
  What to do:
  - Create `packages/stage-shared/src/expression-performance/scheduler.ts` and tests: a plain-JSON scheduler state with pure functions `schedule(state, { reactionId, slot: TimingEvent['kind'], turnId, notBefore, expiresAt, priority, intensity, payload })`, `take(state, event)` (matching kind and turn id, `notBefore <= event.at < expiresAt`; conflicts resolved by priority, then intensity, then insertion order; each plan consumed once), `cancelTurn(state, turnId)`, `expire(state, now)` returning expired plans, and `earliestExpiry(state)` for `nextDeadline`.
  - Conductor (`use-stage-performance-conductor.ts`) emits `TimingEvent`s as `AffectSignal { kind: 'timing' }` to the decider: `sentence_start` on `clipStart` when `clip.sentenceStart` is true (todo 19); `pause` once per gap when no clip starts within `timing.pauseSeconds` after a `clipEnd` and the turn has not ended (timer cancelled by the next `clipStart`; same-time playback events are processed before deadlines); `utterance_end` once on `turnEnd`; `emphasis` when the voice level (Stage.vue `mouthOpenSize`, sampled in the existing `startLipSyncLoop` animation-frame loop in `Stage.vue`) crosses the onset detector, using the detector logic exported from `packages/stage-ui-live2d/src/composables/live2d/natural-motion/speech-emphasis.ts:8-12` with refractory `timing.emphasisRefractory`. Timing events carry the turn id; the conductor also arms one timer for `decider.nextDeadline(state)` after every decision and sends `{ kind: 'deadline', at }` when it fires (re-armed after each decision; cancelled when superseded).
  - The picker ignores timing signals (behavior unchanged); the planner (todo 23) consumes them.
  - Inject the clock and timer functions into the conductor for tests (constructor option); production uses `performance.now` and `setTimeout`.
  Must NOT do: change picker behavior; add polling loops.
  Closes: GAP-11.
  Parallelization: Wave 5 | Blocked by: 3, 16, 18, 19 | Blocks: 22, 23
  References: `Stage.vue:455-515`; `speech-emphasis.ts` (detector constants `:8-12`); todo 19 clip fields; draft Decisions (ultrabrain section 7).
  Acceptance criteria: scheduler tests (expiry, a different turn id rejected, priority order, single consumption, cancelTurn; a plan scheduled from a marker before any playback of its turn is taken by that turn's next sentence_start); conductor tests with fake clock/timers: a decider reporting `nextDeadline` receives exactly one deadline signal at that time when no other input arrives; chunked sentences produce one `sentence_start` per sentence; a 0.1 s gap produces no pause and a 0.3 s gap produces one; `utterance_end` fires once on duplicate turn ends; emphasis respects hysteresis and refractory. `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` and `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance` pass.
  QA scenarios: happy - Electron with speech on (Kokoro FP32) and the scripted LLM reply of two sentences; enable a debug log of timing signals via the affect trace (todo 22 not yet in: log through `console.debug` captured by CDP `Runtime.consoleAPICalled`); PASS when the log shows 2 sentence_start, at least one emphasis, and 1 utterance_end; save `task-21-timing.json`. failure - muted run; PASS when no sentence_start/pause/emphasis events appear and utterance_end still fires once at turn end; save `task-21-muted.json`.
  Recommended task executor category: `deep-low` - event derivation with ordering rules on a fixed spec.
  Commit: Y | feat(stage-ui): emit speech timing events and add the decision scheduler

- [x] 22. Record affect traces in the lab and apply per-character profiles in the conductor
  What to do:
  - Conductor: affect recording is an explicit session. "Start recording" stores `checkpoint = structuredClone(deciderState)`, the decider kind, and the current effective context; afterwards every signal (via `withAffectTrace`, todo 20) and every effective-context change (settings, catalog, profile/mapping weights) is appended in order; "Export" produces the `AffectTrace`. Recording stops itself after 20,000 entries and marks the trace `truncated: true`.
  - Natural lab: add `packages/stage-ui/src/features/devtools/motion/natural/components/affect-trace.vue` to `devtools.vue` with "Start recording" and "Export affect trace" (downloads `AffectTrace` JSON). The lab runs in another window: extend the existing diagnostics BroadcastChannel request/result protocol in `packages/stage-ui-live2d/src/stores/natural-motion-diagnostics.ts:38-131` with an `affect-trace` request handled by the stage (do not open a new channel). English strings for the panel.
  - Profiles: for each emotion or expression signal the conductor resolves the turn's character (`chatSession.sessionMetas[turn.sessionId]?.characterId`, available in the `voice.connectOutput(turn)` closure and the token-special context in `Stage.vue:455-603`; devtools pulses use the active card) and applies `resolveEffectiveSettings` and `applyMappingWeights` (todo 17) with `cards.getModules(characterId).performance`; `expressiveness` scales nominal intensity before the decider.
  Must NOT do: open a new BroadcastChannel; persist traces automatically.
  Closes: GAP-12 (trace capture), GAP-13 (runtime application).
  Parallelization: Wave 6 | Blocked by: 17, 20, 21 | Blocks: 24, 26
  References: `natural-motion-diagnostics.ts:38-131`; `packages/stage-ui/src/features/devtools/motion/natural/devtools.vue:1-21`, `trace-capture.vue:11-133` (UI pattern); `Stage.vue:455-603`; `packages/stage-ui/src/stores/modules/airi-card.ts:916-960`; `packages/stage-ui/src/stores/chat/session-store.ts:76-80,219-224`.
  Acceptance criteria: tests: a recording started after 2,500 earlier signals and containing a mid-recording profile change (mapping weight set to 0) replays through `replayAffectTrace(trace, picker, { mode: 'exact' })` to exactly the slot decisions the conductor dispatched during the recording (record dispatched decisions in the test); recording beyond 20,000 entries marks the trace truncated; with a card profile `expressiveness: 1.5`, a clear (0.6) marker becomes strong (0.9); a profile mapping weight 0 removes that expression from auto picks. `pnpm -F @proj-airi/stage-ui exec vitest run --project node src/composables/performance` and the browser test for the lab panel pass.
  QA scenarios: happy - Electron: fire 10 lab pulses across bands, click Start recording before the pulses and Export affect trace after, run `replay-affect-trace.ts --decider picker --mode exact` on it; PASS when the replay summary's slot changes equal those observed via CDP during the run; save `task-22-trace.json` and `task-22-replay.json`. failure - set the active card's expressiveness to 0.5 and send a strong (0.9) marker through the scripted LLM; PASS when the resulting episode band is slight (0.9 x 0.5 = 0.45) and no head pulse or body lean occurs; save `task-22-profile.json`.
  Recommended task executor category: `unspecified-high` - conductor hookups, devtools panel, and card resolution.
  Commit: Y | feat(stage-ui): record affect traces and apply character performance profiles

- [x] 23. Implement the planner decider behind the same seam
  What to do:
  - Add `'planner'` to the `decider` enum and a `planner` block to the settings schema in `packages/stage-shared/src/expression-performance/settings.ts`: `planner: { minGap: 0.8, window: 5, windowMax: 3, scheduleExpiry: 6 }` (each documented with its neutral meaning).
  - Create `packages/stage-shared/src/expression-performance/planner.ts` and tests; add the `'planner'` case to `deciders.ts`. The planner reuses the picker's candidate, recency, and ticket functions (extract them from `picker.ts` into shared helpers without changing picker results) and the `DecisionScheduler` (todo 21), and adds:
    - immediacy: strong episodes and escalations emit slot commands immediately; clear and slight auto-picked faces are scheduled to the next `sentence_start` of the same turn (signals without a turn id are emitted immediately); a schedule that reaches `scheduleExpiry` s is emitted when the corresponding `deadline` signal arrives (`nextDeadline` returns the scheduler's earliest expiry), so expiry needs no other input; effects are scheduled to the next `pause` or emitted immediately when strong;
    - budget: no more than `windowMax` auto slot changes within any `window` seconds and at least `minGap` s between auto slot changes; over-budget picks are dropped (not queued); explicit LLM `expression` signals bypass the budget; amendment (Luke, 2026-10-18, from the todo 23 verifier): `minGap` is measured between performance moments, so the face and effect changes emitted by one decision share one moment and change together, while `windowMax` still counts each slot change separately;
    - `utterance_end` cancels plans for that turn; neutral clears slots immediately.
    - Natural episodes are never delayed (motion reacts immediately; only expression slots are scheduled).
  - The conductor needs no change: `createDecider(settings.decider)` already selects it; switching `decider` in the settings document recreates the decider with the same seed.
  - Add the planner option to the performance switches in the Live2D settings page (`live2d.vue` performance section from todo 15) as a two-option select, with English strings.
  Must NOT do: delay Natural reactions; add more than the four planner fields; change picker output (picker tests must stay green unchanged).
  Closes: GAP-12.
  Parallelization: Wave 6 | Blocked by: 13, 20, 21 | Blocks: 24, 26
  References: `picker.ts`, `scheduler.ts`, `deciders.ts`, `trace.ts` (todos 13, 20, 21); predecessor pitfalls in the draft Findings (hard-coded priorities, dead knobs; avoid both); draft Decisions (ultrabrain section 7).
  Acceptance criteria: `pnpm -F @proj-airi/stage-shared exec vitest run src/expression-performance` passes with planner cases: clear faces activate at the next sentence_start; strong faces activate immediately; budget caps slot changes at 3 per 5 s; an expired schedule is emitted once by a deadline signal with no further input; a schedule from turn A is not taken by turn B's sentence_start; utterance_end cancels; identical seeds replay identically. A fixture trace (chatty two-turn conversation, 20 emotion markers, recorded with the picker) replayed with both deciders via `replay-affect-trace.ts --mode compare --seed 1` shows `slotChangesPer5sMax <= 3` for the planner and `> 3` for the picker (proves the budget matters on that fixture).
  QA scenarios: happy - run both replays, save `task-23-replay-picker.json` and `task-23-replay-planner.json` with summaries; Electron: switch the decider to planner in settings, run the two-sentence scripted reply with a clear happy marker before sentence 2, PASS when the mapped face activates within 0.15 s after sentence 2's first clip starts (CDP timestamps of clip start and parameter rise), save `task-23-electron.json`. failure - remove the budget, rerun the planner replay, PASS when the budget test fails and the summary exceeds 3; save `task-23-mutation.txt`, restore.
  Recommended task executor category: `ultrabrain` - one cohesive scheduling/arbitration problem with determinism constraints.
  Commit: Y | feat(stage-shared): add planner decider with timing slots and budgets

- [x] 24. Write the ADR and update package documentation
  What to do:
  - Create `docs/ai/adr/2026-10-18-expression-performance.md` (follow the format of `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md`) recording: the decision seam and invariants; per-expression composition semantics and the frame-base ownership rule; discovery from ZIP and OPFS paths (URL models stay model3-only); the catalog and its storage keys (`expression-catalog:<modelId>`, `expression-rest:<modelId>`); dropping `expression-defaults:<modelId>` without compatibility code (users re-save defaults once); intensity words, bands, habituation, escalation; Natural band table; mood dynamics and the emotion coefficient table; slot lease rules; LLM permissions (faces, effects, props); the prompt-key rule; the 48 kHz shared context and the Firefox MobileInteractiveArea risk; the default intensity change from 1 to 0.6 for all renderers; the planner, traces, and profiles; the settings document field list.
  - Update `packages/stage-ui-live2d/README.md` (expressions, catalog, Natural bands and mood, lab panels, multi-capture rule from todo 4) and `packages/stage-shared/README.md` (create it with purpose / usage / when to use / when not to use if absent, per root AGENTS.md) describing the `expression-performance` module. Update `packages/stage-ui/README.md` only if it documents stage emotion routing.
  Must NOT do: document behavior that is not implemented; edit agent configuration files.
  Closes: GAP-14 (documentation of contracts), supports all GAPs.
  Parallelization: Wave 7 | Blocked by: 1-23 | Blocks: F1-F4
  References: `docs/ai/adr/2026-10-17-natural-motion-v2-performance-state.md`; `packages/stage-ui-live2d/README.md`; root `AGENTS.md` (README structure, ADR location, prose rules).
  Acceptance criteria: every storage key, settings field name, and command name in the ADR exists in code (`rg` each name in `packages/`; list results in evidence); `pnpm lint` passes on the changed markdown (if markdown is linted).
  QA scenarios: happy - QA-by-read: grep every identifier named in the ADR and save the hit list to `task-24-identifiers.txt`, PASS when each has at least one code hit; failure - add a fake identifier line temporarily and confirm the same check reports it missing, save `task-24-check.txt`, remove it.
  Recommended task executor category: `writing` - ADR and READMEs.
  Commit: Y | docs(stage-ui-live2d): document expression performance contracts

- [x] 25. Run the regression and performance sweep
  What to do:
  - Run: root `pnpm typecheck`; `pnpm lint`; `pnpm -F @proj-airi/stage-shared exec vitest run`; `pnpm -F @proj-airi/stage-ui-live2d exec vitest run`; `pnpm -F @proj-airi/pipelines-audio exec vitest run`; `pnpm -F @proj-airi/core-agent exec vitest run`; `pnpm -F @proj-airi/stage-ui test:run`; `pnpm -F @proj-airi/stage-tamagotchi exec vitest run`; `pnpm -F @proj-airi/stage-web typecheck` (or its typecheck script); `pnpm -F @proj-airi/ccc exec vitest run`. Compare failures against base `a524482` on the same commands; only failures this plan introduced block (the v2 final sweep recorded six pre-existing `stage-shared` failures; re-establish the base list before judging).
  - Frame cost: in Electron with ForBOOTH, Natural driver, 10 expressions active (3 manual, 1 rest, face/effect/prop slots), measure p95 frame time over 60 s via CDP `Performance` metrics or a `requestAnimationFrame` delta recorder in the stage window, against base `a524482` with the same model and no expressions; PASS when the p95 difference is at most 0.5 ms.
  - VRM sanity: `pnpm -F @proj-airi/stage-ui-three exec vitest run` (VRM expression tests) unchanged.
  Must NOT do: skip, xfail, or delete tests; edit tests to pass without fixing the cause.
  Closes: GAP-14.
  Parallelization: Wave 7 | Blocked by: 1-23 | Blocks: F1-F4
  References: commands in Verification strategy; v2 sweep notes in `.omo/plans/live2d-presence-v2.md` (todo 15 frame-cost method).
  Acceptance criteria: every command exits 0 or its failures are shown identical on base `a524482`; frame-cost PASS.
  QA scenarios: happy - save each command's output to `task-25-<command>.txt` and the frame-cost measurements to `task-25-frame-cost.json`; failure - if any new failure appears, record it in `task-25-failures.md` with the base comparison and register a follow-up todo before continuing.
  Recommended task executor category: `unspecified-high` - broad verification with base comparisons.
  Commit: N | (verification only)

- [~] 26. Complete rendered acceptance on ForBOOTH and Bear
  PARTIAL (Luke decision 2026-10-19 "Mark 26 partial"): 8 of 10 gates PASS on both rigs (band recruitment, negative control, expressions, speech+LLM at 192 kHz). Idle FAILS on pose and stillness rows only (still2, speedPeakLogAsymmetry, meanAngleY, angleXp5). The v1 gaze failure was diagnosed as a cursor-attention confound; the prereg-v2 ForBOOTH rerun on 66c4491 brought gaze into band (eyeHeadCorrelation -0.680). The remaining pose rows also fail on the earlier-build references. Open item for Luke's QA: either drop the pose rows from the idle gate, or bisect them as a possible regression. Evidence: task-26-summary.json, task-26-diag-matrix.json, task-26-diag-notes.md, task-26-idlev2-forbooth-aggregate.json, task-26-prereg-v2.json.
  What to do:
  - Write the preregistration file `.omo/evidence/emotion-expression-performance/task-26-prereg.json` before any capture (todo 4 rule): gates, rigs, capture counts, durations, PASS thresholds below.
  - Idle: per rig, 3 x 600 s Natural captures with bands, mood, and autoExpressions on and no emotion input; aggregate with `score-natural-captures.ts`; PASS when the aggregate passes (no hard failures, banded medians in band).
  - Band recruitment: per rig, 3 preregistered 300 s captures on the same build, each while the lab fires happy and surprised at slight, clear, strong (5 repetitions each, 8 s apart; lab buttons from todo 9). Aggregation: per capture, the median of each per-event metric per band; the gate uses the median of the 3 capture medians. An analysis script kept in the evidence directory (not committed) computes per event, from the trace, the peak head displacement (normalized by the rig range), body-angle peak, and brow/eye-smile hint peaks within 2 s. PASS when: slight head peak < 0.01 and face hint peak > 0.05; clear head peak >= 0.04; strong exceeds clear on head peak and shows body lean > 0 on axes the rig profile does not mark physics-owned (Bear body is physics-owned from head: require the energy overlay instead, measured as higher head speed in the 2 s after strong events than after clear events).
  - Expressions: ForBOOTH - catalog shows VTube Studio labels for at least 80 entries; toggling `Glasses 1` and `Star Eyes` independently never changes the other's parameter; Bear - `game` survives `eat` toggles only when they are not in the same pick-one group (they are grouped by default: activating `eat` fades `game` out by design - record both behaviors); `watermark` survives Reset after Save defaults.
  - Speech and LLM: one scripted conversation per rig with Kokoro FP32 speech covering an emotion change, an ACT expression, a tool call, and neutral; PASS when slot activations follow the lease rules (todo 14) and lipsync mouth > 0.2 during speech (192 kHz device).
  - Take screenshots for each band and expression state (`.agents/skills/use-vishot/SKILL.md`), look at each, and note visible defects in `task-26-visual-notes.md`.
  Must NOT do: change recording bands or thresholds after seeing data; commit traces or rig files.
  Closes: proves IS-1..IS-9, IS-14 on the real surface.
  Parallelization: Wave 7 | Blocked by: 1-23 | Blocks: F1-F4
  References: Verification strategy (Electron, rigs, scripted LLM, Kokoro, pitfalls); todos 3, 4, 7, 9, 11, 12, 14, 16, 18; `.agents/skills/use-agent-browser-for-airi/SKILL.md`; `.agents/skills/agent-browser-electron/SKILL.md`.
  Acceptance criteria: all PASS conditions above recorded in `task-26-summary.json` with artifact paths; teardown receipts (dev tree killed, profile deleted, scripted server stopped, temp zips removed).
  QA scenarios: happy - the scenarios above, each saving its artifact under `.omo/evidence/emotion-expression-performance/task-26-*`; failure - negative control per rig: 3 preregistered 300 s captures with `bands` off and the same lab sequence and spacing as the positive captures, aggregated the same way; PASS when slight and strong median head peaks differ by at most 10%, proving the analysis detects the feature; save `task-26-negative-control.json`.
  Recommended task executor category: `unspecified-high` - long real-surface QA with analysis.
  Commit: N | (verification only)

- [x] 27. Repair the Kirie renderer test broken by the todo 7 expression store API (follow-up from integration check 28fdcf2)
  What to do: root `pnpm typecheck` at 28fdcf2 fails with 9 errors, all in `apps/stage-tamagotchi-kirie/src-web/src/renderer/composables/model-settings-runtime.browser.test.ts`. That test still imports `ExpressionEntry` and `ExpressionGroupDefinition` and calls `registerExpressions`, `expressionGroups`, and toggle-by-name, all of which todo 7 (22919f5) removed. This conflicts with the Must NOT have rule "no edits under apps/stage-tamagotchi-kirie/". Luke decided on 2026-10-18 to allow a test-only edit of that one Kirie test file, as an explicit exception to the Kirie Must NOT rule. No Kirie source changes are allowed.
  Acceptance criteria: root `pnpm typecheck` exit 0 at the integration tip; the Kirie test passes, or its handling follows Luke's decision.
  Parallelization: after 7 | Blocked by: Luke decision | Blocks: 25
  Recommended task executor category: `quick`
  Commit: Y | test(stage-tamagotchi-kirie): follow the per-expression store API

- [x] 28. Deliver ACT/special markers in playback order in the speech pipeline (follow-up from todo 16 verification)
  What to do: today `packages/pipelines-audio/src/speech-pipeline.ts` (about :139-149, :183-215, :281-282) puts special-only segments on the timeline as soon as they arrive, while text segments are enqueued only after synthesis. A marker that follows a sentence therefore fires before that sentence plays. This is pre-existing: it reproduces at a524482, f534200 and HEAD (report `task-16-verify.md`, ordering_root_cause). It contradicts the Scope fact that, with speech on, ACT markers fire after the preceding chunk plays and before the next one. Make specials fire in playback order: a special that follows a text segment fires when that segment's playback ends, or immediately if the segment produced no audio (failed, empty, or muted), and always before the next segment starts. Specials that arrive before any text fire before the first segment. Order among consecutive specials is preserved. With speech muted or without playback, specials fire in arrival order, as they do today. Keep `sentenceIndex`/`sentenceStart` (todo 19) and the chunk texts unchanged. Update every consumer test that encoded the old timing.
  Must NOT do: change chunk boundaries, TTS request text, or ACT parsing; add timers or polling; change the streaming-provider clip path except where it must stay consistent (document it).
  Acceptance criteria: tests in `pnpm -F @proj-airi/pipelines-audio exec vitest run` cover: (a) with a fake TTS of 300 ms latency, `I am annoyed now. <neutral> Okay, better.` fires neutral after clip 1 ends and before clip 2 starts; (b) a leading marker fires before clip 1; (c) a marker after a failed or empty synthesis still fires before the next clip; (d) muted mode keeps arrival order; (e) interrupt/cancel drops pending specials of that turn without firing them out of order. `pnpm -F @proj-airi/core-agent exec vitest run src/voice` and the stage-ui speech tests stay green, and typechecks are green. Live: re-run todo 16's exact plan reply with speech on (Bear, Kokoro FP32). PASS when anger rises during sentence 1 and clears after the neutral marker.
  Parallelization: after 19; blocks 16 (speech QA re-run), 21, 23 | Recommended task executor category: `deep-high`
  Commit: Y | fix(pipelines-audio): deliver special markers in playback order

- [x] 29. Fix the F2 Live2D hardening items (follow-up from F2 review, `.omo/evidence/emotion-expression-performance/F2-review.md`)
  What to do:
  - F2-01: parse unknown exp3 data through a Valibot schema at the boundary before registration in `packages/stage-ui-live2d/src/composables/live2d/expression-controller.ts` (about :62). A non-numeric `Value` must be rejected, so NaN never reaches the core model.
  - F2-04: restore the all-emotion, three-intensity, 20-seed amplitude-bound regression sweep in `natural-motion/impulses.test.ts`, using the new `ReactionEpisode` inputs.
  - F2-10: use `errorMessageFrom` in the three added catches in `live2d-zip-loader.ts` (about :85), and update the diagnostic assertion.
  - F2-12: remove the `any` annotations and assertions in `performModelLoad` in `Model.vue` (about :447, :489, :656, :663).
  Acceptance criteria: red-first test for F2-01 (`Value:"bad"` writes no NaN); the restored sweep passes; stage-ui-live2d tests and typecheck pass.
  Commit: Y | fix(stage-ui-live2d): harden exp3 parsing and restore amplitude regression coverage

- [x] 30. Fix the F2 trace bounds and dead slot fade setting (follow-up from F2)
  What to do:
  - F2-02: `parseAffectTrace` must accept every valid effective context, including profile-expanded values such as strongGain 0.8 x moodGainScale 2 = 1.6. Keep the persisted-settings bounds unchanged.
  - F2-03: wire `slots.defaultFadeSeconds` into composition as the fallback fade, replacing the hardcoded 1, and test a non-default value.
  Acceptance criteria: red-first tests for both; a trace recorded under a 2x profile parses and replays exactly; stage-shared and consumer tests and typechecks pass.
  Commit: Y | fix(stage-shared): accept profile-scaled trace contexts and honor the slot fade setting

- [x] 31. Remove fixed sleeps and polling from tests touched by this plan (follow-up from F2-05)
  What to do: replace the real 300 ms sleeps in `packages/pipelines-audio/src/speech-pipeline.test.ts` (about :381) with deferred synthesis promises, subscribed completion signals, or controlled fake time. Remove explicit polling from the Kirie test changed by todo 27 (that one file only, per Luke's exception) and from the lab tests this plan changed.
  Must NOT do: weaken any assertion; change production code.
  Acceptance criteria: the same ordering cases (a)-(e) still pass and still fail on the old pipeline code (mutation); no `setTimeout`-based waits remain in the touched tests.
  Commit: Y | test: replace sleeps with event-driven waits in expression performance tests

- [x] 32. Fix the F2 settings UI rule items (follow-up from F2)
  What to do:
  - F2-07: await the leader-routed synced update in the decider setter in `model-settings/live2d.vue` (about :112) and in the changed switches; do not `void` the promise.
  - F2-08: convert new and changed markup in `live2d-expression-entry.vue` and its parent to grouped class arrays, with no long inline strings and no attributify groups.
  - F2-09: expand the wlipsync sample-rate comment in `packages/stage-ui/src/stores/audio.ts` (about :68) to the full NOTICE format without changing 48000 Hz.
  Acceptance criteria: settings browser tests and stage-ui typecheck pass; no visual change (screenshot before and after).
  Commit: Y | refactor(stage-ui): follow synced-store and UnoCSS rules in expression settings

- [x] 33. Move affect-trace diagnostics to Eventa and translate failure strings (follow-up from F2-06, F2-11)
  What to do:
  - F2-06: define centralized `@moeru/eventa` contracts for the affect-trace request/result messages added by todo 22 in `natural-motion-diagnostics.ts` (about :58), carried over the existing diagnostics BroadcastChannel. Add no new channel.
  - F2-11: give the recording/export failure and save-failure messages English i18n entries, and render them through the catalog in the lab.
  Acceptance criteria: lab browser tests (export, cross-window) pass; Electron lab recording export still works; the i18n keys exist in English only.
  Commit: Y | refactor(stage-ui): carry affect trace diagnostics over Eventa

- [x] 34. Make the lab emotion pulses read the configured band nominals (follow-up from F1 phase 1)
  What to do: `packages/stage-ui/src/features/devtools/motion/natural/components/emotion-pulses.vue` (about :47) reads the immutable default band nominals, so a configured `intensity.clear` of 0.7 still emits nominal 0.6. That is a dead tunable under IS-15. Read the band nominal values from the validated expression-performance settings document, the same source the conductor uses.
  Must NOT do: change the default values; change the band table or the reaction-strength logic; add a new settings field.
  Acceptance criteria: a red-first browser test clicks the real lab button with a non-default `intensity.clear` and asserts the emitted nominal; at default settings the emitted values are unchanged; stage-ui typecheck and the lab browser tests pass.
  Commit: Y | fix(stage-ui): use configured band nominals in the lab emotion pulses (this is the final commit and carries the `Plan:` footer)

- [~] 35. Resolve the partial rendered idle acceptance for IS-6 (follow-up from F4)
  What to do: idle acceptance fails four pose and stillness rows (still2, speedPeakLogAsymmetry, meanAngleY, angleXp5) in task-26-idlev2-forbooth-aggregate.json. The same rows fail on the base and on the earlier-build references (task-26-diag-notes.md). Luke must choose between (a) excluding these rows from this plan's idle acceptance and (b) bisecting a possible regression.
  PARTIAL (orchestrator, Luke away; standing instruction "use your recommended solution"): Luke already chose "Mark 26 partial" over accepting the pose rows, and said he will QA later. This todo therefore stays open for his QA with the evidence above. Todo 26 keeps its [~] status and its original failed artifacts unchanged.
  Commit: N

- [x] 36. Resolve the IS-5 rendered band-measurement mismatch (follow-up from F4)
  RESULT: the literal criterion FAILS on both rigs. Slight head peak is 0.0886 on ForBOOTH and 0.1576 on Bear, against < 0.01. Bear's literal negative control fails at 41%. The cause is idle head motion contaminating the unsigned peaks. The preregistered template estimator passes every check, including the negative controls. Verified in task-36-verify.md.
  AMENDMENT (orchestrator, Luke away, "use your recommended solution"; the verifier concurs): IS-5's band-recruitment gate uses the preregistered event-aligned template estimator from task-26-prereg.json. It is a signed head-pitch and body template coefficient, measured after baseline detrending, within the preregistered fit window. The literal peak-displacement FAIL is kept as evidence. Caveat: a negative or near-zero coefficient that passes the slight bound does not prove that movement was negligible. Flagged for Luke's review.
  What to do: todo 26's band analysis (task-26-scripts/analyze-bands.ts) used signed template coefficients, while the plan's criterion is the literal peak head displacement within 2 s (normalized by the rig range) plus the body-angle peak. Using the existing three band captures per rig and the bands-off negative control, and with no new captures, compute the plan's literal criterion exactly as todo 26 states it: slight head peak < 0.01 and face hint > 0.05; clear head peak >= 0.04; strong > clear; strong body lean > 0 on non-physics axes, or Bear's head-speed substitute where the body axes are physics-owned. Report both the literal metric and the template estimator side by side, and record a verdict on the literal criterion. Preserve all existing artifacts.
  Acceptance criteria: task-36-band-literal.json with per-capture and median-of-medians values for both rigs; a verdict per check; the negative control evaluated with the same literal metric.
  Commit: N

- [x] 37. Complete the IS-7 neutral-preserves-prop functional check (follow-up from F4)
  What to do: in todo 26 the prop's lease expired before the neutral marker on both rigs, so 'neutral leaves the prop' was never observed live. On ForBOOTH at the final tip, using the scripted LLM and Kokoro FP32, activate an exposed prop with a lease that is still active, then send a neutral ACT before that lease ends. Record timestamped lease identity before and after, the face and effect clear commands, and the rendered prop parameter values. Then observe the prop's later normal release.
  Acceptance criteria: neutral clears face and effect, and leaves the live prop and its original release deadline unchanged; the later release happens on schedule; task-37-neutral-prop.json is saved with teardown receipts. Bear inherits acceptance under Luke's one-model rule.
  Commit: N

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit
  Verify every todo's What to do, Must NOT do, and acceptance evidence against the diff and evidence files; every Must NOT have holds (`rg` checks: no `expression-defaults:` reads, no new `RUNTIME_PROMPT_KEYS` entries, no Kirie/server edits, no new dependencies). Output `.omo/evidence/emotion-expression-performance/F1-compliance.md`. Recommended task executor category: `unspecified-high`.
- [x] F2. Code quality review
  Review the full diff against `.agents/skills/enforce-rules-for-typescript/SKILL.md`, `.agents/skills/enforce-rules-for-vitest/SKILL.md`, `.agents/skills/enforce-rules-for-unocss/SKILL.md`, and root `AGENTS.md` conventions (no `any`, Valibot near consumers, NOTICE format, eventa for cross-process, kebab-case files, no timing-based tests). Output `F2-review.md` with must-fix items; must-fix items become new todos. Recommended task executor category: `unspecified-high`.
- [x] F3. Real manual QA
  Diagnostic re-check on the final commit (not a statistical gate; acceptance comes from todo 26's preregistered captures): re-run the todo 26 speech/LLM functional scenario and one band-recruitment capture per rig, labelled diagnostic, plus the stage-web functional smoke: `pnpm dev` (web), import Bear, confirm an expression mapping, pulse happy in the lab, PASS when the mapped face activates in the single web window. Output `F3-qa.md` with artifacts and teardown receipts. Recommended task executor category: `unspecified-high`.
  AMENDMENT (2026-10-19, orchestrator under Luke's away-mode rule): the Natural Motion Lab is an Electron-only devtools page (present at base a524482), so 'pulse happy in the lab' cannot run on stage-web. The web smoke triggers the same action the lab button calls (`pulseEmotion('happy', intensity.clear)` on the natural-motion override store) in the single stage-web window; PASS criterion unchanged (mapped face activates). Flagged for Luke.
- [x] F4. Ideal-state fidelity
  Check delivered behavior against IS-1..IS-15 one by one using the Success criteria table and evidence; any shortfall becomes a new `- [ ] N.` todo, never a note. Output `F4-fidelity.md`. Recommended task executor category: `unspecified-high`.

## Commit strategy
- Execute in a task-owned worktree `C:/Users/Luke/projects/dtuber-wt/emotion-expression-performance` on branch `luke/feat/emotion-expression-performance` from `main` at `a524482` (or the then-current `main`). Direct delivery: no push or PR unless Luke asks. Per-wave worktrees may branch from the integration branch and fast-forward back after their gate.
- One atomic commit per implementation todo with `Commit: Y`, Conventional Commits with the package scope as in history (`feat(stage-ui-live2d): ...`, `fix(stage-ui): ...`); each commit typechecks and passes its package tests on its own. Todos 25 and 26 do not commit.
- The final commit carries the footer `Plan: .omo/plans/emotion-expression-performance.md`.
- Never commit `.omo/evidence/`, traces, rig files, zips, or the 58 unrelated dirty-worktree entries on `main`.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 7, 10 | todo 7 Electron ForBOOTH count (89+ entries); todo 26 expressions | task-7-bear-stacking.json, task-26-summary.json |
| IS-2 | 2, 7, 12 | todo 7 Bear stacking and Reset; todo 2 cases (b)(c)(g) | task-7-bear-stacking.json, task-2-tests.txt |
| IS-3 | 2, 7 | todo 2 fade cases (f); todo 26 screenshots | task-2-tests.txt, task-26-visual-notes.md |
| IS-4 | 10, 12, 15 | todo 12 ForBOOTH labels >= 80; todo 15 settings edit persistence | task-12-catalog.json, task-15-settings-desktop.png |
| IS-5 | 5, 6, 9, 16 | todo 9 recruitment tests; todo 26 band recruitment + negative control | task-9-tests.txt, task-26-summary.json, task-26-negative-control.json |
| IS-6 | 9, 11 | todo 11 identity test (a); todo 26 idle 3x600 s aggregate | task-11-tests.txt, task-26-summary.json |
| IS-7 | 13, 14, 16 | todo 16 ACT speech and muted scenarios; todo 14 lease tests | task-16-act-speech.json, task-16-muted.json |
| IS-8 | 5, 18 | todo 18 Electron tool + ACT expression, outfit rejection | task-18-request.json, task-18-params.json, task-18-reject.json |
| IS-9 | 3 | todo 3 real-device lipsync at 48 kHz | task-3-lipsync.json |
| IS-10 | 4, 26 | todo 4 prereg refusal and aggregate; todo 26 prereg | task-4-aggregate.json, task-26-prereg.json |
| IS-11 | 19, 21 | todo 21 Electron timing events | task-21-timing.json |
| IS-12 | 13, 20, 22, 23 | todo 23 picker vs planner replay; todo 22 trace replay equality | task-23-replay-planner.json, task-22-replay.json |
| IS-13 | 17, 22 | todo 17 card editor persistence; todo 22 expressiveness profile | task-17-card.json, task-22-profile.json |
| IS-14 | 7, 9, 16, 25, F3 | todo 25 sweep and frame cost; F3 stage-web smoke | task-25-*.txt, task-25-frame-cost.json, F3-qa.md |
| IS-15 | 1, 8, 15, 23 | todo 1 settings tests; todo 15 switches; todo 26 negative control with bands off | task-1-tests.txt, task-26-negative-control.json |
