---
slug: emotion-expression-performance
status: plan-complete
intent: clear
review_required: true
plan_path: .omo/plans/emotion-expression-performance.md
plan_sha256: 534df85de9739f9311d687588b36316ef34b4035a267ac3bcebb6b6f30205c1a
review_round_id: r5-mvdmblim
review_round_limit: 5
phase: review_round_initialized
round_status: cap_reached
pending-action: review .omo/plans/emotion-expression-performance.md
review:
  plan_reviewer:
    status: changes_requested
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/emotion-expression-performance.md
    round_id: r5-mvdmblim
    plan_sha256: 5220593bb2f26e24be8045070903e796ab58fd288ad7fbcde1421225981afa3e
    launch_id: L5-r5-mvdmblim
    session: st_01a14e52
    result: null
approach: "One plan, 26 todos in waves 0-7 per architect design B (see plan Execution strategy): W0 core types/settings, composition math, 48 kHz lipsync, multi-capture rule, ACT bands; W1 reaction strength, exp3 runtime rewrite, settings store, Natural bands, catalog derivation; W2 mood, catalog persistence, picker, slots; W3 settings UI, conductor, card profiles; W4 LLM access, sentence identity, affect traces; W5 timing events + scheduler; W6 trace/profile hookups, planner; W7 docs/ADR, regression sweep, rendered acceptance; then F1-F4."
---

# Draft: emotion-expression-performance

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

Affected users:
- U1 Luke as viewer: the character sits in a screen corner (Electron stage-tamagotchi) while he games and chats with a local LLM; today emotions show only as small Natural impulses that look the same at every intensity, and no rig expression fires automatically.
- U2 Luke as model setup user: imports Live2D rigs (ForBOOTH 89 exp3 named expression1..89; Bear 27 named) and wants to map expressions to emotions once, quickly, without breaking outfits/props/watermark.
- U3 The LLM: reads the runtime ACT prompt and calls runtime tools; today it can only emit ACT emotion name/intensity and has no usable expression access (raw-param tools are unwired).
- U4 Future executor/programmer: later phases (timing slots, planner, character profiles) must plug into seams without rewriting performers; A/B comparisons must stay tractable (shuka lesson).

| IS | Ideal-state property | Reason |
|---|---|---|
| IS-1 | Every .exp3.json shipped in an imported model is discoverable and usable, whether or not model3.json references it | ForBOOTH model3 references 2/89, Bear 0/27 |
| IS-2 | Expressions stack: activating, deactivating, fading, or auto-triggering one expression never changes another active expression's contribution; explicit-zero Add entries are no-ops; reset returns to the saved rest set (watermark stays hidden) | Today activating Bear eat zeroes game params; deactivation resets shared params; resetAll uses modelDefault |
| IS-3 | Expressions fade in and out (file FadeInTime/FadeOutTime when present, defaults otherwise) | Today they pop |
| IS-4 | Setup is fast and safe: labels imported from VTube Studio hotkeys, kind and pick-one groups suggested, user confirms with preview; unconfirmed/unmapped expressions never fire automatically or reach the LLM | 89 opaque names; outfits must never be auto-triggered |
| IS-5 | Emotion strength is visibly distinct: slight / clear / strong are distinguishable blind in Natural via body-part recruitment and timing; missing intensity means clear; repeated emotions habituate; stronger repeats escalate | Today intensity only scales amplitude, default 1 |
| IS-6 | Emotions leave a decaying mood afterglow that is exactly identity at rest, so idle motion and its gates are unchanged | Continuity without regressing v2 idle acceptance |
| IS-7 | Emotions trigger mapped faces/effects with variety (weighted, band-gated, recency-penalized); one face slot + one effect slot; lifetimes follow speech chunks; neutral clears only those slots; outfits/props/system untouched | Core exp3 feature |
| IS-8 | The LLM can deliberately use exposed expressions by label via an optional ACT `expression` field and a curated `set_expression` tool executed in the stage renderer; it never sees raw parameter ids or non-exposed kinds | Direct LLM access, safe |
| IS-9 | Lipsync and Natural speech emphasis work on Luke's 192 kHz output device | wlipsync WASM set_input fails at 192 kHz |
| IS-10 | Rendered acceptance gates are statistically reliable via preregistered multi-capture rules | Single 600 s captures proved noisy (v3 item 4) |
| IS-11 | Performances can be scheduled into timing slots (sentence_start, pause, utterance_end, emphasis) derived from speech events | Planner prerequisite |
| IS-12 | A planner replaces the picker behind the same decision seam with no performer changes; deterministic under seeded RNG; tunables in one settings object; golden-trace A/B comparison | Avoid shuka's untestable planner |
| IS-13 | A per-character profile (card) overrides a bounded set of settings and re-weights model mappings; synced with the card; edited in the card editor | Characters sharing a model behave differently |
| IS-14 | Nothing regresses: Universal/MAGIC motion paths, VRM/MMD/Spine/Tachie emotion routing, existing expression settings panel and cross-window snapshot, speech playback, Natural idle gates | Existing users |
| IS-15 | Each feature has one on/off switch; no per-LLM/provider configuration; no dead tunables | A/B-ability |

