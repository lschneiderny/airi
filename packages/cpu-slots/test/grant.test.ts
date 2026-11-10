import type { BrokerState, TicketRecord } from '../src/grant'

import { describe, expect, it } from 'vitest'

import { classes, CpuSlotsError, decide, parseBudget } from '../src'

function ticket(seq: number, cpuClass: TicketRecord['class'] = 'test'): TicketRecord {
  return { seq, createdAt: 0, class: cpuClass, ...classes[cpuClass] }
}

describe('decide', () => {
  it('waits when the queue is empty', () => {
    expect(decide({ leases: [], tickets: [] }, 12, 0)).toEqual({ kind: 'wait', reason: 'queue-empty' })
  })

  it('grants only the lowest sequence even when the listing is unordered', () => {
    expect(decide({ leases: [], tickets: [ticket(3), ticket(1), ticket(2)] }, 12, 0))
      .toEqual({ kind: 'grant', ticketSeq: 1, slots: 6 })
  })

  it('does not let a smaller later request bypass an aged non-exclusive head', () => {
    expect(decide({
      leases: [{ slots: 11, exclusive: false }],
      tickets: [ticket(2, 'lint'), ticket(1)],
    }, 12, 60_000)).toEqual({ kind: 'wait', reason: 'head-aging' })
  })

  it.each([
    { held: 11, result: { kind: 'wait', reason: 'insufficient-slots' } },
    { held: 10, result: { kind: 'grant', ticketSeq: 1, slots: 2 } },
    { held: 8, result: { kind: 'grant', ticketSeq: 1, slots: 4 } },
    { held: 6, result: { kind: 'grant', ticketSeq: 1, slots: 6 } },
    { held: 0, result: { kind: 'grant', ticketSeq: 1, slots: 6 } },
  ])('respects min and max with $held slots held', ({ held, result }) => {
    expect(decide({ leases: [{ slots: held, exclusive: false }], tickets: [ticket(1)] }, 12, 0)).toEqual(result)
  })

  it('adds the slots of every lease', () => {
    expect(decide({
      leases: [{ slots: 6, exclusive: false }, { slots: 4, exclusive: false }],
      tickets: [ticket(1)],
    }, 12, 0)).toEqual({ kind: 'grant', ticketSeq: 1, slots: 2 })
  })

  it('grants live four slots beside held work, leaving room for a six-slot test', () => {
    expect(decide({
      leases: [{ slots: 8, exclusive: false }],
      tickets: [ticket(1, 'live')],
    }, 12, 0)).toEqual({ kind: 'grant', ticketSeq: 1, slots: 4 })
    expect(decide({
      leases: [{ slots: 4, exclusive: false }],
      tickets: [ticket(2)],
    }, 12, 0)).toEqual({ kind: 'grant', ticketSeq: 2, slots: 6 })
  })

  it.each([
    { held: 0, result: { kind: 'grant', ticketSeq: 1, slots: 6 } },
    { held: 9, result: { kind: 'wait', reason: 'insufficient-slots' } },
  ])('respects live bounds with $held slots held', ({ held, result }) => {
    expect(decide({
      leases: [{ slots: held, exclusive: false }],
      tickets: [ticket(1, 'live')],
    }, 12, 0)).toEqual(result)
  })

  it('keeps exclusive waiting while a live lease holds slots', () => {
    expect(decide({
      leases: [{ slots: 4, exclusive: classes.live.exclusive }],
      tickets: [ticket(1, 'exclusive')],
    }, 12, 0)).toEqual({ kind: 'wait', reason: 'leases-held' })
  })

  it('keeps live waiting while an exclusive lease is held', () => {
    expect(decide({
      leases: [{ slots: 12, exclusive: true }],
      tickets: [ticket(1, 'live')],
    }, 12, 0)).toEqual({ kind: 'wait', reason: 'exclusive-held' })
  })

  it('clamps install 4-4 to a budget of 2', () => {
    expect(decide({ leases: [], tickets: [ticket(1, 'install')] }, 2, 0))
      .toEqual({ kind: 'grant', ticketSeq: 1, slots: 2 })
  })

  it('does not grant a clamped request until its clamped minimum is free', () => {
    expect(decide({ leases: [{ slots: 1, exclusive: false }], tickets: [ticket(1, 'install')] }, 2, 0))
      .toEqual({ kind: 'wait', reason: 'insufficient-slots' })
  })

  it('uses request overrides rather than the class defaults', () => {
    expect(decide({ leases: [], tickets: [{ ...ticket(1), min: 1, max: 3 }] }, 12, 0))
      .toEqual({ kind: 'grant', ticketSeq: 1, slots: 3 })
  })

  it.each([1, 2, 12, 20])('grants exclusive the entire budget of %i when nothing is held', (budget) => {
    expect(decide({ leases: [], tickets: [ticket(1, 'exclusive')] }, budget, 0))
      .toEqual({ kind: 'grant', ticketSeq: 1, slots: budget })
  })

  it('waits for every held slot before granting exclusive while allowing shared backfill', () => {
    expect(decide({
      leases: [{ slots: 1, exclusive: false }],
      tickets: [ticket(2, 'lint'), ticket(1, 'exclusive')],
    }, 12, 0)).toEqual({ kind: 'grant', ticketSeq: 2, slots: 1 })
  })

  it('blocks shared requests while an exclusive lease is held even if capacity appears free', () => {
    expect(decide({ leases: [{ slots: 2, exclusive: true }], tickets: [ticket(1)] }, 12, 0))
      .toEqual({ kind: 'wait', reason: 'exclusive-held' })
  })

  it('blocks another exclusive request while an exclusive lease is held', () => {
    expect(decide({ leases: [{ slots: 12, exclusive: true }], tickets: [ticket(1, 'exclusive')] }, 12, 0))
      .toEqual({ kind: 'wait', reason: 'exclusive-held' })
  })

  it.each(['test', 'exclusive'] as const)('does not grant %s while over budget', (cpuClass) => {
    expect(decide({ leases: [{ slots: 13, exclusive: false }], tickets: [ticket(1, cpuClass)] }, 12, 0))
      .toEqual({ kind: 'wait', reason: 'over-budget' })
  })

  it('waits at exactly full capacity', () => {
    expect(decide({ leases: [{ slots: 12, exclusive: false }], tickets: [ticket(1)] }, 12, 0))
      .toEqual({ kind: 'wait', reason: 'insufficient-slots' })
  })

  it('does not mutate its input and repeats the same decision', () => {
    const state: BrokerState = { leases: [], tickets: [ticket(2), ticket(1, 'install')] }
    state.tickets.forEach(Object.freeze)
    Object.freeze(state.leases)
    Object.freeze(state.tickets)
    Object.freeze(state)
    const first = decide(state, 2, 0)
    expect(first).toEqual({ kind: 'grant', ticketSeq: 1, slots: 2 })
    expect(decide(state, 2, 0)).toEqual(first)
    expect(state.tickets.map(request => request.seq)).toEqual([2, 1])
  })
})

describe('parseBudget', () => {
  it.each(['1', '2', '12', '24', '9007199254740991'])('accepts the positive integer %s', (value) => {
    expect(parseBudget(value)).toBe(Number(value))
  })

  it.each(['', '0', '-1', '1.5', 'abc', ' ', 'NaN', 'Infinity', '1e2', '0x10', '2slots', '9007199254740992'])(
    'rejects malformed budget %j with the named error',
    (value) => {
      expect(() => parseBudget(value)).toThrow(CpuSlotsError)
      expect(() => parseBudget(value)).toThrow(expect.objectContaining({ code: 'bad-budget' }))
    },
  )
})
