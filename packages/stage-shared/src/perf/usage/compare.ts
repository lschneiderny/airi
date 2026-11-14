import type { Interval } from './compare-stats'
import type { SegmentCell, UsageFeatures, UsageHost } from './records'

import { aaNoiseFloor, bootstrapMedian, bootstrapMedianDifference, cliffsDelta, excludesZero, median, mulberry32, quantile, signFlipNoiseFloor } from './compare-stats'
import { USAGE_FEATURE_KEYS } from './records'

export const FEATURE_METRICS = ['p50FrameMs', 'share21', 'share36', 'share100', 'cpuPct', 'workingSetKb'] as const
export type FeatureMetric = (typeof FEATURE_METRICS)[number]
export type UsageFeatureKey = (typeof USAGE_FEATURE_KEYS)[number]
type FeatureValue = UsageFeatures[UsageFeatureKey]

/** A block is one segment cell with at least this many included windows; its value is the cell's median. */
export const FEATURE_BLOCK_MIN_WINDOWS = 24
/** Each side needs this many blocks, sessions, and windows before it is compared. */
export const FEATURE_MIN_BLOCKS = 5
export const FEATURE_MIN_SESSIONS = 3
export const FEATURE_MIN_WINDOWS = 120
/** The paired estimate is reported once this many sessions hold both states. */
export const FEATURE_MIN_PAIRED_SESSIONS = 3
/**
 * The paired estimate decides the verdict only from this many sessions, the smallest count at which its sign-flip
 * floor can fall below the paired difference at all. The strongest paired evidence is n per-session differences of
 * one sign with distinct magnitudes. A flip pattern keeps `|median|` at or above the observed median only when the
 * floor(n/2) + 1 largest differences share a sign, which happens in 2 of every 2^(floor(n/2) + 1) of the 2^n
 * patterns, a share of 2^-floor(n/2). The 90th-percentile floor can drop below the observed median only when that
 * share is at most 10%: first at n = 8 (16 of 256); n = 7 gives 16 of 128. Equal magnitudes never get there.
 * Below this count the paired estimate cannot reject, so it is reported with `decisive: false` and the unpaired
 * verdict decides.
 */
export const FEATURE_MIN_DECISIVE_PAIRED_SESSIONS = 8

/** A segment cell, with `leaseContended` set by readers that know the CPU lease history (`null` when it does not cover the cell). */
export type FeatureCompareCell = SegmentCell & { readonly leaseContended?: boolean | null }

export interface FeatureCompareRollup {
  readonly sessionId: string
  readonly host: UsageHost
  readonly cells: readonly FeatureCompareCell[]
}

export interface CompareFeatureParams {
  readonly rollups: readonly FeatureCompareRollup[]
  readonly feature: UsageFeatureKey
  readonly metric: FeatureMetric
  readonly seed: number
}

/** What both sides share; the other features are equal too, so the sides differ only in the compared feature. */
export interface FeatureStratum {
  readonly platform: string
  readonly cpuModel: string
  readonly renderer: SegmentCell['renderer']
  readonly modelId: string | null
  readonly activity: SegmentCell['activity']
  readonly window: string
  readonly stageHost: SegmentCell['stageHost']
  readonly devtoolsOpen: boolean
  readonly refreshHz: number
  readonly otherFeatures: Readonly<Partial<UsageFeatures>>
}

export interface FeatureSide {
  readonly value: FeatureValue
  readonly blocks: number
  readonly sessions: number
  readonly windows: number
  /** Median and quartiles of the block values; `null` without blocks. */
  readonly median: number | null
  readonly q1: number | null
  readonly q3: number | null
}

export type FeatureVerdict = 'difference' | 'within-noise'

export interface UnpairedEstimate {
  /** `median(b) - median(a)` over blocks. */
  readonly difference: number
  /** The difference relative to side a's median; `null` when that median is 0. */
  readonly differencePct: number | null
  readonly cliffsDelta: number
  readonly ci: Interval
  /** The A/A floor: the difference two halves of the larger side show by chance. */
  readonly noiseFloor: number
  readonly verdict: FeatureVerdict
}