| GAP | Difference from today | Reason / evidence |
|---|---|---|
| GAP-1 | Model.vue:679-704 loads only settings.expressions although live2d-zip-loader.ts:56-70 already collects every exp3 into settings._expFiles | IS-1 |
| GAP-2 | expression-store.ts keeps one value per parameter; toggle/set write zeros over shared params, deactivation resets to modelDefault, resetAll ignores saved defaults | IS-2 |
| GAP-3 | expression-controller.ts:29 ignores FadeInTime/FadeOutTime | IS-3 |
| GAP-4 | No catalog: no labels, kinds, groups, mappings; no .vtube.json import; settings list raw exp names; LLM exposure only all/none/custom flags | IS-4 |
| GAP-5 | payloads.ts normalizeIntensity maps missing/invalid to 1; impulses scale amplitude only; dedupe drops escalations; no words, habituation | IS-5 |
| GAP-6 | No mood state; energy.react(at) is a fixed 2 s overlay without intensity (natural-motion.ts:313-334, energy.ts:29-34) | IS-6 |
| GAP-7 | No emotion->expression path; Stage.vue:270-300 routes Live2D emotions to Natural impulses or motion groups only | IS-7 |
| GAP-8 | expression-tools.ts is unwired, exposes raw parameter ids and save/reset, and would run against an empty chat-window store; ACT has no expression field; prompt lists no expressions | IS-8 |
| GAP-9 | Shared AudioContext (stores/audio.ts:67-69) runs at device rate; wlipsync WASM set_input fails at 192 kHz | IS-9 |
| GAP-10 | Rendered gates use single captures; only Bear still2 has a 3-capture median rule (v2 todo 24) | IS-10 |
| GAP-11 | No slot scheduler; Stage.vue onPlaybackStart uses only clip text (SpeechClip has id + text, response.ts:20-23); onSpecial carries only the token | IS-11 |
| GAP-12 | No decision seam; emotion routing and motion fallbacks are hard-coded in Stage.vue | IS-12 |
| GAP-13 | AiriExtension modules have no performance block; no editor section | IS-13 |
| GAP-14 | Changes touch Stage.vue, Model.vue, expression store/controller, payloads, Natural; regression surfaces have partial coverage | IS-14 |
| GAP-15 | Natural and impulse tunables are scattered module constants; no feature switches for bands/mood/auto-expressions | IS-15 |

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
| id | outcome | status |
|---|---|---|
| A | Expression system: full exp3 discovery, per-expression composition with fades, catalog + mapping UX | active |
| B | Emotion performance: ACT bands, habituation/escalation, Natural recruitment/timing, mood | active |
| C | Decision seam + picker + slots, LLM expression access (ACT field, tool, feedback) | active |
| D | Prerequisites: 192 kHz lipsync fix, multi-capture acceptance rules | active |
| E | Scheduling: timing slots on speech events, planner behind the seam | active |
| F | Per-character performance profiles | active |

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->
| assumption | adopted default | rationale | reversible |
|---|---|---|---|
| Band vocabulary | `slight` / `clear` / `strong` (0.25/0.6/0.9); bands slight (0,.5), clear [.5,.8), strong [.8,1]; missing or invalid -> clear (0.6) | User agreed to words in discussion; LLMs pick words reliably | yes |
| Architecture | Architect design B: pure core in packages/stage-shared/src/expression-performance (schemas, bands, settings, profile merge, decider), pure composition in stage-ui-live2d, conductor composable in stage-ui, existing model-settings-runtime eventa for cross-window | Renderer-neutral, replayable decider; existing transport | yes |
| Catalog storage | Derived catalog recomputed per load; curated overrides in localStorage `expression-catalog:${modelId}` (Valibot-validated); no sidecar export | modelId is a persisted display-model id; ZIP/OPFS is read-only | yes |
| Mapping ownership | Emotion mappings live in the model catalog; character profiles re-weight them | Characters sharing a model; additive later | yes |
| Driver coverage | Expression triggering works under every Live2D motion driver; bands/mood/recruitment are Natural-only; Universal/MAGIC motion-group behavior and other renderers unchanged | Expressions apply in the final plugin independent of driver | yes |
| Fade defaults | Filled from ultrabrain lane (see Decisions) | Files define no fades | yes |
| Planner scope | Arbitrates impulses and slot expressions with budgets/cooldowns/recency and continuity memory, schedules into timing slots; no gesture library, no dataset scaling | AIRI has no gesture primitives; shuka lesson | yes |
| Character profile fields | Bounded sparse override of the settings schema (<=8 fields) plus mapping re-weights at extensions.airi.modules.performance | Avoid tunable sprawl | yes |
| Multi-capture rule | Preregistered 3 captures per rendered gate, median per metric, any hard failure in any capture fails | Generalizes v2 todo 24 precedent | yes |
| Test strategy | Tests-after per todo with regression tests that fail before the change (repo standard) plus agent-executed QA | Repo keeps Vitest suites for these modules | yes |
| Kirie | apps/stage-tamagotchi-kirie untouched | Separate migration scope (root AGENTS.md) | yes |

