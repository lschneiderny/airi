import type { SegmentBucket, SegmentCell, SegmentCellKey, SegmentCellTotals, WindowRollupRecord } from './records'

import { FRAME_BINS_V1, STAGE_BINS_V1 } from './bins'
import { weightedMedian } from './compare-stats'
import { FixedHistogram } from './histogram'

/** The wall-clock span of one bucket; buckets start at multiples of it since the epoch. */
export const SEGMENT_BUCKET_MS = 300_000

type Quartiles = SegmentCellTotals['quartiles']['p50FrameMs']
type Stages = NonNullable<SegmentCellTotals['stages']>

/** One included window's contribution, with its headline values already computed. */
export interface CellWindow {
  readonly record: WindowRollupRecord
  /** The window covers `(startMs, record.t]`. */
  readonly startMs: number
  readonly p50FrameMs: number
  readonly share21: number
  readonly share36: number
  readonly share100: number
  readonly cpuPct: number | null
  readonly workingSetKb: number | null
  readonly incidents: number
}

/** Linear-interpolation quartiles of a non-empty list. */
function quartilesOf(values: readonly number[]): Quartiles {
  const sorted = values.toSorted((left, right) => left - right)
  const at = (q: number) => {
    const position = (sorted.length - 1) * q
    const lower = Math.floor(position)
    return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower)
  }
  return { q1: at(0.25), median: at(0.5), q3: at(0.75) }
}

/** Stage timings merged across windows or buckets: counts and sums add, maxima take the larger, bins add. */
class StageTotals {
  readonly #stages = new Map<string, { n: number, sumMs: number, maxMs: number, readonly counts: number[] }>()

  add(stages: Stages | null): void {
    for (const [stageId, stage] of Object.entries(stages ?? {})) {
      let total = this.#stages.get(stageId)
      if (total === undefined) {
        total = { n: 0, sumMs: 0, maxMs: 0, counts: Array.from<number>({ length: STAGE_BINS_V1.edges.length + 1 }).fill(0) }
        this.#stages.set(stageId, total)
      }
      total.n += stage.n
      total.sumMs += stage.sumMs
      total.maxMs = Math.max(total.maxMs, stage.maxMs)
      for (const [binIndex, count] of stage.hist)
        total.counts[binIndex] += count
    }
  }

  toStages(): Stages | null {
    if (this.#stages.size === 0)
      return null
    return Object.fromEntries([...this.#stages].map(([stageId, total]) => [stageId, {
      n: total.n,
      sumMs: total.sumMs,
      maxMs: total.maxMs,
      hist: total.counts.flatMap((count, binIndex): [number, number][] => (count > 0 ? [[binIndex, count]] : [])),
    }]))
  }
}

/**
 * Accumulates the included windows of one bucket of a segment cell. Histograms and stage timings merge as windows
 * arrive; headline values are kept per window (at most one bucket's worth) and turned into quartiles in `toBucket`.
 */
export class SegmentBucketAccumulator {
  incidents = 0
  #startMs = Number.POSITIVE_INFINITY
  #endMs = 0
  #windows = 0
  #frames = 0
  readonly #frameHist = new FixedHistogram(FRAME_BINS_V1)
  readonly #stages = new StageTotals()
  readonly #headlines = { p50FrameMs: [] as number[], share21: [] as number[], share36: [] as number[], share100: [] as number[], cpuPct: [] as number[], workingSetKb: [] as number[] }

  add(window: CellWindow): void {
    const { record } = window
    this.#startMs = Math.min(this.#startMs, window.startMs)
    this.#endMs = Math.max(this.#endMs, record.t)
    this.#windows += 1
    this.#frames += record.frames
    this.incidents += window.incidents
    this.#frameHist.mergeFrom(record.frameHist)
    this.#headlines.p50FrameMs.push(window.p50FrameMs)
    this.#headlines.share21.push(window.share21)
    this.#headlines.share36.push(window.share36)
    this.#headlines.share100.push(window.share100)
    if (window.cpuPct !== null)
      this.#headlines.cpuPct.push(window.cpuPct)
    if (window.workingSetKb !== null)
      this.#headlines.workingSetKb.push(window.workingSetKb)
    this.#stages.add(record.stages)
  }

