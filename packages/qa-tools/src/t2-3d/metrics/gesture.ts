import type { DetectorParameters, MetricResult, PreparedTrace } from './types'

import { dot, HZ, median } from './math'
import { result, skipped, windowResult } from './result'
import { peaks } from './segments'

/** S2: emphasis = labelled peaks, else 100 ms voice average, >=.3, prominence >=.15, gap >=.4 s. */
export function emphasisTimes(p: PreparedTrace): number[] {
  const events = p.input.trace.events.filter(e => e.kind === 'emphasis' && e.t >= (p.times[0] ?? 0) && e.t <= (p.times[p.times.length - 1] ?? 0))
  if (events.length)
    return events.map(e => e.t)
  const voice = p.channels[2].map((_, i, x) => {
    const part = x.slice(Math.max(0, i - 3), Math.min(x.length, i + 3))
    return part.reduce((a, b) => a + b, 0) / part.length
  })
  const prominent = peaks(voice, 0.3).filter((i) => {
    let l = voice[i]
    let r = voice[i]
    for (let j = i - 1; j >= 0 && voice[j] <= voice[i]; j--)
      l = Math.min(l, voice[j])
    for (let j = i + 1; j < voice.length && voice[j] <= voice[i]; j++)
      r = Math.min(r, voice[j])
    return voice[i] - Math.max(l, r) >= 0.15
  }).sort((a, b) => voice[b] - voice[a])
  const spaced: number[] = []
  for (const i of prominent) {
    if (spaced.every(j => Math.abs(j - i) >= 0.4 * HZ))
      spaced.push(i)
  }
  return spaced.sort((a, b) => a - b).map(i => p.times[i])
}

/** 10.7: P(Binomial(K,c)>=hits), dimensionless; log terms avoid underflow for many emphases. */
export function binomialTail(k: number, hits: number, chance: number): number {
  if (hits === 0 || chance === 1)
    return 1
  if (chance === 0)
    return 0
  let logChoose = 0
  const terms: number[] = []
  for (let j = 0; j <= k; j++) {
    if (j >= hits)
      terms.push(logChoose + j * Math.log(chance) + (k - j) * Math.log1p(-chance))
    logChoose += Math.log(k - j) - Math.log(j + 1)
  }
  const max = Math.max(...terms)
  return Math.min(1, Math.exp(max) * terms.reduce((s, v) => s + Math.exp(v - max), 0))
}

/** S2 / 10.7: strokes/min, gain=hits/K-(1-exp(-.4*strokes/s)); lag=nearest stroke-emphasis, ms. */
export function gestureMetrics(p: PreparedTrace, params: DetectorParameters): MetricResult[] {
  const sideSignals = (['left', 'right'] as const).map(side => Array.from({ length: p.bodySpeed.length }, (_, i) =>
    Math.sqrt(([`${side}UpperArm`, `${side}LowerArm`, `${side}Hand`] as const).reduce((sum, b) => {
      const v = p.o6[b]?.[i]
      return sum + (v ? dot(v, v) : 0)
    }, 0))))
  const amplitude = p.bodySpeed.map((_, i) => Math.max(sideSignals[0][i], sideSignals[1][i]))
  const strokes = peaks(amplitude, 1).filter(i => sideSignals.some((s, side) => s[i] === amplitude[i] && s[i] >= 3 * params.moveSpeed[side === 0 ? 'armL' : 'armR']))
  const head = p.bodySpeed.map((_, i) => Math.abs((p.o6.head?.[i][0] ?? 0) + (p.o6.neck?.[i][0] ?? 0)))
  const nods = peaks(head, 0.3)
  const emphasis = emphasisTimes(p)
  const duration = p.bodySpeed.length / HZ
  const align = (indices: readonly number[]) => {
    const times = indices.map(i => p.times[i])
    const lags = emphasis.flatMap((t) => {
      const candidates = times.filter(s => Math.abs(s - t) <= 0.2 + 1e-9).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))
      return candidates.length ? [1000 * (candidates[0] - t)] : []
    })
    const chance = duration > 0 ? 1 - Math.exp(-0.4 * indices.length / duration) : 0
    return { lags, chance, gain: emphasis.length ? lags.length / emphasis.length - chance : null }
  }
  const arm = align(strokes)
  const nod = align(nods)
  const hasArms = p.input.trace.rig.bones.some(b => /UpperArm|LowerArm|Hand/.test(b))
  const metrics = [hasArms
    ? windowResult(p, 'gesture.strokesPerMin', 'per-minute', s => strokes.filter(i => i >= s.start && i < s.end).length * 60 / p.windowSeconds)
    : skipped('gesture.strokesPerMin', 'per-minute', 'window', 'arm-bones-absent')]
  for (const [id, unit, value] of [
    ['gesture.strokeP', 'probability', binomialTail(emphasis.length, arm.lags.length, arm.chance)],
    ['gesture.strokeLagMs', 'ms', arm.lags.length ? median(arm.lags) : null],
    ['gesture.strokeGain', 'fraction', arm.gain],
    ['gesture.headGain', 'fraction', nod.gain],
  ] as const) {
    if (emphasis.length < 10)
      metrics.push(skipped(id, unit, 'trace', 'insufficient-emphasis'))
    else if (id === 'gesture.headGain' && !p.o6.head && !p.o6.neck)
      metrics.push(skipped(id, unit, 'trace', 'head-bones-absent'))
    else if (!hasArms && id !== 'gesture.headGain')
      metrics.push(skipped(id, unit, 'trace', 'arm-bones-absent'))
    else
      metrics.push(result(id, unit, 'trace', value))
  }
  return metrics
}
