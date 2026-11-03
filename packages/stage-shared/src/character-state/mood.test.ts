import type { AdvanceContext, CharacterEvent, MoodAxes, MoodContribution, MoodState } from '.'

import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import { CHARACTER_STATE_SETTINGS, CharacterStateRecordSchema, DEFAULT_CHARACTER_PROFILE } from '.'
import { nextRandom, seedRng } from '../situation/rng'
import { insertContribution, moodAt, pruneMood, rawAt, remaining } from './mood'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const ROLLOVER_MS = 4 * HOUR_MS
const START_MS = Date.UTC(2026, 10, 3, 9)
const RESTING = DEFAULT_CHARACTER_PROFILE.resting
const EMPTY: MoodState = { contributions: [], modelCueLog: [] }

// The logical day rolls over at 04:00 UTC in these tests.
function logicalDayStartOf(ms: number): number {
  return Math.floor((ms - ROLLOVER_MS) / DAY_MS) * DAY_MS + ROLLOVER_MS
}

function contextAt(nowMs: number): AdvanceContext {
  return {
    nowMs,
    logicalDayStartOf,
    logicalDayKeyOf: ms => new Date(logicalDayStartOf(ms)).toISOString().slice(0, 10),
  }
}

function brighter(index: number, atMs: number): CharacterEvent {
  return { kind: 'model-cue', id: `cue-${index}`, atMs, turnId: `turn-${index}`, directions: { valence: 1, energy: 0, tension: 0 }, reason: 'he remembered' }
}

function insertAll(state: MoodState, events: readonly CharacterEvent[]): MoodState {
  return events.reduce((next, event) => insertContribution(next, event, contextAt(event.atMs)), state)
}

function absoluteMass(contributions: readonly MoodContribution[], nowMs: number): MoodAxes {
  const mass = { valence: 0, energy: 0, tension: 0 }
  for (const contribution of contributions) {
    const weight = remaining(contribution, nowMs)
    mass.valence += Math.abs(contribution.delta.valence) * weight
    mass.energy += Math.abs(contribution.delta.energy) * weight
    mass.tension += Math.abs(contribution.delta.tension) * weight
  }
  return mass
}

const AXES = ['valence', 'energy', 'tension'] as const

class SeededStream {
  private state: number

  constructor(seed: number) {
    this.state = seedRng(seed)
  }

  next(): number {
    const [value, next] = nextRandom(this.state)
    this.state = next
    return value
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.floor(this.next() * values.length)]!
  }
}

const DIRECTIONS = [-1, 0, 1] as const

function randomEvent(stream: SeededStream, index: number, atMs: number): CharacterEvent {
  const kind = stream.pick(['model-cue', 'touch-pleasant', 'touch-unwelcome', 'reach-out-unanswered', 'late-reply', 'return', 'ritual-reciprocated', 'significant-positive', 'significant-negative', 'hurtful', 'user-turn'] as const)
  const id = `event-${index}`
  switch (kind) {
    case 'model-cue':
      return { kind, id, atMs, turnId: `turn-${index}`, directions: { valence: stream.pick(DIRECTIONS), energy: stream.pick(DIRECTIONS), tension: stream.pick(DIRECTIONS) }, reason: 'a cue' }
    case 'reach-out-unanswered':
      return { kind, id, atMs, consecutive: stream.pick([1, 2] as const) }
    case 'return':
      return { kind, id, atMs, gapMs: stream.next() * 10 * DAY_MS }
    case 'significant-positive':
    case 'significant-negative':
    case 'hurtful':
      return { kind, id, atMs, reason: 'something mattered' }
    case 'user-turn':
      return { kind, id, atMs, exchange: 'later' }
    default:
      return { kind, id, atMs }
  }
}

/** Events whose deltas never change sign per axis: valence and energy >= 0, tension <= 0. */
function randomPleasantEvent(stream: SeededStream, index: number, atMs: number): CharacterEvent {
  const kind = stream.pick(['model-cue', 'touch-pleasant', 'late-reply', 'ritual-reciprocated', 'significant-positive'] as const)
  const id = `event-${index}`
  switch (kind) {
    case 'model-cue':
      return { kind, id, atMs, turnId: `turn-${index}`, directions: { valence: 1, energy: 1, tension: -1 }, reason: 'a cue' }
    case 'significant-positive':
      return { kind, id, atMs, reason: 'something good' }
    default:
      return { kind, id, atMs }
  }
}

