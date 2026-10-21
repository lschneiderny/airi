import type { ChannelCheck, ChannelClass, ScoredChannel } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'

import type { EmotionCellPartial } from '../motion/gate/partials'
import type { GateReport, ResultLevel, ResultTrajectory } from '../motion/gate/report'

import { hashSeed, quantile, scoredChannels } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/emotion-score'
import { buildEmotionChecks, emotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

import * as v from 'valibot'

const pair = v.tuple([v.number(), v.number()])

/** The emotion-check fields the page shows; `looseObject` because the scorer adds more than the report schema names. */
const emotionResultSchema = v.looseObject({
  key: v.string(),
  verdict: v.picklist(['pass', 'fail', 'n/a']),
  emotion: v.string(),
  band: v.string(),
  channel: v.string(),
  unsigned: v.optional(v.boolean()),
  n: v.optional(v.number()),
  E: v.optional(v.nullable(v.number())),
  ci: v.optional(v.nullable(pair)),
  d: v.optional(v.nullable(v.number())),
  hitRate: v.optional(v.nullable(v.number())),
  pHolm: v.optional(v.nullable(v.number())),
  expected: v.optional(v.nullable(v.number())),
  sizeRatio: v.optional(v.nullable(v.number())),
  tau: v.optional(v.nullable(v.number())),
  tauCi: v.optional(v.nullable(pair)),
  residual: v.optional(v.looseObject({ late: v.nullable(v.number()), lateCi: v.nullable(pair), ratio: v.optional(v.nullable(v.number())) })),
  failed: v.optional(v.array(v.string())),
  reasons: v.optional(v.array(v.string())),
  /** T3 transfer gate (todo 16): `E_T3 / E_T1` for this channel, when the run scored it. */
  transferRatio: v.optional(v.nullable(v.number())),
})
export type EmotionResult = v.InferOutput<typeof emotionResultSchema>

/** A result row the page could not read. It keeps whatever key and verdict the row carried so it is never lost. */
export interface MalformedResult {
  key: string
  verdict: string
  problem: string
}

/** Mean trajectory with a bootstrap 95% band on explicit times; from `report.json` or from partials. */
export interface TrajectoryBand {
  times: number[]
  mean: number[]
  low: number[]
  high: number[]
  trials: number
}

export interface ChannelRow {
  result: EmotionResult
  cls: ChannelClass
  /** Null q90 of this channel at this gate level (`report.nullStats`), or `null` when the report lacks it. */
  nullQ: number | null
  /** The report's paired mean trajectory (schema 2) on its 0.1 s grid. */
  trajectory: TrajectoryBand | null
  /** Held-only release grids from `partials/`, when the run dir still has them: 30 Hz detail over the release window. */
  release: TrajectoryBand | null
  levels: ResultLevel[] | null
}

export interface EmotionCell {
  key: string
  emotion: string
  band: string
  verdict: 'pass' | 'fail'
  channels: ChannelRow[]
}

export interface EmotionCells {
  cells: EmotionCell[]
  malformed: MalformedResult[]
}

export interface VisualCheckItem {
  key: string
  verdict: 'pass' | 'fail' | 'unknown'
  reasons: string[]
  /** `null` for a malformed row: it has no trajectories to link to. */
  cell: EmotionCell | null
}

const bandOrder = ['slight', 'clear', 'strong']
const checksByKey = new Map<string, ChannelCheck>(buildEmotionChecks().map(check => [check.key, check]))

function channelClass(channel: string): ChannelClass {
  return channel in scoredChannels ? scoredChannels[channel as ScoredChannel] : 'face'
}

function reportTrajectory(trajectory: ResultTrajectory | null | undefined): TrajectoryBand | null {
  if (!trajectory || trajectory.mean.length === 0)
    return null
  return {
    times: trajectory.mean.map((_, index) => Math.round((trajectory.start + index * trajectory.step) * 1000) / 1000),
    mean: trajectory.mean,
    low: trajectory.low,
    high: trajectory.high,
    trials: trajectory.n,
  }
}

function describeRow(raw: unknown): { key: string, verdict: string } {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  return { key: typeof record.key === 'string' ? record.key : '(no key)', verdict: typeof record.verdict === 'string' ? record.verdict : 'unknown' }
}

/** Groups the emotion checks of a report into `emotion x band` cells in the gate's own order; unreadable rows are returned, never dropped. */
export function emotionCells(report: GateReport, partials: readonly EmotionCellPartial[]): EmotionCells {
  const cells = new Map<string, EmotionCell>()
  const malformed: MalformedResult[] = []
  for (const raw of report.results) {
    const parsed = v.safeParse(emotionResultSchema, raw)
    if (!parsed.success) {
      // Liveliness rows (`sd:ParamAngleX` with value and band) are not emotion checks; only rows that claim to be one are malformed.
      if (looksLikeEmotionRow(raw))
        malformed.push({ ...describeRow(raw), problem: parsed.issues.map(issue => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`).join('; ') })
      continue
    }
    const result = parsed.output
    const key = `${result.emotion}:${result.band}`
    const cell = cells.get(key) ?? { key, emotion: result.emotion, band: result.band, verdict: 'pass', channels: [] }
    if (result.verdict !== 'pass')
      cell.verdict = 'fail'
    cell.channels.push({
      result,
      cls: channelClass(result.channel),
      nullQ: report.nullStats[result.channel]?.q ?? null,
      trajectory: reportTrajectory(raw.trajectory),
      release: releaseBand(partials, checksByKey.get(result.key), result, `${report.gateId}:${result.key}`),
      levels: raw.levels ?? null,
    })
    cells.set(key, cell)
  }
  return {
    cells: [...cells.values()].sort((a, b) => a.emotion.localeCompare(b.emotion) || bandOrder.indexOf(a.band) - bandOrder.indexOf(b.band)),
    malformed,
  }
}

function looksLikeEmotionRow(raw: unknown): boolean {
  const record = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
  return 'emotion' in record || 'channel' in record || (typeof record.key === 'string' && record.key.split(':').length === 3)
}

/** mulberry32: a small seeded generator so the band is the same on every render of the same run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const bootstrapResamples = 200
const gridHz = 30

/**
 * Paired mean of the held-only trials' 30 Hz release grids, direction-folded like the scorer folds them
 * (`check.sign`, times the hold side for sided checks). Trials without a known side on a sided check are skipped.
 * The eyelid is left out: its release grids are paired differences of lid ratios minus one, which cannot be turned
 * into the log-ratio units of `E` and the report trajectory after pairing, so they would not share the panel's axis.
 */
function releaseBand(partials: readonly EmotionCellPartial[], check: ChannelCheck | undefined, result: EmotionResult, seedKey: string): TrajectoryBand | null {
  if (!check || scoredChannels[check.channel] === 'eyelid')
    return null
  const series: number[][] = []
  for (const partial of partials) {
    if (partial.emotion !== result.emotion || partial.band !== result.band)
      continue
    for (const record of partial.records) {
      const trajectory = record.channels[result.channel as ScoredChannel]?.trajectory
      if (record.rejected !== null || !Array.isArray(trajectory) || trajectory.length === 0)
        continue
      const sign = check.sided ? (record.side === null ? null : check.sign * record.side) : check.sign
      if (sign === null)
        continue
      series.push(trajectory.map(value => sign * value))
    }
  }
  if (series.length === 0)
    return null
  const length = Math.min(...series.map(trajectory => trajectory.length))
  const times = Array.from({ length }, (_, index) => emotionGate.release.window[0] + index / gridHz)
  const meanAt = (rows: readonly number[][], index: number) => rows.reduce((sum, row) => sum + row[index], 0) / rows.length
  const random = seededRandom(hashSeed(seedKey))
  const resampled: number[][] = []
  for (let resample = 0; resample < bootstrapResamples; resample++) {
    const picked = series.map(() => series[Math.floor(random() * series.length)])
    resampled.push(times.map((_, index) => meanAt(picked, index)))
  }
  const column = (index: number) => resampled.map(row => row[index])
  return {
    times,
    mean: times.map((_, index) => meanAt(series, index)),
    low: times.map((_, index) => quantile(column(index), 0.025)),
    high: times.map((_, index) => quantile(column(index), 0.975)),
    trials: series.length,
  }
}

/** Size ratios above this pass the gate (`size.ratio` upper bound 1.5) but may read as an extreme face. */
export const visualSizeRatio = 1.3
/** A parameter whose scored-window peak sits within this share of its range of `min` or `max` may be a clipped face. */
export const visualRangeShare = 0.05

/**
 * Parameters of a channel whose mean peak level lies within `visualRangeShare` of the rig's `min` or `max` and moved
 * toward that limit from the baseline. A parameter resting at its limit (cheek or eye smile at 0) that barely moves
 * is not a clipped face; one driven onto the limit is.
 */
export function nearRangeLimit(levels: readonly ResultLevel[] | null): ResultLevel[] {
  return (levels ?? []).filter((level) => {
    const span = level.max - level.min
    if (!(span > 0))
      return false
    // The boundary counts; the tolerance absorbs float rounding of `max - peak`.
    const margin = visualRangeShare * span + 1e-9
    return (level.peak - level.min <= margin && level.peak < level.baseline) || (level.max - level.peak <= margin && level.peak > level.baseline)
  })
}

/** Cells Luke should look at: every failing cell, malformed rows, and passing cells with a large or near-limit face effect. */
export function visualCheckItems(cells: readonly EmotionCell[], malformed: readonly MalformedResult[] = []): VisualCheckItem[] {
  const items: VisualCheckItem[] = []
  for (const cell of cells) {
    const reasons: string[] = []
    const failing = cell.channels.filter(row => row.result.verdict !== 'pass')
    if (failing.length > 0)
      reasons.push(`${failing.length} failing check${failing.length === 1 ? '' : 's'}: ${failing.map(row => `${row.result.channel} (${(row.result.failed ?? []).join(', ') || row.result.verdict})`).join('; ')}`)
    for (const row of cell.channels) {
      const ratio = row.result.sizeRatio
      if (typeof ratio === 'number' && ratio > visualSizeRatio)
        reasons.push(`${row.result.channel} size ratio ${ratio.toFixed(2)} > ${visualSizeRatio}`)
      if (row.cls === 'face' || row.cls === 'eyelid') {
        for (const level of nearRangeLimit(row.levels))
          reasons.push(`${row.result.channel}: ${level.id} peaks at ${level.peak} in [${level.min}, ${level.max}], within ${Math.round(visualRangeShare * 100)}% of the ${level.max - level.peak <= level.peak - level.min ? 'maximum' : 'minimum'}`)
      }
    }
    if (reasons.length > 0)
      items.push({ key: cell.key, verdict: cell.verdict, reasons, cell })
  }
  for (const row of malformed) {
    if (row.verdict === 'pass')
      continue
    items.push({ key: row.key, verdict: row.verdict === 'fail' ? 'fail' : 'unknown', reasons: [`result row could not be read (${row.problem}); its verdict is ${JSON.stringify(row.verdict)}`], cell: null })
  }
  return items
}
