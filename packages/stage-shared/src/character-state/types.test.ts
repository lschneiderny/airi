import type { CharacterEvent, CharacterStateRecordV1, DailySummary, MoodContribution } from '.'

import { safeParse } from 'valibot'
import { describe, expect, it } from 'vitest'

import {
  CHARACTER_STATE_SETTINGS,
  CharacterEventSchema,
  CharacterProfileSchema,
  CharacterStateRecordSchema,
  DEFAULT_CHARACTER_PROFILE,
  MAX_APPLIED_EVENT_IDS,
  TemperamentDaySchema,
} from '.'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const START_MS = Date.UTC(2026, 10, 3, 4)

function contribution(index: number): MoodContribution {
  return {
    id: `touch-${index}`,
    source: 'touch',
    reason: 'he patted her head',
    atMs: START_MS + index * 1_000,
    halfLifeMs: 1.5 * HOUR_MS,
    delta: { valence: 0.1, energy: 0.05, tension: -0.03 },
    expiresAtMs: START_MS + index * 1_000 + 5 * HOUR_MS,
  }
}

function summary(index: number): DailySummary {
  return {
    dayKey: `day-${index}`,
    mood: { valence: 0.1, energy: 0, tension: 0.15 },
    temperament: { valence: 0.1, energy: 0, tension: 0.15 },
    levels: { closeness: 0.2, trust: 0.1, familiarity: 0.3 },
    stages: { closeness: 'friendly', trust: 'guarded', familiarity: 'knows-you' },
  }
}

function record(): CharacterStateRecordV1 {
  return {
    version: 1,
    cardId: 'card-1',
    createdAtMs: START_MS,
    updatedAtMs: START_MS + HOUR_MS,
    lastInteractionAtMs: null,
    mood: {
      contributions: [contribution(0)],
      modelCueLog: [{ atMs: START_MS, delta: { valence: 0.08, energy: 0, tension: 0 } }],
    },
    temperament: {
      axes: { valence: 0.1, energy: 0, tension: 0.15 },
      throughHourMs: START_MS,
      day: { key: '2026-11-03', sum: { valence: 1.4, energy: -0.2, tension: 2.1 }, samples: 12 },
    },
    relationship: {
      levels: { closeness: 0.16, trust: 0, familiarity: 0 },
      stages: { closeness: 'friendly', trust: 'guarded', familiarity: 'new' },
      wound: 0,
      woundAtMs: START_MS,
      day: { key: '2026-11-03', sums: { closeness: 10, trust: 0.2, familiarity: 0.4 }, negatives: 0, milestones: 0, unwelcomeTouches: 0, countedTouchHours: [START_MS] },
      activeDays: 1,
      milestoneIds: ['memory-1'],
      lastSeenAtMs: START_MS,
      lastDayKey: '2026-11-03',
      pendingStageUps: { closeness: 'close', trust: null, familiarity: null },
    },
    history: [summary(0)],
    appliedEvents: { recent: [{ id: 'touch-0', atMs: START_MS }], evictedThroughMs: null },
  }
}

const events: CharacterEvent[] = [
  { kind: 'model-cue', id: 'cue-1', atMs: START_MS, turnId: 'turn-1', directions: { valence: 1, energy: 0, tension: -1 }, reason: 'he remembered' },
  { kind: 'touch-pleasant', id: 'touch-1', atMs: START_MS },
  { kind: 'touch-unwelcome', id: 'touch-2', atMs: START_MS },
  { kind: 'reach-out-unanswered', id: 'reach-1', atMs: START_MS, consecutive: 2 },
  { kind: 'late-reply', id: 'reply-1', atMs: START_MS },
  { kind: 'reach-out-reply', id: 'reply-2', atMs: START_MS },
  { kind: 'return', id: 'return-1', atMs: START_MS, gapMs: 2 * DAY_MS },
  { kind: 'ritual-reciprocated', id: 'ritual-1', atMs: START_MS },
  { kind: 'user-turn', id: 'turn-2', atMs: START_MS, exchange: 'first-real' },
  { kind: 'character-spoke', id: 'turn-3', atMs: START_MS },
  { kind: 'disclosure', id: 'x-1', atMs: START_MS, reason: 'he told her about his sister' },
  { kind: 'kept-promise', id: 'x-2', atMs: START_MS, reason: 'he came back after lunch' },
  { kind: 'milestone', id: 'x-3', atMs: START_MS, reason: 'first movie night', memoryId: 'memory-2' },
  { kind: 'significant-positive', id: 'x-4', atMs: START_MS, reason: 'he passed his exam' },
  { kind: 'significant-negative', id: 'x-5', atMs: START_MS, reason: 'his trip was cancelled' },
  { kind: 'unkind', id: 'x-6', atMs: START_MS, reason: 'he snapped at her' },
  { kind: 'hurtful', id: 'x-7', atMs: START_MS, reason: 'he mocked her' },
]

describe('characterProfileSchema', () => {
  it('parses the default profile unchanged', () => {
    const result = safeParse(CharacterProfileSchema, DEFAULT_CHARACTER_PROFILE)
    expect(result.success).toBe(true)
    expect(result.output).toEqual({ resting: { valence: 0.1, energy: 0, tension: 0.15 }, startingStage: 'stranger' })
  })

  it('rejects an intimate starting stage and a negative resting tension', () => {
    expect(safeParse(CharacterProfileSchema, { ...DEFAULT_CHARACTER_PROFILE, startingStage: 'intimate' }).success).toBe(false)
    expect(safeParse(CharacterProfileSchema, { ...DEFAULT_CHARACTER_PROFILE, resting: { valence: 0, energy: 0, tension: -0.1 } }).success).toBe(false)
  })
})

