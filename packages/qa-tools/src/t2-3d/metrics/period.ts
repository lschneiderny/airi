import type { MetricResult, PreparedTrace, Vec3 } from './types'

import { SIGNAL_BONES } from './bones'
import { filterVectors } from './filter'
import { dot, finite, heading, HZ, mean, norm, principalAxis, sub, sum } from './math'
import { result, skipped, windowResult } from './result'
import { runs } from './segments'

/** 10.4 acfPeak: line-detrend, overlap-centred Pearson, local peaks at 1..6 s; unit correlation. */
export function acfPeak(signal: readonly number[]): number | null {
  const n = signal.length
  const centre = (n - 1) / 2
  const m = mean(signal)
  const slope = finite(sum(signal.map((x, i) => (i - centre) * (x - m))) / (n * (n * n - 1) / 12), 'ACF slope')
  const x = signal.map((v, i) => v - m - slope * (i - centre))
  if (sum(x.map(v => v * v)) < 1e-18)
    return null
  const limit = Math.min(360, n - 2)
  const r = Array.from({ length: limit + 1 }, (_, k) => {
    const a = x.slice(0, n - k)
    const b = x.slice(k)
    const ma = mean(a)
    const mb = mean(b)
    let aa = 0
    let bb = 0
    let ab = 0
    for (let i = 0; i < a.length; i++) {
      aa += (a[i] - ma) ** 2
      bb += (b[i] - mb) ** 2
      ab += (a[i] - ma) * (b[i] - mb)
    }
    finite(aa, 'ACF variance')
    finite(bb, 'ACF variance')
    finite(ab, 'ACF covariance')
    const energy = finite(aa * bb, 'ACF energy product')
    return energy < 1e-36 ? 0 : finite(ab / Math.sqrt(energy), 'ACF correlation')
  })
  const zero = r.findIndex((v, i) => i > 0 && v <= 0)
  if (zero < 0)
    return 0
  let peak = 0
  for (let k = Math.max(60, zero + 1); k < limit; k++) {
    if (r[k] > r[k - 1] && r[k] >= r[k + 1])
      peak = Math.max(peak, r[k])
  }
  return Math.min(1, peak)
}

/** 10.4 loopPeak: max local c(k)/c(0) after first zero, 2..30 s. Vectors use dot products. */
export function loopPeak(signal: readonly Vec3[]): number | null {
  const m: Vec3 = [mean(signal.map(v => v[0])), mean(signal.map(v => v[1])), mean(signal.map(v => v[2]))]
  const x = signal.map(v => sub(v, m))
  const c0 = sum(x.map(v => dot(v, v)))
  if (c0 < 1e-18)
    return null
  const limit = Math.min(1800, Math.floor(x.length / 2))
  const rho = Array.from({ length: limit + 2 }, (_, k) => {
    let c = 0
    for (let i = 0; i < x.length - k; i++)
      c += dot(x[i], x[i + k])
    return finite(c / c0, 'loop correlation')
  })
  const zero = rho.findIndex((v, i) => i > 0 && v <= 0)
  if (zero < 0)
    return 0
  let peak = 0
  for (let k = Math.max(120, zero + 1); k <= limit; k++) {
    if (rho[k] > rho[k - 1] && rho[k] >= rho[k + 1])
      peak = Math.max(peak, rho[k])
  }
  return peak
}

/** S1 / 10.4: heading-frame total head velocity with locomotor heading rate removed, rad/s. */
export function headSignal(p: PreparedTrace): Vec3[] | null {
  const w = p.worldVelocity.head
  return w ? filterVectors(w.map((v, i) => heading(sub(v, [0, p.yawRate[i], 0]), p.yaw[i])), 6) : null
}

/** M2 signals; bone scalars use each window's own principal axis. */
export function scalarSignals(p: PreparedTrace): ReadonlyMap<string, readonly Vec3[]> {
  const signals = new Map<string, readonly Vec3[]>([
    ['rootLateral', p.rootVelocity.map(v => [v[0], 0, 0])],
    ['rootForeAft', p.rootVelocity.map(v => [v[2], 0, 0])],
    ['rootVertical', p.rootVelocity.map(v => [v[1], 0, 0])],
  ])
  for (const b of SIGNAL_BONES) {
    const v = p.o6[b]
    if (v)
      signals.set(b, v)
  }
  return signals
}

export function projection(v: readonly Vec3[]): number[] | null {
  const u = principalAxis(v)
  return u ? v.map(x => dot(x, u)) : null
}

export function periodMetrics(p: PreparedTrace): MetricResult[] {
  const metrics: MetricResult[] = []
  for (const [name, signal] of scalarSignals(p)) {
    metrics.push(p.windowSeconds < 10
      ? skipped(`period.${name}.acfPeak`, 'correlation', 'window', 'insufficient-period-window')
      : windowResult(p, `period.${name}.acfPeak`, 'correlation', (s) => {
          const x = name.startsWith('root') ? signal.slice(s.start, s.end).map(v => v[0]) : projection(signal.slice(s.start, s.end))
          return x ? acfPeak(x) : null
        }))
  }
  for (const b of SIGNAL_BONES) {
    if (!p.o6[b])
      metrics.push(skipped(`period.${b}.acfPeak`, 'correlation', 'window', `bone-absent ${b}`))
  }
  const idleSpans = runs(p.bodySpeed.map((_, i) => p.channels[7][i] === 0 && p.channels[3][i] === 0))
  const span = idleSpans.sort((a, b) => (b.end - b.start) - (a.end - a.start))[0]
  const signals = scalarSignals(p)
  const head = headSignal(p)
  for (const name of ['rootLateral', 'rootForeAft', 'head']) {
    const signal = name === 'head' ? head : signals.get(name)
    const id = `period.${name}.loopPeak`
    if (!signal)
      metrics.push(skipped(id, 'correlation', 'trace', 'bone-absent head'))
    else if (!span || span.end - span.start < HZ * 60)
      metrics.push(skipped(id, 'correlation', 'trace', 'insufficient-idle-span'))
    else metrics.push(result(id, 'correlation', 'trace', loopPeak(signal.slice(span.start, span.end))))
  }
  // 10.5: sum of fastest ceil(10% * N) head speeds / total speed, unit fraction.
  if (!head) {
    metrics.push(skipped('inter.head.top10PathShare', 'fraction', 'trace', 'bone-absent head'))
  }
  else {
    const speed = head.map(norm).sort((a, b) => b - a)
    const total = sum(speed)
    metrics.push(result('inter.head.top10PathShare', 'fraction', 'trace', total > 1e-18 ? sum(speed.slice(0, Math.ceil(speed.length / 10))) / total : null))
  }
  return metrics
}
