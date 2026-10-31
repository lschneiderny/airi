---
slug: unprompted-reach-out-redesign
status: complete
intent: clear
review_required: true
plan_path: .omo/plans/unprompted-reach-out-redesign.md
plan_sha256: 6f023a061b693a506f618e7517b257d8760fe553441c818a03a65d7504855f4e
review_round_id: r6-e2e92973
review_round_limit: 10 (extended by Luke 2026-10-29: 'Extend by 5 rounds')
pending-action: none (handoff delivered; execution via /ulw-execute unprompted-reach-out-redesign)
round_status: approved
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/unprompted-reach-out-redesign.md
    round_id: r6-e2e92973
    plan_sha256: 6f023a061b693a506f618e7517b257d8760fe553441c818a03a65d7504855f4e
    launch_id: l-fb8d64bd
    session: st_01a189fd
    result: approved (OKAY, no blockers, no notes)
approach: Replace the gate's floor-gap timing with a seeded urge-integrator hazard (Poisson, Chattiness = base rate) plus social phases (in-exchange, unanswered, double text); add a separate pure ReasonState (open threads via leader-only extraction, rituals on a logical day, own-day baseline) consumed by the same evaluateGate with competing-risks + weighted-random selection; human-framed prompt and cue; persisted non-synced local state; inspector panels for urge/reasons/outcomes; docs and tests; branch + PR.
---

# Draft: unprompted-reach-out-redesign

## Affected user and ideal state

Affected users:
- U1 Luke at the desk (primary). Today: the character opens a turn roughly every 10 min while he switches apps, always about his screen; it reads as a monitor. After: she texts a few times a day for her own reasons, like a girlfriend texting her partner; silence is normal.
- U2 The character/model (program consuming the prompt). Today: told "(No one spoke to you. You may speak up about: switched to Chrome (browser))" and asked to decline with <|SILENT|>; it almost always complies. After: asked the human question with the situation, time since they last talked, what she said last, and one optional reason on her mind; silence is the expected default.
- U3 Plugin and widget authors (spark:notify, widget reactions, forced turns via holdTopic/submitUnprompted force). Today: notifies enter the ring and urgent ones bypass timing; forced turns speak. After: unchanged contract.
- U4 Luke as tuner (devtools Situation inspector). Today: gate trace shows threshold/gap/cap. After: shows urge, hazard, ripe reasons, next-expected window, outcomes per reason kind, so the design is measured on real sessions.
- U5 Executor/maintainer (tests, READMEs, AGENTS). After: pure logic deterministic under injected randomness; docs match behavior.

Ideal state rows:
- IS-1 | Cadence: at default Chattiness she opens 3-6 turns over an 8-10 h desk day with long-tailed spacing (a follow-up within minutes is possible, hours of silence are normal); never a fixed period | a metronome is the first thing that reads as fake
- IS-2 | Subjects: most openings are hers (open threads, rituals, her own day); screen reactions are rare and only long-session / returned / notify; she never opens with an app switch | a girlfriend texts about herself and shared threads, not about your window titles
- IS-3 | Conversation respect: while an exchange is live (lulls up to ~15-20 min) she opens no new topic; after one unanswered opening the next is a short continuation or nothing; after two unanswered she is quiet for hours unless urgent; his reply does not instantly restore full rate; one double-text within ~60 s of her own message is allowed | people wait for replies and do not re-open after being ignored
- IS-4 | Follow-ups: she comes back once to an open thread from the last exchange (unanswered question, "later", dropped topic, her own promise) in a plausible window hours later, never immediately and never twice | the most common reason a partner texts
- IS-5 | Rituals: greets on his first appearance of the local day, signs off when he goes idle or locks late, welcomes him back after hours away; each at most once per day; a missed window stays missed | daily texting has rituals; a 3 pm "good morning" reads as broken
- IS-6 | Prompt and cue: the model is asked whether she would text him now, with silence as the default and the reason as optional context; the stored trigger/cue in chat history reads naturally, not as surveillance | the LLM veto only works when declining is framed as normal
- IS-7 | Unchanged hard contract: DND, hidden stage, typing, speaking, generating, calls, quiet apps, games suppress exactly as today; urgent notifies (salience 1) bypass timing; widget/plugin forced turns and holdTopic keep working; no second window ever fires | regressions here are user-visible and plugin-visible
- IS-8 | Chattiness = mean rate only; Presence settings copy says so; default 0.5 yields IS-1 | the owner's decision; one knob, one meaning
- IS-9 | Observability: the Situation inspector shows urge, hazard per tick, ripe reasons with salience and ripening state, next-expected window, pick trace, and per-reason-kind outcomes (spoken/declined/ignored/engaged); the inspector adds no synced-state growth | the constants are untuned; tuning needs real-session evidence
- IS-10 | Persistence: gate memory, open threads, rituals-done-today survive a leader reload and the day boundary; stale items expire | a reload must not reset her to day one
- IS-11 | Bounded cost: thread extraction is one call per exchange end on the chat provider/model, token-capped, leader-only, and a failure leaves chat untouched and is visible in the inspector | background calls must never degrade chat
- IS-12 | Untrusted text: extracted thread text and improvised-topic hints pass the same sanitization and caps as notify text before entering prompts | thread text comes from model output over chat content
- IS-13 | Determinism and docs: gate and reason logic are pure with injected randomness; tests cover rate bounds, floor, bypass, damping, ripening, rituals-once-per-day; stage-shared/stage-ui/core-agent READMEs and the inspector docs describe the new behavior; English locale only | repo conventions; tests must not pass by timing luck

