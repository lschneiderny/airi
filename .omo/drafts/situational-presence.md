---
slug: situational-presence
status: approved
intent: clear
review_required: true
plan_path: .omo/plans/situational-presence.md
phase: review_approved
plan_sha256: 92b6e1b78cc5e22130c655688756c24bf2a048510f88c8ef75e5a031cc333766
review_round_id: sp-r8-mvg48yqs
review_round_limit: 8 (owner-approved re-review 2026-10-20 plus closure rounds for its blocker)
round_status: approved
convergence_ledger:
  rounds: 5
  accepted_blockers: ["B1 round 4: IS-8 vs todo 18 denylist contradiction - resolved to title-denylist reading"]
  non_blocking_notes_open: ["r5: IS-11 wording says sampling in main while polling is renderer-driven (behavior met)", "r5: todo 11 reads context.origin from todo 20 (implied by wave order)", "r5: todo 15 falls back to https://koffi.dev/ if Context7 is unreachable"]
review_history:
  - round: sp-r4-mvfpmio4
    plan_sha256: 7983d52014565d4a92afb8fcda7b56b21e400a673b20e67bd37793e6b89a6334
    session: st_01a155dd
    result: REJECT - accepted blocker B1 (explicit_requirement_or_accepted_decision): IS-8/Must-have said denylisted apps never reach the model, todo 18 reports them by name; resolved to the owner's title-denylist reading (D9). Note folded: dispatchSparkNotifyPerformance 5 s default raised to 30 s.
  - round: sp-r3-mvfpirh8
    plan_sha256: 0bfd2683cf6c988e06ca2f7e58dd53008fa0e61bc3e6979f6cf418243f145e55
    session: st_01a155da
    result: OKAY with notes (unprompted onBeforeSend counted as user engagement - IS-2 gap; BASE_SALIENCE unspecified; todo 27 wording); smallest fixes for the first two, round superseded
  - round: sp-r2-mvfpdtgw
    plan_sha256: 5952d236cc4dd4a8d744558c7e0775d9dd81bc20b16a438b1bbfc2dcdb7213fe
    session: st_01a155d6
    result: OKAY with notes (settingsEntry registration, handleIncomingSparkNotify, stub tool_calls, wave-internal chains); smallest fixes applied, round superseded
  - round: sp-r1-mvfp7r0u
    plan_sha256: 73ea14a4bf473f90b24405842fba7a0f76b81d22b17e3f3bebf74e0467e7591e
    session: st_01a155d2
    result: OKAY with notes; plan edited afterwards (smallest fixes), round superseded
pending-action: handoff delivered; execution starts only via /ulw-execute situational-presence
review:
  plan_reviewer:
    status: approved
    workspace_root: C:/Users/Luke/projects/dtuber
    runtime_home: null
    target: .omo/plans/situational-presence.md
    round_id: sp-r8-mvg48yqs
    plan_sha256: d36d477ea425054e70c74985c12f2b2c31c0dfce9427381feb0523c2779fce8d
    launch_id: sp-l8-73f6e7aa
    session: st_01a15753
    result: "OKAY round 8 on d36d477e (B1-R closed). Notes N1-N3 folded afterwards as a notes-only delta -> 92b6e1b78cc5e22130c655688756c24bf2a048510f88c8ef75e5a031cc333766; no further round (owner asked for one re-review; 3 rounds run)."
    round7: "REJECT B1-R (key builder in stage-ui unreachable from stage-shared reducer; todo 26 eventId=id not overridden; vacuous test) on c514a32a; fixed: notifyTopicKey in stage-shared todo 7, notifyObservationFrom single producer, eventId override, test asserts one event addressed + no-topic"
    round6: "REJECT B1 (notify topic key mismatch todo 27 vs 26, IS-2/IS-4) on b66c5cd9; fixed with notifyTopicKey helper tag [8,26,27] + notes N1 (composer activity bus event), N2 (setStageVisible from App.vue), N3 (todo 2 QA)"
    reviewer: omo-native-gate-reviewer (anthropic-subscription/claude-opus-5-5); plan-reviewer refused by the plan-gate outside a ulw-plan workflow
    result: null
    previous: "sp-r5-mvfpsmvw OKAY on b16a279f; superseded by amendments 2026-10-19 and 2026-10-20"