  /** A bucket exists only once a window was added, so the headline lists are never empty. */
  toBucket(): SegmentBucket {
    const headlines = this.#headlines
    return {
      startMs: this.#startMs,
      endMs: this.#endMs,
      windows: this.#windows,
      frames: this.#frames,
      frameHist: this.#frameHist.toArray(),
      quartiles: {
        p50FrameMs: quartilesOf(headlines.p50FrameMs),
        share21: quartilesOf(headlines.share21),
        share36: quartilesOf(headlines.share36),
        share100: quartilesOf(headlines.share100),
        cpuPct: headlines.cpuPct.length > 0 ? quartilesOf(headlines.cpuPct) : null,
        workingSetKb: headlines.workingSetKb.length > 0 ? quartilesOf(headlines.workingSetKb) : null,
      },
      stages: this.#stages.toStages(),
      incidents: this.incidents,
    }
  }
}

/** Accumulates the included windows of one segment cell into wall-clock buckets. */
export class SegmentCellAccumulator {
  readonly key: SegmentCellKey
  readonly #buckets = new Map<number, SegmentBucketAccumulator>()

  constructor(key: SegmentCellKey) {
    this.key = key
  }

  /**
   * Adds a window to the bucket its end falls in and returns that bucket. A window covers `(startMs, t]`, so one
   * ending exactly on a boundary belongs to the bucket before it.
   */
  add(window: CellWindow): SegmentBucketAccumulator {
    const index = Math.floor((window.record.t - 1) / SEGMENT_BUCKET_MS)
    let bucket = this.#buckets.get(index)
    if (bucket === undefined) {
      bucket = new SegmentBucketAccumulator()
      this.#buckets.set(index, bucket)
    }
    bucket.add(window)
    return bucket
  }

  /** A cell exists only once a window was added, so it has a bucket; a cell's windows arrive in time order. */
  toCell(): SegmentCell {
    const [first, ...rest] = [...this.#buckets.values()].map(bucket => bucket.toBucket())
    return { ...this.key, buckets: [first, ...rest] }
  }
}

interface WindowQuartiles {
  readonly quartiles: Quartiles
  readonly windows: number
}

function weightedQuartiles(entries: readonly [WindowQuartiles, ...WindowQuartiles[]]): Quartiles {
  const [first, ...rest] = entries
  const at = (key: keyof Quartiles) => {
    const value = (entry: WindowQuartiles) => ({ value: entry.quartiles[key], weight: entry.windows })
    return weightedMedian([value(first), ...rest.map(value)])
  }
  return { q1: at('q1'), median: at('median'), q3: at('q3') }
}

/**
 * A cell's totals over some of its buckets, such as those a reader keeps after dropping lease-contended ones.
 * Counts, the frame histogram and stage timings merge exactly. A bucket keeps only the quartiles of its own windows,
 * so each quartile of the totals is the window-weighted (lower) median of the buckets' values; over one bucket the
 * totals are that bucket's own.
 */
export function bucketTotals(buckets: readonly [SegmentBucket, ...SegmentBucket[]]): SegmentCellTotals {
  const frameHist = new FixedHistogram(FRAME_BINS_V1)
  const stages = new StageTotals()
  for (const bucket of buckets) {
    frameHist.mergeFrom(bucket.frameHist)
    stages.add(bucket.stages)
  }
  const [first, ...rest] = buckets
  const always = (pick: (quartiles: SegmentCellTotals['quartiles']) => Quartiles) => {
    const entry = (bucket: SegmentBucket) => ({ quartiles: pick(bucket.quartiles), windows: bucket.windows })
    return weightedQuartiles([entry(first), ...rest.map(entry)])
  }
  const joined = (pick: (quartiles: SegmentCellTotals['quartiles']) => Quartiles | null) => {
    const [head, ...tail] = buckets.flatMap((bucket) => {
      const quartiles = pick(bucket.quartiles)
      return quartiles === null ? [] : [{ quartiles, windows: bucket.windows }]
    })
    return head === undefined ? null : weightedQuartiles([head, ...tail])
  }
  return {
    windows: buckets.reduce((sum, bucket) => sum + bucket.windows, 0),
    frames: buckets.reduce((sum, bucket) => sum + bucket.frames, 0),
    frameHist: frameHist.toArray(),
    quartiles: {
      p50FrameMs: always(quartiles => quartiles.p50FrameMs),
      share21: always(quartiles => quartiles.share21),
      share36: always(quartiles => quartiles.share36),
      share100: always(quartiles => quartiles.share100),
      cpuPct: joined(quartiles => quartiles.cpuPct),
      workingSetKb: joined(quartiles => quartiles.workingSetKb),
    },
    stages: stages.toStages(),
    incidents: buckets.reduce((sum, bucket) => sum + bucket.incidents, 0),
  }
}
