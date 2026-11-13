import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Motion3dIdleDrive } from '../idle-drive'
import type { Quat, Vec3 } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'

import { motionTraceParents } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { describe, expect, it } from 'vitest'

import { idleDriveDetail, QA_DRIVE_PRESENT, QA_IDLE_DRIVE } from '../idle-drive'
import { multiply } from '../metrics/math'
import { analyticTrace } from '../metrics/test-trace'
import { idleActsReport } from './idle-acts'
import { ReportUsageError } from './report'
import { loadedRun, TEST_BONES } from './test-runs'

/** One behaviour the scheduler reports: its kind, its start, its length (no end report when null), and the body motion under it. */
interface Behaviour {
  readonly kind: string
  readonly at: number
  readonly seconds?: number | null
  /** The motion played under the reports: its own kind's by default, none for reports without motion. */
  readonly moves?: string | null
  /** Scales the motion's angles. */
  readonly scale?: number
}

const ACT_SECONDS = 3
/** Local rotations (bone, axis, degrees) each kind holds over its span; every one is several times her idle sway. */
const MOVES: Record<string, readonly (readonly [MotionTraceBone, 0 | 1 | 2, number])[]> = {
  'stretch': [['leftUpperArm', 2, 40], ['rightUpperArm', 2, -40], ['chest', 0, -8]],
  'yawn': [['head', 0, -14], ['chest', 0, -6], ['rightUpperArm', 0, -30]],
  'look-around': [['neck', 1, 14], ['head', 1, 21]],
  'check-in': [['head', 1, -18], ['upperChest', 1, -6]],
  'peer': [['spine', 0, 6], ['chest', 0, 4], ['head', 0, 18]],
  'zone-out': [['head', 0, 16], ['neck', 0, 6]],
  'nod-off': [['head', 0, 20], ['neck', 0, 8]],
  'sway': [['spine', 2, 16], ['hips', 2, 4]],
  /** A held 20 deg head nod alone. */
  'nod': [['head', 0, 20]],
  /** A toe held at 30 deg. */
  'toe': [['leftToes', 0, 30]],
}
/** I1: six distinct kinds, each 3 s, 10 s apart; their widened spans end at 66.8 s, so the act-free windows lie before 10 s and after 66.8 s. */
const SIX: readonly Behaviour[] = (['stretch', 'look-around', 'check-in', 'peer', 'zone-out', 'sway'] as const).map((kind, k) => ({ kind, at: 10 + 10 * k }))
const BONES: readonly MotionTraceBone[] = [...TEST_BONES, 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes']
const PARENTS = motionTraceParents([...BONES])
/** Her idle: every bone sways 1.5 deg about one axis at its own slow frequency, so every channel has an idle range. */
const IDLE_DEG = 1.5

const minJerk = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u)
const hold = (u: number) => u <= 0 || u >= 1 ? 0 : u < 0.3 ? minJerk(u / 0.3) : u > 0.7 ? 1 - minJerk((u - 0.7) / 0.3) : 1
function axisAngle(axis: 0 | 1 | 2, degrees: number): Quat {
  const s = Math.sin(degrees * Math.PI / 360)
  return [axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0, Math.cos(degrees * Math.PI / 360)]
}

/**
 * The performer's weight-shift schedule: a 1.5 s minimum-jerk transfer to each target at its time, read at t - delay(t)
 * (an act slows the countdown, so the run reads the companion's schedule later). The support moves the hips position
 * sideways, rolls the hips and swings the upper legs.
 */
interface Support {
  readonly at: readonly number[]
  readonly to: readonly number[]
  readonly delay?: (t: number) => number
  readonly gains: { readonly x: number, readonly hips: number, readonly legs: number }
}

function supportAt(support: Support, t: number): number {
  const u = t - (support.delay?.(t) ?? 0)
  let value = 0
  for (let k = 0; k < support.at.length && u >= support.at[k]; k++)
    value = (support.to[k - 1] ?? 0) + (support.to[k] - (support.to[k - 1] ?? 0)) * minJerk((u - support.at[k]) / 1.5)
  return value
}

