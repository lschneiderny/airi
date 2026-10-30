import type { ChatHistoryItem, ChatHookRegistry, TurnRef } from '@proj-airi/core-agent'
import type {
  AppCategory,
  GateLocalTime,
  GateSignals,
  Observation,
  ReasonKind,
  SavedGateMemory,
  SituationState,
  ThreadState,
  UrgeGateDecision,
  UrgeGateMemory,
} from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { ExtractionReadPosition } from '../../features/situation/inner-state'
import type { LlmStream, ThreadExtractionSelection } from '../../features/situation/thread-extraction'
import type { ChatUnpromptedPayload, ChatUnpromptedResult } from '../chat'
import type { SituationGateEvaluation } from '../devtools/situation-observability'
import type { ConversationHookSource } from './sensors/conversation'
import type { ChatExchange, ExchangeSensor } from './sensors/exchange'

import { errorMessageFrom } from '@moeru/std'
import { isElectronWindow } from '@proj-airi/stage-shared'
import {
  addThreads,
  advanceSituation,
  evaluateUrgeGate,
  forgetForeground,
  forgetSource,
  initialSituationState,
  initialUrgeMemory,
  isSourceInNamespace,
  isTopicFromSource,
  LOGICAL_DAY_ROLLOVER_HOUR,
  markShown,
  markAddressed as markSituationAddressed,
  notifyTopicKey,
  promotionUrgeMemory,
  pruneThreads,
  raiseThread,
  recordExternalSpeech,
  recordUrgeFireOutcome,
  recordUrgeUserTurn,
  reduceSituation,
  renderSituation,
  restoreSocialMemory,
  visibilityRegainUrgeMemory,
  withoutAppExtension,
} from '@proj-airi/stage-shared/situation'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'

import { localLogicalDayKey, useSituationInnerState } from '../../features/situation/inner-state'
import { useSituationSettings } from '../../features/situation/settings'
import { createThreadExtractor } from '../../features/situation/thread-extraction'
import { chatComposerActivityChangedEvent, getSpeechBusContext, situationNotifyObservedEvent, speechInputUserSpeakingChangedEvent, voiceRequestSnapshot, voiceRequestTurns, voiceSnapshotChanged, voiceTurnsChanged, watchVoiceHostEnd } from '../../services/speech/bus'
import { useMemoryObservabilityStore } from '../devtools/memory-observability'
import { useSituationObservabilityStore } from '../devtools/situation-observability'
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

/**
 * The source namespace of the AIRI web extension. Its module identity names the extension
 * `proj-airi:plugin-web-extension` (`PLUGIN_NAME` in `plugins/airi-plugin-web-extension/src/background/client.ts`), so
 * its context updates and notifies carry source keys `proj-airi:plugin-web-extension:<module id>`.
 */
export const WEB_EXTENSION_SOURCE = 'proj-airi:plugin-web-extension'

/**
 * The topic text of an unprompted turn. Its trigger message keeps this text in chat history. A web extension topic's
 * own text holds a page or video title and full link, so its trigger names only the kind of topic. The details reach
 * the model through the situation block of the same request, while the topic's context line or `New:` line is in it.
 */
function unpromptedTopicText(topicKey: string, text: string, aboutNotify: boolean): string {
  if (!isTopicFromSource(topicKey, WEB_EXTENSION_SOURCE))
    return text
  return aboutNotify ? 'a video the user started watching in the browser' : 'what the user has open in the browser'
}

/** `submitUnprompted` returns this error when another unprompted turn is still pending: busy, not a failure. */
const UNPROMPTED_BUSY_ERROR = 'Another unprompted turn is still pending'

const NO_THREADS: ThreadState = Object.freeze({ threads: Object.freeze([]) })

/**
 * How many chat sessions keep their thread extraction read position; the least recently extracted one is dropped
 * first. A dropped session's next extraction reads its newest messages again, within the extraction caps.
 */
