---
slug: natural-emotion-revamp
status: plan-written-review-blocked
intent: clear
review_required: true
plan_path: .omo/plans/natural-emotion-revamp.md
plan_sha256: 4b8113842a1d49506a6fd5fb8301e1c52d42c7b04988b48c4b799451c206527e
review_round_id: null
review_round_limit: 5
pending-action: write and review .omo/plans/natural-emotion-revamp.md
review:
  plan_reviewer:
    status: pending
    workspace_root: null
    runtime_home: null
    target: .omo/plans/natural-emotion-revamp.md
    round_id: null
    plan_sha256: null
    launch_id: null
    session: null
    result: null
approach: hybrid held-emotion state (decider holds + hold performer + Natural hold layer), recipes, posture bias, layer modulation, gesture clips, expression/preview link, per-model strength, +love/flustered/sleepy, docs, rendered QA
---

# Draft: natural-emotion-revamp

## Affected user and ideal state
Affected:
- (U1) Luke as viewer of the corner companion during chat, and as the person tuning a model in Settings and previewing expressions.
- (U2) The LLM, which consumes the emotion vocabulary via the prompt, ACT markers, and expression tools.
- (U3) Maintainers relying on Natural determinism, liveliness gates, and affect-trace replay.

Ideal-state rows:
- IS-1 | Each emotion reads unmistakably on the whole face at corner size, even when the rig's stamps are decoration-only | the reported defect
- IS-2 | The emotional face holds while the emotion is active (lease/turn), then eases out with a faint mood afterglow; no snaps | a corner vtuber stays in a state
- IS-3 | A stamp mapped to an emotion never shows on a neutral face, on any path (LLM tool, ACT, auto pick, Settings preview toggle) | the reported preview mismatch
- IS-4 | The body takes part: a held posture bias (small at clear, larger at strong) and emotion-shaped gestures with bounded variation and cooldowns instead of one uniform nudge | movement should feel alive, not robotic
- IS-5 | Gaze, blink, breath, idle energy, and speech-nod size reflect the held emotion | a whole-body state, not a face sticker
- IS-6 | New emotions (love/flustered, sleepy) are available to the LLM and performed in Natural | owner decision
- IS-7 | One strength slider per emotion per model; 0 disables that emotion's Natural performance | owner decision
- IS-8 | With no emotion active, Natural idle is bit-identical and the liveliness gate stays green; Universal/MAGIC keep existing behavior, and new names map to sensible fallbacks | no regression
- IS-9 | Emotion switches glide (happy to sad), same-emotion accents do not saturate, and pet/poke compose sensibly with a held emotion | no fighting layers
- IS-10 | Affect traces still parse and replay; seeded Natural stays reproducible | maintainers' tools keep working
- IS-11 | ADR and READMEs describe the new contract and explicitly supersede the old non-goals ("no gesture library", "only the Energy slider") | docs match code

Gap rows:
- GAP-1 (IS-1) recipes are weak hints, about 20% of half-range
- GAP-2 (IS-2) the face hold is a fixed 1.2-1.8 s and nothing tells Natural a lease's lifetime
- GAP-3 (IS-3) expression signals and manual toggles emit no episode or hold
- GAP-4 (IS-4) no held posture; the clear-band body is pinned at 0 by tests; there is one pulse shape per emotion
- GAP-5 (IS-5) no hooks for blink, breath, sustained energy, per-emotion gaze, or nod size
- GAP-6 (IS-6) the vocabulary is closed in about 12 places
- GAP-7 (IS-7) no per-model per-emotion setting
- GAP-8 (IS-8) the new layers must draw nothing on the idle path
- GAP-9 (IS-9) composition is purely additive; pet adds on top
- GAP-10 (IS-10) PerformanceDecision has no holds; fixtures use toEqual
- GAP-11 (IS-11) the ADRs contain contradicting non-goals
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