## Findings (cited - path:lines)
Full exploration notes: notepad H:/llm/ollama/tmp/ulw-20261018-044349.6oyYbH.md. Key verified facts:
- ACT timing with speech on: tts-chunker.ts:127-171 yields text before a marker as a chunk carrying the special, or a special-only segment; speech-pipeline.ts:139-179 emits onSpecial after waitForPlayback of the preceding chunk, before the following chunk plays. Muted: immediate dispatch Stage.vue:598-603. Chunk granularity min 4 / max 12 words.
- Tools execute between model steps (core-agent chat-completions.ts:95-108); runtime tool executors run in the leader stage renderer (apps/stage-tamagotchi/src/renderer/App.vue:108-145); runtime tool store pattern apps/stage-tamagotchi/src/renderer/stores/tools/home-assistant.ts, stage-ui stores/ai/chat-llm/tools.ts:33-78, tool-resolver.ts:151-182.
- Natural modulation seam: natural-motion.ts:268-334 (energy assigns posture/gaze knobs per step; startPending calls energy.react(at) without intensity); impulses.ts:55-207; energy.ts:20-123.
- wlipsync@1.3.1 dist/audio-processor.js calls WASM set_input(sampleRate); no rate option; shared AudioContext stage-ui stores/audio.ts:67-69 has no sampleRate.
- Character card modules: stage-ui types/airiCard.ts:11-69, airi-card.ts getModules :916-960, editor CardEditor.vue :330-339/:653-685, sync per-module field card-fields.ts:45-70.
- Rig exp3 structure: memory reference/projects/dtuber-live2d-rigs.md (all Add, no fades; Bear exclusive sets; VTS hotkeys label 80/89 and 30/27).
- Shuka planner mechanics and A/B pitfalls: notepad (st_01a14e36).
- Dirty worktree: 58 unrelated entries on main a524482 (agent config/skills, AGENTS.md files, a stray `nul`, a ForBOOTH zip path); dirty_worktree risk, out of scope.

