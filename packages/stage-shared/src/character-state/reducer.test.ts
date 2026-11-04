import type { AdvanceContext, CharacterEvent, CharacterProfile, CharacterStateRecordV1, CompletedTemperamentDay } from '.'

import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import {
  advance,
  advanceTemperament,
  applyEvent,
  CHARACTER_STATE_SETTINGS,
  CharacterStateRecordSchema,
  DEFAULT_CHARACTER_PROFILE,
  initialCharacterState,
  MAX_APPLIED_EVENT_IDS,
} from '.'
import { nextRandom, seedRng } from '../situation/rng'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const ROLLOVER_MS = 4 * HOUR_MS
// 04:00 UTC, a logical day start for the UTC rollover used here.
const START_MS = Date.UTC(2026, 10, 3, 4)
const PROFILE: CharacterProfile = DEFAULT_CHARACTER_PROFILE
const { dailyGain } = CHARACTER_STATE_SETTINGS.relationship

/** Logical day key with the 04:00 rollover in UTC. */
function logicalDayKeyOf(ms: number): string {
  return new Date(ms - ROLLOVER_MS).toISOString().slice(0, 10)
}

function logicalDayStartOf(ms: number): number {
  return Math.floor((ms - ROLLOVER_MS) / DAY_MS) * DAY_MS + ROLLOVER_MS
}

function ctx(nowMs: number): AdvanceContext {
  return { nowMs, logicalDayKeyOf, logicalDayStartOf }
}

function initial(nowMs = START_MS, profile = PROFILE): CharacterStateRecordV1 {
  return initialCharacterState('card-1', profile, ctx(nowMs))
}

function apply(state: CharacterStateRecordV1, event: CharacterEvent): CharacterStateRecordV1 {
  return applyEvent(state, event, PROFILE, ctx(event.atMs))
}

/** Seeded uniform values in [0, 1). */
function randoms(seed: number, count: number): number[] {
  let state = seedRng(seed)
  const values: number[] = []
  for (let index = 0; index < count; index++) {
    const [value, next] = nextRandom(state)
    values.push(value)
    state = next
  }
  return values
}

/** One event of a seeded kind; `pick` in [0, 1) chooses the kind. */
function randomEvent(pick: number, id: string, atMs: number): CharacterEvent {
  const builders: ((id: string, atMs: number) => CharacterEvent)[] = [
    (id, atMs) => ({ kind: 'model-cue', id, atMs, turnId: id, directions: { valence: 1, energy: 0, tension: -1 }, reason: 'he remembered' }),
    (id, atMs) => ({ kind: 'touch-pleasant', id, atMs }),
    (id, atMs) => ({ kind: 'touch-unwelcome', id, atMs }),
    (id, atMs) => ({ kind: 'reach-out-unanswered', id, atMs, consecutive: 1 }),
    (id, atMs) => ({ kind: 'reach-out-unanswered', id, atMs, consecutive: 2 }),
    (id, atMs) => ({ kind: 'late-reply', id, atMs }),
    (id, atMs) => ({ kind: 'reach-out-reply', id, atMs }),
    (id, atMs) => ({ kind: 'return', id, atMs, gapMs: 2 * DAY_MS }),
    (id, atMs) => ({ kind: 'user-turn', id, atMs, exchange: 'first-real' }),
    (id, atMs) => ({ kind: 'user-turn', id, atMs, exchange: 'later' }),
    (id, atMs) => ({ kind: 'character-spoke', id, atMs }),
    (id, atMs) => ({ kind: 'disclosure', id, atMs, reason: 'he told her about his sister' }),
    (id, atMs) => ({ kind: 'milestone', id, atMs, reason: 'first movie night', memoryId: `memory-${id}` }),
    (id, atMs) => ({ kind: 'significant-positive', id, atMs, reason: 'he passed his exam' }),
    (id, atMs) => ({ kind: 'hurtful', id, atMs, reason: 'he mocked her' }),
  ]
  return builders[Math.floor(pick * builders.length)](id, atMs)
}

