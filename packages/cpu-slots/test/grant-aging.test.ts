import type { TicketRecord } from '../src/grant'

import { describe, expect, it } from 'vitest'

import { classes } from '../src/classes'
import { decide } from '../src/grant'

function ticket(seq: number, cpuClass: TicketRecord['class'] = 'test'): TicketRecord {
  return { seq, class: cpuClass, createdAt: 1_000, ...classes[cpuClass] }
}

describe('head aging and backfill', () => {
  it.each([60_999, 61_000, 61_001])('grants a fitting head before later tickets at time %i', (now) => {
    expect(decide({
      leases: [{ slots: 8, exclusive: false }],
      tickets: [ticket(2, 'lint'), ticket(1)],
    }, 12, now)).toEqual({ kind: 'grant', ticketSeq: 1, slots: 2 })
  })

  it('backfills the first fitting shared ticket by sequence without mutating the queue', () => {
    const tickets = [ticket(5, 'lint'), ticket(3, 'exclusive'), ticket(1), ticket(4, 'lint'), ticket(2, 'live')]
    tickets.forEach(Object.freeze)
    Object.freeze(tickets)
    expect(decide({
      leases: [{ slots: 11, exclusive: false }],
      tickets,
    }, 12, 60_999)).toEqual({ kind: 'grant', ticketSeq: 4, slots: 1 })
    expect(tickets.map(entry => entry.seq)).toEqual([5, 3, 1, 4, 2])
  })

  it.each([61_000, 61_001])('stops backfill at and after the aging boundary, time %i', (now) => {
    expect(decide({
      leases: [{ slots: 11, exclusive: false }],
      tickets: [ticket(2, 'lint'), ticket(1)],
    }, 12, now)).toEqual({ kind: 'wait', reason: 'head-aging' })
  })

  it.each([60_999, 61_000, 120_000])('never ages an exclusive head, time %i', (now) => {
    expect(decide({
      leases: [{ slots: 6, exclusive: false }],
      tickets: [ticket(3, 'test'), ticket(1, 'exclusive'), ticket(2, 'exclusive')],
    }, 12, now)).toEqual({ kind: 'grant', ticketSeq: 3, slots: 6 })
  })

  it('never grants a later exclusive ticket even when its minimum appears to fit', () => {
    expect(decide({
      leases: [],
      tickets: [{ ...ticket(1), min: 4, max: 6 }, { ...ticket(2, 'exclusive'), min: 1, max: 1 }],
    }, 2, 1_000)).toEqual({ kind: 'grant', ticketSeq: 1, slots: 2 })
    expect(decide({
      leases: [{ slots: 11, exclusive: false }],
      tickets: [ticket(1), { ...ticket(2, 'exclusive'), min: 1, max: 1 }],
    }, 12, 1_000)).toEqual({ kind: 'wait', reason: 'insufficient-slots' })
  })

  it.each([
    { leases: [{ slots: 13, exclusive: false }], reason: 'over-budget' },
    { leases: [{ slots: 2, exclusive: true }], reason: 'exclusive-held' },
    { leases: [{ slots: 13, exclusive: true }], reason: 'over-budget' },
  ])('keeps $reason ahead of aging and backfill', ({ leases, reason }) => {
    expect(decide({ leases, tickets: [ticket(1), ticket(2, 'lint')] }, 12, 61_000))
      .toEqual({ kind: 'wait', reason })
  })
})
