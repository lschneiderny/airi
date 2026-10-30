import { describe, expect, it } from 'vitest'

import { nextRandom, seedRng } from './rng'

describe('checkpointed situation RNG', () => {
  it('normalizes seeds to uint32, including zero and wrapped seeds', () => {
    expect(seedRng(0)).toBe(0)
    expect(seedRng(-1)).toBe(0xFFFFFFFF)
    expect(seedRng(2 ** 32 + 42.9)).toBe(42)
  })

  it('replays the same stream from a serialized checkpoint', () => {
    let state = seedRng(42)
    for (let i = 0; i < 20; i++)
      [, state] = nextRandom(state)

    const checkpoint: number = JSON.parse(JSON.stringify(state))
    expect(nextRandom(checkpoint)).toEqual(nextRandom(state))
    expect(nextRandom(seedRng(42))).toEqual(nextRandom(seedRng(42)))
    // Known Mulberry32 vector pins the algorithm as well as determinism.
    expect(nextRandom(seedRng(1))).toEqual([0.6270739405881613, 0x6D2B79F6])
    expect(nextRandom(seedRng(0xFFFFFFFF))[1]).toBe(0x6D2B79F4)
  })

  it('keeps 10000 seeded tickets in [0, 1) with a mean close to 0.5', () => {
    let state = seedRng(8675309)
    let sum = 0
    for (let i = 0; i < 10_000; i++) {
      const [value, next] = nextRandom(state)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      expect(next).toBe(next >>> 0)
      sum += value
      state = next
    }
    expect(Math.abs(sum / 10_000 - 0.5)).toBeLessThanOrEqual(0.02)
  })
})
