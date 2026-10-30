import type { RitualDay, SavedGateMemory, Thread } from '@proj-airi/stage-shared/situation'

import type { SavedInnerState } from './inner-state'

import { THREAD_CUE_MAX_CHARS, THREAD_SUMMARY_MAX_CHARS, THREADS_MAX } from '@proj-airi/stage-shared/situation'
import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from 'vue'

import { defaultSavedInnerState, useSituationInnerState } from './inner-state'

const key = 'settings/situation-inner'
const pinias: Array<ReturnType<typeof createPinia>> = []
/** Local noon of 2026-10-29, inside logical day 2026-10-29. */
const noonMs = new Date(2026, 9, 29, 12, 0).getTime()

/** A fresh Pinia per call stands in for a reloaded or promoted window on the same localStorage. */
function createStore() {
  const pinia = createPinia()
  createApp({}).use(pinia)
  pinias.push(pinia)
  return useSituationInnerState(pinia)
}

function thread(index: number, overrides: Partial<Thread> = {}): Thread {
  return {
    id: `${String(index).padStart(4, '0')}0000-0000-4000-8000-000000000000`,
    topicKey: `thread:${String(index).padStart(4, '0')}0000-0000-4000-8000-000000000000`,
    sessionId: 'session-2026-10-29-01',
    kind: 'event',
    summary: 's'.repeat(THREAD_SUMMARY_MAX_CHARS),
    cue: 'c'.repeat(THREAD_CUE_MAX_CHARS),
    bornAtMs: noonMs - 3_600_000,
    dueAtMs: noonMs + 3_600_000,
    raisedCount: 1,
    lastRaisedAtMs: noonMs - 60_000,
    expiresAtMs: noonMs + 86_400_000,
    ...overrides,
  }
}

function ritualDay(dayKey: string): RitualDay {
  return {
    dayKey,
    firstPresentAtMs: noonMs - 7_200_000,
    lastAwayEndedAtMs: noonMs - 3_600_000,
    states: { 'greeting': 'done', 'sign-off': 'open', 'welcome-back': 'expired' },
    windowOpenedAtMs: { 'greeting': noonMs - 7_200_000, 'sign-off': noonMs - 60_000, 'welcome-back': noonMs - 3_600_000 },
  }
}

function gateMemory(): SavedGateMemory {
  return {
    lastFireAtMs: noonMs - 600_000,
    lastSpokenAtMs: noonMs - 590_000,
    unanswered: 2,
    awaitingSinceMs: noonMs - 590_000,
    damp: { depth: 0.75, sinceMs: noonMs - 1_800_000 },
    day: ritualDay('2026-10-29'),
    lastOwnDayAtMs: noonMs - 5_400_000,
    rngState: 0xFFFFFFFF,
  }
}

function stored(): SavedInnerState {
  return JSON.parse(localStorage.getItem(key)!)
}

