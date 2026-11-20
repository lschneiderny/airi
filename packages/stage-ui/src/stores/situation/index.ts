import type { VoiceLine, VoiceRequest, VoiceRun, VoiceView } from '@proj-airi/character-mind'
import type { ChatHistoryItem, ChatHookRegistry, TurnRef } from '@proj-airi/core-agent'
import type {
  AppCategory,
  GateLocalTime,
  GateOutcome,
  GateSettings,
  GateSignals,
  Observation,
  ReturnObservation,
  SavedGateMemory,
  SituationState,
  ThreadState,
  TouchObservation,
  TouchVoiceView,
  UrgeGateDecision,
  UrgeGateMemory,
  WakeObservation,
} from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { VoicePort, VoiceStimulus } from '../../composables/performance/mind-voice'
import type { ExtractionReadPosition } from '../../features/situation/inner-state'
import type { LlmStream, ThreadExtractionSelection } from '../../features/situation/thread-extraction'
import type { SituationForgetRequest } from '../../services/speech/bus'
import type { SituationBridge } from '../character-state/situation-bridge'
import type { ChatReactionPayload, ChatUnpromptedPayload, ChatUnpromptedResult } from '../chat'
import type { SituationGateEvaluation } from '../devtools/situation-observability'
import type { ConversationHookSource } from './sensors/conversation'
import type { ChatExchange, ExchangeSensor } from './sensors/exchange'

import { errorMessageFrom } from '@moeru/std'
import { isElectronWindow } from '@proj-airi/stage-shared'
import {
  addThreads,
  advanceSituation,
  forgetForeground,
  forgetSource,
  heldTitles,
  initialSituationState,
  initialUrgeMemory,
  isSourceInNamespace,
  LOGICAL_DAY_ROLLOVER_HOUR,
  markShown,
  markAddressed as markSituationAddressed,
  notifyTopicKey,
  pruneThreads,
  raiseThread,
  reduceSituation,
  renderSituation,
  TOUCH_TOPIC_KEY,
  touchVoiceView,
  unpromptedTopicText,
  WEB_EXTENSION_SOURCE,
  withoutAppExtension,
} from '@proj-airi/stage-shared/situation'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'

import { localLogicalDayKey, useSituationInnerState } from '../../features/situation/inner-state'
import { foregroundReadPolicyKey, useSituationSettings } from '../../features/situation/settings'
import { createThreadExtractor } from '../../features/situation/thread-extraction'
import { chatComposerActivityChangedEvent, getSpeechBusContext, situationForgetRequestedEvent, situationNotifyObservedEvent, speechInputUserSpeakingChangedEvent, voiceRequestSnapshot, voiceRequestTurns, voiceSnapshotChanged, voiceTurnsChanged, watchVoiceHostEnd } from '../../services/speech/bus'
import { bridgeSituationToCharacter } from '../character-state/situation-bridge'
import { useCharacterStateObservabilityStore } from '../devtools/character-state-observability'
import { useMemoryObservabilityStore } from '../devtools/memory-observability'
import { useSituationObservabilityStore } from '../devtools/situation-observability'
import { situationSelfObservedEvent } from './self-bus'
import { startConversationSensor } from './sensors/conversation'
import { DESKTOP_SAMPLE_STALE_MS, startDesktopSensor } from './sensors/desktop'
import { EXCHANGE_QUIET_MS, startExchangeSensor } from './sensors/exchange'
import { FOREGROUND_SAMPLE_STALE_VISIBLE_MS, startForegroundSensor } from './sensors/foreground'
import { startStageSensor } from './sensors/stage'

/**
 * How often the leader derives the time-based events (settled app switches, long-session tiers, expiry) and
 * re-checks desktop and foreground sample freshness.
 */
const ADVANCE_INTERVAL_MS = 1_000

/**
 * How often the leader asks the opportunity gate whether the character should speak up on her own.
 *
 * Tuning: the gate's own guards set the pace of remarks; this only bounds how late she notices a good moment.
 */
export const GATE_INTERVAL_MS = 2_000

/** A composer that reported writing within this time counts as the user typing. */
export const COMPOSER_INPUT_RECENT_MS = 10_000
/** A composer report expires this long after it arrived, so a closed window cannot hold the gate forever. */
export const COMPOSER_REPORT_EXPIRY_MS = 15_000

/**
 * How many notify topics the leader remembers after they entered the situation.
 *
 * Tuning: the scheduler re-sends a due reminder about every 30 s with the same event id. A notify that decayed out of
 * the event ring would otherwise come back as new (and urgent), so she would mention it twice. Raise it if many
 * notifications arrive while a reminder stays due.
 */
export const SEEN_NOTIFY_TOPICS_MAX = 256

/** `submitUnprompted` returns this error when another unprompted turn is still pending: busy, not a failure. */
const UNPROMPTED_BUSY_ERROR = 'Another unprompted turn is still pending'

const NO_THREADS: ThreadState = Object.freeze({ threads: Object.freeze([]) })

/**
 * How many chat sessions keep their thread extraction read position; the least recently extracted one is dropped
 * first. A dropped session's next extraction reads its newest messages again, within the extraction caps.
 */
const EXTRACTION_READ_POSITIONS_MAX = 64

/** The local calendar position of `nowMs` in this host's time zone, for rituals and the logical day. */
function localTimeFor(nowMs: number): GateLocalTime {
  const date = new Date(nowMs)
  return {
    dayKey: localLogicalDayKey(nowMs),
    minuteOfDay: date.getHours() * 60 + date.getMinutes(),
  }
}

/**
 * The end of the logical day after the one of `nowMs`, in this host's time zone: the latest a new thread may expire.
 * The current day's own end would cut off the follow-ups of a late-night chat, which ripen after its rollover.
 */
function nextLogicalDayEndsAtMs(nowMs: number): number {
  const [year, month, day] = localLogicalDayKey(nowMs).split('-').map(Number)
  // Logical day `day` ends at the rollover on calendar day `day + 1`, so the next logical day ends on `day + 2`.
  return new Date(year, month - 1, day + 2, LOGICAL_DAY_ROLLOVER_HOUR).getTime()
}

/** Thread topics are consumed only when a gate turn about them is observed speaking, never when addressed. */
function isThreadTopic(topicKey: string): boolean {
  return topicKey.startsWith('thread:')
}

/** The slice of the gate memory that survives a leader reload. */
function savedGateMemory(memory: UrgeGateMemory): SavedGateMemory {
  return {
    lastFireAtMs: memory.lastFireAtMs,
    lastSpokenAtMs: memory.lastSpokenAtMs,
    unanswered: memory.unanswered,
    awaitingSinceMs: memory.awaitingSinceMs,
    damp: memory.damp,
    day: memory.day,
    lastOwnDayAtMs: memory.lastOwnDayAtMs,
  }
}

