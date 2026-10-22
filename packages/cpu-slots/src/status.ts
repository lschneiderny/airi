import type { StoredLease, Ticket } from './store'

import { existsSync } from 'node:fs'

import { storeRoot } from './acquire'
import { parseBudget } from './budget'
import { Store } from './store'

export interface Status {
  storePath: string
  budget: number
  held: number
  leases: (StoredLease & { age: number })[]
  queue: (Ticket & { wait: number })[]
}

/**
 * Reads a pruned snapshot of the store without acquiring anything. A missing store reads as empty and
 * is not created. Throws StoreBusyError when another process holds the broker lock; callers retry.
 */
export function readStatus(options: { root?: string } = {}): Status {
  const storePath = options.root ?? storeRoot()
  const budget = parseBudget()
  if (!existsSync(storePath))
    return { storePath, budget, held: 0, leases: [], queue: [] }
  const state = new Store({ root: storePath, budget }).snapshot()
  const now = Date.now()
  return {
    storePath,
    budget,
    held: state.leases.reduce((sum, lease) => sum + lease.slots, 0),
    leases: state.leases.map(lease => ({ ...lease, age: now - lease.createdAt })),
    queue: state.tickets.map(ticket => ({ ...ticket, wait: now - ticket.createdAt })),
  }
}
