import type { AdvanceContext, CharacterEvent, CharacterProfile, CharacterReading, CharacterStateRecordV1 } from '@proj-airi/stage-shared/character-state'
import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { errorMessageFrom } from '@moeru/std'
import { advance, applyEvent, DEFAULT_CHARACTER_PROFILE, initialCharacterState, migrateCharacterState, readCharacter } from '@proj-airi/stage-shared/character-state'
import { LOGICAL_DAY_ROLLOVER_HOUR } from '@proj-airi/stage-shared/situation'
import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'

import { characterStateRepo } from '../database/repos/character-state.repo'
import { localLogicalDayKey } from '../features/situation/inner-state'
import { onPageHide } from '../libs/page-hide'
import { useAiriCardStore } from './modules/airi-card'

/**
 * How often the leader brings the active card's state forward and reads it again. The reading's time words (how long
 * ago a reason happened, how far a mood decayed) move without any event, so they need this tick.
 */
export const CHARACTER_STATE_ADVANCE_INTERVAL_MS = 60_000

/** How long the leader waits after the last change before it saves the record. */
export const CHARACTER_STATE_SAVE_DEBOUNCE_MS = 2_000

/** What every window holds of the active card's state. Replicated, so plain data, and never an event. */
export interface CharacterStateSnapshot {
  /** The card the reading belongs to, or `null` before a leader loaded one. */
  readonly cardId: string | null
  readonly reading: CharacterReading | null
  /** Rises with every leader publish; a window ignores a snapshot below the one it holds. */
  readonly revision: number
  /** `updatedAtMs` of the record the reading came from. */
  readonly updatedAtMs: number
}

/** Which records {@link useCharacterStateStore} `forget` removes: one card's, or every card's. */
export type CharacterStateForgetTarget = string | 'everything'

const EMPTY_SNAPSHOT: CharacterStateSnapshot = { cardId: null, reading: null, revision: 0, updatedAtMs: 0 }

/** The start (04:00 rollover) of the logical day containing `ms`, in the host's local time zone. */
export function localLogicalDayStart(ms: number): number {
  const [year, month, day] = localLogicalDayKey(ms).split('-').map(Number)
  return new Date(year, month - 1, day, LOGICAL_DAY_ROLLOVER_HOUR).getTime()
}

/** The time inputs of the pure character-state calls at `nowMs`, with the situation store's 04:00 logical day. */
export function characterStateContext(nowMs: number): AdvanceContext {
  return { nowMs, logicalDayKeyOf: localLogicalDayKey, logicalDayStartOf: localLogicalDayStart }
}

/**
 * The profile of a card: its resting disposition and starting stage.
 *
 * Cards carry no character profile yet, so every card uses the default one. The card field
 * `extensions.airi.modules.character` replaces this when it lands; a card without it keeps the default.
 */
function profileFor(_cardId: string): CharacterProfile {
  return DEFAULT_CHARACTER_PROFILE
}

/**
 * The character's slow state (mood, temperament, relationship) of the active card.
 *
 * Persistence tier 4 (`docs/ai/adr/2026-11-01-persistence-tiers.md`): one IndexedDB record per card in
 * `airi-character-state`, owned by the leader window. On gaining leadership ({@link initialize}) the leader loads the
 * active card's record through `migrateCharacterState`, brings it forward with `advance`, and every
 * {@link CHARACTER_STATE_ADVANCE_INTERVAL_MS} reads it again. It saves {@link CHARACTER_STATE_SAVE_DEBOUNCE_MS} after
 * each change and when the page hides. An active-card switch saves the old record and loads the new one.
 *
 * Only {@link CharacterStateSnapshot} replicates: the reading, never the record or its events. Every mutating action is
 * leader-routed; its body returns at once outside the leader, so a follower never writes storage. A window ignores a
 * replicated snapshot whose revision is below the one it holds, so a late snapshot from a demoted leader cannot move
 * the reading back. Leader work runs one task at a time, and a task that started under an earlier leadership is dropped.
 *
 * Use when:
 * - Reading how she feels (`reading`) in any window, for the prompt, the face, or the reach-out gate.
 * - Applying an event, importing, exporting, or forgetting a card's state; await every action.
 */
