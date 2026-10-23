import type { StoredLease, Ticket } from './store'

import { existsSync } from 'node:fs'

import { storeRoot, whileBusy } from './acquire'
import { parseBudget } from './budget'
import { Store, StoreBusyError } from './store'

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

/** Longest `pnpm slots status` keeps retrying a busy store. */
export const STATUS_WAIT_CAP_MS = 30_000

export interface StatusWaitOptions {
  root?: string
  capMs?: number
  now?: () => number
  wait?: (ms: number) => Promise<void>
  read?: (options: { root?: string }) => Status
}

/**
 * Reads the status, retrying a busy store every 500 ms until `capMs` has passed. The last
 * StoreBusyError is thrown after that, and its message names the busy reason.
 */
export async function readStatusWithin(options: StatusWaitOptions = {}): Promise<Status> {
  const {
    capMs = STATUS_WAIT_CAP_MS,
    now = Date.now,
    wait = ms => new Promise<void>(resolve => setTimeout(resolve, ms)),
    read = readStatus,
  } = options
  const deadline = now() + capMs
  for (;;) {
    try {
      return read({ root: options.root })
    }
    catch (error) {
      if (!(error instanceof StoreBusyError) || now() >= deadline)
        throw error
      await wait(500)
    }
  }
}

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
  // snapshot() runs on its own, not inside one transaction with the malformed list, so it takes the process
  // capture it needs after its lock, prunes with it, and reports a failed capture as busy.
  const { state, malformed } = whileBusy(
    () => ({ state: store.snapshot(), malformed: store.malformedTickets() }),
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