interface Body {
  readonly behaviours?: readonly Behaviour[]
  readonly scenario?: 'idle' | 'talk'
  readonly actsSwitch?: 'off'
  /** The drive the provenance names; I1's by default on the run, none on the companion. */
  readonly drive?: Motion3dIdleDrive | null
  readonly gitSha?: string
  /** A rotation applied after the act motion to a bone's local rotation at t; none by default. */
  readonly extra?: (bone: MotionTraceBone, t: number) => Quat | null
  /** Bones without the idle sway. */
  readonly still?: readonly MotionTraceBone[]
  readonly support?: Support
  /** The root yaw, radians, applied to the whole body; 0 by default. */
  readonly yaw?: (t: number) => number
  /** Added to the hips position, L. */
  readonly hips?: (t: number) => Vec3
  /** The stored drive values text, replacing the drive's own JSON. */
  readonly driveValues?: string
  /** Marker labels added as they are, for malformed reports. */
  readonly rawMarkers?: readonly (readonly [number, string])[]
  readonly scoredFrom?: number
  /** The trace's length in s; 90 by default. */
  readonly seconds?: number
}

/** A standing body with her idle sway on every bone; each behaviour's motion bends its bones and returns, through the hierarchy. */
function trace(body: Body): DecodedMotionTrace {
  const plays = (body.behaviours ?? []).flatMap(b => b.moves === null ? [] : [{ moves: MOVES[b.moves ?? b.kind] ?? [], at: b.at, scale: b.scale ?? 1 }])
  const { support } = body
  const supportDeg = (bone: MotionTraceBone, t: number) => !support ? 0 : bone === 'hips' ? support.gains.hips * supportAt(support, t) : bone === 'leftUpperLeg' ? support.gains.legs * supportAt(support, t) : bone === 'rightUpperLeg' ? -support.gains.legs * supportAt(support, t) : 0
  const local = (bone: MotionTraceBone, t: number): Quat => {
    const b = BONES.indexOf(bone)
    const idle = axisAngle((b % 3) as 0 | 1 | 2, body.still?.includes(bone) ? 0 : IDLE_DEG * Math.sin(2 * Math.PI * (0.13 + 0.031 * b) * t + b))
    const shifted = multiply(idle, axisAngle(2, supportDeg(bone, t)))
    const moved = plays.reduce<Quat>((q, play) => play.moves.reduce<Quat>((r, [target, axis, deg]) => target === bone ? multiply(r, axisAngle(axis, deg * play.scale * hold((t - play.at) / ACT_SECONDS))) : r, q), shifted)
    const extra = body.extra?.(bone, t)
    return extra ? multiply(moved, extra) : moved
  }
  const yaw = body.yaw ?? (() => 0)
  const world = (bone: MotionTraceBone, t: number): Quat => {
    const parent = PARENTS[BONES.indexOf(bone)]
    return parent < 0 ? multiply([0, Math.sin(yaw(t) / 2), 0, Math.cos(yaw(t) / 2)], local(bone, t)) : multiply(world(BONES[parent], t), local(bone, t))
  }
  const position = (t: number): Vec3 => {
    const added = body.hips?.(t) ?? [0, 0, 0]
    return [added[0] + (support ? support.gains.x * supportAt(support, t) : 0), added[1], added[2]]
  }
  const events: MotionTraceEvent[] = [
    ...(body.behaviours ?? []).flatMap((b): MotionTraceEvent[] => {
      const seconds = b.seconds === undefined ? ACT_SECONDS : b.seconds
      return [
        { t: b.at, kind: 'marker', label: `idle:${b.kind}:start` },
        ...seconds === null ? [] : [{ t: b.at + seconds, kind: 'marker', label: `idle:${b.kind}:end` } satisfies MotionTraceEvent],
      ]
    }),
    ...(body.rawMarkers ?? []).map(([t, label]): MotionTraceEvent => ({ t, kind: 'marker', label })),
  ].sort((a, b) => a.t - b.t)
  const input = analyticTrace({ seconds: body.seconds ?? 90, bones: BONES, scenario: body.scenario ?? 'idle', events, world, yaw, position })
  const drive = body.drive === undefined ? (body.actsSwitch ? null : QA_DRIVE_PRESENT) : body.drive
  const named = drive ? { ...idleDriveDetail(drive), ...body.driveValues === undefined ? {} : { idleDriveValues: body.driveValues } } : {}
  const detail: Record<string, string> = { ...body.actsSwitch ? { acts: body.actsSwitch } : {}, ...named }
  const source = { ...input.trace.source, gitSha: body.gitSha ?? 'abc123', detail }
  return { ...input, trace: { ...input.trace, source, scoredFrom: body.scoredFrom ?? 0 } }
}

