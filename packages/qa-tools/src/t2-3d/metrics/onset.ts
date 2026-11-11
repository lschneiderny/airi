import type { DetectorParameters, MetricResult, MetricSample, PreparedTrace, Vec3 } from './types'

import { REGIONS } from './bones'
import { integratedEpisode } from './gaze'
import { add, dot, HZ, scale } from './math'
import { regionSpeed } from './prepare'
import { episodeResult } from './result'
import { episodes } from './segments'

/**
 * S4 / 10.3: attack=(tp-t0)/(t1-t0); anticipation=opposing pre-onset angle >=3% of net.
 * easedOrAnticipated=mean(attack>=50ms OR anticipation); anticipationRate=mean(anticipation).
 * Unit fraction for all three. Use F15 speeds and episodes .2..3 s.
 */
export function onsetMetrics(p: PreparedTrace, params: DetectorParameters): MetricResult[] {
  const attack: MetricSample[] = []
  const eased: MetricSample[] = []
  const anticipations: MetricSample[] = []
  for (const region of ['head', 'armL', 'armR'] as const) {
    const series = REGIONS[region].flatMap(b => p.o15[b] ? [p.o15[b]] : [])
    const speed = regionSpeed(p.o15, REGIONS[region], p.bodySpeed.length)
    // Region axis uses the mean angular velocity of its present joints, so it is renderer-neutral.
    const vector = speed.map((_, i) => scale(series.reduce<Vec3>((s, v) => add(s, v[i]), [0, 0, 0]), 1 / Math.max(1, series.length)))
    for (const e of episodes(speed, 3 * params.moveSpeed[region])) {
      const duration = (e.end - e.start) / HZ
      if (duration < 0.2 || duration > 3)
        continue
      const motion = integratedEpisode(vector, e)
      if (!motion)
        continue
      let integral = 0
      let maximum = 0
      let opposing = 0
      for (let i = Math.max(0, e.start - Math.round(0.3 * HZ)); i < e.start; i++) {
        integral += dot(vector[i], motion.axis) / HZ
        maximum = Math.max(maximum, integral)
        opposing = Math.max(opposing, maximum - integral)
      }
      const anticipation = opposing >= 0.03 * motion.angle
      attack.push({ ...e, value: (e.peak - e.start) / (e.end - e.start) })
      eased.push({ ...e, value: (e.peak - e.start) / HZ >= 0.05 || anticipation ? 1 : 0 })
      anticipations.push({ ...e, value: anticipation ? 1 : 0 })
    }
  }
  return [
    episodeResult(p, 'onset.attackFraction', 'fraction', attack),
    episodeResult(p, 'onset.easedOrAnticipated', 'fraction', eased, true),
    episodeResult(p, 'onset.anticipationRate', 'fraction', anticipations, true),
  ]
}
