import type { SyncedPiniaRuntime } from 'pinia-plugin-synced'

import { DEFAULT_CHARACTER_PROFILE } from '@proj-airi/stage-shared/character-state'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { characterStateRepo } from '../../database/repos/character-state.repo'
import { useCharacterStateStore } from '../character-state'
import { useCharacterStateObservabilityStore } from './character-state-observability'

vi.mock('../../database/repos/character-state.repo')

// The character state store reads only the active card id and the cards' profiles from the card store, whose real
// setup needs an i18n application context.
vi.mock('../modules/airi-card', async () => {
  const { defineStore } = await import('pinia')
  return {
    useAiriCardStore: defineStore('airi-card', {
      state: () => ({ activeCardId: 'default', cards: new Map<string, unknown>() }),
    }),
  }
})

// 8 pm local time: a one-day jump crosses the 04:00 rollover exactly once.
const T0 = new Date(2026, 9, 20, 20, 0, 0).getTime()
const HOUR_MS = 60 * 60_000
const DAY_MS = 24 * HOUR_MS

/** A synced runtime that reports the given role on subscribe, like the plugin. */
function leadership(isLeader: boolean): SyncedPiniaRuntime {
  return {
    dispose: vi.fn(),
    getLeaderId: vi.fn(),
    getParticipantCount: vi.fn(() => 1),
    isLeader: () => isLeader,
    onCoordinationChange: vi.fn(() => vi.fn()),
    onLeadershipChange: vi.fn((listener: (isLeader: boolean) => void) => {
      listener(isLeader)
      return () => {}
    }),
    participantId: 'character-state-observability-test',
    plugin: vi.fn(),
  }
}

const disposers: Array<() => void> = []

/** A leader (or follower) window: the character state store plus the observability store that serves it. */
async function window(isLeader: boolean) {
  setActivePinia(createPinia())
  const characterState = useCharacterStateStore()
  const observability = useCharacterStateObservabilityStore()
  characterState.initialize(leadership(isLeader))
  // The situation store calls this beside its leadership publish.
  observability.setLeading(isLeader)
  disposers.push(() => {
    observability.setLeading(false)
    characterState.dispose()
  })
  await characterState.ready()
  return { characterState, observability }
}

describe('character state observability store', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ now: T0 })
    await characterStateRepo.clear()
  })

  afterEach(() => {
    for (const dispose of disposers.splice(0))
      dispose()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('reads the leader at its clock, with the live contributions and the rendered text', async () => {
    const { observability } = await window(true)
    const atMs = Date.now()
    const applied = await observability.applyLeader({ kind: 'significant-positive', id: 'moment-1', atMs: 0, reason: 'shared a good moment' })
    expect(applied.status).toBe('applied')

    const inspection = await observability.inspectLeader()
    expect(inspection.leading).toBe(true)
    expect(inspection.cardId).toBe('default')
    expect(inspection.nowMs).toBe(atMs)
    expect(inspection.clockOffsetMs).toBe(0)
    // The devtools event is stamped at the leader's clock, not the caller's `atMs`.
    expect(inspection.contributions).toEqual([expect.objectContaining({ id: 'moment-1', source: 'significant', atMs, remaining: 1 })])
    expect(inspection.raw.valence).toBeCloseTo(0.25)
    expect(inspection.reading?.buckets.valence).toBe('good')
    expect(inspection.renderedText).toContain('Feeling: good')
    expect(inspection.renderedText).toContain('shared a good moment earlier today')
    expect(inspection.renderedText).not.toMatch(/\d/)
    expect(inspection.temperament?.axes).toEqual(DEFAULT_CHARACTER_PROFILE.resting)
    expect(inspection.history).toEqual([])
  })

  it('advances temperament and appends a history row on a one-day jump through the invoke handler', async () => {
    const { characterState, observability } = await window(true)
    await observability.applyLeader({ kind: 'significant-positive', id: 'moment-1', atMs: 0, reason: 'shared a good moment' })
    const before = await observability.inspectLeader()

    const jumped = await observability.jumpLeader(DAY_MS)

    expect(jumped.clockOffsetMs).toBe(DAY_MS)
    expect(characterState.clockOffsetMs).toBe(DAY_MS)
    const after = jumped.inspection
    expect(after.nowMs).toBe(T0 + DAY_MS)
    expect(after.clockOffsetMs).toBe(DAY_MS)
    // The mood sat above rest all day, so temperament followed it upward.
    expect(after.temperament!.axes.valence).toBeGreaterThan(before.temperament!.axes.valence)
    expect(after.temperament!.throughHourMs).toBeGreaterThan(before.temperament!.throughHourMs)
    // One 04:00 rollover passed, so the completed logical day was summarized.
    expect(after.history).toHaveLength(1)
    expect(after.history[0]?.dayKey).toBe('2026-10-20')
    // The contribution decayed over 24 h of a 9 h half-life, but is still live.
    const contribution = after.contributions.find(entry => entry.id === 'moment-1')
    expect(contribution?.remaining).toBeCloseTo(2 ** (-24 / 9), 6)
    // The leader's own inspection agrees with the jump answer.
    expect(await observability.inspectLeader()).toEqual(after)
    // A second jump accumulates.
    expect((await observability.jumpLeader(HOUR_MS)).clockOffsetMs).toBe(DAY_MS + HOUR_MS)
  })

  it('rejects a malformed event without changing the state, and reports an ignored replay', async () => {
    const { observability } = await window(true)
    const before = await observability.inspectLeader()

    const invalid = await observability.applyLeader({ kind: 'significant-positive', id: 'moment-1' })
    expect(invalid.status).toBe('invalid')
    expect(invalid.status === 'invalid' && invalid.error).toMatch(/atMs|reason/)
    const unknownKind = await observability.applyLeader({ kind: 'nope', id: 'x', atMs: 0 })
    expect(unknownKind.status).toBe('invalid')
    expect(await observability.inspectLeader()).toEqual(before)

    expect((await observability.applyLeader({ kind: 'touch-pleasant', id: 'touch-1', atMs: 0 })).status).toBe('applied')
    expect((await observability.applyLeader({ kind: 'touch-pleasant', id: 'touch-1', atMs: 0 })).status).toBe('ignored')
  })

  it('resets the active card to a fresh state and drops the jump history', async () => {
    const { observability } = await window(true)
    await observability.applyLeader({ kind: 'significant-positive', id: 'moment-1', atMs: 0, reason: 'shared a good moment' })
    await observability.jumpLeader(DAY_MS)
    expect((await observability.inspectLeader()).history).toHaveLength(1)

    const fresh = await observability.resetLeader()

    expect(fresh.contributions).toEqual([])
    expect(fresh.history).toEqual([])
    expect(fresh.renderedText).toBe('')
    expect(fresh.temperament?.axes).toEqual(DEFAULT_CHARACTER_PROFILE.resting)
    // The clock jump is leader memory, not card state, so it survives a reset.
    expect(fresh.clockOffsetMs).toBe(DAY_MS)
  })

  it('does not serve from a follower window', async () => {
    const { observability } = await window(false)
    const inspection = observability.inspect()
    expect(inspection.leading).toBe(false)
    expect(inspection.cardId).toBeNull()
    expect(inspection.reading).toBeNull()
    expect(inspection.renderedText).toBe('')
    expect(inspection.contributions).toEqual([])
  })
})
