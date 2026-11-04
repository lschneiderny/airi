import type { MoodAxes } from '.'

import { describe, expect, it } from 'vitest'

import { DEFAULT_CHARACTER_PROFILE, initialCharacterState, readCharacter } from '.'
import { nextRandom, seedRng } from '../situation/rng'
import { faceBaselineOf, faceDamping, NEUTRAL_FACE_BASELINE } from './face'

const MINUTE_MS = 60_000
const NOW_MS = Date.UTC(2026, 10, 3, 18)
const RESTING = DEFAULT_CHARACTER_PROFILE.resting
const SEEDS = Array.from({ length: 200 }, (_, index) => 3_001 + index * 11)

function readingOf(mood: MoodAxes, lastInteractionAtMs: number | null = NOW_MS) {
  return { mood, resting: RESTING, lastInteractionAtMs }
}

describe('faceDamping', () => {
  it('is 1 within the grace, halves the excess every 20 minutes after it, and floors at 0.25', () => {
    expect(faceDamping(NOW_MS, NOW_MS)).toBe(1)
    expect(faceDamping(NOW_MS - 2 * MINUTE_MS, NOW_MS)).toBe(1)
    expect(faceDamping(NOW_MS - 22 * MINUTE_MS, NOW_MS)).toBeCloseTo(0.25 + 0.75 * 0.5, 12)
    expect(faceDamping(NOW_MS - 10 * 24 * 60 * MINUTE_MS, NOW_MS)).toBeCloseTo(0.25, 12)
    expect(faceDamping(null, NOW_MS)).toBe(0.25)
    // An interaction stamped after now (clock skew between windows) counts as just now.
    expect(faceDamping(NOW_MS + MINUTE_MS, NOW_MS)).toBe(1)
  })
})

describe('faceBaselineOf', () => {
  it('returns all-zero offsets when the mood equals the resting disposition', () => {
    for (const lastInteractionAtMs of [NOW_MS, NOW_MS - 30 * MINUTE_MS, null]) {
      const baseline = faceBaselineOf(readingOf(RESTING, lastInteractionAtMs), NOW_MS)
      expect(baseline).toEqual(NEUTRAL_FACE_BASELINE)
      for (const value of Object.values(baseline))
        expect(Object.is(value, 0)).toBe(true)
    }
  })

  it('returns the exact neutral baseline for the reading of a resting card', () => {
    const ctx = { nowMs: NOW_MS, logicalDayKeyOf: (ms: number) => new Date(ms).toISOString().slice(0, 10), logicalDayStartOf: (ms: number) => Math.floor(ms / 86_400_000) * 86_400_000 }
    const reading = readCharacter({ ...initialCharacterState('card', DEFAULT_CHARACTER_PROFILE, ctx), lastInteractionAtMs: NOW_MS }, DEFAULT_CHARACTER_PROFILE, null, ctx)
    // Engines differ in the last ulp of `tanh(atanh(x))`, so also check a mood a few ulps off its resting value.
    const ulpsOff = { ...reading, mood: { valence: 0.10000000000000002, energy: 1e-17, tension: 0.15000000000000002 } }
    for (const candidate of [reading, ulpsOff]) {
      for (const value of Object.values(faceBaselineOf(candidate, NOW_MS)))
        expect(Object.is(value, 0)).toBe(true)
    }
  })

  it('returns the neutral baseline without a reading or with a non-finite time', () => {
    expect(faceBaselineOf(null, NOW_MS)).toEqual(NEUTRAL_FACE_BASELINE)
    expect(faceBaselineOf(readingOf({ valence: -0.5, energy: -0.5, tension: 0.6 }), Number.NaN)).toEqual(NEUTRAL_FACE_BASELINE)
  })

  it('maps a low, tired, tense mood to a lower mouth, narrower eyes, more blinks, and a worried brow', () => {
    const mood = { valence: -0.3, energy: -0.4, tension: 0.45 }
    const baseline = faceBaselineOf(readingOf(mood), NOW_MS)
    expect(baseline.mouthForm).toBeCloseTo(0.35 * (mood.valence - RESTING.valence), 12)
    expect(baseline.eyeOpen).toBeCloseTo(0.15 * (mood.energy - RESTING.energy), 12)
    expect(baseline.blinkRateOffset).toBeCloseTo(-0.25 * (mood.energy - RESTING.energy), 12)
    expect(baseline.browAngle).toBeCloseTo(0.4 * (mood.tension - RESTING.tension), 12)
    expect(baseline.mouthForm).toBeLessThan(0)
    expect(baseline.eyeOpen).toBeLessThan(0)
    expect(baseline.blinkRateOffset).toBeGreaterThan(0)
    expect(baseline.browAngle).toBeGreaterThan(0)
  })

  it('weakens toward a quarter strength long after the last interaction', () => {
    const mood = { valence: 0.6, energy: 0.5, tension: 0.1 }
    const fresh = faceBaselineOf(readingOf(mood, NOW_MS), NOW_MS)
    const stale = faceBaselineOf(readingOf(mood, NOW_MS - 12 * 60 * MINUTE_MS), NOW_MS)
    expect(stale.mouthForm).toBeCloseTo(fresh.mouthForm * 0.25, 9)
    expect(stale.mouthForm).toBeGreaterThan(0)
  })

  it('keeps every offset within its channel clamp for 200 seeded moods', () => {
    const extremes: MoodAxes[] = [{ valence: -1, energy: -1, tension: 1 }, { valence: 1, energy: 1, tension: 0 }]
    const moods = [...extremes, ...SEEDS.map((seed) => {
      const [a, s1] = nextRandom(seedRng(seed))
      const [b, s2] = nextRandom(s1)
      const [c] = nextRandom(s2)
      return { valence: a * 2 - 1, energy: b * 2 - 1, tension: c }
    })]
    for (const mood of moods) {
      const baseline = faceBaselineOf({ mood, resting: { valence: -mood.valence, energy: -mood.energy, tension: 1 - mood.tension }, lastInteractionAtMs: NOW_MS }, NOW_MS)
      expect(Math.abs(baseline.mouthForm)).toBeLessThanOrEqual(0.7)
      expect(Math.abs(baseline.eyeOpen)).toBeLessThanOrEqual(0.35)
      expect(Math.abs(baseline.blinkRateOffset)).toBeLessThanOrEqual(0.4)
      expect(Math.abs(baseline.browAngle)).toBeLessThanOrEqual(0.7)
    }
    const extreme = faceBaselineOf({ mood: extremes[0], resting: extremes[1], lastInteractionAtMs: NOW_MS }, NOW_MS)
    expect(extreme).toEqual({ mouthForm: -0.7, eyeOpen: -0.3, blinkRateOffset: 0.4, browAngle: 0.4 })
  })
})
