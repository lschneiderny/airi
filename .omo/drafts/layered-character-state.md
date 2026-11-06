---
slug: layered-character-state
status: approved
intent: clear
review_required: true
plan_path: .omo/plans/layered-character-state.md
plan_sha256: 5be6ee3cb433ca048b98868c90d49041f995f508a7b5d0c890e47be3bc7b81c8
review_round_id: lcs-r5
review_round_limit: 5
round_status: active
pending-action: review .omo/plans/layered-character-state.md
review:
  plan_reviewer:
    status: in_flight
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/layered-character-state.md
    round_id: lcs-r5
    plan_sha256: 5be6ee3cb433ca048b98868c90d49041f995f508a7b5d0c890e47be3bc7b81c8
    launch_id: lcs-r5-l1
    session: st_01a1a389
    result: approved (OKAY, live sha re-validated 5be6ee3c... match)
approach: <fill: the approach you intend to plan>
---

# Draft: layered-character-state

## Affected user and ideal state
Users: (U1) Luke as the person in the relationship (talks, texts, pets, leaves, returns, over weeks-months); (U2) the chat model, which reads the per-request situation block and emits cues; (U3) Luke/agents as developers tuning it via devtools, simulator, model-eval; (U4) future plans (closeness behaviour, callbacks) building on the state.
- IS-1 | Her tone in text follows a mood that persists for hours with a stated reason, survives restarts, fades by wall-clock time, no 04:00 reset | D-user-1/3/4
- IS-2 | Her resting face (mouth corners, eye openness, blink rate, brows) subtly matches that mood, strongest right after interaction, never frozen; fast reactions play on top unchanged; zero baseline = bit-identical motion | D-user-1, motion AGENTS rules
- IS-3 | Her reach-out frequency and the reach-out message reflect mood; being ignored or returning after absence moves mood | D-user-6
- IS-4 | Over days her resting disposition drifts with how the week went (temperament), anchored to the card | D-user-5
- IS-5 | Over weeks the relationship (closeness, trust, familiarity) grows with real engagement, cannot be farmed, never punishes absence beyond gentle familiarity erosion, trust is asymmetric; growth shows as new behaviour (teasing, nicknames, initiative, vulnerability, callbacks), stage-ups land at the 04:00 rollover | D-user-7, ADR
- IS-6 | Nothing of this is visible in normal UI; devtools shows values, contributions with reasons, relationship levels/stages, history | D-user-2
- IS-7 | The model never sees two contradictory moods, never sees numbers, and the per-request text is stable turn to turn (changes only on bucket/reason change) | prompt hygiene
- IS-8 | Months of state is durable: IndexedDB per card, versioned + migrated, included in card export/import, removed on card delete and by Delete all data | persistence-tiers ADR
- IS-9 | Model-agnostic: plain data, works with any provider; switching models keeps relationship | ADR
- IS-10 | Developers can simulate 30-90 days deterministically (CLI) and jump the clock in devtools; model-eval compares behaviour at relationship stages | ADR
- IS-11 | No runaway/self-confirmation: bounded model cues, budgets, saturation, property-tested | math lane
- GAP-1 | No slow mood exists; only 20-45 s Natural mood (mood.ts:75-80) | closes IS-1
- GAP-2 | Model sees only raw fast-mood numbers when stateFeedback is on (use-airi-runtime-prompt.ts:29-31, render.ts:180) | IS-7
- GAP-3 | No MOOD cue in contract/parser/scorer | IS-1/11
- GAP-4 | Natural has no external baseline input; tension never reaches face | IS-2
- GAP-5 | Urge gate has no mood factor; unanswered/return do not affect mood | IS-3
- GAP-6 | No temperament, no relationship model, no behaviour thresholds, no relationship prompt text | IS-4/5
- GAP-7 | No relationship-event detection (disclosure, kept promise, hurtful, milestone) | IS-5
- GAP-8 | No store/repo/schema; not in card export/delete/data maintenance | IS-8
- GAP-9 | No devtools page, simulator, clock jump, or model-eval stage fixtures | IS-6/10
- GAP-10 | ADR 2026-11-03 Delivery section says two plans; prompt-composition/persistence-tiers ADRs need amendments | docs
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

