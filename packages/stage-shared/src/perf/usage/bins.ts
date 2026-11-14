/**
 * A versioned set of histogram bin edges in milliseconds.
 *
 * Bin 0 counts values below `edges[0]`, bin `i` counts `[edges[i - 1], edges[i])`, and the last bin
 * (index `edges.length`) is the overflow bin for values at or above the last edge. Records name the set by `id`,
 * so changing the edges requires a new id.
 */
export interface BinSet<Id extends string = string> {
  readonly id: Id
  readonly edges: readonly number[]
}

/** Frame interval bins. 21, 36 and 100 ms are edges so their shares are exact. */
export const FRAME_BINS_V1 = Object.freeze({
  id: 'frame-v1',
  edges: Object.freeze([4, 6, 7.5, 9, 10.5, 12.5, 15, 18, 21, 25, 30, 36, 42, 58, 75, 100, 150, 250, 500, 1000, 2000]),
}) satisfies BinSet<'frame-v1'>

/** Per-stage duration bins for `measureStage` timings. */
export const STAGE_BINS_V1 = Object.freeze({
  id: 'stage-v1',
  edges: Object.freeze([0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16, 25, 50]),
}) satisfies BinSet<'stage-v1'>
