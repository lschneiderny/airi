import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { BodyActId, BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import type { Quat, Vec3 } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'

import { motionTraceParents } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { describe, expect, it } from 'vitest'

import { multiply } from '../metrics/math'
import { analyticTrace } from '../metrics/test-trace'
import { idleActsReport } from './idle-acts'
import { ReportUsageError } from './report'
import { loadedRun, TEST_BONES } from './test-runs'

interface Act {
  readonly id: BodyActId
  readonly at: number
  readonly state?: 'finished' | 'cancelled'
  /** The act whose movement plays under this marker; its own by default, none for a marker without motion. */
  readonly moves?: BodyActId | null
  readonly scale?: number
}

const ACT_SECONDS = 3
/** Local rotations (bone, axis, degrees) at each act's 4e amplitude, on the bones its keys read. */
const MOVEMENTS: Partial<Record<BodyActId, readonly [MotionTraceBone, 0 | 1 | 2, number][]>> = {
  'sigh': [['chest', 0, 4], ['leftShoulder', 2, 4], ['rightShoulder', 2, -4]],
  'arm-swing': [['leftUpperArm', 0, 8], ['rightUpperArm', 0, -8]],
  'look-around': [['neck', 1, 14], ['head', 1, 21]],
  'hand-inspect': [['rightLowerArm', 1, 60]],
  'wave': [['leftLowerArm', 1, 18]],
  'shoulder-roll': [['leftShoulder', 2, 10], ['rightShoulder', 2, -10], ['head', 2, 12]],
}
const SIX: readonly Act[] = [
  { id: 'wave', at: 4 },
  { id: 'arm-swing', at: 10 },
  { id: 'hand-inspect', at: 16 },
  { id: 'shoulder-roll', at: 22 },
  { id: 'look-around', at: 28 },
  { id: 'sigh', at: 34 },
]
const RESTING: readonly { t: number, state: BodyRest }[] = [{ t: 20, state: 'rest' }]
const PARENTS = motionTraceParents([...TEST_BONES])

const minJerk = (u: number) => u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (10 - 15 * u + 6 * u * u)
const hold = (u: number) => u <= 0 || u >= 1 ? 0 : u < 0.3 ? minJerk(u / 0.3) : u > 0.7 ? 1 - minJerk((u - 0.7) / 0.3) : 1
function axisAngle(axis: 0 | 1 | 2, degrees: number): Quat {
  const s = Math.sin(degrees * Math.PI / 360)
  return [axis === 0 ? s : 0, axis === 1 ? s : 0, axis === 2 ? s : 0, Math.cos(degrees * Math.PI / 360)]
}

interface Body {
  readonly acts?: readonly Act[]
  /** Movements without a marker: [act, start time]. */
  readonly unmarked?: readonly [BodyActId, number][]
  readonly rest?: readonly { t: number, state: BodyRest }[]
  readonly scenario?: 'idle' | 'talk'
  readonly actsSwitch?: 'off'
  readonly gitSha?: string
  /** Root yaw (rad) and hips position (L) of the run; zero by default. */
  readonly yaw?: (t: number) => number
  readonly hips?: (t: number) => Vec3
}

/** A standing body with a slow trunk sway; each act's movement bends its key bones and returns, through the hierarchy. */
function trace(body: Body): DecodedMotionTrace {
  const plays = [
    ...(body.acts ?? []).flatMap(act => act.moves === null ? [] : [{ moves: act.moves ?? act.id, at: act.at, scale: act.scale ?? 1 }]),
    ...(body.unmarked ?? []).map(([moves, at]) => ({ moves, at, scale: 1 })),
  ]
  const local = (bone: MotionTraceBone, t: number): Quat => plays.reduce<Quat>((q, play) => {
    const w = hold((t - play.at) / ACT_SECONDS) * play.scale
    return (MOVEMENTS[play.moves] ?? []).reduce<Quat>((r, [b, axis, deg]) => b === bone && w > 0 ? multiply(r, axisAngle(axis, deg * w)) : r, q)
  }, bone === 'spine' ? axisAngle(1, 1.2 * Math.sin(2 * Math.PI * 0.2 * t)) : [0, 0, 0, 1])
  const world = (bone: MotionTraceBone, t: number): Quat => {
    const parent = PARENTS[TEST_BONES.indexOf(bone)]
    return parent < 0 ? local(bone, t) : multiply(world(TEST_BONES[parent], t), local(bone, t))
  }
  const events: MotionTraceEvent[] = [
    ...(body.acts ?? []).flatMap((act): MotionTraceEvent[] => [
      { t: act.at, kind: 'marker', label: `act:${act.id}:playing` },
      { t: act.at + ACT_SECONDS, kind: 'marker', label: `act:${act.id}:${act.state ?? 'finished'}` },
    ]),
    ...(body.rest ?? []).map((change): MotionTraceEvent => ({ t: change.t, kind: 'marker', label: `rest:${change.state}` })),
  ].sort((a, b) => a.t - b.t)
  const input = analyticTrace({ seconds: 42, bones: TEST_BONES, scenario: body.scenario ?? 'idle', events, world, yaw: body.yaw, position: body.hips })
  const detail: Record<string, string> = body.actsSwitch ? { acts: body.actsSwitch } : {}
  const source = { ...input.trace.source, gitSha: body.gitSha ?? 'abc123', detail }
  return { ...input, trace: { ...input.trace, source } }
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

  it('fails the same movement played twice in a row under two act ids', () => {
    const r = report({ acts: [...SIX.slice(0, 4), { id: 'look-around', at: 28 }, { id: 'hair-tuck', at: 34, moves: 'look-around' }] })
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
