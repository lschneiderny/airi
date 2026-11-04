import type { MoodAxes } from '.'

import { describe, expect, it } from 'vitest'

import { nextRandom, seedRng } from '../situation/rng'
import { pointedOf, urgeFactorOf } from './urge'

const SEEDS = Array.from({ length: 200 }, (_, index) => 9_001 + index * 7)

function randomMood(seed: number): MoodAxes {
  const [a, s1] = nextRandom(seedRng(seed))
  const [b, s2] = nextRandom(s1)
  const [c] = nextRandom(s2)
  return { valence: a * 2 - 1, energy: b * 2 - 1, tension: c }
}

describe('urgeFactorOf', () => {
  it('matches the appendix examples', () => {
    expect(Math.abs(urgeFactorOf({ valence: 0.4, energy: 0.2, tension: 0.1 }) - 1.185)).toBeLessThanOrEqual(0.001)
    expect(Math.abs(urgeFactorOf({ valence: -0.4, energy: -0.1, tension: 0.5 }) - 0.823)).toBeLessThanOrEqual(0.001)
  })

  it('is 1 at a neutral mood and ignores tension up to the floor', () => {
    expect(urgeFactorOf({ valence: 0, energy: 0, tension: 0 })).toBe(1)
    expect(urgeFactorOf({ valence: 0, energy: 0, tension: 0.3 })).toBe(1)
    expect(urgeFactorOf({ valence: 0, energy: 0, tension: 0.6 })).toBeLessThan(1)
  })

  it('stays within [e^-0.4, e^0.3] for 200 seeded moods and at the corners', () => {
    const corners: MoodAxes[] = [{ valence: 1, energy: 1, tension: 0 }, { valence: -1, energy: -1, tension: 1 }]
    for (const mood of [...SEEDS.map(randomMood), ...corners]) {
      const factor = urgeFactorOf(mood)
      expect(factor).toBeGreaterThanOrEqual(Math.exp(-0.4))
      expect(factor).toBeLessThanOrEqual(Math.exp(0.3))
    }
    expect(urgeFactorOf(corners[0])).toBe(Math.exp(0.3))
    expect(urgeFactorOf(corners[1])).toBe(Math.exp(-0.4))
  })
})

describe('pointedOf', () => {
  const hurt: MoodAxes = { valence: -0.3, energy: -0.1, tension: 0.4 }

  it('is pointed only when low, tense, and an unanswered reach-out is shown', () => {
    expect(pointedOf(hurt, ['reach-out-unanswered'])).toBe(true)
    expect(pointedOf({ ...hurt, valence: -0.2, tension: 0.35 }, ['touch', 'reach-out-unanswered'])).toBe(true)
    expect(pointedOf(hurt, ['touch', 'significant'])).toBe(false)
    expect(pointedOf({ ...hurt, valence: -0.19 }, ['reach-out-unanswered'])).toBe(false)
    expect(pointedOf({ ...hurt, tension: 0.34 }, ['reach-out-unanswered'])).toBe(false)
  })
})
