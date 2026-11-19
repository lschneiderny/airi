import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { resolve } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { loadBands } from '../gate/load'
import { idleDriveDetail, QA_DRIVE_AWAY } from '../idle-drive'
import { multiply } from '../metrics/math'
import { analyticTrace } from '../metrics/test-trace'
import { ReportUsageError } from './report'
import { restReport } from './rest'
import { loadedRun, moves, rotX, rotY, TEST_BONES } from './test-runs'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
let bands: Awaited<ReturnType<typeof loadBands>>
beforeAll(async () => {
  bands = await loadBands(repoRoot)
})

const DEG = Math.PI / 180
/** Trace seconds: the director's rest onset is 120 s after the trace starts (IDLE_TO_SIT_MS). */
const CUES = { idle: 110, onset: 120, away: 140, wake: 180, end: 196 } as const
/** S1: the scheduler falls asleep and the body dozes 15 s after the away cue, 25 s before the wake cue (amendment 3). */
const ASLEEP = CUES.away + 15

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
  /** Gaze shifts go on while dozing: a 12 deg head yaw step every 5 s, each in 0.3 s. */
  readonly gaze?: boolean
  /** A slow head scan while dozing: 30 deg over 4 s and back, from 5 s into the doze. */
  readonly scan?: boolean
  /** A `gaze-shift` marker 10 s into the doze, with this amplitude in degrees. */
  readonly shiftMarker?: number
  readonly cues?: { readonly idle: number, readonly away: number, readonly wake: number }
  /** The provenance names the sleepy QA drive; without it the scheduler reports nothing. */
  readonly drive?: boolean
  /** The scheduler's sleep start, trace s. */
  readonly sleep?: number
  /** The scheduler's sleep end before the wake cue, trace s; none by default. */
  readonly sleepEnds?: number
  /** The body's doze start, trace s. */
  readonly doze?: number
  /** The body leaves doze for rest at this trace s, before the wake cue; never by default. */
  readonly dozeLeaves?: number
  /** The body rests but never dozes. */
  readonly neverDozes?: boolean
}

/**
 * The sleepy-no-clip timeline over a standing idle with a slow head and pelvis sway. With the fallback: the 4f rest
 * posture from the rest onset (head and torso lower +3 deg over the 1.5 s ramp), the doze from the body's doze start
 * (the head sinks to +18 deg over 4 s, the pelvis 0.012 L lower), and a 1.5 s minimum-jerk return to standing at the
 * listening cue. With the drive, the scheduler reports its sleep start.
 */
