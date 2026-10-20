import type { Observation, SituationState } from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import type { ConversationHookSource } from './sensors/conversation'

import {
  advanceSituation,
  initialSituationState,
  markShown,
  markAddressed as markSituationAddressed,
  reduceSituation,
  renderSituation,
} from '@proj-airi/stage-shared/situation'
import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'

import { useSituationObservabilityStore } from '../devtools/situation-observability'
import { startConversationSensor } from './sensors/conversation'
import { startDesktopSensor } from './sensors/desktop'
import { startForegroundSensor } from './sensors/foreground'
import { startStageSensor } from './sensors/stage'

/**
 * How often the leader derives the time-based events (settled app switches, long-session tiers, expiry) and
 * re-checks desktop and foreground sample freshness.
 */
const ADVANCE_INTERVAL_MS = 1_000

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
 * on the hooks that the chat store hands over through {@link observeChat}.
 */
export const useSituationStore = defineStore('situation', () => {
  const current = shallowRef<SituationState>(initialSituationState)
  const leading = shallowRef(false)
  const stageVisible = shallowRef(false)
  let ticker: ReturnType<typeof setInterval> | undefined
  let sensors: RunningSensors | undefined
  let chatHooks: ConversationHookSource | undefined
  let stopConversation: (() => void) | undefined
  let stopLeadershipListener: (() => void) | undefined
  const observability = useSituationObservabilityStore()

  // Feeds the devtools Situation inspector of this window. Sync flush keeps it equal to the state after every call.
  watch([leading, current], ([isLeading, state]) => observability.publishLiveState(isLeading, state), { flush: 'sync', immediate: true })

  function advance(nowMs: number) {
    if (!leading.value)
      return
    current.value = advanceSituation(current.value, nowMs)
  }

  function startSensors(): RunningSensors {
    const desktop = startDesktopSensor(ingest)
    const foreground = startForegroundSensor(ingest, { stageVisible: () => stageVisible.value })
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
    if (leading.value && chatHooks && !stopConversation)
      stopConversation = startConversationSensor(chatHooks, ingest)
  }

  function startLeading() {
    if (leading.value)
      return
    current.value = initialSituationState
    leading.value = true
    // Sensors report their current readings at once, so they start after `leading` lets `ingest` through.
    sensors = startSensors()
    startConversation()
    ticker = setInterval(() => {
      const nowMs = Date.now()
      sensors?.check(nowMs)
      advance(nowMs)
    }, ADVANCE_INTERVAL_MS)
  }

  function stopLeading() {
    // Sensors stop first, so nothing is folded into the state that is dropped below.
    sensors?.stop()
    sensors = undefined
    stopConversation?.()
    stopConversation = undefined
    if (ticker !== undefined)
      clearInterval(ticker)
    ticker = undefined
    leading.value = false
    current.value = initialSituationState
  }

  /** Folds one observation into the situation. Followers and uninitialized windows ignore it. */
  function ingest(observation: Observation) {
    if (!leading.value)
      return
    current.value = reduceSituation(current.value, observation, Date.now(), { selfAppIds: sensors?.selfAppIds() ?? [] })
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
   * Receives the chat runtime hooks of this window. The chat store calls it once from its setup; the first source
   * wins. While this window leads, the conversation sensor records user and character turns from these hooks.
   */
  function observeChat(hooks: ConversationHookSource) {
    chatHooks ??= hooks
    startConversation()
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
   * Binds the store to synchronized leadership. Repeated calls keep the first subscription. The listener runs
   * immediately with the current role, so an initial leader starts at once.
   */
  function initialize(syncedPinia: SyncedPiniaRuntime) {
    stopLeadershipListener ??= syncedPinia.onLeadershipChange(isLeader => isLeader ? startLeading() : stopLeading())
  }

  /** Stops the leadership subscription, the sensors, and the ticker of this window. */
  function dispose() {
    stopLeadershipListener?.()
    stopLeadershipListener = undefined
    stopLeading()
  }

  return {
    // Read-only projections. Pinia state stays empty, so no plugin can sync or persist the situation.
    state: computed(() => current.value),
    leading: computed(() => leading.value),
    stageVisible: computed(() => stageVisible.value),
    ingest,
    advance,
    renderForRequest,
    markAddressed,
    observeChat,
    setStageVisible,
    initialize,
    dispose,
  }
})