approach: "Eight waves: (0) character-neutral stage contract + card-owned persona + tolerant ACT; (1) pure situation core in stage-shared; (2) situation store + all context sources as sensors, replacing [Context]; (3) Windows foreground sensor via koffi + situation-aware attention; (4) unprompted-turn runtime contract + chat delivery; (5) opportunity gate + controls; (6) spark:notify observe+gate rework; (7) ACT look cue, inspector completion, ADR/docs; then F1-F4."
---

# Draft: situational-presence

## Affected user and ideal state
<!-- Who this output touches (a customer, another programmer, a program or agent consuming it - often more than one) and how each uses it today and will use it after. -->
<!-- IS-n | property of the ideal state: nothing snags, feels odd, regresses, or degrades for them | reason -->
<!-- GAP-n | difference between IS-n and today | reason | closed by todo(s) -->

North star (Luke, 2026-10-19): the experience must feel like he created "a VTuber stuck in the corner of my screen".

Affected users:
- U1 Luke at the desk (gaming, working, browsing) with the Electron stage in a screen corner. Today: she only reacts when spoken to, knows nothing about what he does, never speaks first. After: she is visibly aware, occasionally speaks up at sensible moments, stays quiet when he is busy, and backs off when ignored.
- U2 Luke as character author (card editor, own persona). Today: upstream AIRI ACT rules and a shared "do whatever you want!" closing ride every character. After: persona is fully card-owned; the stage mechanics are a compact character-neutral contract.
- U3 The chat model (local 8B-14B or cloud) consuming prompts. Today: raw [Context] dump on every request, ACT rules re-sent per request on the user turn, strict marker grammar. After: one bounded timestamped situation block, stable rules in the cached system prompt, forgiving body grammar, a clear way to decline unprompted turns.
- U4 Programs: plugins/integrations sending context:update and spark:notify; spark:command consumers (e.g. Minecraft). After: their events still arrive, now as situation observations; spark:command outputs unchanged.
- U5 Future maintainers/agents. After: pure replayable reducer and gate with trace tests and a devtools inspector.

Ideal state (IS) rows:
- IS-1 | She speaks up only at sensible moments: a real, settled situation change or an urgent notify; at most ~4/h with >=10 min gaps scaled by one Chattiness setting; never while either party speaks, while a turn generates or is queued, while away/locked/hidden, during Windows busy/fullscreen/presentation/quiet time, in quiet apps (calls), or under don't-disturb | otherwise she is random or annoying (Luke's stated failure mode)
- IS-2 | She is never repetitive or pushy: one topic per remark, a topic is re-raised only at its next tier, ignored remarks lengthen the gap, SILENT declines leave no visible trace | repetition is the main annoyance source
- IS-3 | When spoken to she knows what is going on: every request carries one bounded '[Situation HH:MM]' block (current app/title and duration, presence, recent notable changes with relative times, game/plugin/vision context, expression/mood) instead of the raw [Context] dump | awareness without overload
- IS-4 | Notify-driven reactions are part of the conversation: spark:notify becomes an observation; when spoken it is a normal paced turn that is persisted, visible in chat, interruptible, never overlapping chat speech; spark:command outputs and the plugin reaction request/response API keep working | today reactions are spoken off-history and unpaced (F22-F23)
- IS-5 | The body channel tolerates weak models: compact ACT rules in the system prompt; bare-word and JSON ACT forms both perform; motion and emotion in one ACT both apply; malformed markers are never spoken; devtools shows per-turn ACT compliance | F13-F14
- IS-6 | Attention is expressible: the model can direct gaze per segment (you / screen / away) in Natural; listening and watching stay fast-loop and become situation-aware (watches the screen while a game is foreground) | inference must stay out of the animation loop
- IS-7 | Persona is card-owned: no upstream AIRI persona text or 'do whatever you want' closing in custom characters; a character-neutral, cache-stable stage contract in the system prompt with English fallback for other locales; the built-in AIRI card keeps its persona as its own description | F10-F12
- IS-8 | Privacy and control: Chattiness, don't-disturb, quiet apps, title denylist settings; AIRI's own windows never reach the model; titles of denylisted apps never reach the model (name and category still do); window titles never persist to chat history or sync | full titles were chosen (D9)
- IS-9 | Observability: a devtools Situation inspector (state, decayed salience, rendered block, gate decision trace with reasons, ACT compliance); reducer/gate/render covered by deterministic replay tests | tuning and agent QA need it
- IS-10 | No regressions: reactive text and voice chat, interruptions, stickers, tools, retries, Minecraft commands, widget spark bridge, stage-web/Pocket and Kirie keep working; non-Electron hosts degrade to unknown signals with no unprompted turns | personal fork still uses these
- IS-11 | Cheap while gaming: sensors and gate use no GPU and no LLM call unless a turn fires; foreground sampling in Electron main at ~1 Hz | dtuber runs beside games
- IS-12 | Robust lifecycle: stale sensor samples count as unknown and suppress; leader promotion never causes a burst; a user message during an unprompted turn wins | architect risk 3