export interface PairedEstimate {
  /** Sessions with blocks on both sides; each gives `median(b) - median(a)` of its own blocks. */
  readonly sessions: number
  /** Median of the per-session differences. */
  readonly difference: number
  readonly ci: Interval
  /** The sign-flip floor of the per-session differences: what their median reaches by chance with no shift. */
  readonly noiseFloor: number
  readonly verdict: FeatureVerdict
  /** Whether this estimate decided the comparison: true from {@link FEATURE_MIN_DECISIVE_PAIRED_SESSIONS} sessions. */
  readonly decisive: boolean
}

export type FeatureComparison
  = | { readonly stratum: FeatureStratum, readonly a: FeatureSide, readonly b: FeatureSide, readonly verdict: 'insufficient', readonly basis: null, readonly unpaired: null, readonly paired: null }
    | { readonly stratum: FeatureStratum, readonly a: FeatureSide, readonly b: FeatureSide, readonly verdict: FeatureVerdict, readonly basis: 'paired' | 'unpaired', readonly unpaired: UnpairedEstimate, readonly paired: PairedEstimate | null }

export interface FeatureComparisonReport {
  /** Usage sessions are not controlled experiments; every comparison is an observation. */
  readonly label: 'observational'
  readonly feature: UsageFeatureKey
  readonly metric: FeatureMetric
  readonly comparisons: readonly FeatureComparison[]
  readonly droppedCells: { readonly hostContended: number, readonly leaseContended: number }
}

interface Block {
  readonly sessionId: string
  readonly windows: number
  readonly value: number
}

interface Stratum {
  readonly stratum: FeatureStratum
  readonly sides: Map<string, { readonly value: FeatureValue, readonly blocks: Block[] }>
}

function stratumOf(host: UsageHost, cell: SegmentCell, feature: UsageFeatureKey): FeatureStratum {
  const otherFeatures = Object.fromEntries(USAGE_FEATURE_KEYS.filter(key => key !== feature).map(key => [key, cell.features[key]]))
  return {
    platform: host.platform,
    cpuModel: host.cpuModel,
    renderer: cell.renderer,
    modelId: cell.modelId,
    activity: cell.activity,
    window: cell.window,
    stageHost: cell.stageHost,
    devtoolsOpen: cell.devtoolsOpen,
    refreshHz: cell.refreshHz,
    otherFeatures,
  }
}

function valueRank(value: FeatureValue): number {
  if (value === null)
    return 0
  return ['boolean', 'number', 'string'].indexOf(typeof value) + 1
}

/** Orders a feature's values so side a is the "off" state: null, false, true, then numbers, then strings. */
function byFeatureValue(left: FeatureValue, right: FeatureValue): number {
  const rank = valueRank(left) - valueRank(right)
  if (rank !== 0)
    return rank
  if (typeof left === 'number' && typeof right === 'number')
    return left - right
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0
}

function sideOf(value: FeatureValue, blocks: readonly Block[]): FeatureSide {
  const values = blocks.map(block => block.value)
  return {
    value,
    blocks: blocks.length,
    sessions: new Set(blocks.map(block => block.sessionId)).size,
    windows: blocks.reduce((sum, block) => sum + block.windows, 0),
    median: values.length > 0 ? median(values) : null,
    q1: values.length > 0 ? quantile(values, 0.25) : null,
    q3: values.length > 0 ? quantile(values, 0.75) : null,
  }
}

function isSufficient(side: FeatureSide): boolean {
  return side.blocks >= FEATURE_MIN_BLOCKS && side.sessions >= FEATURE_MIN_SESSIONS && side.windows >= FEATURE_MIN_WINDOWS
}

function verdictOf(difference: number, ci: Interval, noiseFloor: number): FeatureVerdict {
  return excludesZero(ci) && Math.abs(difference) > noiseFloor ? 'difference' : 'within-noise'
}

const medianIn = (blocks: readonly Block[], id: string) => median(blocks.filter(block => block.sessionId === id).map(block => block.value))

/** Per-session `median(b) - median(a)` for sessions with blocks on both sides, in session id order. */
function sessionDifferences(a: readonly Block[], b: readonly Block[]): number[] {
  const sessionIds = [...new Set(a.map(block => block.sessionId))].filter(id => b.some(block => block.sessionId === id)).sort()
  return sessionIds.map(id => medianIn(b, id) - medianIn(a, id))
}