function randomTimeline(seed: number, eventOf: typeof randomEvent): { state: MoodState, endMs: number, stream: SeededStream } {
  const stream = new SeededStream(seed)
  let atMs = START_MS
  const events: CharacterEvent[] = []
  const count = 5 + Math.floor(stream.next() * 40)
  for (let index = 0; index < count; index++) {
    atMs += Math.floor(stream.next() * 3 * HOUR_MS)
    events.push(eventOf(stream, index, atMs))
  }
  return { state: insertAll(EMPTY, events), endMs: atMs, stream }
}

describe('moodAt', () => {
  it('equals the temperament with no contributions', () => {
    const mood = moodAt([], RESTING, START_MS)
    expect(mood.valence).toBeCloseTo(RESTING.valence, 12)
    expect(mood.energy).toBeCloseTo(RESTING.energy, 12)
    expect(mood.tension).toBeCloseTo(RESTING.tension, 12)
  })

  it('counts a contribution only inside [atMs, expiresAtMs)', () => {
    const state = insertContribution(EMPTY, { kind: 'touch-pleasant', id: 'touch-1', atMs: START_MS }, contextAt(START_MS))
    const [contribution] = state.contributions
    expect(remaining(contribution!, START_MS - 1)).toBe(0)
    expect(remaining(contribution!, START_MS)).toBe(1)
    expect(remaining(contribution!, START_MS + 1.5 * HOUR_MS)).toBeCloseTo(0.5, 12)
    expect(remaining(contribution!, contribution!.expiresAtMs)).toBe(0)
    // expiresAtMs = atMs + halfLife * log2(0.10 / 0.01).
    expect(contribution!.expiresAtMs).toBeCloseTo(START_MS + 1.5 * HOUR_MS * Math.log2(10), 3)
  })
})

