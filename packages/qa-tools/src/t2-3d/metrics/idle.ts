import type { DetectorParameters, MetricResult, PreparedTrace, Region } from './types'

import { REGIONS } from './bones'
import { eligibleSegments } from './intermittency'
import { cv, DEG, HZ, norm } from './math'
import { result, skipped } from './result'

/**
 * S6 / 10.4: acts are regional moves with peak>=3*hi and some bone's net turn>=3deg.
 * Count*60/scored seconds (per-minute); -sum(p ln p)/ln5 (fraction); CV(onset intervals) (ratio).
 * All are report-only; the old 60 s minimum is removed by 10.4.
 */
export function idleMetrics(p: PreparedTrace, params: DetectorParameters): MetricResult[] {
  const acts: { start: number, region: Region }[] = []
  for (const region of ['head', 'trunk', 'armL', 'armR', 'legs'] as const) {
    for (const s of eligibleSegments(p, p.regionSpeed[region], params.moveSpeed[region])) {
      if (!s.moving || Math.max(...p.regionSpeed[region].slice(s.start, s.end)) < 4.5 * params.moveSpeed[region])
        continue
      const turned = REGIONS[region].some((b) => {
        const v = p.o6[b]
        if (!v)
          return false
        const sum: [number, number, number] = [0, 0, 0]
        for (let i = s.start; i < s.end; i++) {
          for (let j = 0; j < 3; j++)
            sum[j] += v[i][j] / HZ
        }
        return norm(sum) * DEG >= 3
      })
      if (turned)
        acts.push({ start: s.start, region })
    }
  }
  acts.sort((a, b) => a.start - b.start)
  const seconds = p.eligibleSpans.reduce((s, v) => s + v.end - v.start, 0) / HZ
  const probabilities = Object.keys(REGIONS).map(r => acts.filter(a => a.region === r).length / acts.length)
  return [
    result('idle.actsPerMin', 'per-minute', 'trace', seconds > 0 ? acts.length * 60 / seconds : null),
    result('idle.regionEntropy', 'fraction', 'trace', acts.length ? -probabilities.reduce((s, p) => p > 0 ? s + p * Math.log(p) : s, 0) / Math.log(5) : null),
    acts.length < 6 ? skipped('idle.intervalCv', 'ratio', 'trace', 'insufficient-acts') : result('idle.intervalCv', 'ratio', 'trace', cv(acts.slice(1).map((a, i) => (a.start - acts[i].start) / HZ))),
  ]
}
