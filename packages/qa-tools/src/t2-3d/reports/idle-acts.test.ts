import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { BodyActId, BodyRest } from '@proj-airi/motion-driver-humanoid/performance'

import { describe, expect, it } from 'vitest'

import { analyticTrace } from '../metrics/test-trace'
import { idleActsReport } from './idle-acts'
import { ReportUsageError } from './report'
import { loadedRun, rotX, rotY, TEST_BONES } from './test-runs'

interface Act {
  readonly id: BodyActId
  readonly at: number
  readonly state?: 'finished' | 'cancelled'
}

const ACT_SECONDS = 3
const MOVING: readonly MotionTraceBone[] = ['spine', 'head', 'leftUpperArm', 'rightUpperArm']
const SIX: readonly Act[] = [
  { id: 'wave', at: 4 },
  { id: 'arm-swing', at: 10 },
  { id: 'hand-inspect', at: 16 },
  { id: 'yawn', at: 22 },
  { id: 'look-around', at: 28 },
  { id: 'sigh', at: 34 },
]
const RESTING: readonly { t: number, state: BodyRest }[] = [{ t: 20, state: 'rest' }]

/** A standing body with a slow trunk sway; each act with motion bends the trunk, head and both upper arms and returns. */
function run(acts: readonly Act[], options: { rest?: readonly { t: number, state: BodyRest }[], still?: boolean, scenario?: 'idle' | 'talk' } = {}) {
  const bump = (t: number) => options.still
    ? 0
    : acts.reduce((sum, act) => {
        const u = (t - act.at) / ACT_SECONDS
        return u > 0 && u < 1 ? sum + 0.4 * Math.sin(Math.PI * u) ** 2 : sum
      }, 0)
  const events: MotionTraceEvent[] = [
    ...acts.flatMap((act): MotionTraceEvent[] => [
      { t: act.at, kind: 'marker', label: `act:${act.id}:playing` },
      { t: act.at + ACT_SECONDS, kind: 'marker', label: `act:${act.id}:${act.state ?? 'finished'}` },
    ]),
    ...(options.rest ?? []).map((change): MotionTraceEvent => ({ t: change.t, kind: 'marker', label: `rest:${change.state}` })),
  ].sort((a, b) => a.t - b.t)
  const input = analyticTrace({
    seconds: 42,
    bones: TEST_BONES,
    scenario: options.scenario ?? 'idle',
    events,
    world: (bone, t) => bone === 'spine'
      ? rotY(0.02 * Math.sin(2 * Math.PI * 0.2 * t) + bump(t))
      : MOVING.includes(bone) ? rotX(bump(t)) : [0, 0, 0, 1],
  })
  return loadedRun(input, null, null)
}

const status = (report: ReturnType<typeof idleActsReport>, id: string) => report.requirements.find(r => r.id === id)?.status

describe('idle-acts report', () => {
  it('passes six distinct acts confirmed by motion, three of them started while resting from the rest set', () => {
    const report = idleActsReport(run(SIX, { rest: RESTING }))
    expect(report.requirements.map(r => [r.id, r.status])).toEqual([['distinct-acts', 'PASS'], ['no-repeat', 'PASS'], ['rest-set', 'PASS']])
    expect(report.verdict).toBe('PASS')
  })

  it('does not count act markers without motion', () => {
    const report = idleActsReport(run(SIX, { still: true }))
    expect(status(report, 'distinct-acts')).toBe('FAIL')
    expect(report.detail.acts.every(act => !act.confirmed)).toBe(true)
  })

  it('does not count a cancelled act', () => {
    const report = idleActsReport(run(SIX.map((act): Act => act.id === 'sigh' ? { ...act, state: 'cancelled' } : act)))
    expect(status(report, 'distinct-acts')).toBe('FAIL')
    expect(report.requirements[0].value).toMatch(/^5 distinct/)
  })

  it('fails an immediate repeat, cancelled acts included', () => {
    const report = idleActsReport(run([{ id: 'arm-swing', at: 0.5, state: 'cancelled' }, ...SIX.slice(1), { id: 'wave', at: 38 }]))
    expect(status(report, 'distinct-acts')).toBe('PASS')
    expect(status(report, 'no-repeat')).toBe('FAIL')
  })

  it('judges acts started while resting against the rest set it is given, and fails any act while dozing', () => {
    expect(status(idleActsReport(run(SIX, { rest: RESTING }), ['sigh', 'yawn']), 'rest-set')).toBe('FAIL')
    expect(status(idleActsReport(run(SIX, { rest: [{ t: 20, state: 'doze' }] })), 'rest-set')).toBe('FAIL')
  })

  it('reports the repeat and rest-set rules as not exercised without acts, and fails the run', () => {
    const report = idleActsReport(run([]))
    expect(report.requirements.map(r => r.status)).toEqual(['FAIL', 'NOT-EXERCISED', 'NOT-EXERCISED'])
    expect(report.verdict).toBe('FAIL')
  })

  it('refuses a run that is not idle-class', () => {
    expect(() => idleActsReport(run(SIX, { scenario: 'talk' }))).toThrow(ReportUsageError)
  })
})
