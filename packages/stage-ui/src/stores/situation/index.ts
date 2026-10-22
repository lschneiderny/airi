import type { ChatHookRegistry, TurnRef } from '@proj-airi/core-agent'
import type { AppCategory, GateDecision, GateMemory, GateSignals, Observation, SituationState } from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { ChatUnpromptedPayload, ChatUnpromptedResult } from '../chat'
import type { SituationGateEvaluation } from '../devtools/situation-observability'
import type { ConversationHookSource } from './sensors/conversation'

import { errorMessageFrom } from '@moeru/std'
import {
  advanceSituation,
  evaluateGate,
  forgetForeground,
  forgetSource,
  initialGateMemory,
  initialSituationState,
  isSourceInNamespace,
  isTopicFromSource,
  markShown,
  markAddressed as markSituationAddressed,
  notifyTopicKey,
  promotionGateMemory,
  recordFireOutcome,
  recordUserTurn,
  reduceSituation,
  renderSituation,
  visibilityRegainGateMemory,
} from '@proj-airi/stage-shared/situation'
import { useDesktopActivityStore } from '@proj-airi/stage-shared/stores/desktop-activity'
import { useForegroundWindowStore } from '@proj-airi/stage-shared/stores/foreground-window'
import { nanoid } from 'nanoid'
import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'

import { useSituationSettings } from '../../features/situation/settings'
import { chatComposerActivityChangedEvent, getSpeechBusContext, situationNotifyObservedEvent, speechInputUserSpeakingChangedEvent, voiceRequestTurns, voiceSnapshotChanged, voiceTurnsChanged } from '../../services/speech/bus'
import { useSituationObservabilityStore } from '../devtools/situation-observability'
import { startConversationSensor } from './sensors/conversation'
import { DESKTOP_SAMPLE_STALE_MS, startDesktopSensor } from './sensors/desktop'
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

/** The parts of the leader's chat store the gate needs. The chat store hands them over through `observeChat`. */
export interface SituationChatControls {
  /** Raw `sending`: any turn generates, unprompted turns included. */
  sending: () => boolean
  pendingQueuedSendCount: () => number
  /** Whether an unprompted turn was submitted and its result is not read yet. */
  unpromptedPending: () => boolean
  submitUnprompted: (payload: ChatUnpromptedPayload) => Promise<ChatUnpromptedResult>
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
 * on the hooks that the chat store hands over through {@link observeChat}. Only the user input listeners run in
 * every initialized window, so {@link untilUserIdle} answers wherever a widget reaction is served.
 *
 * In a host that declared the `unprompted` capability ({@link setHostCapabilities}), the leader also runs the
 * opportunity gate every {@link GATE_INTERVAL_MS}. A fire addresses its topic, then starts one unprompted turn through
 * the chat controls, and the gate starts no other turn until that one has a result.
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
  let stopNotifyListener: (() => void) | undefined
  let stopLeadershipListener: (() => void) | undefined
  const observability = useSituationObservabilityStore()
  const settings = useSituationSettings()
  const desktopActivity = useDesktopActivityStore()
  const foregroundWindow = useForegroundWindowStore()