## Components (topology ledger)
- C1 | emotion vocabulary + consolidated per-emotion table (natural-motion/emotions.ts) | active
- C2 | decider holds (HoldCommand) + expression signal derives episode+hold from primary mapping | active
- C3 | EmotionHoldPerformer (lease reuse) + conductor/scene/Model plumbing, incl. manual-toggle hold source | active
- C4 | Natural hold layer: face recipes, posture bias, layer modulation (gaze/blink/breath/energy/nods), composition order | active
- C5 | Natural gesture clips (stream 12, cooldowns, variation) | active
- C6 | per-model per-emotion strength setting + UI + i18n | active
- C7 | docs/ADR + rendered QA on ForBOOTH | active
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)
- Every emotional exp3 on both rigs drives one switch parameter only (ForBOOTH expression1 Angry=Param60, Crying Eyes=Param13, Hearts=Param47, Blush=Param85; Bear anger=Param9, cry=Param12, love=Param95, red=Param97). None move brows, eyes, or mouth. Verified by a read-only script over the rig folders on 2026-10-19.
- Natural emotion = impulse only: packages/stage-ui-live2d/src/composables/live2d/natural-motion/impulses.ts:57-66 (per-emotion head direction + hints; angry browY -0.4, browAngle -0.4, mouthForm -0.3 x strength). Face hold/release per band: packages/stage-shared/src/expression-performance/settings.ts:72-74 (slight 0.6/0.35, clear 1.2/0.5, strong 1.8/0.7 s).
- Hints are added as fractions of half-range in natural-motion-adapter.ts composeFace (offset * (max-min)/2), face channels listed at natural-motion-adapter.ts:73-83; rig-profile.ts:1-22 channel ids.
- Mood (natural-motion/mood.ts) is dimensional (valence/arousal/tension), modulating posture amplitude/shift rate, camera fixation, emphasis (natural-motion.ts:328-333), and only mouthForm on the face (natural-motion.ts:430).
- The pet layer (natural-motion/touch.ts:25, :67-113) is an existing held face with attack/release, the pattern for a held emotion face.
- picker.ts:32-40: an 'expression' signal emits only a slot command and no episode, so a directly requested stamp never gives Natural an emotion.
- Both rigs have the standard face params (ParamBrowLY/RY, LAngle/RAngle, LForm/RForm, EyeL/RSmile, EyeL/ROpen, MouthForm). Only Bear has ParamCheek.
- No recorded emotional reference: Luke's VTS recordings are quiet desk work.
- [explore st_01a153c9] Test commands:
  - `pnpm -F @proj-airi/stage-ui-live2d exec vitest run` (node + browser projects; packages/stage-ui-live2d/vitest.config.ts:7-25)
  - `pnpm -F @proj-airi/stage-shared exec vitest run` (node only)
  - `pnpm -F @proj-airi/stage-ui exec vitest run --project node|browser <path>`
  Seeded RNG lives in natural-motion/random.ts. The baseline failures in .omo/slop/report.md:46-49 should be re-baselined.
- Lab emotion pulses: packages/stage-ui/src/features/devtools/motion/natural/components/emotion-pulses.vue:13-49 drive each EMOTION_VALUES entry at a band nominal, through the same conductor route (Stage.vue:465-469). Usable for rendered QA of every emotion.
- Rendered QA conventions:
  - Isolated Electron with APP_USER_DATA_PATH, CDP, and temporary rig ZIP imports (.omo/plans/emotion-expression-performance.md:87-97, :568-582; live2d-presence-v1.md:352-382).
  - Post-physics 30 Hz trace capture (live2d-presence-v2.md:600-635).
  - Evidence goes to .omo/evidence/<slug>/task-N-*.
- Docs to update:
  - packages/stage-ui-live2d/README.md (Natural layers, emotions by band, Mood, Natural QA)
  - packages/stage-shared/README.md
  - docs/ai/adr/2026-10-18-expression-performance.md:107-163, :382-404
  - i18n: en/settings.yaml:205-243, :300-355; en/tamagotchi/settings.yaml:230-273; en/base.yaml:41-50, :64-78 (emotion names)
- [explore st_01a153c7] Layer hooks:
  - Existing: posture amplitudeScale/shiftRateScale (posture.ts:51-69,108-111), gaze cameraFixationProbability plus glance (gaze.ts:53-58,149-164), speech-emphasis acceptance only (speech-emphasis.ts:68-84).
  - No hook: blink rate/timing (blink.ts:8-56, internal constants), breath period/amplitude (breath.ts:5-58), energy sustained state (energy.ts:60-139, transient react only), body coupling (body.ts:5-65), posture home/baseline offset, gaze target weights per emotion, emphasis pulse size.
  - Mood applied at natural-motion.ts:321-334.
  - Face composition at natural-motion.ts:415-432; adapter clamps and skips clip-owned ids (natural-motion-adapter.ts:338-355); eyelid floor 0.2 and expression-closed lids preserved (:92-106).