describe('insertContribution', () => {
  it('accepts three of ten simultaneous brighter cues and reaches valence 0.328', () => {
    const events = Array.from({ length: 10 }, (_, index) => brighter(index, START_MS))
    const state = insertAll(EMPTY, events)
    const mood = moodAt(state.contributions, RESTING, START_MS)

    expect(state.contributions).toHaveLength(3)
    for (const contribution of state.contributions)
      expect(contribution.delta.valence).toBeCloseTo(0.08, 12)
    expect(Math.abs(mood.valence - 0.328)).toBeLessThanOrEqual(0.001)
  })

  it('keeps a three-day brighter cue stream within the rolling budget peak', () => {
    let state = EMPTY
    let peakRaw = 0
    let peakValence = Number.NEGATIVE_INFINITY
    let peakLive = 0
    for (let index = 0; index < 4_320; index++) {
      const atMs = START_MS + index * MINUTE_MS
      state = pruneMood(insertContribution(state, brighter(index, atMs), contextAt(atMs)), atMs)
      peakRaw = Math.max(peakRaw, rawAt(state.contributions, atMs).valence)
      peakValence = Math.max(peakValence, moodAt(state.contributions, RESTING, atMs).valence)
      peakLive = Math.max(peakLive, state.contributions.length)
    }

    expect(peakRaw).toBeLessThanOrEqual(0.65)
    expect(peakValence).toBeLessThanOrEqual(0.64)
    expect(peakLive).toBeLessThanOrEqual(CHARACTER_STATE_SETTINGS.mood.maxContributions)
    expect(state.modelCueLog.length).toBeLessThanOrEqual(CHARACTER_STATE_SETTINGS.mood.modelCue.maxLogEntries)
  })

  it('gives the hurtful plus second unanswered reach-out worked example', () => {
    const state = insertAll(EMPTY, [
      { kind: 'hurtful', id: 'hurt-1', atMs: START_MS, reason: 'he called her useless' },
      { kind: 'reach-out-unanswered', id: 'reach-2', atMs: START_MS, consecutive: 2 },
    ])
    const now = moodAt(state.contributions, RESTING, START_MS)
    const later = moodAt(state.contributions, RESTING, START_MS + 9 * HOUR_MS)

    expect(Math.abs(now.valence - -0.26)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(now.energy - -0.15)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(now.tension - 0.32)).toBeLessThanOrEqual(0.01)
    expect(Math.abs(later.valence - -0.07)).toBeLessThanOrEqual(0.01)
    expect(state.contributions.map(c => c.source)).toEqual(['significant', 'reach-out-unanswered'])
  })

  it('treats a repeated event id as a no-op', () => {
    const events: CharacterEvent[] = [
      brighter(1, START_MS),
      { kind: 'touch-pleasant', id: 'touch-1', atMs: START_MS + MINUTE_MS },
      { kind: 'significant-positive', id: 'sig-1', atMs: START_MS + 2 * MINUTE_MS, reason: 'he came back' },
    ]
    const once = insertAll(EMPTY, events)
    const twice = insertAll(once, events)
    expect(twice).toEqual(once)
  })

  it('caps pleasant touch at 0.3 valence per rolling hour', () => {
    const touches: CharacterEvent[] = Array.from({ length: 5 }, (_, index) => ({ kind: 'touch-pleasant', id: `touch-${index}`, atMs: START_MS + index * MINUTE_MS }))
    const state = insertAll(EMPTY, touches)
    const accepted = state.contributions.reduce((sum, c) => sum + c.delta.valence, 0)
    expect(accepted).toBeCloseTo(0.3, 12)

    const nextHour = insertContribution(state, { kind: 'touch-pleasant', id: 'touch-late', atMs: START_MS + HOUR_MS + MINUTE_MS }, contextAt(START_MS + HOUR_MS + MINUTE_MS))
    expect(nextHour.contributions.at(-1)!.delta.valence).toBeCloseTo(0.1, 12)
  })

  it('accepts at most two significant contributions per logical day', () => {
    const significant = (index: number, atMs: number): CharacterEvent => ({ kind: index % 2 === 0 ? 'significant-positive' : 'hurtful', id: `sig-${index}`, atMs, reason: 'it mattered' })
    const sameDay = insertAll(EMPTY, [significant(0, START_MS), significant(1, START_MS + HOUR_MS), significant(2, START_MS + 2 * HOUR_MS)])
    expect(sameDay.contributions).toHaveLength(2)

    // 09:00 UTC + 19 h is 04:00 UTC the next morning, the first instant of the next logical day.
    const nextDayMs = START_MS + 19 * HOUR_MS
    const nextDay = insertContribution(sameDay, significant(3, nextDayMs), contextAt(nextDayMs))
    expect(nextDay.contributions).toHaveLength(3)
  })

  it('rails each axis at |raw| <= 2.5', () => {
    const near: MoodContribution = { id: 'near', source: 'significant', reason: 'test', atMs: START_MS, halfLifeMs: 9 * HOUR_MS, delta: { valence: 2.45, energy: 0, tension: -2.49 }, expiresAtMs: START_MS + 100 * HOUR_MS }
    const state = insertContribution({ contributions: [near], modelCueLog: [] }, { kind: 'significant-positive', id: 'sig-1', atMs: START_MS, reason: 'great news' }, contextAt(START_MS))
    const added = state.contributions.at(-1)!
    expect(added.delta.valence).toBeCloseTo(0.05, 12)
    expect(added.delta.energy).toBeCloseTo(0.1, 12)
    expect(rawAt(state.contributions, START_MS).valence).toBeCloseTo(2.5, 12)
  })

  it('never lets |raw| exceed the rail over 200 seeded timelines', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { state, endMs } = randomTimeline(seed, randomEvent)
      for (const contribution of state.contributions) {
        const raw = rawAt(state.contributions, contribution.atMs)
        for (const axis of AXES)
          expect(Math.abs(raw[axis])).toBeLessThanOrEqual(CHARACTER_STATE_SETTINGS.mood.headroom + 1e-12)
      }
      expect(state.contributions.length).toBeLessThanOrEqual(CHARACTER_STATE_SETTINGS.mood.maxContributions)
      expect(endMs).toBeGreaterThanOrEqual(START_MS)
    }
  })

  it('scales a return by the gap and ignores short gaps', () => {
    const short = insertContribution(EMPTY, { kind: 'return', id: 'ret-1', atMs: START_MS, gapMs: 12 * HOUR_MS }, contextAt(START_MS))
    expect(short).toEqual(EMPTY)
    const long = insertContribution(EMPTY, { kind: 'return', id: 'ret-2', atMs: START_MS, gapMs: 96 * HOUR_MS }, contextAt(START_MS))
    expect(long.contributions[0]!.delta).toEqual({ valence: 0.15, energy: 0.1, tension: 0.1 })
  })

  it('ignores events without a mood part', () => {
    expect(insertContribution(EMPTY, { kind: 'user-turn', id: 'turn-1', atMs: START_MS, exchange: 'later' }, contextAt(START_MS))).toBe(EMPTY)
    expect(insertContribution(EMPTY, { kind: 'kept-promise', id: 'promise-1', atMs: START_MS, reason: 'he kept it' }, contextAt(START_MS))).toBe(EMPTY)
  })

  it('rejects malformed events and keeps the state valid', () => {
    // Stored or parsed input arrives untyped; JSON.parse stands in for that boundary.
    const unknownKind: CharacterEvent = JSON.parse(`{"kind":"tickle","id":"unknown","atMs":${START_MS}}`)
    const malformed: CharacterEvent[] = [
      { kind: 'touch-pleasant', id: 'nan', atMs: Number.NaN },
      { kind: 'return', id: 'inf', atMs: START_MS, gapMs: Number.POSITIVE_INFINITY },
      unknownKind,
      { kind: 'touch-pleasant', id: '', atMs: START_MS },
    ]
    for (const event of malformed)
      expect(insertContribution(EMPTY, event, contextAt(START_MS))).toBe(EMPTY)
  })

  it('produces contributions the stored record schema accepts', () => {
    const { state } = randomTimeline(7, randomEvent)
    const result = safeParse(CharacterStateRecordSchema, {
      version: 1,
      cardId: 'card-1',
      createdAtMs: START_MS,
      updatedAtMs: START_MS,
      lastInteractionAtMs: null,
      mood: state,
      temperament: { axes: RESTING, throughHourMs: START_MS, day: { key: '2026-11-03', sum: { valence: 0, energy: 0, tension: 0 }, samples: 0 } },
      relationship: {
        levels: { closeness: 0, trust: 0, familiarity: 0 },
        stages: { closeness: 'stranger', trust: 'guarded', familiarity: 'new' },
        wound: 0,
        woundAtMs: START_MS,
        day: { key: '2026-11-03', sums: { closeness: 0, trust: 0, familiarity: 0 }, negatives: 0, milestones: 0, unwelcomeTouches: 0, countedTouchHours: [] },
        activeDays: 0,
        milestoneIds: [],
        lastSeenAtMs: null,
        lastDayKey: '2026-11-03',
        pendingStageUps: { closeness: null, trust: null, familiarity: null },
      },
      history: [],
    })
    expect(result.issues).toBeUndefined()
  })
})