const EXTRACTION_READ_POSITIONS_MAX = 64

/** A fresh uint32 for the gate's first urge threshold of a leadership. */
function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
}

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
    rngState: memory.rngState,
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
 * advance ticker checks and which reports finished exchanges through {@link onExchangeEnd}. Only the user input listeners run in
 * every initialized window, so {@link untilUserIdle} answers wherever a widget reaction is served.
 *
 * In a host that declared the `unprompted` capability ({@link setHostCapabilities}), the leader also runs the urge
 * gate every {@link GATE_INTERVAL_MS}. A fire addresses its topic (a thread topic is consumed only once her turn about
 * it speaks), then starts one unprompted turn through the chat controls, and the gate starts no other turn until that
 * one has a result. The gate's social memory (with the ritual day) and the open threads are restored from
 * `useSituationInnerState` when the gate starts and saved whenever a durable field changes, so a leader reload does
 * not start her from day one. Its randomness comes only from the seed that {@link initialize} takes. While the gate
 * runs, every exchange that ends is sent to the thread extractor, which asks the chat model what is still open in the
 * messages of that chat session that no earlier extraction read (the read positions are saved with the threads); the
 * threads it returns join the gate's reasons for that chat session, and each attempt shows in the inspector's
 * extraction ledger, never in chat history.
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
  let stopLeadershipListener: (() => void) | undefined
  const observability = useSituationObservabilityStore()
  const memoryObservability = useMemoryObservabilityStore()
  const settings = useSituationSettings()
  const desktopActivity = useDesktopActivityStore()
  const foregroundWindow = useForegroundWindowStore()

  const hostSupportsUnprompted = shallowRef(false)
  let gateTicker: ReturnType<typeof setInterval> | undefined
  let gateMemory: UrgeGateMemory = initialUrgeMemory
  /** Open threads of every chat session; the gate filters them by the active session. Rituals live in `gateMemory.day`. */
  let threads: ThreadState = NO_THREADS
  /** How far thread extraction read each chat session, least recently extracted first. */
  let extractedThrough: readonly ExtractionReadPosition[] = []
  /** The durable state last saved, serialized, so an evaluation that changed nothing durable writes nothing. */
  let savedSnapshot: string | undefined
  let seedSource: () => number = randomSeed
  const innerState = useSituationInnerState()
  let stopGateEvaluation: (() => void) | undefined
  /** Stops thread extraction of the running gate; a late result of an earlier gate run is dropped. */
  let stopThreadExtraction: (() => void) | undefined
  /** Whether the stage was on screen with a fresh desktop sample at the previous gate tick. */
  let wasStageShown = false
  /** The unprompted turn the gate started, from the fire until its result is recorded. */
  let firing: { turnId: string, kind: ReasonKind, spoken: boolean } | undefined
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
  /** Re-checks of the pending {@link untilUserIdle} waits, run on every voice input or composer report. */
  const userInputWaiters = new Set<() => void>()
  /** Notify topic keys that entered the situation during this leadership, oldest first. */
  const seenNotifyTopics = new Set<string>()
  /** Topics that another caller's forced turn is about to raise. The gate never picks them; see {@link holdTopic}. */
  const heldTopics = new Set<string>()
  /** The unprompted turn whose first literal was seen last, so its topic is addressed once. */
  let lastSpokenUnpromptedTurnId: string | undefined
  const notifySpokenListeners = new Set<(spoken: { topicKey: string, text: string }) => void>()

  // Feeds the devtools Situation inspector of this window. Sync flush keeps it equal to the state after every call.
  watch([leading, current], ([isLeading, state]) => observability.publishLiveState(isLeading, state), { flush: 'sync', immediate: true })
  // The leader window runs chat, so it serves the devtools Memory inspector too.
  watch(leading, isLeading => memoryObservability.setLeading(isLeading), { flush: 'sync', immediate: true })

  // The foreground sensor stops reporting by itself; what it reported earlier must leave the state too, so the next
  // prompt carries no app or title. Followers hold the initial state, and the situation is neither synced nor
  // persisted, so this watcher writes no replicated state.
  watch(() => settings.document.shareForegroundWindow, (sharing) => {
    if (!sharing && leading.value)
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
    const desktop = startDesktopSensor(ingest)
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
      ingest(observation)
      // The sensor reports user turns only for user-origin sends, so the character's own turns earn no engagement.
      if (observation.kind === 'conversation' && observation.who === 'user' && observation.origin === 'user') {
        observability.recordUserTurn(observation.atMs)
        setGateMemory(recordUrgeUserTurn(gateMemory, observation.atMs))
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
      // Every spoken unprompted turn addresses its own topic here, whoever started it. A widget reaction's notify is
      // addressed only once it speaks, and its topic becomes the remark recorded when the reply ends, not the topic
      // of an earlier declined turn.
      const trigger = context.message.role === 'user' ? context.message.trigger : undefined
      if (trigger)
        markAddressed(trigger.topicKey)
      const nowMs = Date.now()
      // Recording a gate fire as spoken now, not when the reply ends, lets a user reply mid-reply count as engagement.
      if (firing && !firing.spoken && context.turnId === firing.turnId) {
        firing.spoken = true
        // A thread is consumed here and only here, so a declined, cancelled, or failed attempt leaves it eligible.
        if (trigger && isThreadTopic(trigger.topicKey))
          raiseThreadTopic(trigger.topicKey, nowMs)
        observability.recordReasonOutcome(firing.kind, 'spoken', nowMs)
        setGateMemory(recordUrgeFireOutcome(gateMemory, 'spoken', nowMs))
      }
      else if (gateTicker !== undefined && context.turnId !== firing?.turnId) {
        // A forced widget or plugin turn spoke outside the gate. It starts the floor, so she does not open a new topic
        // right after it, but it never counts as an unanswered opening.
        setGateMemory(recordExternalSpeech(gateMemory, nowMs))
      }
    })
    const stopDeclinedListener = chatHooks.onStreamEnd(async (context) => {
      // She chose to stay silent about the topic, so the gate must not raise it again. A busy, cancelled, or failed
      // turn was not her decision and leaves its topic alone. Her last remark is unchanged: only a spoken turn sets
      // it, after its own first literal addressed its topic.
      if (context.origin !== 'unprompted' || !context.cueStats?.declined)
        return
      const trigger = context.message.role === 'user' ? context.message.trigger : undefined
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
   * Listens on the speech bus for the voice input and composer activity of every window. Unlike the rest of the store
   * this runs in followers too, from {@link initialize} until {@link dispose}: any main window may serve a widget
   * reaction, and the reaction waits through {@link untilUserIdle} wherever it runs.
   *
   * The voice host reports speech and transcription only while it lives. A host whose window crashes or is killed
   * sends no further report, so the store also watches the host's lock. When the lock ends, the store stops counting
   * the host's input and its speaking turns, which the same connection reports.
   */
  function startUserInputListeners() {
    const context = getSpeechBusContext()
    const recheckWaiters = () => {
      for (const recheck of [...userInputWaiters])
        recheck()
    }
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
        recheckWaiters()
      })
    }
    const stops = [
      context.on(speechInputUserSpeakingChangedEvent, ({ body }) => {
        if (!body)
          return
        remoteUserSpeaking = body.speaking
        recheckWaiters()
      }),
      context.on(voiceSnapshotChanged, ({ body }) => {
        if (!body)
          return
        const phase = body.connected ? body.input?.phase : undefined
        remoteUserInputInFlight = phase === 'capturing' || phase === 'finalizing'
        watchHost(body.connected ? body.lock : undefined)
        recheckWaiters()
      }),
      context.on(chatComposerActivityChangedEvent, ({ body }) => {
        if (!body)
          return
        composers.set(body.sourceId, { hasDraft: body.hasDraft, lastInputAtMs: body.lastInputAtMs, receivedAtMs: Date.now() })
        recheckWaiters()
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

  /**
   * Whether the user is mid-input in any window: speaking into the microphone, speech-to-text still finishing their
   * message, or writing in a chat composer (a draft that is not sent yet, or input within
   * {@link COMPOSER_INPUT_RECENT_MS}). Reads `false` before {@link initialize}.
   */
  function userMidInput(nowMs = Date.now()): boolean {
    return userSpeakingOrTranscribing() || userTyping(nowMs)
  }

  /**
   * Resolves `true` once the user is no longer mid-input (see {@link userMidInput}), at once when they are not, and
   * `false` when they still are after `timeoutMs`.
   *
   * Use when:
   * - A forced turn skips the gate and must not start while the user speaks or writes, for example a widget reaction.
   */
  function untilUserIdle(timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      let recheckTimer: ReturnType<typeof setTimeout> | undefined
      const deadline = setTimeout(finish, timeoutMs, false)
      function recheck() {
        clearTimeout(recheckTimer)
        const nowMs = Date.now()
        if (!userMidInput(nowMs)) {
          finish(true)
          return
        }
        // Writing ends with time alone, without another report; speaking ends only with a report.
        const endsAtMs = typingEndsAtMs(nowMs)
        if (endsAtMs !== undefined)
          recheckTimer = setTimeout(recheck, Math.max(1, endsAtMs - nowMs))
      }
      function finish(idle: boolean) {
        clearTimeout(recheckTimer)
        clearTimeout(deadline)
        userInputWaiters.delete(recheck)
        resolve(idle)
      }
      userInputWaiters.add(recheck)
      recheck()
    })
  }

  /** Changes the gate memory, shows the change in the devtools Situation inspector at once, and saves it if durable. */
  function setGateMemory(memory: UrgeGateMemory) {
    gateMemory = memory
    observability.publishUrgeState(memory, threads.threads)
    saveInnerState()
  }

  function innerStateSnapshot(): string {
    return JSON.stringify([savedGateMemory(gateMemory), threads.threads, extractedThrough])
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
    if (innerState.write({ gate: savedGateMemory(gateMemory), threads: threads.threads, extractedThrough }, leadership))
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

  /**
   * One gate evaluation. Nothing is evaluated while an unprompted turn is pending: from the fire until `sending`
   * turns true the chat reports nothing, so the gate's own `generating` guard cannot see it yet.
   * `forceTiming` (devtools "Evaluate now") skips the timing guards only; a forced fire starts its turn like any other.
   */
  function gateTick(forceTiming = false): SituationGateEvaluation {
    const controls = chat
    if (!controls)
      return { status: 'skipped', reason: 'gate-not-running' }
    if (firing || controls.unpromptedPending())
      return { status: 'skipped', reason: 'unprompted-pending' }

    const nowMs = Date.now()
    const signals = gateSignals(controls, nowMs)
    // A stage that comes back on screen eases in again, like a new leader, instead of speaking at once.
    const stageShown = signals.stageVisible && signals.desktopFresh
    if (stageShown && !wasStageShown)
      setGateMemory(visibilityRegainUrgeMemory(gateMemory, nowMs))
    wasStageShown = stageShown
    threads = pruneThreads(threads, nowMs)

    const document = settings.document
    const before = gateMemory
    const { decision, memory } = evaluateUrgeGate({
      nowMs,
      situation: current.value,
      reasons: { threads },
      local: localTimeFor(nowMs),
      sessionId: controls.activeSessionId(),
      // The collector drops held keys for every reason kind, thread and urgent notify topics included.
      heldTopics,
      signals,
      settings: {
        enabled: document.unpromptedEnabled,
        chattiness: document.chattiness,
        dontDisturb: document.dontDisturb,
        // Settings list executable or bundle names; the gate matches app ids without their extension.
        quietApps: document.quietApps.map(pattern => withoutAppExtension(
          pattern.trim(),
          typeof window !== 'undefined' && isElectronWindow(window) ? window.platform : undefined,
        )),
        speakDuringGames: document.speakDuringGames,
      },
      forceTiming,
    }, gateMemory)
    // Recording the decision publishes this memory to the inspector too.
    gateMemory = memory
    observability.recordUrgeDecision(decision, memory)
    observability.publishUrgeState(memory, threads.threads)
    saveInnerState()
    if (decision.fire)
      void fire(controls, decision, before)
    return { status: 'evaluated', decision, memory }
  }

  /**
   * Starts the unprompted turn of a fire and records its outcome. The topic is addressed before the turn starts,
   * except a thread topic, which only a spoken turn consumes.
   */
  async function fire(controls: SituationChatControls, decision: Extract<UrgeGateDecision, { fire: true }>, before: UrgeGateMemory) {
    const { picked } = decision
    const turn = { turnId: nanoid(), kind: picked.kind, spoken: false }
    const startedIn = leadership
    const aboutNotify = picked.kind === 'notify'
    firing = turn
    if (!isThreadTopic(picked.key))
      markAddressed(picked.key)
    let result: ChatUnpromptedResult
    try {
      result = await controls.submitUnprompted({
        topicKey: picked.key,
        topicText: unpromptedTopicText(picked.key, picked.text, aboutNotify),
        reason: { kind: picked.kind, category: decision.category },
        messageId: turn.turnId,
      })
    }
    catch (error) {
      result = { status: 'failed', error: errorMessageFrom(error) ?? 'Unknown unprompted turn failure' }
    }
    finally {
      firing = undefined
    }
    if (startedIn !== leadership)
      return
    if (result.status === 'failed' && result.error === UNPROMPTED_BUSY_ERROR) {
      // Another caller's unprompted turn won the race. This fire never happened, so it takes no floor or cap slot and
      // spends no urge or random draw. A user turn may have landed meanwhile, so the social fields stay current.
      setGateMemory({
        ...gateMemory,
        lastFireAtMs: before.lastFireAtMs,
        fires: before.fires,
        pending: before.pending,
        urge: before.urge,
        urgeThreshold: before.urgeThreshold,
        rngState: before.rngState,
        doubleText: before.doubleText,
      })
      return
    }
    if (!turn.spoken) {
      const nowMs = Date.now()
      // A spoken turn whose first literal was seen is counted there, with the time she started speaking.
      observability.recordReasonOutcome(picked.kind, result.status, nowMs)
      setGateMemory(recordUrgeFireOutcome(gateMemory, result.status, nowMs))
    }
    const text = result.status === 'spoken' ? result.text.trim() : ''
    if (aboutNotify && text) {
      for (const listener of notifySpokenListeners)
        listener({ topicKey: picked.key, text })
    }
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
        setGateMemory(gateMemory)
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
      // A new leader starts with no urge and eases in, but keeps the social memory, the ritual day, and the threads of
      // the leader before it, so a reload neither greets twice nor forgets an unanswered opening.
      const nowMs = Date.now()
      const saved = innerState.read(nowMs)
      const promoted = promotionUrgeMemory(nowMs, seedSource())
      gateMemory = saved.gate === null ? promoted : restoreSocialMemory(promoted, saved.gate, nowMs)
      threads = { threads: saved.threads }
      extractedThrough = saved.extractedThrough
      savedSnapshot = innerStateSnapshot()
      wasStageShown = false
      stopVoiceTurnListener = startVoiceTurnListener()
      gateTicker = setInterval(gateTick, GATE_INTERVAL_MS)
      stopGateEvaluation = observability.serveGateEvaluation(() => gateTick(true))
      stopThreadExtraction = startThreadExtraction()
      setGateMemory(gateMemory)
    }
    else if (!shouldRun && gateTicker !== undefined) {
      // The final save runs while the leadership token is still this window's.
      saveInnerState()
      clearInterval(gateTicker)
      gateTicker = undefined
      stopGateEvaluation?.()
      stopGateEvaluation = undefined
      stopThreadExtraction?.()
      stopThreadExtraction = undefined
      stopVoiceTurnListener?.()
      stopVoiceTurnListener = undefined
      threads = NO_THREADS
      extractedThrough = []
      savedSnapshot = undefined
      setGateMemory(initialUrgeMemory)
    }
  }

  function startLeading() {
    if (leading.value)
      return
    current.value = initialSituationState
    leading.value = true
    leadership += 1
    innerState.claim(leadership)
    // Sensors report their current readings at once, so they start after `leading` lets `ingest` through.
    sensors = startSensors()
    startConversation()
    // Notifies that follower windows received arrive here; repeats of ones this window ingested are dropped by `ingest`.
    stopNotifyListener = getSpeechBusContext().on(situationNotifyObservedEvent, ({ body }) => {
      if (body)
        ingest(body)
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
    stopConversation?.()
    stopConversation = undefined
    stopNotifyListener?.()
    stopNotifyListener = undefined
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
    heldTopics.clear()
    lastSpokenUnpromptedTurnId = undefined
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
   * (for example Kirie, which shares the chat store) sends no situation block.
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

  /** Marks the events of one topic as addressed by the character. Followers ignore it. */
  function markAddressed(topicKey: string) {
    if (!leading.value)
      return
    current.value = markSituationAddressed(current.value, topicKey, Date.now())
  }

  /**
   * Keeps one topic away from the gate until the returned function releases it. Followers hold nothing.
   *
   * Use when:
   * - Another caller is about to raise the topic in a forced unprompted turn, for example a widget reaction. The
   *   turn reaches the chat a few ticks later (a synced call, then `prepareSend`), and the gate must not raise the
   *   same topic meanwhile.
   *
   * Unlike {@link markAddressed}, holding leaves the topic unaddressed: a spoken turn addresses it at its first
   * literal, and after a declined, cancelled, or failed turn the gate may still raise it.
   */
  function holdTopic(topicKey: string): () => void {
    if (!leading.value)
      return () => {}
    heldTopics.add(topicKey)
    return () => heldTopics.delete(topicKey)
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
   * on her own there and nowhere else (the Electron app sets it; web and Pocket never do).
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
   * Binds the store to synchronized leadership and starts the user input listeners. Repeated calls keep the first
   * subscription and its options. The leadership listener runs immediately with the current role, so an initial leader
   * starts at once.
   *
   * `seedSource` gives the seed of the gate's first urge threshold on every promotion; it defaults to a random uint32.
   * Tests pass a fixed seed so no assertion depends on luck.
   */
  function initialize(syncedPinia: SyncedPiniaRuntime, options: { seedSource?: () => number } = {}) {
    if (!stopLeadershipListener)
      seedSource = options.seedSource ?? randomSeed
    stopUserInputListeners ??= startUserInputListeners()
    stopLeadershipListener ??= syncedPinia.onLeadershipChange(isLeader => isLeader ? startLeading() : stopLeading())
  }

  /** Stops the leadership subscription, the user input listeners, the sensors, and the ticker of this window. */
  function dispose() {
    stopLeadershipListener?.()
    stopLeadershipListener = undefined
    stopUserInputListeners?.()
    stopUserInputListeners = undefined
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
    sharesSource,
    advance,
    renderForRequest,
    markAddressed,
    holdTopic,
    onNotifySpoken,
    onExchangeEnd,
    userMidInput,
    untilUserIdle,
    observeChat,
    setStageVisible,
    setHostCapabilities,
    initialize,
    dispose,
  }
})