function sleepy(options: Sleepy = {}) {
  const fallback = options.fallback ?? true
  const posed = fallback && !options.markersOnly
  const cues = options.cues ?? CUES
  const drive = options.drive ?? true
  const doze = options.doze ?? ASLEEP
  const step = options.wakeStep ?? 0
  const back = options.staysDown ? 0 : 1
  const rest = moves([{ start: CUES.onset, duration: 1.5, by: 3 * DEG }, { start: cues.wake, duration: 1.5, by: -3 * DEG * back }])
  const sink = moves([{ start: doze, duration: 4, by: 15 * DEG }, { start: cues.wake, duration: 1.5, by: -(15 - step) * DEG * back }])
  const drop = moves([{ start: doze, duration: 1.5, by: options.drop ?? 0.012 }, { start: cues.wake, duration: 1.5, by: -(options.drop ?? 0.012) * back }])
  const sway = (t: number) => DEG * Math.sin(2 * Math.PI * 0.1 * t)
  const head = (t: number) => sway(t) + (posed ? rest(t) + sink(t) : 0) - (t >= cues.wake ? step * DEG : 0)
  const steps = moves(Array.from({ length: 4 }, (_, k) => ({ start: doze + 5 + 5 * k, duration: 0.3, by: (k % 2 ? -12 : 12) * DEG })))
  const scan = moves([{ start: doze + 5, duration: 4, by: 30 * DEG }, { start: doze + 9, duration: 4, by: -30 * DEG }])
  const yaw = (t: number) => (options.gaze ? steps(t) : 0) + (options.scan ? scan(t) : 0)
  const modes: MotionTraceEvent[] = [
    { t: cues.idle, kind: 'mode', mode: 'idle' },
    { t: cues.away, kind: 'mode', mode: 'away' },
    { t: cues.wake, kind: 'mode', mode: 'listening' },
  ]
  const rests = [[CUES.onset, 'rest'], ...options.neverDozes ? [] : [[doze, 'doze'] as const], ...options.dozeLeaves === undefined ? [] : [[options.dozeLeaves, 'rest'] as const], [cues.wake, 'none']] as const
  const events: MotionTraceEvent[] = [
    ...modes,
    ...(options.stance ?? true)
      ? (fallback
          ? [[0, 'no-sit-slot'], [CUES.onset, 'rest-fallback'], [cues.away, 'doze-fallback'], [cues.wake, 'active']] as const
          : [[0, 'no-sit-slot'], [cues.away, 'no-sleep-slot'], [cues.wake, 'active']] as const
        ).map(([t, reason]): MotionTraceEvent => ({ t, kind: 'marker', label: `stance:${reason}` }))
      : [],
    ...fallback ? rests.map(([t, state]): MotionTraceEvent => ({ t, kind: 'marker', label: `rest:${state}` })) : [],
    ...drive
      ? [
          { t: options.sleep ?? ASLEEP, kind: 'marker', label: 'idle:sleep:start' } satisfies MotionTraceEvent,
          ...options.sleepEnds === undefined ? [] : [{ t: options.sleepEnds, kind: 'marker', label: 'idle:sleep:end' } satisfies MotionTraceEvent],
        ]
      : [],
    ...options.shiftMarker === undefined ? [] : [{ t: doze + 10, kind: 'marker', label: `gaze-shift:${options.shiftMarker.toFixed(2)}:+0.00:free` } satisfies MotionTraceEvent],
  ].sort((a, b) => a.t - b.t)
  const input = analyticTrace({
    seconds: CUES.end,
    bones: TEST_BONES,
    scenario: 'idle',
    events,
    position: t => [0, 0.001 * Math.sin(2 * Math.PI * 0.05 * t) - (posed ? drop(t) : 0), 0],
    world: (bone, t) => bone === 'head'
      ? multiply(rotY(yaw(t)), rotX(head(t)))
      : bone === 'spine'
        ? rotX(posed ? rest(t) : 0)
        : bone.endsWith('UpperArm') ? rotX(0.4 * Math.sin(2 * Math.PI * 0.4 * t)) : [0, 0, 0, 1],
  })
  input.trace.scoredFrom = cues.idle
  input.trace.source.detail = drive ? idleDriveDetail(QA_DRIVE_AWAY) : {}
  return loadedRun(input, null, null)
}

const statuses = (report: ReturnType<typeof restReport>) => Object.fromEntries(report.requirements.map(r => [r.id, r.status]))
const DOZE_LINES = ['doze-share', 'doze-unbroken', 'doze-pelvis', 'doze-no-gaze-shift', 'reasons'] as const