Gap rows:
- GAP-1 | No unprompted path: performSend needs text and commits a user message (F1-F3); no gate exists | closes IS-1, IS-2, IS-12
- GAP-2 | Ambient context is an unbounded raw bucket dump with no time, salience, or budget; desktop signals never reach the prompt; no foreground sensor (F3, F16, F20) | closes IS-3, IS-8, IS-11
- GAP-3 | Spark reactions speak through a side path with no history, pacing, or session (F22-F24) | closes IS-4
- GAP-4 | ACT parsing is JSON-or-nothing, motion early-return drops emotion, no compliance visibility (F13-F14) | closes IS-5
- GAP-5 | No attention input except a devtools override; resolver ignores what is on screen (F15) | closes IS-6
- GAP-6 | Upstream persona/suffix and per-request ACT rules ride every character; locale gate returns '' when keys are missing (F10-F12) | closes IS-7
- GAP-7 | No settings, no inspector for any of this (F18-F19) | closes IS-8, IS-9
- GAP-8 | Existing consumers (Minecraft, widgets, web/pocket, tests) must survive the changes | closes IS-10

## Components (topology ledger)
<!-- Lock the SHAPE before depth. One row per top-level component that can succeed or fail independently. -->
<!-- id | outcome (one line) | status: active|deferred | evidence path -->
- C1 | Sensors: Windows foreground app+title (koffi), desktop presence, conversation timing, converted context sources (vision, Minecraft, plugin context:update, stage expression/mood) emit typed observations | active | pending explore
- C2 | Situation model: pure reducer + budgeted renderer in stage-shared; replaces raw [Context] dump on every turn | active | pending explore
- C3 | Unprompted turns: opportunity gate + runtime delivery (input:unprompted, SILENT decline, control record, backoff) | active | pending explore
- C4 | Spark-notify performed: reactions go through the gate/runtime so they speak, act, caption; spark:command preserved | active | pending explore
- C5 | Body channel robustness + attention cue for weak models | active | pending explore
- C6 | Persona / stage contract: card-owned persona, character-neutral stage contract in system prompt | active | pending explore
- C7 | Controls + observability: settings (Chattiness, DND, quiet apps, title denylist), devtools Situation inspector, ADR/docs | active | pending explore

