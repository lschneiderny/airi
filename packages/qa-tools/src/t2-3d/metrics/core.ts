import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { DetectorParameters, MetricResult, PreparedTrace, Span } from './types'

import { ARMS, CHAIN_PAIRS, CORE, isFinger, UPPER } from './bones'
import { add, dot, laggedCorrelation, mean, median, principalAxis, rms } from './math'
import { result, skipped, windowResult } from './result'

/** P10: a_b = sqrt(mean_t |O6_b|^2), rad/s, over the supplied window. */
export function activity(p: PreparedTrace, span: Span): Partial<Record<MotionTraceBone, number>> {
  return Object.fromEntries(p.input.trace.rig.bones.map(b => [b, rms((p.o6[b] ?? []).slice(span.start, span.end))]))
}

/** M1: |r(0)| and |subframe argmax |r(k)|| * 1000/60, on the shared principal axis. */
function chainMetrics(p: PreparedTrace, params: DetectorParameters): MetricResult[] {
  return CHAIN_PAIRS.flatMap(([a, b]) => {
    const prefix = `chain.${a}-${b}`
    const signed: number[] = []
    const correlations = new Map<Span, ReturnType<typeof laggedCorrelation>>()
    const compute = (s: Span) => {
      if (correlations.has(s))
        return correlations.get(s) ?? null
      const aa = (p.o6[a] ?? []).slice(s.start, s.end)
      const bb = (p.o6[b] ?? []).slice(s.start, s.end)
      if (rms(aa) < (params.floors[a] ?? Infinity) || rms(bb) < (params.floors[b] ?? Infinity))
        return null
      const axis = principalAxis(aa.map((v, i) => add(v, bb[i])))
      const c = axis ? laggedCorrelation(aa.map(v => dot(v, axis)), bb.map(v => dot(v, axis)), 30) : null
      correlations.set(s, c)
      return c
    }
    return (['zeroLagCorr', 'lagMs'] as const).map((key) => {
      const id = `${prefix}.${key}`
      const unit = key === 'lagMs' ? 'ms' : 'correlation'
      if (!p.o6[a] || !p.o6[b])
        return skipped(id, unit, 'window', `bone-absent ${!p.o6[a] ? a : b}`)
      if (params.floors[a] === undefined || params.floors[b] === undefined)
        return skipped(id, unit, 'window', 'missing-floor')
      const metric = windowResult(p, id, unit, (s) => {
        const c = compute(s)
        if (key === 'lagMs' && c)
          signed.push(c.lag * 1000 / 60)
        return c ? key === 'lagMs' ? Math.abs(c.lag) * 1000 / 60 : Math.abs(c.zero) : null
      })
      return key === 'lagMs' && signed.length ? { ...metric, detail: `signed lag ${median(signed).toFixed(3)} ms; positive means ${b} follows ${a}` } : metric
    })
  })
}

/** M3 / 10.4: active present bones / present bones; activity is recomputed within each window. */
function coverageMetrics(p: PreparedTrace, params: DetectorParameters): MetricResult[] {
  const metrics = ([
    ['core', CORE],
    ['arms', ARMS],
  ] as const).map(([name, set]) => {
    const bones = set.filter(b => p.o6[b])
    const id = `coverage.${name}`
    if (!bones.length)
      return skipped(id, 'fraction', 'window', 'bones-absent')
    if (bones.some(b => params.floors[b] === undefined))
      return skipped(id, 'fraction', 'window', 'missing-floor')
    return windowResult(p, id, 'fraction', s => mean(bones.map(b => rms((p.o6[b] ?? []).slice(s.start, s.end)) >= (params.floors[b] ?? Infinity) ? 1 : 0)))
  })
  const fingers = p.input.trace.rig.bones.filter(isFinger)
  if (!fingers.length) {
    return [...metrics, skipped('coverage.fingers', 'fraction', 'window', 'fingers-absent'), skipped('fingers.frozen', 'indicator', 'window', 'fingers-absent')]
  }
  const values: { start: number, end: number, value: number }[] = []
  const missingWristFloor = (['leftHand', 'rightHand'] as const).some(hand =>
    p.o6[hand] && params.floors[hand] === undefined && fingers.some(b => b.startsWith(hand.slice(0, -4))))
  for (const s of p.windows) {
    const a = activity(p, s)
    for (const side of ['left', 'right'] as const) {
      const wrist = `${side}Hand` as const
      const sideFingers = fingers.filter(b => b.startsWith(side))
      const hand = a[wrist]
      const floor = params.floors[wrist]
      if (sideFingers.length && hand !== undefined && floor !== undefined && hand >= floor)
        values.push({ ...s, value: mean(sideFingers.map(b => (a[b] ?? 0) >= 0.1 * hand ? 1 : 0)) })
    }
  }
  const minimum = p.input.trace.source.level === 'reference' ? 1 : 3
  const enough = p.windows.length >= minimum
  metrics.push(enough && !missingWristFloor && values.length
    ? result('coverage.fingers', 'fraction', 'window', median(values.map(s => s.value)), 'ok', 'per active wrist and window', values)
    : skipped('coverage.fingers', 'fraction', 'window', !enough ? 'insufficient-windows' : missingWristFloor ? 'missing-wrist-floor' : 'hand-inactive'))
  // 10.4: frozen = 1 iff every present finger has a_b < 1e-6 in every window.
  metrics.push(windowResult(p, 'fingers.frozen', 'indicator', s => fingers.every(b => rms((p.o6[b] ?? []).slice(s.start, s.end)) < 1e-6) ? 1 : 0))
  const frozen = metrics[metrics.length - 1]
  if (frozen.value !== null)
    metrics[metrics.length - 1] = { ...frozen, value: frozen.samples.every(s => s.value === 1) ? 1 : 0 }
  return metrics
}