describe('rest report version 5', () => {
  it('s1: passes every judged line for the drive, the rest, a sleep onset 15 s after away, an unbroken doze and the return, and holds the doze head as not judged', () => {
    const report = restReport(sleepy(), bands)
    expect(statuses(report)).toEqual({ 'drive': 'PASS', 'rest-share': 'PASS', 'sleep-onset': 'PASS', 'doze-share': 'PASS', 'doze-unbroken': 'PASS', 'rest-posture': 'PASS', 'doze-pelvis': 'PASS', 'doze-head': 'NOT-EXERCISED', 'doze-no-gaze-shift': 'PASS', 'returned': 'PASS', 'wake-smooth': 'PASS', 'reasons': 'PASS' })
    expect(report.verdict).toBe('FAIL')
  })

  it('s2: fails a run without the drive and without a sleep, and reads the doze lines as not exercised', () => {
    const s = statuses(restReport(sleepy({ drive: false }), bands))
    expect([s.drive, s['sleep-onset']]).toEqual(['FAIL', 'FAIL'])
    expect(DOZE_LINES.map(id => s[id])).toEqual(DOZE_LINES.map(() => 'NOT-EXERCISED'))
  })

  it('s3, s4: fails a sleep onset 35 s after the away cue and passes one 29.9 s after it', () => {
    const onset = (after: number) => statuses(restReport(sleepy({ sleep: CUES.away + after }), bands))['sleep-onset']
    expect([onset(35), onset(29.9)]).toEqual(['FAIL', 'PASS'])
  })

  it('s5: fails a doze that the scheduler ends 10 s before the wake cue', () => {
    expect(statuses(restReport(sleepy({ sleepEnds: CUES.wake - 10 }), bands))['doze-unbroken']).toBe('FAIL')
  })

  it('s6: fails a body that leaves the doze 2 s before the wake cue, though its doze share passes', () => {
    const s = statuses(restReport(sleepy({ dozeLeaves: CUES.wake - 2 }), bands))
    expect([s['doze-unbroken'], s['doze-share']]).toEqual(['FAIL', 'PASS'])
  })

  it('r1, r2: reads the doze as not exercised when the body never dozes under an unbroken sleep, and fails a sleep the scheduler breaks', () => {
    const unbroken = (options: Sleepy) => statuses(restReport(sleepy({ neverDozes: true, ...options }), bands))['doze-unbroken']
    expect([unbroken({}), unbroken({ sleepEnds: CUES.wake - 10 })]).toEqual(['NOT-EXERCISED', 'FAIL'])
  })

  it('s7: fails a body whose doze starts 5 s after the sleep onset, 80 % of the span', () => {
    const s = statuses(restReport(sleepy({ doze: ASLEEP + 5 }), bands))
    expect([s['doze-share'], s['doze-unbroken']]).toEqual(['FAIL', 'PASS'])
  })

  it('s8: fails gaze shifts while dozing, read from the head yaw or reported by a gaze-shift marker of 10 deg or more', () => {
    const noGaze = (options: Sleepy) => statuses(restReport(sleepy(options), bands))['doze-no-gaze-shift']
    expect([noGaze({ gaze: true }), noGaze({ shiftMarker: 12 }), noGaze({ shiftMarker: 5 }), noGaze({ scan: true })]).toEqual(['FAIL', 'FAIL', 'PASS', 'FAIL'])
  })

  it('s8: fails rest and doze markers over a standing body', () => {
    const s = statuses(restReport(sleepy({ markersOnly: true }), bands))
    expect([s['rest-share'], s['doze-share'], s['rest-posture'], s['doze-pelvis']]).toEqual(['PASS', 'PASS', 'FAIL', 'FAIL'])
  })

  it('s8: fails a pelvis drop below half the 4f doze drop', () => {
    expect(statuses(restReport(sleepy({ drop: 0.005 }), bands))['doze-pelvis']).toBe('FAIL')
  })

  it('s8: fails a body that stays down after the listening cue, and does not judge its wake as smooth', () => {
    const s = statuses(restReport(sleepy({ staysDown: true }), bands))
    expect([s.returned, s['wake-smooth']]).toEqual(['FAIL', 'NOT-EXERCISED'])
  })

  it('s8: fails a one-frame 5 degree head step at the listening cue', () => {
    expect(statuses(restReport(sleepy({ wakeStep: 5 }), bands))['wake-smooth']).toBe('FAIL')
  })

  it('s8: fails a run without the fallback and reports what needs a rest or doze frame as not exercised', () => {
    const s = statuses(restReport(sleepy({ fallback: false }), bands))
    expect(s).toEqual({ 'drive': 'PASS', 'rest-share': 'FAIL', 'sleep-onset': 'PASS', 'doze-share': 'FAIL', 'doze-unbroken': 'NOT-EXERCISED', 'rest-posture': 'NOT-EXERCISED', 'doze-pelvis': 'NOT-EXERCISED', 'doze-head': 'NOT-EXERCISED', 'doze-no-gaze-shift': 'NOT-EXERCISED', 'returned': 'NOT-EXERCISED', 'wake-smooth': 'NOT-EXERCISED', 'reasons': 'FAIL' })
  })

  it('refuses a trace without stance markers and one whose rest onset is not before the away cue', () => {
    expect(() => restReport(sleepy({ stance: false }), bands)).toThrow(ReportUsageError)
    expect(() => restReport(sleepy({ cues: { idle: 0, away: 40, wake: 80 } }), bands)).toThrow(ReportUsageError)
  })
})
