import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DetectorParameters } from './types'

import { describe, expect, it } from 'vitest'

import { prepareTrace } from './prepare'
import { smoothMetrics } from './smooth'
import { analyticTrace, angleY } from './test-trace'

const DEG = Math.PI / 180
const minJerk = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u)
/** A head move segment starts above 1.5 rad/s, so a calm head never makes one. */
const params: DetectorParameters = { floors: {}, moveSpeed: { body: 1, head: 1, trunk: 1, armL: 1, armR: 1, legs: 1 } }
/** Chisa-like rest offsets: the eyes are the highest bone (17.96 units), so a degree of head yaw moves the eyes 0.2 DIP. */
const OFFSETS: Readonly<Partial<Record<MotionTraceBone, [number, number, number]>>> = { hips: [0, 11.9, 0], spine: [0, 0, 0], chest: [0, 2.5, 0], neck: [0, 2.2, -0.8], head: [0, 0.94, 0.3], leftEye: [0.36, 0.42, 0.37], rightEye: [-0.36, 0.42, 0.37] }
const BONES: readonly MotionTraceBone[] = ['hips', 'spine', 'chest', 'neck', 'head', 'leftEye', 'rightEye']

function headLdlj(yaw: (t: number) => number, level: 't2-3d' | 'reference' = 't2-3d') {
  const input = analyticTrace({ seconds: 30, bones: BONES, scenario: 'talk', world: (bone, t) => angleY(bone === 'head' || bone.endsWith('Eye') ? yaw(t) : 0) })
  const rig = { ...input.trace.rig, restOffsets: BONES.map((b): [number, number, number] => OFFSETS[b] ?? [0, 0, 0]) }
  const trace = { ...input, trace: { ...input.trace, rig, source: { ...input.trace.source, level } } }
  return smoothMetrics(prepareTrace(trace), params).find(m => m.id === 'smooth.head.ldlj')
}

describe('unscorable smoothness (gate version 4, lane U revision 3)', () => {
  it('skips a calm head that never starts a move segment but moves the face within its windows', () => {
    const metric = headLdlj(t => 10 * DEG * Math.sin(2 * Math.PI * 0.3 * t))
    expect(metric).toMatchObject({ value: null, status: 'skipped: insufficient-episodes', samples: [] })
    expect(metric?.detail).toContain('not frozen')
  })

  it('fails a head held still except for one turn, although the turn makes a move segment', () => {
    const metric = headLdlj(t => 40 * DEG * minJerk((t - 15) / 0.5))
    expect(metric?.samples.length).toBeGreaterThan(0)
    expect(metric?.samples.length).toBeLessThan(8)
    expect(metric).toMatchObject({ value: null, status: 'undefined: no-motion' })
  })

  it.each([0.05, 1.7])('fails a still head whose 8 Hz tremor of %s degrees moves the face less than one pixel', (degrees) => {
    expect(headLdlj(t => degrees * DEG * Math.sin(2 * Math.PI * 8 * t))).toMatchObject({ value: null, status: 'undefined: no-motion' })
  })

  it('leaves a reference clip without move segments undefined: the check applies to character traces only', () => {
    expect(headLdlj(t => 10 * DEG * Math.sin(2 * Math.PI * 0.3 * t), 'reference')).toMatchObject({ value: null, status: 'undefined: no-motion' })
  })
})