/** M4: max_|k|<=30 |r(k)|, own principal axes for left and right; unit correlation. */
function bilateralMetrics(p: PreparedTrace, params: DetectorParameters): MetricResult[] {
  return (['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const).map((joint) => {
    const a = `left${joint}` as const
    const b = `right${joint}` as const
    const id = `bilateral.${joint[0].toLowerCase()}${joint.slice(1)}.peakCorr`
    if (!p.o6[a] || !p.o6[b])
      return skipped(id, 'correlation', 'window', 'bones-absent')
    if (params.floors[a] === undefined || params.floors[b] === undefined)
      return skipped(id, 'correlation', 'window', 'missing-floor')
    return windowResult(p, id, 'correlation', (s) => {
      const aa = (p.o6[a] ?? []).slice(s.start, s.end)
      const bb = (p.o6[b] ?? []).slice(s.start, s.end)
      if (rms(aa) < (params.floors[a] ?? Infinity) || rms(bb) < (params.floors[b] ?? Infinity))
        return null
      const ua = principalAxis(aa)
      const ub = principalAxis(bb)
      return ua && ub ? Math.abs(laggedCorrelation(aa.map(v => dot(v, ua)), bb.map(v => dot(v, ub)), 30)?.peak ?? 0) : null
    })
  })
}

/** M7: trace(C)^2 / sum_ij C_ij^2 of columns O6_b/max(a_b,floor_b); unit dimensions. */
function dimension(p: PreparedTrace, params: DetectorParameters, set: readonly MotionTraceBone[]): (span: Span) => number | null {
  return (s) => {
    const columns = set.filter(b => p.o6[b]).flatMap((b) => {
      const v = (p.o6[b] ?? []).slice(s.start, s.end)
      const d = Math.max(rms(v), params.floors[b] ?? 0)
      return [0, 1, 2].map((axis) => {
        const x = v.map(v => d > 0 ? v[axis] / d : 0)
        const m = mean(x)
        return x.map(v => v - m)
      })
    })
    let trace = 0
    let squared = 0
    for (let i = 0; i < columns.length; i++) {
      for (let j = 0; j <= i; j++) {
        const cov = mean(columns[i].map((v, n) => v * columns[j][n]))
        squared += cov * cov * (i === j ? 1 : 2)
        if (i === j)
          trace += cov
      }
    }
    return trace < 1e-12 ? null : trace * trace / squared
  }
}

export function coreMetrics(p: PreparedTrace, params: DetectorParameters): MetricResult[] {
  return [
    ...chainMetrics(p, params),
    ...coverageMetrics(p, params),
    ...bilateralMetrics(p, params),
    ...([['upper', UPPER], ['core', CORE]] as const).map(([name, set]) => !set.some(b => p.o6[b])
      ? skipped(`dim.${name}`, 'dimensions', 'window', 'bones-absent')
      : set.some(b => p.o6[b] && params.floors[b] === undefined)
        ? skipped(`dim.${name}`, 'dimensions', 'window', 'missing-floor')
        : windowResult(p, `dim.${name}`, 'dimensions', dimension(p, params, set))),
  ]
}
