import type { MetricBasis, MetricResult, MetricSample, MetricStatus, PreparedTrace, Span } from './types'

import { mean, median } from './math'

export function result(id: string, unit: string, basis: MetricBasis, value: number | null, status: MetricStatus = 'ok', detail = '', samples: readonly MetricSample[] = []): MetricResult {
  const resolved = value === null && status === 'ok' ? 'undefined: no-motion' : status
  return { id, family: id.split('.')[0], value, unit, basis, status: resolved, detail: detail || (resolved === 'undefined: no-motion' ? resolved : ''), samples }
}

export function skipped(id: string, unit: string, basis: MetricBasis, reason: string): MetricResult {
  return result(id, unit, basis, null, `skipped: ${reason}`, reason)
}

/** 10.2: median of eligible window values; characters require three windows. */
export function windowResult(p: PreparedTrace, id: string, unit: string, measure: (span: Span) => number | null): MetricResult {
  const minimum = p.input.trace.source.level === 'reference' ? 1 : 3
  if (p.windows.length < minimum)
    return skipped(id, unit, 'window', 'insufficient-windows')
  const samples = p.windows.flatMap((s) => {
    const value = measure(s)
    return value === null ? [] : [{ ...s, value }]
  })
  // A motionless window must not silently disappear from a fitted clip statistic.
  if (samples.length !== p.windows.length)
    return result(id, unit, 'window', null, 'undefined: no-motion', 'undefined: no-motion', samples)
  return result(id, unit, 'window', median(samples.map(s => s.value)), 'ok', '', samples)
}

/** 10.3: retain every episode, median values / mean rate indicators; eight for characters. */
export function episodeResult(p: PreparedTrace, id: string, unit: string, samples: readonly MetricSample[], rate = false): MetricResult {
  const minimum = p.input.trace.source.level === 'reference' ? 1 : 8
  if (samples.length < minimum)
    return { ...skipped(id, unit, 'episode', 'insufficient-episodes'), samples }
  return result(id, unit, 'episode', (rate ? mean : median)(samples.map(s => s.value)), 'ok', '', samples)
}