/** A seeded state: created at a random minute, then 30 random events over three days. */
function seededState(seed: number): { state: CharacterStateRecordV1, values: number[] } {
  const values = randoms(seed, 1 + 30 * 2 + 2)
  const createdAtMs = START_MS + Math.floor(values[0] * DAY_MS / MINUTE_MS) * MINUTE_MS
  const times = Array.from({ length: 30 }, (_, index) => createdAtMs + Math.floor(values[1 + index] * 3 * DAY_MS)).sort((a, b) => a - b)
  let state = initial(createdAtMs)
  times.forEach((atMs, index) => {
    state = apply(state, randomEvent(values[31 + index], `e-${seed}-${index}`, atMs))
  })
  return { state, values: values.slice(61) }
}

describe('initialCharacterState', () => {
  it('starts on the epoch hour at the resting disposition with the creation day rolled over', () => {
    const createdAtMs = START_MS + 5 * HOUR_MS + 17 * MINUTE_MS + 3_000
    const state = initial(createdAtMs, { resting: { valence: 0.3, energy: -0.1, tension: 0.2 }, startingStage: 'friendly' })
    expect(safeParse(CharacterStateRecordSchema, state).success).toBe(true)
    expect(state.createdAtMs).toBe(createdAtMs)
    expect(state.updatedAtMs).toBe(createdAtMs)
    expect(state.lastInteractionAtMs).toBeNull()
    expect(state.temperament.throughHourMs).toBe(START_MS + 5 * HOUR_MS)
    expect(state.temperament.axes).toEqual({ valence: 0.3, energy: -0.1, tension: 0.2 })
    expect(state.temperament.day).toEqual({ key: '2026-11-03', sum: { valence: 0, energy: 0, tension: 0 }, samples: 0 })
    expect(state.relationship.lastDayKey).toBe('2026-11-03')
    expect(state.relationship.day.key).toBe('2026-11-03')
    expect(state.relationship.stages.closeness).toBe('friendly')
    expect(state.history).toEqual([])
    expect(state.appliedEvents).toEqual({ recent: [], evictedThroughMs: null })
  })
})

