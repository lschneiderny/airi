import { describe, expect, it } from 'vitest'

import { featureReports, totalRollups } from './features'
import { fixtureCell, fixtureRollups, fixtureUsageRollups } from './usage-fixture'

const JITTER = [-0.3, -0.1, 0, 0.1, 0.2, 0.3]
const around = (centre: number) => JITTER.map(offset => centre + offset)

/** Six sessions with mmdPhysics off around 16 ms, then six with it on around 20 ms, 30 windows each. */
const shiftedCells = () => [...around(16).map(value => fixtureCell(value, { mmdPhysics: false })), ...around(20).map(value => fixtureCell(value))]
const shifted = () => fixtureRollups(shiftedCells())
/** The same sessions as read from `sessions.jsonl`: two 5-minute buckets of 15 windows each, 24 buckets in all. */
const usage = () => fixtureUsageRollups(shiftedCells())

describe('featureReports', () => {
  it('reports a 4 ms shift on mmdPhysics as an observational difference', () => {
    const [report] = featureReports(shifted(), { feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })

    expect(report.label).toBe('observational')
    expect(report.comparisons).toHaveLength(1)
    expect(report.comparisons[0]).toMatchObject({ verdict: 'difference', a: { value: false, sessions: 6 }, b: { value: true, sessions: 6 } })
    expect(report.comparisons[0].unpaired?.difference).toBeCloseTo(4)
  })

  it('reports too few sessions as insufficient with the side counts', () => {
    const rollups = fixtureRollups([16, 16.1].map(value => fixtureCell(value, { mmdPhysics: false })).concat([20, 20.1].map(value => fixtureCell(value))))
    const [report] = featureReports(rollups, { feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })

    expect(report.comparisons[0]).toMatchObject({ verdict: 'insufficient', a: { blocks: 2, sessions: 2, windows: 60 }, b: { blocks: 2, sessions: 2, windows: 60 } })
  })

  it('counts the values of a feature no stratum compares', () => {
    const rollups = fixtureRollups([fixtureCell(16, { windows: 8 })])
    const [report] = featureReports(rollups, { feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })

    expect(report.comparisons).toEqual([])
    expect(report.values).toEqual([{ value: true, cells: 1, sessions: 1, windows: 8 }])
  })

  it('runs every feature when none is named', () => {
    expect(featureReports(shifted(), { feature: null, metric: 'p50FrameMs', seed: 1 }).map(report => report.feature)).toEqual(['speechMuted', 'mmdPhysics', 'naturalMotion', 'mmdRoam', 'wakeWord', 'hearing'])
  })
})

describe('totalRollups', () => {
  it('totals each cell over all of its buckets, so the comparison sees the whole session', () => {
    const totalled = totalRollups(usage())

    expect(totalled[0].cells[0]).toMatchObject({ windows: 30, frames: 9000, quartiles: { p50FrameMs: { median: 15.7 } } })
    expect(totalled[0].cells[0]).not.toHaveProperty('buckets')
    const [report] = featureReports(totalled, { feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })
    expect(report.comparisons[0]).toMatchObject({ verdict: 'difference', a: { sessions: 6 }, b: { sessions: 6 } })
  })
})
