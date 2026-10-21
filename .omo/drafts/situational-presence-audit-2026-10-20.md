# situational-presence pre-implementation audit (2026-10-20, main 59b9741)

Lanes: architect st_01a15744 (design fit), explore st_01a15743 (todos 2-6), st_01a15745 (20-22, 30), st_01a15746 (7-12, 14, 19, 29), st_01a15747 (13, 15-18, 23-28; pending).
Verdict so far: design still fits main; no layer conflicts with natural-emotion-revamp holds. Edits below are corrections and missing rules, not redesigns.

## Proposed plan edits (amendment 2026-10-20)

### Todo 2 (stage contract)
- `fallbackLocale: 'en'` exists (`packages/i18n/src/fallback.ts:13`) and every locale defines emotion/emoji/suffix: replace the `te(key, locale)` gates with `t()`; drop the "th missing emoji" framing (keep a mocked-missing-key unit test only).
- Avoid `useI18n` inside session-store setup (browser tests may lack i18n): keep `systemPromptFrom` pure and pass the stage contract in from `chat.ts` (setter or argument); watch the contract from there.
- Spark-notify agent keeps `runtimePrompt` (`orchestrator/store.ts:23, 139`; `agent.ts:81`): pass the stage contract via its `systemPrompt` and only the live state via `runtimePrompt`; update `orchestrator/index.test.ts:354-355` (assertion moves from user message to system message).
- Stored system message refreshes only for the active session; `resolveStep` re-reads per step, so claims are about requests, not stored copies.

### Todo 3 (English contract)
- Depends on todo 4 as well as 2 (never teach the short form before the parser accepts it). Non-English locales keep their own old contract (Crowdin); state it in the ADR (todo 31).

### Todo 4 (bare-word ACT)
- `<|ACT banana|>` must be rejected in `parsers/act.ts` by validating the word against the emotion set (export it from `payloads.ts` or validate through `normalizeActPayload`), otherwise the controller reports `parsed`.
- Check `packages/stage-ui/src/composables/queues.ts:24` `parseActEmotion` (JSON-only regex); if on a live path, route it through the shared parser or remove it.

### Todo 5 (marker recovery)
- Add `stats` to the object returned by `useLlmmarkerParser` (it returns only `{ consume, end }` today).
- Recovered markers must also be removed from the `fullText` passed to `onEnd` (feeds `categorizeResponse`).
- Cover the greedy `inTag` case: `<|ACT happy>` (no `|>`) must not swallow later prose/markers; flush or recover within 64 chars inside the `inTag` branch too. Recovery runs after escaped-form normalization.

### Todo 6 (motion + emotion)
- Acceptance asserts episode ORDER (explicit emotion, then expression-derived episode when the entry has mappings), not which hold survives; add an `applyHolds` recorder to the browser test; also cite `use-stage-performance-conductor.test.ts`.

### Todo 10 (situation block)
- Also change the stage-ui copy `packages/stage-ui/src/stores/chat/context-prompt.ts` and its test (pins `[Context]` at 43, 48, 59, 84); devtools preview imports it (`context-observability.ts:10`).
- Runtime test pin is at `chat-orchestrator-runtime.test.ts:646`.
- The situation provider must return no block (not throw) when the store is uninitialised (Kirie `src-web/.../App.vue:230` shares the chat store).

### Todos 11 / 24 (freshness)
- Power events publish while the stage is hidden with a fresh `sampledAtMs`; the gate must also read stage visibility (`useStageWindowLifecycleStore`) as a hard suppressor, not rely on staleness alone.

### Todo 20 (runtime contract)
- `origin`/`trigger` go on `UserMessage` (or a user-only intersection), not the shared `ChatHistoryItem`.
- Decision is made on `speechOnly` (post-categorizer); SILENT inside reasoning never declines.
- Decline also skips `onAssistantResponseRendered`, `onMessageRound`, `onChatActivationSucceeded`, and calls `resetForegroundStream`; defer start telemetry (`onTrackFirstMessage`, `onChatActivationStarted`, `onMessageSendStarted`) and `isActivationAttempt` to the decision.
- Unprompted turns send no tools.
- Mid-stream commit: handle `existing`/abort via a flag; persistence failure after speech started is a stream error.
- Buffer `buildingMessage`/`updateStream` (incl. reasoning) during HOLD.
- Test: cancel during HOLD closes the voice response via `voiceGenerationEnded`.
- Set `cueStats` (todo 30) with `origin` before `emitStreamEndHooks` on both paths.