## Open assumptions (announced defaults)
<!-- Record any default you adopt instead of asking, so the user can veto it at the gate. -->
<!-- assumption | adopted default | rationale | reversible? -->
- A1 | Package layout: pure situation core in stage-shared (./situation subpath), leader store + sensor adapters in stage-ui, koffi sensor in Electron main with contract in electron-eventa | architect Option A; stage-shared has no core-agent dep | yes
- A2 | Unprompted turn = runtime `origin: 'unprompted'` + decline marker; a stamped user trigger message (topic text from app label/category/duration, never the raw title) keeps alternation and time prefix; on SILENT the runtime does not append the assistant message and settles 'declined'; host deletes the trigger and writes a control record | architect Q2; avoids duplicating performSend | yes
- A3 | No input:unprompted protocol event; origin is local | protocol untouched | yes
- A4 | Unprompted trigger rows render in chat as a muted 'spoke up about X' line; excluded from cloud sync | visible why she spoke | yes
- A5 | Foreground sensor samples ~1 Hz in main and keeps running while the stage is hidden; gate suppresses when hidden | knows what happened while minimized | yes
- A6 | Gate runs only on Electron (desktop presence available); web/Pocket get the situation block but no unprompted turns | no presence signal elsewhere | yes
- A7 | Self-observation guards: default denylist of AIRI's own windows; events caused by her own turns tagged origin self and never selected as topics | architect risk 2 | yes
- A8 | Stale samples (> ~5 s) = unknown = suppress; leader promotion initializes gate memory as if a turn just fired | architect risk 3 | yes
- A9 | ACT grammar: bare-word form `<|ACT happy|>` / `<|ACT happy strong|>` plus JSON for expression/look; parser accepts both; Live2D motion no longer drops emotion | weak-model robustness | yes
- A10 | Attention cue: ACT `look: you|screen|away` held until the next ACT or turn end, Natural driver only; resolver attention also reads foreground category (game -> screen while watching) | IS-6 | yes
- A11 | Stage contract (ACT/DELAY rules, emotion list, speech-safe text rule) moves to the system prompt via systemPromptSupplement, English-source with fallback when the active locale lacks the key; base.prompt.suffix removed from the English source and from composition; other locales untouched (Crowdin) | IS-7, repo i18n rule | yes
- A12 | Default numbers: settle 75 s, in-exchange 120 s, min gap 10 min, cap 4/h, ignore window 120 s, backoff x2 per 2 ignores, Chattiness 0.5 scales all; exported as documented tuning constants | starting values, Luke tunes later | yes
- A13 | QA uses a local scripted OpenAI-compatible stub server (Bun.serve SSE) as the chat provider so unprompted/SILENT/ACT flows are deterministic in Electron QA | zero human verification | yes
- A14 | Kirie and the Godot sidecar are out of scope | prior plans excluded them | yes

## Findings (cited - path:lines)
Runtime / unprompted (explore st_01a155bc + direct reads):
- F1 performSend drops a turn with empty text and no attachments as its first line; `accepted` then rejects (packages/core-agent/src/runtime/chat-orchestrator-runtime.ts ~592, queue finally ~1262).
- F2 performSend always commits a role:'user' message (commitUserMessage) with id=roundId; turnIndex = user count + 1; analytics `source` is 'voice'|'text' only (hasVoice at :668-669).
- F3 Runtime contexts attach only when `context.turns.at(-1)?.type === 'user'` (performSend step 18); test chat-orchestrator-runtime.test.ts:580 pins it.
- F4 Conversation `Turn = UserTurn | AssistantTurn | SystemTurn` (core-agent/src/messages/types.ts:30). Projection entries with role context/event/summary render as role 'user' (messages/chat-completions.ts renderEntry). readTurns merges adjacent assistant entries into one AssistantTurn (turns.ts).
- F5 buildContext prefixes every stored user message with `[YYYY-MM-DD HH:MM] ` (datetime-prefix.ts); there is NO date-anchor implementation despite the comment at runtime :617.
- F6 WebSocketEventInputs = input:text | input:text:voice | input:voice (packages/server-shared/src/types/websocket/events.ts:62-65); plugin-protocol mirrors it (plugin-protocol/src/types/events.ts:635-636). Only runtime consumer of input.type: hasVoice and the queue snapshot inputType (:1321).
- F7 Session controlEvents are typed StoredVoiceInterruption only (stage-ui/src/types/chat-session.ts:6-18), written only by recordInterruption (session-store.ts:392-399), injected only for voice turns (chat.ts:862-869), uncapped.
- F8 Chat UI history.vue renders assistant items without depending on a preceding user item; retry only when preceded by user (history.vue canRetryMessageAt).
- F9 Marker parser: `<|...|>` and escaped `<{'|'}...{'|'}>`; holds a 5-char tail; an unterminated tag at stream end is silently dropped (llm-marker-parser.ts:79-130). Stage literals stream to TTS as they arrive (Stage.vue onTokenLiteral -> voice.getSpeech(context).write).

