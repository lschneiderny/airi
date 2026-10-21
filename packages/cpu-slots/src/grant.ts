import type { CpuClass } from './classes'

/** Slot accounting fields of an already-pruned lease. */
export interface LeaseRecord {
  slots: number
  exclusive: boolean
}

/** Scheduling fields of an already-pruned ticket; seq determines FIFO order. */
export interface TicketRecord {
  seq: number
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
    | { kind: 'wait', reason: 'queue-empty' | 'over-budget' | 'exclusive-held' | 'leases-held' | 'insufficient-slots' }

/** Decide one grant without changing the already-pruned state. Budget is a positive integer. */
export function decide(state: BrokerState, budget: number): Decision {
  const head = state.tickets.reduce<TicketRecord | undefined>(
    (first, ticket) => !first || ticket.seq < first.seq ? ticket : first,
    undefined,
  )
  if (!head)
    return { kind: 'wait', reason: 'queue-empty' }

  const held = state.leases.reduce((total, lease) => total + lease.slots, 0)
  if (held > budget)
    return { kind: 'wait', reason: 'over-budget' }
  if (state.leases.some(lease => lease.exclusive))
    return { kind: 'wait', reason: 'exclusive-held' }

  if (head.exclusive) {
    return held === 0
      ? { kind: 'grant', ticketSeq: head.seq, slots: budget }
      : { kind: 'wait', reason: 'leases-held' }
  }

  const min = Math.min(head.min, budget)
  const max = Math.min(head.max, budget)
  const free = budget - held
  return free >= min
    ? { kind: 'grant', ticketSeq: head.seq, slots: Math.min(max, free) }
    : { kind: 'wait', reason: 'insufficient-slots' }
}