- Emotion vocabulary surfaces:
  - Shared enum stage-ui-live2d/src/constants/emotions.ts:1-47 (EMOTION_VALUES, motion-group map, VRM map). It feeds Universal motion matching (Model.vue:430-434), MMD (stage-ui-mmd constants/actions.ts, morphs.ts plus an exhaustive test), Spine (stage-ui-spine constants/emotions.ts:56-66), and VRM (stage-ui constants/emotions.ts:37-47).
  - Performance: types.ts:4-12, catalog.ts:15-18, reaction-strength.ts:49-51, trace.ts:7-14, mood.ts:5-15, impulses.ts:57-66.
  - ACT: pipelines-audio llm-streaming-control/payloads.ts:6-53, Stage.vue:343-368 toStageEmotionPayload, conductor use-stage-performance-conductor.ts:193-198 (validates against EMOTION_VALUES).
  - Prompt list generated from EMOTION_VALUES (use-airi-runtime-prompt.ts:50-54); i18n base.yaml:33-64 prompt copy.
  - i18n labels settings.yaml:322-330; mapping picker live2d-expression-entry.vue:41-43,234-236.
  - Tests: impulses.test.ts:48-53 iterates EMOTION_VALUES; payloads tests.
- Band-isolation tests that must change for the clear-band body decision: natural-motion.test.ts:13-42 (body 0 unless strong), :44-87 (mood-matched control), impulses.test.ts:34-46, :101-114.
- [explore st_01a153c8, partly corrected] Decision path:
  - ACT cues: Stage.vue:371-383, queued at :300-319, then conductor.emotion/expression.
  - The conductor resolves profile moodGain and dispatches scene.setEmotion and scene.applySlots (use-stage-performance-conductor.ts:427-433, 472-498). Scene surface: Live2D.vue:158-164. Model.vue queues Natural episodes and sends slots/speech to the expression store (Model.vue:162-165, 1365-1370).
  - Slot leases: hold vs speech chosen in selection.ts:104-113; lifecycle in slots.ts:17-96; release in expression-store.ts:200-210; fades in compose.ts:37-88; ticking in expression-controller.ts:64-79.
  - Natural receives no lease lifetime or release signal (the conductor scene interface has setEmotion only, :67-73).
  - Picker and planner both emit only a slot command for expression signals (picker.ts:30-38, planner.ts:91-106). Explicit expressions ignore mappings (selection.ts:104-113).
  - LLM tool: stage-ui/src/tools/expression.ts:52-76, via conductor.expression(...,'tool') (use-stage-performance-conductor.ts:220-233, 501-569).
  - Preview toggle: live2d-expression-entry.vue:173, then live2d.vue:87-98, then the remote emit or expressionStore.applySettingsCommand (manual ownership, expression-store.ts:125-153, 323-340); it bypasses the conductor.
  - Lead-verified correction: the remote consumer exists. apps/stage-tamagotchi/src/renderer/pages/settings/models/index.vue:388 (@live2d-expression-command) leads to stage window apps/stage-tamagotchi/src/renderer/pages/index.vue:359 expressionStore.applySettingsCommand; Kirie mirrors this. So preview lands in the stage window's expression store.
  - Trace: expression signals are already in the trace schema (trace.ts:12-19); trace tests have no expression fixture (trace.test.ts).
  - Mappings: catalog.ts:11-46; auto selection in selection.ts:45-99; profile weight multipliers in profile.ts:67-74.
- Design implication (lead): all expression activations (preview/manual, LLM/ACT slot, auto slot, rest set) converge in the stage renderer's expression store and composer, the same renderer as Natural. Natural can derive held emotion from the composed weights of active mapped expressions, getting lifetime and fades for free, plus an episode-held state for emotions without a stamp.
- Settings: the performance document is global (stage-ui features/performance/settings.ts:12-27, key settings/expression-performance) and has no numeric sliders in the UI (live2d.vue:892-935). Per-model persistence exists as expression-catalog:${modelId} and expression-rest:${modelId} (stage-ui-live2d/src/stores/expression-store.ts:84-107, :278-284). Per-character profiles live on cards (ADR :364-375).

