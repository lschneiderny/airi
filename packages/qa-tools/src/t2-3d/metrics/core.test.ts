import { describe, expect, it } from 'vitest'

import { CORE } from './bones'
import { coreMetrics } from './core'
import { multiply, yawQuat } from './math'
import { prepareTrace } from './prepare'
import { analyticTrace, angleX, detectors } from './test-trace'

const parameters = detectors(CORE)
function chain(hz = 60) {
  return analyticTrace({
    seconds: 25,
    hz,
    bones: CORE,
    world: (b, t) => angleX((CORE.findIndex(name => name === b) + 1) * 0.02 * Math.sin(2 * Math.PI * 0.7 * t)),
  })
}

describe('motion trace core metrics', () => {
  it('reads a known world angular rate on the known axis', () => {
    const p = prepareTrace(analyticTrace({ seconds: 3, bones: ['hips', 'head'], world: (b, t) => angleX(b === 'head' ? 0.4 * t : 0) }))
    for (const v of p.worldVelocity.head ?? []) {
      expect(v[0]).toBeCloseTo(0.4, 4)
      expect(v[1]).toBe(0)
      expect(v[2]).toBe(0)
    }
  })

  it('cancels a constant right rest factor in world angular velocity', () => {
    const a = prepareTrace(analyticTrace({ seconds: 3, bones: ['hips', 'head'], world: (b, t) => angleX(b === 'head' ? 0.3 * Math.sin(t) : 0) }))
    const b = prepareTrace(analyticTrace({ seconds: 3, bones: ['hips', 'head'], world: (b, t) => multiply(angleX(b === 'head' ? 0.3 * Math.sin(t) : 0), yawQuat(0.7)) }))
    expect(Math.max(...(a.o6.head ?? []).flatMap((v, i) => v.map((x, j) => Math.abs(x - (b.o6.head?.[i][j] ?? 0)))))).toBeLessThan(1e-6)
  })

  it('detects in-phase chains and a single effective dimension', () => {
    const metrics = coreMetrics(prepareTrace(chain()), parameters)
    for (const m of metrics.filter(m => m.id.startsWith('chain.'))) {
      expect(m.status, m.id).toBe('ok')
      expect(m.value, m.id)[m.id.endsWith('zeroLagCorr') ? 'toBeGreaterThanOrEqual' : 'toBeLessThan'](m.id.endsWith('zeroLagCorr') ? 0.999 : 1)
    }
    expect(metrics.find(m => m.id === 'dim.upper')?.value).toBeLessThanOrEqual(1.05)
    expect(metrics.find(m => m.id === 'dim.core')?.value).toBeLessThanOrEqual(1.05)
    for (const m of metrics.filter(m => m.id.startsWith('bilateral.')))
      expect(m.value, m.id).toBeGreaterThanOrEqual(0.999)
  })

  it('reports a positive 100 ms lag when a distal joint follows', () => {
    const p = prepareTrace(analyticTrace({ seconds: 30, bones: ['hips', 'neck', 'head'], world: (b, t) => angleX(b === 'hips' ? 0 : 0.2 * Math.sin(2 * Math.PI * 0.7 * t) + (b === 'head' ? 0.15 * Math.sin(2 * Math.PI * 0.7 * (t - 0.1)) : 0)) }))
    const m = coreMetrics(p, detectors(p.input.trace.rig.bones)).find(m => m.id === 'chain.neck-head.lagMs')
    expect(m?.value).toBeCloseTo(100, -1)
    expect(m?.detail).toContain('signed lag')
    expect(Number(m?.detail.match(/signed lag ([\d.-]+)/)?.[1])).toBeGreaterThan(90)
  })

  it('returns zero coverage and undefined chain metrics for frozen motion', () => {
    const m = coreMetrics(prepareTrace(analyticTrace({ seconds: 20, bones: CORE })), parameters)
    expect(m.find(v => v.id === 'coverage.core')?.value).toBe(0)
    expect(m.filter(v => v.id.startsWith('chain.')).every(v => v.status === 'undefined: no-motion')).toBe(true)
  })
})