## Components (topology ledger)
- C1 | Pure character-state core in stage-shared/src/character-state (types, mood, temperament, relationship, render, face baseline, urge factor, migrate) | active
- C2 | Persistence + store (IndexedDB repo, synced store leader-routed, data maintenance, card export/import/delete) | active
- C3 | Prompt + contract (MOOD cue end to end, feeling/relationship text in situation runtime context, reach-out prompt line, stage-line reconciliation) | active
- C4 | Event sources (touch, unanswered, return/absence, replies, rituals, exchange-end appraisal for relationship events) | active
- C5 | Face baseline in Natural + stage wiring (Live2D, MMD where Natural face runs) | active
- C6 | Reach-out coupling (urge-gate mood multiplier on open hazard) | active
- C7 | Devtools inspector + clock jump; qa-tools simulator CLI; model-eval stage fixtures | active
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->

## Open assumptions (announced defaults)
- Pure core location | stage-shared/src/character-state subpath | stage-shared AGENTS.md:5,30 precedent | yes
- 3 mood axes (valence, energy, tension) | math lane; brows need tension | yes
- Math constants | adopt lcs-math spec (.omo/drafts/layered-character-state-math.md) as starting values in a settings module, not stored | yes
- Text placement | runtime context (situation block), not system prompt | chat.ts:337-357 convention | yes
- Fast-mood numbers in stage line | removed from the stage line when the feeling line renders (one mood, in words) | IS-7 | yes
- Storage | localforage instance 'airi-character-state', one record per card, Valibot v1 + migrate, lock 'airi:character-state', synced store leader-routed | tier 4 | yes
- Face renderers | wherever Natural face output runs (Live2D; MMD if its adapter consumes Natural face); VRM out (no Natural) | face lane | yes
- Test deps | no fast-check; seeded property loops with stage-shared situation rng.ts | AGENTS dependency rule | yes
- Delivery | branch luke/feat/layered-character-state + PR to lschneiderny/airi | AGENTS source control | yes
- MOOD cue grammar | closed word vocabulary (brighter/lower/livelier/tireder/tenser/calmer, up to 2) + short reason; one per turn; recovered like ACT | math lane: directions not numbers | yes
- Unlock list | teasing, nicknames, initiative, vulnerability, callbacks with lcs-math thresholds | math lane | yes
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->

## Findings (cited - path:lines)
### Situation lane (st_01a1a369) + root verification
- Situation store leader-only, unsynced (stage-ui stores/situation/index.ts ~214-236); tickers advance 1 s (~L81) + gate 2 s (~L88) only on leader; reads Date.now() directly; seedSource injectable.
- Inner state persisted in localStorage 'settings/situation-inner' (features/situation/inner-state.ts) Valibot v:1, per-field validation, claim(token)/write(patch, token) rejects older savedAtMs; tier 2 named exception. forget(request) leader-routed via speech bus situationForgetRequestedEvent.
- Touch: stores/touch.ts:46 emits situationTouchObservedEvent (touch-bus.ts:15) on speech bus; leader listens index.ts:1011; reducer applyTouch -> touch-poke/-burst, touch-pet/-long; presence -> returned; observation wake.
- Gate pure: urge.ts baseRatePerHour(c)=1.3*26^(c-0.5), SAFETY_CAP 4/h; urge-gate evaluateUrgeGate deterministic 5 RNG draws per fire; recordUrgeUserTurn / recordUrgeFireOutcome drive unanswered phases.
- VERIFIED (root): the situation block is the ONLY per-request runtime context entry: chat.ts:337-357 situationContextMessage() contextId 'system:situation', ReplaceSelf, "never in the system prompt, because it changes every turn". renderSituation stageBullet (render.ts:177-183) already shows `mood:` from useStageLiveState (use-airi-runtime-prompt.ts:29-31,72-95) = FAST Natural mood as raw numbers `valence x, arousal y, tension z`, only while expression-performance `stateFeedback` is on; also base.yaml:80-81 expression-state line (useStageLiveStatePrompt). SITUATION_MAX_LINES 6 / MAX_CHARS 500 (render.ts:17-19).
- Devtools: route /devtools/situation registered in apps/stage-tamagotchi renderer settings/system/developer.vue:87-90; page packages/stage-pages/src/pages/devtools/situation/index.vue (+components/); store stores/devtools/situation-observability.ts with leader invoke handlers over getDevtoolsBusContext (situationInspectInvoke etc.), followers time out.
- Implication: per-turn-changing character text belongs in runtime context (situation block bullet or a sibling ContextMessage), NOT a composePrompt tail segment -> overrides architect's tail-segment suggestion.

