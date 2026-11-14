import type { HistoryEvent } from '@proj-airi/cpu-slots'

import type { UsageRollup } from './features'

import { isAbsolute, relative } from 'node:path'

export type LeaseEvent = Pick<HistoryEvent, 'ts' | 'event' | 'id' | 'cwd' | 'heldMs' | 'pid'>

export interface LeaseHistory {
  readonly events: readonly LeaseEvent[]
  /** The worktree whose own leases do not count, such as the `live` lease of a QA app session it runs. */
  readonly worktreeRoot: string
  /** Whether the holder of a grant that never ended is still running, so its lease is still held. */
  readonly isPidAlive: (pid: number) => boolean
}

export interface LeaseContention {
  readonly rollups: UsageRollup[]
  readonly cells: { readonly contended: number, readonly clear: number, readonly uncovered: number }
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
 * Lease spans of other worktrees. Every release or abort ends its lease, whatever `heldMs` it carries: it starts
 * at its grant, or `heldMs` before the end when the grant rotated out of the history. A grant that never ended is
 * held from its grant while its pid runs; once that pid is gone its end is unknown.
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
      case 'abort': {
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
 * Sets each cell's `leaseContended` from the cpu-slots lease history: `true` when a known lease of another
 * worktree overlaps the cell's segment; otherwise `null` when the segment starts before the oldest history event
 * (the history rotates at 5 MB) or a dead holder's lease of unknown end may cover it; otherwise `false`. Cells
 * carry no time of their own, so the whole segment span stands for every cell in it.
 */
export function markLeaseContention(rollups: readonly UsageRollup[], history: LeaseHistory): LeaseContention {
  const coveredFrom = history.events.reduce((oldest, event) => Math.min(oldest, event.ts), Number.POSITIVE_INFINITY)
  const leases = foreignLeases(history)
  const cells = { contended: 0, clear: 0, uncovered: 0 }
  const marked = rollups.map((rollup) => {
    const overlapsKnown = leases.known.some(lease => lease.start < rollup.endedAt && lease.end > rollup.startedAt)
    const unknown = rollup.startedAt < coveredFrom || leases.unknownEndFrom.some(start => start < rollup.endedAt)
    const leaseContended = overlapsKnown ? true : unknown ? null : false
    const key = leaseContended === null ? 'uncovered' : leaseContended ? 'contended' : 'clear'
    cells[key] += rollup.cells.length
    return { ...rollup, cells: rollup.cells.map(cell => ({ ...cell, leaseContended })) }
  })
  return { rollups: marked, cells }
}