/** The parts of the leader's chat store the gate needs. The chat store hands them over through `observeChat`. */
export interface SituationChatControls {
  /** Raw `sending`: any turn generates, unprompted turns included. */
  sending: () => boolean
  pendingQueuedSendCount: () => number
  /** Whether an unprompted turn was submitted and its result is not read yet. */
  unpromptedPending: () => boolean
  /** The chat session of this window. Only its open threads may give the gate a reason to reach out. */
  activeSessionId: () => string
  submitUnprompted: (payload: ChatUnpromptedPayload) => Promise<ChatUnpromptedResult>
  /** Starts a touch reaction turn; it shares the single pending unprompted turn with `submitUnprompted`. */
  submitReaction: (payload: ChatReactionPayload) => Promise<ChatUnpromptedResult>
  /** Cancels one chat turn, for a widget line that missed its caller's deadline. */
  cancelTurn: (turn: { sessionId: string, turnId: string }) => Promise<void>
  /** The loaded messages of a session, oldest first, for thread extraction; empty when it is not loaded. */
  sessionMessages: (sessionId: string) => readonly ChatHistoryItem[]
  /** The active chat provider and model that extract threads, or `null` when none is configured. */
  extractionSelection: (sessionId: string) => Promise<ThreadExtractionSelection | null>
  /** The LLM store's stream, below the chat runtime, so an extraction fires no chat hook and stores no message. */
  stream: LlmStream
}

/**
 * The chat hooks the store listens to: the conversation sensor's, literals that show an unprompted turn was spoken,
 * and stream ends that show one was declined.
 */
export type SituationChatHooks = ConversationHookSource & Pick<ChatHookRegistry, 'onTokenLiteral' | 'onStreamEnd'>

interface RunningSensors {
  check: (nowMs: number) => void
  /** App ids of AIRI's own executable, passed to the reducer so its windows never become activity. */
  selfAppIds: () => readonly string[]
  stop: () => void
}

/**
 * Owns the character's view of the user's situation in the leader window.
 *
 * The store is intentionally neither synced nor persisted: the leader is the only window that sends chat
 * requests, so it alone folds observations and renders the block. Followers keep the initial state and ignore
 * every call. Leadership comes from {@link initialize}: a promoted window starts from `initialSituationState`
 * with a fresh 1 s advance ticker and its sensors (desktop presence and wake, foreground activity and busy,
 * conversation turns, stage state),
 * and a demoted or disposed window stops the sensors and the ticker and drops its state. Follower windows never
 * register sensors, so their chat hooks and desktop samples produce no observations. The conversation sensor runs
 * on the hooks that the chat store hands over through {@link observeChat}, and so does the exchange sensor, which the
 * advance ticker checks and which reports finished exchanges through {@link onExchangeEnd}. The user input listeners,
 * which feed the gate's `userSpeaking` and `userTyping` signals, also run only while the window leads.
 *
 * In a host that declared the `unprompted` capability ({@link setHostCapabilities}), the leader also runs the gate
 * loop every {@link GATE_INTERVAL_MS}, and is the voice port ({@link VoicePort}) of the leader's character mind
 * (`useCharacterMindStore`). The mind decides whether and when she speaks unasked; the store builds the mind's view at each tick and
 * sends it to the connected mind ({@link connect}), runs the lines the mind decides ({@link speak}), and stores what
 * the mind publishes ({@link publishVoice}). With no mind connected, a tick is dropped. A reach-out addresses its
 * topic (a thread topic is consumed only once her turn about it speaks), then starts one unprompted turn through the
 * chat controls. The gate's social memory (with the ritual day) and the open threads are restored from
 * `useSituationInnerState` when the gate starts and saved whenever a durable field changes, so a leader reload does
 * not start her from day one. Each promotion and "Delete all data" starts a new run ({@link VoiceRun}): its id makes
 * the mind restore its gate memory, from the mirror of the memory a mind last published in the run, else from the
 * slice saved at the promotion. While the gate
 * runs, every exchange that ends is sent to the thread extractor, which asks the chat model what is still open in the
 * messages of that chat session that no earlier extraction read (the read positions are saved with the threads); the
 * threads it returns join the gate's reasons for that chat session, and each attempt shows in the inspector's
 * extraction ledger, never in chat history.
 *
 * While the gate runs, the leader is also the voice channel of a touch. {@link observeTouch} folds the touch and
 * returns what the mind may see of it. A touch line that the mind decided is spoken through {@link speak}: the store
 * marks the touch event as shown (the trigger message carries it), starts a reaction turn through `submitReaction`,
 * and resolves with what became of it. {@link observeReturn} records a return or a desktop wake that the mind
 * decided. The mind applies the outcome of every line to its gate memory.
 *
 * Only the leader serves widget and plugin reactions. {@link requestVoice} hands the request to the mind, which holds
 * it until she and the user are quiet, then decides a widget line that {@link speak} runs. The mind's deadlines arrive
 * as `wakeAtMs` in {@link publishVoice}, which arms one timer that ticks the mind then; a request the mind gave up
 * ({@link drop}) or a line it stopped ({@link cancel}) answers its caller with `cancelled` and leaves the notify
 * unaddressed.
 *
 * While it leads, the store also feeds the character state (`bridgeSituationToCharacter`): touches, returns,
 * reach-outs and their replies, turns, and the relationship events of each extraction. Forgetting everything forgets
 * the character state of every card too.
 */