Gap rows (today -> ideal):
- GAP-1 | gate.ts fires on the first tick after minGap when any world event clears the threshold; with continuous supply this is a metronome at 10 min / 4 per h (IS-1) | replace timing with an urge/hazard model whose mean rate is a few per day | closed by: TBD
- GAP-2 | pickCandidate accepts app-switch (0.5), switching-burst, wake as topics (IS-2) | restrict gate eligibility to long-session, returned, notify; add inner reasons | TBD
- GAP-3 | IN_EXCHANGE_MS and IGNORE_WINDOW_MS are 120 s; backoff is a thermostat and a user turn drops a level immediately (IS-3) | lengthen exchange window with decay; unanswered damping; slow recovery; double-text window | TBD
- GAP-4 | no open-thread source exists; the conversation sensor only records who spoke when (IS-4) | exchange-end detector + extraction + thread store with ripening | TBD
- GAP-5 | no rituals; `returned` fires after 5 min away at 0.6 (IS-5) | ritual detector keyed by local day | TBD
- GAP-6 | trigger text "(No one spoke to you. You may speak up about: X)" and base.prompt.unprompted frame the fire as a topic assignment (IS-6) | human-framed instruction and trigger; cue copy | TBD
- GAP-7 | hard suppressors, urgent bypass, forced turns exist and must be preserved through the gate rewrite (IS-7) | regression tests pinned before the rewrite | TBD
- GAP-8 | Chattiness maps to threshold, gap, and hourly cap (IS-8) | map to mean rate only; settings copy | TBD
- GAP-9 | GateTrace shows threshold/gap/cap; inspector shows gate decisions and spend only (IS-9) | new trace fields and inspector panels; outcome ledger per reason kind | TBD
- GAP-10 | gate memory lives in the leader's JS memory and resets on promotion (IS-10) | persisted gate memory + thread store + rituals-done; day boundary | TBD
- GAP-11 | no background extraction path (IS-11) | leader-only extraction using the chat provider, capped, observable | TBD
- GAP-12 | notify text is sanitized via situationContextText; no equivalent for new inner text (IS-12) | reuse sanitizer for threads/hints | TBD
- GAP-13 | gate is pure but has no randomness input; docs describe the old gate (IS-13) | injected random source; tests; docs | TBD

## Components (topology ledger)
- C1 | Hazard timing gate in stage-shared (urge, hazard, floor, damping, double-text, chattiness=mean rate, injected RNG) | active | packages/stage-shared/src/situation/gate.ts
- C2 | Reason sources: open-thread extraction + store, ritual detector, own-day improvisation hook, demoted reactions; inner origin in the ring | active | packages/stage-shared/src/situation/*, packages/stage-ui/src/stores/situation/*
- C3 | Prompt and cue: human-framed instruction, trigger text, chat-history cue copy, i18n (English) | active | packages/i18n/src/locales/en/base.yaml, packages/stage-ui/src/stores/chat.ts
- C4 | Store integration: exchange-end detection, leader-only extraction call, persistence of gate memory / threads / rituals, fire flow | active | packages/stage-ui/src/stores/situation/index.ts
- C5 | Observability and settings: inspector panels for urge/reasons/outcomes, Presence settings copy | active | packages/stage-pages/src/pages/devtools/situation, packages/stage-pages/src/pages/settings/presence
- C6 | Docs and verification: READMEs, tests, pnpm verify, live QA recipe | active | packages/*/README.md
- D1 | Cross-day callbacks (memory) | deferred | thread store shaped to hold them
- D2 | Daily beats (stored day plan) | deferred | Luke chose improvise-at-fire-time