describe('situation inner state', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    for (const pinia of pinias.splice(0))
      disposePinia(pinia)
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips threads, rituals, and the gate memory across store instances', () => {
    const leader = createStore()
    expect(leader.read(noonMs)).toEqual(defaultSavedInnerState())
    leader.claim(7)
    const saved = { threads: [thread(1)], rituals: ritualDay('2026-10-29'), gate: gateMemory() }
    expect(leader.write(saved, 7)).toBe(true)

    const reloaded = createStore()
    expect(reloaded.read(noonMs)).toEqual({ v: 1, ...saved, savedAtMs: stored().savedAtMs })
    expect(stored().savedAtMs).toBeGreaterThan(0)
  })

  it('keeps unpatched fields and accepts the next write after its own save', () => {
    const leader = createStore()
    leader.read(noonMs)
    leader.claim(1)
    expect(leader.write({ gate: gateMemory() }, 1)).toBe(true)
    expect(leader.write({ threads: [thread(1)] }, 1)).toBe(true)
    expect(stored()).toMatchObject({ gate: gateMemory(), threads: [thread(1)], rituals: null })
  })

  it('resets an invalid stored field to its default and keeps valid siblings, with one warning', () => {
    localStorage.setItem(key, JSON.stringify({ v: 1, threads: [{ ...thread(1), kind: 'gossip' }], gate: gateMemory(), savedAtMs: 5, extra: true }))
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const state = createStore().read(noonMs)

    expect(state).toEqual({ ...defaultSavedInnerState(), gate: gateMemory(), savedAtMs: 5 })
    expect(warning).toHaveBeenCalledExactlyOnceWith('[situation-inner] Invalid stored fields reset to defaults:', 'threads')
  })

  it.each(['{corrupt', '[]', 'null', '"banana"'])('replaces a stored document that is not an object (%s) with defaults', (value) => {
    localStorage.setItem(key, value)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(createStore().read(noonMs)).toEqual(defaultSavedInnerState())
    expect(warning).toHaveBeenCalledOnce()
  })

  it('ignores writes without the current leadership token', () => {
    const store = createStore()
    store.read(noonMs)
    expect(store.write({ gate: gateMemory() }, 1)).toBe(false)
    store.claim(2)
    expect(store.write({ gate: gateMemory() }, 1)).toBe(false)
    expect(localStorage.getItem(key)).toBeNull()
    expect(store.write({ gate: gateMemory() }, 2)).toBe(true)
  })

  it('ignores a write over a save from another window that it has not read, with a warning', () => {
    const store = createStore()
    store.claim(1)
    store.read(noonMs)
    // Another window on the same origin saves after this read.
    const newer = JSON.stringify({ ...defaultSavedInnerState(), threads: [thread(2)], savedAtMs: 42 })
    localStorage.setItem(key, newer)
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(store.write({ threads: [] }, 1)).toBe(false)
    expect(localStorage.getItem(key)).toBe(newer)
    expect(warning).toHaveBeenCalledExactlyOnceWith('[situation-inner] Ignored a write over a newer save:', 42)

    expect(store.read(noonMs).threads).toEqual([thread(2)])
    expect(store.write({ threads: [] }, 1)).toBe(true)
  })

  it('refuses to overwrite an existing save before the first read', () => {
    localStorage.setItem(key, JSON.stringify({ ...defaultSavedInnerState(), savedAtMs: 42 }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const store = createStore()
    store.claim(1)
    expect(store.write({ threads: [] }, 1)).toBe(false)
  })

  it('drops expired threads and a ritual day of another logical day on read', () => {
    const live = thread(1, { expiresAtMs: noonMs + 1 })
    localStorage.setItem(key, JSON.stringify({ ...defaultSavedInnerState(), threads: [thread(2, { expiresAtMs: noonMs }), live], rituals: ritualDay('2026-10-28'), gate: gateMemory(), savedAtMs: 5 }))
    const store = createStore()

    expect(store.read(noonMs)).toEqual({ ...defaultSavedInnerState(), threads: [live], gate: gateMemory(), savedAtMs: 5 })
    // Under the 04:00 rollover, 02:00 on the 30th still belongs to logical day 2026-10-29 and 04:00 starts the next.
    localStorage.setItem(key, JSON.stringify({ ...defaultSavedInnerState(), rituals: ritualDay('2026-10-29'), savedAtMs: 6 }))
    const reloaded = createStore()
    expect(reloaded.read(new Date(2026, 9, 30, 2, 0).getTime()).rituals).toEqual(ritualDay('2026-10-29'))
    expect(reloaded.read(new Date(2026, 9, 30, 4, 0).getTime()).rituals).toBeNull()
  })

  it('serializes a maximum document under 32 KB', () => {
    const store = createStore()
    store.read(noonMs)
    store.claim(1)
    const threads = Array.from({ length: THREADS_MAX }, (_, index) => thread(index))
    expect(store.write({ threads, rituals: ritualDay('2026-10-29'), gate: gateMemory() }, 1)).toBe(true)

    const saved = stored()
    expect(saved.threads).toHaveLength(THREADS_MAX)
    expect(saved.threads[0].id).toHaveLength(36)
    expect(saved.threads[0].sessionId).toHaveLength(21)
    expect(new Blob([JSON.stringify(saved)]).size).toBeLessThan(32 * 1024)
  })

  it('clears the stored state on reset', () => {
    const store = createStore()
    store.read(noonMs)
    store.claim(1)
    store.write({ gate: gateMemory() }, 1)
    store.reset()
    expect(createStore().read(noonMs)).toEqual(defaultSavedInnerState())
    expect(store.write({ gate: gateMemory() }, 1)).toBe(true)
  })
})
