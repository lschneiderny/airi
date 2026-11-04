import type { AdvanceContext, CharacterEvent, CharacterReading, CharacterStateRecordV1, MoodAxes, MoodContribution, MoodSource, RelationshipStages } from '.'

import { describe, expect, it } from 'vitest'

import { advance, applyEvent, DEFAULT_CHARACTER_PROFILE, initialCharacterState } from '.'
import { nextRandom, seedRng } from '../situation/rng'
import { readCharacter } from './reading'
import { bucketsOf, renderCharacterContext } from './render'
import { urgeFactorOf } from './urge'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const ROLLOVER_MS = 4 * HOUR_MS
const START_MS = Date.UTC(2026, 10, 3, 9)
const PROFILE = DEFAULT_CHARACTER_PROFILE
const SEEDS = Array.from({ length: 200 }, (_, index) => 1_001 + index * 17)

// The logical day rolls over at 04:00 UTC in these tests.
function logicalDayStartOf(ms: number): number {
  return Math.floor((ms - ROLLOVER_MS) / DAY_MS) * DAY_MS + ROLLOVER_MS
}

function contextAt(nowMs: number): AdvanceContext {
  return { nowMs, logicalDayStartOf, logicalDayKeyOf: ms => new Date(logicalDayStartOf(ms)).toISOString().slice(0, 10) }
}

function contribution(id: string, source: MoodSource, atMs: number, halfLifeMs: number, delta: MoodAxes): MoodContribution {
  const size = Math.max(Math.abs(delta.valence), Math.abs(delta.energy), Math.abs(delta.tension))
  return { id, source, reason: `reason ${id}`, atMs, halfLifeMs, delta, expiresAtMs: atMs + halfLifeMs * Math.log2(size / 0.01) }
}

interface StateOverrides {
  readonly temperament?: MoodAxes
  readonly contributions?: readonly MoodContribution[]
  readonly stages?: RelationshipStages
  readonly milestoneIds?: readonly string[]
}

function stateWith(overrides: StateOverrides): CharacterStateRecordV1 {
  const state = initialCharacterState('card', PROFILE, contextAt(START_MS))
  return {
    ...state,
    temperament: { ...state.temperament, axes: overrides.temperament ?? state.temperament.axes },
    mood: { ...state.mood, contributions: overrides.contributions ?? [] },
    relationship: {
      ...state.relationship,
      stages: overrides.stages ?? state.relationship.stages,
      milestoneIds: overrides.milestoneIds ?? state.relationship.milestoneIds,
    },
  }
}

function read(state: CharacterStateRecordV1, nowMs: number, previous: CharacterReading | null = null): CharacterReading {
  return readCharacter(state, PROFILE, previous, contextAt(nowMs))
}

function seededStream(seed: number): () => number {
  let state = seedRng(seed)
  return () => {
    const [value, next] = nextRandom(state)
    state = next
    return value
  }
}

const UNANSWERED = { valence: -0.06, energy: -0.03, tension: 0.06 }

describe('bucketsOf', () => {
  it('puts a value at a boundary in the upper bucket', () => {
    const at = (valence: number, energy: number, tension: number) => bucketsOf({ valence, energy, tension }, null)
    expect(at(-0.46, -0.46, 0.21)).toEqual({ valence: 'upset', energy: 'drained', tension: 'relaxed' })
    expect(at(-0.45, -0.45, 0.22)).toEqual({ valence: 'low', energy: 'tired', tension: 'a little on edge' })
    expect(at(-0.15, -0.15, 0.44)).toEqual({ valence: 'even', energy: 'steady', tension: 'a little on edge' })
    expect(at(0.15, 0.15, 0.45)).toEqual({ valence: 'good', energy: 'lively', tension: 'tense' })
    expect(at(0.45, 0.45, 1)).toEqual({ valence: 'bright', energy: 'buzzing', tension: 'tense' })
  })

  it('keeps the previous bucket until the value leaves it by the exit hysteresis', () => {
    const previous = bucketsOf({ valence: 0.2, energy: 0.2, tension: 0.3 }, null)
    expect(bucketsOf({ valence: 0.101, energy: 0.101, tension: 0.181 }, previous)).toEqual(previous)
    expect(bucketsOf({ valence: 0.099, energy: 0.099, tension: 0.179 }, previous)).toEqual({ valence: 'even', energy: 'steady', tension: 'relaxed' })
    expect(bucketsOf({ valence: 0.494, energy: 0, tension: 0.489 }, previous)).toEqual({ valence: 'good', energy: 'steady', tension: 'a little on edge' })
    expect(bucketsOf({ valence: 0.5, energy: 0, tension: 0.49 }, previous)).toEqual({ valence: 'bright', energy: 'steady', tension: 'tense' })
    expect(bucketsOf({ valence: -0.6, energy: 0, tension: 0.3 }, previous).valence).toBe('upset')
  })

  it('drops the hysteresis on an axis within the mood epsilon of its resting value', () => {
    const previous = bucketsOf({ valence: 0.2, energy: 0.2, tension: 0.3 }, null)
    const resting = { valence: 0.1, energy: 0, tension: 0.15 }
    expect(bucketsOf({ valence: 0.105, energy: 0.12, tension: 0.2 }, previous, resting)).toEqual({ valence: 'even', energy: 'lively', tension: 'a little on edge' })
    expect(bucketsOf({ valence: 0.115, energy: 0.12, tension: 0.2 }, previous, resting).valence).toBe('good')
  })
})

