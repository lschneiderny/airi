import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it } from 'vitest'

import { decide } from '../src/grant'
import { Store } from '../src/store'

let root: string
let clock: number
let store: Store
const request = { class: 'test', cwd: '/worktree', command: 'job' } as const

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'airi-cpu-grant-'))
  clock = Date.now()
  store = new Store({ root, budget: 12, now: () => clock })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

it('rejects a stale backfill decision at the aging boundary, then grants after the head drains', () => {
  const holder = store.enqueue({ ...request, min: 11, max: 11 })
  expect(store.grant(holder.seq, 11, holder.id)).toBeDefined()
  const head = store.enqueue(request)
  const later = store.enqueue({ ...request, class: 'lint' })
  clock += 59_999
  store.touchTicket(head.seq, head.id)
  store.touchTicket(later.seq, later.id)
  expect(decide(store.snapshot(), 12, clock)).toEqual({ kind: 'grant', ticketSeq: later.seq, slots: 1 })

  clock++
  expect(store.grant(later.seq, 1, later.id)).toBeUndefined()
  expect(store.snapshot().tickets.map(ticket => ticket.id)).toEqual([head.id, later.id])
  store.withdraw(holder.id)
  expect(store.grant(later.seq, 1, later.id)).toBeUndefined()
  expect(store.grant(head.seq, 6, head.id)).toMatchObject({ slots: 6 })
  expect(store.grant(later.seq, 1, later.id)).toMatchObject({ slots: 1 })
})

it('commits backfill past an old exclusive head without granting exclusive out of order', () => {
  const holder = store.enqueue(request)
  expect(store.grant(holder.seq, 6, holder.id)).toBeDefined()
  const head = store.enqueue({ ...request, class: 'exclusive' })
  clock += 61_000
  store.touchTicket(head.seq, head.id)
  const exclusive = store.enqueue({ ...request, class: 'exclusive' })
  const later = store.enqueue({ ...request, class: 'lint' })
  expect(store.grant(exclusive.seq, 12, exclusive.id)).toBeUndefined()
  expect(store.grant(later.seq, 1, later.id)).toMatchObject({ slots: 1 })
  expect(store.snapshot().tickets.map(ticket => ticket.id)).toEqual([head.id, exclusive.id])
})

it('rejects an obsolete share after another ticket queues, then commits the current share', () => {
  const first = store.enqueue(request)
  expect(decide(store.snapshot(), 12, clock)).toEqual({ kind: 'grant', ticketSeq: first.seq, slots: 6 })
  const second = store.enqueue(request)
  const third = store.enqueue(request)

  expect(store.grant(first.seq, 6, first.id)).toBeUndefined()
  expect(store.snapshot()).toMatchObject({ leases: [], tickets: [first, second, third] })
  expect(store.grant(first.seq, 4, first.id)).toMatchObject({ slots: 4 })
  expect(store.grant(second.seq, 4, second.id)).toMatchObject({ slots: 4 })
  expect(store.grant(third.seq, 4, third.id)).toMatchObject({ slots: 4 })
  expect(store.snapshot().leases.map(lease => lease.slots)).toEqual([4, 4, 4])
})

it('keeps held grants fixed as waiting tickets are cancelled and replaced', () => {
  const holder = store.enqueue(request)
  expect(store.grant(holder.seq, 6, holder.id)).toMatchObject({ slots: 6 })
  const head = store.enqueue(request)
  let later = store.enqueue(request)

  for (let interruption = 0; interruption < 3; interruption++) {
    expect(decide(store.snapshot(), 12, clock)).toEqual({ kind: 'grant', ticketSeq: head.seq, slots: 3 })
    store.withdraw(later.id)
    expect(store.grant(head.seq, 3, head.id)).toBeUndefined()
    expect(decide(store.snapshot(), 12, clock)).toEqual({ kind: 'grant', ticketSeq: head.seq, slots: 6 })
    expect(store.snapshot().leases).toMatchObject([{ id: holder.id, slots: 6 }])
    later = store.enqueue(request)
  }
  expect(store.grant(head.seq, 3, head.id)).toMatchObject({ slots: 3 })
  expect(store.grant(later.seq, 3, later.id)).toMatchObject({ slots: 3 })
  expect(store.snapshot().leases.map(lease => lease.slots).sort((a, b) => b - a)).toEqual([6, 3, 3])
})

it('grants and adopts thirteen held slots at idle pressure without discarding the committed lease', () => {
  for (let index = 0; index < 2; index++) {
    const holder = store.enqueue(request)
    expect(store.grant(holder.seq, 6, holder.id)).toMatchObject({ slots: 6 })
  }
  const lint = store.enqueue({ ...request, class: 'lint' })
  expect(store.grant(lint.seq, 1, lint.id, { someAvg10: 5 })).toMatchObject({ slots: 1 })
  expect(store.adopt(lint.id)).toMatchObject({ id: lint.id, slots: 1 })
  expect(store.snapshot().leases.reduce((sum, lease) => sum + lease.slots, 0)).toBe(13)
})

it('rejects a sixteenth slot through both grant and adoption', () => {
  for (const slots of [6, 6, 3]) {
    const holder = store.enqueue({ ...request, min: slots, max: slots })
    expect(store.grant(holder.seq, slots, holder.id, { someAvg10: 5 })).toMatchObject({ slots })
  }
  const lint = store.enqueue({ ...request, class: 'lint' })
  expect(store.grant(lint.seq, 1, lint.id, { someAvg10: 5 })).toBeUndefined()
  // Reproduce a lease written before a failed transaction's post-write capacity check.
  writeFileSync(join(root, 'leases', `${lint.id}.json`), JSON.stringify({ ...lint, slots: 1, workload: [] }))
  expect(store.adopt(lint.id)).toBeUndefined()
  expect(store.snapshot().leases.reduce((sum, lease) => sum + lease.slots, 0)).toBe(15)
  expect(store.snapshot().tickets).toEqual([lint])
})

it('rechecks pressure data before committing a formerly fitting grant', () => {
  const holder = store.enqueue(request)
  expect(store.grant(holder.seq, 6, holder.id)).toBeDefined()
  const lint = store.enqueue({ ...request, class: 'lint' })
  expect(store.grant(lint.seq, 1, lint.id, { someAvg10: 90 })).toBeUndefined()
  expect(store.snapshot().tickets).toEqual([lint])
  expect(store.grant(lint.seq, 1, lint.id, { someAvg10: 50 })).toMatchObject({ slots: 1 })
})