## Open assumptions (announced defaults)
- Intent: CLEAR (outcome settled across two prior question batches). review_required: true (default-on). Classification: Architecture (gate rewrite + new reason modules + store + chat + devtools). Stance: batch renderer (planning-style episodes: Luke batches forks and takes recommended options; veto available).
- Reason storage | separate pure ReasonState (threads + rituals) beside the ring, consumed by the same evaluateGate (architect Design B) | ring is short-lived/decay-only/render-visible/unpersisted | reversible (internal)
- Persistence | one localStorage key `settings/situation-inner` via useLocalStorageManualReset, not synced; {v, threads<=24 (session-scoped), rituals: RitualDay, gate: SavedGateMemory{lastFireAtMs,lastSpokenAtMs,unanswered,awaitingSinceMs,damp,day,lastOwnDayAtMs,rngState}, savedAtMs}; write on change; expired items dropped on read | matches settings.ts pattern; avoids synced inflation (situation-observability.ts:152-153) | reversible (local, versioned)
- Decline semantics | <|SILENT|> no longer feeds backoff; only spoken-and-ignored does; declines still counted in inspector spend | silence is now the expected default | reversible (constant)
- Candidate selection | pending ultrabrain lane; default highest weight + deterministic tiebreak unless the lane shows weighted-random is needed for IS-1 | inspector readability | reversible
- Chat cue copy | 'Spoke up about {topic}' becomes a reason-labelled cue (e.g. 'Reached out: <reason label>'); English only | IS-6 | reversible (copy)
- Extraction trigger | onChatTurnComplete + quiet >= exchange window, >=1 user turn since last extraction, leader-only, one in flight, last ~12 messages, small max_tokens, Valibot-validated output, sanitized via situationContextText | IS-11/12 | reversible
- Branch/PR | plan-sized work on luke/feat/unprompted-reach-out branch, PR against lschneiderny/airi, atomic commits passing pnpm verify | root AGENTS.md source-control rule | n/a
- Swept extrinsic axes: budget/spend = one extra small LLM call per exchange end on the user's own chat provider (defaulted, visible in inspector spend); mandated stack = existing (Vue/Pinia/Valibot/Vitest; no new deps; mulberry32 inline); scale = single user desktop; audience/compliance = personal fork, no telemetry.

## Findings (cited - path:lines)

### Lane explore-llm-persistence (st_01a189cb)
- useLLM().stream (stores/ai/chat-llm/llm.ts:23-82) wraps core-agent streamFrom with provider/model passed in; abort via stream options; no leadership check.
- artistry-autonomous.ts:79,152-193 uses consciousness selection + provider instance + streamFrom; parses JSON with JSON.parse after fence strip (:195-210), no Valibot -> closest 'structured output' pattern; vision use-vision-inference.ts:47-118 combines caller abort + timeout signal.
- No generateObject/response_format usage found. Validation pattern to reuse: features/situation/settings.ts:75-117 (safeParse then parse for defaults).
- Persistence: settings.ts uses useLocalStorageManualReset under 'settings/situation', synced {state:true, actions:['update','reset']} (:96-131). Session store declares synced state+actions (session-store.ts:1870-1894); getSessionMessages/IfLoaded read-only (:1654-1662). Notebook store is a list shape but NOT persisted/synced (character/notebook.ts).
- Exchange end: runtime emits stream-end -> assistant-response-end -> assistant-message -> chat-turn-complete (chat-orchestrator-runtime.ts:1352-1372); declined unprompted turns emit stream-end + decline callback only (:1314-1323). onChatTurnComplete is the completed-turn hook.
- Message shape: core-agent/src/types/chat.ts:67-104 (origin 'unprompted', trigger, createdAt, completedAt, id). No per-day session boundary exists.
- Clock: render.ts:43-45 HH:mm; core-agent/src/messages/datetime-prefix.ts:30. No day-boundary helper.
- Seeded RNG precedent: stage-shared/src/expression-performance/picker.ts:18-27 (seed -> state), reaction-strength.ts:13-23 (drawRandom(state) pure). Use checkpointed seeded state in GateMemory, matching repo precedent.


