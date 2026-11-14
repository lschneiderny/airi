import type { LeaseEvent } from './lease'

import { describe, expect, it } from 'vitest'

import { featureReports } from './features'
import { markLeaseContention } from './lease'
import { fixtureCell, fixtureRollups, fixtureSessionStart, fixtureUsageRollups } from './usage-fixture'

const JITTER = [-0.3, -0.1, 0, 0.1, 0.2, 0.3]
const around = (centre: number) => JITTER.map(offset => centre + offset)

/** Six sessions with mmdPhysics off around 16 ms, then six with it on around 20 ms, 30 windows each. */
const shiftedCells = () => [...around(16).map(value => fixtureCell(value, { mmdPhysics: false })), ...around(20).map(value => fixtureCell(value))]
const shifted = () => fixtureRollups(shiftedCells())
/** The same sessions as read from `sessions.jsonl`: two 5-minute buckets of 15 windows each, 24 buckets in all. */
const usage = () => fixtureUsageRollups(shiftedCells())

const worktreeRoot = '/work/dtuber'
const start0 = fixtureSessionStart(0)
const BUCKET_MS = 300_000
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
  it('drops only the buckets another worktree lease overlaps and keeps the cell\'s totals over the rest', () => {
    const marked = markLeaseContention(usage(), history(lease('/work/dtuber-wt/other', start0 - 60_000, start0 + BUCKET_MS)))

    expect(marked.rollups[0].cells[0]).toMatchObject({ leaseContended: false, windows: 15, frames: 4500 })
    expect(marked.rollups[1].cells[0]).toMatchObject({ leaseContended: false, windows: 30 })
    expect(marked.buckets).toEqual({ contended: 1, clear: 23, uncovered: 0 })
    expect(marked.keptWindowShare).toBeCloseTo(345 / 360)
  })

  it('marks a cell whose every bucket is overlapped as contended, and the comparison drops it', () => {
    const events = [...lease('/work/dtuber/packages/x', start0 - 60_000, start0 + 2 * BUCKET_MS), ...lease('/work/dtuber-wt/other', start0 + 60_000, start0 + 2 * BUCKET_MS)]
    const marked = markLeaseContention(usage(), history(events))

    expect(marked.rollups[0].cells[0]).toMatchObject({ leaseContended: true, windows: 30 })
    expect(marked.buckets).toEqual({ contended: 2, clear: 22, uncovered: 0 })
    const [report] = featureReports(marked.rollups, { feature: 'mmdPhysics', metric: 'p50FrameMs', seed: 1 })
    expect(report.droppedCells.leaseContended).toBe(1)
    expect(report.comparisons[0].a.blocks).toBe(5)
  })

  it('ignores leases of its own worktree and marks a lease whose holder still runs as contended from its grant', () => {
    const own = markLeaseContention(usage(), history(lease('/work/dtuber', start0 - 60_000, null)))
    const held = markLeaseContention(usage(), history(lease('/work/dtuber-wt/other', start0 - 60_000, null)))

    expect(own.buckets).toEqual({ contended: 0, clear: 24, uncovered: 0 })
    expect(held.buckets).toEqual({ contended: 24, clear: 0, uncovered: 0 })
    expect(held.keptWindowShare).toBe(0)
  })

  it('ends a dead holder\'s lease at its reap event, so later buckets read clear instead of uncovered', () => {
    const grant = lease('/work/dtuber-wt/killed', start0 - 60_000, null, DEAD_PID)
    const reap: LeaseEvent = { ts: start0 + 120_000, event: 'reap', id: grant[0].id, cwd: grant[0].cwd, heldMs: 180_000, pid: DEAD_PID }

    expect(markLeaseContention(usage(), history([...grant, reap])).buckets).toEqual({ contended: 1, clear: 23, uncovered: 0 })
    expect(markLeaseContention(usage(), history(grant)).buckets).toEqual({ contended: 0, clear: 0, uncovered: 24 })
  })

  it('ends a lease at a release that carries no held time', () => {
    const grantedAt = start0 - 60_000
    const id = 'measure'
    const cwd = '/tmp/qa-measure-lease-1'
    const events: LeaseEvent[] = [
      { ts: grantedAt, event: 'grant', id, cwd, heldMs: 0, pid: DEAD_PID },
      { ts: grantedAt, event: 'release', id, cwd, heldMs: 0, pid: DEAD_PID },
    ]

    expect(markLeaseContention(usage(), history(events)).buckets).toEqual({ contended: 0, clear: 24, uncovered: 0 })
  })

  it('leaves buckets from the grant of a dead holder that was never reaped as null, keeping known contention true', () => {
    const events = [...lease('/work/dtuber-wt/other', start0 + 60_000, start0 + 120_000), ...lease('/work/dtuber-wt/killed', fixtureSessionStart(1) - 60_000, null, DEAD_PID)]
    const marked = markLeaseContention(usage(), history(events))

    expect(marked.rollups.map(rollup => rollup.cells[0].leaseContended)).toEqual([false, ...Array.from({ length: 11 }).fill(null)])
    expect(marked.buckets).toEqual({ contended: 1, clear: 1, uncovered: 22 })
  })

  it('leaves buckets before the oldest history event, or without history, as null', () => {
    const sessionEnd = start0 + 2 * BUCKET_MS
    const marked = markLeaseContention(usage(), history(lease('/work/dtuber-wt/other', sessionEnd + 60_000, sessionEnd + 120_000)))
    const empty = markLeaseContention(usage(), history([]))

    expect(marked.rollups[0].cells[0].leaseContended).toBeNull()
    expect(marked.buckets).toEqual({ contended: 0, clear: 22, uncovered: 2 })
    expect(empty.buckets).toEqual({ contended: 0, clear: 0, uncovered: 24 })
  })
})