export const useSituationStore = defineStore('situation', () => {
  const current = shallowRef<SituationState>(initialSituationState)
  const leading = shallowRef(false)
  const stageVisible = shallowRef(false)
  // The category of the user's foreground app while its sample is fresh, or null once the producer goes quiet. The
  // reducer's activity keeps the last app for the session, so this separate value is what drives watching attention.
  const foregroundCategory = shallowRef<AppCategory | null>(null)
  let ticker: ReturnType<typeof setInterval> | undefined
  let sensors: RunningSensors | undefined
  let chatHooks: SituationChatHooks | undefined
  let chat: SituationChatControls | undefined
  let stopConversation: (() => void) | undefined
  /** Runs with the conversation sensor; the advance ticker checks it for exchanges that went quiet. */
  let exchangeSensor: ExchangeSensor | undefined
  const exchangeEndListeners = new Set<(exchange: ChatExchange) => void>()
  let stopNotifyListener: (() => void) | undefined
  let stopForgetListener: (() => void) | undefined
  let stopLeadershipListener: (() => void) | undefined
  const observability = useSituationObservabilityStore()
  const memoryObservability = useMemoryObservabilityStore()
  const characterStateObservability = useCharacterStateObservabilityStore()
  const settings = useSituationSettings()
  const desktopActivity = useDesktopActivityStore()
  const foregroundWindow = useForegroundWindowStore()

  const hostSupportsUnprompted = shallowRef(false)
  let gateTicker: ReturnType<typeof setInterval> | undefined
  /** Ticks the mind at its next widget deadline; see {@link publishVoice}. */
  let wakeTimer: ReturnType<typeof setTimeout> | undefined
  /** The callers of widget requests that have no result yet, by turn id; see {@link requestVoice}. */
  const widgetCallers = new Map<string, (result: ChatUnpromptedResult) => void>()
  /**
   * The gate run: its id, the mirror of the last memory a mind published in it (`memory`), and the slice saved at its
   * promotion. Replaced, never mutated, so a view sent to the mind keeps the run it was built in.
   */
  let run: VoiceRun = { id: 0, memory: null, saved: null }
  /** The leader's character mind, with the run it last received a tick in; see {@link connect}. */
  let mind: { send: (stimulus: VoiceStimulus) => void, tickedRun: number | null } | undefined
  /** The latest user turn that no mind could receive yet; sent after the tick that restores a mind's gate memory. */
  let pendingUserTurnAtMs: number | null = null
  /** Set while "Evaluate now" runs; {@link publishVoice} fills it with what the mind published in the same call. */
  let evaluation: { decision: UrgeGateDecision | null, memory: UrgeGateMemory | null } | undefined
  /** Open threads of every chat session; the gate filters them by the active session. Rituals live in the gate memory's `day`. */
  let threads: ThreadState = NO_THREADS
  /** How far thread extraction read each chat session, least recently extracted first. */
  let extractedThrough: readonly ExtractionReadPosition[] = []
  /** The durable state last saved, serialized, so an evaluation that changed nothing durable writes nothing. */
  let savedSnapshot: string | undefined
  const innerState = useSituationInnerState()
  let stopGateEvaluation: (() => void) | undefined
  /** Stops thread extraction of the running gate; a late result of an earlier gate run is dropped. */
  let stopThreadExtraction: (() => void) | undefined
  /** The unprompted turn of the line the mind is speaking, from {@link speak} until its result. */
  let speaking: { chatTurnId: string, sessionId: string, line: VoiceLine, spoken: boolean, settle: (outcome: GateOutcome | 'refused') => void } | undefined
  /** Advances on every promotion and demotion, so a result from an earlier leadership is dropped. */
  let leadership = 0
  let stopVoiceTurnListener: (() => void) | undefined
  let stopUserInputListeners: (() => void) | undefined
  let remoteUserSpeaking = false
  /**
   * Whether the voice host presents an input that it still captures or transcribes. The user stopped speaking, but
   * speech-to-text has not submitted their message yet, so a turn that started now would be cancelled by that send.
   */
  let remoteUserInputInFlight = false
  let speakingTurns: readonly TurnRef[] = []
  /** The newest report of each chat composer, with the local time it arrived. */
  const composers = new Map<string, { hasDraft: boolean, lastInputAtMs: number, receivedAtMs: number }>()
  /** Notify topic keys that entered the situation during this leadership, oldest first. */
  const seenNotifyTopics = new Set<string>()
  /** The unprompted turn whose first literal was seen last, so its topic is addressed once. */
  let lastSpokenUnpromptedTurnId: string | undefined
  let stopSelfListener: (() => void) | undefined
  /** Feeds the character state from this leader's observations; see `bridgeSituationToCharacter`. */
  let characterBridge: SituationBridge | undefined
  const notifySpokenListeners = new Set<(spoken: { topicKey: string, text: string }) => void>()

  // Feeds the devtools Situation inspector of this window. Sync flush keeps it equal to the state after every call.
  watch([leading, current], ([isLeading, state]) => observability.publishLiveState(isLeading, state), { flush: 'sync', immediate: true })
  // The leader window runs chat and holds the character record, so it serves the devtools Memory and Character inspectors too.
  watch(leading, (isLeading) => {
    memoryObservability.setLeading(isLeading)
    characterStateObservability.setLeading(isLeading)
  }, { flush: 'sync', immediate: true })

  // What the sensor reported must leave the state too, so the next prompt carries no app or title. A changed read
  // policy does the same: the host stays silent about a newly blocked app, so no later reading would replace it.
  // Leader only; the situation is not replicated.
  watch([() => settings.document.shareForegroundWindow, () => foregroundReadPolicyKey(settings.document)], ([sharing, policy], [, previousPolicy]) => {
    if ((!sharing || policy !== previousPolicy) && leading.value)
      current.value = forgetForeground(current.value)
  }, { flush: 'sync' })

  // The same for the web extension: what it already sent leaves the state, so the next prompt carries none of it.
  watch(() => settings.document.shareBrowserActivity, (sharing) => {
    if (!sharing && leading.value)
      current.value = forgetSource(current.value, WEB_EXTENSION_SOURCE)
  }, { flush: 'sync' })

  /**
   * Whether the user shares what a source sends. Only the web extension has a switch (`shareBrowserActivity`); every
   * other source is always shared.
   */
  function sharesSource(sourceKey: string): boolean {
    return settings.document.shareBrowserActivity || !isSourceInNamespace(sourceKey, WEB_EXTENSION_SOURCE)
  }

  function advance(nowMs: number) {
    if (!leading.value)
      return
    current.value = advanceSituation(current.value, nowMs)
  }

  function startSensors(): RunningSensors {
    const desktop = startDesktopSensor(ingest, () => current.value.conversation.lastUserAtMs)
    const foreground = startForegroundSensor(ingest, {
      stageVisible: () => stageVisible.value,
      onCategory: (category) => { foregroundCategory.value = category },
    })
    const stopStage = startStageSensor(ingest)
    return {
      check(nowMs) {
        desktop.check(nowMs)
        foreground.check(nowMs)
      },
      selfAppIds: foreground.selfAppIds,
      stop() {
        desktop.stop()
        foreground.stop()
        stopStage()
      },
    }
  }

  /** Starts the conversation sensor once this window leads and the chat hooks are known, whichever comes last. */
  function startConversation() {
    if (!leading.value || !chatHooks || stopConversation)
      return
    const stopSensor = startConversationSensor(chatHooks, (observation) => {
      // Only one unprompted turn runs at a time, so a character turn that ends while a reaction runs is that reaction.
      // Its line was already folded with origin `reaction` when it started speaking, so it never counts as unprompted.
      if (speaking?.line.kind === 'reaction' && observation.kind === 'conversation' && observation.who === 'character' && observation.origin === 'unprompted')
        return
      ingest(observation)
      // The sensor reports user turns only for user-origin sends, so the character's own turns earn no engagement.
      if (observation.kind === 'conversation' && observation.who === 'user' && observation.origin === 'user') {
        // Speaking to her is being here: presence follows the turn at once, so this turn's own prompt says so.
        sensors?.check(observation.atMs)
        observability.recordUserTurn(observation.atMs)
        sendUserTurn(observation.atMs)
      }
    })
    exchangeSensor = startExchangeSensor(chatHooks, {
      quietMs: EXCHANGE_QUIET_MS,
      isSending: () => chat?.sending() ?? false,
      now: Date.now,
      onExchangeEnd(exchange) {
        for (const listener of exchangeEndListeners)
          listener(exchange)
      },
    })
    const stopSpokenListener = chatHooks.onTokenLiteral(async (_literal, context) => {
      // The runtime holds an unprompted reply until it decides to speak, so its first literal means spoken.
      if (context.origin !== 'unprompted' || context.turnId === lastSpokenUnpromptedTurnId)
        return
      lastSpokenUnpromptedTurnId = context.turnId
      const trigger = context.message.role === 'user' ? context.message.trigger : undefined
      const nowMs = Date.now()
      // A touch reaction is not a gate topic: it settles the reaction turn and never addresses the touch event.
      if (trigger?.topicKey === TOUCH_TOPIC_KEY) {
        if (speaking?.chatTurnId === context.turnId)
          lineSpoke(speaking, nowMs)
        else
          ingest({ kind: 'conversation', who: 'character', origin: 'reaction', atMs: nowMs })
        return
      }
      // Every spoken unprompted turn addresses its own topic here. A widget reaction's notify is addressed only once it
      // speaks, and its topic becomes the remark recorded when the reply ends, not the topic of an earlier declined turn.
      if (trigger)
        markAddressed(trigger.topicKey)
      // Settling a line as spoken now, not when the reply ends, lets a user reply mid-reply count as engagement.
      if (speaking?.chatTurnId === context.turnId && !speaking.spoken) {
        // A thread is consumed here and only here, so a declined, cancelled, or failed attempt leaves it eligible.
        if (trigger && isThreadTopic(trigger.topicKey))
          raiseThreadTopic(trigger.topicKey, nowMs)
        lineSpoke(speaking, nowMs)
      }
    })
    const stopDeclinedListener = chatHooks.onStreamEnd(async (context) => {
      // She chose to stay silent about the topic, so the gate must not raise it again. A busy, cancelled, or failed
      // turn was not her decision and leaves its topic alone. Her last remark is unchanged: only a spoken turn sets
      // it, after its own first literal addressed its topic.
      if (context.origin !== 'unprompted' || !context.cueStats?.declined)
        return
      const trigger = context.message.role === 'user' ? context.message.trigger : undefined
      // A declined touch reaction settles its reaction turn instead; the touch event is never addressed.
      if (trigger?.topicKey === TOUCH_TOPIC_KEY) {
        if (speaking?.chatTurnId === context.turnId)
          speaking.settle('declined')
        return
      }
      if (trigger)
        markAddressed(trigger.topicKey)
    })
    stopConversation = () => {
      stopSensor()
      exchangeSensor?.stop()
      exchangeSensor = undefined
      stopSpokenListener()
      stopDeclinedListener()
    }
  }

  /** Listens on the speech bus for the character speech of every window, for the gate. */
  function startVoiceTurnListener() {
    const context = getSpeechBusContext()
    const stop = context.on(voiceTurnsChanged, ({ body }) => {
      if (body)
        speakingTurns = body
    })
    // The audio host answers with its current turns, so a leader that starts mid-reply does not miss them.
    context.emit(voiceRequestTurns, undefined)
    return () => {
      stop()
      speakingTurns = []
    }
  }

  /**
   * Listens on the speech bus for the voice input and composer activity of every window, while this window leads. The
   * gate signals read them, and the mind holds widget requests on them.
   *
   * The voice host reports speech and transcription only while it lives. A host whose window crashes or is killed
   * sends no further report, so the store also watches the host's lock. When the lock ends, the store stops counting
   * the host's input and its speaking turns, which the same connection reports.
   */
  function startUserInputListeners() {
    const context = getSpeechBusContext()
    let watchedHost: { lock: string, stop: AbortController } | undefined
    const watchHost = (lock: string | undefined) => {
      if (watchedHost?.lock === lock)
        return
      watchedHost?.stop.abort('Voice host replaced')
      watchedHost = undefined
      if (!lock)
        return
      const host = { lock, stop: new AbortController() }
      watchedHost = host
      watchVoiceHostEnd(lock, host.stop.signal, () => {
        if (watchedHost !== host)
          return
        watchedHost = undefined
        remoteUserSpeaking = false
        remoteUserInputInFlight = false
        speakingTurns = []
      })
    }
    const stops = [
      context.on(speechInputUserSpeakingChangedEvent, ({ body }) => {
        if (!body)
          return
        remoteUserSpeaking = body.speaking
      }),
      context.on(voiceSnapshotChanged, ({ body }) => {
        if (!body)
          return
        const phase = body.connected ? body.input?.phase : undefined
        remoteUserInputInFlight = phase === 'capturing' || phase === 'finalizing'
        watchHost(body.connected ? body.lock : undefined)
      }),
      context.on(chatComposerActivityChangedEvent, ({ body }) => {
        if (!body)
          return
        composers.set(body.sourceId, { hasDraft: body.hasDraft, lastInputAtMs: body.lastInputAtMs, receivedAtMs: Date.now() })
      }),
    ]
    // The host answers with its snapshot, so a window that starts after the host connected still learns its lock.
    context.emit(voiceRequestSnapshot, undefined)
    return () => {
      for (const stop of stops)
        stop()
      watchHost(undefined)
      remoteUserSpeaking = false
      remoteUserInputInFlight = false
      composers.clear()
    }
  }

  function userTyping(nowMs: number): boolean {
    return typingEndsAtMs(nowMs) !== undefined
  }

  /**
   * Returns the time at which the last composer that reports writing stops counting, or `undefined` when none does.
   * A report counts until it expires; one without a draft counts only until its input is no longer recent.
   */
  function typingEndsAtMs(nowMs: number): number | undefined {
    let endsAtMs: number | undefined
    for (const [sourceId, report] of composers) {
      if (nowMs - report.receivedAtMs > COMPOSER_REPORT_EXPIRY_MS) {
        composers.delete(sourceId)
        continue
      }
      if (report.hasDraft || nowMs - report.lastInputAtMs < COMPOSER_INPUT_RECENT_MS) {
        const expiresAtMs = report.receivedAtMs + COMPOSER_REPORT_EXPIRY_MS
        const reportEndsAtMs = report.hasDraft ? expiresAtMs : Math.min(expiresAtMs, report.lastInputAtMs + COMPOSER_INPUT_RECENT_MS)
        endsAtMs = Math.max(endsAtMs ?? reportEndsAtMs, reportEndsAtMs)
      }
    }
    return endsAtMs
  }

  /** Whether the user speaks into the microphone, or speech-to-text still finishes what they said. */
  function userSpeakingOrTranscribing(): boolean {
    return remoteUserSpeaking || remoteUserInputInFlight
  }

  /** Shows the gate memory and the open threads in the devtools Situation inspector at once, and saves them if durable. */
  function publishGateState() {
    observability.publishUrgeState(run.memory ?? initialUrgeMemory, threads.threads)
    saveInnerState()
  }

  function innerStateSnapshot(): string {
    return JSON.stringify([run.memory && savedGateMemory(run.memory), threads.threads, extractedThrough])
  }

  /**
   * Saves the social memory, the threads, and the extraction read positions while the gate runs, only when one of
   * their fields changed (a fire, an outcome, a user turn, a day roll, a thread raised or expired, a ritual done, an
   * extraction read). The leadership token keeps a demoted
   * window from overwriting its successor's save. A refused write is retried at the next change.
   */
  function saveInnerState() {
    if (gateTicker === undefined)
      return
    const snapshot = innerStateSnapshot()
    if (snapshot === savedSnapshot)
      return
    // Before a mind published a memory in this run, the stored gate slice stays as it is.
    const gate = run.memory ? savedGateMemory(run.memory) : undefined
    if (innerState.write({ gate, threads: threads.threads, extractedThrough }, leadership))
      savedSnapshot = snapshot
  }

  function raiseThreadTopic(topicKey: string, nowMs: number) {
    const thread = threads.threads.find(candidate => candidate.topicKey === topicKey)
    if (thread)
      threads = pruneThreads(raiseThread(threads, thread.id, nowMs), nowMs)
  }

  function isRecent(sampledAtMs: number | null | undefined, nowMs: number, limitMs: number): boolean {
    return typeof sampledAtMs === 'number' && Number.isFinite(sampledAtMs) && Math.abs(nowMs - sampledAtMs) <= limitMs
  }

  function gateSignals(controls: SituationChatControls, nowMs: number): GateSignals {
    return {
      userSpeaking: userSpeakingOrTranscribing(),
      userTyping: userTyping(nowMs),
      characterSpeaking: speakingTurns.length > 0,
      generating: controls.sending(),
      queued: controls.pendingQueuedSendCount(),
      desktopFresh: isRecent(desktopActivity.snapshot?.sampledAtMs, nowMs, DESKTOP_SAMPLE_STALE_MS),
      // Without foreground sharing the gate holds as on a host without a foreground reader.
      foregroundFresh: settings.document.shareForegroundWindow && isRecent(foregroundWindow.sample?.sampledAtMs, nowMs, FOREGROUND_SAMPLE_STALE_VISIBLE_MS),
      stageVisible: stageVisible.value,
    }
  }

  /** The gate settings from the user's situation settings; the reaction policy reads the same ones. */
  function gateSettings(): GateSettings {
    const document = settings.document
    return {
      enabled: document.unpromptedEnabled,
      chattiness: document.chattiness,
      dontDisturb: document.dontDisturb,
      // Settings list executable or bundle names; the gate matches app ids without their extension.
      quietApps: document.quietApps.map(pattern => withoutAppExtension(
        pattern.trim(),
        typeof window !== 'undefined' && isElectronWindow(window) ? window.platform : undefined,
      )),
      speakDuringGames: document.speakDuringGames,
    }
  }

  /** The mind's view of this moment, which a tick and a widget request carry. Prunes the threads first. */
  function voiceView(controls: SituationChatControls): VoiceView {
    const nowMs = Date.now()
    threads = pruneThreads(threads, nowMs)
    return {
      run,
      situation: current.value,
      threads: { threads },
      local: localTimeFor(nowMs),
      sessionId: controls.activeSessionId(),
      signals: gateSignals(controls, nowMs),
      settings: gateSettings(),
      // The bridge runs for as long as this window leads, so every tick has it. Without a reading yet the timing
      // stays as it was.
      moodFactor: characterBridge?.urgeFactor() ?? 1,
      // A line of the mind that settled at its first literal is still pending in chat until its result arrives.
      unpromptedPending: speaking !== undefined || controls.unpromptedPending(),
    }
  }

  /**
   * Sends the connected mind one gate tick with the view of this moment, and returns whether a mind received it. The
   * view is built as the gate's input: the signals, the settings, the local time, the pruned threads, the mood factor,
   * and whether another unprompted turn is pending. A user turn that no mind could receive follows
   * the tick, which restores the gate memory of a mind that is new to the run.
   * `forceTiming` (devtools "Evaluate now") skips the timing guards only; a forced fire starts its turn like any other.
   */
  function voiceTick(forceTiming = false): boolean {
    const controls = chat
    const connected = mind
    if (!controls || !connected || gateTicker === undefined)
      return false
    connected.send({ kind: 'voice-tick', forceTiming, view: voiceView(controls) })
    connected.tickedRun = run.id
    if (pendingUserTurnAtMs !== null && mind === connected) {
      const atMs = pendingUserTurnAtMs
      pendingUserTurnAtMs = null
      connected.send({ kind: 'user-turn', atMs })
    }
    return true
  }

  /** Tells the mind of a user turn, or keeps it until a mind that holds this run's gate memory can receive it. */
  function sendUserTurn(atMs: number) {
    if (mind && mind.tickedRun === run.id)
      mind.send({ kind: 'user-turn', atMs })
    else
      pendingUserTurnAtMs = atMs
  }

  /**
   * Devtools "Evaluate now": one tick with `forceTiming`, answered with the decision that {@link publishVoice}
   * received in the same call. The mind evaluates nothing while one of its lines or another unprompted turn is open.
   */
  function evaluateNow(): SituationGateEvaluation {
    if (!chat)
      return { status: 'skipped', reason: 'gate-not-running' }
    const published: NonNullable<typeof evaluation> = { decision: null, memory: null }
    evaluation = published
    try {
      if (!voiceTick(true))
        return { status: 'skipped', reason: 'no-mind' }
      return published.decision && published.memory
        ? { status: 'evaluated', decision: published.decision, memory: published.memory }
        : { status: 'skipped', reason: 'unprompted-pending' }
    }
    finally {
      evaluation = undefined
    }
  }

  /**
   * Stores what the mind published after a step that touched its voice state: the memory becomes the run's mirror,
   * which the character state reads and the next mind of the run restores from, and it is saved with the leadership
   * token when a durable field changed. A decision is recorded in the inspector. A memory of an earlier run, or one
   * that arrives while the gate does not run, is dropped. `wakeAtMs` replaces the one wake timer: the mind gets a tick
   * at its next widget deadline, so a drop or a cancel is not late by up to {@link GATE_INTERVAL_MS}.
   */
  function publishVoice(update: { runId: number, memory: UrgeGateMemory, decision: UrgeGateDecision | null, wakeAtMs: number | null }) {
    if (gateTicker === undefined || update.runId !== run.id)
      return
    clearTimeout(wakeTimer)
    wakeTimer = update.wakeAtMs === null ? undefined : setTimeout(voiceTick, Math.max(0, update.wakeAtMs - Date.now()))
    run = { ...run, memory: update.memory }
    if (update.decision)
      observability.recordUrgeDecision(update.decision, update.memory)
    // A step that the line started (a user turn during its send) publishes no decision and keeps the evaluation's.
    if (evaluation && update.decision) {
      evaluation.decision = update.decision
      evaluation.memory = update.memory
    }
    publishGateState()
  }

  /**
   * Connects the leader's character mind: `send` receives every gate tick and user turn from now on. The newest
   * connection wins. While the gate runs, the mind gets a tick at once, so it restores the run's gate memory before
   * any other stimulus, and then the user turn that arrived while no mind was connected. Returns a function that
   * disconnects this connection; it does nothing once a newer one replaced it. The widget requests the previous mind
   * still held are lost with it, so their callers get `failed`.
   */
  function connect(send: (stimulus: VoiceStimulus) => void): () => void {
    failWaitingRequests()
    const connection: NonNullable<typeof mind> = { send, tickedRun: null }
    mind = connection
    voiceTick()
    return () => {
      if (mind !== connection)
        return
      mind = undefined
      clearTimeout(wakeTimer)
      wakeTimer = undefined
      failWaitingRequests()
    }
  }

  /** Answers one widget caller once; a later answer for the same turn does nothing. */
  function settleWidget(turnId: string, result: ChatUnpromptedResult) {
    const settle = widgetCallers.get(turnId)
    widgetCallers.delete(turnId)
    settle?.(result)
  }

  /** Answers `failed` to every widget caller whose line is not running in chat; a running line answers with its result. */
  function failWaitingRequests() {
    for (const turnId of [...widgetCallers.keys()]) {
      if (speaking?.chatTurnId !== turnId)
        settleWidget(turnId, { status: 'failed', error: 'The character mind that held the request is gone' })
    }
  }

  /**
   * Asks the leader's character mind to speak about a widget or plugin request, and resolves with what became of
   * it: `spoken` with the reply text, `declined`, `cancelled` when the mind gave up the request or stopped its line at
   * the caller's deadline, or `failed`. Resolves `failed` at once in a follower window, while the gate loop does not
   * run, and when no mind is connected.
   *
   * The request reaches the mind synchronously, so a caller that ingests the request's notify after this call has its
   * topic held from the gate from the start. `turnId` (`spark:<id>`) is also the chat message id of the turn.
   */
  function requestVoice(request: VoiceRequest): Promise<ChatUnpromptedResult> {
    const controls = chat
    const connected = mind
    if (!leading.value || !controls || !connected || gateTicker === undefined)
      return Promise.resolve({ status: 'failed', error: 'No character mind can take the request' })
    return new Promise((resolve) => {
      // Registered before the send: a mind that finds a quiet moment speaks the line within the same call.
      widgetCallers.set(request.turnId, resolve)
      connected.send({ kind: 'voice-request', request, view: voiceView(controls) })
    })
  }

  /** Cancels the chat turn of a widget line that missed its caller's deadline, and answers its caller `cancelled`. */
  function cancel(turnId: string) {
    if (speaking?.chatTurnId === turnId && chat)
      void chat.cancelTurn({ sessionId: speaking.sessionId, turnId })
    settleWidget(turnId, { status: 'cancelled' })
  }

  /** Answers the caller of a widget request that the mind gave up before it started, with `cancelled`. */
  function drop(turnId: string) {
    settleWidget(turnId, { status: 'cancelled' })
  }

  /**
   * Folds a touch into the situation and returns what the touch reaction policy needs to see of it and of the voice
   * channel. Returns `null` in a follower window and while the gate does not run: nobody could speak the line. The
   * caller must not also {@link ingest} the same touch.
   */
  function observeTouch(observation: TouchObservation): TouchVoiceView | null {
    ingest(observation)
    const controls = chat
    if (!leading.value || !controls || gateTicker === undefined)
      return null
    return touchVoiceView({
      touch: observation,
      situation: current.value,
      sessionId: controls.activeSessionId(),
      signals: gateSignals(controls, Date.now()),
      settings: gateSettings(),
    })
  }

  /**
   * Records a return or a desktop wake that the character mind decided. Does nothing in a follower window. The
   * mind is the gate's only source of a return; the desktop sensor reports presence only.
   */
  function observeReturn(observation: ReturnObservation | WakeObservation): void {
    ingest(observation)
  }

  /**
   * Speaks the line the mind decided and resolves with what became of it: at the first spoken literal, at a decline,
   * or with the result of the turn.
   *
   * A reach-out applies `unpromptedTopicText` and addresses its topic before the send (a thread topic only once her
   * turn about it speaks), then starts an unprompted turn with the category's instruction. Its outcome is recorded per
   * reason kind for the inspector. A touch line marks its touch event as shown (the trigger message carries it) and
   * starts a reaction turn.
   *
   * A widget line applies `unpromptedTopicText` and starts a widget turn under the request's turn id; its caller
   * receives the turn's result.
   *
   * It resolves `refused` without sending while another unprompted turn is pending, so a touch stays unshown for her
   * next reply. It resolves `failed` in a follower window, while the gate does not run, when a touch line's event is
   * gone, and when this window stopped leading before the turn had a result.
   */
  function speak(turnId: string, line: VoiceLine): Promise<GateOutcome | 'refused'> {
    const controls = chat
    if (!leading.value || !controls || gateTicker === undefined) {
      if (line.kind === 'widget')
        settleWidget(turnId, { status: 'failed', error: 'The gate loop does not run' })
      return Promise.resolve('failed')
    }
    if (line.kind === 'reaction') {
      const event = current.value.events.find(candidate => candidate.id === line.eventId)
      if (!event)
        return Promise.resolve('failed')
      if (speaking || controls.unpromptedPending()) {
        observability.recordReactionOutcome(line.reaction, 'refused')
        return Promise.resolve('refused')
      }
      current.value = markShown(current.value, [event.id], Date.now())
      return runLine(turnId, line, () => controls.submitReaction({ kind: line.reaction, topicText: event.text, eventId: line.eventId }), (outcome) => {
        observability.recordReactionOutcome(line.reaction, outcome)
      })
    }

    if (line.kind === 'widget') {
      if (speaking || controls.unpromptedPending()) {
        settleWidget(turnId, { status: 'failed', error: UNPROMPTED_BUSY_ERROR })
        return Promise.resolve('refused')
      }
      // The chat message id is the request's turn id, which the widget's CALL handlers listen to. The topic is
      // addressed at the first literal, so a declined, cancelled, or failed line leaves the notify for her to raise.
      return runLine(turnId, line, () => controls.submitUnprompted({
        widget: true,
        topicKey: line.topicKey,
        topicText: unpromptedTopicText(line.topicKey, line.topicText, true),
        messageId: turnId,
        supplement: line.supplement ?? undefined,
      }), () => {}, result => settleWidget(turnId, result))
    }
    if (speaking || controls.unpromptedPending())
      return Promise.resolve('refused')
    const { topicKey, reason } = line
    const aboutNotify = reason.kind === 'notify'
    // The chat message id is the store's own; the mind's turn id names the line only between the mind and this store.
    const messageId = nanoid()
    if (!isThreadTopic(topicKey))
      markAddressed(topicKey)
    return runLine(messageId, line, () => controls.submitUnprompted({
      topicKey,
      topicText: unpromptedTopicText(topicKey, line.topicText, aboutNotify),
      reason,
      messageId,
    }), (outcome) => {
      if (outcome !== 'refused')
        observability.recordReasonOutcome(reason.kind, outcome, Date.now())
    }, (result) => {
      const text = result.status === 'spoken' ? result.text.trim() : ''
      if (aboutNotify && text) {
        for (const listener of notifySpokenListeners)
          listener({ topicKey, text })
      }
    })
  }

  /**
   * Runs one line's chat turn. The first outcome wins: a literal or a decline arrives before the turn's own result.
   * A busy result (another caller's unprompted turn won the race) settles as `refused`.
   */
  function runLine(
    chatTurnId: string,
    line: VoiceLine,
    submit: () => Promise<ChatUnpromptedResult>,
    onSettle: (outcome: GateOutcome | 'refused') => void,
    onResult?: (result: ChatUnpromptedResult) => void,
  ): Promise<GateOutcome | 'refused'> {
    const startedIn = leadership
    return new Promise((resolve) => {
      let settled = false
      const turn: NonNullable<typeof speaking> = {
        chatTurnId,
        sessionId: chat?.activeSessionId() ?? '',
        line,
        spoken: false,
        settle(outcome) {
          if (settled)
            return
          settled = true
          onSettle(outcome)
          resolve(outcome)
        },
      }
      speaking = turn

      const awaitResult = async () => {
        let result: ChatUnpromptedResult
        try {
          result = await submit()
        }
        catch (error) {
          result = { status: 'failed', error: errorMessageFrom(error) ?? 'Unknown unprompted turn failure' }
        }
        finally {
          if (speaking === turn)
            speaking = undefined
        }
        // The turn belongs to an earlier leadership; its outcome is not this leader's to count.
        if (startedIn !== leadership) {
          settled = true
          resolve('failed')
          return
        }
        if (result.status === 'failed' && result.error === UNPROMPTED_BUSY_ERROR)
          turn.settle('refused')
        // A spoken turn settles at its first literal; a spoken result that arrives first settles it the same way.
        else if (result.status === 'spoken' && !turn.spoken)
          lineSpoke(turn, Date.now())
        else
          turn.settle(result.status)
        onResult?.(result)
      }
      void awaitResult()
    })
  }

  /** Records the first literal of a line: it settles as spoken, and a touch line counts as her last line. */
  function lineSpoke(turn: NonNullable<typeof speaking>, nowMs: number) {
    turn.spoken = true
    if (turn.line.kind === 'reaction')
      ingest({ kind: 'conversation', who: 'character', origin: 'reaction', atMs: nowMs })
    turn.settle('spoken')
  }

  /**
   * Calls `listener` with the topic key and reply text of every gate-fired turn about a notify that was spoken.
   * Declined, cancelled, and failed turns are not reported. Only the leader fires, so only its listeners are called.
   * Returns a function that removes the listener.
   */
  function onNotifySpoken(listener: (spoken: { topicKey: string, text: string }) => void): () => void {
    notifySpokenListeners.add(listener)
    return () => notifySpokenListeners.delete(listener)
  }

  /**
   * Calls `listener` once for every chat exchange that ended: at least one user turn, then
   * {@link EXCHANGE_QUIET_MS} without a turn while nothing generates. Only the leader runs the exchange sensor, so only
   * its listeners are called; an exchange still open on demotion is dropped. Returns a function that removes the
   * listener.
   */
  function onExchangeEnd(listener: (exchange: ChatExchange) => void): () => void {
    exchangeEndListeners.add(listener)
    return () => exchangeEndListeners.delete(listener)
  }

  /**
   * Extracts the open threads of every exchange that ends while the gate runs, and stores and saves them for the gate.
   * Threads feed only the gate, and only a running gate saves them, so a host without unprompted turns spends no
   * extraction call. The chat controls are read per call: the gate may start before the chat store hands them over,
   * and the exchange sensor that ends exchanges runs only once it did. Returns a function that stops listening and
   * drops the result of an extraction still in flight.
   */
  function startThreadExtraction(): () => void {
    let active = true
    const extractor = createThreadExtractor({
      stream: (model, provider, conversation, options) => chat
        ? chat.stream(model, provider, conversation, options)
        : Promise.reject(new Error('The chat store has not handed over its controls')),
      selection: async sessionId => await chat?.extractionSelection(sessionId) ?? null,
      messages: sessionId => chat?.sessionMessages(sessionId) ?? [],
      extractedThrough: sessionId => extractedThrough.find(position => position.sessionId === sessionId)?.messageId,
      heldTitles: () => heldTitles(current.value),
      onExtractedThrough(sessionId, messageId) {
        if (!active)
          return
        const others = extractedThrough.filter(position => position.sessionId !== sessionId)
        extractedThrough = [...others.slice(-(EXTRACTION_READ_POSITIONS_MAX - 1)), { sessionId, messageId }]
        saveInnerState()
      },
      onThreads(drafts, sessionId) {
        if (!active)
          return
        const nowMs = Date.now()
        threads = addThreads(threads, drafts, sessionId, nowMs, { dayEndsAtMs: nextLogicalDayEndsAtMs(nowMs) })
        // Publishes the new threads to the inspector and saves them with the social memory.
        publishGateState()
      },
      onEvents: (events, sessionId) => {
        if (active)
          void characterBridge?.onExtractedEvents(events, sessionId)
      },
      onLedger: entry => observability.recordExtraction(entry),
      onInFlight: inFlight => observability.publishExtractionInFlight(inFlight),
      now: Date.now,
    })
    const stopListening = onExchangeEnd((exchange) => {
      void extractor.extract(exchange)
    })
    return () => {
      active = false
      stopListening()
    }
  }

  /** Runs the gate loop only while this window leads in a host that supports unprompted turns. */
  function syncGateLoop() {
    const shouldRun = leading.value && hostSupportsUnprompted.value
    if (shouldRun && gateTicker === undefined) {
      // A new run: the mind eases in again but restores the saved social memory and ritual day at its first tick, and
      // the threads stay, so a reload neither greets twice nor forgets an unanswered opening.
      const saved = innerState.read(Date.now())
      run = { id: run.id + 1, memory: null, saved: saved.gate }
      threads = { threads: saved.threads }
      extractedThrough = saved.extractedThrough
      savedSnapshot = innerStateSnapshot()
      stopVoiceTurnListener = startVoiceTurnListener()
      gateTicker = setInterval(voiceTick, GATE_INTERVAL_MS)
      stopGateEvaluation = observability.serveGateEvaluation(evaluateNow)
      stopThreadExtraction = startThreadExtraction()
      publishGateState()
      // A connected mind restores the new run's gate memory at once.
      voiceTick()
    }
    else if (!shouldRun && gateTicker !== undefined) {
      // The final save runs while the leadership token is still this window's.
      saveInnerState()
      clearInterval(gateTicker)
      gateTicker = undefined
      clearTimeout(wakeTimer)
      wakeTimer = undefined
      stopGateEvaluation?.()
      stopGateEvaluation = undefined
      stopThreadExtraction?.()
      stopThreadExtraction = undefined
      stopVoiceTurnListener?.()
      stopVoiceTurnListener = undefined
      threads = NO_THREADS
      extractedThrough = []
      speaking = undefined
      // No line can run any more, so every widget caller is answered now.
      failWaitingRequests()
      savedSnapshot = undefined
      run = { ...run, memory: null, saved: null }
      publishGateState()
    }
  }

  function startLeading() {
    if (leading.value)
      return
    current.value = initialSituationState
    leading.value = true
    leadership += 1
    innerState.claim(leadership)
    characterBridge = bridgeSituationToCharacter({
      situation: () => current.value,
      gate: () => run.memory ?? initialUrgeMemory,
      extractedThrough: sessionId => extractedThrough.find(position => position.sessionId === sessionId)?.messageId,
      messages: sessionId => chat?.sessionMessages(sessionId) ?? [],
    })
    // Sensors report their current readings at once, so they start after `leading` lets `ingest` through.
    sensors = startSensors()
    stopUserInputListeners = startUserInputListeners()
    startConversation()
    // Notifies that follower windows received arrive here; repeats of ones this window ingested are dropped by `ingest`.
    stopNotifyListener = getSpeechBusContext().on(situationNotifyObservedEvent, ({ body }) => {
      if (body)
        ingest(body)
    })
    // What she does on her own on every stage window, this one's included, arrives here.
    stopSelfListener = getSpeechBusContext().on(situationSelfObservedEvent, ({ body }) => {
      if (body)
        ingest(body)
    })
    stopForgetListener = getSpeechBusContext().on(situationForgetRequestedEvent, ({ body }) => {
      if (body)
        applyForget(body)
    })
    ticker = setInterval(() => {
      const nowMs = Date.now()
      sensors?.check(nowMs)
      exchangeSensor?.check(nowMs)
      advance(nowMs)
    }, ADVANCE_INTERVAL_MS)
    syncGateLoop()
  }

  function stopLeading() {
    // Sensors stop first, so nothing is folded into the state that is dropped below.
    sensors?.stop()
    sensors = undefined
    stopUserInputListeners?.()
    stopUserInputListeners = undefined
    stopConversation?.()
    stopConversation = undefined
    stopNotifyListener?.()
    stopNotifyListener = undefined
    stopSelfListener?.()
    stopSelfListener = undefined
    stopForgetListener?.()
    stopForgetListener = undefined
    characterBridge?.stop()
    characterBridge = undefined
    if (ticker !== undefined)
      clearInterval(ticker)
    ticker = undefined
    const wasLeading = leading.value
    leading.value = false
    // The gate stops (and saves) before the leadership advances, so its final save still carries this window's token.
    syncGateLoop()
    if (wasLeading)
      leadership += 1
    current.value = initialSituationState
    seenNotifyTopics.clear()
    lastSpokenUnpromptedTurnId = undefined
    pendingUserTurnAtMs = null
    foregroundCategory.value = null
  }

  /**
   * Folds one observation into the situation. Followers and uninitialized windows ignore it.
   *
   * A notify enters the situation once per leadership: a repeat of a remembered topic key is dropped even after its
   * event decayed out of the ring, so one notification is never raised (and spoken) twice. A context or notify from a
   * source the user does not share ({@link sharesSource}) is dropped.
   */
  function ingest(observation: Observation) {
    if (!leading.value)
      return
    if ((observation.kind === 'context' || observation.kind === 'notify') && !sharesSource(observation.sourceKey))
      return
    const notifyKey = observation.kind === 'notify' ? notifyTopicKey(observation.sourceKey, observation.eventId) : undefined
    if (notifyKey !== undefined && seenNotifyTopics.has(notifyKey))
      return
    current.value = reduceSituation(current.value, observation, Date.now(), { selfAppIds: sensors?.selfAppIds() ?? [] })
    if (notifyKey !== undefined && current.value.events.some(event => event.topicKey === notifyKey)) {
      seenNotifyTopics.add(notifyKey)
      const oldest = seenNotifyTopics.size > SEEN_NOTIFY_TOPICS_MAX ? seenNotifyTopics.values().next().value : undefined
      if (oldest !== undefined)
        seenNotifyTopics.delete(oldest)
    }
  }

  /**
   * Renders the situation block for one chat request and marks its `New:` events as shown, so the next request
   * does not repeat them. Returns `undefined` outside the leader, so a host that never initialized the store
   * sends no situation block.
   */
  function renderForRequest(nowMs: number): string | undefined {
    if (!leading.value)
      return undefined
    current.value = advanceSituation(current.value, nowMs)
    const rendered = renderSituation(current.value, nowMs)
    observability.recordRender(nowMs, rendered)
    if (rendered.shownEventIds.length > 0)
      current.value = markShown(current.value, rendered.shownEventIds, nowMs)
    return rendered.text
  }

  /**
   * Forgets what the character derived from conversations; {@link SituationForgetRequest} lists what each scope drops.
   *
   * Any window may call it. The leader applies it; a follower forwards it to the leader over the speech bus, because
   * the leader would otherwise write the forgotten state back at its next save. For `everything`, a follower also
   * clears the stored inner state, so the call works when no leader runs.
   */
  function forget(request: SituationForgetRequest) {
    if (leading.value) {
      applyForget(request)
      return
    }
    getSpeechBusContext().emit(situationForgetRequestedEvent, request)
    if (request.scope === 'everything')
      innerState.reset()
  }

  function applyForget(request: SituationForgetRequest) {
    if (!leading.value)
      return
    if (request.scope === 'sessions') {
      const deleted = new Set(request.sessionIds)
      threads = { threads: threads.threads.filter(thread => !deleted.has(thread.sessionId)) }
      extractedThrough = extractedThrough.filter(position => !deleted.has(position.sessionId))
    }
    else {
      threads = NO_THREADS
      extractedThrough = []
    }
    if (request.scope === 'everything') {
      current.value = initialSituationState
      seenNotifyTopics.clear()
      observability.forget()
      innerState.reset()
      savedSnapshot = undefined
      // A new run: the mind starts her over from promotion alone at its next tick.
      run = { id: run.id + 1, memory: null, saved: null }
      // Also clears the character state of every card; the bridge's own memory of reach-outs and turns goes with it.
      void characterBridge?.forgetEverything()
    }
    if (gateTicker !== undefined) {
      // An extraction still in flight read the forgotten messages, so its threads must not join the new state.
      stopThreadExtraction?.()
      stopThreadExtraction = startThreadExtraction()
    }
    // Publishes the remaining threads to the inspector and saves them while the gate runs.
    publishGateState()
  }

  /** Marks the events of one topic as addressed by the character. Followers ignore it. */
  function markAddressed(topicKey: string) {
    if (!leading.value)
      return
    current.value = markSituationAddressed(current.value, topicKey, Date.now())
  }

  /**
   * Receives the chat runtime hooks and controls of this window. The chat store calls it once from its setup; the
   * first source wins. While this window leads, the conversation sensor records user and character turns from these
   * hooks, and the gate reads the controls and starts unprompted turns through them.
   */
  function observeChat(hooks: SituationChatHooks, controls: SituationChatControls) {
    if (!chatHooks) {
      chatHooks = hooks
      chat = controls
    }
    startConversation()
  }

  /**
   * Declares what the host can do. Only a host that sets `unprompted` runs the gate loop, so the character speaks up
   * on her own there and nowhere else (the Electron app sets it; web never does).
   */
  function setHostCapabilities(capabilities: { unprompted: boolean }) {
    hostSupportsUnprompted.value = capabilities.unprompted
    syncGateLoop()
  }

  /**
   * Reports whether this window's stage is on screen (visible and not minimized). The gate reads it: the desktop
   * producer keeps publishing fresh lock and unlock samples while the stage is hidden, so sample freshness alone
   * cannot tell. The foreground sensor also uses it to pick its staleness limit. A host that never reports counts
   * as hidden.
   */
  function setStageVisible(visible: boolean) {
    stageVisible.value = visible
  }

  /**
   * Binds the store to synchronized leadership. Repeated calls keep the first subscription. The leadership listener
   * runs immediately with the current role, so an initial leader starts at once.
   */
  function initialize(syncedPinia: SyncedPiniaRuntime) {
    stopLeadershipListener ??= syncedPinia.onLeadershipChange(isLeader => isLeader ? startLeading() : stopLeading())
  }

  /** Stops the leadership subscription, the user input listeners, the sensors, and the ticker of this window. */
  function dispose() {
    stopLeadershipListener?.()
    stopLeadershipListener = undefined
    stopLeading()
  }

  return {
    // Read-only projections. Pinia state stays empty, so no plugin can sync or persist the situation.
    state: computed(() => current.value),
    leading: computed(() => leading.value),
    foregroundCategory: computed(() => foregroundCategory.value),
    stageVisible: computed(() => stageVisible.value),
    hostSupportsUnprompted: computed(() => hostSupportsUnprompted.value),
    ingest,
    observeTouch,
    observeReturn,
    speak,
    cancel,
    drop,
    publishVoice,
    connect,
    requestVoice,
    sharesSource,
    advance,
    renderForRequest,
    markAddressed,
    forget,
    onNotifySpoken,
    onExchangeEnd,
    observeChat,
    setStageVisible,
    setHostCapabilities,
    initialize,
    dispose,
  }
})
