import { describe, expect, it } from 'vitest'

import { FilteredOu, minJerk, softLimit } from './processes'
import { createRandomStream, deriveSeed, truncatedLognormal } from './random'

describe('natural motion processes', () => {
  it('replays equal seeds and separates derived layer streams', () => {
    const a = createRandomStream(42)
    const b = createRandomStream(42)
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b))
    expect(deriveSeed(42, 0)).not.toBe(deriveSeed(42, 1))
  })

  it('keeps the filtered OU stationary SD at its target', () => {
    const ou = new FilteredOu(createRandomStream(1), 0.012, 0.2, 0.07)
    const values: number[] = []
    for (let step = 0; step < 120 * 600; step++)
      values.push(ou.step(1 / 120))
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const sd = Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
    expect(sd).toBeGreaterThan(0.012 * 0.9)
    expect(sd).toBeLessThan(0.012 * 1.1)
  })

  it('bounds truncated lognormal draws', () => {
    const random = createRandomStream(2)
    for (let draw = 0; draw < 1000; draw++) {
      const value = truncatedLognormal(random, 0.22, 0.7, 0.025, 0.75)
      expect(value).toBeGreaterThanOrEqual(0.025)
      expect(value).toBeLessThanOrEqual(0.75)
    }
  })

  it('shapes min-jerk transitions and soft limits', () => {
    expect(minJerk(0)).toBe(0)
    expect(minJerk(0.5)).toBeCloseTo(0.5, 12)
    expect(minJerk(1)).toBe(1)
    expect(softLimit(0.5)).toBe(0.5)
    expect(softLimit(-3)).toBeGreaterThan(-1)
    expect(softLimit(0.9)).toBeLessThan(0.9)
  })
})