  const hostSupportsUnprompted = shallowRef(false)
  let gateTicker: ReturnType<typeof setInterval> | undefined
  let gateMemory: GateMemory = initialGateMemory
  let stopGateEvaluation: (() => void) | undefined
  /** Whether the stage was on screen with a fresh desktop sample at the previous gate tick. */
  let wasStageShown = false
  /** The unprompted turn the gate started, from the fire until its result is recorded. */
  let firing: { turnId: string, spoken: boolean } | undefined
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
      if (observation.kind === 'conversation' && observation.who === 'user' && observation.origin === 'user')
        setGateMemory(recordUserTurn(gateMemory, observation.atMs))
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
      // Recording a gate fire as spoken now, not when the reply ends, lets a user reply mid-reply count as engagement.
      if (firing && !firing.spoken && context.turnId === firing.turnId) {
        firing.spoken = true
        setGateMemory(recordFireOutcome(gateMemory, 'spoken', Date.now()))
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
   */
  function startUserInputListeners() {
    const context = getSpeechBusContext()
    const recheckWaiters = () => {
      for (const recheck of [...userInputWaiters])
        recheck()
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
        recheckWaiters()
      }),
      context.on(chatComposerActivityChangedEvent, ({ body }) => {
        if (!body)
          return
        composers.set(body.sourceId, { hasDraft: body.hasDraft, lastInputAtMs: body.lastInputAtMs, receivedAtMs: Date.now() })
        recheckWaiters()
      }),
    ]
    return () => {
      for (const stop of stops)
        stop()
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

  /** Changes the gate memory and shows the change in the devtools Situation inspector at once. */
  function setGateMemory(memory: GateMemory) {
    gateMemory = memory
    observability.publishGateMemory(memory)
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
    // A stage that comes back on screen waits a full gap, like a new leader, instead of speaking at once.
    const stageShown = signals.stageVisible && signals.desktopFresh
    if (stageShown && !wasStageShown)
      setGateMemory(visibilityRegainGateMemory(gateMemory, nowMs))
    wasStageShown = stageShown

    const document = settings.document
    const before = gateMemory
    const { decision, memory } = evaluateGate({
      nowMs,
      situation: heldTopics.size > 0
        ? { ...current.value, events: current.value.events.filter(event => !heldTopics.has(event.topicKey)) }
        : current.value,
      signals,
      settings: {
        enabled: document.unpromptedEnabled,
        chattiness: document.chattiness,
        dontDisturb: document.dontDisturb,
        // Settings list executable names (`zoom.exe`); the gate matches app ids, which drop the `.exe` extension.
        quietApps: document.quietApps.map(pattern => pattern.trim().replace(/\.exe$/i, '')),
        speakDuringGames: document.speakDuringGames,
      },
      forceTiming,
    }, gateMemory)
    // Recording the decision publishes this memory to the inspector too.
    gateMemory = memory
    observability.recordGateDecision(decision, memory)
    if (decision.fire)
      void fire(controls, decision, before)
    return { status: 'evaluated', decision, memory }
  }

  /** Starts the unprompted turn of a fire and records its outcome. The topic is addressed before the turn starts. */
  async function fire(controls: SituationChatControls, decision: Extract<GateDecision, { fire: true }>, before: GateMemory) {
    const turn = { turnId: nanoid(), spoken: false }
    const startedIn = leadership
    const aboutNotify = current.value.events.some(event => event.topicKey === decision.topicKey && event.kind === 'notify')
    firing = turn
    markAddressed(decision.topicKey)
    let result: ChatUnpromptedResult
    try {
      result = await controls.submitUnprompted({ topicKey: decision.topicKey, topicText: unpromptedTopicText(decision.topicKey, decision.topicText, aboutNotify), messageId: turn.turnId })
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
      // Another caller's unprompted turn won the race. This fire never happened, so it takes no gap or cap slot.
      setGateMemory({ ...gateMemory, lastFireAtMs: before.lastFireAtMs, fires: gateMemory.fires.filter(atMs => atMs !== decision.trace.nowMs), pending: before.pending })
      return
    }
    if (!turn.spoken)
      setGateMemory(recordFireOutcome(gateMemory, result.status, Date.now()))
    const text = result.status === 'spoken' ? result.text.trim() : ''
    if (aboutNotify && text) {
      for (const listener of notifySpokenListeners)
        listener({ topicKey: decision.topicKey, text })
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

  /** Runs the gate loop only while this window leads in a host that supports unprompted turns. */
  function syncGateLoop() {
    const shouldRun = leading.value && hostSupportsUnprompted.value
    if (shouldRun && gateTicker === undefined) {
      setGateMemory(promotionGateMemory(Date.now()))
      wasStageShown = false
      stopVoiceTurnListener = startVoiceTurnListener()
      gateTicker = setInterval(gateTick, GATE_INTERVAL_MS)
      stopGateEvaluation = observability.serveGateEvaluation(() => gateTick(true))
    }
    else if (!shouldRun && gateTicker !== undefined) {
      clearInterval(gateTicker)
      gateTicker = undefined
      stopGateEvaluation?.()
      stopGateEvaluation = undefined
      stopVoiceTurnListener?.()
      stopVoiceTurnListener = undefined
      setGateMemory(initialGateMemory)
    }
  }

  function startLeading() {
    if (leading.value)
      return
    current.value = initialSituationState
    leading.value = true
    leadership += 1
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
    if (leading.value)
      leadership += 1
    leading.value = false
    syncGateLoop()
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
   * subscription. The leadership listener runs immediately with the current role, so an initial leader starts at once.
   */
  function initialize(syncedPinia: SyncedPiniaRuntime) {
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
    userMidInput,
    untilUserIdle,
    observeChat,
    setStageVisible,
    setHostCapabilities,
    initialize,
    dispose,
  }
})