## Decisions (with rationale)
- Topology: six components A-F (see ledger), all active; one plan per the user's request for the entire group.
- Seam (architect, adopted): AffectSignal -> Decider(signal, ctx, state) -> PerformanceDecision {impulses, slots}; deciders never read clocks, randomness sources other than a seeded stream in state, Pinia, or parameter ids; performers never read signals. Mood/habituation live in Natural (performer-internal), decider stays replayable.
- ACT expression timing uses existing speech ordering: markers fire at chunk boundaries before following text (verified). Slot lifetime (final, plan todo 14): speech leases hold while clips play and release at max(activation+hold, lastClipEnd+grace) after turn end, immediately on interrupt or replacement, hard cap 15 s; muted releases after hold; props use the same lease as a third slot; neutral clears face and effect only.
- LLM tool executes in the stage leader renderer via the runtime tool store; Electron uses the existing model-settings-runtime eventa owner guard; delete expression-tools.ts.
- Ultrabrain specs adopted (st_01a14e32; constants are defaults, tunable only through the settings object):
  - Composition: per parameter start from a fresh frame base b; visit instances by activation sequence: Add x+=v*w; Multiply x*=1+(v-1)*w; Overwrite x+=(v-x)*w; skip w=0, Add 0, Multiply 1; clamp once. Fade w(t)=w0+(target-w0)*S(u), S=(1-cos(pi u))/2; FadeIn/FadeOut from exp3, absent/invalid -> 1 s (Cubism default), 0 -> immediate; reactivation reverses from current weight; pick-one activation fades others out. Saved defaults = set of active expression ids; reset cancels transient leases and targets the saved set. Frame-base ownership: expression-owned params need an uncontaminated base each frame (track lastWritten/lastBase; if the param still equals lastWritten nobody rewrote it, reuse lastBase) - test 1,000 frames without accumulation and blink preservation under Multiply.
  - Bands: words slight .25 / clear .60 / strong .90; missing/invalid -> .60; bands slight (0,.5), clear [.5,.8), strong [.8,1]; habituation h=max(.35,.8^n) for n same-emotion episodes in prior 15 s; jitter +-.04 clamped in band; different emotion (incl. neutral) clears history; within 2 s stronger repeat escalates (max, reuse h/u/direction), equal/weaker ignored.
  - Natural bands: slight = face only (onset .14, hold .6, release .35); clear = + head (tau .38, overshoot .08) + glance (onset .10, hold 1.2, release .5); strong = + body lean (.06 I, physics-owned axes never written) + energy.react(at, I) (amp 1+.3R, rate 1+.5R, 2 s, nonstacking) (onset .07, head tau .24, overshoot .16, hold 1.8, release .7). Head gain .12 I^.7 kept. Escalation adds delta pulse only.
  - Mood {valence, arousal, tension}, taus (45,20,30) s, dose gBand(.15,.25,.40)*I*cEmotion (table in ultrabrain output, copied into plan), modulations amp*(1+.2a) [.8,1.2], rate*(1+.3a) [.7,1.3], camera p+.1v-.15t, emphasis q+.1a, mouthForm +.08v; zero mood bypasses modulation and consumes no randomness (seeded idle traces unchanged).
  - Picker: mappings {expressionId, emotions[], slot face|effect, weight 1, minBand}; default minBand: face = clear, effect = strong (planner adjustment of ultrabrain default 3 for faces so clear emotions show faces); recency W=weight*(1-.8 exp(-age/8)); face gate 1, effect gate clamp((I-.5)/.3,0,1); seeded dedicated streams appended after natural stream index 11; fixed ticket draws per episode.
  - Slot lifetimes: lease keyed by speech identity; audible speech: activate at matching playback start (or immediately if playing), release at max(activation+bandHold, segmentEnd+.25) then fade-out; interrupt/cancel releases now; muted: activate now, release after bandHold; unstarted requests expire after 10 s.
  - Timing slots: sentence_start (first playback start per sentence id; requires sentence metadata added to TextSegment upstream), pause (segment end + .18 s silent, utterance incomplete), utterance_end (once, after synthesis+timeline drain), emphasis (voice onsets from speech-emphasis.ts constants, refractory 1.2 s). DecisionScheduler schedule/take/cancel; priority > intensity > insertion.

