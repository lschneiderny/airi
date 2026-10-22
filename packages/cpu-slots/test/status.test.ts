import process from 'node:process'

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { readStatus, Store } from '../src'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'airi-cpu-status-'))
  vi.stubEnv('AIRI_CPU_BUDGET', '8')
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

it('reads an absent store as empty without creating it', () => {
  const missing = join(root, 'absent')
  expect(readStatus({ root: missing })).toEqual({ storePath: missing, budget: 8, held: 0, leases: [], queue: [] })
  expect(existsSync(missing)).toBe(false)
})

it('reads a live lease and a queued ticket, with storePath first', () => {
  const store = new Store({ root, budget: 8 })
  const request = { class: 'test', cwd: '/worktree', command: 'job' } as const
  const lease = store.grant(store.enqueue({ ...request, min: 6, max: 6 }).seq, 6)!
  const ticket = store.enqueue({ ...request, min: 6, max: 6 })
  const status = readStatus({ root })
  expect(Object.keys(status)[0]).toBe('storePath')
  expect(status).toMatchObject({ storePath: root, budget: 8, held: 6 })
  expect(status.leases.map(({ id }) => id)).toEqual([lease.id])
  expect(status.queue).toMatchObject([{ seq: ticket.seq }])
})

it('lists a live ticket the queue cannot read instead of hiding it', () => {
  mkdirSync(join(root, 'tickets'))
  // The shape an acquire() without cwd and command wrote before requests were validated.
  writeFileSync(join(root, 'tickets', '1.json'), JSON.stringify({ seq: 1, id: 'hidden', pid: process.pid, startedAt: 1, class: 'typecheck', min: 2, max: 6, exclusive: false, createdAt: Date.now() }))
  expect(readStatus({ root }).queue).toEqual([{ malformed: true, file: '1.json', pid: process.pid, touched: expect.any(Number) }])
})
