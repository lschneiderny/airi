import type { BandRule, MetricBand, Transform } from './types'

import { mean, median } from '../metrics/math'

/** Linear interpolation at rank (n - 1) * p. Callers supply finite measurements. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const rank = (sorted.length - 1) * p
  const lower = Math.floor(rank)
  return sorted[lower] + (sorted[Math.ceil(rank)] - sorted[lower]) * (rank - lower)
}

export function transformValue(value: number, transform: Transform): number {
  return transform === 'fisher-z' ? Math.atanh(Math.max(-0.9999, Math.min(0.9999, value))) : value
}

export function fitBand(values: readonly number[], rule: BandRule): MetricBand {
  const { side, domain, transform, unit } = rule
  const empty: MetricBand = { side, domain, transform, unit, basis: 'fitted', status: 'REPORT', detail: 'fewer than 10 fitting clips', n: values.length, p5: null, p50: null, p95: null, lo: null, hi: null }
  if (values.length < 10)
    return empty
  const transformed = values.map(value => transformValue(value, transform))
  const p5 = percentile(transformed, 0.05)
  const p50 = percentile(transformed, 0.5)
  const p95 = percentile(transformed, 0.95)
  const lo = side === 'upper' ? null : 2 * p5 - p50
  const hi = side === 'lower' ? null : 2 * p95 - p50
  const [min, max] = domain.map(value => value === null ? null : transformValue(value, transform))
  // A two-sided band is reported if either required side is vacuous; never silently re-rule it.
  const vacuous = (lo !== null && min !== null && lo <= min) || (hi !== null && max !== null && hi >= max)
  return { ...empty, p5, p50, p95, lo, hi, status: vacuous ? 'REPORT' : 'GATED', detail: vacuous ? 'vacuous band' : '' }
}

export function passesBand(value: number, band: MetricBand): boolean {
  const v = transformValue(value, band.transform)
  return (band.lo === null || v >= band.lo) && (band.hi === null || (band.exclusiveHi ? v < band.hi : v <= band.hi))
}

/** Each pool restarts the exact design 10.3 generator, independently of other fits. */
export function pooledDistribution(pool: readonly number[], rate: boolean): number[] {
  let a = 20261111
  const random = () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return Array.from({ length: 2000 }, () => {
    const draw = Array.from({ length: 8 }, () => pool[Math.floor(random() * pool.length)])
    return (rate ? mean : median)(draw)
  })
}

export function fitEpisodeBand(pools: { readonly fit: readonly number[], readonly holdout: readonly number[], readonly subjects: Readonly<Record<string, number>> }, rule: BandRule, rate: boolean): MetricBand {
  const enough = pools.fit.length >= 40 && pools.holdout.length >= 16
  const fitted = fitBand(enough ? pooledDistribution(pools.fit, rate) : [], rule)
  return { ...fitted, n: pools.fit.length, heldoutEpisodes: pools.holdout.length, episodeCounts: pools.subjects, detail: enough ? fitted.detail : 'fewer than 40 fitting or 16 held-out episodes' }
}