describe('pruneMood', () => {
  it('never changes moodAt at or after the prune time over 200 seeded states', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { state, endMs, stream } = randomTimeline(seed, randomEvent)
      const pruneMs = START_MS + Math.floor(stream.next() * (endMs - START_MS + 2 * DAY_MS))
      const laterMs = pruneMs + Math.floor(stream.next() * 2 * DAY_MS)
      const pruned = pruneMood(state, pruneMs)
      expect(pruned.contributions.every(c => c.expiresAtMs > pruneMs)).toBe(true)
      expect(moodAt(pruned.contributions, RESTING, pruneMs)).toEqual(moodAt(state.contributions, RESTING, pruneMs))
      expect(moodAt(pruned.contributions, RESTING, laterMs)).toEqual(moodAt(state.contributions, RESTING, laterMs))
    }
  })
})

describe('decay without inserts', () => {
  it('never increases the absolute contribution mass, which bounds |raw|, over 200 seeded timelines', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { state, endMs, stream } = randomTimeline(seed, randomEvent)
      let previous = absoluteMass(state.contributions, endMs)
      let atMs = endMs
      for (let step = 0; step < 48; step++) {
        atMs += Math.floor(stream.next() * HOUR_MS)
        const mass = absoluteMass(state.contributions, atMs)
        const raw = rawAt(state.contributions, atMs)
        for (const axis of AXES) {
          expect(mass[axis]).toBeLessThanOrEqual(previous[axis] + 1e-12)
          expect(Math.abs(raw[axis])).toBeLessThanOrEqual(mass[axis] + 1e-12)
        }
        previous = mass
      }
    }
  })

  it('never increases |raw| when every axis keeps one sign, over 200 seeded timelines', () => {
    for (let seed = 0; seed < 200; seed++) {
      const { state, endMs, stream } = randomTimeline(seed, randomPleasantEvent)
      let previous = rawAt(state.contributions, endMs)
      let atMs = endMs
      for (let step = 0; step < 48; step++) {
        atMs += Math.floor(stream.next() * HOUR_MS)
        const raw = rawAt(state.contributions, atMs)
        for (const axis of AXES)
          expect(Math.abs(raw[axis])).toBeLessThanOrEqual(Math.abs(previous[axis]) + 1e-12)
        previous = raw
      }
    }
  })
})
