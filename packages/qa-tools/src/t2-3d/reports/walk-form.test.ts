import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat } from '../metrics'

import { describe, expect, it } from 'vitest'

import { multiply } from '../metrics/math'
import { analyticTrace } from '../metrics/test-trace'
import { ReportUsageError } from './report'
import { loadedRun, rotX, rotY, summaryStub, TEST_BONES } from './test-runs'
import { walkFormReport } from './walk-form'

const BONES: readonly MotionTraceBone[] = [...TEST_BONES, 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']
const LIMBS = /UpperArm|LowerArm|Hand|UpperLeg|LowerLeg|Foot/
const DEG = Math.PI / 180
const STRIDE_HZ = 0.9
const WALK_SECONDS = 30
const TURNS = [32, 36] as const

interface Walk {
  /** Heel-strike and toe-off pitch of each foot, degrees; a flat foot is 0. */
  readonly roll?: { readonly left: readonly [number, number], readonly right: readonly [number, number] }
  /** The forearm's swing delay behind the upper arm, seconds (negative leads). */
  readonly forearmLag?: number
  /** How far the head's yaw runs ahead of the root's in each turn, seconds (negative is late). */
  readonly headLead?: readonly number[]
  readonly skate?: { readonly ankle: number, readonly contact: number | null }
  readonly scenario?: 'walk' | 'talk'
}

/**
 * Thirty seconds of walking forward at 1 L/s with legs and arms swinging at 0.9 strides per second, then two 90 degree
 * turns in place. Limb rest offsets point down, so a segment's sagittal angle is its swing angle.
 */
function walk(options: Walk = {}) {
  const roll = options.roll ?? { left: [14, -32], right: [14, -32] }
  const phase = (t: number) => 2 * Math.PI * STRIDE_HZ * Math.min(t, WALK_SECONDS)
  const turnYaw = (t: number) => TURNS.reduce((sum, start) => sum + 90 * DEG * Math.min(1, Math.max(0, t - start)), 0)
  const mode = (t: number) => t < WALK_SECONDS ? 3 : TURNS.some(start => t >= start && t < start + 1) ? 1 : 0
  const footPitch = (side: 'left' | 'right', t: number) => {
    const s = (side === 'left' ? 1 : -1) * Math.sin(phase(t))
    const [heel, toe] = roll[side]
    return t < WALK_SECONDS ? (heel + toe) / 2 + (heel - toe) / 2 * s : 0
  }
  const leadAt = (t: number) => {
    const turn = TURNS.findIndex(start => t >= start - 1 && t < start + 2.5)
    return turn < 0 ? 0 : (options.headLead ?? [0.15, 0.15])[turn]
  }
  const world = (bone: MotionTraceBone, t: number): Quat => {
    const yaw = rotY(turnYaw(t))
    const side = bone.startsWith('left') ? 1 : -1
    if (bone === 'head')
      return rotY(turnYaw(t + leadAt(t)))
    if (bone.endsWith('UpperLeg') || bone.endsWith('LowerLeg'))
      return multiply(yaw, rotX(-0.4 * side * Math.sin(phase(t))))
    if (bone.endsWith('Foot'))
      return multiply(yaw, rotX(-footPitch(bone.startsWith('left') ? 'left' : 'right', t) * DEG))
    if (bone.endsWith('UpperArm'))
      return multiply(yaw, rotX(0.3 * side * Math.sin(phase(t))))
    if (bone.endsWith('LowerArm') || bone.endsWith('Hand'))
      return multiply(yaw, rotX(0.3 * side * Math.sin(phase(t - (options.forearmLag ?? 0.06)))))
    return yaw
  }
  const input = analyticTrace({
    seconds: 42,
    bones: BONES,
    scenario: options.scenario ?? 'walk',
    world,
    position: t => [0, 0, Math.min(t, WALK_SECONDS)],
    yaw: turnYaw,
    mode,
  })
  input.trace.rig.restOffsets = input.trace.rig.bones.map(bone => LIMBS.test(bone) ? [0, -0.1, 0] : [0, 0.1, 0])
  const skate = options.skate ?? { ankle: 0.3, contact: 0.001 }
  const rows = Array.from({ length: input.trace.frames }, (_, i) => {
    const t = i / 60
    const name = ['idle', 'turning', 'starting', 'walking', 'stopping'][mode(t)]
    return skate.contact === null ? [i * 1000 / 60, name, skate.ankle, 0.001] : [i * 1000 / 60, name, skate.ankle, 0.001, skate.contact]
  })
  const columns = skate.contact === null ? ['t_ms', 'mode', 'skate', 'feetMaxError'] : ['t_ms', 'mode', 'skate', 'feetMaxError', 'skateContact']
  return loadedRun(input, summaryStub(input, { perFrameSeries: { columns, rows } }), null)
}

const statuses = (report: ReturnType<typeof walkFormReport>) => Object.fromEntries(report.requirements.map(r => [r.id, r.status]))

describe('walk-form report', () => {
  it('passes a walk that rolls on every step, trails the forearm by 60 ms and leads each turn with the head by 150 ms', () => {
    const report = walkFormReport(walk())
    expect(statuses(report)).toEqual({ 'roll-every-step': 'PASS', 'skate': 'PASS', 'wrist-lags': 'PASS', 'head-leads-turns': 'PASS' })
  })

  it('fails a walk that rolls on alternate steps only', () => {
    expect(statuses(walkFormReport(walk({ roll: { left: [14, -32], right: [0, 0] } })))).toMatchObject({ 'roll-every-step': 'FAIL', 'wrist-lags': 'PASS', 'head-leads-turns': 'PASS' })
  })

  it('fails a forearm that leads the upper arm by 50 ms', () => {
    expect(statuses(walkFormReport(walk({ forearmLag: -0.05 })))).toMatchObject({ 'roll-every-step': 'PASS', 'wrist-lags': 'FAIL', 'head-leads-turns': 'PASS' })
  })

  it('fails when one turn of two has the head 100 ms late', () => {
    const report = walkFormReport(walk({ headLead: [0.15, -0.1] }))
    expect(statuses(report)).toMatchObject({ 'roll-every-step': 'PASS', 'wrist-lags': 'PASS', 'head-leads-turns': 'FAIL' })
    expect(report.detail.turns.map(turn => (turn.leadMs ?? 0) > 0)).toEqual([true, false])
  })

  it('judges the contact-point skate when the summary has it, and the ankle skate otherwise', () => {
    expect(statuses(walkFormReport(walk({ skate: { ankle: 0.3, contact: 0.001 } }))).skate).toBe('PASS')
    expect(statuses(walkFormReport(walk({ skate: { ankle: 0.001, contact: 0.08 } }))).skate).toBe('FAIL')
    expect(statuses(walkFormReport(walk({ skate: { ankle: 0.3, contact: null } }))).skate).toBe('FAIL')
  })

  it('refuses a run that is not walk-class', () => {
    expect(() => walkFormReport(walk({ scenario: 'talk' }))).toThrow(ReportUsageError)
  })
})
