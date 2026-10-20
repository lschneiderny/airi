import type { Observation, SituationState } from '@proj-airi/stage-shared/situation'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import {
  advanceSituation,
  initialSituationState,
  markShown,
  markAddressed as markSituationAddressed,
  reduceSituation,
  renderSituation,
} from '@proj-airi/stage-shared/situation'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

/** How often the leader derives the time-based events: settled app switches, long-session tiers, and expiry. */
const ADVANCE_INTERVAL_MS = 1_000

/**
 * Owns the character's view of the user's situation in the leader window.
 *
 * The store is intentionally neither synced nor persisted: the leader is the only window that sends chat
 * requests, so it alone folds observations and renders the block. Followers keep the initial state and ignore
 * every call. Leadership comes from {@link initialize}: a promoted window starts from `initialSituationState`
 * with a fresh 1 s advance ticker, and a demoted or disposed window stops the ticker and drops its state.
 */
export const useSituationStore = defineStore('situation', () => {
  const current = shallowRef<SituationState>(initialSituationState)
  const leading = shallowRef(false)
  let ticker: ReturnType<typeof setInterval> | undefined
  let stopLeadershipListener: (() => void) | undefined

  function advance(nowMs: number) {
    if (!leading.value)
      return
    current.value = advanceSituation(current.value, nowMs)
  }

  function startLeading() {
    if (leading.value)
      return
    current.value = initialSituationState
    leading.value = true
    ticker = setInterval(() => advance(Date.now()), ADVANCE_INTERVAL_MS)
  }

  function stopLeading() {
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
    current.value = reduceSituation(current.value, observation, Date.now())
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
   * Binds the store to synchronized leadership. Repeated calls keep the first subscription. The listener runs
   * immediately with the current role, so an initial leader starts at once.
   */
  function initialize(syncedPinia: SyncedPiniaRuntime) {
    stopLeadershipListener ??= syncedPinia.onLeadershipChange(isLeader => isLeader ? startLeading() : stopLeading())
  }

  /** Stops the leadership subscription and the ticker of this window. */
  function dispose() {
    stopLeadershipListener?.()
    stopLeadershipListener = undefined
    stopLeading()
  }

  return {
    // Read-only projections. Pinia state stays empty, so no plugin can sync or persist the situation.
    state: computed(() => current.value),
    leading: computed(() => leading.value),
    ingest,
    advance,
    renderForRequest,
    markAddressed,
    initialize,
    dispose,
  }
})
