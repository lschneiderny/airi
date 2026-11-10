import type { BrokerState, TicketRecord } from '../src/grant'

import { describe, expect, it } from 'vitest'

import { classes } from '../src/classes'
import { decide } from '../src/grant'

function ticket(seq: number, cpuClass: TicketRecord['class'] = 'test'): TicketRecord {
  return { seq, createdAt: 0, class: cpuClass, ...classes[cpuClass] }
}

describe('pressure admission', () => {
  it.each([70, 90, 100])('holds fitting work when pressure is %s and slots are held', (someAvg10) => {
    expect(decide({
      leases: [{ slots: 6, exclusive: false }],
      tickets: [ticket(1, 'lint')],
    }, 12, 0, { someAvg10 })).toEqual({ kind: 'wait', reason: 'cpu-pressure' })
  })

  it.each(['test', 'exclusive'] as const)('admits %s under external pressure with no slots held', (cpuClass) => {
    expect(decide({ leases: [], tickets: [ticket(1, cpuClass)] }, 12, 0, { someAvg10: 90 }))
      .toEqual({ kind: 'grant', ticketSeq: 1, slots: cpuClass === 'test' ? 6 : 12 })
  })

  it.each([
    { someAvg10: 19.99, held: 12, reason: null },
    { someAvg10: 5, held: 14, reason: null },
    { someAvg10: 5, held: 15, reason: 'insufficient-slots' },
    { someAvg10: 5, held: 16, reason: 'over-budget' },
    { someAvg10: 20, held: 12, reason: 'insufficient-slots' },
    { someAvg10: 50, held: 13, reason: 'over-budget' },
    { someAvg10: 69.99, held: 6, reason: null },
  ])('bounds capacity at pressure $someAvg10 with $held slots held', ({ someAvg10, held, reason }) => {
    expect(decide({
      leases: [{ slots: held, exclusive: false }],
      tickets: [ticket(1, 'lint')],
    }, 12, 0, { someAvg10 })).toEqual(reason
      ? { kind: 'wait', reason }
      : { kind: 'grant', ticketSeq: 1, slots: 1 })
  })

  it.each([
    { pressure: { someAvg10: 5 }, share: 5 },
    { pressure: { someAvg10: 50 }, share: 4 },
    { pressure: undefined, share: 4 },
  ])('shares the effective capacity with share $share', ({ pressure, share }) => {
    const state: BrokerState = { leases: [], tickets: [ticket(1), ticket(2), ticket(3)] }
    for (const ticketSeq of [1, 2, 3]) {
      const decision = decide(state, 12, 0, pressure)
      expect(decision).toEqual({ kind: 'grant', ticketSeq, slots: share })
      if (decision.kind !== 'grant')
        throw new Error('Expected a grant')
      state.leases.push({ slots: decision.slots, exclusive: false })
      state.tickets = state.tickets.filter(ticket => ticket.seq !== ticketSeq)
    }
  })

  it('does not overcommit exclusive grants or let shared work bypass a held exclusive lease', () => {
    expect(decide({ leases: [], tickets: [ticket(1, 'exclusive')] }, 12, 0, { someAvg10: 5 }))
      .toEqual({ kind: 'grant', ticketSeq: 1, slots: 12 })
    expect(decide({
      leases: [{ slots: 12, exclusive: true }],
      tickets: [ticket(1, 'lint')],
    }, 12, 0, { someAvg10: 5 })).toEqual({ kind: 'wait', reason: 'exclusive-held' })
  })

  it('keeps head aging and exclusive ordering when idle capacity is exhausted', () => {
    expect(decide({
      leases: [{ slots: 14, exclusive: false }],
      tickets: [ticket(1), ticket(2, 'lint')],
    }, 12, 60_000, { someAvg10: 5 })).toEqual({ kind: 'wait', reason: 'head-aging' })
    expect(decide({
      leases: [{ slots: 14, exclusive: false }],
      tickets: [ticket(1, 'exclusive'), ticket(2, 'exclusive'), ticket(3, 'lint')],
    }, 12, 60_000, { someAvg10: 5 })).toEqual({ kind: 'grant', ticketSeq: 3, slots: 1 })
  })

  it('uses supplied thresholds without consulting the environment', () => {
    const state: BrokerState = { leases: [{ slots: 12, exclusive: false }], tickets: [ticket(1, 'lint')] }
    expect(decide(state, 12, 0, { someAvg10: 30 }, { idle: 40, hold: 80 }))
      .toEqual({ kind: 'grant', ticketSeq: 1, slots: 1 })
    expect(decide(state, 12, 0, { someAvg10: 30 }, { idle: 20, hold: 25 }))
      .toEqual({ kind: 'wait', reason: 'cpu-pressure' })
  })
})
