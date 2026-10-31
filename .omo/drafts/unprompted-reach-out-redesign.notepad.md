# Ultrawork Notepad - plan the unprompted-message redesign (girlfriend cadence)
Started: 2026-10-29T22:29:42.538Z
Run root: H:\temp\ulw-unprompted-YNJqj2

## Tier
LIGHT for THIS session: the deliverable is a plan file under .omo/plans; no product code is edited here. Payload (the redesign) is HEAVY and sizes the executor session.

## Skills in use
- ulw-plan: the requested workflow (read SKILL.md + full-workflow + intent-clear + stance-calibration).
- enforce-rules-for-typescript / vitest / pinia-synced: named in plan todos for the executor; not opened here.
- memory-discipline: decisions recorded to reference/projects/dtuber-unprompted-timing-redesign.md.

## Plan (exhaustively detailed)
1. Scaffold draft .omo/drafts/unprompted-reach-out-redesign.md (--clear --review-required).
2. Discovery wave: explore x3 (situation store+chat unprompted path+prompt assembly; background LLM call patterns+persistence patterns; devtools/settings/i18n/tests surface), architect lane (boundaries), ultrabrain lane (hazard model + reason contracts), own reads of render.ts/conversation sensor/observability.
3. Record affected user, IS rows, GAP rows in draft; intent verdict CLEAR, review_required true.
4. Topology lock + surviving owner-decisions -> ask (batch renderer per memory episodes).
5. Approval brief -> ask Approval (required).
6. After okay: scaffold plan, plan-consultant gap analysis, append todos, TL;DR last, structural self-check.
7. plan-reviewer rounds until approval (bounded convergence), record receipts in draft.
8. Deliver handoff summary; record planning-style episode; cleanup RUN_TMP (keep notepad copy path in final message).

## Success criteria + QA scenarios
SC1: .omo/plans/unprompted-reach-out-redesign.md exists, passes structural self-check (column-zero rows, categories), every GAP row closed by a todo, every IS row in Success criteria. Evidence: self-check script output.
SC2: plan-reviewer unconditional approval recorded in the draft with session receipt and matching sha256. Evidence: draft review ledger.

## Now
Bootstrap + discovery wave

## Todo
(see todo tool)

## Findings
- gate.ts: fire-ASAP-after-gap model; default chattiness 0.5 -> threshold 0.4, gap 10 min, cap 4/h; IN_EXCHANGE=IGNORE_WINDOW=120 s; backoff 2^level max 3.
- types.ts BASE_SALIENCE: app-switch .5, long-session .6, returned .6, wake .5, context-vision .4; half-lives 10-30 min.
- chat.ts submitUnprompted: trigger text "(No one spoke to you. You may speak up about: X)", instruction base.prompt.unprompted(-forced).
- stores/situation/index.ts: gateTick on GATE_INTERVAL_MS; fire() -> markAddressed -> submitUnprompted; promotionGateMemory/visibilityRegainGateMemory.
- pickCandidate requires origin 'world'; self-origin excluded.
- No long-term memory store in stage-ui; notify producers: spark:notify (plugins, task scheduler reminders).

## Learnings

## Findings (wave 1, own reads)
- GATE_INTERVAL_MS=2000, ADVANCE_INTERVAL_MS=1000 (stores/situation/index.ts:49,56).
- conversation sensor: user obs from onBeforeSend (user-origin only), character obs from first of onAssistantMessage/onChatTurnComplete, carries origin (sensors/conversation.ts).
- render.ts: block = [Situation HH:MM] + presence, activity (Now/Before that), New: x2 (salience>=0.2), conversation ('You two last talked...', 'You last spoke up on your own ... about ...'), contexts, stage; 6 lines/500 chars budget.
- Draft now holds U1-U5, IS-1..13, GAP-1..13, components C1-C6, D1-D2.
- Dirty worktree: anthropic provider test+index modified, model-eval draft/plan untracked -> out of scope risk.
## Now
Waiting on lanes st_01a189ca..ce; then record findings + topology + intent verdict.