/** The run, and its acts-off companion of the same seed: her idle without any behaviour, no drive, the schedule undelayed. */
function pair(body: Body, companion: Body = {}) {
  const base = { seconds: body.seconds, scoredFrom: body.scoredFrom, scenario: body.scenario, still: body.still, support: body.support && { ...body.support, delay: undefined } }
  return [loadedRun(trace(body), null, null), loadedRun(trace({ actsSwitch: 'off', ...base, ...companion }), null, null)] as const
}
const report = (body: Body, companion?: Body) => idleActsReport(...pair(body, companion))
const statuses = (r: ReturnType<typeof idleActsReport>) => Object.fromEntries(r.requirements.map(q => [q.id, q.status]))
/** Version 6's reading of the pair, printed and out of the verdict since version 7. */
const reading = (r: ReturnType<typeof idleActsReport>) => r.detail.pair.reading
const distinct = (r: ReturnType<typeof idleActsReport>) => Number.parseInt(r.requirements.find(q => q.id === 'distinct-acts')?.value ?? '', 10)
const after = (from: number, bones: readonly MotionTraceBone[]) => (bone: MotionTraceBone, t: number): Quat | null => bones.includes(bone) && t >= from ? axisAngle(1, Math.min(1, t - from)) : null
const ramp = (from: number) => (t: number) => Math.min(1, Math.max(0, t - from))

/** A 0.2 s raised-cosine twitch of `deg` on one bone in the middle of every behaviour of `on`. */
function twitch(on: readonly Behaviour[], bone: MotionTraceBone, deg: number) {
  return (target: MotionTraceBone, t: number): Quat | null => {
    if (target !== bone)
      return null
    const u = on.map(b => (t - b.at - ACT_SECONDS / 2) / 0.2 + 0.5).find(x => x > 0 && x < 1)
    return u === undefined ? null : axisAngle(0, deg * (0.5 - 0.5 * Math.cos(2 * Math.PI * u)))
  }
}