function compareSides(stratum: FeatureStratum, sides: { value: FeatureValue, blocks: Block[] }[], seed: number): FeatureComparison {
  const [a, b] = sides.map(side => sideOf(side.value, side.blocks))
  if (!isSufficient(a) || !isSufficient(b))
    return { stratum, a, b, verdict: 'insufficient', basis: null, unpaired: null, paired: null }

  // Sorted values make the draws, and so the output, independent of the order the rollups were read in.
  const [aValues, bValues] = sides.map(side => side.blocks.map(block => block.value).toSorted((left, right) => left - right))
  const random = mulberry32(seed)
  const difference = median(bValues) - median(aValues)
  const ci = bootstrapMedianDifference(aValues, bValues, random)
  const larger = sides[1].blocks.length > sides[0].blocks.length ? 1 : 0
  const noiseFloor = aaNoiseFloor(larger === 1 ? bValues : aValues, random)
  const medianA = median(aValues)
  const unpaired: UnpairedEstimate = {
    difference,
    differencePct: medianA === 0 ? null : difference / medianA * 100,
    cliffsDelta: cliffsDelta(aValues, bValues),
    ci,
    noiseFloor,
    verdict: verdictOf(difference, ci, noiseFloor),
  }

  const differences = sessionDifferences(sides[0].blocks, sides[1].blocks)
  if (differences.length < FEATURE_MIN_PAIRED_SESSIONS)
    return { stratum, a, b, verdict: unpaired.verdict, basis: 'unpaired', unpaired, paired: null }
  const pairedDifference = median(differences)
  const pairedCi = bootstrapMedian(differences, random)
  const pairedFloor = signFlipNoiseFloor(differences, random)
  const paired: PairedEstimate = {
    sessions: differences.length,
    difference: pairedDifference,
    ci: pairedCi,
    noiseFloor: pairedFloor,
    verdict: verdictOf(pairedDifference, pairedCi, pairedFloor),
    decisive: differences.length >= FEATURE_MIN_DECISIVE_PAIRED_SESSIONS,
  }
  return paired.decisive
    ? { stratum, a, b, verdict: paired.verdict, basis: 'paired', unpaired, paired }
    : { stratum, a, b, verdict: unpaired.verdict, basis: 'unpaired', unpaired, paired }
}

/**
 * Compares a metric between the values of one feature in recorded usage, per stratum (host, renderer, model,
 * activity, window, stage host, devtools, refresh rate, and every other feature); strata are never pooled.
 * Contended cells are dropped. Each stratum compares every pair of feature values it holds, the "off" value as
 * side a; a stratum with one value forms no comparison. Results are deterministic for a seed.
 */
export function compareFeature(params: CompareFeatureParams): FeatureComparisonReport {
  const { feature, metric } = params
  const strata = new Map<string, Stratum>()
  const droppedCells = { hostContended: 0, leaseContended: 0 }
  for (const rollup of params.rollups) {
    for (const cell of rollup.cells) {
      if (cell.hostContended) {
        droppedCells.hostContended += 1
        continue
      }
      if (cell.leaseContended === true) {
        droppedCells.leaseContended += 1
        continue
      }
      const stratum = stratumOf(rollup.host, cell, feature)
      const stratumKey = JSON.stringify(stratum)
      let entry = strata.get(stratumKey)
      if (entry === undefined) {
        entry = { stratum, sides: new Map() }
        strata.set(stratumKey, entry)
      }
      const value = cell.features[feature]
      const sideKey = JSON.stringify(value)
      let side = entry.sides.get(sideKey)
      if (side === undefined) {
        side = { value, blocks: [] }
        entry.sides.set(sideKey, side)
      }
      const metricValue = cell.quartiles[metric]?.median
      if (cell.windows >= FEATURE_BLOCK_MIN_WINDOWS && metricValue !== undefined && Number.isFinite(metricValue))
        side.blocks.push({ sessionId: rollup.sessionId, windows: cell.windows, value: metricValue })
    }
  }

  const comparisons = [...strata.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([, { stratum, sides }]) => {
      const ordered = [...sides.values()].sort((left, right) => byFeatureValue(left.value, right.value))
      return ordered.flatMap((a, index) => ordered.slice(index + 1).map(b => compareSides(stratum, [a, b], params.seed)))
    })
  return { label: 'observational', feature, metric, comparisons, droppedCells }
}
