import { describe, expect, it } from 'vitest'

import { PerfUsageError } from './args'
import { compareCommits } from './compare'
import { fixtureCell, fixtureRollups } from './usage-fixture'

const shaA = 'a'.repeat(40)
const shaB = 'b'.repeat(40)

function rollups() {
  return fixtureRollups([
    fixtureCell(16, { sha: shaA }),
    fixtureCell(18, { sha: shaA }),
    fixtureCell(30, { sha: shaA, dirty: true }),
    fixtureCell(20, { sha: shaB }),
    fixtureCell(22, { sha: shaB, dirty: null }),
  ])
}

describe('compareCommits', () => {
  it('compares per-stratum medians of two commits, excluding dirty cells by default', () => {
    const report = compareCommits(rollups(), { shaA: 'aaaaaaa', shaB: 'bbbbbbb', includeDirty: false })

    expect(report.label).toBe('observational')
    expect(report.excluded.dirty).toBe(1)
    expect(report.strata).toHaveLength(1)
    expect(report.strata[0].a).toMatchObject({ sessions: 2, cells: 2, windows: 60, medians: { p50FrameMs: 17, cpuPct: 170 } })
    expect(report.strata[0].b).toMatchObject({ sessions: 2, cells: 2, unknownDirty: 1, medians: { p50FrameMs: 21 } })
  })

  it('keeps dirty cells with --include-dirty', () => {
    const report = compareCommits(rollups(), { shaA: shaA.slice(0, 7), shaB: shaB.slice(0, 7), includeDirty: true })

    expect(report.excluded.dirty).toBe(0)
    expect(report.strata[0].a).toMatchObject({ sessions: 3, medians: { p50FrameMs: 18 } })
  })

  it('excludes lease-contended cells', () => {
    const contended = fixtureRollups([fixtureCell(16, { sha: shaA }), { ...fixtureCell(40, { sha: shaA }), leaseContended: true }, fixtureCell(20, { sha: shaB })])
    const report = compareCommits(contended, { shaA: 'aaaaaaa', shaB: 'bbbbbbb', includeDirty: false })

    expect(report.excluded.leaseContended).toBe(1)
    expect(report.strata[0].a).toMatchObject({ cells: 1, medians: { p50FrameMs: 16 } })
  })

  it('reports a side with no cells as empty', () => {
    const report = compareCommits(rollups(), { shaA: 'ccccccc', shaB: 'bbbbbbb', includeDirty: false })

    expect(report.resolved.a).toEqual([])
    expect(report.strata[0].a).toMatchObject({ sessions: 0, cells: 0, medians: { p50FrameMs: null } })
  })

  it('refuses a prefix that matches two commits', () => {
    const ambiguous = fixtureRollups([fixtureCell(16, { sha: `ab${'1'.repeat(38)}` }), fixtureCell(16, { sha: `ab${'2'.repeat(38)}` })])

    expect(() => compareCommits(ambiguous, { shaA: 'ab', shaB: 'bbbbbbb', includeDirty: false })).toThrow(PerfUsageError)
  })
})
