import { describe, expect, it } from 'vitest'

import { fitBand, passesBand, percentile, pooledDistribution } from './bands'

describe('mechanical reference band rules', () => {
  it('interpolates order statistics and adds one median-to-tail margin', () => {
    const band = fitBand(Array.from({ length: 11 }, (_, i) => i + 10), { side: 'two', domain: [null, null], transform: 'none', unit: 'clip' })
    expect(percentile([10, 20], 0.25)).toBe(12.5)
    expect(band).toMatchObject({ n: 11, p5: 10.5, p50: 15, p95: 19.5, lo: 6, hi: 24, status: 'GATED' })
  })

  it('rejects perfect correlation after fitting in Fisher space', () => {
    const values = [...Array.from<number>({ length: 16 }).fill(0.7), ...Array.from<number>({ length: 4 }).fill(0.85)]
    const band = fitBand(values, { side: 'upper', domain: [0, 1], transform: 'fisher-z', unit: 'clip' })
    expect(passesBand(0.9999, band)).toBe(false)
    expect(passesBand(0.9, band)).toBe(true)
  })

  it('reports a bound that reaches its natural limit', () => {
    const band = fitBand([0, 0.2, 0.5, 0.8, 1, 1, 1, 1, 1, 1], { side: 'upper', domain: [0, 1], transform: 'none', unit: 'clip' })
    expect(band).toMatchObject({ status: 'REPORT', detail: 'vacuous band' })
  })

  it('restarts the specified bootstrap seed for each pool', () => {
    const pool = Array.from({ length: 40 }, (_, i) => i + 1)
    const draws = pooledDistribution(pool, false)
    expect(draws).toHaveLength(2000)
    expect(pooledDistribution(pool, false)).toEqual(draws)
    expect(percentile(draws, 0.5)).toBeGreaterThanOrEqual(18)
    expect(percentile(draws, 0.5)).toBeLessThanOrEqual(23)
    expect(new Set(pooledDistribution([0, 1], true))).toContain(0.5)
  })

  it('keeps an undersized clip sample report only', () => {
    expect(fitBand([1, 2, 3], { side: 'lower', domain: [0, null], transform: 'none', unit: 'clip' })).toMatchObject({ status: 'REPORT', n: 3 })
  })
})
