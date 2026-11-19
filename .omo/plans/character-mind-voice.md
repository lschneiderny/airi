# character-mind-voice - Work Plan

Status: CM3a and CM3b are both done on their branches on 2026-11-19, not yet merged: CM3a on `luke/feat/character-mind-voice` (PR #52), and CM3b on `luke/feat/character-mind-widget-turns` (CM3b's PR). The commits are listed in [Commits](#commits), and the checks in [Checks run](#checks-run). Roadmap rows: slices CM3a and CM3b in [`docs/ai/context/character-mind-roadmap.md`](../../docs/ai/context/character-mind-roadmap.md#steps). Rulings: the [character mind ADR](../../docs/ai/adr/2026-11-17-character-mind-direction.md), the [character mind core ADR](../../docs/ai/adr/2026-11-18-character-mind-core.md), and the [character mind return ADR](../../docs/ai/adr/2026-11-19-character-mind-return.md). Branch: `luke/feat/character-mind-voice`, cut from `luke/feat/character-mind-return` at `e79755141` (CM2, PR #51, not yet merged), which is stacked on `luke/feat/character-mind-touch` (CM1, PR #47, not yet merged), which sits on `main` at `872b74cb5` and contains upstream `moeru-ai/airi` through `b3a6d6071`. The plan proposes two PRs (D1): CM3a on this branch with base `luke/feat/character-mind-return`, and CM3b on `luke/feat/character-mind-widget-turns`, cut from the tip of CM3a, with base `luke/feat/character-mind-voice`. When a PR below one merges, rebase the next branch onto `main` and retarget its PR.

The owner is away and runs these slices without a plan review. Every design fork below is taken on the recommended option and listed in [Decisions open to the owner's veto](#10-decisions-open-to-the-owners-veto).

## TL;DR (For humans)

**What changes:** The urge gate stops being a loop of its own in the situation store and becomes the character mind's voice policy. The mind decides every unprompted line on one clock and one seeded random source: a reach-out, a spoken touch reaction, and, in part two, a widget or plugin turn. The situation store keeps sensing, topics, the 2 s timer, the saved social memory, and the chat calls, and stops deciding. Part one (CM3a) moves the gate. Part two (CM3b) turns widget and plugin turns into stimuli: the mind may defer them, the model may decline them, the caller always gets an outcome, and a turn not spoken before the caller's timeout stays a notify that she may raise later. Part two also writes the boundary between the mind and `chat.ts` into the stage-ui guide.

**Why:** Today three deciders make her speak unasked, each with its own clock, random source, and wait: the gate (`Date.now`, a saved Mulberry32 checkpoint), the mind's touch-line policy (the mind's clock and source), and the widget path (`untilQuietMoment`, its own timers, no decline marker). A widget turn bypasses the gate (autonomous-behavior overlap 10), and the reach-out and the idle draw run on separate clocks (overlap 3).

**What does not change:** No rate, floor, cap, hazard, ritual window, hold, double-text value, or reason weight is tuned. The gate's pure rules stay where they are in `stage-shared/situation`. The storage key, its tier, and its owner stay; nothing new is saved, and the mind persists nothing. Natural keeps its idle draw until CM4. Notice turns stay outside the mind. The widget protocol, `use-bridge-spark.ts`, `extension-ui-host.vue`, the plugin SDK, and the core-agent runtime are not edited.

**Effort:** L for CM3a, M for CM3b. **Risk:** Medium to high. The gate's state moves between owners, and the gate runs only while a stage is mounted in the leader.

## 1. Upstream first

Read from the tree at `e79755141`. Upstream is `b3a6d6071`.

| Upstream has | Code | Who uses it | Fork difference |
| --- | --- | --- | --- |
| Spark Notify events and the commands-only agent | `packages/core-agent/src/agents/spark-notify/agent.ts` `createSparkNotifyAgent`; `packages/stage-ui/src/stores/character/orchestrator/store.ts` `handleSparkNotify` | Plugins, widgets, and the avatar touch notify | The fork ingests each notify into the situation as an observation, and the gate decides whether she speaks about it |
| A widget bridge that asks the stage for a reaction | `apps/stage-tamagotchi/src/renderer/widgets/extension-ui/composables/use-bridge-spark.ts`, `apps/stage-tamagotchi/src/renderer/widgets/extension-ui/components/extension-ui-host.vue` | Extension UI widgets in the widgets window | Unchanged in the fork |
| The context bridge store with `dispatchSparkNotifyReaction`, `dispatchSparkNotifyPerformance`, and a cross-window `BroadcastChannel` (`airi-spark-notify-bridge`) | `packages/stage-ui/src/stores/mods/api/context-bridge.ts` | The widget bridge and the plugin host | Upstream's `handleSparkNotifyWithReaction` was replaced by the fork's `performSparkNotifyReaction`: the notify becomes a situation observation, a forced unprompted turn speaks the reaction after a quiet moment, and the spoken text is shared with other windows |
| Chat send, the queue, and the orchestrator runtime | `packages/stage-ui/src/stores/chat.ts`, `packages/core-agent/src/runtime/chat-orchestrator-runtime.ts` | Every chat turn | Fork-only: unprompted turns (`submitUnprompted`, `submitReaction`), the single pending unprompted turn, the held reply and its decline detection (`turnState`, `cueStats.declined`) |
| Background tasks, notices, recipes, and scene sessions | `packages/stage-ui/src/stores/chat.ts` (`notifyConversation`, `runBackgroundTask`) | The owner's own conversation | Adopted unchanged (ledger row "Recipes, decisions, background tasks, chat notices, and scene sessions") |
| `forceResponse` and `forceTextResponse` in the Spark Notify schema | `packages/stage-ui/src/stores/mods/api/context-bridge.ts` options | Accepted, then ignored on the spoken route | Unchanged |
| Nothing for an urge gate, rituals, threads, a reach-out, or a spoken touch reaction | | | Fork-only: `packages/stage-shared/src/situation`, `packages/stage-ui/src/stores/situation`, `packages/character-mind` |

For this slice:

- **Adopts unchanged:** the widget bridge (`use-bridge-spark.ts`, `extension-ui-host.vue`), the bridge message shapes, the commands-only agent, the plugin SDK, notices, recipes, and the core-agent runtime.
- **Builds beside upstream:** the voice policy in `packages/character-mind`, and every other changed path except those below, which are fork-only.
- **Changes these upstream files**, each already edited by the fork:

| Upstream file | Why | Part |
| --- | --- | --- |
| `packages/stage-ui/src/stores/mods/api/context-bridge.ts` | `performSparkNotifyReaction` asks the mind for a widget line instead of forcing a turn; `untilQuietMoment`, `untilCharacterQuiet`, and `VOICE_HOST_ANSWER_MS` go; the serving window gets the caller's deadline | CM3b |
| `packages/stage-ui/src/stores/chat.ts` | `force` is replaced by a widget turn whose instruction offers `<\|SILENT\|>` | CM3b |
| `apps/stage-tamagotchi/src/renderer/App.vue` | Only the leader serves widget reactions (`setSparkNotifyHostRole`) | CM3b |
| `packages/stage-ui/src/components/scenes/Stage.vue` | It connects the conductor to the voice port, and loses the `about-to-speak` and `let-go` chat hooks | CM3a, CM3b |
| `packages/i18n/src/locales/en/base.yaml` | `base.prompt.unprompted-forced` becomes `base.prompt.unprompted-widget`. English only; the key exists in no other locale | CM3b |
| `packages/stage-ui/AGENTS.md` | The boundary between the mind and chat (audit R11) | CM3b |

## 2. Today's unprompted voice paths in the fork

**The signal path.** Only the leader window, the one opened with `synced-leader=true`, senses and decides. It is the main window (`index` page) or the desktop stage window (`stage` page); both run `useStageHostWiring`. `useSituationStore` folds sensor observations (presence, foreground, conversation, notifies, the mind's return and touch observations) into `SituationState`, and runs the gate loop while it leads in a host with `unprompted` (`setHostCapabilities`, Electron only). Chat actions run in the speech-player window, which is the leader (`inSpeechPlayer`). User input listeners (voice capture, transcription, composer drafts) run in every window, because any window may serve a widget reaction today.

**Deciders of unprompted voice, in the order they run.** The example is a gate tick, a touch line, and a widget request.

| # | Decider | Detects | Decides | State | Clock | Random | Saved |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Promotion, `syncGateLoop` in `packages/stage-ui/src/stores/situation/index.ts` | The window starts leading in a host with `unprompted` | A new urge memory that eases in (`promotionUrgeMemory(nowMs, seedSource())`), with the social fields of the saved slice (`restoreSocialMemory`) | `gateMemory` in the store | `Date.now` | `seedSource` (a random uint32; tests inject one) seeds the first `Exp(1)` threshold | Reads `settings/situation-inner` (`useSituationInnerState`, tier 2, leader-only with a leadership token); `fires`, `urge`, `pending`, and `doubleText` are not saved |
| 2 | `gateTick`, every `GATE_INTERVAL_MS` (2 s) | A fire still on its way (`firing`) or a pending unprompted turn (`unpromptedPending`) skips the tick. A stage shown again (`stageVisible` and `desktopFresh`) | `visibilityRegainUrgeMemory`: she eases in again. `pruneThreads` | `wasStageShown`, `threads` | `Date.now` | None | Threads are saved with the slice |
| 3 | Hard gate, `hardReason` in `packages/stage-shared/src/situation/gate.ts` | `GateSignals` (user speaking, typing, generating, queue, sample freshness, stage visible) and `GateSettings` (`unpromptedEnabled`, `dontDisturb`, `quietApps`, `speakDuringGames`) | A hard hold, in the order of `GateHardReason` | None | The tick's `nowMs` | None | None |
| 4 | Urge gate, `evaluateUrgeGate` in `packages/stage-shared/src/situation/urge-gate.ts` | Rituals (greeting 12/h over 45 min from 05:00 to 15:00, sign-off 1.5/h over 3 h, welcome-back 6/h over 20 min from the mind's last return), an urgent notify, a due double text, the integrated hazard against its threshold | Fire or hold, then a category and a reason (`collectReasons`); held topics (`heldTopics`) are never picked. Holds in the order `floor`, `quiet-unanswered`, `safety-cap`, `awaiting-reply`, `urge`, `no-topic` | `UrgeGateMemory`: urge, threshold, `fires`, `pending`, `unanswered`, `damp`, `doubleText`, ritual `day`, `lastOwnDayAtMs` | The tick's `nowMs`; accrual steps cap at `ACCRUAL_DT_MAX_MS` (10 s) | Mulberry32 checkpoint `rngState` in the memory: five draws per ordinary fire (threshold, category, reason, double-text roll, double-text offset), none per hold | The social slice (`SavedGateMemory`: `lastFireAtMs`, `lastSpokenAtMs`, `unanswered`, `awaitingSinceMs`, `damp`, `day`, `lastOwnDayAtMs`, `rngState`) after every tick that changed it |
| 5 | Mood factor, the character-state bridge (`packages/stage-ui/src/stores/character-state/situation-bridge.ts`) | The character state | `urgeFactor()` multiplies the opening hazard | The character state | | None | The character state (its own record) |
| 6 | `fire` in the store | A fire decision | `markAddressed` (except a thread), then `submitUnprompted` with the category's instruction. A busy result (`UNPROMPTED_BUSY_ERROR`) restores the memory before the fire, `rngState` included | `firing` | `Date.now` | None | Through row 4 |
| 7 | Chat, `submitUnprompted` in `packages/stage-ui/src/stores/chat.ts` | One pending unprompted turn at a time | Sends the trigger message with the topic text and the instruction (`base.prompt.unprompted*`, each offering `<\|SILENT\|>`) | The pending turn | | None | Chat history |
| 8 | `Stage.vue` chat hooks | `onBeforeSend` of an unprompted, non-touch turn in the active session; `onStreamEnd` of a declined one | `idleCue('about-to-speak')`, `idleCue('let-go')`, performed only under Natural | None | Natural's clock | None | None |
| 9 | The model, through the runtime's held reply (`packages/core-agent/src/runtime/chat-orchestrator-runtime.ts`) | The reply | Speak or decline (`<\|SILENT\|>`, or no visible reply); the runtime holds every unprompted reply until it speaks | `turnState` | | The model | Chat history |
| 10 | Outcome listeners in the store (`onTokenLiteral`, `onStreamEnd`) | The first literal of an unprompted turn; a declined end | Spoken: address the topic, raise a thread, `recordUrgeFireOutcome('spoken')`. Another unprompted turn that spoke (a forced widget turn): `recordExternalSpeech`. Declined: the topic is marked declined | `gateMemory` | `Date.now` | None | Through row 4 |
| 11 | Touch line, `answerTouch` in `packages/character-mind/src/touch.ts` (CM1) | A poke or a finished pet with a voice view (`observeTouch`) | A `speak` intent, which `speakReaction` sends through `submitReaction`; `refused` while a turn is pending. Its first literal applies `recordExternalSpeech` (`reactionSpoke`) | `MindState.voice.reaction` | The mind's clock | The mind's seeded source | None |
| 12 | Widget reaction, `performSparkNotifyReaction` in `context-bridge.ts`, in any window whose spark role is `main` | A widget or plugin request with a non-blank headline or replacement message | `holdTopic`, ingest the notify, wait up to `SPARK_NOTIFY_QUIET_WAIT_MS` (20 s) in `untilQuietMoment` for her to be quiet (`untilCharacterQuiet`, `VOICE_HOST_ANSWER_MS` 1 s) and the user not mid-input (`userMidInput`, `untilUserIdle`), then `submitUnprompted({ force: true })` on `base.prompt.unprompted-forced`, which offers no `<\|SILENT\|>` | The hold, the waiters | `Date.now` and timers | None | Chat history |
| 13 | The widget's wait, `dispatchSparkNotifyReaction` and `dispatchSparkNotifyPerformance` in a `client` window | No answer from the serving window | The fallback text after `SPARK_NOTIFY_REACTION_TIMEOUT_MS` (30 s), or the caller's `timeoutMs` for a performance with calls | The waiter | Timers | None | None |
| 14 | Devtools "Evaluate now" (`evaluateGateLeader`, `serveGateEvaluation`) | A click in the inspector | `gateTick(true)`: the timing holds are skipped, the hard holds still apply | As row 4 | As row 4 | As row 4 | As row 4 |

**Not voice deciders in this slice.** A notice turn (`notifyConversation`) answers a background task of the owner's own conversation and does not pass the gate (overlap 12). The avatar touch notify and task reminders enter the situation as urgent notifies and reach row 4 like any notify (overlap 13).

**Defects found while reading.**

- The 30 s timeout exists only on the waiting side (row 13). The serving window has no deadline: after 20 s of waiting and a slow reply, a turn can be spoken after the widget already showed its fallback.
- A pending unprompted turn makes a widget request return its fallback at once instead of waiting. Its notify is urgent (`immediate`), so the gate may raise it on its own a moment later.
- A forced widget turn offers the model no decline marker, against LLM prompt Target rule 6.

## 3. The design

### 3.1 What the voice policy is

The **voice policy** is the part of the character mind that decides when she speaks unasked: the urge gate and its rituals, the spoken touch-reaction policy (CM1), and widget and plugin turns (CM3b). It runs inside `step`, on the mind's clock (`atMs`) and its seeded source. The gate's pure rules stay in `packages/stage-shared/src/situation` (D3), and the mind composes them, as CM1 composed `reactionPolicy`.

**What stays in the situation.** Sensing and folding: observations, topics, threads and their extraction, `markAddressed` and declined topics, the mind's return and touch observations, the user input signals, the 2 s timer and its lifecycle (leadership, host capability), the saved social slice, the observability store, and every chat call. The situation store becomes the voice port: it builds the mind's view each tick, runs the turns the mind decides, and reports their outcomes.

### 3.2 One clock and one random source

`evaluateUrgeGate` already takes `nowMs` from its caller. It stops carrying its own random state:

```ts
/** packages/stage-shared/src/situation/urge-gate.ts */
export declare function evaluateUrgeGate(input: UrgeGateInput, memory: UrgeGateMemory, random: () => number): UrgeGateEvaluation

/** The first threshold is the one draw of a promotion. */
export declare function promotionUrgeMemory(nowMs: number, random: () => number): UrgeGateMemory
```

`rngState` leaves `UrgeGateMemory`, `SavedGateMemory`, and `SavedGateMemorySchema`. An ordinary fire still draws exactly five values and a hold draws none, now from the mind's source. A refused fire (another unprompted turn pending) restores the memory before the fire as today, but its five draws stay spent, because the shell's source cannot rewind (D5). The mind's clock is the shell's `Date.now`, which the view's `local` time and signals are sampled against in the same call.

### 3.3 Stimuli, intents, and state

`Cm2Stimulus`, `Cm2Intent`, and `Cm2MindState` stand for what CM1 and CM2 defined; they are names for this plan only. Parts marked CM3b land in part two.

```ts
/** packages/character-mind/src/types.ts */
export type VoiceLine
  /** A spoken touch reaction (CM1). `eventId` names the touch's situation event. */
  = | { kind: 'reaction', reaction: ReactionKind, eventId: string }
  /** A reach-out the gate decided. */
    | { kind: 'reach-out', topicKey: string, topicText: string, reason: { kind: ReasonKind, category: ReasonCategory } }
  /** CM3b: a widget or plugin turn the mind let through. */
    | { kind: 'widget', topicKey: string, topicText: string, supplement: string | null }

export interface VoiceRun {
  /** The store bumps it at each promotion and at "Delete all data". A new id makes the mind restore its gate memory. */
  id: number
  /** The store's mirror of the last memory a mind published in this run, or null before the first. */
  memory: UrgeGateMemory | null
  /** The social slice read at the promotion; null when nothing was saved or the user deleted all data. */
  saved: SavedGateMemory | null
}

/** What the voice policy sees of the situation at one tick. Built by the store, never kept by the mind. */
export interface VoiceView {
  run: VoiceRun
  situation: SituationState
  threads: Pick<ReasonState, 'threads'>
  local: GateLocalTime
  sessionId: string
  signals: GateSignals
  settings: GateSettings
  moodFactor: number
  /** CM3a only: topics a widget turn holds (`holdTopic`). CM3b reads its own requests instead. */
  heldTopics: string[]
  /** An unprompted turn the mind did not start is pending in chat. */
  unpromptedPending: boolean
}

/** CM3b: a widget or plugin asks her to speak. */
export interface VoiceRequest {
  /** `spark:<notify id>`, the streaming-control turn id that CALL handlers listen to. */
  turnId: string
  topicKey: string
  topicText: string
  supplement: string | null
  /** The caller's wait. The mind cancels a line not spoken this long after the request. */
  timeoutMs: number
}

export type MindStimulus
  = | Exclude<Cm2Stimulus, { kind: 'voice-outcome' }>
  /** Every `GATE_INTERVAL_MS` in the leader, at a request deadline, and from "Evaluate now" (`forceTiming`). */
    | { kind: 'voice-tick', view: VoiceView, forceTiming: boolean }
  /** The user sent a turn of their own. */
    | { kind: 'user-turn', atMs: number }
  /** What became of a `speak` intent. `refused`: another unprompted turn was pending. */
    | { kind: 'voice-outcome', turnId: string, outcome: GateOutcome | 'refused' }
  /** CM3a only: a forced widget or plugin turn spoke outside the mind. Deleted in CM3b. */
    | { kind: 'external-speech', atMs: number }
  /** CM3b. */
    | { kind: 'voice-request', request: VoiceRequest, view: VoiceView }

export type MindIntent
  = | Exclude<Cm2Intent, { kind: 'speak' }>
  /** Speak one line. Its outcome returns as a `voice-outcome` stimulus with the same `turnId`. */
    | (IntentBase & { channel: 'voice', kind: 'speak', turnId: string, line: VoiceLine })
  /** CM3b: stop the turn of a widget line not spoken before its caller's deadline. */
    | (IntentBase & { channel: 'voice', kind: 'cancel', turnId: string })
  /** CM3b: give up a widget request that found no moment to start. Its caller gets `cancelled`. */
    | (IntentBase & { channel: 'voice', kind: 'drop', turnId: string })
  /** CM3b: the idle cue around a reach-out or widget line. Never for a touch line. */
    | (IntentBase & { channel: 'posture', kind: 'cue', cue: 'about-to-speak' | 'let-go' })

export interface VoiceLineState {
  turnId: string
  kind: VoiceLine['kind']
  /** The gate fields a refused reach-out restores. Null for other lines. */
  before: Pick<UrgeGateMemory, 'lastFireAtMs' | 'fires' | 'pending' | 'urge' | 'urgeThreshold' | 'doubleText'> | null
  /** CM3b: when a widget line must have spoken, on the mind's clock. */
  speakBy: number | null
}

export interface MindVoiceState {
  /** CM1's touch-line pacing and its last decision. */
  reaction: ReactionMemory
  lastDecision: ReactionDecision | null
  /** The gate's memory; null until the first tick. */
  gate: UrgeGateMemory | null
  runId: number | null
  /** Whether the stage was shown at the last tick; a shown edge eases her in again. */
  stageShown: boolean
  /** The line on its way. One at a time, as chat runs one unprompted turn at a time. */
  line: VoiceLineState | null
  /** CM3b: widget requests waiting for a moment, oldest first. `startBy` is 20 s after the request. */
  requests: Array<{ request: VoiceRequest, startBy: number, speakBy: number }>
  /** The last gate decision, for the inspector and QA. */
  lastGate: UrgeGateDecision | null
}

export interface MindState extends Omit<Cm2MindState, 'voice'> {
  voice: MindVoiceState
}
```

**How the voice policy answers** (`packages/character-mind/src/voice.ts`; `answerVoiceOutcome` moves here from `touch.ts`):

| Stimulus | Answer |
| --- | --- |
| `voice-tick` with a new `run.id` | Restore the gate memory: `run.memory` with `pending: null` when a mind connects mid-run (a Stage remount keeps the urge and the hourly cap); else `restoreSocialMemory(promotionUrgeMemory(atMs, random), run.saved, atMs)`; promotion alone when `saved` is null. `stageShown` turns false, so the next shown tick eases her in, as a new leader does today |
| `voice-tick` | A shown edge applies `visibilityRegainUrgeMemory`. CM3b: requests past `startBy` yield `drop`, a line past `speakBy` yields `cancel`. Skip the gate while `view.unpromptedPending`, a line, or a touch line is open (today's `firing` and `unpromptedPending` rule). Otherwise `evaluateUrgeGate(input, memory, random)`, with the view's fields and `heldTopics` (CM3a) or the open requests' topic keys (CM3b). A fire yields `speak` with a `reach-out` line and a fresh `turnId`, and opens `line` with `before` |
| `user-turn` | `recordUrgeUserTurn` |
| `voice-outcome` for a reach-out | `spoken`: `recordUrgeFireOutcome('spoken')`, which arms a double text. `refused`: restore `before`. Otherwise `recordUrgeFireOutcome(outcome)`. CM3b: `declined` also yields `cue` `let-go`. The line closes |
| `voice-outcome` for a touch line (`reaction:<eventId>`) | CM1's `answerVoiceOutcome`, and `spoken` also applies `recordExternalSpeech`. The line closes |
| `external-speech` (CM3a) | `recordExternalSpeech` |
| `voice-request` (CM3b) | Section 3.7 |

A reach-out's `speak` and, in CM3b, its `cue` `about-to-speak` are one response with one `cause`, in the order posture, voice. `observe-wake` and `observe-return` stay as CM2 defined them: the situation keeps folding returns into topics, the `returned` event, and `tracking.lastReturnAtMs`, and the gate in the mind reads the welcome-back ritual from the view's situation. The welcome-back line is therefore a `speak` decision on the mind's clock.

### 3.4 Who drives the mind's voice

The store keeps the 2 s timer and its lifecycle, because leadership and the host capability live there. It sends stimuli to the mind of the connected stage:

```ts
/** packages/stage-ui/src/composables/performance/use-stage-performance-conductor.ts */
export interface VoicePort {
  observeTouch: (observation: TouchObservation) => TouchVoiceView | null
  /** Records a return or a desktop wake in the situation. Does nothing in a follower window. */
  observeReturn: (observation: ReturnObservation | WakeObservation) => void
  /**
   * Starts the line's turn and resolves with what became of it: at the first spoken literal, at a decline, or with
   * the turn's result. Resolves `refused` without sending while another unprompted turn is pending, and `failed` in
   * a follower window, while the gate loop does not run, or when a touch line's event is gone.
   */
  speak: (turnId: string, line: VoiceLine) => Promise<GateOutcome | 'refused'>
  /** CM3b: cancels the chat turn of a line that has not spoken. */
  cancel: (turnId: string) => void
  /** CM3b: answers the caller of a request the mind gave up, with `cancelled`. */
  drop: (turnId: string) => void
  /** Mirrors, saves, and publishes the voice state after a step that touched it. */
  publishVoice: (update: { runId: number, memory: UrgeGateMemory, decision: UrgeGateDecision | null, wakeAtMs: number | null }) => void
  /** Hands the port this stage's way to send it a voice stimulus. The newest connection wins; the result disconnects. */
  connect: (send: (stimulus: VoiceStimulus) => void) => () => void
}

export type VoiceStimulus = Extract<MindStimulus, { kind: 'voice-tick' | 'user-turn' | 'external-speech' | 'voice-request' }>
```

- `StagePerformanceConductor` gains `voiceStimulus(stimulus)`: one `step`, then the intents in order. `Stage.vue` connects it to `voice()` on mount and disconnects on unmount.
- `speak` merges today's `speakReaction` and `fire`: it applies `unpromptedTopicText` to a reach-out or widget line, marks a reach-out's topic addressed before the send (except a thread), and at the first literal addresses a widget topic, raises a thread, and records the reason outcome for the inspector. `voice-outcome` goes back through the conductor.
- `publishVoice` sets the store's mirror (`run.memory`), saves the slice with the leadership token when it changed (`saveInnerState`), records the decision and the memory in the observability store (`recordUrgeDecision`, `publishUrgeState`), and arms one timer at `wakeAtMs` that sends a tick (CM3b deadlines). The character-state bridge reads the mirror (`gate: () => mirror`).
- The tick builds the view from `gateSignals`, `gateSettings`, `localTimeFor`, the threads, and `urgeFactor()`, as `gateTick` does today. With no mind connected, the store drops the tick and keeps the latest user turn time, which it sends first when a mind connects.
- Devtools "Evaluate now" sends a tick with `forceTiming` and returns the decision that `publishVoice` received in the same call, or `{ status: 'skipped', reason: 'no-mind' }` when no mind is connected.

### 3.5 Persistence

Nothing new persists. The key `settings/situation-inner`, its tier 2 entry, its leader-only writer, and the leadership token stay. The mind and its shell persist nothing (CM1 D8): the store saves the slice from the mirror that the mind publishes. The floor (`lastFireAtMs`, `lastSpokenAtMs`) and the hourly cap stay per user, as the CM4 row requires; `fires` stays unsaved and lives within a run. CM4 later splits pacing memory from the per-card record. The only schema change is the removal of `rngState`: a stored `gate` field that still has it fails the strict schema once, falls back to null on its own (the reader validates each field), and the threads survive (D6).

### 3.6 Spoken touch reactions

The CM1 touch policy keeps every rule (`reactionPolicy`, `settleReaction`, the 45 s refractory, the protest burst). Its line becomes a `VoiceLine` of kind `reaction` with `turnId` `reaction:<eventId>`, it occupies `line`, and a spoken one applies `recordExternalSpeech` inside the mind instead of in the store (`reactionSpoke`). The gate skips while a touch line is open, as it skips today while `submitReaction` is pending.

### 3.7 Widget and plugin turns (CM3b)

**Who serves.** Only the leader. `App.vue` sets the spark role to `main` when `resolveRendererWindowContext().leadership === 'leader-only'`, and `client` in every other window. The bridge lock (`withContextBridgeExclusiveLock`) stays.

**The request.** `performSparkNotifyReaction` calls `situation.requestVoice({ turnId: 'spark:<id>', topicKey, topicText, supplement, timeoutMs })`, which returns `Promise<ChatUnpromptedResult>`. The request reaches the mind before the notify is ingested, so its topic is held from the start. When no mind is connected, the window does not lead, or the gate loop does not run, it resolves `failed` at once. The caller's deadline is `options.timeoutMs`, else the `performance.timeoutMs` that a client forwards, else `SPARK_NOTIFY_REACTION_TIMEOUT_MS` (30 s).

**The answer.** The mind holds a request while she or the user is busy, with today's quiet-moment set: `userSpeaking` (transcription included), `userTyping`, `characterSpeaking`, `generating`, `queued > 0`, a pending unprompted turn, or an open line. A pending unprompted turn now defers a request instead of failing it. When none holds, at the request or at a later tick, the mind yields `speak` with a `widget` line and `cue` `about-to-speak`. The gate's hard holds (`unpromptedEnabled`, `dontDisturb`, `quietApps`, games, presence, sample freshness) do not apply to widget turns, as today (D10).

**Deadlines on the mind's clock.**

| Deadline | Value | When it passes |
| --- | --- | --- |
| `startBy` | Request time plus `WIDGET_START_WAIT_MS` (20 s, today's `SPARK_NOTIFY_QUIET_WAIT_MS`, moved unchanged) | `drop`: the caller gets `cancelled` and shows its fallback |
| `speakBy` | Request time plus the caller's `timeoutMs`, less `WIDGET_DEADLINE_MARGIN_MS` (1 s, new) for the bridge round trip | `cancel`: the port calls chat `cancelTurn`, and the caller gets `cancelled` |

`publishVoice` carries the earliest deadline as `wakeAtMs`, so the deadline is met to the millisecond, not at the next 2 s tick. After `drop` or `cancel` the notify stays in the situation unaddressed, so she may raise it on her own as an urgent reach-out (Target rule 9). The widget protocol is unchanged: it receives the spoken text, or its fallback after a decline, a cancel, a drop, or a failure (D11).

**The turn.** `ChatUnpromptedPayload.force` becomes `widget?: boolean`. A widget turn takes `base.prompt.unprompted-widget`, which keeps today's brevity and offers `<|SILENT|>`. A spoken widget line applies `recordExternalSpeech` in the mind: it starts the floor and never counts as an unanswered opening, as today.

**Deleted with it:** `force`, `base.prompt.unprompted-forced`, `untilQuietMoment`, `untilCharacterQuiet`, `VOICE_HOST_ANSWER_MS`, `holdTopic` and the store's held set, `heldTopics` in the view, `untilUserIdle`, `userMidInput`, the user input waiters, the `external-speech` stimulus, and the input listeners in follower windows (the leader alone reads input).

### 3.8 The boundary between the mind and chat (audit R11, CM3b)

A new bullet in the CONVENTIONS of `packages/stage-ui/AGENTS.md`, beside the existing `chat.ts` hub bullet, in its own commit: "The character mind decides whether and when she speaks unasked; `chat.ts` and the orchestrator runtime run the turn it decided and report its outcome. Do not start an unprompted turn from anywhere else, and do not add timing, holds, or retries for unprompted turns in chat or the runtime. Only the user's own turns and notices bypass the mind." LLM prompt Target rule 6 moves into the doc's current sections in the same work item as the code (B2).

### 3.9 Windows and drivers

**The leader and the stage window are the same window in every build.** One launch opens either the main window or the desktop stage window with `synced-leader=true`, and that page mounts `Stage.vue`. They differ only in time: the desktop stage before calibration (no `stageWorld`, so no `WidgetStage`), a failed host state read, a dropped `stageWorld`, or a remount. In those gaps no mind is connected: ticks are dropped and widget requests fail at once, and the mirror lets the next mind continue the run. The chat window never ran the gate and runs no mind.

**Drivers.** The voice policy runs under every renderer and driver, as the gate does today. The conductor performs `cue` intents only under Natural (`idleCue`) and drops them otherwise. The `mind` QA event appears under every driver.

### 3.10 Overlaps 3, 12, and 13

- **3. Idle draw and reach-out on separate clocks: narrowed, not closed.** After CM3 the voice decisions share the mind's clock and source with touch, return, and desktop responses, and the reach-out cue is a mind intent. The idle draw keeps Natural's clock and seeded source until CM4 moves it into the mind. See [Blocked](#blocked-needs-the-owner).
- **12. Notice turns: out of scope.** A notice answers the owner's own background task and is listed in the ledger as adopted. Whether it counts as the owner's turn is a question for the owner.
- **13. Unranked notify sources: out of scope, reworded.** They reach the mind's voice policy as urgent notifies, as they reached the gate.

### 3.11 The `stage-shared` package (audit R5)

Neither renamed nor split (D3). The gate's rules (`urge-gate.ts`, `urge.ts`, `gate.ts`, `reasons/`, `reaction-policy.ts`) stay pure in `stage-shared/situation`, consumed by the mind and by the situation's tests and simulation. Moving them would move the whole `situation` folder and its tests without a behavior change, and their only new consumer is the mind, which already depends on `stage-shared`.

## 4. Where the code lives

No package is added. The voice policy is `packages/character-mind/src/voice.ts`, under the lint blocks `airi/character-mind-pure` and `airi/character-mind-pure/core`. The gate's rules stay in `packages/stage-shared/src/situation`. The port, the timer, the mirror, the saved slice, and the chat calls stay in `packages/stage-ui/src/stores/situation/index.ts`. The conductor's `voiceStimulus` and the connection are in `packages/stage-ui/src/composables/performance/`. The widget path stays in `packages/stage-ui/src/stores/mods/api/context-bridge.ts`. One mind per `Stage.vue` (CM1 D12); its voice state is fast state that resets with the mind, except what the mirror and the saved slice carry.

## 5. What is deleted

Under the strangler rule, the old paths go in the part that replaces them.

| Removed | Part | Proof that nothing else used it |
| --- | --- | --- |
| `rngState` in `UrgeGateMemory`, `SavedGateMemory`, and `SavedGateMemorySchema`; the `seed` parameter of `promotionUrgeMemory` | CM3a | `git grep -ln rngState -- packages apps` finds the gate and its test, the inner state and its test, and the store and its test. The MMD body director's own `rngState` in `packages/motion-driver-humanoid` is unrelated and stays |
| `gateTick`'s evaluation, `fire`, `firing`, `wasStageShown`, `speakReaction`, `reactionSpoke`, `reacting`, and `gateMemory` as the store's own state | CM3a | Private to `useSituationStore`, except `speakReaction` (the conductor and its test) |
| `seedSource` in `initialize` | CM3a | Tests only: `situation-bridge`, `chat.contract`, `context-bridge-spark-reaction`, and the store's `index.test.ts`, which seed a connected mind instead |
| `eventId` on `voice-outcome` and on `speak` | CM3a | The conductor and the core's tests |
| `force` in `ChatUnpromptedPayload`, `base.prompt.unprompted-forced` | CM3b | `git grep -nE "force: true\|unprompted-forced"` finds the context bridge, `chat.ts`, the English locale, `chat.contract.test.ts`, and docs |
| `untilQuietMoment`, `untilCharacterQuiet`, `VOICE_HOST_ANSWER_MS`, `SPARK_NOTIFY_QUIET_WAIT_MS` | CM3b | Private to the context bridge store |
| `holdTopic` and the store's `heldTopics` set, `heldTopics` in `VoiceView`, `untilUserIdle`, `userMidInput`, `userInputWaiters`, and the follower windows' input listeners | CM3b | The context bridge store and their tests; the `holdTopic` contract named in a comment of `reasons/collect.ts`, which B2 rewords. `UrgeGateInput.heldTopics` stays, fed with the open requests' topic keys |
| The `external-speech` stimulus and the store's external-speech branch in `onTokenLiteral` | CM3b | Added in CM3a for the forced turn only |
| The `about-to-speak` and `let-go` hooks in `Stage.vue` | CM3b | Two hooks |

After CM3b, `git grep -nE "rngState|unprompted-forced|untilQuietMoment|holdTopic|userMidInput|speakReaction|seedSource|external-speech" -- packages/stage-shared packages/stage-ui packages/character-mind packages/i18n apps docs/ai/context` must print nothing.

## 6. Docs that move with the code

Policy docs change in the commit that makes their statement false. The work item is named in brackets.

- **`docs/ai/context/autonomous-behavior.md`:** the Reach-out row (decided by the mind's voice policy, ticked by the store) [A3], with its cue column [B3]; the Widget reaction row (a stimulus; deferral; the model's veto; the deadlines; only the leader serves) [B2]; the Touch reaction row's line (`speak` with a `VoiceLine`) [A3]. Precedence rule 2 (the mind holds the one open line) [A3] and again for widget requests [B2]; rule 3 (the gate runs inside the mind; a spoken touch or widget line starts the floor) [A3]; a new rule 16, one voice policy for every unprompted line, under every driver [A3], extended for widget turns [B2]. Target rule 3: move its second sentence to rule 16 [A3]; Target rule 9 into the current sections [B2]. Overlap 3 narrowed to the idle draw [A5, B3]; overlap 10 and its Target row deleted [B2]; overlap 5 (two stages would connect two minds, the newest wins) [A3]; overlap 13 reworded [A3]. The Voice and Spoken reactions rulings stay and gain where they now live [A5].
- **`docs/ai/context/glossary.md`:** add **Voice policy** [A2] and **Widget reaction** [B2]. Update Gate (run by the mind; ticked by the store) [A3], Reach-out [A3], Character mind (the voice policy) [A2], Conductor (`voiceStimulus`, the port's methods) [A3], Intent (the new kinds) [A2, B1], Stimulus (the voice members) [A2, B1], and Spark Notify (a widget request is a stimulus) [B2].
- **`docs/ai/context/llm-prompt.md`:** Paths (the mind starts every unprompted turn) [A3]; Trigger messages and the widget instruction [B2]; Target rule 6 into the current sections [B2].
- **`docs/ai/context/state-persistence.md`:** the named exception "The gate's inner state" (no `rngState`; written from the mind's published memory) [A1, A3]. Target rule 5 and the Target row stay for CM4.
- **`docs/ai/context/upstream-policy.md`** [B6]: a new row for widget reactions (upstream's bridge adopted unchanged, the fork's serving path changed); the Revisit "Slice CM3" of "Background task, scene, and notice turns" moves to the owner's question on overlap 12; the "Web extension video notify" row's Revisit is settled by B2.
- **`docs/ai/context/character-mind-roadmap.md`** [A5]: the CM3 row splits into CM3a and CM3b, and the Done-when amendment of [Blocked](#blocked-needs-the-owner); [B6] closes CM3b.
- **`docs/ai/context/testing.md`:** no change; the checks below use existing commands.
- **`docs/ai/audits/2026-10-31-architecture-boundaries.md`** [A5]: the R5 note records that CM3 kept `stage-shared` whole; [B5] notes where R11 is written. Only the current-status notes change, as CM1 did.
- **READMEs:** `packages/character-mind/README.md` (the voice policy, its stimuli and intents) [A2, B1]; `packages/stage-shared/README.md` (the gate's random source) [A1]; `packages/stage-ui/README.md` (the gate capability section, `submitUnprompted`, widget lines, the port) [A3, B2]; `packages/qa-tools/README.md` (`voiceEvaluate`, `airi_evaluate_voice`, `airi_widget_reaction`, the `voice.json` fixture, the `mind` fields, and its mention of `unprompted-forced`) [A4, B4].
- **Nested guides:** `packages/stage-ui/AGENTS.md` [B5], in a commit of its own. `git grep` over the other nested guides finds no rule about the gate or widget reactions.
- **New ADRs:** `docs/ai/adr/<date written>-character-mind-voice.md` [A5] and `docs/ai/adr/<date written>-character-mind-widget-turns.md` [B6]. ADR bodies already written are not edited.

## 7. Work items

Each item is one commit that passes `pnpm verify`.

**CM3a, the voice policy** (this branch):

1. **A1 `refactor(stage-shared,stage-ui)`: draw the urge gate from a random source.** Section 3.2. The store creates its source from `seedSource()` at promotion for now. Docs as marked `[A1]`. Tests: `urge-gate.test.ts` and `gate.simulation.test.ts` pass a source that wraps stage-shared's own Mulberry32 (`seedRng`, `nextRandom`); a fire draws five values and a hold draws none; the simulation's rates match the values before the change for the same draws. `inner-state.browser.test.ts`: a stored `gate` with `rngState` resets that field only, and threads survive.
2. **A2 `feat(character-mind,stage-ui)`: decide reach-outs in the voice policy.** `src/voice.ts`, the CM3a members of section 3.3, `answerVoiceOutcome` moved, `turnId` on `speak` and `voice-outcome`, the dispatch in `step.ts`, `initialMindState`, the README. The conductor passes `turnId`; nothing sends ticks yet. Tests in `src/voice.test.ts`, with a seeded source and no Vue: a new run restores from the mirror with `pending: null`, from the saved slice, and from promotion alone; a shown edge eases in; the tick skips while a line or `unpromptedPending` is open; a fire yields one `speak` with a `reach-out` line; `refused` restores `before` and the source stays advanced; `spoken` arms a double text that fires later; a spoken touch line starts the floor; `user-turn` resets `unanswered`; `external-speech` starts the floor; the state survives a JSON round trip.
3. **A3 `refactor(stage-ui)`: route reach-outs through the mind.** Section 3.4: the store as `VoicePort`, run ids, the mirror, `publishVoice`, the dropped tick without a mind, "Evaluate now", the character-state bridge, `Stage.vue` connecting the conductor. Deletes the CM3a rows of section 5. Docs as marked `[A3]`. Tests: `index.test.ts` drives the gate through a connected `CharacterMind` with a fixed seed (fire, busy refusal, outcome, save, promotion, "Delete all data"); a tick without a mind changes nothing; a reconnecting mind keeps `fires`; `use-stage-performance-conductor.test.ts`: a tick's `speak` reaches `speak` under Natural and under Universal; `situation-bridge.test.ts`, `chat.contract.test.ts`, and `context-bridge-spark-reaction.test.ts` seed a mind instead of `seedSource`, with their assertions unchanged.
4. **A4 `feat(stage-shared,stage-ui,qa-tools)`: show voice decisions to QA.** The `mind` event skips voice-tick steps without intents unless forced, and carries `gate` (the fire or hold reason) and `category`. New bridge verb `voiceEvaluate` in `MotionQaCommandSchema`, `AppSession.evaluateVoice`, and MCP tool `airi_evaluate_voice`. Fixture `packages/qa-tools/fixtures/llm/voice.json`: a `quiet moment` regex entry that speaks, one that answers `<|SILENT|>`, and spare entries that match anything, so a late turn does not end in `replay_exhausted`. Tests: `use-motion-qa-bridge.test.ts` reads a voice `mind` event and serves `voiceEvaluate`; `server.test.ts` lists the tool.
5. **A5 `docs(ai)`: record the voice policy decisions and split the CM3 row.** The CM3a ADR, the roadmap split and amendment, the audit R5 note, and the rulings' new home. Last commit of CM3a, after its checks pass.

**CM3b, widget turns** (`luke/feat/character-mind-widget-turns`):

6. **B1 `feat(character-mind)`: defer widget and plugin turns.** `voice-request`, `widget` lines, `requests`, `startBy`, `speakBy`, `cancel`, `drop`, `wakeAtMs`, and the holds of section 3.7. Tests in `voice.test.ts`: a quiet request speaks at once; each hold defers; a deferred request speaks at the first quiet tick; `startBy` drops; `speakBy` cancels; a request's topic is never picked by the gate while it waits; a spoken widget line starts the floor and is not an unanswered opening; a pending unprompted turn defers.
7. **B2 `refactor(stage-ui,i18n,stage-tamagotchi)`: route widget reactions through the mind.** `requestVoice`, the new `performSparkNotifyReaction`, the leader-only spark role, `widget` in place of `force`, `base.prompt.unprompted-widget` in English only, `cancel` and `drop` in the port, and the CM3b rows of section 5 except the cues. Docs as marked `[B2]`. Tests: `context-bridge-spark-reaction.test.ts` keeps its scenarios with the new waits (deferral while she speaks, a user send goes first, a decline returns the fallback, a pending turn defers); new cases: no mind returns the fallback at once, a turn not spoken by the deadline is cancelled and its notify stays unaddressed; the follower-serving cases become "a follower never serves". `context-bridge-performance-call.test.ts` and `context-bridge.contract.browser.test.ts` follow the leader-only role. `chat.contract.test.ts`: a widget turn offers `<|SILENT|>`.
8. **B3 `refactor(stage-ui,character-mind)`: let the mind cue the body for a line.** `cue` intents; the two `Stage.vue` hooks go. Tests: `voice.test.ts`: a reach-out and a widget line yield `about-to-speak` before `speak`, a declined one yields `let-go`, and a touch line yields neither; `use-stage-performance-conductor.test.ts`: the cue reaches `idleCue` under Natural and nothing under Universal.
9. **B4 `feat(stage-ui,qa-tools)`: show widget requests and cues to QA.** The `mind` event carries `lines` and `cues`; `AppSession.widgetReaction` posts a request on `airi-spark-notify-bridge` from the stage window and awaits the `response` addressed to it; MCP tool `airi_widget_reaction`; `voice.json` gains entries for the QA headline. Tests: `server.test.ts` lists the tool; the session helper is checked by the rendered run.
10. **B5 `docs(stage-ui)`: state the boundary between the character mind and chat.** `packages/stage-ui/AGENTS.md` only, in its own commit (section 3.8).
11. **B6 `docs(ai)`: record the widget turn decisions and close the voice slice.** The CM3b ADR, the roadmap, and the ledger. Last commit, after the checks pass.

**Order and parallel work.** A1, then A2, then A3, which needs both. A4 needs A3. A5 is last in CM3a. B1 and B5 can run in parallel; B2 needs B1; B3 and B4 need B2 and touch different files; B6 is last.

## 8. Checks

- **Each commit:** `pnpm verify`. Inner loop: `pnpm -F @proj-airi/character-mind exec vitest run src/voice.test.ts`, `pnpm -F @proj-airi/stage-shared exec vitest run src/situation`, and for stage-ui the narrowest project of the test file.
- **Policy docs:** `pnpm exec vitest run --project dev-tools scripts/dev-tools/policy-docs.test.ts` after A3, B2, and each docs item.
- **The branch:** `pnpm verify --gate --base luke/feat/character-mind-return` for CM3a and `pnpm verify --gate --base luke/feat/character-mind-voice` for CM3b while the PRs below are unmerged; `pnpm verify --gate` after each rebase onto `main`.
- **Smoke on both hosts.** `.env.qa` holds `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL`; create it in the worktree or export the two variables.
  - `pnpm qa:display run -- pnpm qa:smoke`
  - `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"`
- **Rendered voice.** A scratch driver `.temp/cm3/driver.ts`, modeled on CM2's `.temp/cm2/driver.ts`, uses `AppSession` with the `voice.json` replay script and runs inside `pnpm qa:display run --name cm3 -- ...`; stop it with `pnpm qa:display down --name cm3`. Each run first waits until `state` reports `systemIdleTime` live and presence `here`, as in CM2's run, where the gate fired on its own in the QA display. Then it calls `evaluateVoice` until a decision fires; a hard hold is recorded with its reason and the run retries for up to 5 minutes. `.temp/` is not committed.
  1. **Live2D under Natural, classic window** (`AIRI_QA_RIG_FORBOOTH`). Pass: a `mind` event with a voice tick and a `voice/speak` intent; `turn` start and end; `tts`; a `mind` event with `voice-outcome` `spoken`. A second evaluation after the floor (or forced) whose reply is `<|SILENT|>` gives `voice-outcome` `declined` and no `tts`. `airi_errors` (or the session's error list) is empty.
  2. **MMD on the desktop stage** (`AIRI_QA_MMD_MODEL`, `stageHost: 'desktop'`). Wait until the model is loaded, because the mind connects only after calibration. Pass: as run 1.
  3. **Universal.** In run 1's session, switch the Live2D driver to Universal and evaluate again. Pass: as run 1, and no `idle` cue event.
  4. **CM3b widget turns,** in runs 1 and 2. Pass: `widgetReaction` with the QA headline returns the spoken text, with a `mind` event holding `voice/speak` of a `widget` line and, under Natural, `posture/cue` `about-to-speak` and an `idle` event for it; a second request whose reply is `<|SILENT|>` returns the fallback, and the `idle` events show `let-go`; a request sent while a long reply speaks is deferred and speaks after it, or returns the fallback after 20 s. No errors.
- Record the event excerpts in the PR descriptions.

## 9. Risks and what later slices get

| Risk | Mitigation |
| --- | --- |
| The gate now runs only while a stage is mounted in the leader. Before desktop-stage calibration, after a failed host state read, or during a remount, she cannot reach out and widget requests fall back | The gaps last seconds. The mirror keeps the run's urge and hourly cap across a remount, and the saved slice keeps the social memory across a reload. CM4 moves the mind into the leader per character, which removes the gap |
| User turns while no mind is connected | The store keeps the latest one and sends it first on connect |
| The one-time reset of the saved `gate` field after the upgrade (D6): a ritual may run twice that day, and unanswered damping is forgotten once | Threads survive. The owner may veto for a `NOTICE` fallback that drops `rngState` for one release |
| A refused fire now spends its draws (D5) | The draws are uniform and independent; only exact replay of an old seed changes. Tests pin the new rule |
| A deferred widget request starts at the next 2 s tick, not at the instant she falls quiet | At most 2 s later than today, inside the 20 s wait |
| `index.test.ts` and three other store tests change their seeding | Their assertions stay; only the harness changes |
| The rendered check depends on the QA display's presence and foreground signals passing the hard gate | CM2's rendered run saw the gate fire in the QA display. A hard hold is recorded with its reason |
| Two stages would connect two minds (overlap 5, latent) | The newest connection wins; no build renders two stages |

**Left for later slices, without a rewrite of the core's types:**

- **CM4:** the idle draw moves into the mind, which closes overlap 3; one mind per character in the leader removes the connection gaps; the per-card record holds the slow state and the pacing memory stays per user.
- **Feature work after CM3:** reach-out cadence in daily use, and reaching out without foreground data (roadmap "Feature and tuning work").
- **CM7:** the mind issues no `cue` intent to a driver that does not declare it.

## 10. Decisions open to the owner's veto

| # | Fork | Options | Taken | Why |
| --- | --- | --- | --- | --- |
| D1 | One PR or two | One PR of 11 commits; CM3a (the gate) and CM3b (widget turns) | Two PRs, one plan | Each part is a coherent strangler step that leaves the app working. CM3a is a large refactor with no intended behavior change; CM3b changes behavior. Reviews and rendered checks stay smaller |
| D2 | Who ticks the gate | The store's timer sends ticks to the connected mind; the conductor runs its own timer | The store | Leadership and the host capability live there, and "Evaluate now" and widget requests reach the store first |
| D3 | `stage-shared` (audit R5) | Rename or split it; keep it whole | Keep it whole | Section 3.11 |
| D4 | The welcome-back source | The gate in the mind reads `tracking.lastReturnAtMs` from the view; the mind reads its own presence state | The view | One source across a remount; the situation still needs the return for the `returned` event and topics |
| D5 | A refused fire's draws | Rewind the source; keep them spent | Keep them spent | The shell's source cannot rewind |
| D6 | The stored `gate` field with `rngState` | Accept a one-time reset of that field; a `NOTICE` fallback for one release | Accept the reset | The repository forbids compatibility guards, and the loss is one day's social memory |
| D7 | Persistence | The mind saves its voice state; the store saves the published mirror | The store | CM1 D8; CM4 owns slow state |
| D8 | Where the cues are decided | Keep the `Stage.vue` hooks; the mind emits `cue` intents | The mind, in CM3b | The cue is part of the response to the decision; it moves with widget turns, which the hooks also cued |
| D9 | Who serves widget reactions | Any non-widgets window; the leader only | The leader | The mind runs only there; a follower would have to forward anyway |
| D10 | Gate settings for widget turns | Apply `unpromptedEnabled`, `dontDisturb`, `quietApps`, games, and presence; keep them off | Keep them off, as today | A widget is a feature the user turned on; applying presence and freshness holds would mute widgets for users who do not share the foreground window |
| D11 | The widget protocol | Add the outcome status; keep text or fallback | Keep it | Upstream's bridge stays unchanged; the internal path always has the outcome |
| D12 | The speak deadline | Only at the next tick; a wake timer at the deadline with a 1 s margin | Wake timer and margin | A late spoken line after the widget gave up is today's defect |
| D13 | Overlap 3 | Close it in CM3 by moving the idle draw; narrow it | Narrow it | The idle draw is CM4's row |
| D14 | Record the decisions | One ADR; one per part | One per part | Each PR carries its own record |

## Blocked: needs the owner

- **Overlap 3 cannot close in CM3.** The roadmap's CM3 Done-when names "Overlaps 3 and 10 closed", but overlap 3's second clock is Natural's idle draw, which the CM4 row moves. Recommended amendment, which A5 writes into the roadmap and the owner may veto: "CM3: overlap 10 closed, overlap 3 narrowed to the idle draw; CM4: overlaps 3, 5, and 9 closed". The slice proceeds on the amendment; the Done-when item is changed in the roadmap, not dropped.
- **Overlap 12.** Does a notice turn count as the owner's own turn, which bypasses the mind, or as unasked speech, which the voice policy decides? The plan keeps notices outside the mind and leaves overlap 12 open.

## Must not do

- Do not tune any rate, floor, cap, hazard, ritual window or rate, hold, double-text value, reason weight, mood factor bound, the 20 s widget wait, or the 30 s caller timeout.
- Do not move the gate's rules out of `stage-shared/situation`, and do not rename or split `stage-shared`.
- Do not save from the mind, add a storage key, or change the tier or owner of `settings/situation-inner`.
- Do not move Natural's idle draw (CM4).
- Do not edit the widget protocol, `use-bridge-spark.ts`, `extension-ui-host.vue`, the plugin SDK, or the core-agent runtime.
- Do not route notices through the mind.
- Do not add a compatibility guard for `rngState` or keep an old path behind a setting.
- Do not edit the body of an existing ADR or any locale other than English.
- Do not commit a model path or any other local path; use the `AIRI_QA_*` variables.

## Done when

**CM3a:** every reach-out and spoken touch line is decided by `step` on the mind's clock and seeded source; `rngState`, `fire`, and `speakReaction` no longer exist; the voice policy has Node tests with a seeded source and no Vue; the CM3a ADR and the roadmap amendment are written; and every CM3a check in section 8 passes.

**CM3b:** overlap 10 is gone from the autonomous-behavior doc; Autonomous behavior Target rule 9 and LLM prompt Target rule 6 are in the current sections; a widget turn is deferred by the mind, keeps the model's veto, always returns an outcome to the caller, and is cancelled at the caller's deadline, leaving its notify for her to raise; the chat boundary is in the stage-ui guide; overlap 3 is narrowed to the idle draw; the voice rulings hold; and every check in section 8 passes.

## Departures during implementation

- CM3a: A `no-topic` hold now spends the gate's five draws. The gate draws before it picks a topic, and a stream source cannot take draws back. The old checkpoint was left unchanged on that hold.
- CM3a: `docs/ai/context/state-persistence.md` never cited `rngState`. Its gate exception changed in A3, not A1.
- CM3a: A reach-out's `turnId` is `reach-out:<nowMs>-<cause>`, with no draw. The chat message id stays a fresh `nanoid`, so a clash between minds cannot reach chat.
- CM3a: The skip check (an open line or a pending unprompted turn) runs before the shown edge. This matches today's `gateTick`, so a shown edge during a skip eases her in at the next evaluated tick.
- CM3a: A touch line takes the line slot only when it is empty or holds another touch line. A touch line decided while a reach-out is open still emits `speak`, and the port refuses it, as before. A reach-out outcome for a `turnId` that is not the open line is ignored.
- CM3a: The store ticks a mind at once when it connects. A held user turn follows that tick instead of preceding it, because a new mind has no gate memory before its first tick.
- CM3a: The view's `unpromptedPending` is also true while the mind's own line has spoken its first literal but its chat result has not arrived, as the old `firing` rule did.
- CM3a: "Evaluate now" keeps the decision from the published update that carries one, because a user turn during the send runs a second step.
- CM3a: Two modules are new: `packages/stage-ui/src/composables/performance/mind-voice.ts` holds the port types and `MindVoice`, so store tests drive the real path without the conductor, and `packages/stage-ui/src/test/connect-mind.ts` is the shared test harness. The `no-mind` skip reason gained an inspector label in `stage-pages` and an English string.
- CM3a: Two store tests changed. The "pending turn" test checks that the gate was not evaluated, because the connection tick records a decision. The sulky-mood test waits one more promise round.
- CM3a: "Evaluate now" reaches the QA bridge as an `evaluateVoice` option that `Stage.vue` fills. A replay test pins `voice.json`.

CM3b:

1. **B1, new-run restore.** A request does not restore the gate memory for a new run; only ticks do. A widget line spoken before a run's first tick therefore leaves the floor unrecorded.
2. **B1, deadlines.** A deadline passes at `nowMs >= deadline`.
3. **B1, waiting requests.** A request left waiting after a line closes waits for the next tick or request. The closing outcome does not serve it.
4. **B1, wake helper.** `nextVoiceWakeAt` takes `MindVoiceState`.
5. **B1, gate skip.** The gate skips while a request waits, so a waiting request always goes before a reach-out. Its topic is also held from the gate, so the guarantee survives if the skip is relaxed.
6. **B2, lost callers.** The store tracks `requestVoice` callers. When the mind disconnects or is replaced, or the gate stops, each caller whose line is not running gets `failed`.
7. **B2, input listeners.** User input listeners start when a window leads and stop when it stops leading. A newly promoted leader learns of an existing composer draft at the composer's next report, within about 5 s.
8. **B2, publishing.** `MindVoice` also publishes when the earliest deadline changed, so a new request arms the wake timer.
9. **B2, cancel control.** `SituationChatControls` gains `cancelTurn`.
10. **B2, tests.**
    - Three tests of the removed `holdTopic` contract are deleted; the core covers held request topics.
    - Three thread tests now save `lastOwnDayAtMs` instead of holding her own day.
    - A performance-call test's `timeoutMs` went from 1 s to 10 s, because the caller's wait is now also the turn's deadline.
11. **B3, scene-bound sessions.** The old `onBeforeSend` cue hook skipped a turn that does not speak on the host (`context.speaks` false, a scene-bound session). The mind cannot see that, so the look now plays and ends on its own after 10 s.
12. **B3, refusals.** No extra rule guards a cue against a refused line. The view's `unpromptedPending` and the port's refusal use the same expression in one synchronous call.
13. **B4, QA path.** No bridge verb was added. `widgetReaction` posts from the stage window through a fresh `BroadcastChannel`.
14. **B4, fixture.** The `voice.json` widget entries come first and are anchored to the trigger text. The quiet-moment entries carry a negative lookahead. The rendered check found that an unanchored widget entry was taken by a user turn whose situation block named the headline. The fix is folded into B4, with a replay test.
15. **B2 docs, rule pointers.** Target rule 9 (autonomous behavior) and Target rule 6 (LLM prompt) became pointers to where they landed, because the roadmap cites them by number. Precedence rule 17 holds Target rule 9.

## Checks run

Run on 2026-11-19 at `0a2b39388`, the last commit that changes code. `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL` named the models.

| Check | Result |
| --- | --- |
| `pnpm verify --gate --base luke/feat/character-mind-return` | Exit 0: lint of 46 files, typecheck, related tests |
| `pnpm qa:display run -- pnpm qa:smoke` | Exit 0, `ok: true`: classic window host, 0 renderer errors, 0 main-process errors |
| `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"` | Exit 0, `ok: true`: desktop stage host |
| Rendered 1: Live2D (`AIRI_QA_RIG_FORBOOTH`) under Natural, classic window | Pass. The first forced `evaluateVoice` fired the greeting ritual: one `mind` voice tick with gate `forced`, category `ritual`, and `voice/speak`. The turn started 100 ms later, `voice-outcome` `spoken` came at 178 ms, the turn ended at 216 ms, and `tts` ran from 296 ms to 2.6 s. The second forced fire (category `open`) took the `<\|SILENT\|>` entry: `voice-outcome` `declined` at 34 ms, with no `tts`. 0 renderer and 0 main-process errors, and no `replay_exhausted` |
| Rendered 2: MMD (`AIRI_QA_MMD_MODEL`) on the desktop stage | Pass. The same pattern: `spoken` at 676 ms with `tts`, then `declined` at 506 ms. `presence-unknown` held forced ticks until about 10 s after the model loaded. `no-mind` was never observed, because the mind was connected from the moment the bridge was reachable. 0 errors |
| Rendered 3: Universal | Pass. A forced fire declined through the mind, with no `idle` events and 0 errors |

Not checked: an unforced fire did not occur in the minutes the sessions ran. Widget turns are CM3b. `qa:motion3d` was not run, because no motion code changed.

Observed and not changed: `voice-outcome` `spoken` is recorded at the first literal, before `turn` end and `tts`. A declined turn records `turn` start without `turn` end. Under Natural, a declined fire still plays `about-to-speak` and `let-go`.

### CM3b

Run on 2026-11-19 at `03e772baf`. `AIRI_QA_RIG_FORBOOTH` and `AIRI_QA_MMD_MODEL` named the models.

| Check | Result |
| --- | --- |
| `pnpm verify --gate --base luke/feat/character-mind-voice` | Exit 0, with lint of 38 files. It ran at `e3523cca6`, before the fixture anchor was folded into B4; that fix touches only the fixture and its replay test, and the replay test passed (16 tests) |
| `pnpm qa:display run -- pnpm qa:smoke` and `pnpm qa:display run -- pnpm qa:smoke --stage-host desktop --model "$AIRI_QA_MMD_MODEL"` | Both exit 0, with 0 and 0 errors |
| Rendered A: Live2D (`AIRI_QA_RIG_FORBOOTH`) under Natural | Pass. A widget request spoke after 139 ms (`lines` `widget`, `cues` `about-to-speak`, `voice-outcome` `spoken`, `tts`). A second request declined after 21 ms, with `cues` `let-go` and the let-go idle event, and fell back. A request sent as her reply's `tts` started was deferred: its step had no intents. It spoke at the first tick after her speech ended, 2.4 s after the request and about 560 ms after the `tts` end. 0 errors, and no `replay_exhausted` |
| Rendered B: MMD (`AIRI_QA_MMD_MODEL`) on the desktop stage | Pass. Spoke after 677 ms, then declined after 469 ms with `let-go`. 0 errors |
| Rendered C: Universal | Pass. The request went through the mind (`lines` `widget`), declined on a spare entry, and produced no idle events. 0 errors |

Observed and not changed:

- The deferred widget line got no about-to-speak idle event while an expression from the previous reply was active.
- Cue intents still reach the conductor under Universal, which drops them.
- A declined turn records a `turn` start with no end.

## Commits

### CM3a

`git log --oneline luke/feat/character-mind-return..HEAD`, oldest first, without the commit that adds this section:

- `307a004e3` docs(plan): add the plan for the voice slice of the character mind
- `4a9f3d9f9` refactor(stage-shared,stage-ui): draw the urge gate from a random source
- `0cca4cd2d` feat(character-mind,stage-ui): decide reach-outs in the voice policy
- `85798193d` refactor(stage-ui): route reach-outs through the mind
- `0a2b39388` feat(stage-shared,stage-ui,qa-tools): show voice decisions to QA
- `47a245424` docs(ai): record the voice policy decisions and split the CM3 row

This commit marks CM3a done.

### CM3b

`git log --oneline luke/feat/character-mind-voice..HEAD`, oldest first, without the commit that adds this section:

- `297594831` feat(character-mind): defer widget and plugin turns
- `57c59f9c7` refactor(stage-ui,i18n,stage-tamagotchi): route widget reactions through the mind
- `bb0c66276` refactor(stage-ui,character-mind): let the mind cue the body for a line
- `899fb5075` feat(stage-ui,qa-tools): show widget requests and cues to QA
- `03e772baf` docs(stage-ui): state the boundary between the character mind and chat
- `78fee1f41` docs(ai): record the widget turn decisions and close the voice slice

This commit marks the voice slice done.