### Todo 21 (chat delivery)
- `declined` -> `cancelled` mapping at `chat.ts:683`, plus `settleOwnedTurnSpan` type.
- Use `startSend` (no `appendSendError` bubble for failed unprompted turns).
- Expose user-origin `sending` for the presence bubble, the resolver's `generating`, and the history streaming placeholder; skip the Think motion in `onBeforeSend` for `origin === 'unprompted'`; the gate still reads raw `sending`. Browser test: an unprompted request in flight leaves presence idle.
- Defer the caption reset before the `speechMuted` early return in `onTokenLiteral`.
- Decide `voice.interrupt`/`beginInput` handling of a held unprompted turn (cancel without writing a `StoredVoiceInterruption` when nothing was spoken).
- `recordUnpromptedDecline` joins the session-store synced actions; verify `VoiceInterruptionEvent` has no `kind`.
- Assistant reply to an unprompted turn follows the trigger's cloud-sync exclusion.

### Todo 22 (cue UI)
- `canReplyToMessage` excludes cues; the retry risk is an error item following a cue (must not resend the trigger); `utils.ts` `getChatHistoryItemCopyText` is the single choke point for cue text.

### Todo 29 (look cue)
- Map `aside` in `natural-motion/energy.ts` `setState` (where `PerformanceAttention` is consumed), add an explicit aside target to `NaturalGazeLayer` (setter like `setCursor`) so gaze returns to it after glances; null the cursor in `Model.vue` while attention is `aside`; draw the side from the gaze layer's own `stream('gaze')`; hold modulation and glances apply on top; test aside while a hold raises camera fixation.

### Held emotion in the situation block (owner decision)
- Not published anywhere today; recommendation: leave it out (mood + active slot line already cover it).

### Todo 13 (presence settings) - lane st_01a15747
- `features/performance/settings.ts` is ONE valibot document (`settings/expression-performance`, `listenToStorageChanges:false`, leader-routed `update`/`reset`, `synced:{state:true, actions:['update','reset']}`), not per-key keys. Default: copy that pattern (`settings/situation` single document); the "banana" QA writes an invalid value into that document and expects the default.
- Route meta also needs `descriptionKey`, a unique `order` (free: 10), `stageTransition`.
- Default: hide the Presence page on stage-web and Pocket (they scan stage-pages and never set the unprompted capability).
- `live2d.vue` Energy slider is at `:448-454`.

### Todo 15 (koffi)
- Version, install script and optional platform packages are unverified: the executor runs `npm view koffi time scripts optionalDependencies --json` and applies the 72 h rule live.

### Todo 16 (Win32 service)
- Add the contract as key `foregroundWindow` of the `electron` object in `packages/electron-eventa/src/electron/index.ts`; mock `app.getAppMetrics` in tests; the real-binding win32 test asserts "returns a sample or null without throwing" (no guaranteed foreground window under test).

### Todos 23/24 (gate)
- Add a composer-typing signal (non-empty composer draft or input within the last ~10 s) as a hard suppressor `user-typing`.
- `voice.activeTurns` is reliable only in the audio host; read `voiceTurnsChanged` on the speech bus as the character-speaking input.
- Stage visibility is a hard suppressor (see 11/24 above).

### Todo 25
- Drop the "length of last unprompted request" field unless the prompt-projection capture is tagged with turn/origin; default: tag the capture with `turnId` and `origin` (small change in `context-observability.ts:114` callers).

### Todos 26-28 (spark)
- New `commandsOnly` control: `ignoreTextOutput:true`, `allowNoResponse:true`, no `toolChoice` (no existing combination does this).
- Reminders are re-enqueued every ~30 s: the reducer dedupes `notify` observations by `topicKey`; topic key uses `event.data.eventId ?? event.data.id` consistently with the scheduler.
- `critical` comes only from scheduler reminders' `payload.priority`; other sources never set it.
- Todos 26 and 27 land together (removing the reaction plugin before 27 breaks the widget reaction API); todo 27 deletes the dead `handleSparkNotifyWithReaction` export.
- Todo 27 adds a test that `context.turnId === 'spark:<id>'` (runtime: `roundId = options.messageId ?? createId()`, verified in plan review round 2).
- Todo 28 acceptance targets the `'notification'` Speech purpose, not every `new Speech(` (`emitTextOutput` keeps its read-aloud one).

All five lanes returned; no blocking design conflict with main 59b9741.
