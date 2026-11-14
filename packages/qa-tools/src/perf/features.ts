import type { FeatureCompareRollup, FeatureComparison, FeatureComparisonReport, FeatureMetric, FeatureSide, SegmentCell, UsageFeatureKey, UsageHost } from '@proj-airi/stage-shared/perf/usage'

import type { LeaseContention } from './lease'
import type { PerfData } from './read'

import { compareFeature, FEATURE_MIN_BLOCKS, FEATURE_MIN_DECISIVE_PAIRED_SESSIONS, FEATURE_MIN_PAIRED_SESSIONS, FEATURE_MIN_SESSIONS, FEATURE_MIN_WINDOWS, USAGE_FEATURE_KEYS } from '@proj-airi/stage-shared/perf/usage'

/** One rolled-up segment; its cells' buckets carry the time spans the lease history join needs. */
export interface UsageRollup {
  readonly sessionId: string
  readonly host: UsageHost
  readonly cells: readonly SegmentCell[]
}

export interface FeatureOptions {
  /** `null` compares every feature. */
  readonly feature: UsageFeatureKey | null
  readonly metric: FeatureMetric
  readonly seed: number
}

/** How often each value of the feature occurs in the cells that were not dropped as contended. */
export interface FeatureValueCount {
  readonly value: FeatureSide['value']
  readonly cells: number
  readonly sessions: number
  readonly windows: number
}

export interface FeatureReport extends FeatureComparisonReport {
  readonly values: readonly FeatureValueCount[]
}

/** Every segment with a rollup row; a failed rollup holds no cells. */
export function usageRollups(data: PerfData): UsageRollup[] {
  return data.segments.flatMap(({ row }) => (row.kind === 'segment-rollup'
    ? [{ sessionId: row.sessionId, host: row.host, cells: row.cells }]
    : []))
}

function valueCounts(rollups: readonly FeatureCompareRollup[], feature: UsageFeatureKey): FeatureValueCount[] {
  const counts = new Map<string, { value: FeatureSide['value'], cells: number, sessions: Set<string>, windows: number }>()
  for (const rollup of rollups) {
    for (const cell of rollup.cells) {
      if (cell.hostContended || cell.leaseContended === true)
        continue
      const value = cell.features[feature]
      const key = JSON.stringify(value)
      const count = counts.get(key) ?? { value, cells: 0, sessions: new Set<string>(), windows: 0 }
      count.cells += 1
      count.sessions.add(rollup.sessionId)
      count.windows += cell.windows
      counts.set(key, count)
    }
  }
  return [...counts.values()].map(count => ({ value: count.value, cells: count.cells, sessions: count.sessions.size, windows: count.windows }))
}

/** Runs `compareFeature` per requested feature over rollups whose cells already carry `leaseContended` (`markLeaseContention`). */
export function featureReports(rollups: readonly FeatureCompareRollup[], options: FeatureOptions): FeatureReport[] {
  const features = options.feature === null ? USAGE_FEATURE_KEYS : [options.feature]
  return features.map(feature => ({
    ...compareFeature({ rollups, feature, metric: options.metric, seed: options.seed }),
    values: valueCounts(rollups, feature),
  }))
}

/** The lease-history line `features` and `compare` print. */
export function formatLeaseBuckets(lease: Pick<LeaseContention, 'buckets' | 'keptWindowShare'>): string {
  const kept = lease.keptWindowShare === null ? 'no windows' : `${Number((lease.keptWindowShare * 100).toFixed(1))}% of windows kept`
  return `lease history: ${lease.buckets.contended} 5-minute buckets contended, ${lease.buckets.clear} clear, ${lease.buckets.uncovered} not covered; ${kept}`
}

const number = (value: number | null) => (value === null ? '-' : Number(value.toFixed(3)).toString())
const signed = (value: number) => `${value > 0 ? '+' : ''}${number(value)}`

