import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { describe, expect, it } from 'vitest'

import { kolmogorovCdf, ksStatisticUniform, ksTestUniform } from './ks'

describe('kolmogorovCdf', () => {
  it('matches the worked example of Marsaglia, Tsang and Wang (2003)', () => {
    expect(kolmogorovCdf(10, 0.274)).toBeCloseTo(0.6284796154565043, 12)
  })

  it('matches the closed forms for one sample and for d = 1/n', () => {
    // n = 1: D = max(x, 1 - x), so P(D < d) = 2d - 1 for d in [1/2, 1].
    expect(kolmogorovCdf(1, 0.8)).toBeCloseTo(0.6, 12)
    // For 1/(2n) <= d <= 1/n, P(D < d) = n! (2d - 1/n)^n.
    expect(kolmogorovCdf(3, 1 / 3)).toBeCloseTo(6 / 27, 12)
    expect(kolmogorovCdf(4, 0.2)).toBeCloseTo(24 * (0.4 - 0.25) ** 4, 12)
  })

  it('is 0 at d = 0, 1 at d = 1, and monotone in d', () => {
    expect(kolmogorovCdf(50, 0)).toBe(0)
    expect(kolmogorovCdf(50, 1)).toBe(1)
    const values = [0.05, 0.1, 0.15, 0.2, 0.3].map(d => kolmogorovCdf(50, d))
    expect(values).toEqual([...values].sort((a, b) => a - b))
  })

  it('stays finite for large samples', () => {
    const value = kolmogorovCdf(5000, 0.015)
    expect(Number.isFinite(value)).toBe(true)
    // Asymptotic Kolmogorov distribution at sqrt(n) d = 1.0607: 1 - 2 sum (-1)^(k-1) exp(-2 k^2 x^2), about 0.789.
    expect(value).toBeCloseTo(0.789, 2)
  })
})

describe('ksTestUniform', () => {
  it('computes the two-sided statistic of a known sample', () => {
    // D+ = max(1/3 - 0.1, 2/3 - 0.4, 1 - 0.7) = 0.3; D- = max(0.1, 0.4 - 1/3, 0.7 - 2/3) = 0.1.
    expect(ksStatisticUniform([0.7, 0.1, 0.4])).toBeCloseTo(0.3, 12)
  })

  it('accepts seeded uniform values and rejects values bunched near zero', () => {
    const random = createRandomStream(11)
    const uniform = Array.from({ length: 400 }, () => random())
    expect(ksTestUniform(uniform).p).toBeGreaterThan(0.01)
    const bunched = uniform.map(value => value ** 2)
    expect(ksTestUniform(bunched).p).toBeLessThan(1e-6)
  })

  it('throws on an empty sample', () => {
    expect(() => ksTestUniform([])).toThrow(/at least one value/)
  })
})
