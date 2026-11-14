import { describe, expect, it } from 'vitest'

import { summarizePerfAb } from './perf-ab'

function pair(n: number, a: [number, number, number], b: [number, number, number]) {
  return {
    n,
    a: { fps: a[0], p95StageMs: a[1], cpuPctOfCore: a[2] },
    b: { fps: b[0], p95StageMs: b[1], cpuPctOfCore: b[2] },
  }
}

describe('summarizePerfAb', () => {
  it('passes when the median added CPU is at most 1 % of a core and the fps and p95 deltas stay inside the baseline spread', () => {
    const summary = summarizePerfAb([
      pair(1, [60, 2.0, 50], [59.5, 2.1, 50.6]),
      pair(2, [59, 2.2, 52], [59.2, 2.1, 52.9]),
      pair(3, [60.5, 1.9, 51], [60, 2.0, 51.4]),
    ])

    expect(summary.completePairs).toBe(3)
    expect(summary.fps.deltas).toEqual([-0.5, expect.closeTo(0.2), -0.5])
    expect(summary.fps.medianDelta).toBeCloseTo(-0.5)
    expect(summary.fps.band).toEqual({ low: -0.5, high: expect.closeTo(0.2) })
    expect(summary.fps.baselineSpread).toBeCloseTo(1.5)
    expect(summary.cpuPctOfCore.medianDelta).toBeCloseTo(0.6)
    expect(summary.verdict).toEqual({ cpu: true, fps: true, p95StageMs: true, pass: true })
  })

  it('fails the CPU bound when the median added app CPU exceeds 1 % of one core', () => {
    const summary = summarizePerfAb([
      pair(1, [60, 2, 50], [60, 2, 51.5]),
      pair(2, [60, 2, 50], [60, 2, 51.2]),
      pair(3, [60, 2, 50], [60, 2, 50.4]),
    ])

    expect(summary.cpuPctOfCore.medianDelta).toBeCloseTo(1.2)
    expect(summary.verdict).toEqual({ cpu: false, fps: true, p95StageMs: true, pass: false })
  })

  it('fails the fps bound when the median delta leaves the spread of the baseline arm', () => {
    const summary = summarizePerfAb([
      pair(1, [60, 2, 50], [57, 2, 50]),
      pair(2, [59.5, 2, 50], [56, 2, 50]),
      pair(3, [60, 2, 50], [58, 2, 50]),
    ])

    expect(summary.fps.baselineSpread).toBeCloseTo(0.5)
    expect(summary.verdict).toMatchObject({ fps: false, pass: false })
  })

  it('has no verdict without a complete pair', () => {
    expect(summarizePerfAb([]).verdict).toBeNull()
  })
})
