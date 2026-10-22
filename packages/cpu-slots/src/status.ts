import type { StoredLease, Ticket } from './store'

import { existsSync } from 'node:fs'

import { storeRoot, whileBusy } from './acquire'
import { parseBudget } from './budget'
import { Store } from './store'

/** A live ticket file the queue cannot read; it is never granted, so status shows it instead of hiding it. */
export interface MalformedQueueEntry {
  malformed: true
  file: string
  pid?: number
  /** Milliseconds since the file was last written or touched. */
  touched: number
}

export interface Status {
  storePath: string
  budget: number
  held: number
  leases: (StoredLease & { age: number })[]
  queue: ((Ticket & { wait: number }) | MalformedQueueEntry)[]
}

/** Longest readStatus retries a busy broker lock before it throws. */
const STATUS_BUSY_BUDGET_MS = 2_000

/**
 * Reads a pruned snapshot of the store without acquiring anything. A missing store reads as empty and
 * is not created. A busy broker lock is retried for up to 2 s, then StoreBusyError is thrown.
 */
export function readStatus(options: { root?: string } = {}): Status {
  const storePath = options.root ?? storeRoot()
  const budget = parseBudget()
  if (!existsSync(storePath))
    return { storePath, budget, held: 0, leases: [], queue: [] }
  const store = new Store({ root: storePath, budget })
  const { state, malformed } = whileBusy(
    () => store.transact(() => ({ state: store.snapshot(), malformed: store.malformedTickets() })),
    Date.now() + STATUS_BUSY_BUDGET_MS,
  )
  const now = Date.now()
  return {
    storePath,
    budget,
    held: state.leases.reduce((sum, lease) => sum + lease.slots, 0),
    leases: state.leases.map(lease => ({ ...lease, age: now - lease.createdAt })),
    queue: [
      ...state.tickets.map(ticket => ({ ...ticket, wait: now - ticket.createdAt })),
      ...malformed.map(({ file, pid, mtimeMs }): MalformedQueueEntry => ({
        malformed: true,
        file,
        ...(pid === undefined ? {} : { pid }),
        touched: Math.round(now - mtimeMs),
      })),
    ],
  }
}