## Decisions (with rationale)
- [owner 2026-10-19] Natural mode only; Universal/MAGIC unchanged.
- [owner] Process: ulw-plan, then ulw-execute.
- [owner] A held posture bias is allowed at clear (small), larger at strong. This overturns the eep rule "clear keeps body at 0".
- [owner] Held faces exaggerated: roughly 50-70% of range at clear, near full at strong.
- [owner] Add emotions love/flustered and sleepy; dizzy is not added.
- [owner, from discussion] An expression mapped to an emotion triggers that emotion's performance on every activation path (LLM tool, ACT marker, preview), regardless of exposedToLlm; with multiple mappings, use the highest-weight one.
- [owner, from discussion] Tuning surface: one strength slider per emotion per model; no per-parameter recipe editor.
- [owner 2026-10-19] Two new emotions, love and flustered, plus sleepy (three new names total). Hearts stamps map to love, blush stamps to flustered. Fallbacks: love->Happy, flustered->Awkward, sleepy->Idle.
- [owner] Preview: turning a mapped stamp on via the manual toggle holds its emotion while it is on. Saved rest-set expressions never drive an emotion.
- [owner] Test strategy: tests-after within each todo + agent-run rendered captures of every emotion on ForBOOTH at corner size (one-rig rule), then Luke's QA.
- [swept] Budget: none (local code). Stack: fixed (existing Vue/TS/pixi-live2d). Scale: n/a. Audience: personal fork. Risk dirty_worktree: resolved 2026-10-19. On Luke's request the main checkout was committed in four commits (0c2b567 agent config, 37d1268 design-doc links, 0096d06 ignore .omo run state, 961253b earlier plans/drafts). Junk files `nul` and a 22-byte zip stub were deleted, and the 5 MB session HTML was moved to C:/Users/Luke/Documents/omo-sessions/. The plan worktree now branches from main containing 961253b.
- [default, announced] Afterglow: the hold ends with its lease; the existing mood carries a faint afterglow.
- [default, from architect st_01a153ca, verified against cited lines] Hybrid hold: the pure decider emits HoldCommand {emotion|null, strength, holdSeconds, until, turnId} next to episodes (clock-free, replayable). A stage-ui-live2d EmotionHoldPerformer reuses slots.ts lease functions with the same speech/mute fan-out. Natural receives held state via attention, like pet (setHeldEmotion), not a duration. Turnless holds use settings.hold.turnlessSeconds of about 4 s.
- [default] Composition priority: clip mask/physics > pet (lerp by level) > hold > accent (same-emotion accent scaled by 1-k*holdLevel, k about 0.5) > mood > idle. Hold posture bias feeds the body follower (clear band allowed); gestures are excluded from the follower except the strong-band body term.
- [default] Gestures are pure shape functions in a data table on a new RNG stream index 12; they trigger on grid, use per-gesture cooldowns, and call posture.postponeShift for long clips. Sustained droop/tilt belong to the hold, not to gestures.
- [default] Strength slider: Live2D per-model setting settings/live2d/natural-emotion-strength Record<modelId, Partial<Record<emotion, 0..2>>>, default 1, following natural-touch-head-scale (live2d.ts:19, live2d.vue:167-169). Applied performer-side only, so traces are unchanged.
- [default] Universal/MAGIC/VRM/MMD/Spine fallbacks for new names: love->Happy, flustered->Awkward, sleepy->Idle (VRM relaxed).
- [default] LLM clear with no slot releases the hold; clear(face) keeps it.
- [default] Wave order: W0 vocabulary/table consolidation/contracts serial; W1 parallel decider, hold performer, hold layer, gestures, settings UI; W2 integration; W3 docs/QA.

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Approval gate
status: approved (Luke, 2026-10-19, "Approve")
approach: hybrid hold (decider HoldCommand + EmotionHoldPerformer + Natural held-state layer) with recipes, posture bias, layer modulation, gesture clips, expression/preview link, per-model strength setting, vocabulary +love/flustered/sleepy, docs/ADR, rendered QA on ForBOOTH.
next: on approval, scaffold the plan, run plan-consultant, append todos, then run plan-reviewer rounds (max 5).
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Plan generation log
- 2026-10-19: plan written to .omo/plans/natural-emotion-revamp.md (12 todos, F1-F4, 677 lines, sha256 4b811384... (revised base commit)). Structural self-check passed: rows column-zero, categories present, TL;DR first, no impl rows outside Todos.
- The plan-consultant spawn was refused by the harness plan-gate: it did not register Luke's question-menu choice as an explicit ulw-plan request. Self gap analysis was done instead. Non-blocking notes:
  (1) Expression-derived nominals are not scaled by the character profile expressiveness (the conductor scales only emotion nominals); acceptable, documented in todo 4 scope.
  (2) An ACT cue with emotion+expression yields two episodes in sequence; the second escalates or replaces through acceptReaction.
- plan-reviewer is likewise gated. Waiting for Luke to unlock it by requesting the review or the ulw-plan workflow in his own words.