### Architect lane (st_01a1a36b, advisory; claims to verify)
- Pure core in packages/stage-shared/src/character-state (stage-shared AGENTS.md:5,30 deciders take explicit time); subpath export @proj-airi/stage-shared/character-state. API: initialCharacterState, applyEvent, advance (idempotent), readMood, renderMoodSegment, faceBaseline, reachOutMoodFactor, migrateCharacterState.
- Store: synced store via setupSynced (stage-ui libs/pinia/setup-synced.ts:24), leader-only folding/writes on situation leader ticker (situation/index.ts:81, :218-221 leader-only), replicate small reading + revision only; persistence tiers ADR docs/ai/adr/2026-11-01-persistence-tiers.md:12,24,25 (tier 4 synced + leader-routed actions; tier 5 no replicated events; register with useDataMaintenance composables/use-data-maintenance.ts:46).
- Touch reaches leader via stores/situation/touch-bus.ts (situationTouchObservedEvent index.ts:71); chat hooks onTokenLiteral consumed by situation store index.ts:200.
- Repo: localforage instance 'airi-character-state', lock 'airi:character-state', record per cardId, Valibot + version + migrate on load; constants in settings, not stored.
- Gate: urge-gate.ts:380-388 hazardsOf multipliers; add mood multiplier on `open` hazard only (not ritual/due/continuation); default 1 keeps gate.simulation.test.ts stable.
- Face: separate FaceBaseline input on Natural controller, additive, zero = bit-identical.
- Harness: pure simulator CLI in qa-tools/src/character-state (mirror qa-tools/src/motion/gate/cli.ts) + devtools jump-clock wrapper calling applyEvent/advance with synthetic nowMs. Model-eval: prompt fixtures segmentsFromFixture (qa-tools/src/model/prompt.ts:33), score/style.ts dimension.
- VERIFIED (root): persistence-tiers ADR tier 4 = IndexedDB behind synced store with leader-routed actions; tier 5 replicate values never events; register with useDataMaintenance same commit (memory store at use-data-maintenance.ts:18,64,96). urge-gate.ts hazardsOf multipliers object {base, pressure, exchange, clear, damping, floor, game}; `open` = base*pressure*clear*damping*game*shared; ritual/due/continuation separate -> mood multiplier joins `open` only. setupSynced at setup-synced.ts:24. Files: stage-ui stores/situation/{index.ts,touch-bus.ts,sensors}; stage-shared situation/{urge-gate,urge,gate,reducer,render,reasons,...}.
- Risks: cross-window races, tail churn (quantise), contract hash churn once, feedback loop (per-turn 1 cue, daily cap, worst-case stub), migration.

### Prompt/cue/store lane (st_01a1a36a, explore; claims)
- PROMPT_SEGMENT_ORDER compose.ts:10 = format, card, register, contract | memory, toolset, account, voice, control, unprompted, plugin, stickers, spark. Prefix = first four. Budgets compose.ts:25-42 `satisfies Record<PromptSegmentId,...>` -> new segment id needs order slot + budget. composePrompt :145 returns text/prefix/tail/report.
- User turns: buildChatPromptSegments stores/chat/prompt.ts; chat.ts:897. Second caller character/orchestrator/store.ts:187. Mood/relationship text belongs in a tail segment (prefix cache).
- Contract: STAGE_RUNTIME_CONFIG index.ts:26 (recoverCueNames ACT, DELAY), emotions index.ts:9-22, prose from base.yaml keys (index.ts:28), STAGE_CONTRACT_EN_SHA256 index.ts:62 pinned in index.test.ts:35-45. Parser core-agent llm-marker-parser.ts:501 + pipelines-audio llm-streaming-control/controller.ts:42; recovered-cue.ts:30,61; cue-compliance.ts:28. Scorer qa-tools model/score/cue-contract.ts:10,47-56,186-189; fixtures core-agent runtime/cue-contract-fixtures.ts.
- Memory: localforage 'airi-memory'/'entries' memory.repo.ts:16, navigator.locks 'airi:memory' :23, tombstones :8-14, per-persona scoping write :52 forget :79; BroadcastChannel 'airi:memory' in stores/memory.ts; no schema version/migration. Mock database/repos/__mocks__/memory.repo.ts for Node.
- Card: exportAiriCardPackage airi-card-import-export.ts:87 (memories optional), import :119 returns memories (caller writes, unverified); removeCard airi-card.ts:282-287 deletes persona entries.
- qa-tools buildSystemPrompt model/stage-contract.ts:50 takes segments; `prompt --full <fixture.json>` prompt.ts:110; no scenario format found in src/model.
- Memory tool schema caps (150/2000) only in valibot tool schema, not repo.
- Verified (root, 2026-11-03): prompt.ts:80-93 segment list confirmed; card import caller stage-pages settings/airi-card/index.vue:65 (receives memories), export caller CardDetailDialog.vue:130; renderSituation stage-shared situation/render.ts:199, store situation/index.ts:1091 renderForRequest (not a composePrompt segment; injection path to be confirmed by situation lane).
- OPEN (was): where the situation block is injected (no 'situation' segment id); parser grammar body; callers of export/import.