describe('advance', () => {
  it('returns the state itself for an equal or earlier nowMs', () => {
    const state = advance(initial(), PROFILE, ctx(START_MS + 30 * HOUR_MS))
    expect(advance(state, PROFILE, ctx(START_MS + 30 * HOUR_MS))).toBe(state)
    expect(advance(state, PROFILE, ctx(START_MS + 2 * HOUR_MS))).toBe(state)
    expect(advance(state, PROFILE, ctx(Number.NaN))).toBe(state)
  })

  it('gives equal results for advance(advance(s, t1), t2) and advance(s, t2) (200 seeds)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { state, values } = seededState(seed)
      const t1 = state.updatedAtMs + Math.floor(values[0] * 10 * DAY_MS)
      const t2 = t1 + 1 + Math.floor(values[1] * 10 * DAY_MS)
      expect(advance(advance(state, PROFILE, ctx(t1)), PROFILE, ctx(t2))).toEqual(advance(state, PROFILE, ctx(t2)))
    }
  })

  it('keeps a contribution that expires between a cut and the next :30 sample', () => {
    // Created at 07:00, so the first unprocessed hour samples at 07:30. A poke at 04:40 expires three half-lives
    // later, at 07:40: after that sample and before the 07:50 cut, so pruning at the cut would hide it from the sample.
    let state = initial(START_MS + 3 * HOUR_MS)
    state = apply(state, { kind: 'touch-unwelcome', id: 'poke-1', atMs: START_MS + 40 * MINUTE_MS })
    const [contribution] = state.mood.contributions
    expect(contribution.expiresAtMs).toBeGreaterThan(START_MS + 3 * HOUR_MS + 30 * MINUTE_MS)
    expect(contribution.expiresAtMs).toBeLessThan(START_MS + 3 * HOUR_MS + 50 * MINUTE_MS)

    const cut = advance(state, PROFILE, ctx(START_MS + 3 * HOUR_MS + 50 * MINUTE_MS))
    expect(cut.mood.contributions).toHaveLength(1)
    const end = START_MS + 6 * HOUR_MS
    const split = advance(cut, PROFILE, ctx(end))
    expect(split).toEqual(advance(state, PROFILE, ctx(end)))
    expect(split.mood.contributions).toEqual([])
  })

  it('appends exactly one history row per crossed rollover, matching the temperament completed days', () => {
    const start = apply(initial(START_MS + 6 * HOUR_MS), { kind: 'significant-positive', id: 'sig-1', atMs: START_MS + 7 * HOUR_MS, reason: 'he passed his exam' })
    const endMs = START_MS + 3 * DAY_MS + 6 * HOUR_MS
    const advanced = advance(start, PROFILE, ctx(endMs))
    expect(advanced.history.map(row => row.dayKey)).toEqual(['2026-11-03', '2026-11-04', '2026-11-05'])

    const expected = advanceTemperament(start.temperament, start.mood.contributions, PROFILE.resting, ctx(endMs)).completedDays
    expect(advanced.history.map(row => row.temperament)).toEqual(expected.map((day: CompletedTemperamentDay) => day.temperament))
    advanced.history.forEach((row, index) => {
      const day = expected[index]
      expect(row.mood).toEqual({ valence: day.sum.valence / day.samples, energy: day.sum.energy / day.samples, tension: day.sum.tension / day.samples })
    })
    expect(advanced.relationship.lastDayKey).toBe('2026-11-06')
  })

  it('keeps the newest 400 rows after more than 400 completed days', () => {
    let state = initial()
    for (let day = 1; day <= 402; day++)
      state = advance(state, PROFILE, ctx(START_MS + day * DAY_MS))
    expect(state.history).toHaveLength(400)
    expect(state.history.at(-1)?.dayKey).toBe(logicalDayKeyOf(START_MS + 401 * DAY_MS))
    expect(state.history[0].dayKey).toBe(logicalDayKeyOf(START_MS + 2 * DAY_MS))
  })

  it('records the closing day with its own stages and applies the stage-up at the rollover', () => {
    let state = initial()
    state = { ...state, relationship: { ...state.relationship, levels: { closeness: 0.149, trust: 0, familiarity: 0 } } }
    state = apply(state, { kind: 'user-turn', id: 'turn-1', atMs: START_MS + 10 * HOUR_MS, exchange: 'first-real' })
    expect(state.relationship.levels.closeness).toBeGreaterThanOrEqual(0.15)
    expect(state.relationship.stages.closeness).toBe('stranger')

    const next = advance(state, PROFILE, ctx(START_MS + DAY_MS + HOUR_MS))
    expect(next.relationship.stages.closeness).toBe('friendly')
    expect(next.history).toHaveLength(1)
    expect(next.history[0].stages.closeness).toBe('stranger')
    expect(next.history[0].levels).toEqual(state.relationship.levels)
  })

  it('drops a wound once it has decayed away and leaves a fresh wound to decay continuously', () => {
    const hurt = apply(initial(), { kind: 'hurtful', id: 'hurt-1', atMs: START_MS + HOUR_MS, reason: 'he mocked her' })
    expect(hurt.relationship.wound).toBeCloseTo(0.15, 12)
    expect(advance(hurt, PROFILE, ctx(START_MS + DAY_MS)).relationship.wound).toBe(hurt.relationship.wound)
    expect(advance(hurt, PROFILE, ctx(START_MS + 90 * DAY_MS)).relationship.wound).toBe(0)
  })
})

