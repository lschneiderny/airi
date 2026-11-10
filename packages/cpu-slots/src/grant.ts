import type { CpuClass } from './classes'
import type { CpuPressure, PressureThresholds } from './pressure'

import { PRESSURE_HOLD, PRESSURE_IDLE } from './pressure'

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
    | { kind: 'wait', reason: 'queue-empty' | 'over-budget' | 'exclusive-held' | 'leases-held' | 'insufficient-slots' | 'head-aging' | 'cpu-pressure' }

export const HEAD_AGING_MS = 60_000

/** The fixed safety ceiling also applies when adopting a previously committed shared lease. */
export function sharedCeiling(budget: number): number {
  return budget + Math.floor(budget / 4)
}

/** Decide one grant without changing the already-pruned state. Budget is a positive integer. */
export function decide(state: BrokerState, budget: number, now: number, pressure?: CpuPressure, thresholds: PressureThresholds = { idle: PRESSURE_IDLE, hold: PRESSURE_HOLD }): Decision {
  const tickets = [...state.tickets].sort((a, b) => a.seq - b.seq)
  const head = tickets[0]
  if (!head)
    return { kind: 'wait', reason: 'queue-empty' }

  const held = state.leases.reduce((total, lease) => total + lease.slots, 0)
  const ceiling = sharedCeiling(budget)
  const saturated = pressure !== undefined && pressure.someAvg10 >= thresholds.hold
  const capacity = pressure !== undefined && pressure.someAvg10 < thresholds.idle ? ceiling : budget
  if (held > ceiling || (!saturated && held > capacity))
    return { kind: 'wait', reason: 'over-budget' }
  if (state.leases.some(lease => lease.exclusive))
    return { kind: 'wait', reason: 'exclusive-held' }
  // External load cannot prevent the first job from making progress.
  if (saturated && held > 0)
    return { kind: 'wait', reason: 'cpu-pressure' }

  const free = (saturated ? budget : capacity) - held
  const waiting = tickets.filter(ticket => !ticket.exclusive).length
  if (head.exclusive && held === 0)
    return { kind: 'grant', ticketSeq: head.seq, slots: budget }
  if (!head.exclusive && free >= Math.min(head.min, budget))
    return { kind: 'grant', ticketSeq: head.seq, slots: Math.min(head.max, free, Math.max(head.min, Math.floor(free / waiting))) }

  // Exclusive heads wait best-effort; aging one could freeze every lane behind a long live lease.
  if (!head.exclusive && now - head.createdAt >= HEAD_AGING_MS)
    return { kind: 'wait', reason: 'head-aging' }

  const backfill = tickets.slice(1).find(ticket => !ticket.exclusive && Math.min(ticket.min, budget) <= free)
  if (backfill)
    return { kind: 'grant', ticketSeq: backfill.seq, slots: Math.min(backfill.max, free, Math.max(backfill.min, Math.floor(free / waiting))) }

  return { kind: 'wait', reason: head.exclusive ? 'leases-held' : 'insufficient-slots' }
}
