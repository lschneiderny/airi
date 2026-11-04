import type { AdvanceContext, CharacterEvent, CharacterStateRecordV1 } from '.'

import { describe, expect, it } from 'vitest'

import { advance, applyEvent, DEFAULT_CHARACTER_PROFILE, initialCharacterState, migrateCharacterState } from '.'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const ROLLOVER_MS = 4 * HOUR_MS
const START_MS = Date.UTC(2026, 10, 3, 4)
const PROFILE = DEFAULT_CHARACTER_PROFILE

function logicalDayKeyOf(ms: number): string {
  return new Date(ms - ROLLOVER_MS).toISOString().slice(0, 10)
}

function logicalDayStartOf(ms: number): number {
  return Math.floor((ms - ROLLOVER_MS) / DAY_MS) * DAY_MS + ROLLOVER_MS
}

function ctx(nowMs: number): AdvanceContext {
  return { nowMs, logicalDayKeyOf, logicalDayStartOf }
}

/** A lived-in state: contributions, cue log, relationship progress, a wound, and history rows. */
function livedIn(): CharacterStateRecordV1 {
  const events: CharacterEvent[] = [
    { kind: 'user-turn', id: 'turn-1', atMs: START_MS + 2 * HOUR_MS, exchange: 'first-real' },
    { kind: 'touch-pleasant', id: 'touch-1', atMs: START_MS + 3 * HOUR_MS },
    { kind: 'model-cue', id: 'cue-1', atMs: START_MS + DAY_MS + HOUR_MS, turnId: 'turn-2', directions: { valence: 1, energy: 1, tension: 0 }, reason: 'he remembered' },
    { kind: 'milestone', id: 'x-1', atMs: START_MS + DAY_MS + 2 * HOUR_MS, reason: 'first movie night', memoryId: 'memory-1' },
    { kind: 'hurtful', id: 'x-2', atMs: START_MS + 2 * DAY_MS + HOUR_MS, reason: 'he mocked her' },
  ]
  const state = events.reduce((current, event) => applyEvent(current, event, PROFILE, ctx(event.atMs)), initialCharacterState('card-1', PROFILE, ctx(START_MS)))
  return advance(state, PROFILE, ctx(START_MS + 2 * DAY_MS + 90 * MINUTE_MS))
}

function migrate(value: unknown, nowMs = START_MS + 3 * DAY_MS): CharacterStateRecordV1 {
  return migrateCharacterState(value, 'card-1', PROFILE, ctx(nowMs))
}

describe('migrateCharacterState', () => {
  it('passes a stored record through its JSON round trip unchanged', () => {
    const state = livedIn()
    expect(state.history.length).toBeGreaterThan(0)
    expect(state.mood.contributions.length).toBeGreaterThan(0)
    expect(migrate(JSON.parse(JSON.stringify(state)))).toEqual(state)
  })

  it('resets only a corrupted relationship field and keeps the mood contributions', () => {
    const state = livedIn()
    const stored = JSON.parse(JSON.stringify(state))
    stored.relationship.levels.trust = 7
    const migrated = migrate(stored)
    expect(migrated.mood).toEqual(state.mood)
    expect(migrated.temperament).toEqual(state.temperament)
    expect(migrated.history).toEqual(state.history)
    expect(migrated.relationship).toEqual(initialCharacterState('card-1', PROFILE, ctx(START_MS + 3 * DAY_MS)).relationship)
  })

  it('returns a fresh initial state for garbage, an unknown version, and a future version', () => {
    const fresh = initialCharacterState('card-1', PROFILE, ctx(START_MS + 3 * DAY_MS))
    const state = livedIn()
    for (const value of [undefined, null, 'state', 42, [], {}, [state], { ...state, version: 2 }, { ...state, version: '1' }, { ...state, version: 0 }])
      expect(migrate(value)).toEqual(fresh)
  })

  it('stores the record under the requested card id and drops unknown fields', () => {
    const migrated = migrateCharacterState({ ...JSON.parse(JSON.stringify(livedIn())), extra: true }, 'card-2', PROFILE, ctx(START_MS + 3 * DAY_MS))
    expect(migrated.cardId).toBe('card-2')
    expect(migrated).not.toHaveProperty('extra')
  })

  it('floors a temperament cursor that is off the epoch hour', () => {
    const state = livedIn()
    const stored = { ...state, temperament: { ...state.temperament, throughHourMs: state.temperament.throughHourMs + 17 * MINUTE_MS } }
    expect(migrate(stored).temperament.throughHourMs).toBe(state.temperament.throughHourMs)
  })

  it('falls back per field for a missing field', () => {
    const state = livedIn()
    const { history: _history, ...withoutHistory } = state
    const migrated = migrate(withoutHistory)
    expect(migrated.history).toEqual([])
    expect(migrated.relationship).toEqual(state.relationship)
  })
})