describe('applyEvent', () => {
  const events: CharacterEvent[] = [
    { kind: 'model-cue', id: 'cue-1', atMs: START_MS + HOUR_MS, turnId: 'turn-1', directions: { valence: 1, energy: 0, tension: -1 }, reason: 'he remembered' },
    { kind: 'touch-pleasant', id: 'touch-1', atMs: START_MS + HOUR_MS },
    { kind: 'touch-unwelcome', id: 'touch-2', atMs: START_MS + HOUR_MS },
    { kind: 'reach-out-unanswered', id: 'reach-1', atMs: START_MS + HOUR_MS, consecutive: 2 },
    { kind: 'late-reply', id: 'reply-1', atMs: START_MS + HOUR_MS },
    { kind: 'reach-out-reply', id: 'reply-2', atMs: START_MS + HOUR_MS },
    { kind: 'return', id: 'return-1', atMs: START_MS + HOUR_MS, gapMs: 10 * DAY_MS },
    { kind: 'ritual-reciprocated', id: 'ritual-1', atMs: START_MS + HOUR_MS },
    { kind: 'user-turn', id: 'turn-2', atMs: START_MS + HOUR_MS, exchange: 'first-real' },
    { kind: 'character-spoke', id: 'turn-3', atMs: START_MS + HOUR_MS },
    { kind: 'disclosure', id: 'x-1', atMs: START_MS + HOUR_MS, reason: 'he told her about his sister' },
    { kind: 'kept-promise', id: 'x-2', atMs: START_MS + HOUR_MS, reason: 'he came back after lunch' },
    { kind: 'milestone', id: 'x-3', atMs: START_MS + HOUR_MS, reason: 'first movie night', memoryId: 'memory-2' },
    { kind: 'significant-positive', id: 'x-4', atMs: START_MS + HOUR_MS, reason: 'he passed his exam' },
    { kind: 'significant-negative', id: 'x-5', atMs: START_MS + HOUR_MS, reason: 'his trip was cancelled' },
    { kind: 'unkind', id: 'x-6', atMs: START_MS + HOUR_MS, reason: 'he snapped at her' },
    { kind: 'hurtful', id: 'x-7', atMs: START_MS + HOUR_MS, reason: 'he mocked her' },
  ]

  it.each(events.map(event => [event.kind, event] as const))('applies %s once when its id is applied twice', (_kind, event) => {
    const once = apply(initial(), event)
    expect(once).not.toEqual(initial())
    expect(apply(once, event)).toBe(once)
    expect(apply(once, { ...event, atMs: event.atMs + MINUTE_MS })).toBe(once)
  })

  it('routes mood and relationship parts of one event', () => {
    const state = apply(initial(), events[10])
    expect(state.mood.contributions).toEqual([])
    expect(state.relationship.levels.familiarity).toBeGreaterThan(0)
    const hurt = apply(initial(), events[16])
    expect(hurt.mood.contributions.map(entry => entry.id)).toEqual(['x-7'])
    expect(hurt.relationship.levels.trust).toBe(0)
    expect(hurt.relationship.wound).toBeGreaterThan(0)
  })

  it('updates lastInteractionAtMs for user turns, touch, and character speech only', () => {
    const at = START_MS + 2 * HOUR_MS
    for (const event of events) {
      const state = apply(initial(), { ...event, atMs: at })
      const expected = ['user-turn', 'touch-pleasant', 'touch-unwelcome', 'character-spoke'].includes(event.kind) ? at : null
      expect(state.lastInteractionAtMs, event.kind).toBe(expected)
    }
  })

  it('treats a replay of a refused event as a no-op', () => {
    let state = initial()
    for (let index = 0; index < 3; index++)
      state = apply(state, { kind: 'significant-positive', id: `sig-${index}`, atMs: START_MS + (index + 1) * HOUR_MS, reason: 'good news' })
    expect(state.mood.contributions.map(entry => entry.id)).toEqual(['sig-0', 'sig-1'])
    const refused = state
    // The cap still refuses it, but a replay of its id must not even reach the cap.
    expect(apply(refused, { kind: 'significant-positive', id: 'sig-2', atMs: START_MS + 3 * HOUR_MS, reason: 'good news' })).toBe(refused)
  })

  it('treats a replay of a pruned event as a no-op', () => {
    const poke: CharacterEvent = { kind: 'touch-unwelcome', id: 'poke-1', atMs: START_MS + HOUR_MS }
    const poked = apply(initial(), poke)
    const later = advance(poked, PROFILE, ctx(START_MS + 12 * HOUR_MS))
    expect(later.mood.contributions).toEqual([])
    expect(apply(later, poke)).toBe(later)
  })

  it('erodes familiarity once for a replayed return event', () => {
    const base = initial()
    const known = { ...base, relationship: { ...base.relationship, levels: { closeness: 0.3, trust: 0.3, familiarity: 0.5 } } }
    const back: CharacterEvent = { kind: 'return', id: 'return-1', atMs: START_MS + HOUR_MS, gapMs: 10 * DAY_MS }
    const once = apply(known, back)
    expect(once.relationship.levels.familiarity).toBeLessThan(0.5)
    expect(once.relationship.levels.familiarity).toBeGreaterThan(0.5 * 0.96)
    expect(apply(once, back)).toBe(once)
    expect(apply(apply(once, back), back).relationship.levels.familiarity).toBe(once.relationship.levels.familiarity)
  })

  it('rejects an event from a logical day before the newest one, so alternating days cannot exceed the daily cap', () => {
    let state = initial()
    for (let index = 0; index < 20; index++) {
      const day = index % 2 === 0 ? 1 : 0
      state = apply(state, { kind: 'user-turn', id: `turn-${index}`, atMs: START_MS + day * DAY_MS + (10 + index * 0.1) * HOUR_MS, exchange: 'first-real' })
    }
    // Two logical days hold at most two daily gains.
    const twoDays = 1 - (1 - dailyGain.closeness) ** 2
    expect(state.relationship.levels.closeness).toBeLessThanOrEqual(twoDays + 1e-12)
    expect(state.relationship.levels.closeness).toBeLessThanOrEqual(dailyGain.closeness + 1e-12)

    const stale: CharacterEvent = { kind: 'disclosure', id: 'old-1', atMs: START_MS + 23 * HOUR_MS, reason: 'he told her a secret' }
    expect(apply(state, stale)).toBe(state)
  })

  it('accepts an older event of the current logical day', () => {
    const state = apply(initial(), { kind: 'touch-pleasant', id: 'touch-1', atMs: START_MS + 5 * HOUR_MS })
    const earlier = apply(state, { kind: 'disclosure', id: 'x-1', atMs: START_MS + 2 * HOUR_MS, reason: 'he told her about his sister' })
    expect(earlier.relationship.levels.familiarity).toBeGreaterThan(0)
  })

  it('returns the state itself for a malformed event', () => {
    const state = initial()
    // Stored or replicated input is untyped at runtime; an unknown kind must not slip through.
    const bogus: CharacterEvent = JSON.parse(JSON.stringify({ kind: 'love', id: 'x', atMs: START_MS + HOUR_MS }))
    expect(apply(state, bogus)).toBe(state)
  })

  it('keeps a bounded ring of applied ids and rejects events at or before the newest evicted one', () => {
    let state = initial()
    for (let index = 0; index <= MAX_APPLIED_EVENT_IDS; index++)
      state = apply(state, { kind: 'character-spoke', id: `spoke-${index}`, atMs: START_MS + HOUR_MS + index * 1_000 })
    expect(state.appliedEvents.recent).toHaveLength(MAX_APPLIED_EVENT_IDS)
    expect(state.appliedEvents.evictedThroughMs).toBe(START_MS + HOUR_MS)
    expect(safeParse(CharacterStateRecordSchema, state).success).toBe(true)
    expect(apply(state, { kind: 'touch-pleasant', id: 'spoke-0', atMs: START_MS + HOUR_MS })).toBe(state)
  })
})
