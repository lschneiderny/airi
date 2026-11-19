import { describe, expect, it } from 'vitest'

import { CORE } from './bones'
import { measureTrace } from './index'
import { analyticTrace, angleX, detectors } from './test-trace'

const params = detectors(CORE)
function motion(hz: number) {
  return analyticTrace({
    seconds: 22,
    hz,
    bones: CORE,
    world: (b, t) => angleX((1 + CORE.findIndex(name => name === b)) * 0.015 * (Math.sin(2 * Math.PI * 0.4 * t) + 0.3 * Math.sin(2 * Math.PI * 0.9 * t))),
  })
}

describe('metric reproducibility', () => {
  it('keeps all core measurements within five percent across 30, 60 and 120 Hz sampling', () => {
    const baseline = measureTrace(motion(60), params).filter(m => !m.id.startsWith('idle.'))
    for (const hz of [30, 120]) {
      const actual = measureTrace(motion(hz), params)
      for (const expected of baseline) {
        const m = actual.find(m => m.id === expected.id)
        expect(m?.status, `${hz}Hz ${expected.id}`).toBe(expected.status)
        if (expected.value === null) {
          expect(m?.value, expected.id).toBeNull()
        }
        else {
          expect(m?.value, expected.id).not.toBeNull()
          expect(Math.abs((m?.value ?? Infinity) - expected.value), `${hz}Hz ${expected.id}`).toBeLessThanOrEqual(Math.max(1e-5, Math.abs(expected.value) * 0.05))
        }
      }
    }
  })

  it('gives bit-equal measurements for repeated evaluation of the same trace', () => {
    const input = motion(60)
    expect(measureTrace(input, params)).toEqual(measureTrace(input, params))
  })
})