### Face lane (st_01a1a368, explore; claims, spot-verify before plan)
- NaturalMood valence/arousal/tension, exp decay taus 45/20/30 s (motion-driver-natural/src/mood.ts:22-80; stage-shared expression-performance/settings.ts:94-104). `active` gating at mood.ts:36-38.
- Face reads mood only via moodMouthForm (mood-modulation.ts:28-30 -> face-hints.ts:29); tension never reaches face; modulateByMood drives body/camera (mood-modulation.ts:14-26).
- Injection: additive baseline input to withHints (face-hints.ts:13, called natural-motion.ts:673); blink rate via NaturalBlinkScheduler.intervalScale (blink.ts:32, natural-motion.ts:585); eye openness via eyeOpenMultiplier (face-hints.ts:20, natural-motion.ts:686); brows additive offsets face-hints.ts:22-27. Rejected: decay-toward-baseline in NaturalMood (breaks active + mood.test.ts:54), addMood doses (one-shot pulses), adapter-side (breaks renderer-neutral rule).
- Overlap: moodMouthForm already maps valence to mouth (default 0.08, settings.ts:116).
- Renderer coverage: Live2D gets addMood (conductor use-stage-performance-conductor.ts:297-307 Live2D-only); MMD builds NaturalMotion (stage-ui-mmd natural/adapter.ts:85,170) but receives no doses; VRM does not use Natural at all.
- QA: motion caches hash motion-driver-natural/src (qa-tools cache/guard.test.ts:26); validation plan zeroes mood (validation/plan.ts:245); no gate covers a mood baseline.

