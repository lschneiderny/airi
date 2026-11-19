import { describe, expect, it } from 'vitest'

import { butterworth } from './filter'
import { acfPeak, loopPeak, periodMetrics } from './period'
import { prepareTrace } from './prepare'
import { spectralEstimate } from './spectral'
import { analyticTrace } from './test-trace'

describe('periodicity diagnostics', () => {
  it('detects a 0.19 Hz root sinusoid in every short window and in the long span', () => {
    const p = prepareTrace(analyticTrace({ seconds: 90, bones: ['hips'], position: t => [0, 0, 0.03 * Math.sin(2 * Math.PI * 0.19 * t)] }))
    const metrics = periodMetrics(p)
    const acf = metrics.find(m => m.id === 'period.rootForeAft.acfPeak')
    expect(acf?.samples.length).toBe(17)
    for (const sample of acf?.samples ?? [])
      expect(sample.value).toBeGreaterThanOrEqual(0.999)
    expect(metrics.find(m => m.id === 'period.rootForeAft.loopPeak')?.value).toBeGreaterThanOrEqual(0.85)
  })

  it('does not mistake seeded filtered white noise for a loop', () => {
    let seed = 123456789
    const noise = Array.from({ length: 5400 }, () => {
      seed = Math.imul(1664525, seed) + 1013904223 | 0
      return (seed >>> 0) / 4294967296 - 0.5
    })
    const filtered = butterworth(noise, 6)
    expect(loopPeak(filtered.map(v => [v, 0, 0]))).toBeLessThan(0.3)
  })

  it('reports no motion instead of inventing periodicity for a constant', () => {
    expect(acfPeak(Array.from<number>({ length: 600 }).fill(2))).toBeNull()
    expect(loopPeak(Array.from({ length: 3600 }, () => [2, 0, 0]))).toBeNull()
  })

  it('does not claim the six-second ACF estimator works inside a five-second talk window', () => {
    const p = prepareTrace(analyticTrace({ seconds: 20, bones: ['hips'], scenario: 'talk', speaking: () => 1 }))
    expect(periodMetrics(p).find(m => m.id === 'period.rootForeAft.acfPeak')?.status).toBe('skipped: insufficient-period-window')
  })

  it('concentrates a single spectral line in five bins', () => {
    const signal = Array.from({ length: 3600 }, (_, i) => Math.sin(2 * Math.PI * 0.2 * i / 60))
    const m = spectralEstimate(signal)
    expect(m?.peakShare).toBeGreaterThan(0.999)
    expect(m?.entropy).toBeLessThan(0.3)
  })
})
