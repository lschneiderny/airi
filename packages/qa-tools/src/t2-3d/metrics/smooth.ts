import type { DetectorParameters, MetricResult, PreparedTrace, Vec3 } from './types'

import { filterVectors } from './filter'
import { eligibleSegments } from './intermittency'
import { finite, heading, HZ, median, norm, scale, sub, sum } from './math'
import { episodeResult, result, skipped } from './result'

/** M5: g=H(w_target-w_chest), F15; LDLJ=-ln(integral |g''|^2 dt * D^3/peak^2), unitless. */
export function smoothMetrics(p: PreparedTrace, params: DetectorParameters): MetricResult[] {
  return ([
    ['head', 'head'],
    ['armL', 'leftLowerArm'],
    ['armR', 'rightLowerArm'],
  ] as const).flatMap(([region, bone]) => {
    const target = p.worldVelocity[bone]
    const chest = p.worldVelocity.chest
    if (!target || !chest)
      return ['ldlj', 'spikeRate'].map(key => skipped(`smooth.${region}.${key}`, key === 'ldlj' ? 'log-ratio' : 'per-minute', key === 'ldlj' ? 'episode' : 'trace', 'bones-absent'))
    const g = filterVectors(target.map((v, i) => heading(sub(v, chest[i]), p.yaw[i])), 15)
    const moves = eligibleSegments(p, p.regionSpeed[region], params.moveSpeed[region]).filter(s => s.moving)
    const values = moves.filter(s => s.end - s.start >= 0.2 * HZ).flatMap((s) => {
      const jerk: Vec3[] = []
      for (let i = s.start + 1; i < s.end - 1; i++)
        jerk.push(scale(sub(sub(g[i + 1], g[i]), sub(g[i], g[i - 1])), HZ * HZ))
      const j = sum(jerk.map(v => norm(v) ** 2)) / HZ
      const peak = Math.max(...g.slice(s.start, s.end).map(norm))
      if (j === 0 || peak === 0)
        return []
      const ratio = finite(finite(j * ((s.end - s.start) / HZ) ** 3, 'jerk duration product') / finite(peak * peak, 'smoothness peak energy'), 'smoothness ratio')
      return ratio === 0 ? [] : [{ start: s.start, end: s.end, value: finite(-Math.log(ratio), 'log smoothness') }]
    })
    const ldlj = moves.length ? episodeResult(p, `smooth.${region}.ldlj`, 'log-ratio', values) : result(`smooth.${region}.ldlj`, 'log-ratio', 'episode', null)
    // M5 / 10.4: count runs of |g'| > median + 10*(1.4826*MAD+1e-6), per minute MOVING.
    const acceleration = moves.flatMap(s => Array.from({ length: Math.max(0, s.end - s.start - 1) }, (_, i) => norm(sub(g[s.start + i + 1], g[s.start + i])) * HZ))
    const movingSamples = moves.reduce((n, s) => n + s.end - s.start, 0)
    if (movingSamples < 3 * HZ)
      return [ldlj, skipped(`smooth.${region}.spikeRate`, 'per-minute', 'trace', 'insufficient-moving-time')]
    const m = median(acceleration)
    const sigma = 1.4826 * median(acceleration.map(v => Math.abs(v - m))) + 1e-6
    let spikes = 0
    for (const s of moves) {
      let high = false
      for (let i = s.start; i < s.end - 1; i++) {
        const spike = norm(sub(g[i + 1], g[i])) * HZ > m + 10 * sigma
        if (spike && !high)
          spikes++
        high = spike
      }
    }
    return [ldlj, result(`smooth.${region}.spikeRate`, 'per-minute', 'trace', spikes * 60 * HZ / movingSamples)]
  })
}