## Decisions (with rationale)
Settled by Luke in session 01a1a28f (2026-11-03) before planning; source of record: docs/ai/adr/2026-11-03-layered-character-state.md (uncommitted, Status proposed) and memory reference/projects/dtuber-llm-mood.md.
- D-user-1: mood shows in face (selected channels) and text. Luke: "Ideally it would show in face, or atleast certain aspects of face and text."
- D-user-2: hidden from the user except devtools/inspectors.
- D-user-3: timescale matches LLM-initiated conversation cadence; think long term, not 10 minutes.
- D-user-4: overnight = natural decay only, no 04:00 reset.
- D-user-5: days-scale layer included now.
- D-user-6: mood scales reach-out urge rate + enters reach-out prompt; unanswered messages feed mood.
- D-user-7: product frame = realistic anime character relationship sim on a long timeline; short-term reward, designs enable long timelines.
- D-user-8: scope chosen "ADR now, then two plans"; then superseded by "lets create a ulw plan for everything" -> ONE plan covering mood + temperament + relationship + storage + harness (ADR Delivery section must be revised to match).
- D-user-9: plan after nonverbal-channels lands -> satisfied: nonverbal-channels is on main (ADR Status accepted, commits 8e60e390e..e7e691e99, no remaining branch).
- Session: intent CLEAR, review_required true, stance batch (consistent dtuber episodes).
- D-user-10 (fork batch 1): Card data = owned field in card airi extension, neutral defaults, editable in card settings, exported with card. History = start fresh at card's starting stage. Tests = TDD for pure parts, tests-after for store/wiring/UI. Events fork answer came back empty ("\") -> re-asked alone.
- D-user-12 (consultant finding 7): Drop the numbers - state feedback reports active expressions only; the worded feeling line is the model's only mood signal (remove formatMood numbers from stage line and expression-state).
- Consultant st_01a1a375 findings folded as defaults: (1) ADR amended (one plan, 3 axes, runtime-context placement); (2) card field added to sanitizeAiri (import-export.ts:232) + cardFromAiriCard (:199); (3) removeCard + resetModulesSettings + data-maintenance browser test; (4) leader->stage face feed via replicated {reading, revision, updatedAtMs}, stale revision ignored; (5) MMD consumes Natural face via applyNaturalFace (stage-ui-mmd src/composables/mmd/natural/adapter.ts ~205, face.ts) -> both adapters get setFaceBaseline; (6) blink scale composes with mod.blinkInterval, zero baseline 600-step deep-equal; (8) sibling ContextMessage contextId 'system:character', situation block bytes unchanged; (9) extraction answer becomes object {threads, events} in one commit, tests updated, no union shim; length-capped answers fail appraisal too; (10) zero extra runtime model calls; (11) contract + SHA + fixtures + scorer in one commit, MOOD not in recoverCueNames; (12) milestoneIds cap 64, daily-summary ring 400 days; (13) live rows partial for Luke; (14) devtools strings in English i18n source, tests use t(); (15) neutral state renders nothing (new IS-12); (16) no changes to urge.ts rates, SAFETY_CAP, ritual/due/continuation hazards, memory tool schema, composePrompt order/budgets.
- D-user-11: Events = extend the exchange-end thread extraction (features/situation/thread-extraction.ts) to also return relationship/significant-mood appraisal in the same JSON; no extra model call.

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Review ledger
- r1 st_01a1a37d (plan sha ea9dcefd...) REJECT. Blockers: B1 model-spam bound 0.52 is a time-average; rolling-budget burst peak is 0.24/(1-2^(-2/3)) = 0.649 (root sim of the exact stream peaked 0.644) -> bound changed to 0.65 in todo 3, todo 15, A10, IS-11, stream direction and sampling stated. B2 IS-3 reach-out wording unproved -> todo 17 acceptance gained pointed/unpointed unprompted cases, IS-3 row lists 17. Notes fixed: todo 7 Blocks list, todo 11 parallel list; extraction token note added to todo 14.
- r2 st_01a1a381 (4ff99f09...) REJECT, r1 blockers closed. New blocker B3 IS-2: blinkRate meaning contradicted (multiplier neutral 1 in A9 vs zero-default offset in todo 8 -> 1/0) and :585 composition only runs with heldEmotions on -> renamed to blinkRateOffset (neutral 0, interval x 1/(1+offset), applied every step regardless of heldEmotions) in todos 7, 8, 19, A9; todo 19 browser case checks blink. Notes fixed: removeCard :276; todo 11 depends on 7.
- r3 st_01a1a383 (4dd1f191...) REJECT, B3 closed. New: B4 blink scale compounding when heldEmotions off -> compute fresh `base/(1+offset)` per step + no-compounding acceptance (600 vs 60 steps). B5 Must-have "situation forget everything clears state" undelivered -> todo 16 wires applyForget (:1105-1135) + node test; IS-8 row lists 16. Notes fixed: 04:00 helper names, todo 2 failure QA, urge-gate/gateTick line refs.
- r4 st_01a1a386 (0fa80c67...) OKAY, B4/B5 closed. Six non-blocking notes folded (editor test file CardEditor.browser.test.ts, farming-cap tolerance, same-instant cue timestamps, renderKey includes time words, Must-have placement wording, importRecord store action). Plan changed -> approval invalidated; r5 confirmation round launched against 5be6ee3c...
- r5 st_01a1a389 (5be6ee3c...) OKAY. Convergence: 5 rounds, 5 blockers (B1-B5) all closed. Non-blocking notes left for the executor (plan unchanged to keep the approved digest): (n1) circular import risk - character-state store importing day helpers from stores/situation/index.ts while that file imports the store; move nextLogicalDayEndsAtMs beside localLogicalDayKey in features/situation/inner-state.ts; (n2) matrix row 16 Blocks should read 18, 20; (n3) A6 close-stage sentence says "may use a nickname" though nicknames need close + knows-you - render the nickname clause only when the nicknames unlock is active; (n4) IS-11 evidence is the model-spam run, IS-6 F1 grep should be `rg` for character-state imports outside devtools/card editor.

## Approval gate
status: awaiting-approval
approach: one plan, branch luke/feat/layered-character-state; waves: W0 ADR revisions + pure core (TDD) -> W1 parallel lanes (repo/store/card, contract+MOOD cue, urge factor, Natural FaceBaseline, simulator CLI, extraction appraisal) -> W2 wiring (situation events, runtime-context feeling/relationship text, stage-line reconciliation, stage face feed, reach-out prompt) -> W3 devtools inspector + clock jump, model-eval stage fixtures, docs -> F-wave.
next action: on Approve, scaffold plan, run plan-consultant, append todos, then plan-reviewer rounds.
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
