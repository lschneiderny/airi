import type { BinSet } from './bins'

/**
 * A histogram over fixed bin edges whose counts live in one preallocated `Uint32Array`.
 *
 * `add` runs on per-frame hot paths: it allocates nothing and does a binary search over the edges.
 * NaN, negative and non-finite values go to `invalid` and stay out of `count`.
 */
export class FixedHistogram {
  readonly edges: readonly number[]
  /** Bin counts, `edges.length + 1` long; the last entry is the overflow bin. The same array lives as long as the histogram. */
  readonly counts: Uint32Array
  #count = 0
  #invalid = 0

  constructor(bins: BinSet) {
    this.edges = bins.edges
    this.counts = new Uint32Array(bins.edges.length + 1)
  }

  get count(): number {
    return this.#count
  }

  get invalid(): number {
    return this.#invalid
  }

  add(value: number): void {
    if (!(value >= 0) || value === Number.POSITIVE_INFINITY) {
      this.#invalid += 1
      return
    }
    // Finds the first edge above the value; a value equal to an edge belongs to the bin that starts at it.
    let low = 0
    let high = this.edges.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (value < this.edges[middle])
        high = middle
      else
        low = middle + 1
    }
    this.counts[low] += 1
    this.#count += 1
  }

  reset(): void {
    this.counts.fill(0)
    this.#count = 0
    this.#invalid = 0
  }

  /** Adds counts serialized from a histogram over the same bins, for example a record's `frameHist`. */
  mergeFrom(counts: ArrayLike<number>): void {
    if (counts.length !== this.counts.length)
      throw new RangeError(`Expected ${this.counts.length} bin counts, received ${counts.length}`)
    for (let index = 0; index < counts.length; index++) {
      this.counts[index] += counts[index]
      this.#count += counts[index]
    }
  }

  toArray(): number[] {
    return Array.from(this.counts)
  }

  /** Non-zero bins as `[binIndex, count]` pairs in bin order. */
  toSparse(): [number, number][] {
    const sparse: [number, number][] = []
    this.counts.forEach((count, index) => {
      if (count > 0)
        sparse.push([index, count])
    })
    return sparse
  }

  /**
   * Share of valid values at or above `edgeMs`, exact because `edgeMs` must be a bin edge.
   * Returns 0 for an empty histogram; read `count` to tell that apart from a real zero.
   */
  shareAtLeast(edgeMs: number): number {
    const edgeIndex = this.edges.indexOf(edgeMs)
    if (edgeIndex === -1)
      throw new RangeError(`${edgeMs} is not a bin edge, so its share cannot be exact`)
    if (this.#count === 0)
      return 0
    let atLeast = 0
    for (let index = edgeIndex + 1; index < this.counts.length; index++)
      atLeast += this.counts[index]
    return atLeast / this.#count
  }

  /**
   * Approximates quantile `q` (0..1) of serialized counts as the upper edge of the bin that holds it.
   * A quantile in the overflow bin has no upper edge, so it returns the last edge as a lower bound.
   * Returns `null` when the counts are empty.
   */
  static approxQuantile(counts: ArrayLike<number>, edges: readonly number[], q: number): number | null {
    let total = 0
    for (let index = 0; index < counts.length; index++)
      total += counts[index]
    if (total === 0)
      return null
    const rank = Math.max(1, Math.ceil(q * total))
    let seen = 0
    for (let index = 0; index < counts.length; index++) {
      seen += counts[index]
      if (seen >= rank)
        return edges[Math.min(index, edges.length - 1)]
    }
    return edges[edges.length - 1]
  }
}
