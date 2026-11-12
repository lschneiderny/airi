import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { resolve } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { loadBands } from '../gate/load'
import { analyticTrace } from '../metrics/test-trace'
import { ReportUsageError } from './report'
import { restReport } from './rest'
import { loadedRun, moves, rotX, TEST_BONES } from './test-runs'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
let bands: Awaited<ReturnType<typeof loadBands>>
beforeAll(async () => {
  bands = await loadBands(repoRoot)
})

const DEG = Math.PI / 180
/** Trace seconds: the director's rest onset is 120 s after the trace starts (IDLE_TO_SIT_MS). */
const CUES = { idle: 110, onset: 120, away: 140, wake: 180, end: 196 } as const

interface Sleepy {
  readonly fallback?: boolean
  /** The rest and doze markers without the posture: a standing body. */
  readonly markersOnly?: boolean
  /** Pelvis drop in doze, L. */
  readonly drop?: number
  /** She stays in the doze posture after the listening cue. */
  readonly staysDown?: boolean
  /** A one-frame head step at the listening cue, degrees. */
  readonly wakeStep?: number
  readonly stance?: boolean
  readonly cues?: { readonly idle: number, readonly away: number, readonly wake: number }
}

/**
 * The sleepy-no-clip timeline over a standing idle with a slow head and pelvis sway. With the fallback: the 4f rest
 * posture from the onset (head and torso lower +3 deg over the 1.5 s ramp), the doze from the away cue (the head sinks to
 * +18 deg over 4 s, the pelvis 0.012 L lower), and a 1.5 s minimum-jerk return to standing at the listening cue.
 */
function sleepy(options: Sleepy = {}) {
  const fallback = options.fallback ?? true
  const posed = fallback && !options.markersOnly
  const cues = options.cues ?? CUES
  const step = options.wakeStep ?? 0
  const back = options.staysDown ? 0 : 1
  const rest = moves([{ start: CUES.onset, duration: 1.5, by: 3 * DEG }, { start: cues.wake, duration: 1.5, by: -3 * DEG * back }])
  const sink = moves([{ start: cues.away, duration: 4, by: 15 * DEG }, { start: cues.wake, duration: 1.5, by: -(15 - step) * DEG * back }])
  const drop = moves([{ start: cues.away, duration: 1.5, by: options.drop ?? 0.012 }, { start: cues.wake, duration: 1.5, by: -(options.drop ?? 0.012) * back }])
  const sway = (t: number) => DEG * Math.sin(2 * Math.PI * 0.1 * t)
  const head = (t: number) => sway(t) + (posed ? rest(t) + sink(t) : 0) - (t >= cues.wake ? step * DEG : 0)
  const modes: MotionTraceEvent[] = [
    { t: cues.idle, kind: 'mode', mode: 'idle' },
    { t: cues.away, kind: 'mode', mode: 'away' },
    { t: cues.wake, kind: 'mode', mode: 'listening' },
  ]
  const events: MotionTraceEvent[] = [
    ...modes,
    ...(options.stance ?? true)
      ? (fallback
          ? [[0, 'no-sit-slot'], [CUES.onset, 'rest-fallback'], [cues.away, 'doze-fallback'], [cues.wake, 'active']] as const
          : [[0, 'no-sit-slot'], [cues.away, 'no-sleep-slot'], [cues.wake, 'active']] as const
        ).map(([t, reason]): MotionTraceEvent => ({ t, kind: 'marker', label: `stance:${reason}` }))
      : [],
    ...fallback
      ? ([[CUES.onset, 'rest'], [cues.away, 'doze'], [cues.wake, 'none']] as const).map(([t, state]): MotionTraceEvent => ({ t, kind: 'marker', label: `rest:${state}` }))
      : [],
  ].sort((a, b) => a.t - b.t)
  const input = analyticTrace({
    seconds: CUES.end,
    bones: TEST_BONES,
    scenario: 'idle',
    events,
    position: t => [0, 0.001 * Math.sin(2 * Math.PI * 0.05 * t) - (posed ? drop(t) : 0), 0],
    world: (bone, t) => bone === 'head'
      ? rotX(head(t))
      : bone === 'spine'
        ? rotX(posed ? rest(t) : 0)
        : bone.endsWith('UpperArm') ? rotX(0.4 * Math.sin(2 * Math.PI * 0.4 * t)) : [0, 0, 0, 1],
  })
  input.trace.scoredFrom = cues.idle
  return loadedRun(input, null, null)
}

const statuses = (report: ReturnType<typeof restReport>) => Object.fromEntries(report.requirements.map(r => [r.id, r.status]))
const STOPPED = { 'doze-head': 'NOT-EXERCISED' } as const

describe('rest report', () => {
  it('passes every judged requirement for the 4f rest, doze and return, and holds the doze head as not judged', () => {
    const report = restReport(sleepy(), bands)
    expect(statuses(report)).toEqual({ 'fallback-active': 'PASS', 'rest-posture': 'PASS', 'doze-pelvis': 'PASS', ...STOPPED, 'returned': 'PASS', 'wake-smooth': 'PASS', 'reasons': 'PASS' })
    expect(report.verdict).toBe('FAIL')
  })

  it('fails rest and doze markers over a standing body', () => {
    const s = statuses(restReport(sleepy({ markersOnly: true }), bands))
    expect([s['fallback-active'], s['rest-posture'], s['doze-pelvis']]).toEqual(['PASS', 'FAIL', 'FAIL'])
  })

  it('fails a pelvis drop below half the 4f doze drop', () => {
    expect(statuses(restReport(sleepy({ drop: 0.005 }), bands))['doze-pelvis']).toBe('FAIL')
  })

  it('fails a body that stays down after the listening cue, and does not judge its wake as smooth', () => {
    const s = statuses(restReport(sleepy({ staysDown: true }), bands))
    expect([s.returned, s['wake-smooth']]).toEqual(['FAIL', 'NOT-EXERCISED'])
  })

  it('fails a one-frame 5 degree head step at the listening cue', () => {
    expect(statuses(restReport(sleepy({ wakeStep: 5 }), bands))['wake-smooth']).toBe('FAIL')
  })

  it('fails a run without the fallback and reports what needs it as not exercised', () => {
    const report = restReport(sleepy({ fallback: false }), bands)
    expect(statuses(report)).toEqual({ 'fallback-active': 'FAIL', 'rest-posture': 'NOT-EXERCISED', 'doze-pelvis': 'NOT-EXERCISED', ...STOPPED, 'returned': 'NOT-EXERCISED', 'wake-smooth': 'NOT-EXERCISED', 'reasons': 'FAIL' })
  })

  it('refuses a trace without stance markers and one whose rest onset is not before the away cue', () => {
    expect(() => restReport(sleepy({ stance: false }), bands)).toThrow(ReportUsageError)
    expect(() => restReport(sleepy({ cues: { idle: 0, away: 40, wake: 80 } }), bands)).toThrow(ReportUsageError)
  })
})