describe('characterStateRecordSchema', () => {
  it('accepts a full record and its JSON round trip', () => {
    const value = record()
    const result = safeParse(CharacterStateRecordSchema, JSON.parse(JSON.stringify(value)))
    expect(result.success).toBe(true)
    expect(result.output).toEqual(value)
  })

  it('accepts 64 contributions and rejects 65', () => {
    const at = (count: number) => {
      const value = record()
      return { ...value, mood: { ...value.mood, contributions: Array.from({ length: count }, (_, index) => contribution(index)) } }
    }
    expect(safeParse(CharacterStateRecordSchema, at(64)).success).toBe(true)
    expect(safeParse(CharacterStateRecordSchema, at(65)).success).toBe(false)
  })

  it('accepts 64 milestone ids and rejects 65', () => {
    const at = (count: number) => {
      const value = record()
      return { ...value, relationship: { ...value.relationship, milestoneIds: Array.from({ length: count }, (_, index) => `memory-${index}`) } }
    }
    expect(safeParse(CharacterStateRecordSchema, at(64)).success).toBe(true)
    expect(safeParse(CharacterStateRecordSchema, at(65)).success).toBe(false)
  })

  it('accepts 400 history rows and rejects 401', () => {
    const at = (count: number) => ({ ...record(), history: Array.from({ length: count }, (_, index) => summary(index)) })
    expect(safeParse(CharacterStateRecordSchema, at(400)).success).toBe(true)
    expect(safeParse(CharacterStateRecordSchema, at(401)).success).toBe(false)
  })

  it('accepts the applied event id cap and rejects one more', () => {
    const at = (count: number) => ({
      ...record(),
      appliedEvents: { recent: Array.from({ length: count }, (_, index) => ({ id: `event-${index}`, atMs: START_MS + index })), evictedThroughMs: START_MS },
    })
    expect(safeParse(CharacterStateRecordSchema, at(MAX_APPLIED_EVENT_IDS)).success).toBe(true)
    expect(safeParse(CharacterStateRecordSchema, at(MAX_APPLIED_EVENT_IDS + 1)).success).toBe(false)
  })

  it('rejects a level outside [0, 1], an unknown stage, and an unknown field', () => {
    const value = record()
    expect(safeParse(CharacterStateRecordSchema, { ...value, relationship: { ...value.relationship, levels: { closeness: 1.2, trust: 0, familiarity: 0 } } }).success).toBe(false)
    expect(safeParse(CharacterStateRecordSchema, { ...value, relationship: { ...value.relationship, stages: { ...value.relationship.stages, trust: 'devoted' } } }).success).toBe(false)
    expect(safeParse(CharacterStateRecordSchema, { ...value, valence: 0.4 }).success).toBe(false)
  })
})

describe('temperamentDaySchema', () => {
  it('accepts sums outside the mood range and rejects negative or fractional samples and an extra field', () => {
    const day = { key: '2026-11-03', sum: { valence: 3.5, energy: -1.2, tension: 4 }, samples: 24 }
    expect(safeParse(TemperamentDaySchema, day).success).toBe(true)
    expect(safeParse(TemperamentDaySchema, { ...day, samples: -1 }).success).toBe(false)
    expect(safeParse(TemperamentDaySchema, { ...day, samples: 1.5 }).success).toBe(false)
    expect(safeParse(TemperamentDaySchema, { ...day, mean: day.sum }).success).toBe(false)
    expect(safeParse(TemperamentDaySchema, { ...day, sum: { ...day.sum, valence: Number.NaN } }).success).toBe(false)
  })

  it('is required in a stored record', () => {
    const value = record()
    expect(safeParse(CharacterStateRecordSchema, { ...value, temperament: { axes: value.temperament.axes, throughHourMs: START_MS } }).success).toBe(false)
  })
})

describe('characterEventSchema', () => {
  it.each(events.map(event => [event.kind, event] as const))('accepts %s', (_kind, event) => {
    expect(safeParse(CharacterEventSchema, event).success).toBe(true)
  })

  it('rejects an unknown event kind', () => {
    expect(safeParse(CharacterEventSchema, { kind: 'love', id: 'x-8', atMs: START_MS, reason: 'he said so' }).success).toBe(false)
  })

  it('rejects a model cue direction outside {-1, 0, 1} and a milestone without a memory id', () => {
    expect(safeParse(CharacterEventSchema, { ...events[0], directions: { valence: 2, energy: 0, tension: 0 } }).success).toBe(false)
    expect(safeParse(CharacterEventSchema, { kind: 'milestone', id: 'x-9', atMs: START_MS, reason: 'first movie night' }).success).toBe(false)
  })
})

describe('character state settings', () => {
  it('is frozen at every level', () => {
    const unfrozen: string[] = []
    const visit = (value: unknown, path: string) => {
      if (typeof value !== 'object' || value === null)
        return
      if (!Object.isFrozen(value))
        unfrozen.push(path)
      for (const [key, child] of Object.entries(value))
        visit(child, `${path}.${key}`)
    }
    visit(CHARACTER_STATE_SETTINGS, 'CHARACTER_STATE_SETTINGS')
    expect(Object.isFrozen(CHARACTER_STATE_SETTINGS)).toBe(true)
    expect(unfrozen).toEqual([])
  })
})
