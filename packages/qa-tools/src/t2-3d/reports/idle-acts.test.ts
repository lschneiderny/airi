import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { BodyActId, BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import type { Quat, Vec3 } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'

import { motionTraceParents } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { describe, expect, it } from 'vitest'

import { multiply, slerp } from '../metrics/math'
import { analyticTrace } from '../metrics/test-trace'
import { idleActsReport } from './idle-acts'
import { ReportUsageError } from './report'
import { loadedRun, TEST_BONES } from './test-runs'

interface Act {
  readonly id: BodyActId
  readonly at: number
  readonly state?: 'finished' | 'cancelled'
  /** The movement played under this marker: its own act's by default, another act's or a partial one, none for a marker without motion. */
  readonly moves?: BodyActId | Movement | null
  /** The drawn amplitude (4e: x1.0 to x1.5); it scales the angles, not the hand positions. */
  readonly scale?: number
}

/**
 * An act's movement: local rotations (bone, axis, degrees, delay in s, oscillation Hz) held over the act, and a hand
 * placed at a point [out, up, forward] in arm lengths from its shoulder joint, with a forearm twist in degrees.
 */
interface Movement {
  readonly parts?: readonly (readonly [MotionTraceBone, 0 | 1 | 2, number, number?, number?])[]
  readonly reach?: { readonly side: 'left' | 'right', readonly at: Vec3, readonly twist?: (t: number) => number }
}

const ACT_SECONDS = 3
/** Each act as architecture 4e draws it, on a rig whose arm length is 1 (REST). */
const MOVEMENTS: Partial<Record<BodyActId, Movement>> = {
  'sigh': { parts: [['chest', 0, 4], ['leftShoulder', 2, 4], ['rightShoulder', 2, -4]] },
  'arm-swing': { parts: [['leftUpperArm', 0, 8, 0, 0.9], ['rightUpperArm', 0, -8, 0, 0.9]] },
  'look-around': { parts: [['neck', 1, 14], ['head', 1, 21]] },
  'hand-inspect': { reach: { side: 'right', at: [-0.10, -0.30, 0.45], twist: () => -60 } },
  'wave': { reach: { side: 'left', at: [0.25, 0.10, 0.30], twist: t => 60 + 18 * Math.sin(2 * Math.PI * 3.2 * t) } },
  'shoulder-roll': { parts: [['leftShoulder', 2, 10], ['rightShoulder', 2, -10], ['head', 2, 12, 0.5]] },
  'yawn': { parts: [['head', 0, -8], ['chest', 0, -3], ['leftShoulder', 2, 5], ['rightShoulder', 2, -5]], reach: { side: 'right', at: [-0.2, 0.15, 0.15] } },
  'peek-chat': { parts: [['spine', 2, 3], ['chest', 2, 2], ['spine', 0, 3], ['chest', 0, 2], ['head', 1, 15]] },
}
/** Rest offsets of the test rig (model units, L = 1, arm length 1), mirrored for the right side. */
const REST: Partial<Record<MotionTraceBone, Vec3>> = {
  spine: [0, 0.1, 0],
  chest: [0, 0.2, 0],
  upperChest: [0, 0.1, 0],
  neck: [0, 0.15, 0],
  head: [0, 0.1, 0],
  leftShoulder: [0.05, 0.1, 0],
  leftUpperArm: [0.15, 0, 0],
  leftLowerArm: [0, -0.5, 0],
  leftHand: [0, -0.5, 0],
  leftUpperLeg: [0.1, -0.05, 0],
  leftLowerLeg: [0, -0.45, 0],
  leftFoot: [0, -0.45, 0],
}
function restOffset(bone: MotionTraceBone): [number, number, number] {
  const left = REST[bone.replace(/^right/, 'left') as MotionTraceBone] ?? [0, 0, 0]
  return [bone.startsWith('right') ? -left[0] : left[0], left[1], left[2]]
}

function fromTo(a: Vec3, b: Vec3): Quat {
  const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const q: Quat = [c[0], c[1], c[2], Math.hypot(...a) * Math.hypot(...b) + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]]
  const n = Math.hypot(...q)
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

/** World orientations of the upper arm and forearm (rest direction straight down) that put the hand at `at`. */
function armTo(side: 'left' | 'right', at: Vec3): readonly [Quat, Quat] {
  const s: Vec3 = [(side === 'left' ? 2 : -2) * at[0], 2 * at[1], 2 * at[2]]
  const half = Math.hypot(...s) / 2
  const along: Vec3 = [s[0] / (2 * half), s[1] / (2 * half), s[2] / (2 * half)]
  const down = -along[1]
  const n0: Vec3 = [-along[0] * down, -1 - along[1] * down, -along[2] * down]
  const n: Vec3 = [n0[0] / Math.hypot(...n0), n0[1] / Math.hypot(...n0), n0[2] / Math.hypot(...n0)]
  const h = Math.sqrt(1 - half * half)
  const u: Vec3 = [s[0] / 2 + h * n[0], s[1] / 2 + h * n[1], s[2] / 2 + h * n[2]]
  const v: Vec3 = [s[0] / 2 - h * n[0], s[1] / 2 - h * n[1], s[2] / 2 - h * n[2]]
  return [fromTo([0, -1, 0], u), fromTo([0, -1, 0], v)]
}

const PARTIAL_HAIR_TUCK: Movement = { parts: [['head', 2, 4]] }
const PARTIAL_HAND_INSPECT: Movement = { parts: [['rightLowerArm', 1, 60]] }
const SIX: readonly Act[] = [
  { id: 'wave', at: 4 },
  { id: 'arm-swing', at: 10 },
  { id: 'hand-inspect', at: 16 },
  { id: 'shoulder-roll', at: 22 },
  { id: 'look-around', at: 28 },
  { id: 'sigh', at: 34 },
]
const RESTING: readonly { t: number, state: BodyRest }[] = [{ t: 20, state: 'rest' }]
const BONES: readonly MotionTraceBone[] = [...TEST_BONES, 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']
const PARENTS = motionTraceParents([...BONES])

const minJerk = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u)
const hold = (u: number) => u <= 0 || u >= 1 ? 0 : u < 0.3 ? minJerk(u / 0.3) : u > 0.7 ? 1 - minJerk((u - 0.7) / 0.3) : 1
function axisAngle(axis: 0 | 1 | 2, degrees: number): Quat {
  const s = Math.sin(degrees * Math.PI / 360)
  return [axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0, Math.cos(degrees * Math.PI / 360)]
}

interface Body {
  readonly acts?: readonly Act[]
  /** Movements without a marker: [act, start time]. */
  readonly unmarked?: readonly [BodyActId | Movement, number][]
  readonly rest?: readonly { t: number, state: BodyRest }[]
  readonly scenario?: 'idle' | 'talk'
  readonly actsSwitch?: 'off'
  readonly gitSha?: string
  /** Root yaw (rad) and hips position (L) of the run; zero by default. */
  readonly yaw?: (t: number) => number
  readonly hips?: (t: number) => Vec3
  /** A rotation applied to a bone's local rotation at t, after every act movement; none by default. */
  readonly extra?: (bone: MotionTraceBone, t: number) => Quat | null
}

/** A standing body with a slow trunk sway; each act's movement bends its key bones and returns, through the hierarchy. */
function trace(body: Body): DecodedMotionTrace {
  const plays = [
    ...(body.acts ?? []).flatMap(act => act.moves === null ? [] : [{ moves: act.moves ?? act.id, at: act.at, scale: act.scale ?? 1 }]),
    ...(body.unmarked ?? []).map(([moves, at]) => ({ moves, at, scale: 1 })),
  ]
  const movement = (moves: BodyActId | Movement): Movement => typeof moves === 'string' ? MOVEMENTS[moves] ?? {} : moves
  const local = (bone: MotionTraceBone, t: number): Quat => {
    const moved = plays.reduce<Quat>((q, play) => (movement(play.moves).parts ?? []).reduce<Quat>((r, [b, axis, deg, delay = 0, hz]) => {
      const w = hold((t - play.at - delay) / ACT_SECONDS) * play.scale
      const angle = hz === undefined ? deg * w : deg * play.scale * Math.sin(2 * Math.PI * hz * (t - play.at)) * Math.min(1, Math.max(0, t - play.at) / 0.15, Math.max(0, play.at + ACT_SECONDS - t) / 0.15)
      return b === bone && (w > 0 || (hz !== undefined && t > play.at && t < play.at + ACT_SECONDS)) ? multiply(r, axisAngle(axis, angle)) : r
    }, q), bone === 'spine' ? axisAngle(1, 1.2 * Math.sin(2 * Math.PI * 0.2 * t)) : [0, 0, 0, 1])
    const extra = body.extra?.(bone, t)
    return extra ? multiply(moved, extra) : moved
  }
  const world = (bone: MotionTraceBone, t: number): Quat => {
    const parent = PARENTS[BONES.indexOf(bone)]
    const posed = parent < 0 ? local(bone, t) : multiply(world(BONES[parent], t), local(bone, t))
    return plays.reduce<Quat>((q, play) => {
      const reach = movement(play.moves).reach
      const w = hold((t - play.at) / ACT_SECONDS) * Math.min(1, play.scale)
      if (!reach || w <= 0 || (bone !== `${reach.side}UpperArm` && bone !== `${reach.side}LowerArm`))
        return q
      const [upper, lower] = armTo(reach.side, reach.at)
      const placed = slerp(q, bone.endsWith('UpperArm') ? upper : lower, w)
      return bone.endsWith('LowerArm') && reach.twist ? multiply(placed, axisAngle(1, reach.twist(t - play.at) * w)) : placed
    }, posed)
  }
  const events: MotionTraceEvent[] = [
    ...(body.acts ?? []).flatMap((act): MotionTraceEvent[] => [
      { t: act.at, kind: 'marker', label: `act:${act.id}:playing` },
      { t: act.at + ACT_SECONDS, kind: 'marker', label: `act:${act.id}:${act.state ?? 'finished'}` },
    ]),
    ...(body.rest ?? []).map((change): MotionTraceEvent => ({ t: change.t, kind: 'marker', label: `rest:${change.state}` })),
  ].sort((a, b) => a.t - b.t)
  const input = analyticTrace({ seconds: 42, bones: BONES, scenario: body.scenario ?? 'idle', events, world, yaw: body.yaw, position: body.hips })
  const detail: Record<string, string> = body.actsSwitch ? { acts: body.actsSwitch } : {}
  const source = { ...input.trace.source, gitSha: body.gitSha ?? 'abc123', detail }
  return { ...input, trace: { ...input.trace, source, rig: { ...input.trace.rig, restOffsets: BONES.map(restOffset) } } }
}

/** The run with its acts, and the acts-off companion of the same seed: the same body without any act. */
function pair(body: Body, companion: Body = {}) {
  return [loadedRun(trace(body), null, null), loadedRun(trace({ actsSwitch: 'off', rest: body.rest, ...companion }), null, null)] as const
}
const report = (body: Body, companion?: Body) => idleActsReport(...pair(body, companion))
const status = (r: ReturnType<typeof idleActsReport>, id: string) => r.requirements.find(q => q.id === id)?.status

describe('idle-acts report', () => {
  it('passes six distinct acts confirmed against the acts-off pair, three of them started while resting from the rest set', () => {
    const r = report({ acts: SIX, rest: RESTING })
    expect(r.requirements.map(q => [q.id, q.status])).toEqual([['distinct-acts', 'PASS'], ['no-repeat', 'PASS'], ['rest-set', 'PASS']])
    expect(r.verdict).toBe('PASS')
  })

  it('confirms no act whose marker has no motion of its own, whatever the idle motion under it', () => {
    const r = report({ acts: SIX.map(act => ({ ...act, moves: null })) })
    expect(status(r, 'distinct-acts')).toBe('FAIL')
    expect(r.detail.acts.every(act => !act.confirmed)).toBe(true)
  })

  it('does not confirm an act at a quarter of its design amplitude', () => {
    const r = report({ acts: SIX.map(act => ({ ...act, scale: 0.25 })) })
    expect(r.detail.acts.filter(act => act.confirmed)).toEqual([])
  })

  it('counts one movement under three overlapping act markers once', () => {
    const r = report({ acts: [...SIX.slice(0, 5), { id: 'sigh', at: 34 }, { id: 'yawn', at: 34.5, moves: null }, { id: 'hair-tuck', at: 35, moves: null }] })
    expect(r.requirements[0].value).toMatch(/^6 distinct/)
    expect(r.detail.acts.filter(act => act.overlaps).map(act => act.id)).toEqual(['yawn', 'hair-tuck'])
  })

  it('fails the same movement played twice in a row under two act ids it confirms', () => {
    const r = report({ acts: [...SIX.slice(0, 4), { id: 'sigh', at: 28, moves: 'yawn' }, { id: 'yawn', at: 34 }] })
    expect(r.detail.acts.slice(4).map(act => act.confirmed)).toEqual([true, true])
    expect(status(r, 'no-repeat')).toBe('FAIL')
  })

  it('does not count a cancelled act', () => {
    const r = report({ acts: SIX.map((act): Act => act.id === 'sigh' ? { ...act, state: 'cancelled' } : act) })
    expect(status(r, 'distinct-acts')).toBe('FAIL')
    expect(r.requirements[0].value).toMatch(/^5 distinct/)
  })

  it('fails an immediate repeat of an id, cancelled acts included', () => {
    const r = report({ acts: [{ id: 'arm-swing', at: 0.5, state: 'cancelled' }, ...SIX.slice(1), { id: 'wave', at: 38 }] })
    expect(status(r, 'no-repeat')).toBe('FAIL')
  })

  it('judges acts started while resting against the rest set it is given, and fails any act while dozing', () => {
    expect(status(idleActsReport(...pair({ acts: SIX, rest: RESTING }), ['sigh', 'yawn']), 'rest-set')).toBe('FAIL')
    expect(status(report({ acts: SIX, rest: [{ t: 20, state: 'doze' }] }), 'rest-set')).toBe('FAIL')
  })

  it('reports the repeat and rest-set rules as not exercised without acts, and fails the run', () => {
    const r = report({})
    expect(r.requirements.map(q => q.status)).toEqual(['FAIL', 'NOT-EXERCISED', 'NOT-EXERCISED'])
    expect(r.verdict).toBe('FAIL')
  })

  it('refuses a pair that differs outside the act spans', () => {
    expect(() => report({ acts: SIX, unmarked: [['arm-swing', 39]] })).toThrow(/outside the act spans/)
  })

  it('confirms an act only with its distinctive phase: a hair tuck that is a head tilt and a hand inspect that is a forearm twist are not', () => {
    const tuck: Act = { id: 'hair-tuck', at: 38, moves: PARTIAL_HAIR_TUCK }
    const r = report({ acts: [...SIX, tuck].map((act): Act => act.id === 'hand-inspect' ? { ...act, moves: PARTIAL_HAND_INSPECT } : act) })
    expect(r.detail.acts.filter(act => !act.confirmed).map(act => act.id)).toEqual(['hand-inspect', 'hair-tuck'])
  })

  it('counts acts by their distinctive form at any drawn amplitude', () => {
    const sizes = [1, 1.25, 1.5]
    expect(report({ acts: SIX.map((act, k) => ({ ...act, scale: sizes[k % 3] })) }).requirements[0].value).toMatch(/^6 distinct/)
    const pairs = (first: Act, second: Act) => status(report({ acts: [{ ...SIX[0], at: 4 }, first, second] }), 'no-repeat')
    expect(pairs({ id: 'sigh', at: 16, scale: 1.4 }, { id: 'yawn', at: 22 })).toBe('PASS')
    expect(pairs({ id: 'hand-inspect', at: 16 }, { id: 'wave', at: 22 })).toBe('PASS')
    expect(pairs({ id: 'yawn', at: 16 }, { id: 'yawn', at: 22, scale: 1.5 })).toBe('FAIL')
    const four = report({ acts: (['yawn', 'shoulder-roll', 'sigh', 'arm-swing', 'yawn', 'shoulder-roll'] as const).map((id, k) => ({ id, at: 4 + 6 * k, scale: [1, 1, 1, 1, 1.25, 1.5][k] })) })
    expect(four.requirements[0].value).toMatch(/^4 distinct/)
  })

  it('counts an act once when its size moves another act\'s key across its bar: the peek at the chat at x1.0 and x1.25', () => {
    const r = report({ acts: (['sigh', 'arm-swing', 'shoulder-roll', 'peek-chat', 'wave', 'peek-chat'] as const).map((id, k) => ({ id, at: 4 + 6 * k, scale: k === 5 ? 1.25 : 1 })) })
    const [small, large] = r.detail.acts.filter(act => act.id === 'peek-chat')
    expect(large.form).toContain('look-around')
    expect(small.form).not.toContain('look-around')
    expect(r.requirements[0].value).toMatch(/^5 distinct/)
  })

  it('counts once a confirmed act whose span starts inside an earlier act\'s movement, though its form differs', () => {
    const r = report({ acts: [...SIX.slice(0, 4), { id: 'look-around', at: 28 }, { id: 'sigh', at: 30.8 }] })
    const [first, second] = r.detail.acts.slice(4)
    expect(second).toMatchObject({ confirmed: true, overlaps: true })
    expect(second.form).not.toEqual(first.form)
    expect(r.requirements[0].value).toMatch(/^5 distinct/)
  })

  it('confirms an act whose design phases come in sequence, in the design\'s order only', () => {
    const phase = (from: number, seconds: number) => (t: number) => hold((t - from) / seconds)
    const roll = (clavicles: number, head: number) => (bone: MotionTraceBone, t: number): Quat | null =>
      bone === 'leftShoulder' ? axisAngle(2, 10 * phase(clavicles, 1.4)(t)) : bone === 'rightShoulder' ? axisAngle(2, -10 * phase(clavicles + 0.12, 1.4)(t)) : bone === 'head' ? axisAngle(2, 12 * phase(head, 1.6)(t)) : null
    const marker = { id: 'shoulder-roll', at: 22, moves: null } as const
    const inOrder = report({ acts: [...SIX.filter(act => act.id !== 'shoulder-roll'), marker], extra: roll(22, 23.4) })
    expect(inOrder.detail.acts.find(act => act.id === 'shoulder-roll')?.confirmed).toBe(true)
    const reversed = report({ acts: [...SIX.filter(act => act.id !== 'shoulder-roll'), marker], extra: roll(23.6, 22) })
    expect(reversed.detail.acts.find(act => act.id === 'shoulder-roll')?.confirmed).toBe(false)
  })

  it('re-bases the pair only after a confirmed foot re-plant, on the stepped foot\'s yaw and the hips\' lateral shift alone', () => {
    // A re-plant lifts the free foot (the thigh swings 15 deg over the act) and leaves it yawed.
    const lift = (at: number) => (t: number) => 15 * hold((t - at) / ACT_SECONDS)
    const plant = (ats: readonly number[], deg: number, more: (bone: MotionTraceBone, t: number) => Quat | null = () => null, lifted = true) => (bone: MotionTraceBone, t: number): Quat | null => {
      if (bone === 'leftUpperLeg' && lifted)
        return axisAngle(0, ats.reduce((sum, at) => sum + lift(at)(t), 0))
      if (bone === 'leftFoot')
        return multiply(axisAngle(1, ats.reduce((sum, at) => sum + deg * Math.min(1, Math.max(0, t - at - 1) / 1.2), 0)), more(bone, t) ?? [0, 0, 0, 1])
      return more(bone, t)
    }
    const replants = (ats: readonly number[]): Act[] => ats.map(at => ({ id: 'foot-replant', at, moves: null }))
    const acts = (ats: readonly number[]) => [...SIX, ...replants(ats)].sort((a, b) => a.at - b.at)
    expect(report({ acts: acts([10]), extra: plant([10], 6) }).detail.acts.find(act => act.id === 'foot-replant')?.confirmed).toBe(true)
    expect(report({ acts: acts([10]), extra: plant([10], 6) }).detail.pair.difference).toBeLessThan(0.25)
    expect(report({ acts: replants([10, 20, 30]), extra: plant([10, 20, 30], 6) }).detail.pair.difference).toBeLessThan(0.25)
    expect(() => report({ acts: acts([10]), extra: plant([10], 6, (bone, t) => bone === 'head' && t > 20 ? axisAngle(1, 1) : null) })).toThrow(/outside the act spans/)
    expect(() => report({ acts: acts([10]), extra: plant([10], 20) })).toThrow(/lasting result/)
    expect(() => report({ acts: SIX, extra: plant([10], 6) })).toThrow(/outside the act spans/)
    // The review's P2: a marker with no lift behind it does not license the turned foot; P1: a pitched foot after a correct re-plant.
    expect(() => report({ acts: acts([10]), extra: plant([10], 6, () => null, false) })).toThrow(/outside the act spans/)
    expect(() => report({ acts: acts([10]), extra: plant([10], 6, (bone, t) => bone === 'leftFoot' && t > 20 ? axisAngle(0, 15) : null) })).toThrow(/outside the act spans/)
    // The review's P4: hips left up after a correct re-plant.
    expect(() => report({ acts: acts([10]), extra: plant([10], 6), hips: t => [0, t > 14 ? 0.015 : 0, 0] })).toThrow(/hips/)
  })

  it('refuses a pair whose root yaw or hips position differs outside the act spans, and accepts hips movement inside one', () => {
    const after39 = (t: number) => Math.min(1, Math.max(0, t - 39))
    expect(() => report({ acts: SIX, yaw: t => 0.1 * Math.PI / 180 * after39(t) })).toThrow(/root yaw/)
    expect(() => report({ acts: SIX, hips: t => [0.001 * after39(t), 0, 0] })).toThrow(/hips/)
    expect(report({ acts: SIX, hips: t => [0, t > 4 && t < 7 ? 0.012 * Math.sin(Math.PI * (t - 4) / 3) : 0, 0] }).detail.pair.hips).toBe(0)
  })

  it('refuses a pair that is not a run and its acts-off companion of the same commit', () => {
    expect(() => report({ acts: SIX }, { actsSwitch: undefined })).toThrow(ReportUsageError)
    expect(() => report({ acts: SIX, actsSwitch: 'off' })).toThrow(ReportUsageError)
    expect(() => report({ acts: SIX }, { gitSha: 'def456' })).toThrow(ReportUsageError)
    expect(() => report({ acts: SIX }, { acts: [{ id: 'sigh', at: 34, moves: null }] })).toThrow(ReportUsageError)
  })

  it('refuses a run that is not idle-class', () => {
    expect(() => report({ acts: SIX, scenario: 'talk' }, { scenario: 'talk' })).toThrow(ReportUsageError)
  })
})
