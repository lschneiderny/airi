import { describe, expect, it } from 'vitest'

import { median, mulberry32, signFlipNoiseFloor } from './compare-stats'

describe('signFlipNoiseFloor', () => {
  it('does not depend on the generator for up to fourteen differences', () => {
    const differences = [3.6, 4.35, 3.85, 4.25, 3.55, 4.45, 3.7, 4.3, -0.4, 4.1, 3.95, 4.6, 3.8, 4.05]

    for (const count of [3, 8, 14]) {
      const floors = [1, 2, 3].map(seed => signFlipNoiseFloor(differences.slice(0, count), mulberry32(seed)))
      expect(new Set(floors).size).toBe(1)
    }
  })

  it('falls below the median of eight same-sign differences with distinct magnitudes, and not of seven', () => {
    const eight = [3.6, 4.35, 3.85, 4.25, 3.55, 4.45, 3.7, 4.3]
    const seven = eight.slice(0, 7)

    expect(signFlipNoiseFloor(eight, mulberry32(1))).toBeLessThan(median(eight))
    expect(signFlipNoiseFloor(seven, mulberry32(1))).toBeGreaterThanOrEqual(median(seven))
  })
})