## Scope IN
Components A-F; docs (package READMEs, docs/assets/ai/context/ui-components.md if shared component APIs change, new ADR in docs/ai/adr/), English i18n strings, tests beside touched modules, rendered QA on ForBOOTH and Bear.

## Scope OUT (Must NOT have)
- Per-LLM/provider profiles or alias tables; gesture primitive library; dataset-scaled tunables; more than one settings document.
- Changes to Universal/MAGIC motion-group behavior, VRM/MMD/Spine/Tachie emotion handling beyond passing the existing intensity.
- apps/stage-tamagotchi-kirie, server/, hosted services.
- Writing into model folders/archives; new npm/Python dependencies.
- Non-English locale edits; the 58 unrelated dirty-worktree entries.
- v3 items 1-3 (jitter scoring, tail gate, Universal parity) beyond the multi-capture rule.

## Open questions
Owner-decisions to ask at the gate (batch renderer):
1. LLM expression permissions: faces+effects only (default) vs also props vs everything exposed.
2. Saved expression defaults format change: temporary NOTICE migration from `expression-defaults:${modelId}` (default) vs drop old key and re-save once.
3. Lipsync fix: shared AudioContext fixed at 48 kHz (default) vs 48 kHz only when the device rate exceeds 96 kHz.

## Approval gate
status: approved (2026-10-18, Luke chose Approve with review)
Owner decisions: LLM may trigger exposed faces, effects, and props (never outfits/system); saved defaults format change = drop old `expression-defaults:${modelId}` key with no compatibility code (watermark reappears once until re-saved); lipsync fix = shared stage AudioContext always 48000 Hz.
previous status: awaiting-approval
next action: on Approve -> scaffold plan (no --draft-only), plan-consultant, append todos, TL;DR last, structural self-check, plan-reviewer rounds (<=5)
stance: batch renderer (v2 planning session: Luke chose the recommended option on every fork; memory reference/projects/dtuber-presence-execution.md)
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->

## Plan-consultant round 1 (st_01a14e3f) - folded
- Thresholds reconciled to .5/.8; lifetime rule unified (todo 14); props get a third lease slot; stateFeedback added to IS-8 (todo 18 defines it); IS-14 reworded (panel keeps working with new commands; stage-web and desktop reactions added); package.json exports edits authorized (todos 1, 18); no new RUNTIME_PROMPT_KEYS (verified use-airi-runtime-prompt.ts:6-23 blanks prompt when a key is missing); OPFS-restored path must provide _expFiles/_vtubeData (verified live2d-opfs-registration.ts:5-14 inserts OPFS check before ZipLoader); mic capture uses its own 16 kHz context (verified audio-device.ts:16-25) - 48 kHz risk limited to MobileInteractiveArea analyser on Firefox, recorded for ADR; desktop reactions energy path guarded (todo 9); trace recorder/replayer = todos 20/22; dynamic prompt + tool re-registration = todo 18; frame cost measured in todo 25 (not a timing test); blind discrimination replaced by seeded recruitment metrics (todo 9) + rendered trace analysis (todo 26); LLM QA via scripted OpenAI-compatible server.

## Self-review (plan written 2026-10-18T09:13:44.204Z)
Structural self-check script: 26 column-zero impl rows 1..26 in ## Todos, F1-F4 in ## Final verification wave, every todo has What to do / Closes / Parallelization / References / Acceptance / QA happy+failure with evidence path / category / Commit; first heading TL;DR. errs: [].
| GAP | Closed by todo(s) |
|---|---|
| GAP-1 | 7 |
| GAP-2 | 2, 7, 12 |
| GAP-3 | 2, 7 |
| GAP-4 | 10, 12, 15 |
| GAP-5 | 5, 6, 9 |
| GAP-6 | 9, 11 |
| GAP-7 | 13, 14, 16 |
| GAP-8 | 5, 18 |
| GAP-9 | 3 |
| GAP-10 | 4 |
| GAP-11 | 19, 21 |
| GAP-12 | 1, 13, 16, 20, 22, 23 |
| GAP-13 | 17, 22 |
| GAP-14 | 16, 24, 25 |
| GAP-15 | 1, 8, 15 |
Every IS-1..IS-15 row has delivering todos and a proving scenario in the plan's Success criteria table.

