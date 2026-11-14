import type { SegmentCell, WindowRollupRecord } from './records'

import { FRAME_BINS_V1, STAGE_BINS_V1 } from './bins'
import { FixedHistogram } from './histogram'

/** The fields that group windows into one cell. */
export type SegmentCellKey = Omit<SegmentCell, 'windows' | 'frames' | 'frameHist' | 'quartiles' | 'stages' | 'incidents'>

type Quartiles = SegmentCell['quartiles']['p50FrameMs']

/** One included window's contribution, with its headline values already computed. */
export interface CellWindow {
  readonly record: WindowRollupRecord
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

/**
 * Accumulates the included windows of one segment cell. Histograms and stage timings merge as windows arrive;
 * headline values are kept per window (bounded by the window count) and turned into quartiles in `toCell`.
 */
export class SegmentCellAccumulator {
  readonly key: SegmentCellKey
  incidents = 0
  #windows = 0
  #frames = 0
  readonly #frameHist = new FixedHistogram(FRAME_BINS_V1)
  readonly #stages = new Map<string, { n: number, sumMs: number, maxMs: number, readonly counts: number[] }>()
  readonly #headlines = { p50FrameMs: [] as number[], share21: [] as number[], share36: [] as number[], share100: [] as number[], cpuPct: [] as number[], workingSetKb: [] as number[] }

  constructor(key: SegmentCellKey) {
    this.key = key
  }

  add(window: CellWindow): void {
    const { record } = window
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
    for (const [stageId, stage] of Object.entries(record.stages ?? {})) {
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

  /** The cell's record; a cell exists only once a window was added, so the headline lists are never empty. */
  toCell(): SegmentCell {
    const headlines = this.#headlines
    return {
      ...this.key,
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
      stages: this.#stages.size > 0
        ? Object.fromEntries([...this.#stages].map(([stageId, total]) => [stageId, {
            n: total.n,
            sumMs: total.sumMs,
            maxMs: total.maxMs,
            hist: total.counts.flatMap((count, binIndex): [number, number][] => (count > 0 ? [[binIndex, count]] : [])),
          }]))
        : null,
      incidents: this.incidents,
    }
  }
}
