import type { DetectorParameters } from './types'

import { describe, expect, it } from 'vitest'

import { prepareTrace } from './prepare'
import { smoothMetrics } from './smooth'
import { analyticTrace, angleY } from './test-trace'

const DEG = Math.PI / 180
const minJerk = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u)
/** A head move segment starts above 1.5 rad/s, so a calm head never makes one. */
const params: DetectorParameters = { floors: {}, moveSpeed: { body: 1, head: 1, trunk: 1, armL: 1, armR: 1, legs: 1 } }

function headLdlj(yaw: (t: number) => number, level: 't2-3d' | 'reference' = 't2-3d') {
  const input = analyticTrace({ seconds: 30, bones: ['hips', 'spine', 'chest', 'neck', 'head'], scenario: 'talk', world: (bone, t) => angleY(bone === 'head' ? yaw(t) : 0) })
  const trace = { ...input, trace: { ...input.trace, source: { ...input.trace.source, level } } }
  return smoothMetrics(prepareTrace(trace), params).find(m => m.id === 'smooth.head.ldlj')
}

describe('unscorable smoothness (gate version 4, lane U revision 2)', () => {
  it('skips a calm head that never starts a move segment but turns within its windows', () => {
    const metric = headLdlj(t => 3 * DEG * Math.sin(2 * Math.PI * 0.3 * t))
    expect(metric).toMatchObject({ value: null, status: 'skipped: insufficient-episodes', samples: [] })
    expect(metric?.detail).toContain('not frozen')
  })

  it('fails a head held still except for one turn, although the turn makes a move segment', () => {
    const metric = headLdlj(t => 40 * DEG * minJerk((t - 15) / 0.5))
    expect(metric?.samples.length).toBeGreaterThan(0)
    expect(metric?.samples.length).toBeLessThan(8)
    expect(metric).toMatchObject({ value: null, status: 'undefined: no-motion' })
  })

  it('fails a still head with an invisible 8 Hz tremor of 0.05 degrees', () => {
    expect(headLdlj(t => 0.05 * DEG * Math.sin(2 * Math.PI * 8 * t))).toMatchObject({ value: null, status: 'undefined: no-motion' })
  })

  it('leaves a reference clip without move segments undefined: the check applies to character traces only', () => {
    expect(headLdlj(t => 3 * DEG * Math.sin(2 * Math.PI * 0.3 * t), 'reference')).toMatchObject({ value: null, status: 'undefined: no-motion' })
  })
})