describe('readCharacter', () => {
  it('never changes the valence bucket while valence oscillates within 0.04 of 0.15, for 200 seeds', () => {
    for (const seed of SEEDS) {
      const random = seededStream(seed)
      let previous: CharacterReading | null = null
      let first: string | null = null
      for (let step = 0; step < 40; step++) {
        const valence = 0.15 + (random() * 2 - 1) * 0.04
        const reading = read(stateWith({ temperament: { ...PROFILE.resting, valence } }), START_MS, previous)
        first ??= reading.buckets.valence
        expect(reading.buckets.valence).toBe(first)
        previous = reading
      }
    }
  })

  it('shows the top two reasons with weight of at least 0.04, ordered by time', () => {
    const now = START_MS
    const state = stateWith({
      contributions: [
        contribution('touch', 'touch', now - 3 * HOUR_MS, 1.5 * HOUR_MS, { valence: 0.1, energy: 0.05, tension: -0.03 }),
        contribution('unanswered', 'reach-out-unanswered', now - 30 * MINUTE_MS, 3 * HOUR_MS, UNANSWERED),
        contribution('remembered', 'significant', now - HOUR_MS, 9 * HOUR_MS, { valence: 0.25, energy: 0.1, tension: 0 }),
      ],
    })
    expect(read(state, now).reasons.map(reason => reason.id)).toEqual(['remembered', 'unanswered'])
    expect(read(state, now).reasons[0]).toEqual({ id: 'remembered', text: 'reason remembered', atMs: now - HOUR_MS })
    const faint = stateWith({ contributions: [contribution('faint', 'touch', now - 4 * HOUR_MS, HOUR_MS, { valence: 0.3, energy: 0, tension: 0 })] })
    expect(read(faint, now).reasons).toEqual([])
  })

  it('shows a repeated reason text once and gives the freed place to a distinct reason', () => {
    const now = START_MS
    const gentle = (id: string, atMs: number, size: number) => ({ ...contribution(id, 'touch', atMs, 3 * HOUR_MS, { valence: size, energy: 0, tension: 0 }), reason: 'he touched you gently' })
    const twice = [gentle('a', now - MINUTE_MS, 0.25), gentle('b', now, 0.25)]
    const only = read(stateWith({ contributions: twice }), now)
    expect(only.reasons.map(reason => reason.text)).toEqual(['he touched you gently'])
    expect(renderCharacterContext(only, contextAt(now)).match(/he touched you gently/g)).toHaveLength(1)
    const other = contribution('c', 'significant', now - HOUR_MS, 9 * HOUR_MS, { valence: 0.1, energy: 0, tension: 0 })
    const withOther = read(stateWith({ contributions: [...twice, other] }), now)
    expect(withOther.reasons.map(reason => reason.text).sort()).toEqual(['he touched you gently', 'reason c'])
    expect(withOther.reasons.map(reason => reason.atMs)).toEqual(withOther.reasons.map(reason => reason.atMs).sort((x, y) => x - y))
  })

  it('halves the weight of model cues and keeps a shown reason until its weight drops below 0.03', () => {
    const now = START_MS
    const state = stateWith({ contributions: [contribution('cue', 'model-cue', now, 90 * MINUTE_MS, { valence: 0.08, energy: 0, tension: 0 })] })
    const shown = read(state, now)
    expect(shown.reasons.map(reason => reason.id)).toEqual(['cue'])
    expect(read(state, now + 20 * MINUTE_MS).reasons).toEqual([])
    expect(read(state, now + 20 * MINUTE_MS, shown).reasons.map(reason => reason.id)).toEqual(['cue'])
    expect(read(state, now + 40 * MINUTE_MS, shown).reasons).toEqual([])
  })

  it('drops a shown reason that weighs less than half of the best excluded one', () => {
    const now = START_MS
    const weak = (id: string, size: number) => contribution(id, 'touch', now - HOUR_MS, HOUR_MS, { valence: 2 * size, energy: 0, tension: 0 })
    const before = stateWith({ contributions: [weak('x', 0.034), weak('y', 0.036)] })
    const previous: CharacterReading = { ...read(before, now), reasons: [{ id: 'x', text: 'reason x', atMs: now - HOUR_MS }, { id: 'y', text: 'reason y', atMs: now - HOUR_MS }] }
    const big = contribution('z', 'significant', now, 9 * HOUR_MS, { valence: 0.25, energy: 0.05, tension: 0 })
    expect(read(stateWith({ contributions: [weak('x', 0.034), weak('y', 0.036), big] }), now, previous).reasons.map(reason => reason.id)).toEqual(['y', 'z'])
    const bigger = contribution('w', 'significant', now, 9 * HOUR_MS, { valence: 0.3, energy: 0.05, tension: 0 })
    expect(read(stateWith({ contributions: [weak('x', 0.034), weak('y', 0.036), big, bigger] }), now, previous).reasons.map(reason => reason.id).sort()).toEqual(['w', 'z'])
  })

  it('keeps reasons ordered by time when their ranking changes', () => {
    const t0 = START_MS
    const older = contribution('older', 'significant', t0, 10 * HOUR_MS, { valence: 0.2, energy: 0, tension: 0 })
    const newer = contribution('newer', 'significant', t0 + HOUR_MS, HOUR_MS, { valence: 0.5, energy: 0, tension: 0 })
    const state = stateWith({ contributions: [older, newer] })
    let previous: CharacterReading | null = null
    for (const at of [t0 + HOUR_MS, t0 + 2 * HOUR_MS, t0 + 3 * HOUR_MS]) {
      previous = read(state, at, previous)
      expect(previous.reasons.map(reason => reason.id)).toEqual(['older', 'newer'])
    }
  })

  it('keeps reasons at most two and ordered by time for 200 seeded mood histories', () => {
    const sources: MoodSource[] = ['model-cue', 'touch', 'reach-out-unanswered', 'reply', 'return', 'significant', 'ritual']
    for (const seed of SEEDS) {
      const random = seededStream(seed)
      const contributions: MoodContribution[] = []
      for (let index = 0; index < 8; index++) {
        const delta = { valence: (random() * 2 - 1) * 0.3, energy: (random() * 2 - 1) * 0.2, tension: (random() * 2 - 1) * 0.15 }
        contributions.push(contribution(`c${index}`, sources[Math.floor(random() * sources.length)]!, START_MS + index * 20 * MINUTE_MS, (0.5 + random() * 8) * HOUR_MS, delta))
      }
      const state = stateWith({ contributions })
      let previous: CharacterReading | null = null
      for (let at = START_MS; at < START_MS + 12 * HOUR_MS; at += 17 * MINUTE_MS) {
        previous = read(state, at, previous)
        expect(previous.reasons.length).toBeLessThanOrEqual(2)
        const times = previous.reasons.map(reason => reason.atMs)
        expect(times).toEqual(times.toSorted((a, b) => a - b))
      }
    }
  })

  it('reports unlocks, the urge factor of its mood, and the last interaction', () => {
    const state = { ...stateWith({ stages: { closeness: 'close', trust: 'confiding', familiarity: 'knows-you' }, milestoneIds: ['m1', 'm2', 'm3'] }), lastInteractionAtMs: START_MS - MINUTE_MS }
    const reading = read(state, START_MS)
    expect(reading.unlocks).toEqual(['teasing', 'nicknames', 'initiative', 'vulnerability', 'callbacks'])
    expect(reading.urgeFactor).toBe(urgeFactorOf(reading.mood))
    expect(reading.lastInteractionAtMs).toBe(START_MS - MINUTE_MS)
    expect(reading.resting).toEqual(PROFILE.resting)
    expect(read(stateWith({}), START_MS).unlocks).toEqual([])
  })

  it('is pointed when low and tense with an unanswered reach-out among the shown reasons', () => {
    const temperament = { valence: -0.3, energy: -0.1, tension: 0.45 }
    const unanswered = contribution('unanswered', 'reach-out-unanswered', START_MS - 30 * MINUTE_MS, 3 * HOUR_MS, UNANSWERED)
    expect(read(stateWith({ temperament, contributions: [unanswered] }), START_MS).pointed).toBe(true)
    expect(read(stateWith({ temperament }), START_MS).pointed).toBe(false)
    expect(read(stateWith({ contributions: [unanswered] }), START_MS).pointed).toBe(false)
    const louder = ['a', 'b'].map((name, index) => contribution(`loud${name}`, 'significant', START_MS - (index + 1) * MINUTE_MS, 9 * HOUR_MS, { valence: -0.25, energy: -0.1, tension: 0.15 }))
    expect(read(stateWith({ temperament, contributions: [unanswered, ...louder] }), START_MS).pointed).toBe(false)
  })

  it('changes the render key when a time word moves and not while the text stays', () => {
    const at = Date.UTC(2026, 10, 3, 22)
    const event: CharacterEvent = { kind: 'significant-negative', id: 'hurt', atMs: at, reason: 'he snapped at you' }
    let state = applyEvent(initialCharacterState('card', PROFILE, contextAt(at - HOUR_MS)), event, PROFILE, contextAt(at))
    const readAt = (nowMs: number, previous: CharacterReading | null) => {
      state = advance(state, PROFILE, contextAt(nowMs))
      const reading = readCharacter(state, PROFILE, previous, contextAt(nowMs))
      return { reading, text: renderCharacterContext(reading, contextAt(nowMs)) }
    }
    const tonight = readAt(at + HOUR_MS, null)
    const morning = readAt(Date.UTC(2026, 10, 4, 5), tonight.reading)
    const later = readAt(Date.UTC(2026, 10, 4, 6), morning.reading)
    const twoDays = readAt(Date.UTC(2026, 10, 5, 5), later.reading)
    expect(tonight.text).toContain('he snapped at you earlier today')
    expect(morning.text).toContain('he snapped at you last night')
    expect(twoDays.text).toContain('he snapped at you a few days ago')
    expect(morning.reading.renderKey).not.toBe(tonight.reading.renderKey)
    expect(later.text).toBe(morning.text)
    expect(later.reading.renderKey).toBe(morning.reading.renderKey)
    expect(twoDays.reading.renderKey).not.toBe(later.reading.renderKey)
  })

  it('changes the render key exactly when the rendered text changes, for 200 seeded event histories', () => {
    for (const seed of SEEDS) {
      const random = seededStream(seed)
      let state = initialCharacterState('card', PROFILE, contextAt(START_MS))
      let previous: { reading: CharacterReading, text: string } | null = null
      let at = START_MS
      for (let step = 0; step < 60; step++) {
        at += Math.floor(random() * 3 * HOUR_MS)
        const roll = random()
        const id = `e${step}`
        const event: CharacterEvent | null = roll < 0.25
          ? { kind: 'model-cue', id, atMs: at, turnId: id, directions: { valence: random() < 0.5 ? 1 : -1, energy: 0, tension: random() < 0.5 ? 1 : 0 }, reason: 'he remembered' }
          : roll < 0.4
            ? { kind: 'touch-pleasant', id, atMs: at }
            : roll < 0.5
              ? { kind: 'reach-out-unanswered', id, atMs: at, consecutive: random() < 0.5 ? 1 : 2 }
              : roll < 0.6
                ? { kind: random() < 0.5 ? 'significant-positive' : 'hurtful', id, atMs: at, reason: `moment ${step % 3 === 0 ? 'one' : 'two'}` }
                : roll < 0.8 ? { kind: 'user-turn', id, atMs: at, exchange: random() < 0.3 ? 'first-real' : 'later' } : null
        state = event === null ? advance(state, PROFILE, contextAt(at)) : applyEvent(state, event, PROFILE, contextAt(at))
        const reading = readCharacter(state, PROFILE, previous?.reading ?? null, contextAt(at))
        const text = renderCharacterContext(reading, contextAt(at))
        if (previous !== null)
          expect(reading.renderKey !== previous.reading.renderKey).toBe(text !== previous.text)
        previous = { reading, text }
      }
    }
  })
})
