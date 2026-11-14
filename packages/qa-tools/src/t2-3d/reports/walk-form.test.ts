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
/** Seven 90 degree turns in place, then the 180 degree turn-around: [start, degrees, seconds]. */
const TURNS: readonly (readonly [number, number, number])[] = [[31, 90, 1], [34, -90, 1], [37, 90, 1], [40, -90, 1], [43, 90, 1], [46, -90, 1], [49, 90, 1], [52, 180, 2]]

interface Walk {
  /** Heel-strike and toe-off pitch of each foot, degrees; a flat foot is 0. */
  readonly roll?: { readonly left: readonly [number, number], readonly right: readonly [number, number] }
  /** The forearm's swing delay behind the upper arm, seconds (negative leads). */
  readonly forearmLag?: number
  /** How far the head's yaw runs ahead of the root's in each turn, seconds (negative is late). */
  readonly headLead?: readonly number[]
  readonly skate?: { readonly ankle: number, readonly contact: number | null }
  readonly scenario?: 'walk' | 'talk'
  readonly walkSeconds?: number
  readonly turns?: readonly (readonly [number, number, number])[]
  /** The product's mode channel reads `turning` during the turns; false leaves it at walking, as a mislabelled turn. */
  readonly turnsInModeChannel?: boolean
  /** The pelvis twists this many degrees each way at the stride frequency while walking, carried into the trace's root yaw. */
  readonly twistDeg?: number
  /** The foot's roll runs this many seconds behind the leg swing, so it peaks after the step's displacement peak. */
  readonly rollDelay?: number
  /** The last seconds of walking close up: the legs swing a tenth as far and the feet stay flat. */
  readonly closing?: number
}

/**
 * Walking forward at 1 L/s with legs and arms swinging at 0.9 strides per second, then turns in place. Limb rest offsets
 * point down, so a segment's sagittal angle is its swing angle.
 */
