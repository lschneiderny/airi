import type { DetectorParameters, Episode, MetricResult, MetricSample, PreparedTrace, Vec3 } from './types'

import { filterVectors } from './filter'
import { add, DEG, dot, heading, HZ, mean, norm, scale, sub } from './math'
import { headSignal } from './period'
import { episodeResult, skipped } from './result'
import { episode, episodes } from './segments'

/** S1: episode axis = unit integral h_vec; theta = integral h_vec dot axis, radians. */
export function integratedEpisode(signal: readonly Vec3[], e: Episode): { axis: Vec3, angle: number, theta: number[] } | null {
  const net = signal.slice(e.start, e.end).reduce<Vec3>((a, b) => add(a, scale(b, 1 / HZ)), [0, 0, 0])
  const angle = norm(net)
  if (angle < 1e-12)
    return null
  const axis = scale(net, 1 / angle)
  let theta = 0
  return {
    axis,
    angle,
    theta: signal.slice(e.start).map((v) => {
      theta += dot(v, axis) / HZ
      return theta
    }),
  }
}

/** S1: own peak within tp +/-1 s; participates at >=3*floor; P15 onset on that speed. */
export function jointOnset(speed: readonly number[], peak: number, floor: number): number | null {
  const start = Math.max(0, peak - HZ)
  const end = Math.min(speed.length, peak + HZ + 1)
  let p = start
  for (let i = start; i < end; i++) {
    if (speed[i] > speed[p])
      p = i
  }
  return speed[p] >= 3 * floor && speed[p] > 1e-12 ? Math.max(start, episode(speed, p).start) : null
}

/**
 * S1 / 10.4: kinematic head-turn episodes >=.5 rad/s and >=10 degrees; no event-driven detector.
 * chestLag=chest-head onset, eyeLead=head-eye onset (ms); orderRate=mean ordered indicators.
 * overshoot=(max theta-final)/|final|*100 (%); settle=last deviation >5% of final after tp (ms).
 */
export function gazeMetrics(p: PreparedTrace, params: DetectorParameters): MetricResult[] {
  const keys = ['chestLagMs', 'orderRate', 'overshootPct', 'settleMs', 'eyeLeadMs'] as const
  const unit = (key: typeof keys[number]) => key === 'orderRate' ? 'fraction' : key === 'overshootPct' ? 'percent' : 'ms'
  const head = headSignal(p)
  if (!head)
    return keys.map(k => skipped(`gaze.${k}`, unit(k), 'episode', 'bone-absent head'))
  const neckFloor = params.floors.head
  if (neckFloor === undefined)
    return keys.map(k => skipped(`gaze.${k}`, unit(k), 'episode', 'missing-floor head'))
  const wHead = p.worldVelocity.head
  const chest = p.worldVelocity.chest
  const headRelative = wHead && chest ? filterVectors(wHead.map((v, i) => heading(sub(v, chest[i]), p.yaw[i])), 6).map(norm) : null
  const chestSpeed = chest ? filterVectors(chest.map((v, i) => heading(sub(v, [0, p.yawRate[i], 0]), p.yaw[i])), 6).map(norm) : null
  const eyeBones = [p.o6.leftEye, p.o6.rightEye].filter(b => b !== undefined)
  const eyes = eyeBones.length ? head.map((_, i) => norm(scale(eyeBones.reduce<Vec3>((s, v) => add(s, v[i]), [0, 0, 0]), 1 / eyeBones.length))) : null
  const eyeFloors = [params.floors.leftEye, params.floors.rightEye].filter(f => f !== undefined)
  const samples: Record<typeof keys[number], MetricSample[]> = { chestLagMs: [], orderRate: [], overshootPct: [], settleMs: [], eyeLeadMs: [] }
  const excluded: string[] = []
  for (const e of episodes(head.map(norm), 0.5)) {
    const integrated = integratedEpisode(head, e)
    if (!integrated || integrated.angle * DEG < 10)
      continue
    const degrees = integrated.angle * DEG
    const range = params.acceptedHeadRotationDeg
    if (range && (degrees < range[0] || degrees > range[1])) {
      excluded.push(`${p.times[e.peak].toFixed(3)}s:${degrees.toFixed(3)}deg`)
      continue
    }
    const h = headRelative ? jointOnset(headRelative, e.peak, neckFloor) : null
    const c = chestSpeed && params.floors.chest !== undefined ? jointOnset(chestSpeed, e.peak, params.floors.chest) : null
    const eye = eyes && eyeFloors.length ? jointOnset(eyes, e.peak, mean(eyeFloors)) : null
    if (h !== null && c !== null)
      samples.chestLagMs.push({ ...e, value: (c - h) * 1000 / HZ })
    if (h !== null && eye !== null)
      samples.eyeLeadMs.push({ ...e, value: (h - eye) * 1000 / HZ })
    const available = [eye, h, c].filter(v => v !== null)
    if (available.length)
      samples.orderRate.push({ ...e, value: available.every((v, i) => i === 0 || v >= available[i - 1]) ? 1 : 0 })
    // A full post-turn final interval is required; do not invent a final pose at a clip edge.
    if (e.end + HZ > head.length)
      continue
    const theta = integrated.theta
    const endIndex = e.end - e.start - 1
    const final = mean(theta.slice(endIndex + HZ / 2, endIndex + HZ + 1))
    if (Math.abs(final) < 1e-12)
      continue
    samples.overshootPct.push({ ...e, value: (Math.max(...theta.slice(0, endIndex + HZ + 1)) - final) / Math.abs(final) * 100 })
    let last = e.peak - e.start
    for (let i = last; i <= endIndex + HZ; i++) {
      if (Math.abs(theta[i] - final) > 0.05 * Math.abs(final))
        last = i
    }
    samples.settleMs.push({ ...e, value: Math.max(0, last + e.start - e.peak) * 1000 / HZ })
  }
  return keys.map((key) => {
    const id = `gaze.${key}`
    if ((key === 'chestLagMs' || key === 'orderRate') && !chest)
      return skipped(id, unit(key), 'episode', 'bone-absent chest')
    if (key === 'chestLagMs' && params.floors.chest === undefined)
      return skipped(id, unit(key), 'episode', 'missing-floor chest')
    if (key === 'eyeLeadMs' && !eyes)
      return skipped(id, unit(key), 'episode', 'eye-bones-absent')
    if (key === 'eyeLeadMs' && !eyeFloors.length)
      return skipped(id, unit(key), 'episode', 'missing-eye-floors')
    const metric = episodeResult(p, id, unit(key), samples[key], key === 'orderRate')
    return excluded.length ? { ...metric, detail: `${metric.detail}; outside accepted head rotation: ${excluded.join(', ')}` } : metric
  })
}