## Findings (lane explore-llm-persistence, st_01a189cb)
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

## Intent + stance
CLEAR, review_required true, Architecture class, batch renderer. Defaults recorded in draft. Surviving owner-decisions to ask: new Presence toggles (public config), forced plugin turns start refractory (plugin-visible), test strategy, extraction visibility. Ultrabrain lane st_01a189ce still running.

## Forks answered (batch 3)
no new toggles | forced turns start refractory | tests after | extraction inspector-only

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

## Approval
Approved 2026-10-29 ('Approve'). Plan scaffolded.
## Now
plan-consultant gap analysis + append todos

## Structural self-check (pre-consultant)
{"headingsOk":true,"headings":["## TL;DR (For humans)","## Scope","## Verification strategy","## Execution strategy","## Todos","## Final verification wave","## Commit strategy","## Success criteria"],"implRows":21,"implInTodos":21,"finRows":4,"finInFin":4,"sequential":true,"missingCat":[],"catCount":{"unspecified-low":3,"quick":2,"deep-low":10,"deep-high":2,"visual-engineering":2,"writing":2},"gaps":["GAP-1","GAP-2","GAP-3","GAP-4","GAP-5","GAP-6","GAP-7","GAP-8","GAP-9","GAP-10","GAP-11","GAP-12","GAP-13"],"uncovered":[],"isRows":13,"isMissing":[],"chars":95498}

## Consultant round folded in; self-check after
{"headingsFirst":"## TL;DR (For humans)","implRows":22,"finRows":4,"numbers":"1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22","missingCat":[],"uncovered":[],"isMissing":[],"chars":107021}

## Review round 1
sha256=f269d27979644608dda19a63fe370f9b9a8280501a6f8f44d715c71b0e6de9c5 round=r1-152ec4c4 launch=l-eb2b130b
reviewer session st_01a189ef in_flight

## Review round 1: REJECT (B1 phase gating, B2 double text arming, B3 todo 15/16 greenness) -> fixed. Round 2 sha=910332ae84105087902462079a94131cca478556f2e13471352eda1cce41f2d2 round=r2-41d75471

## Review round 2: REJECT (B4 spoken openings/declines, B5 inspector payload, B6 size bound) -> fixed. Round 3 sha=83fd0be9dabb870328eaaff90b38d6aa61f3fed1c71d513e32cd758641f2707b round=r3-7c99f0f5

## Review round 3: REJECT (B7 accrual test, B8 due category, B9 heldTopics) -> fixed. Round 4 sha=0344e58fa550c3c78713fee5b2ab794db90e7257286ea24becdd1231e742ad5d round=r4-d1ad7bc1

## Self-check at round 4 plan
{"firstHeading":"## TL;DR (For humans)","implRows":22,"finRows":4,"missingCat":0,"uncovered":[],"isMissing":[],"catCount":{"unspecified-low":4,"quick":2,"deep-low":10,"deep-high":2,"visual-engineering":2,"writing":2},"waves":{"0":1,"1":5,"2":2,"3":6,"4":5,"5":3},"kb":110}

## Review round 4: REJECT (B10 fire transitions, B11 thread consumption, B12 +2 items) -> fixed. Round 5 sha=1e8a6b7292131ad0fb5c87b16317790fe1333e525efd96ce043a1d0aaef0476c round=r5-149c5a8a

## Review round 5: REJECT (B13 calibration vs IS-8, B14 ledger cycle) -> fixed. Live sha=6f023a061b693a506f618e7517b257d8760fe553441c818a03a65d7504855f4e. Round cap reached; asking to extend.

Luke: extend by 5 rounds. Round 6 sha=6f023a061b693a506f618e7517b257d8760fe553441c818a03a65d7504855f4e round=r6-e2e92973

## Review round 6: OKAY. live sha 6f023a061b693a506f618e7517b257d8760fe553441c818a03a65d7504855f4e match=true. Goal complete pending handoff.