ACT / persona (explore st_01a155be):
- F10 base.yaml keys: prefix(6) persona, emotion(27) ACT/DELAY/CALL grammar, emoji(65), expressions(67), expression-state(72), suffix(74). suffix used only at use-airi-runtime-prompt.ts:55. prefix is the built-in card description (airi-card.ts:540) and builtInDescriptions (:62-66).
- F11 Nine other locales (es, fr, ja, ko, ru, vi, zh-Hant, th, zh-Hans) define prefix/emotion/emoji/suffix; only en defines expressions/expression-state. useAiriRuntimePrompt returns '' if the ACTIVE locale lacks emotion/emoji/suffix (use-airi-runtime-prompt.ts:45-46).
- F12 System message = codeBlockSystemPrompt + mathSyntaxSystemPrompt + card prompt (session-store.ts:128-135, :199). resolveSystemPrompt joins systemPrompt, description, personality, scenario, artistry widgetInstruction (airi-card.ts:71-86).
- F13 ACT parsing lives in packages/pipelines-audio/src/llm-streaming-control/ (parsers/act.ts strict `<|ACT ` + JSON object; controller.ts rejects silently with no-matching-parser / parse-failed; payloads.ts normalizeActPayload: 9 emotions, unknown emotion dropped silently, intensity bands).
- F14 Stage.vue:371-392: a Live2D `act.motion` returns early and SKIPS emotion/expression in the same ACT. No reply-without-ACT fallback exists.
- F15 Conductor (use-stage-performance-conductor.ts:158+) has no attention/gaze method; attention is derived in resolvePerformanceState (performance-state/index.ts:298-303) with only a devtools `override` input (Stage.vue:435-444, natural-performance-override.ts:25).

Sensors / surfaces (explore st_01a155bf):
- F16 Eventa electron contracts live in packages/electron-eventa/src/electron/*.ts (powerMonitor.ts:3-23); main services in apps/stage-tamagotchi/src/main/services/electron/ wired per window at windows/shared/window.ts:181; renderer producer apps/stage-tamagotchi/src/renderer/stores/desktop-activity.ts polls 1 Hz ONLY while the stage window is visible, started from renderer/pages/index.vue:41,105-107.
- F17 Native deps: electron.vite.config.ts main.build.externalizeDeps.include list; electron-builder asarUnpack '**/*.node' (:111-114); pnpm-workspace.yaml catalog + catalogMode prefer, allowBuilds map, minimumReleaseAge 4320.
- F18 Settings pattern: useLocalStorageManualReset with clamping serializer (stage-ui-live2d/src/composables/live2d/live2d.ts natural-energy), UI in stage-ui/src/components/scenarios/settings/model-settings/live2d.vue:427-428, browser test live2d.browser.test.ts:430-547.
- F19 Devtools pattern: packages/stage-pages/src/pages/devtools/context-flow/index.vue + store stage-ui/src/stores/devtools/context-observability.ts (bounded history 200); tamagotchi devtools window windows/devtools/index.ts.
- F20 Context sources: createMinecraftContext (context-providers/minecraft.ts:10, contextId system:minecraft-integration), createRuntimePromptContext (runtime-prompt.ts:9), registered at chat.ts:675-676; vision publishes via channel-server sendContextUpdate (orchestrator.ts:61+); context-bridge ingests context:update and rebroadcasts over BroadcastChannel; senders: integrations/minecraft airi-bridge.ts:157, integrations/vscode airi.ts:50,55, plugins/airi-plugin-web-extension client.ts:106-119.
- F21 performance-state test style: T0 constant, quietDesktop/inputsAt fixtures, run(frames) helper, explicit timestamps, no timers (performance-state/index.test.ts).

