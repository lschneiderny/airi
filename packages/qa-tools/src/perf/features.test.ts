import type { LeaseEvent } from './lease'

import { describe, expect, it } from 'vitest'

import { featureReports } from './features'
import { markLeaseContention } from './lease'
import { fixtureCell, fixtureRollups } from './usage-fixture'

const JITTER = [-0.3, -0.1, 0, 0.1, 0.2, 0.3]
const around = (centre: number) => JITTER.map(offset => centre + offset)

/** Six sessions with mmdPhysics off around 16 ms, then six with it on around 20 ms. */
const shifted = () => fixtureRollups([...around(16).map(value => fixtureCell(value, { mmdPhysics: false })), ...around(20).map(value => fixtureCell(value))])

const worktreeRoot = '/work/dtuber'
const first = shifted()[0]
const LIVE_PID = 100
const DEAD_PID = 200
const history = (events: LeaseEvent[]) => ({ events, worktreeRoot, isPidAlive: (pid: number) => pid === LIVE_PID })

function lease(cwd: string, grantedAt: number, releasedAt: number | null, pid = LIVE_PID): LeaseEvent[] {
  const id = `${cwd}-${grantedAt}`
  const grant: LeaseEvent = { ts: grantedAt, event: 'grant', id, cwd, heldMs: 0, pid }
  return releasedAt === null ? [grant] : [grant, { ts: releasedAt, event: 'release', id, cwd, heldMs: releasedAt - grantedAt, pid }]
}

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

describe('markLeaseContention', () => {
  it('marks cells overlapped by another worktree lease as contended, and the comparison drops them', () => {
    const events = [...lease('/work/dtuber/packages/x', first.startedAt - 60_000, first.endedAt), ...lease('/work/dtuber-wt/other', first.startedAt + 60_000, first.startedAt + 120_000)]
    const marked = markLeaseContention(shifted(), history(events))

    expect(marked.rollups[0].cells[0].leaseContended).toBe(true)
    expect(marked.rollups[1].cells[0].leaseContended).toBe(false)
    expect(marked.cells).toEqual({ contended: 1, clear: 11, uncovered: 0 })
    const [report] = featureReports(marked.rollups, { feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })
    expect(report.droppedCells.leaseContended).toBe(1)
    expect(report.comparisons[0].a.blocks).toBe(5)
  })

  it('ignores leases of its own worktree and marks a lease whose holder still runs as contended from its grant', () => {
    const own = markLeaseContention(shifted(), history(lease('/work/dtuber', first.startedAt - 60_000, null)))
    const held = markLeaseContention(shifted(), history(lease('/work/dtuber-wt/other', first.startedAt - 60_000, null)))

    expect(own.cells).toEqual({ contended: 0, clear: 12, uncovered: 0 })
    expect(held.cells).toEqual({ contended: 12, clear: 0, uncovered: 0 })
  })

  it('ends a lease at a release that carries no held time', () => {
    const grantedAt = first.startedAt - 60_000
    const id = 'measure'
    const cwd = '/tmp/qa-measure-lease-1'
    const events: LeaseEvent[] = [
      { ts: grantedAt, event: 'grant', id, cwd, heldMs: 0, pid: DEAD_PID },
      { ts: grantedAt, event: 'release', id, cwd, heldMs: 0, pid: DEAD_PID },
    ]

    expect(markLeaseContention(shifted(), history(events)).cells).toEqual({ contended: 0, clear: 12, uncovered: 0 })
  })

  it('leaves cells from the grant of a dead holder that never released as null, keeping known contention true', () => {
    const second = shifted()[1]
    const events = [...lease('/work/dtuber-wt/other', first.startedAt + 60_000, first.startedAt + 120_000), ...lease('/work/dtuber-wt/killed', second.startedAt - 60_000, null, DEAD_PID)]
    const marked = markLeaseContention(shifted(), history(events))

    expect(marked.rollups.map(rollup => rollup.cells[0].leaseContended)).toEqual([true, ...Array.from({ length: 11 }).fill(null)])
  })

  it('leaves cells before the oldest history event, or without history, as null', () => {
    const marked = markLeaseContention(shifted(), history(lease('/work/dtuber-wt/other', first.endedAt + 60_000, first.endedAt + 120_000)))
    const empty = markLeaseContention(shifted(), history([]))

    expect(marked.rollups[0].cells[0].leaseContended).toBeNull()
    expect(marked.cells).toEqual({ contended: 0, clear: 11, uncovered: 1 })
    expect(empty.cells).toEqual({ contended: 0, clear: 0, uncovered: 12 })
  })
})