function walk(options: Walk = {}) {
  const roll = options.roll ?? { left: [14, -32], right: [14, -32] }
  const walkSeconds = options.walkSeconds ?? 30
  const turns = options.turns ?? TURNS
  const phase = (t: number) => 2 * Math.PI * STRIDE_HZ * Math.min(t, walkSeconds)
  const turnYaw = (t: number) => turns.reduce((sum, [start, degrees, seconds]) => sum + degrees * DEG * Math.min(1, Math.max(0, (t - start) / seconds)), 0)
  const turning = (t: number) => turns.some(([start, , seconds]) => t >= start && t < start + seconds)
  const mode = (t: number) => t < walkSeconds ? 3 : turning(t) ? ((options.turnsInModeChannel ?? true) ? 1 : 3) : 0
  const closing = (t: number) => t >= walkSeconds - (options.closing ?? 0) && t < walkSeconds
  const footPitch = (side: 'left' | 'right', t: number) => {
    const s = (side === 'left' ? 1 : -1) * Math.sin(phase(t - (options.rollDelay ?? 0)))
    const [heel, toe] = roll[side]
    return t < walkSeconds && !closing(t) ? (heel + toe) / 2 + (heel - toe) / 2 * s : 0
  }
  const swing = (t: number) => closing(t) ? 0.1 : 1
  const twist = (t: number) => t < walkSeconds ? (options.twistDeg ?? 0) * DEG * Math.sin(phase(t)) : 0
  const leadAt = (t: number) => {
    const turn = turns.findIndex(([start]) => t >= start - 0.5 && t < start + 1.5)
    return turn < 0 ? 0 : (options.headLead ?? turns.map(() => 0.15))[turn]
  }
  const world = (bone: MotionTraceBone, t: number): Quat => {
    const yaw = rotY(turnYaw(t))
    const side = bone.startsWith('left') ? 1 : -1
    if (bone === 'hips')
      return rotY(turnYaw(t) + twist(t))
    if (bone === 'head')
      return rotY(turnYaw(t + leadAt(t)))
    if (bone.endsWith('UpperLeg') || bone.endsWith('LowerLeg'))
      return multiply(yaw, rotX(-0.4 * side * swing(t) * Math.sin(phase(t))))
    if (bone.endsWith('Foot'))
      return multiply(yaw, rotX(-footPitch(bone.startsWith('left') ? 'left' : 'right', t) * DEG))
    if (bone.endsWith('UpperArm'))
      return multiply(yaw, rotX(0.3 * side * Math.sin(phase(t))))
    if (bone.endsWith('LowerArm') || bone.endsWith('Hand'))
      return multiply(yaw, rotX(0.3 * side * Math.sin(phase(t - (options.forearmLag ?? 0.06)))))
    return yaw
  }
  const input = analyticTrace({
    seconds: 58,
    bones: BONES,
    scenario: options.scenario ?? 'walk',
    world,
    position: t => [0, 0, Math.min(t, walkSeconds)],
    yaw: t => turnYaw(t) + twist(t),
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
const SCENARIO_PASS = { 'scenario-walking-span': 'PASS', 'scenario-strides': 'PASS', 'scenario-turns': 'PASS', 'scenario-turn-around': 'PASS' } as const

describe('walk-form report', () => {
  it('passes a walk with its scenario cases that rolls on every step and trails the forearm by 60 ms, and prints each turn\'s head lead', () => {
    const report = walkFormReport(walk())
    expect(statuses(report)).toEqual({ ...SCENARIO_PASS, 'roll-every-step': 'PASS', 'skate': 'PASS', 'wrist-lags': 'PASS' })
    expect(report.verdict).toBe('PASS')
    expect(report.detail.turns.map(turn => Math.round(turn.rootDeg / 90))).toEqual([1, -1, 1, -1, 1, -1, 1, 2])
    expect(report.detail.turns.every(turn => (turn.leadMs ?? 0) > 100)).toBe(true)
  })

  it('fails a walk that rolls on alternate steps only', () => {
    expect(statuses(walkFormReport(walk({ roll: { left: [14, -32], right: [0, 0] } })))).toMatchObject({ 'roll-every-step': 'FAIL', 'wrist-lags': 'PASS' })
  })

  it('lists every heel strike and toe-off that fails the roll rule with its time and foot, and none on a walk that rolls', () => {
    const flat = walkFormReport(walk({ roll: { left: [14, -32], right: [0, 0] } })).detail.flatSteps
    expect(flat.length).toBeGreaterThan(0)
    expect(new Set(flat.map(step => step.foot))).toEqual(new Set(['right']))
    expect(new Set(flat.map(step => step.event))).toEqual(new Set(['heel-strike', 'toe-off']))
    expect(flat.every((step, i) => i === 0 || step.t >= flat[i - 1].t)).toBe(true)
    expect(walkFormReport(walk()).detail.flatSteps).toEqual([])
  })

  it('reads each step at its most rolled frame within 133 ms: a roll 100 ms behind the swing passes, one 300 ms behind fails', () => {
    const late = (rollDelay: number) => statuses(walkFormReport(walk({ roll: { left: [6.5, -10], right: [6.5, -10] }, rollDelay })))['roll-every-step']
    expect(late(0.1)).toBe('PASS')
    expect(late(0.3)).toBe('FAIL')
  })

  it('does not judge the short, flat closing steps of a walk and lists them, while a full step held flat still fails', () => {
    const report = walkFormReport(walk({ closing: 1.5 }))
    expect(statuses(report)['roll-every-step']).toBe('PASS')
    expect(report.detail.shortSteps.length).toBeGreaterThan(0)
    expect(report.detail.shortSteps.every(step => step.t >= 28.4 && step.t < 30)).toBe(true)
    expect(statuses(walkFormReport(walk({ closing: 1.5, roll: { left: [14, -32], right: [0, 0] } })))['roll-every-step']).toBe('FAIL')
  })

  it('fails a forearm that leads the upper arm by 50 ms', () => {
    expect(statuses(walkFormReport(walk({ forearmLag: -0.05 })))).toMatchObject({ 'roll-every-step': 'PASS', 'wrist-lags': 'FAIL' })
  })

  it('reports a late head without judging it', () => {
    const report = walkFormReport(walk({ headLead: TURNS.map((_, i) => i === 1 ? -0.1 : 0.15) }))
    expect(report.verdict).toBe('PASS')
    expect(report.detail.turns.map(turn => (turn.leadMs ?? 0) > 0)).toEqual([true, false, true, true, true, true, true, true])
  })

  it('reads the scenario as not exercised without a turn-around, with fewer than 8 turns, or with a walking span under 20 s', () => {
    expect(statuses(walkFormReport(walk({ turns: TURNS.slice(0, 7) })))).toMatchObject({ 'scenario-turns': 'NOT-EXERCISED', 'scenario-turn-around': 'NOT-EXERCISED' })
    expect(statuses(walkFormReport(walk({ turns: [...TURNS.slice(0, 7), [52, 120, 2]] })))).toMatchObject({ 'scenario-turns': 'PASS', 'scenario-turn-around': 'NOT-EXERCISED' })
    const short = walkFormReport(walk({ walkSeconds: 18 }))
    expect(statuses(short)['scenario-walking-span']).toBe('NOT-EXERCISED')
    expect(short.verdict).toBe('FAIL')
  })

  it('finds the turns in the root yaw, also when the mode channel does not label them', () => {
    const report = walkFormReport(walk({ turnsInModeChannel: false }))
    expect(statuses(report)).toMatchObject(SCENARIO_PASS)
    expect(report.detail.turns).toHaveLength(8)
  })

  it('t1, t3: finds the eight turns in the travel heading under a 6 or 16 degree pelvis twist per stride', () => {
    for (const twistDeg of [6, 16]) {
      const report = walkFormReport(walk({ twistDeg }))
      expect(statuses(report)).toMatchObject(SCENARIO_PASS)
      expect(report.detail.turns.map(turn => Math.round(turn.rootDeg / 90))).toEqual([1, -1, 1, -1, 1, -1, 1, 2])
    }
  })

  it('t2: reads seven turns under a 6 degree pelvis twist as not exercised: the twist adds no turn', () => {
    const report = walkFormReport(walk({ twistDeg: 6, turns: TURNS.slice(0, 7) }))
    expect(statuses(report)).toMatchObject({ 'scenario-turns': 'NOT-EXERCISED', 'scenario-turn-around': 'NOT-EXERCISED' })
    expect(report.detail.turns).toHaveLength(7)
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
