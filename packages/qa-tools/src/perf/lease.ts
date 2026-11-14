import type { HistoryEvent } from '@proj-airi/cpu-slots'
import type { FeatureCompareCell, FeatureCompareRollup, SegmentBucket } from '@proj-airi/stage-shared/perf/usage'

import type { UsageRollup } from './features'

import { isAbsolute, relative } from 'node:path'

import { bucketTotals } from '@proj-airi/stage-shared/perf/usage'

export type LeaseEvent = Pick<HistoryEvent, 'ts' | 'event' | 'id' | 'cwd' | 'heldMs' | 'pid'>

export interface LeaseHistory {
  readonly events: readonly LeaseEvent[]
  /** The worktree whose own leases do not count, such as the `live` lease of a QA app session it runs. */
  readonly worktreeRoot: string
  /** Whether the holder of a grant that never ended is still running, so its lease is still held. */
  readonly isPidAlive: (pid: number) => boolean
}

export interface LeaseContention {
  /** Each cell's totals over its kept buckets, or over all of them with `leaseContended: true` when none was kept. */
  readonly rollups: FeatureCompareRollup[]
  readonly buckets: { readonly contended: number, readonly clear: number, readonly uncovered: number }
  /** Windows of the kept (clear or uncovered) buckets over all windows; `null` without windows. */
  readonly keptWindowShare: number | null
}

interface Interval {
  readonly start: number
  readonly end: number
}

/** Foreign leases with a known span, and the starts of those whose end the history cannot tell. */
interface ForeignLeases {
  readonly known: Interval[]
  readonly unknownEndFrom: number[]
}

function isInside(root: string, path: string): boolean {
  const fromRoot = relative(root, path)
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))
}

/**
 * Lease spans of other worktrees. Every release, abort, or reap ends its lease, whatever `heldMs` it carries: it
 * starts at its grant, or `heldMs` before the end when the grant rotated out of the history. A grant that never
 * ended is held from its grant while its pid runs; once that pid is gone and no reap was logged, its end is unknown.
 */
function foreignLeases(history: LeaseHistory): ForeignLeases {
  const granted = new Map<string, LeaseEvent>()
  const known: Interval[] = []
  for (const event of history.events) {
    if (isInside(history.worktreeRoot, event.cwd))
      continue
    switch (event.event) {
      case 'grant':
        granted.set(event.id, event)
        break
      case 'release':
      case 'abort':
      case 'reap': {
        const start = granted.get(event.id)?.ts ?? event.ts - event.heldMs
        granted.delete(event.id)
        // A lease released in the millisecond it was granted held no CPU over any span.
        if (event.ts > start)
          known.push({ start, end: event.ts })
        break
      }
      default:
        break
    }
  }
  const unknownEndFrom: number[] = []
  for (const grant of granted.values()) {
    if (history.isPidAlive(grant.pid))
      known.push({ start: grant.ts, end: Number.POSITIVE_INFINITY })
    else
      unknownEndFrom.push(grant.ts)
  }
  return { known, unknownEndFrom }
}

/**
 * Marks every 5-minute bucket of every cell from the cpu-slots lease history: `true` when a known lease of another
 * worktree overlaps the bucket's span; otherwise `null` when the bucket starts before the oldest history event (the
 * history rotates at 5 MB) or a dead holder's lease of unknown end may cover it; otherwise `false`. Contended buckets
 * are dropped, and each cell becomes its totals over the kept ones, `leaseContended` `null` when any kept bucket is
 * uncovered and `false` otherwise. A cell with no kept bucket keeps its totals over all of them, marked `true`, so
 * the comparisons count it as dropped.
 */
export function markLeaseContention(rollups: readonly UsageRollup[], history: LeaseHistory): LeaseContention {
  const coveredFrom = history.events.reduce((oldest, event) => Math.min(oldest, event.ts), Number.POSITIVE_INFINITY)
  const leases = foreignLeases(history)
  const buckets = { contended: 0, clear: 0, uncovered: 0 }
  let windows = 0
  let keptWindows = 0
  const contention = (bucket: SegmentBucket): boolean | null => {
    if (leases.known.some(lease => lease.start < bucket.endMs && lease.end > bucket.startMs))
      return true
    return bucket.startMs < coveredFrom || leases.unknownEndFrom.some(start => start < bucket.endMs) ? null : false
  }
  const marked = rollups.map(rollup => ({
    sessionId: rollup.sessionId,
    host: rollup.host,
    cells: rollup.cells.map((cell): FeatureCompareCell => {
      const { buckets: cellBuckets, ...key } = cell
      const kept: SegmentBucket[] = []
      let uncovered = false
      for (const bucket of cellBuckets) {
        const leaseContended = contention(bucket)
        buckets[leaseContended === null ? 'uncovered' : leaseContended ? 'contended' : 'clear'] += 1
        windows += bucket.windows
        if (leaseContended === true)
          continue
        uncovered ||= leaseContended === null
        keptWindows += bucket.windows
        kept.push(bucket)
      }
      const [first, ...rest] = kept
      return first === undefined
        ? { ...key, ...bucketTotals(cellBuckets), leaseContended: true }
        : { ...key, ...bucketTotals([first, ...rest]), leaseContended: uncovered ? null : false }
    }),
  }))
  return { rollups: marked, buckets, keptWindowShare: windows === 0 ? null : keptWindows / windows }
}
