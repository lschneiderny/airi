/** Draws behind every bootstrap interval. */
export const BOOTSTRAP_RESAMPLES = 2000
/** Seeded half-splits behind the A/A noise floor, and seeded sign flips behind its paired analogue. */
export const AA_SPLITS = 50
/** Scales a median absolute deviation to the standard deviation of normally distributed data. */
export const MAD_TO_SIGMA = 1.4826

/** A seeded generator of floats in [0, 1); comparisons never read global randomness. */
export type Random = () => number

/** A 90% percentile bootstrap interval. */
export interface Interval {
  readonly low: number
  readonly high: number
}

/** mulberry32: a small seeded generator, so the same seed gives the same intervals and floors. */
export function mulberry32(seed: number): Random {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function quantileOfSorted(sorted: ArrayLike<number>, q: number): number {
  const position = (sorted.length - 1) * q
  const lower = Math.floor(position)
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
}

/** Linear-interpolation quantile `q` (0..1) of a non-empty list. */
export function quantile(values: readonly number[], q: number): number {
  return quantileOfSorted(values.toSorted((left, right) => left - right), q)
}

export interface WeightedValue {
  readonly value: number
  readonly weight: number
}

/** The lower weighted median: the value at which the cumulative weight first reaches half of the total; `null` for no values. */
export function weightedMedian(entries: readonly [WeightedValue, ...WeightedValue[]]): number
export function weightedMedian(entries: readonly WeightedValue[]): number | null
export function weightedMedian(entries: readonly WeightedValue[]): number | null {
  const sorted = entries.toSorted((left, right) => left.value - right.value)
  const total = sorted.reduce((sum, entry) => sum + entry.weight, 0)
  let seen = 0
  for (const entry of sorted) {
    seen += entry.weight
    if (seen * 2 >= total)
      return entry.value
  }
  return null
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5)
}

function draw(values: readonly number[], random: Random): number[] {
  return Array.from(values, () => values[Math.floor(random() * values.length)])
}

function intervalOf(statistics: number[]): Interval {
  statistics.sort((left, right) => left - right)
  return { low: quantileOfSorted(statistics, 0.05), high: quantileOfSorted(statistics, 0.95) }
}

/** Interval of `median(b) - median(a)`, resampling each non-empty side with replacement. */
export function bootstrapMedianDifference(a: readonly number[], b: readonly number[], random: Random): Interval {
  return intervalOf(Array.from({ length: BOOTSTRAP_RESAMPLES }, () => median(draw(b, random)) - median(draw(a, random))))
}

/** Interval of the median of a non-empty list, resampled with replacement. */
export function bootstrapMedian(values: readonly number[], random: Random): Interval {
  return intervalOf(Array.from({ length: BOOTSTRAP_RESAMPLES }, () => median(draw(values, random))))
}

/**
 * The difference two halves of one state show by chance: the 90th percentile of `|median(half) - median(rest)|`
 * over {@link AA_SPLITS} seeded shuffles of at least two values.
 */
export function aaNoiseFloor(values: readonly number[], random: Random): number {
  const half = Math.floor(values.length / 2)
  const differences = Array.from({ length: AA_SPLITS }, () => {
    const shuffled = [...values]
    for (let index = shuffled.length - 1; index > 0; index--) {
      const swap = Math.floor(random() * (index + 1))
      ;[shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]]
    }
    return Math.abs(median(shuffled.slice(0, half)) - median(shuffled.slice(half)))
  })
  return quantile(differences, 0.9)
}

/** Up to this many differences the sign-flip floor enumerates all 2^n patterns (16384 at 14) instead of sampling. */
const SIGN_FLIP_EXACT_MAX = 14

/**
 * The paired analogue of {@link aaNoiseFloor}: with no shift, each per-session difference is as likely negative as
 * positive, so it is the 90th percentile of `|median|` over sign flips of the differences. Up to 14 differences it
 * takes every one of the 2^n flip patterns, so the floor is exact and does not depend on `random`. Above that it
 * samples {@link AA_SPLITS} seeded patterns. Unlike a floor from within-session spread, it does not fall to 0 when a
 * session holds one block per side.
 */
export function signFlipNoiseFloor(differences: readonly number[], random: Random): number {
  const count = differences.length
  if (count > SIGN_FLIP_EXACT_MAX) {
    const medians = Array.from({ length: AA_SPLITS }, () => Math.abs(median(differences.map(difference => (random() < 0.5 ? -difference : difference)))))
    return quantile(medians, 0.9)
  }

  const medians = new Float64Array(2 ** count)
  const flipped = new Float64Array(count)
  for (let pattern = 0; pattern < medians.length; pattern++) {
    for (let index = 0; index < count; index++)
      flipped[index] = (pattern >>> index) & 1 ? -differences[index] : differences[index]
    // Typed arrays sort numerically.
    flipped.sort()
    medians[pattern] = Math.abs(quantileOfSorted(flipped, 0.5))
  }
  medians.sort()
  return quantileOfSorted(medians, 0.9)
}

export function excludesZero(interval: Interval): boolean {
  return interval.low > 0 || interval.high < 0
}

/** Cliff's delta of `b` over `a`: P(b > a) - P(b < a), from -1 to 1, for two non-empty lists. */
export function cliffsDelta(a: readonly number[], b: readonly number[]): number {
  let dominance = 0
  for (const right of b) {
    for (const left of a)
      dominance += Math.sign(right - left)
  }
  return dominance / (a.length * b.length)
}

/** An outlier-resistant standard deviation of a non-empty list: {@link MAD_TO_SIGMA} times its median absolute deviation. */
export function madSigma(values: readonly number[]): number {
  const centre = median(values)
  return MAD_TO_SIGMA * median(values.map(value => Math.abs(value - centre)))
}