### Lane explore-ui-surface (st_01a189cc)
- Devtools situation page: stage-pages/src/pages/devtools/situation/index.vue:11-17,39-86,98-134 renders Source, Summary, Events, Block, Gate, Spend, ACT Compliance; polls inspectLeader(), previewLeader(), evaluateGateLeader(). Observability data shape: stage-ui/src/stores/devtools/situation-observability.ts:63-109.
- situation-gate.vue:14-30,46-134,144-241 shows decision, next eligibility, backoff, hourly fires, pending topic, Evaluate now, history. situation-spend.vue:8-14,23-86 spoken/declined per session + last request size. Only browser test in dir: situation-act-compliance.browser.test.ts:21.
- Presence settings: stage-pages/src/pages/settings/presence/index.vue:11-26,51-135 binds unpromptedEnabled, chattiness (0-1 step .05, shown as %), dontDisturb, speakDuringGames, showUnpromptedCue, shareForegroundWindow, shareBrowserActivity, quietApps, titleDenylist. Browser test index.browser.test.ts:19,38-125.
- i18n en: settings.yaml:796-827 (chattiness.description "How often the character speaks up on its own."; unprompted-enabled.description "Let the character start a conversation when something happens on your desktop."); base.yaml:63-70 unprompted/unprompted-forced; stage.yaml:119-120 stage.unprompted.cue "Spoke up about {topic}". Rule: edit English only (root AGENTS.md:72).
- Docs to update: stage-shared/README.md:129-153; stage-ui/README.md:360-412,422-425; core-agent/README.md:94-128; docs/ai/adr/2026-10-19-situational-presence.md:17-60,73-109,114-131; README.md:15; apps/stage-tamagotchi/README.md:20-30.
- Electron: App.vue:212-216 setStageVisible; :383-386 setHostCapabilities({unprompted:true}).
- Tests: stage-shared 'pnpm -F @proj-airi/stage-shared exec vitest run' (src/**/*.test.ts); stage-ui 'pnpm -F @proj-airi/stage-ui test:run' (node + browser projects; --project browser); stage-pages 'pnpm -F @proj-airi/stage-pages test:run' (browser only). Root 'pnpm verify' = tsx scripts/dev-tools/verify.ts (vitest related).
- Constraints: stage-shared AGENTS.md:20-44 deciders take explicit time and return memory, never read clocks/global randomness/stores; no persistence there. stage-ui AGENTS.md:20-45 situation store in src/stores/situation; synced stores follow pinia-synced skill. core-agent AGENTS.md:20-47 hosts own persistence. Valibot near consumers (root AGENTS.md:63-69).


### Lane explore-situation-chat (st_01a189ca)
- stores/situation/index.ts: startConversation :236-272 (also onTokenLiteral/onStreamEnd); recordUserTurn only for user-origin obs; first literal of unprompted turn marks topic addressed + recordFireOutcome spoken (:239-260); speakingTurns from voiceTurnsChanged (:280-290); userTyping :363-385; untilUserIdle :388-435; unpromptedTopicText :77-88 (web-extension privacy rewrite).
- Sensors: desktop.ts:37-110 presence (locked/suspended/idle) + wake; foreground.ts:60-165 activity + busy + category; context.ts:39-55, minecraft.ts:35-46 context; notify.ts:25-42; stage.ts:17-26.
- reducer.ts: makeEvent always origin 'world' (:124-142); 'self' origin exists in types.ts:132-145 but no production assignment; app-switch/long-session/went-away :162-200; returned/wake :218-242,370-389; switching-burst :252-301; markShown :530-539; markAddressed saves tracking.addressedTopic (:308-327,547-557) -> lastUnpromptedTopic on spoken.
- chat.ts submitUnprompted :1112-1132; prepareSend puts instruction+supplement into systemPromptSupplement (:960-973) -> runtime appends to system message (chat-orchestrator-runtime.ts:1114-1120). Situation block = ContextMessage contextId 'system:situation' replace-self (chat.ts:309-324,753) attached as runtime-context on the trailing user turn (runtime :889-890,933-937).
- Runtime holding state :656-657,780-800,970-975,1019-1023,1312-1322; decline -> 'unprompted-declined' control record (chat.ts:765-772,1142-1148; session-store.ts:475-476).
- History cue: utils.ts:24-32 identifies trigger (role user + origin unprompted), history.vue:139-145,274-280, unprompted-cue.vue:17-34 shows 'Spoke up about {topic}' when showUnpromptedCue.
- System prompt order: session-store.ts:209-212 (code rules, math rules, character prompt, stage contract); card order airi-card.ts:71-85 (systemPrompt, description, personality, scenario, widgetInstruction); situation is runtime context, not system prompt.
- Observability: situation-observability.ts:17-109 records; invokes 'eventa:devtools:situation:inspect|preview|gate-evaluate' (:120-127,249-252,290-322).
- Tests: gate.test.ts describes at :124,178,208,270,366; reducer.test.ts :60,182; render.test.ts :51; stores/situation/index.test.ts 'situation store' :100, 'situation gate loop' :588 (+ :658-675,784-824,860-920); chat.contract.test.ts 'unprompted turns' :2276-2534; chat-orchestrator-runtime.test.ts :2297-2876.


