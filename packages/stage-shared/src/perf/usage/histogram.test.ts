import { describe, expect, it } from 'vitest'

import { FRAME_BINS_V1, STAGE_BINS_V1 } from './bins'
import { FixedHistogram } from './histogram'

const binOf15 = FRAME_BINS_V1.edges.indexOf(15) + 1
const binOf21 = FRAME_BINS_V1.edges.indexOf(21) + 1
const overflow = FRAME_BINS_V1.edges.length

describe('bin sets', () => {
  it.each([FRAME_BINS_V1, STAGE_BINS_V1])('$id edges strictly ascend so binary search is valid', ({ edges }) => {
    expect(edges.every((edge, index) => index === 0 || edge > edges[index - 1])).toBe(true)
  })
})

describe('fixedHistogram', () => {
  it('counts an edge value in the bin that starts at it', () => {
    const histogram = new FixedHistogram(FRAME_BINS_V1)
    histogram.add(21)
    histogram.add(20.9)

    const counts = histogram.toArray()
    expect(counts[binOf21]).toBe(1)
    expect(counts[binOf21 - 1]).toBe(1)
  })

  it('sends values below the first edge to bin 0 and values from the last edge to overflow', () => {
    const histogram = new FixedHistogram(FRAME_BINS_V1)
    histogram.add(0)
    histogram.add(2000)
    histogram.add(9999)

    expect(histogram.toSparse()).toEqual([[0, 1], [overflow, 2]])
  })

  it('counts NaN, negative and non-finite values as invalid, outside count', () => {
    const histogram = new FixedHistogram(FRAME_BINS_V1)
    histogram.add(Number.NaN)
    histogram.add(-1)
    histogram.add(Number.POSITIVE_INFINITY)
    histogram.add(16)

    expect(histogram.invalid).toBe(3)
    expect(histogram.count).toBe(1)
  })

  it('reports the exact share at or above an edge', () => {
    const histogram = new FixedHistogram(FRAME_BINS_V1)
    for (const value of [21, Number.NaN, 2500, 20.9])
      histogram.add(value)

    expect(histogram.shareAtLeast(21)).toBe(2 / 3)
    expect(histogram.shareAtLeast(2000)).toBe(1 / 3)
  })

  it('refuses a share threshold that is not an edge', () => {
    const histogram = new FixedHistogram(FRAME_BINS_V1)

    expect(() => histogram.shareAtLeast(20)).toThrow(RangeError)
  })

  it('reuses its counts array across adds and resets', () => {
    const histogram = new FixedHistogram(STAGE_BINS_V1)
    const counts = histogram.counts
    for (let index = 0; index < 100_000; index++)
      histogram.add((index % 600) / 10)

    expect(histogram.counts).toBe(counts)
    expect(counts.length).toBe(STAGE_BINS_V1.edges.length + 1)
    expect(histogram.count).toBe(100_000)

    histogram.reset()
    expect(histogram.counts).toBe(counts)
    expect(histogram.count).toBe(0)
    expect(histogram.invalid).toBe(0)
    expect(histogram.toSparse()).toEqual([])
  })

  it('merges serialized counts from another histogram of the same bins', () => {
    const histogram = new FixedHistogram(FRAME_BINS_V1)
    histogram.add(16)
    const other = new FixedHistogram(FRAME_BINS_V1)
    other.add(16)
    other.add(120)

    histogram.mergeFrom(other.toArray())

    expect(histogram.count).toBe(3)
    expect(histogram.toSparse()).toEqual(other.toSparse().map(([index, count]) => [index, index === binOf15 ? count + 1 : count]))
  })

  it('refuses counts of another length', () => {
    const histogram = new FixedHistogram(FRAME_BINS_V1)

    expect(() => histogram.mergeFrom(new FixedHistogram(STAGE_BINS_V1).toArray())).toThrow(RangeError)
  })

  it('approximates a quantile with the upper edge of the bin that holds it', () => {
    const counts = new FixedHistogram(FRAME_BINS_V1).toArray()
    counts[binOf15] = 90
    counts[binOf21] = 10

    expect(FixedHistogram.approxQuantile(counts, FRAME_BINS_V1.edges, 0.5)).toBe(18)
    expect(FixedHistogram.approxQuantile(counts, FRAME_BINS_V1.edges, 0.95)).toBe(25)
    expect(FixedHistogram.approxQuantile(counts.map(() => 0), FRAME_BINS_V1.edges, 0.5)).toBeNull()
  })

  it('reports the last edge as the quantile lower bound when it falls in overflow', () => {
    const counts = new FixedHistogram(FRAME_BINS_V1).toArray()
    counts[overflow] = 1

    expect(FixedHistogram.approxQuantile(counts, FRAME_BINS_V1.edges, 0.5)).toBe(2000)
  })
})
