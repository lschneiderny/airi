import type { CpuClass } from './classes'

/** Slot accounting fields of an already-pruned lease. */
export interface LeaseRecord {
  slots: number
  exclusive: boolean
}

/** Scheduling fields of an already-pruned ticket; seq determines FIFO order. */
export interface TicketRecord {
  seq: number
  createdAt: number
  class: CpuClass
  min: number
  max: number
  exclusive: boolean
}

export interface BrokerState {
  leases: LeaseRecord[]
  tickets: TicketRecord[]
}

export type Decision
  = | { kind: 'grant', ticketSeq: number, slots: number }
    | { kind: 'wait', reason: 'queue-empty' | 'over-budget' | 'exclusive-held' | 'leases-held' | 'insufficient-slots' | 'head-aging' }

export const HEAD_AGING_MS = 60_000

/** Decide one grant without changing the already-pruned state. Budget is a positive integer. */
export function decide(state: BrokerState, budget: number, now: number): Decision {
  const tickets = [...state.tickets].sort((a, b) => a.seq - b.seq)
  const head = tickets[0]
  if (!head)
    return { kind: 'wait', reason: 'queue-empty' }

  const held = state.leases.reduce((total, lease) => total + lease.slots, 0)
  if (held > budget)
    return { kind: 'wait', reason: 'over-budget' }
  if (state.leases.some(lease => lease.exclusive))
    return { kind: 'wait', reason: 'exclusive-held' }

  const free = budget - held
  if (head.exclusive && held === 0)
    return { kind: 'grant', ticketSeq: head.seq, slots: budget }
  if (!head.exclusive && free >= Math.min(head.min, budget))
    return { kind: 'grant', ticketSeq: head.seq, slots: Math.min(head.max, free) }

  // Exclusive heads wait best-effort; aging one could freeze every lane behind a long live lease.
  if (!head.exclusive && now - head.createdAt >= HEAD_AGING_MS)
    return { kind: 'wait', reason: 'head-aging' }

  const backfill = tickets.slice(1).find(ticket => !ticket.exclusive && Math.min(ticket.min, budget) <= free)
  if (backfill)
    return { kind: 'grant', ticketSeq: backfill.seq, slots: Math.min(backfill.max, free) }

  return { kind: 'wait', reason: head.exclusive ? 'leases-held' : 'insufficient-slots' }
}