Spark (explore st_01a155bd + direct reads) - CORRECTS gap 2:
- F22 Spark reactions ARE spoken: character/index.ts:77 creates `new Speech({sessionId: activeSessionId, turnId: 'spark:<id>'}, 'notification')`; literals -> speech.write, specials -> speech.special; voice.ts:423 opens the producer on the same VoiceResponse/output factory Stage connects (connectOutput), so TTS, ACT (onSpecial) and captions (onPlaybackStart) do happen.
- F23 What is missing: reactions are never persisted to chat history (only characterStore.reactions, cap 200, read by devtools + handleSparkNotifyWithReaction), so she forgets saying them and the user cannot see or reply in chat; no pacing beyond urgency (immediate runs inline); no chat `sending` state; separate LLM call with the ACTIVE card/provider rather than a session.
- F24 Producers: minecraft airi-bridge.ts:126 (destinations proj-airi:stage-*), web extension client.ts:121-137 ('User is watching: <title>', destinations character), context-bridge local synthesis :241-270 (widgets via extension-ui-host.vue:126-128 + Kirie copy; returns reaction text or fallbackText; forceResponse/forceTextResponse/forceSparkCommandResponse/messageOverride; dispatchSparkNotifyPerformance with calls), notebook task scheduler (no production producer of tasks), devtools simulator.
- F25 spark:command produced by agent builtIn_sparkCommand (expandCommand drops empty destinations, parentEventId=notify id) and by chat tool-resolver.ts:111-122; consumed by minecraft airi-bridge.ts:49-101 (queued/dropped acks) and gaming-minecraft.ts devtools log.

## Decisions (with rationale)
Carried from the 2026-10-19 design discussion (owner decisions, see memory reference/projects/dtuber-situational-awareness.md):
- D1 Four layers: sensors -> deterministic situation model -> opportunity gate -> delivery through the normal chat runtime.
- D2 Sensors v1: desktop + conversation + NEW Windows foreground app/title. Vision-on-change and game integrations are not new sensors in v1, BUT all existing context sources are converted to sensor adapters (D7).
- D3 Gate + LLM veto: code decides when; the model decides whether/what; may decline with <|SILENT|>.
- D4 First deliverable ordering: awareness on normal turns before the proactive gate.
- D5 Situation model = only ambient-context channel; conversation history stays verbatim; gate only for unprompted turns and overheard input; messages addressed to her bypass the gate.
- D6 Stable ACT/emotion rules move to the system prompt; live expression/mood state moves into the situation block.
- D7 Convert ALL existing context sources (vision, Minecraft, plugin context:update, runtime prompt state) into sensors in v1.
- D8 Automatic shownAt/addressedAt mention flags; no model bookkeeping marker.
- D9 FULL window titles go to the model, with normalization and an app denylist.
- D10 Situation state in-memory per run.
- D11 Foreground sensor via koffi FFI (GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId, QueryFullProcessImageNameW, SHQueryUserNotificationState); needs pnpm allowBuilds entry; Context7 docs read before adding.
- D12 Engagement backoff on; idle chatter off in v1; SILENT leaves a control record only.
Asked in this planning session (2026-10-19):
- D13 Spark path = Observe + gate: every spark:notify becomes a situation event; speech only via paced unprompted turns (immediate/critical skip timing guards, never hard suppressors); spark agent stays commands-only for notifies whose destinations go beyond 'character'; widget/context-bridge reaction requests become forced unprompted turns that return the reply text (API contract kept); characterStore side-path speech removed (devtools log may remain).
- D14 Chat display: muted 'spoke up about X' cue above the unprompted reply, ON by default, with a setting to disable it (trigger still sent to the model when hidden).
- D15 Test strategy: tests-after (each todo ships its tests) + agent-run Electron QA with a scripted OpenAI-compatible stub LLM; rendered acceptance on one Live2D rig suffices (Luke's standing preference).

## Scope IN

## Scope OUT (Must NOT have)

## Open questions

## Approval gate
status: approved (2026-10-19, Luke chose 'Approve' in the Approval question; review stays required)
next workflow action: on Approve -> rerun scaffold without --draft-only, plan-consultant gap analysis, append todos, fill TL;DR, then plan-reviewer rounds (max 5). Note: a prior session's plan-gate refused reviewer spawns when approval came only from a question-menu choice; if that recurs, ask Luke to type approval in his own words.
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
