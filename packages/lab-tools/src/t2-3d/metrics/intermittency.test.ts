import { describe, expect, it } from 'vitest'

import { detectorQuantities, intermittencyMetrics } from './intermittency'
import { prepareTrace } from './prepare'
import { analyticTrace, angleX } from './test-trace'

describe('body speed statistics', () => {
  it('measures a two-second move in each five-second cycle without counting window edges', () => {
    const p = prepareTrace(analyticTrace({ seconds: 30, bones: ['hips'] }))
    const bodySpeed = p.bodySpeed.map((_, i) => i % 300 >= 60 && i % 300 < 180 ? 2 : 0)
    const m = intermittencyMetrics({ ...p, bodySpeed }, 1)
    expect(m.find(m => m.id === 'inter.speedCv')?.value).toBeCloseTo(Math.sqrt(1.5), 10)
    expect(m.find(m => m.id === 'inter.holdFraction')?.value).toBeCloseTo(0.6, 10)
    expect(m.find(m => m.id === 'inter.movesPerMin')?.value).toBe(12)
    expect(m.find(m => m.id === 'inter.moveDurationCv')?.value).toBe(0)
  })

  it('measures sixty-second activity drift from six ten-second RMS speeds', () => {
    const p = prepareTrace(analyticTrace({ seconds: 60, bones: ['hips'] }))
    const bodySpeed = p.bodySpeed.map((_, i) => 1 + Math.floor(i / 600))
    const m = intermittencyMetrics({ ...p, bodySpeed }, 0.1)
    expect(m.find(m => m.id === 'inter.burstCv')?.value).toBeCloseTo(Math.sqrt(35 / 12) / 3.5, 10)
  })

  it('exports raw clip activity and median speeds without detector scales', () => {
    const p = prepareTrace(analyticTrace({ seconds: 20, bones: ['hips', 'head'], world: (b, t) => angleX(b === 'head' ? t * 0.4 : 0) }))
    const raw = detectorQuantities(p)
    expect(raw.activity.head).toBeCloseTo(0.4, 5)
    expect(raw.medianSpeed.head).toBeCloseTo(0.4, 5)
    expect(raw.medianSpeed.body).toBeCloseTo(0.4 / Math.SQRT2, 5)
    expect(raw.windows.length).toBe(3)
  })
})
