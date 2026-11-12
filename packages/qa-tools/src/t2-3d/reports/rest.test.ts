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
  /** A one-frame head step at the listening cue, degrees. */
  readonly wakeStep?: number
  readonly stance?: boolean
  readonly cues?: { readonly idle: number, readonly away: number, readonly wake: number }
}

/**
 * The sleepy-no-clip timeline. With the fallback: rest from the onset, doze from the away cue with the head sunk 18 degrees
 * and the pelvis 0.012 L lower, and a 1.5 s minimum-jerk return at the listening cue. The arms swing slowly throughout.
 */
function sleepy(options: Sleepy = {}) {
  const fallback = options.fallback ?? true
  const cues = options.cues ?? CUES
  const step = options.wakeStep ?? 0
  const sink = moves([{ start: cues.away, duration: 4, by: 18 * DEG }, { start: cues.wake, duration: 1.5, by: -(18 - step) * DEG }])
  const head = (t: number) => !fallback ? 0 : sink(t) - (t >= cues.wake ? step * DEG : 0)
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
    position: t => [0, fallback && t >= cues.away && t < cues.wake ? -0.012 : 0, 0],
    world: (bone, t) => bone === 'head'
      ? rotX(head(t))
      : bone.endsWith('UpperArm') ? rotX(0.4 * Math.sin(2 * Math.PI * 0.4 * t)) : [0, 0, 0, 1],
  })
  input.trace.scoredFrom = cues.idle
  return loadedRun(input, null, null)
}

const statuses = (report: ReturnType<typeof restReport>) => report.requirements.map(r => r.status)

describe('rest report', () => {
  it('passes rest and doze fallbacks with a sunk head, a lower pelvis and a smooth return', () => {
    expect(statuses(restReport(sleepy(), bands))).toEqual(['PASS', 'PASS', 'PASS'])
  })

  it('fails a one-frame 5 degree head step at the listening cue', () => {
    expect(statuses(restReport(sleepy({ wakeStep: 5 }), bands))).toEqual(['PASS', 'FAIL', 'PASS'])
  })

  it('fails a run without the fallback and reports the return as not exercised', () => {
    const report = restReport(sleepy({ fallback: false }), bands)
    expect(statuses(report)).toEqual(['FAIL', 'NOT-EXERCISED', 'FAIL'])
    expect(report.verdict).toBe('FAIL')
  })

  it('refuses a trace without stance markers and one whose rest onset is not before the away cue', () => {
    expect(() => restReport(sleepy({ stance: false }), bands)).toThrow(ReportUsageError)
    expect(() => restReport(sleepy({ cues: { idle: 0, away: 40, wake: 80 } }), bands)).toThrow(ReportUsageError)
  })
})
