import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { PreparedTrace, Region, Segment } from './types'

import { activity } from './core'
import { cv, HZ, mean, median } from './math'
import { result, skipped, windowResult } from './result'
import { placeWindows, segment } from './segments'

export function eligibleSegments(p: PreparedTrace, speed: readonly number[], threshold: number): Segment[] {
  return p.eligibleSpans.flatMap(s => segment(speed.slice(s.start, s.end), threshold).map(v => ({ ...v, start: s.start + v.start, end: s.start + v.end })))
}

/** M6 / 10.4: CV(S); hold time/W; move onsets*60/W. Window edges do not create new onsets. */
export function intermittencyMetrics(p: PreparedTrace, moveSpeed: number) {
  const segments = eligibleSegments(p, p.bodySpeed, moveSpeed)
  const moves = segments.filter(s => s.moving)
  const metrics = [
    windowResult(p, 'inter.speedCv', 'ratio', s => cv(p.bodySpeed.slice(s.start, s.end))),
    windowResult(p, 'inter.holdFraction', 'fraction', s => segments.filter(m => !m.moving).reduce((sum, m) => sum + Math.max(0, Math.min(s.end, m.end) - Math.max(s.start, m.start)), 0) / (s.end - s.start)),
    windowResult(p, 'inter.movesPerMin', 'per-minute', s => moves.filter(m => m.start >= s.start && m.start < s.end).length * 60 / p.windowSeconds),
  ]
  // M6: burstCv = CV of six 10 s RMS body speeds, median across 60 s windows; report only.
  const burst = placeWindows(p.eligibleSpans, 60).flatMap((s) => {
    const value = cv(Array.from({ length: 6 }, (_, i) => Math.sqrt(mean(p.bodySpeed.slice(s.start + i * 600, s.start + (i + 1) * 600).map(v => v * v)))))
    return value === null ? [] : [{ ...s, value }]
  })
  metrics.push(burst.length ? result('inter.burstCv', 'ratio', 'trace', median(burst.map(s => s.value)), 'ok', 'report-only', burst) : skipped('inter.burstCv', 'ratio', 'trace', 'insufficient-duration'))
  // M6: CV of whole move durations, >=5 moves; unit ratio, report only.
  metrics.push(moves.length === 0
    ? result('inter.moveDurationCv', 'ratio', 'trace', null)
    : moves.length < 5
      ? skipped('inter.moveDurationCv', 'ratio', 'trace', 'insufficient-moves')
      : result('inter.moveDurationCv', 'ratio', 'trace', cv(moves.map(s => (s.end - s.start) / HZ))))
  return metrics
}

/**
 * Raw per-clip detector inputs: median of window RMS / window median speeds, no fitting.
 * Empty window sets return no activity values and null speeds, never artificial zero floors.
 */
export function detectorQuantities(p: PreparedTrace): {
  readonly activity: Readonly<Partial<Record<MotionTraceBone, number>>>
  readonly medianSpeed: Readonly<Record<Region | 'body', number | null>>
  readonly windows: readonly { readonly start: number, readonly end: number, readonly activity: Readonly<Partial<Record<MotionTraceBone, number>>>, readonly medianBodySpeed: number, readonly medianRegionSpeed: Readonly<Record<Region, number>> }[]
} {
  const regionMedians = (s: { start: number, end: number }): Record<Region, number> => ({
    head: median(p.regionSpeed.head.slice(s.start, s.end)),
    trunk: median(p.regionSpeed.trunk.slice(s.start, s.end)),
    armL: median(p.regionSpeed.armL.slice(s.start, s.end)),
    armR: median(p.regionSpeed.armR.slice(s.start, s.end)),
    legs: median(p.regionSpeed.legs.slice(s.start, s.end)),
  })
  const measured = p.windows.map(s => ({ ...s, activity: activity(p, s), medianBodySpeed: median(p.bodySpeed.slice(s.start, s.end)), medianRegionSpeed: regionMedians(s) }))
  const speed = (r: Region) => measured.length ? median(measured.map(s => s.medianRegionSpeed[r])) : null
  return {
    activity: Object.fromEntries(measured.length ? p.input.trace.rig.bones.map(b => [b, median(measured.map(s => s.activity[b] ?? 0))]) : []),
    medianSpeed: { body: measured.length ? median(measured.map(s => s.medianBodySpeed)) : null, head: speed('head'), trunk: speed('trunk'), armL: speed('armL'), armR: speed('armR'), legs: speed('legs') },
    windows: measured,
  }
}
