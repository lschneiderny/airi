import type { FeatureCompareCell, FeatureCompareRollup, FeatureMetric, FeatureStratum, UsageFeatures } from '@proj-airi/stage-shared/perf/usage'

import { FEATURE_METRICS, median } from '@proj-airi/stage-shared/perf/usage'

import { PerfUsageError } from './args'

export interface CommitCompareOptions {
  /** Commit sha prefixes; each must match at most one recorded sha. */
  readonly shaA: string
  readonly shaB: string
  readonly includeDirty: boolean
}

export type CommitStratum = Omit<FeatureStratum, 'otherFeatures'> & { readonly features: UsageFeatures }

export interface CommitSide {
  readonly sessions: number
  readonly cells: number
  readonly windows: number
  /** Cells whose identity came from build info, so whether the tree was dirty is unknown; they are kept. */
  readonly unknownDirty: number
  /** Median over cells of each cell's median; `null` when no cell holds the metric. */
  readonly medians: Readonly<Record<FeatureMetric, number | null>>
}

export interface CommitComparisonReport {
  /** Usage sessions of two commits differ in more than the commit; `pnpm perf compare --bench` is the controlled comparison. */
  readonly label: 'observational'
  readonly resolved: { readonly a: readonly string[], readonly b: readonly string[] }
  readonly includeDirty: boolean
  readonly strata: readonly { readonly stratum: CommitStratum, readonly a: CommitSide, readonly b: CommitSide }[]
  readonly excluded: { readonly dirty: number, readonly hostContended: number }
}

interface SideCells {
  readonly sessions: Set<string>
  readonly cells: FeatureCompareCell[]
}

function resolveSha(rollups: readonly FeatureCompareRollup[], prefix: string): string[] {
  const lower = prefix.toLowerCase()
  const shas = [...new Set(rollups.flatMap(rollup => rollup.cells.map(cell => cell.sha)))].filter(sha => sha.toLowerCase().startsWith(lower)).sort()
  if (shas.length > 1)
    throw new PerfUsageError(`sha prefix "${prefix}" matches ${shas.length} commits: ${shas.join(', ')}`)
  return shas
}

function medianOf(cells: readonly FeatureCompareCell[], metric: FeatureMetric): number | null {
  const values = cells.flatMap((cell) => {
    const quartiles = cell.quartiles[metric]
    return quartiles === null ? [] : [quartiles.median]
  })
  return values.length > 0 ? median(values) : null
}

function sideOf(side: SideCells | undefined): CommitSide {
  const cells = side?.cells ?? []
  const medians: Record<FeatureMetric, number | null> = {
    p50FrameMs: medianOf(cells, 'p50FrameMs'),
    share21: medianOf(cells, 'share21'),
    share36: medianOf(cells, 'share36'),
    share100: medianOf(cells, 'share100'),
    cpuPct: medianOf(cells, 'cpuPct'),
    workingSetKb: medianOf(cells, 'workingSetKb'),
  }
  return {
    sessions: side?.sessions.size ?? 0,
    cells: cells.length,
    windows: cells.reduce((sum, cell) => sum + cell.windows, 0),
    unknownDirty: cells.filter(cell => cell.dirty === null).length,
    medians,
  }
}

/**
 * Per-stratum medians of two commits' usage cells. Strata hold host, renderer, model, activity, window, stage
 * host, devtools, refresh rate and every feature value, and are never pooled. Dirty cells are excluded unless
 * `includeDirty`; host-contended cells are always excluded.
 */
export function compareCommits(rollups: readonly FeatureCompareRollup[], options: CommitCompareOptions): CommitComparisonReport {
  const resolved = { a: resolveSha(rollups, options.shaA), b: resolveSha(rollups, options.shaB) }
  const excluded = { dirty: 0, hostContended: 0 }
  const strata = new Map<string, { stratum: CommitStratum, a?: SideCells, b?: SideCells }>()
  for (const rollup of rollups) {
    for (const cell of rollup.cells) {
      const sides = (['a', 'b'] as const).filter(side => resolved[side].includes(cell.sha))
      if (sides.length === 0)
        continue
      if (cell.dirty === true && !options.includeDirty) {
        excluded.dirty += 1
        continue
      }
      if (cell.hostContended) {
        excluded.hostContended += 1
        continue
      }
      const stratum: CommitStratum = {
        platform: rollup.host.platform,
        cpuModel: rollup.host.cpuModel,
        renderer: cell.renderer,
        modelId: cell.modelId,
        activity: cell.activity,
        window: cell.window,
        stageHost: cell.stageHost,
        devtoolsOpen: cell.devtoolsOpen,
        refreshHz: cell.refreshHz,
        features: cell.features,
      }
      const key = JSON.stringify(stratum)
      const entry = strata.get(key) ?? { stratum }
      strata.set(key, entry)
      for (const side of sides) {
        const cells = entry[side] ?? { sessions: new Set<string>(), cells: [] }
        cells.sessions.add(rollup.sessionId)
        cells.cells.push(cell)
        entry[side] = cells
      }
    }
  }
  return {
    label: 'observational',
    resolved,
    includeDirty: options.includeDirty,
    strata: [...strata.entries()]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([, entry]) => ({ stratum: entry.stratum, a: sideOf(entry.a), b: sideOf(entry.b) })),
    excluded,
  }
}

const value = (metric: number | null) => (metric === null ? '-' : Number(metric.toFixed(3)).toString())

export function formatCommitComparison(report: CommitComparisonReport, shas: { readonly a: string, readonly b: string }): string {
  const name = (side: 'a' | 'b') => report.resolved[side][0]?.slice(0, 7) ?? `${shas[side]} (no usage cells)`
  const sections = report.strata.map(({ stratum, a, b }) => {
    const features = Object.entries(stratum.features).map(([key, feature]) => `${key}=${JSON.stringify(feature)}`).join(' ')
    const side = (label: string, data: CommitSide) => `    ${label}: ${data.sessions} sessions, ${data.cells} cells, ${data.windows} windows${data.unknownDirty > 0 ? `, ${data.unknownDirty} cells of unknown dirty state` : ''}; ${FEATURE_METRICS.map(metric => `${metric} ${value(data.medians[metric])}`).join(', ')}`
    return [
      `  stratum: ${stratum.platform} "${stratum.cpuModel}", ${stratum.renderer}/${stratum.modelId ?? '-'}, ${stratum.activity}, ${stratum.window} (${stratum.stageHost} host), ${stratum.refreshHz} Hz, devtools ${stratum.devtoolsOpen ? 'open' : 'closed'}; ${features}`,
      side(name('a'), a),
      side(name('b'), b),
    ].join('\n')
  })
  return [
    `compare ${name('a')} -> ${name('b')} (observational, medians of cell medians)`,
    ...(sections.length > 0 ? sections : ['  no usage cells for either commit']),
    `excluded cells: ${report.excluded.dirty} dirty${report.includeDirty ? '' : ' (use --include-dirty to keep them)'}, ${report.excluded.hostContended} host contended`,
    'Observational: usage sessions of two commits differ in more than the commit. For a controlled comparison, run the bench and use `pnpm perf compare --bench <refA> <refB>`.',
  ].join('\n')
}