/** P1: six acts 20 s apart in 140 s, over a weight-shift schedule with 15 deg leg swings every 6 to 11 s. */
const SPACED: readonly Behaviour[] = SIX.map((b, k) => ({ ...b, at: 15 + 20 * k }))
const SHIFT_AT = [6, 13.5, 22, 31, 37.5, 46, 57, 64.5, 72, 83.5, 92, 99, 107.5, 118, 126, 133.5]
const SHIFT_TO = [1, -0.5, 0, -1, 0.5, -1, 1, 0, -0.5, 1, -1, 0.5, 0, 1, -0.5, -1]
/** The delay each act adds while it runs: `rate` s per s of the act (the product's calm allows at most 0.6). */
const delayed = (rate: (k: number) => number) => (t: number) => SPACED.reduce((sum, b, k) => sum + rate(k) * Math.min(ACT_SECONDS, Math.max(0, t - b.at)), 0)
const schedule = (rate: (k: number) => number = () => 0.5): Support => ({ at: SHIFT_AT, to: SHIFT_TO, delay: delayed(rate), gains: { x: 0.03, hips: 3, legs: 15 } })
/** The hips and legs without her every-bone sway: as in the product, the lower body carries only the weight shift. */
const LEGS: readonly MotionTraceBone[] = ['hips', 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes']
const P1: Body = { seconds: 140, behaviours: SPACED, support: schedule(), still: LEGS }
/** Which act, counted from 0, the time `t` falls after: the sign of an offset switches in the middle of each act. */
const actsBefore = (t: number) => SPACED.filter(b => b.at + ACT_SECONDS / 2 <= t).length
/** V3: the reviewer's idle: no sway on the hips and legs, the hips rolled 3 deg by a weight shift every 23 s. */
const SHIFTING: Pick<Body, 'still' | 'support'> = { still: LEGS, support: { at: [5, 28, 51, 74], to: [1, -1, 1, -1], gains: { x: 0, hips: 3, legs: 0 } } }

describe('idle-acts report version 7', () => {
  it('i1: passes six distinct kinds that each moved her body and the QA drive named, and prints the companion equal outside the acts', () => {
    const r = report({ behaviours: SIX })
    expect(statuses(r)).toEqual({ 'drive': 'PASS', 'distinct-acts': 'PASS', 'no-repeat': 'PASS', 'pair': 'REPORT' })
    expect(reading(r)).toBe('PASS')
    expect(r.detail.acts.map(act => act.movement?.moved)).toEqual([true, true, true, true, true, true])
    expect(r.verdict).toBe('PASS')
  })

  it('i2, i3: fails a run whose provenance names no drive, or the QA drive\'s name with other values', () => {
    const none = report({ behaviours: SIX, drive: null })
    expect([statuses(none).drive, none.verdict]).toEqual(['FAIL', 'FAIL'])
    expect(statuses(report({ behaviours: SIX, drive: { name: QA_DRIVE_PRESENT.name, drive: { ...QA_IDLE_DRIVE, sleepiness: 1 } } })).drive).toBe('FAIL')
  })

  it('d1, d2: compares the drive by value, so another field order passes and another value in it fails', () => {
    const reversed = (drive: object) => JSON.stringify(Object.fromEntries(Object.entries(drive).reverse()))
    const drive = (driveValues: string) => statuses(report({ seconds: 5, behaviours: [{ kind: 'peer', at: 1 }], driveValues })).drive
    expect([drive(reversed(QA_IDLE_DRIVE)), drive(reversed({ ...QA_IDLE_DRIVE, energy: 0.2 })), drive('not json')]).toEqual(['PASS', 'FAIL', 'FAIL'])
  })

  it('d3: fails a run recorded with the head-only drive the runner sent before amendment 9', () => {
    const headOnly = JSON.stringify({ energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, music: false, allowSleep: true, rate: 1 })
    expect(statuses(report({ seconds: 5, behaviours: [{ kind: 'peer', at: 1 }], driveValues: headOnly })).drive).toBe('FAIL')
    expect(QA_IDLE_DRIVE.body).toBe(true)
  })

  it('i4: counts no act whose reports have no body motion of their own, so markers alone cannot pass', () => {
    const r = report({ behaviours: SIX.map(b => ({ ...b, moves: null })) })
    expect(statuses(r)['distinct-acts']).toBe('FAIL')
    expect(distinct(r)).toBe(0)
  })

  it('i5: does not count acts whose largest rotation, 1 deg, lies inside her 1.5 deg idle sway', () => {
    const r = report({ behaviours: SIX.map(b => ({ ...b, scale: 1 / Math.max(...MOVES[b.kind].map(([, , deg]) => Math.abs(deg))) })) })
    expect(statuses(r)['distinct-acts']).toBe('FAIL')
  })

  it('v1, v2: counts no 0.25 deg twitch of a still toe and counts the same toe held at 30 deg', () => {
    const markers = SIX.map(b => ({ ...b, moves: null }))
    expect(distinct(report({ behaviours: markers, still: ['leftToes'], extra: twitch(SIX, 'leftToes', 0.25) }))).toBe(0)
    expect(distinct(report({ behaviours: SIX.map(b => ({ ...b, moves: 'toe' })), still: ['leftToes'] }))).toBe(6)
  })

  it('v3, v4: counts held 20 deg head nods over an idle whose hips shift weight every 23 s, and no toe twitch over it', () => {
    expect(distinct(report({ ...SHIFTING, behaviours: SIX.map(b => ({ ...b, moves: 'nod' })) }))).toBe(6)
    expect(distinct(report({ ...SHIFTING, behaviours: SIX.map(b => ({ ...b, moves: null })), extra: twitch(SIX, 'leftToes', 0.25) }))).toBe(0)
  })

  it('t1: reports the scale and the change the deciding channel needed, the larger of its floor and its own idle times max(1, bar)', () => {
    const r = report({ behaviours: SIX.map(b => ({ ...b, moves: 'toe' })), still: ['leftToes'] })
    const moved = r.detail.acts.map(act => act.movement!)
    expect(moved.map(m => [m.channel, m.scale])).toEqual(SIX.map(() => ['leftToes', 10]))
    expect(moved.map(m => m.needed)).toEqual(moved.map(m => m.scale * Math.max(1, m.bar)))
  })

  it('v5: does not count acts whose largest rotation is 6 deg, so that with her sway no bone changes 10 deg within 1.5 s', () => {
    const r = report({ behaviours: SIX.map(b => ({ ...b, scale: 6 / Math.max(...MOVES[b.kind].map(([, , deg]) => Math.abs(deg))) })) })
    expect(distinct(r)).toBe(0)
  })

  it('i6, i7: fails five kinds over six acts and a kind started twice in a row, and allows a repeat that is not in a row', () => {
    const five = report({ behaviours: SIX.map((b, k) => k === 3 ? { ...b, kind: 'stretch' } : b) })
    expect([statuses(five)['distinct-acts'], statuses(five)['no-repeat'], distinct(five)]).toEqual(['FAIL', 'PASS', 5])
    const twice = report({ seconds: 100, behaviours: [...SIX, { kind: 'sway', at: 70 }] })
    expect(statuses(twice)['no-repeat']).toBe('FAIL')
  })

  it('p1: passes a run whose weight-shift schedule each act delays, and finds the delay that grows with every act', () => {
    const r = report(P1)
    expect(reading(r)).toBe('PASS')
    const delays = r.detail.pair.intervals.map(i => i.delay)
    expect(delays.every((d, k) => k === 0 || d >= delays[k - 1])).toBe(true)
    expect(delays.at(-1)).toBeCloseTo(SPACED.length * 0.5 * ACT_SECONDS, 1)
  })

  const second = SPACED[1].at + 1
  it.each([
    ['p2: the hips turned 1 deg', { extra: after(second, ['hips']) }],
    ['p5: the root yaw 1 deg off', { yaw: (t: number) => ramp(second)(t) * Math.PI / 180 }],
    ['p5: the hips position 0.015 L off', { hips: (t: number): Vec3 => [0.015 * ramp(second)(t), 0, 0] }],
  ] as const)('%s for good after the second act fails the pair: no delay explains it', (_, change: Body) => {
    expect(reading(report({ ...P1, ...change }))).toBe('FAIL')
  })

  it('p3: fails a delay that decreases after an act', () => {
    const decreasing: Support = { ...schedule(), delay: t => delayed(() => 0.5)(t) - (t >= SPACED[2].at + ACT_SECONDS ? 3.5 : 0) }
    expect(reading(report({ ...P1, support: decreasing }))).toBe('FAIL')
  })

  it('p4: does not pass a delay that grows more than the acts can slow the schedule: its intervals sit at the bound and are not judged', () => {
    const r = report({ ...P1, support: schedule(k => k === 2 ? 12 / ACT_SECONDS : 0.5) })
    expect(reading(r)).toBe('NOT-EXERCISED')
    expect(r.detail.pair.intervals.filter(i => !i.judged).length).toBeGreaterThan(0)
  })

  it('pb: passes a delay that a still interval cannot show, once a weight shift after the next act shows it', () => {
    // The first act's delay falls in an interval without a weight shift, where every delay fits; the shift after the
    // second act needs both acts' delay (3.6 s), more than the second act alone could add.
    const acts: Behaviour[] = [{ kind: 'stretch', at: 15 }, { kind: 'look-around', at: 35 }]
    const delay = (t: number) => acts.reduce((sum, b) => sum + 0.6 * Math.min(ACT_SECONDS, Math.max(0, t - b.at)), 0)
    const r = report({ seconds: 70, behaviours: acts, still: LEGS, support: { at: [6, 45, 58], to: [1, -1, 0.5], delay, gains: { x: 0.03, hips: 3, legs: 15 } } })
    expect(reading(r)).toBe('PASS')
    expect(r.detail.pair.intervals.at(-1)?.delay).toBeCloseTo(3.6, 1)
  })

  it('pa: fails a hips position held 0.02 L to one side and then the other, switching inside every act', () => {
    const r = report({ ...P1, hips: t => [t < SPACED[0].at + ACT_SECONDS / 2 ? 0 : actsBefore(t) % 2 === 0 ? -0.02 : 0.02, 0, 0] })
    expect(reading(r)).toBe('FAIL')
  })

  it('pt: fails a leg held 1.5 deg off on one act-free interval only, whatever the other intervals hold', () => {
    const held = (bone: MotionTraceBone, t: number): Quat | null => bone === 'leftUpperLeg' && actsBefore(t) === 3 ? axisAngle(0, 1.5) : null
    expect(reading(report({ ...P1, extra: held }))).toBe('FAIL')
  })

  it('p6: passes hips movement inside a widened act', () => {
    const inside = (t: number): Vec3 => [0, t > SPACED[1].at && t < SPACED[1].at + 3 ? 0.012 * Math.sin(Math.PI * (t - SPACED[1].at) / 3) : 0, 0]
    expect(reading(report({ ...P1, hips: inside }))).toBe('PASS')
  })

  it('p7: fails a foot re-plant inside an act that leaves the foot and hips moved for good', () => {
    const replant = (bone: MotionTraceBone, t: number): Quat | null => bone === 'leftFoot' ? axisAngle(1, 6 * ramp(second)(t)) : null
    expect(reading(report({ ...P1, extra: replant, hips: t => [0.01 * ramp(second)(t), 0, 0] }))).toBe('FAIL')
  })

  it('p8: passes a foot lifted inside an act and set back', () => {
    const lift = (bone: MotionTraceBone, t: number): Quat | null => bone === 'leftUpperLeg' ? axisAngle(0, 15 * hold((t - SPACED[1].at) / ACT_SECONDS)) : null
    expect(reading(report({ ...P1, extra: lift }))).toBe('PASS')
  })

  it('i8, i9: reads lasting state in the performer\'s channels after an act as a pair FAIL that stays out of the verdict, and prints Natural\'s', () => {
    const hips = report({ behaviours: SIX, extra: after(24, ['hips']) })
    expect([reading(hips), statuses(hips).pair, hips.verdict]).toEqual(['FAIL', 'REPORT', 'PASS'])
    const natural = report({ behaviours: SIX, extra: after(24, ['head', 'chest']) })
    expect(reading(natural)).toBe('PASS')
    expect(natural.detail.pair.others.difference).toBeGreaterThanOrEqual(0.999)
  })

  it('i10: counts neither an act started in the warm-up nor one without an end report', () => {
    const r = report({ seconds: 100, scoredFrom: 5, behaviours: [{ kind: 'yawn', at: 1 }, ...SIX, { kind: 'nod-off', at: 95, seconds: null }] })
    expect(r.detail.acts.map(act => act.countable)).toEqual([false, true, true, true, true, true, true, false])
    expect(distinct(r)).toBe(6)
  })

  it('i11: reports the repeat line as not exercised with one behaviour', () => {
    expect(statuses(report({ behaviours: SIX.slice(0, 1) }))['no-repeat']).toBe('NOT-EXERCISED')
  })

  it('i12: counts neither sleep nor a host cue as an act, and counts the same spans under drawn kinds', () => {
    const spans = (kinds: readonly [string, string]): Behaviour[] => [...SIX, { kind: kinds[0], at: 70, moves: 'yawn' }, { kind: kinds[1], at: 80, moves: 'nod-off' }]
    expect(distinct(report({ seconds: 120, behaviours: spans(['sleep', 'about-to-speak']) }))).toBe(6)
    expect(distinct(report({ seconds: 120, behaviours: spans(['yawn', 'nod-off']) }))).toBe(8)
  })

  it('r1: refuses a pair that is not a run and its drive-free acts-off companion of the same clean commit', () => {
    // The pair's source is refused before any frame is read, so one act in a short trace is enough.
    const run: Body = { seconds: 5, behaviours: [{ kind: 'peer', at: 1 }] }
    expect(() => report(run, { actsSwitch: undefined, drive: null })).toThrow(ReportUsageError)
    expect(() => report(run, { rawMarkers: [[1, 'idle:peer:start'], [2, 'idle:peer:end']] })).toThrow(ReportUsageError)
    expect(() => report(run, { drive: QA_DRIVE_PRESENT })).toThrow(ReportUsageError)
    expect(() => report(run, { gitSha: 'def456' })).toThrow(ReportUsageError)
    expect(() => report({ ...run, actsSwitch: 'off' })).toThrow(ReportUsageError)
    expect(() => report({ ...run, scenario: 'talk' })).toThrow(ReportUsageError)
  })

  it.each([
    ['two fields', [[1, 'idle:peer']]],
    ['an unknown phase', [[1, 'idle:peer:middle']]],
    ['an end without a start', [[1, 'idle:peer:end']]],
    ['a start while another is open', [[1, 'idle:peer:start'], [2, 'idle:yawn:start']]],
  ] as const)('r1: refuses a malformed idle marker: %s', (_, rawMarkers) => {
    expect(() => report({ seconds: 5, rawMarkers })).toThrow(ReportUsageError)
  })
})