function formatSide(label: string, feature: string, side: FeatureSide): string {
  return `    ${label} ${feature}=${JSON.stringify(side.value)}: ${side.blocks} blocks, ${side.sessions} sessions, ${side.windows} windows, median ${number(side.median)} (IQR ${number(side.q1)} to ${number(side.q3)})`
}

function formatStratum(comparison: FeatureComparison): string {
  const { stratum } = comparison
  const others = Object.entries(stratum.otherFeatures).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(' ')
  return `  stratum: ${stratum.platform} "${stratum.cpuModel}", ${stratum.renderer}/${stratum.modelId ?? '-'}, ${stratum.activity}, ${stratum.window} (${stratum.stageHost} host), ${stratum.refreshHz} Hz, devtools ${stratum.devtoolsOpen ? 'open' : 'closed'}; ${others}`
}

function formatComparison(report: FeatureReport, comparison: FeatureComparison): string[] {
  const lines = [formatStratum(comparison), formatSide('a', report.feature, comparison.a), formatSide('b', report.feature, comparison.b)]
  if (comparison.verdict === 'insufficient') {
    lines.push(`    verdict: insufficient data (observational): each side needs ${FEATURE_MIN_BLOCKS} blocks, ${FEATURE_MIN_SESSIONS} sessions and ${FEATURE_MIN_WINDOWS} windows`)
    return lines
  }
  const { unpaired, paired } = comparison
  const percent = unpaired.differencePct === null ? '' : ` (${signed(unpaired.differencePct)}%)`
  lines.push(
    `    verdict: ${comparison.verdict} (observational, decided by the ${comparison.basis} estimate)`,
    `    unpaired: difference ${signed(unpaired.difference)}${percent}, 90% CI ${number(unpaired.ci.low)} to ${number(unpaired.ci.high)}, Cliff's delta ${number(unpaired.cliffsDelta)}, noise floor ${number(unpaired.noiseFloor)}, ${unpaired.verdict}`,
  )
  if (paired === null) {
    lines.push(`    paired: not estimated, fewer than ${FEATURE_MIN_PAIRED_SESSIONS} sessions hold both values`)
    return lines
  }
  const decisive = paired.decisive
    ? `decisive: ${paired.sessions} sessions hold both values, at least ${FEATURE_MIN_DECISIVE_PAIRED_SESSIONS}`
    : `not decisive: ${paired.sessions} sessions hold both values, fewer than ${FEATURE_MIN_DECISIVE_PAIRED_SESSIONS}; paired comparisons have low power below about ${FEATURE_MIN_DECISIVE_PAIRED_SESSIONS} sessions`
  lines.push(`    paired: difference ${signed(paired.difference)}, 90% CI ${number(paired.ci.low)} to ${number(paired.ci.high)}, noise floor ${number(paired.noiseFloor)}, ${paired.verdict}; ${decisive}`)
  return lines
}

export function formatFeatureReports(reports: readonly FeatureReport[], lease: Pick<LeaseContention, 'buckets' | 'keptWindowShare'>): string {
  const sections = reports.map((report) => {
    const header = `${report.feature} ${report.metric} (observational)`
    const dropped = `  dropped cells: ${report.droppedCells.hostContended} host contended, ${report.droppedCells.leaseContended} lease contended`
    if (report.comparisons.length === 0) {
      const values = report.values.map(count => `${JSON.stringify(count.value)}: ${count.cells} cells, ${count.sessions} sessions, ${count.windows} windows`).join('; ') || 'no cells'
      return [header, `  insufficient data: no stratum holds two values (${values})`, dropped].join('\n')
    }
    return [header, ...report.comparisons.flatMap(comparison => formatComparison(report, comparison)), dropped].join('\n')
  })
  return [
    ...sections,
    formatLeaseBuckets(lease),
    'Observational: usage sessions are not controlled experiments. The 90% intervals are percentile bootstraps, which under-cover at small sample sizes.',
  ].join('\n\n')
}
