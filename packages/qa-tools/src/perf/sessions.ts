import type { SegmentCell } from '@proj-airi/stage-shared/perf/usage'

import type { PerfData, PerfSegment } from './read'

import { FixedHistogram, FRAME_BINS_V1 } from '@proj-airi/stage-shared/perf/usage'

/** One `pnpm perf sessions` row: every segment of a session merged. Numbers are `null` when no segment holds them. */
export interface SessionSummary {
  readonly sessionId: string
  readonly dir: string
  /** `platform/arch` of the recording machine. */
  readonly host: string | null
  readonly buildMode: string | null
  readonly startedAt: number | null
  readonly endedAt: number
  readonly durationMs: number | null
  readonly segments: number
  readonly failedSegments: number
  /** Identity of the lowest epoch seen; `dirty` is true when any epoch was dirty. */
  readonly sha: string | null
  readonly shortSha: string | null
  readonly dirty: boolean | null
  readonly epochs: number
  /** The renderer and model of the most windows. */
  readonly renderer: string | null
  readonly modelId: string | null
  readonly modelName: string | null
  /** Frames over the counted windows' time: frames / (windows x 5 s), from the included stage windows. */
  readonly fps: number | null
  /** 1000 / the median frame interval, where the median is its bin's upper edge, so this is a lower bound. */
  readonly medianFpsLowerBound: number | null
  readonly share36: number | null
  readonly share100: number | null
  /** Window-weighted median of each cell's median stage-window CPU, percent of one core. */
  readonly stageCpuPct: number | null
  readonly maxWorkingSetKb: number | null
  readonly incidents: number
  readonly recovered: boolean
  readonly live: boolean
}

/** Each window rollup covers one recorder tick. */
const ROLLUP_WINDOW_SECONDS = 5

export interface SessionFilter {
  readonly now: number
  /** Keeps sessions that started (or, without a start, last wrote) within this window. */
  readonly sinceMs: number | null
}

/** The value at which the cumulative weight first reaches half of the total. */
function weightedMedian(entries: readonly { readonly value: number, readonly weight: number }[]): number | null {
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

function mostWindows(cells: readonly SegmentCell[], pick: (cell: SegmentCell) => string | null): string | null {
  const windows = new Map<string | null, number>()
  for (const cell of cells)
    windows.set(pick(cell), (windows.get(pick(cell)) ?? 0) + cell.windows)
  let best: string | null = null
  let bestWindows = 0
  for (const [value, count] of windows) {
    if (count > bestWindows) {
      best = value
      bestWindows = count
    }
  }
  return best
}

function summarize(segments: readonly PerfSegment[]): SessionSummary {
  const [first] = segments
  const rollups = segments.flatMap(segment => (segment.row.kind === 'segment-rollup' ? [segment.row] : []))
  const cells = rollups.flatMap(row => row.cells)
  const startedAt = rollups.length > 0 ? Math.min(...rollups.map(row => row.startedAt)) : null
  const endedAt = Math.max(...segments.map(segment => segment.row.t))
  const epochs = new Map(segments.flatMap(segment => segment.identities).map(identity => [identity.epoch, identity]))
  const firstIdentity = [...epochs.values()].toSorted((left, right) => left.epoch - right.epoch)[0]
  const dirtyValues = [...epochs.values()].map(identity => identity.dirty)
  const frames = new FixedHistogram(FRAME_BINS_V1)
  for (const cell of cells)
    frames.mergeFrom(cell.frameHist)
  const p50FrameMs = FixedHistogram.approxQuantile(frames.counts, frames.edges, 0.5)
  const workingSets = segments.flatMap(segment => (segment.maxWorkingSetKb === null ? [] : [segment.maxWorkingSetKb]))
  const countedWindows = cells.reduce((sum, cell) => sum + cell.windows, 0)
  const host = rollups[0]?.host
  return {
    sessionId: first.sessionId,
    dir: first.dir,
    host: host === undefined ? null : `${host.platform}/${host.arch}`,
    buildMode: rollups[0]?.buildMode ?? null,
    startedAt,
    endedAt,
    durationMs: startedAt === null ? null : endedAt - startedAt,
    segments: segments.length,
    failedSegments: segments.length - rollups.length,
    sha: firstIdentity?.sha ?? null,
    shortSha: firstIdentity?.sha.slice(0, 7) ?? null,
    dirty: dirtyValues.includes(true) ? true : dirtyValues.includes(false) ? false : null,
    epochs: epochs.size,
    renderer: mostWindows(cells, cell => cell.renderer),
    modelId: mostWindows(cells, cell => cell.modelId),
    modelName: segments.findLast(segment => segment.modelName !== null)?.modelName ?? null,
    fps: countedWindows === 0 ? null : cells.reduce((sum, cell) => sum + cell.frames, 0) / (countedWindows * ROLLUP_WINDOW_SECONDS),
    medianFpsLowerBound: p50FrameMs === null ? null : 1000 / p50FrameMs,
    share36: frames.count === 0 ? null : frames.shareAtLeast(36),
    share100: frames.count === 0 ? null : frames.shareAtLeast(100),
    stageCpuPct: weightedMedian(cells.flatMap(cell => (cell.quartiles.cpuPct === null ? [] : [{ value: cell.quartiles.cpuPct.median, weight: cell.windows }]))),
    maxWorkingSetKb: workingSets.length > 0 ? Math.max(...workingSets) : null,
    // Raw incident lines also count incidents of excluded windows and windowless processes; a rolled-up segment
    // keeps only its cells' counts, so each segment takes whichever source saw more.
    incidents: segments.reduce((sum, segment) => {
      const cellIncidents = segment.row.kind === 'segment-rollup' ? segment.row.cells.reduce((total, cell) => total + cell.incidents, 0) : 0
      return sum + Math.max(cellIncidents, segment.incidentIds.length)
    }, 0),
    recovered: rollups.some(row => row.recovered),
    live: segments.some(segment => segment.live),
  }
}

/** Groups segments by session id (across directories) into rows sorted by start, oldest first. */
export function summarizeSessions(data: PerfData, filter: SessionFilter): SessionSummary[] {
  const bySession = new Map<string, PerfSegment[]>()
  for (const segment of data.segments)
    bySession.set(segment.sessionId, [...bySession.get(segment.sessionId) ?? [], segment])
  const cutoff = filter.sinceMs === null ? Number.NEGATIVE_INFINITY : filter.now - filter.sinceMs
  return [...bySession.values()]
    .map(summarize)
    .filter(summary => (summary.startedAt ?? summary.endedAt) >= cutoff)
    .toSorted((left, right) => (left.startedAt ?? left.endedAt) - (right.startedAt ?? right.endedAt))
}