export const useCharacterStateStore = defineStore('character-state', () => {
  /** The replicated state. Only the leader writes it, and only by replacing the whole value. */
  const replicated = shallowRef<CharacterStateSnapshot>(EMPTY_SNAPSHOT)
  /** The newest snapshot this window accepted; consumers read this one. */
  const accepted = shallowRef<CharacterStateSnapshot>(EMPTY_SNAPSHOT)
  const leading = shallowRef(false)
  /** The leader's record of the active card, advanced to its last tick or change; `null` outside the leader. */
  const record = shallowRef<CharacterStateRecordV1 | null>(null)
  /** The devtools clock jump, kept in the leader's memory only. */
  const clockOffsetMs = shallowRef(0)
  const cards = useAiriCardStore()

  let profile: CharacterProfile = DEFAULT_CHARACTER_PROFILE
  /** Advances on every promotion and demotion, so a task queued under an earlier leadership is dropped. */
  let leadership = 0
  let queue: Promise<unknown> = Promise.resolve()
  let dirty = false
  let saveTimer: ReturnType<typeof setTimeout> | undefined
  let ticker: ReturnType<typeof setInterval> | undefined
  let stopCardWatch: (() => void) | undefined
  let stopHide: (() => void) | undefined
  let stopLeadershipListener: (() => void) | undefined

  // Writes only this window's unreplicated copy, so a remote snapshot never produces a proposal.
  watch(replicated, (next) => {
    if (next.revision >= accepted.value.revision)
      accepted.value = next
  }, { flush: 'sync' })

  function now() {
    return Date.now() + clockOffsetMs.value
  }

  /**
   * Runs `run` after the leader work queued before it. Outside the leader it resolves to `undefined` without running,
   * so a follower or an uninitialized window never writes storage. `run` checks `isCurrent` after each await.
   */
  function leaderTask<T>(run: (isCurrent: () => boolean) => Promise<T> | T): Promise<T | undefined> {
    if (!leading.value)
      return Promise.resolve(undefined)
    const epoch = leadership
    const isCurrent = () => epoch === leadership
    const task = queue.catch(() => {}).then(() => isCurrent() ? run(isCurrent) : undefined)
    queue = task
    return task
  }

  /** Replicates the reading of `current` at `nowMs`. `fresh` starts the reading without the previous one. */
  function publish(current: CharacterStateRecordV1, nowMs: number, fresh = false) {
    const held = accepted.value
    const previous = !fresh && held.cardId === current.cardId ? held.reading : null
    replicated.value = {
      cardId: current.cardId,
      reading: readCharacter(current, profile, previous, characterStateContext(nowMs)),
      // The wall clock keeps revisions rising across leader reloads, even when a new leader did not receive the last
      // committed snapshot; the increment keeps them rising within one millisecond.
      revision: Math.max(held.revision + 1, Date.now()),
      updatedAtMs: current.updatedAtMs,
    }
  }

  /** Brings the record forward to now and replicates its reading. */
  function refresh() {
    const current = record.value
    if (!current)
      return
    const nowMs = now()
    record.value = advance(current, profile, characterStateContext(nowMs))
    publish(record.value, nowMs)
  }

  /** Saves the record now when it changed since the last save. A failed save stays due for the next one. */
  function flushSave(): Promise<void> {
    clearTimeout(saveTimer)
    saveTimer = undefined
    const current = record.value
    if (!dirty || !current)
      return Promise.resolve()
    dirty = false
    return characterStateRepo.save(current).catch((error) => {
      dirty = true
      console.warn('[character-state] Failed to save the record:', errorMessageFrom(error) ?? 'unknown error')
    })
  }

  function scheduleSave() {
    dirty = true
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => void flushSave(), CHARACTER_STATE_SAVE_DEBOUNCE_MS)
  }

  /** Drops a pending save, for a record that is about to be removed or replaced in storage. */
  function cancelSave() {
    clearTimeout(saveTimer)
    saveTimer = undefined
    dirty = false
  }

  /** Loads the record of `cardId` as the active one, saving the previous card's record first. */
  function activate(cardId: string) {
    return leaderTask(async (isCurrent) => {
      if (record.value?.cardId === cardId)
        return
      await flushSave()
      const stored = await characterStateRepo.load(cardId)
      if (!isCurrent())
        return
      const nowMs = now()
      const context = characterStateContext(nowMs)
      profile = profileFor(cardId)
      const loaded = stored === null
        ? initialCharacterState(cardId, profile, context)
        : migrateCharacterState(stored, cardId, profile, context)
      record.value = advance(loaded, profile, context)
      // A fresh record needs no save until something happens to it, so deleting all data leaves storage empty.
      if (stored !== null)
        scheduleSave()
      publish(record.value, nowMs)
    })
  }

  function applyNow(event: CharacterEvent) {
    return leaderTask(() => {
      const current = record.value
      if (!current)
        return false
      const nowMs = now()
      const context = characterStateContext(nowMs)
      const next = applyEvent(current, event, profile, context)
      // A rejected, replayed, or out-of-order event returns the same object.
      if (next === current)
        return false
      record.value = advance(next, profile, context)
      scheduleSave()
      publish(record.value, nowMs)
      return true
    }).then(applied => applied ?? false)
  }

  function forgetNow(target: CharacterStateForgetTarget) {
    return leaderTask(async (isCurrent) => {
      const current = record.value
      const hitsActive = current !== null && (target === 'everything' || target === current.cardId)
      if (hitsActive)
        cancelSave()
      if (target === 'everything')
        await characterStateRepo.clear()
      else
        await characterStateRepo.remove(target)
      if (!isCurrent() || !hitsActive || !current)
        return
      const nowMs = now()
      record.value = initialCharacterState(current.cardId, profile, characterStateContext(nowMs))
      publish(record.value, nowMs, true)
    })
  }

  /** Applies one event to the active card. Resolves to whether it changed the state. Leader-routed. */
  async function apply(event: CharacterEvent): Promise<boolean> {
    return applyNow(event)
  }

  /**
   * Removes the stored state of one card, or of every card. A forgotten active card starts again from its profile and
   * is not saved until something happens to it. Leader-routed.
   */
  async function forget(target: CharacterStateForgetTarget): Promise<void> {
    await forgetNow(target)
  }

  /** Forgets every card's state for Delete all data. Leader-routed. */
  async function resetState(): Promise<void> {
    await forgetNow('everything')
  }

  /**
   * Stores the state of an imported card: `value` passes through `migrateCharacterState`, and `null` stores a fresh
   * state from the card's profile. An active card's state is replaced at once. Leader-routed.
   */
  async function importRecord(cardId: string, value: CharacterStateRecordV1 | null): Promise<void> {
    await leaderTask(async (isCurrent) => {
      const nowMs = now()
      const context = characterStateContext(nowMs)
      const cardProfile = profileFor(cardId)
      const imported = value === null
        ? initialCharacterState(cardId, cardProfile, context)
        : migrateCharacterState(value, cardId, cardProfile, context)
      const active = record.value?.cardId === cardId
      if (active)
        cancelSave()
      await characterStateRepo.save(imported)
      if (!isCurrent() || !active)
        return
      profile = cardProfile
      record.value = advance(imported, profile, context)
      publish(record.value, nowMs, true)
    })
  }

  /**
   * The current record of a card, for card export: the active card's live record, or the stored one through
   * `migrateCharacterState`. `null` when the card has none, or outside a leader. Leader-routed.
   */
  async function exportRecord(cardId: string): Promise<CharacterStateRecordV1 | null> {
    const exported = await leaderTask(async () => {
      if (record.value?.cardId === cardId) {
        refresh()
        return record.value
      }
      const stored = await characterStateRepo.load(cardId)
      return stored === null ? null : migrateCharacterState(stored, cardId, profileFor(cardId), characterStateContext(now()))
    })
    return exported ?? null
  }

  /**
   * Moves the leader's clock forward by `ms` for devtools and brings the state to the new time. The offset lives in
   * the leader's memory only and resets with leadership. Resolves to the total offset. Leader-routed.
   */
  async function devtoolsJump(ms: number): Promise<number> {
    const offset = await leaderTask(() => {
      if (Number.isFinite(ms) && ms > 0) {
        clockOffsetMs.value += ms
        refresh()
        scheduleSave()
      }
      return clockOffsetMs.value
    })
    return offset ?? 0
  }

  /** Applies a devtools test event at the leader's clock, jump included. Leader-routed. */
  async function devtoolsApply(event: CharacterEvent): Promise<boolean> {
    return applyNow({ ...event, atMs: now() })
  }

  /** Resolves after the leader work queued before the call, for example the first load after gaining leadership. */
  function ready(): Promise<void> {
    return queue.then(() => {}, () => {})
  }

  function startLeading() {
    if (leading.value)
      return
    leading.value = true
    leadership += 1
    stopCardWatch = watch(() => cards.activeCardId, (cardId) => {
      void activate(cardId)
    }, { immediate: true })
    ticker = setInterval(refresh, CHARACTER_STATE_ADVANCE_INTERVAL_MS)
    if (typeof document !== 'undefined') {
      const onVisibility = () => {
        if (document.visibilityState === 'hidden')
          void flushSave()
      }
      document.addEventListener('visibilitychange', onVisibility)
      // Saves before the synced runtime closes, like the other leader hosts.
      const stopPageHide = onPageHide('release-host', () => void flushSave())
      stopHide = () => {
        document.removeEventListener('visibilitychange', onVisibility)
        stopPageHide()
      }
    }
  }

  function stopLeading() {
    if (!leading.value)
      return
    // The final save is queued on the storage lock before a successor's load, so the successor reads it. `ready`
    // waits for it too.
    const saving = flushSave()
    queue = queue.then(() => saving, () => saving)
    clearInterval(ticker)
    ticker = undefined
    stopCardWatch?.()
    stopCardWatch = undefined
    stopHide?.()
    stopHide = undefined
    leading.value = false
    leadership += 1
    record.value = null
    profile = DEFAULT_CHARACTER_PROFILE
    clockOffsetMs.value = 0
  }

  /**
   * Binds the store to synchronized leadership. Repeated calls keep the first subscription. The listener runs at once
   * with the current role, so an initial leader starts loading at once.
   */
  function initialize(syncedPinia: SyncedPiniaRuntime) {
    stopLeadershipListener ??= syncedPinia.onLeadershipChange(isLeader => isLeader ? startLeading() : stopLeading())
  }

  /** Stops the leadership subscription; a leader saves and stops its ticker. */
  function dispose() {
    stopLeadershipListener?.()
    stopLeadershipListener = undefined
    stopLeading()
  }

  return {
    replicated,
    cardId: computed(() => accepted.value.cardId),
    reading: computed(() => accepted.value.reading),
    revision: computed(() => accepted.value.revision),
    updatedAtMs: computed(() => accepted.value.updatedAtMs),
    leading: computed(() => leading.value),
    /** The leader's live record of the active card for devtools; `null` in other windows. */
    leaderRecord: computed(() => record.value),
    clockOffsetMs: computed(() => clockOffsetMs.value),
    apply,
    forget,
    resetState,
    importRecord,
    exportRecord,
    devtoolsJump,
    devtoolsApply,
    ready,
    initialize,
    dispose,
  }
}, {
  synced: {
    state: true,
    actions: ['apply', 'forget', 'resetState', 'importRecord', 'exportRecord', 'devtoolsJump', 'devtoolsApply'],
  },
})