### Lane architect (st_01a189cd) - advisory, verified claims cited
- Recommends Design B: separate pure ReasonState (threads + rituals) in stage-shared/src/situation/reasons/*, NOT inner-origin events in the 32-slot ring. Reasons: ring churns with app switches (types.ts:254, reducer.ts:43), salience only decays and drops <0.05 (reducer.ts:68,111) vs threads need delayed ripening + hour/day life; unshown ring events become 'New:' prompt lines (render.ts:145); ring is unpersisted and reset on promotion (index.ts:118-120,575). Keep origin union 'world'|'self' untouched.
- Contracts (names): ReasonSource 'screen'|'thread'|'ritual'|'own-day'; RitualKind 'first-appearance'|'late-sign-off'|'back-after-hours'; Thread{id, topicKey 'thread:...', summary, cue, createdAtMs, ripeAtMs, halfLifeMs, weight, raisedCount, lastRaisedAtMs, expiresAtMs}; ReasonState{threads, rituals{dayKey, done[]}}; threads.ts reducer (add/raise/close/prune, threadWeight 0 before ripe then decays); rituals.ts detectRituals(facts, memory); collect.ts collectCandidates(situation, reasons, nowMs, opts) with GATE_ELIGIBLE_EVENT_KINDS={long-session, returned, notify}; urge.ts hazard (meanRatePerHour(c) ~0.55/h at 0.5, e.g. 0.55*4^(c-0.5); acceptsThisTick: draw < 1-exp(-hazard*dt)).
- evaluateGate keeps signature; GateInput gains reasons, draw, dtMs, heldTopics; timing reasons 'gap'|'hourly-cap' -> 'refractory'|'urge'; GateTrace drops gapMs/hourlyCap/firesLastHour, adds candidates[], readiness, hazardPerHour, pTick, draw, expectedNextMs, refractoryUntilMs, firesToday. situation-gate.vue:47,53,90,101 read removed fields.
- stage-ui: store owns ReasonState + rng + dayKey; sensors/exchange.ts exchange-end detector (fires only when >=1 user turn since last extraction); features/situation/thread-extraction.ts (useLLM().stream with activeProvider/activeModel chat.ts:267-280,600; Valibot parse; injected llm+clock); features/situation/inner-state.ts persistence.
- Persistence: one localStorage key via useLocalStorageManualReset (settings.ts:97 pattern), NOT synced (inflation cause documented at situation-observability.ts:152-153); shape {v, threads<=24, rituals{dayKey,done}, urge{lastFireAtMs, dayKey, firesToday, backoffLevel, ignoreStreak}, savedAtMs}; write on change not on tick; pending not persisted; leadership-guarded writes + savedAtMs compare. ASSUMPTION: windows share one localStorage partition (verify).
- Compat: pickCandidate self-origin exclusion + stale-tier skip move into collectCandidates screen branch; notify urgency bypass + busy-game stay; hard suppressor order untouched; markAddressed/holdTopic fan out to threads by 'thread:' prefix; forced spark turns bypass gate but SHOULD start the refractory; busy-race rollback must restore firesToday/lastFireAtMs; chat.contract.test.ts:2309,2371 pin old trigger string.
- Decline semantics: with silence as default, DECLINE_STREAK_WEIGHT would mute her; make declines neutral for backoff, keep in spend.
- Waves: 1 contracts freeze; 2 pure cores (urge | threads+rituals | collect+gate) parallel; 3 store+persistence; 4 chat+i18n (parallel with 3); 5 extraction service; 6 devtools; 7 measure/tune + docs/ADR.
- Risks: seeded RNG (mulberry32, no dep) + 200-seed 8 h simulation test for rate band; double-fire guard via persisted lastFireAtMs; extraction caps (last ~12 msgs, char budget, small max_tokens, not while sending, one in flight); injection: Valibot caps summary<=160 cue<=200, strip control chars, reject '<|' / 'SILENT' / role markers, labelled data section not instruction; own-day drift bounded by prompt; dayKey from local Date.
- Architect defers weighted-random pick (second draw, inspector readability) in favor of highest-weight + deterministic tiebreak. Pending ultrabrain view.


### Lane ultrabrain (st_01a189ce) - advisory, Monte Carlo checked (1500 days/setting, 10 s steps)
- Model: urge integrator Λ += λ_total·dt/HOUR_MS, fire when Λ >= E, E ~ Exp(1) drawn at fire (exact time-varying Poisson). dt clamped to 10 s. Hard holds freeze Λ (no accrual) and set lastHardHoldAtMs for long kinds.
- λ_total = λ_open + λ_cont + λ_ritual + λ_due. λ_open = λ_b(c)·ρ·s_x·s_clr·m·f·g. λ_b(c) = 0.6·26^(c−0.5)/h (0.118, 0.266, 0.6, 1.355, 3.06 at c = 0, .25, .5, .75, 1). ρ = 0.6 + 0.8·T (T = max thread ripeness). s_x = 0 if Δ_user < 2 min else 1−exp(−(Δ/15 min)²). s_clr = 1−e^(−(now−lastHardHold)/3 min). f = floor 120 s. g = 0.5 in games.
- Unanswered u: u=1 → continuation only for 90 min (λ_cont = K/τ_c·e^(−τ/τ_c), K=0.43, τ_c=20 min → P(continuation) ≈ 0.32, median 14 min), then m=0.5; u=2 → urgent only 4 h then m=0.3; u>=3 → 8 h then 0.2. Recovery m_rec = 1 − D·2^(−(t−since)/60 min), D = 1−m_un(k) on his reply.
- Double text: p=0.15 per spoken fire, offset U(10 s, 50 s), expires at +60 s, cancelled by user turn/hard hold, bypasses floor+hazard, no Λ reset, no u change. (Lower to 0.1 if clingy.)
- Urgent notify (salience>=1): fires first tick with no hard hold (busy-game excepted), leaves Λ/E/u untouched, sets lastFireAtMs. Rituals not damped by m; floor/s_x/hard apply. Optional safety rail 4 non-urgent/h.
- Simulated totals/day incl. rituals: c=0 2.4, .25 3.0, .5 4.2 (median gap 111 min, p90 294, 13% gaps <20 min, min gap exactly 2 min), .75 5.8, 1 7.8. At c=.5 robust to reply rate (3.85 at 30%, 4.58 at 90%).
- Ripening r(τ) = S·N·(1−e^(−x/a))·2^(−x/H), x = τ−τ_min; table: question S.7 τmin 45m a 30m H 4h κ1.0; event S.85 τmin end+15m a 20m H 6h κ1.2; topic/callback S.5 τmin 2h a 60m H 12h κ.8; later S.8 τmin=dueAt a 10m H 6h κ1.2 + λ_due 1/h for 2 h (u=0 only); own-day S.35 const κ .6·(1−2^(−(t−lastOwnDay)/90m)); long-session tier>=2 κ.15; returned κ.25 (τmin 3m, H 15m); notify κ.4; app-switch/burst/wake/went-away/context κ 0.
- Rituals on logical day (rolls 04:00): greeting window 45 min from first present moment if 05:00-15:00, expires if he spoke first (λ 12/h); sign-off 22:30-01:30 λ 1.5/h; state open|done|expired keyed by day. (Luke's third ritual 'back after hours away' to be added: once/day, after >= 3 h away, 20 min window.)
- Selection: competing risks for category (U_cat over λ_j/λ_total), then weighted random within open: w = κ·r^β, β=2 (thread at peak wins ~80%). Argmax rejected: static salience makes her a screen commentator, low weights never surface, flapping, predictability.
- Determinism: rngState uint32 (mulberry32) in GateMemory with pure nextRandom(state) → [u, next]; no random() input (unserializable, breaks stage-shared rule); fixed 5 draws per fire; holds draw nothing; expectedWaitMs = (E−Λ)/λ_total. Matches repo precedent (reaction-strength.ts drawRandom(state)).
- 12 unit tests enumerated (monotone λ_b; seeded 50-day band; floor; urgent bypass; double-text bounds; u phases; m_rec monotone; s_x zero; ripeness shape; rituals once/day; clock jumps; hold leaves rngState).
- Edge cases: backward clock dt=0; forward clamped; leader reload must persist social memory (day, u, awaitingSince, damp, lastFireAt, rngState) else double greeting; promotion sets Λ=0, fresh E, lastHardHoldAtMs=now; busy race restores whole 'before'; hidden stage = hard hold; day rollover resets rituals and u; chattiness change takes effect next tick.
- Type sketches: ReasonKind, ReasonCategory 'open'|'continuation'|'ritual'|'double-text'|'urgent', RitualState, GateLocalTime{dayKey, minuteOfDay}, ThreadSeed, Reason, GatePending(+category, reasonKind, doubleTextOffsetMs), GateMemory (lastEvalAtMs, lastFireAtMs, lastHardHoldAtMs, urge, urgeThreshold, rngState, fires, pending, unanswered, awaitingSinceMs, damp, doubleText, day{key, firstPresentAtMs, greeting, signoff}, lastOwnDayAtMs); GateHoldReason adds 'floor'|'awaiting-reply'|'quiet-unanswered'|'urge'|'safety-cap'; GateFireReason 'urge'|'ritual'|'double-text'|'urgent'|'forced'; GateTraceUrge.
- Risks: without a thread producer ρ=0.6 → rate −15-20%; c=0 still ~2.4/day (half rituals) unless λ_b(0)=0; persisting gate memory is a design change (adopted as announced default).

### Reconciliation (planner)
- Adopt ultrabrain's urge integrator + rngState-in-memory (over architect's draw input) and weighted-random selection (over architect's argmax deferral): both serve IS-1/IS-2 directly and match the repo's checkpointed-RNG precedent.
- Adopt architect's Design B placement (reasons/ modules, ReasonState persisted beside durable gate memory) and its persistence/inspector discipline.
- Thread kinds: question | event | later | topic (ultrabrain's 'callback' renamed to avoid collision with deferred cross-day callbacks D1).
- Rituals: greeting, sign-off, welcome-back (Luke's three).

## Decisions (with rationale)
- Luke 2026-10-29 (batch 1): default rate a few times a day (3-6 per desk day); reasons mostly hers, rarely his screen; Chattiness = mean rate only. (Original 'timing + prompt first' scope superseded by 'design reason sources alongside'.)
- Luke 2026-10-29 (batch 2): own-day topics improvised at fire time (no daily beats); cross-day callbacks deferred, thread store seeded for them; screen reactions eligible = long-session, returned, notifies; extraction uses the chat provider/model.
- Luke 2026-10-29 (frame): imitate the messaging cadence and subjects of a girlfriend.
- Luke 2026-10-29 (batch 3, this session): no new Presence toggles in v1; forced plugin/widget turns start the refractory; test strategy = tests after (agent-executed QA always); extraction visible in the inspector only.

## Scope IN
- C1 hazard gate; C2 reason sources (threads, rituals, own-day, demoted reactions); C3 prompt + trigger + cue; C4 store integration (exchange-end, extraction, persistence, fire flow, forced-turn refractory); C5 inspector panels + Presence copy; C6 docs/tests/verify; branch + PR against lschneiderny/airi.

## Scope OUT (Must NOT have)
- New Presence settings toggles; extraction cues in chat history; changes to hard suppressor order/semantics; changes to notify urgency bypass or forced-turn speech contract; new npm dependencies; stored daily beats; cross-day callback feature; syncing situation/gate/thread state through pinia-synced; editing non-English locales; touching the dirty worktree files (anthropic provider, model-eval plan).

## Plan-consultant round 1 (st_01a189e3, 2026-10-29)
Blocking findings and how they were folded in: commit greenness -> new gate lives in urge-gate.ts beside the legacy gate, consumers switch in 10/15/16, legacy deleted in new todo 22; Wave 3 serialized (9 || 13, then 10 -> 15 -> 11 -> 12); store seed injectable via initialize options so every store test pins it; todo 13 rg narrowed to its own files, repo-wide sweep moved to 22; Reason.text specified via REASON_TEXT table; pickCategory/pickReason contracts defined incl. due and multi-ritual; threads raise-once for every kind and carry sessionId (collector filters by active session); reason optional in ChatUnpromptedPayload with in-store default so context-bridge is untouched; todo 8 gains p90/median >= 2; todo 12 gains no-hook/message-count proof, role-marker and control-char cases, real stream signature, maxTokens, speaker names; todo 20 scenario 2 compares before/after counts and accepts a decline; gh pr view checks baseRepository; eslint instead of pnpm lint; Bash shell note; F4 reads prose; todo 2 failure scenario is a mutation; matrix rows corrected; todo 18 dependencies widened; ADR consequences enumerated.
Decisions recorded from notes: sign-off ritual fires while he is present 22:30-01:30 (not on idle/lock) per the girlfriend frame; the trigger carries only the reason since the situation block carries clock/last-talked/last-said; 'Share the foreground app' off still silences all unprompted turns (hard-suppressor semantics unchanged, documented in ADR); SAFETY_CAP 4/h kept as a rail; gendered copy ('her') kept per the chosen frame.

## Review ledger (plan-reviewer, bounded convergence)
- Round 1 | round r1-152ec4c4 | sha f269d27979644608dda19a63fe370f9b9a8280501a6f8f44d715c71b0e6de9c5 | session st_01a189ef | verdict REJECT | blockers: B1 todo 7 hazards not phase-gated (open/ritual/due accrued during continuation and quiet phases; due lacked exchange factor; awaiting-reply hold blocked the continuation) -> fixed: phase decides allowed categories before accrual, all hazards x exchange x floor, continuation fires when urge crosses; B2 double text armed at fire (declined original could double-text, rearm possible) -> fixed: armed only in recordFireOutcome('spoken') for open/ritual/due, anchored to spoken time, consumed once, never rearmed; B3 todo 15 removed the adapter before todo 16 migrated situation-gate.vue -> fixed: todo 15 keeps legacy inspection fields (adapter-fed), todo 16 switches the page, todo 22 removes legacy fields and adapter. Notes: none. Ledger frozen after this round: {B1, B2, B3}.
- Round 2 | round r2-41d75471 | sha 910332ae84105087902462079a94131cca478556f2e13471352eda1cce41f2d2 | session st_01a189f1 | verdict REJECT | B1-B3 closed (no restatement); new eligible blockers: B4 IS-1/todo 8 counted attempts not spoken openings and modeled no declines -> fixed: spoken-opening metric, seeded decline model, band on spokenOpenings, base-rate tuning rule; B5 IS-9 todo 15/16/22 dropped decision/pick/firesLastHour/history before deletion -> fixed: complete urge payload {trace, decision, history, memory} + follower inspection test; B6 todo 9 10 KB bound impossible -> fixed: 32 KB with a max fixture measured by Blob size. Ledger now {B4, B5, B6} open -> closed in plan.
- Round 3 | round r3-7c99f0f5 | sha 83fd0be9dabb870328eaaff90b38d6aa61f3fed1c71d513e32cd758641f2707b | session st_01a189f3 | verdict REJECT | B4-B6 closed; new eligible blockers: B7 todo 7 'urge unchanged across held ticks' contradicted accrual -> fixed: unchanged only on hard/quiet holds, accumulation-to-fire test added; B8 'due' missing from ReasonCategory and pickReason lacked due metadata/time -> fixed: 'due' added, Reason gains dueAtMs + collector-resolved dueNow, due pick = smallest dueAtMs among dueNow; B9 heldTopics no longer protected screen/notify reasons -> fixed: collector drops held keys for every kind incl. urgent before selection, tests in collect + store. Ledger now {B7, B8, B9} closed in plan.
- Round 4 | round r4-d1ad7bc1 | sha 0344e58fa550c3c78713fee5b2ab794db90e7257286ea24becdd1231e742ad5d | session st_01a189f6 | verdict REJECT | B7-B9 closed; new eligible blockers: B10 todo 7 'on every fire' reset contradicted urgent/double-text preservation -> fixed: three explicit transitions (ordinary resets + 5 draws; urgent and double-text preserve urge/threshold/rngState/fires) with tests; B11 todo 10 markAddressed on fire/decline would consume threads before speech -> fixed: markAddressed no-op for thread keys, threads raised once in the first-literal handler, outcome tests; B12 todo 20 expected +1 history item but a spoken turn stores trigger + reply -> fixed: +2 with roles per chat.contract.test.ts:2299. Ledger now {B10, B11, B12} closed in plan.
- Round 5 | round r5-149c5a8a | sha 1e8a6b7292131ad0fb5c87b16317790fe1333e525efd96ce043a1d0aaef0476c | session st_01a189fa | verdict REJECT | B10-B12 closed; new eligible blockers: B13 todo 8 calibration contradicted IS-8/todo 3 pinned 0.6 -> fixed: IS-8 names the coefficient as the single calibration constant, todo 3 tests ratios against the constant; B14 todo 12/15 ledger type cycle -> fixed: ThreadExtractionLedgerEntry defined in todo 15, imported by todo 12. Round limit 5 reached; asking Luke whether to extend.
- Round 6 | round r6-e2e92973 | sha 6f023a061b693a506f618e7517b257d8760fe553441c818a03a65d7504855f4e | session st_01a189fd | verdict OKAY (unconditional approval, no notes). Live plan re-hash at handoff: 6f023a061b693a506f618e7517b257d8760fe553441c818a03a65d7504855f4e (match). Convergence: 6 rounds, 14 blockers raised and closed, 0 open.

## Open questions

## Approval gate
status: awaiting-approval
next-action: on approval -> scaffold plan (no --draft-only), plan-consultant gap analysis, append todos, TL;DR, then plan-reviewer rounds (review_required: true).
brief-presented: 2026-10-29 (see chat).
approved: 2026-10-29 via ask_user_question header Approval -> 'Approve'. Authorizes plan creation only.
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
