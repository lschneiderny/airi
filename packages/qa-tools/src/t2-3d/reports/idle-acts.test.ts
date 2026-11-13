import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Motion3dIdleDrive } from '../idle-drive'
import type { Quat } from '../metrics'
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
  'peer': [['spine', 0, 6], ['chest', 0, 4], ['head', 0, 12]],
  'zone-out': [['head', 0, 10], ['neck', 0, 6]],
  'nod-off': [['head', 0, 20], ['neck', 0, 8]],
  'sway': [['spine', 2, 6], ['hips', 2, 4]],
}
/** I1: six distinct kinds, each 3 s, 10 s apart; their widened spans end at 66.8 s, so the act-free windows lie before 10 s and after 66.8 s. */
const SIX: readonly Behaviour[] = (['stretch', 'look-around', 'check-in', 'peer', 'zone-out', 'sway'] as const).map((kind, k) => ({ kind, at: 10 + 10 * k }))
const BONES: readonly MotionTraceBone[] = [...TEST_BONES, 'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'rightUpperLeg', 'rightLowerLeg', 'rightFoot']
const PARENTS = motionTraceParents([...BONES])
/** Her idle: every bone sways 1.5 deg about one axis at its own slow frequency, so every channel has an idle range. */
const IDLE_DEG = 1.5

const minJerk = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u)
const hold = (u: number) => u <= 0 || u >= 1 ? 0 : u < 0.3 ? minJerk(u / 0.3) : u > 0.7 ? 1 - minJerk((u - 0.7) / 0.3) : 1
function axisAngle(axis: 0 | 1 | 2, degrees: number): Quat {
  const s = Math.sin(degrees * Math.PI / 360)
  return [axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0, Math.cos(degrees * Math.PI / 360)]
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
  /** Marker labels added as they are, for malformed reports. */
  readonly rawMarkers?: readonly (readonly [number, string])[]
  readonly scoredFrom?: number
  /** The trace's length in s; 90 by default. */
  readonly seconds?: number
}

/** A standing body with her idle sway on every bone; each behaviour's motion bends its bones and returns, through the hierarchy. */
function trace(body: Body): DecodedMotionTrace {
  const plays = (body.behaviours ?? []).flatMap(b => b.moves === null ? [] : [{ moves: MOVES[b.moves ?? b.kind] ?? [], at: b.at, scale: b.scale ?? 1 }])
  const local = (bone: MotionTraceBone, t: number): Quat => {
    const b = BONES.indexOf(bone)
    const idle = axisAngle((b % 3) as 0 | 1 | 2, IDLE_DEG * Math.sin(2 * Math.PI * (0.13 + 0.031 * b) * t + b))
    const moved = plays.reduce<Quat>((q, play) => play.moves.reduce<Quat>((r, [target, axis, deg]) => target === bone ? multiply(r, axisAngle(axis, deg * play.scale * hold((t - play.at) / ACT_SECONDS))) : r, q), idle)
    const extra = body.extra?.(bone, t)
    return extra ? multiply(moved, extra) : moved
  }
  const world = (bone: MotionTraceBone, t: number): Quat => {
    const parent = PARENTS[BONES.indexOf(bone)]
    return parent < 0 ? local(bone, t) : multiply(world(BONES[parent], t), local(bone, t))
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
  const input = analyticTrace({ seconds: body.seconds ?? 90, bones: BONES, scenario: body.scenario ?? 'idle', events, world })
  const drive = body.drive === undefined ? (body.actsSwitch ? null : QA_DRIVE_PRESENT) : body.drive
  const detail: Record<string, string> = { ...body.actsSwitch ? { acts: body.actsSwitch } : {}, ...drive ? idleDriveDetail(drive) : {} }
  const source = { ...input.trace.source, gitSha: body.gitSha ?? 'abc123', detail }
  return { ...input, trace: { ...input.trace, source, scoredFrom: body.scoredFrom ?? 0 } }
}

/** The run, and its acts-off companion of the same seed: her idle without any behaviour, no drive. */
function pair(body: Body, companion: Body = {}) {
  const base = { seconds: body.seconds, scoredFrom: body.scoredFrom, scenario: body.scenario }
  return [loadedRun(trace(body), null, null), loadedRun(trace({ actsSwitch: 'off', ...base, ...companion }), null, null)] as const
}
const report = (body: Body, companion?: Body) => idleActsReport(...pair(body, companion))
const statuses = (r: ReturnType<typeof idleActsReport>) => Object.fromEntries(r.requirements.map(q => [q.id, q.status]))
const distinct = (r: ReturnType<typeof idleActsReport>) => Number.parseInt(r.requirements.find(q => q.id === 'distinct-acts')?.value ?? '', 10)
const after = (from: number, bones: readonly MotionTraceBone[]) => (bone: MotionTraceBone, t: number): Quat | null => bones.includes(bone) && t >= from ? axisAngle(1, Math.min(1, t - from)) : null

describe('idle-acts report version 4', () => {
  it('i1: passes six distinct kinds that each moved her body, the QA drive named and the companion equal outside the acts', () => {
    const r = report({ behaviours: SIX })
    expect(statuses(r)).toEqual({ 'drive': 'PASS', 'distinct-acts': 'PASS', 'no-repeat': 'PASS', 'pair': 'PASS' })
    expect(r.detail.acts.map(act => act.movement?.moved)).toEqual([true, true, true, true, true, true])
    expect(r.verdict).toBe('PASS')
  })

  it('i2, i3: fails a run whose provenance names no drive, or the QA drive\'s name with other values', () => {
    const none = report({ behaviours: SIX, drive: null })
    expect([statuses(none).drive, none.verdict]).toEqual(['FAIL', 'FAIL'])
    expect(statuses(report({ behaviours: SIX, drive: { name: QA_DRIVE_PRESENT.name, drive: { ...QA_IDLE_DRIVE, sleepiness: 1 } } })).drive).toBe('FAIL')
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

  it('i6, i7: fails five kinds over six acts and a kind started twice in a row, and allows a repeat that is not in a row', () => {
    const five = report({ behaviours: SIX.map((b, k) => k === 3 ? { ...b, kind: 'stretch' } : b) })
    expect([statuses(five)['distinct-acts'], statuses(five)['no-repeat'], distinct(five)]).toEqual(['FAIL', 'PASS', 5])
    const twice = report({ seconds: 100, behaviours: [...SIX, { kind: 'sway', at: 70 }] })
    expect(statuses(twice)['no-repeat']).toBe('FAIL')
  })

  it('i8, i9: fails lasting state in the performer\'s channels after an act and prints, without judging, lasting state in Natural\'s', () => {
    const hips = report({ behaviours: SIX, extra: after(24, ['hips']) })
    expect(statuses(hips).pair).toBe('FAIL')
    const natural = report({ behaviours: SIX, extra: after(24, ['head', 'chest']) })
    expect(statuses(natural).pair).toBe('PASS')
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