## Review ledger
- Round 1: round_id r1-mvdlyxak, sha 5ab6ed7f...3221, session st_01a14e49, result changes_requested (REJECT). Accepted blockers (ledger frozen): B1 Universal/MAGIC routing must stay independent of episode filtering incl. repeats and neutral (IS-14) -> todo 16; B2 speech identity for markers before playback + replayable deadline for expiry (IS-11/12) -> todos 1, 21, 23 (turnId identity, nextDeadline + deadline signal); B3 trace replay equality across buffer rollover and context changes (IS-12) -> todos 1, 6, 13, 20, 22 (JSON-serializable decider state, checkpoint + context entries, explicit recording session). Non-blocking notes: none.
- Round 2: round_id r2-mvdm2y03, sha 75dbf3b0...328a, session st_01a14e4c, result changes_requested (REJECT). B1-B3 not re-raised (accepted as fixed). New eligible findings accepted: B4 intermediate commits break consumers (explicit commit rule) -> todo 7 deletes expression-tools, todo 9 updates Stage.vue call sites, ownership rule updated; B5 cross-decider comparison needs its own initialization and deadline synthesis (IS-12) -> todo 20 exact/compare modes + endAt, todos 22/23 use modes; B6 band recruitment single capture contradicts multi-capture rule (IS-10) -> todo 26 3 captures + aggregation, negative control 3 captures, todo 4 scopes the rule to statistical trace gates, F3 diagnostic.
- Round 3: round_id r3-mvdm5lub, sha 456b9285...ca35, session st_01a14e4e, result changes_requested (REJECT). B1-B6 not re-raised. New eligible: B7 auto slot activation could remove outfits via cross-kind groups (IS-7) -> todo 10 within-kind grouping, todo 12 slot-activation protection rule, todo 14 reference; B8 negative control too short for its sequence (IS-5/IS-10) -> 300 s.
- Round 4: round_id r4-mvdm89vu, sha 6cd5f37d...13de, session st_01a14e50, result changes_requested (REJECT). B1-B8 not re-raised. New eligible: B9 frame-base equality rule unreliable (Float32, equal-value writes, release overwrite) (IS-2/3/14) -> todo 2 explicit restoreBases/compose lifecycle + tests, todo 7 pre plugin; B10 leases/turn end lack turn identity with multiple active responses (IS-7/11) -> SlotCommand.turnId, lease turnId, onSpeech(turnId), per-turn turnEnd diff, interleaved tests.
- Round 5 (final allowed): sha 5220593b...fa3e, session st_01a14e52, result changes_requested (REJECT). B1-B10 not re-raised. New eligible: B11 Valibot unavailable in stage-ui-live2d (dependency guardrail) -> validators moved to stage-shared (parseRestSet, parseCuratedCatalogDocument in todo 1; parseVtubeHotkeys in todo 10); live plan sha after fix 534df85de9739f9311d687588b36316ef34b4035a267ac3bcebb6b6f30205c1a (also adds the stage-shared index.ts merge note). Cap of 5 rounds reached without approval -> asking Luke (continue / accept / adjust).

## Close-out (2026-10-18T09:27:32.191Z)
- Luke chose "Accept as is" at the 5-round review cap. High-accuracy review did NOT end in an unconditional approval; the round-5 fix (validators moved to stage-shared) and the index.ts merge note are unreviewed. Live plan sha256 at handoff: 534df85de9739f9311d687588b36316ef34b4035a267ac3bcebb6b6f30205c1a.
- Structural self-check on the live plan: 26 impl todos, F1,F2,F3,F4, errors 0.
