import process from 'node:process'

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readStatus, Store, StoreBusyError } from '../src'
import { readStatusWithin } from '../src/status'

import * as liveness from '../src/liveness'
import * as processes from '../src/processes'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'airi-cpu-status-'))
  vi.stubEnv('AIRI_CPU_BUDGET', '8')
})

afterEach(() => {
  vi.restoreAllMocks()
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
  const granted = store.enqueue({ ...request, min: 6, max: 6 })
  const lease = store.grant(granted.seq, 6, granted.id)!
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

it('f23 retries a busy store every 500 ms, then gives up at the cap with the busy reason', async () => {
  let clock = 0
  const waits: number[] = []
  const read = vi.fn((): never => {
    throw new StoreBusyError('lock-busy')
  })
  await expect(readStatusWithin({ capMs: 30_000, now: () => clock, wait: async (ms) => {
    waits.push(ms)
    clock += ms
  }, read })).rejects.toThrow(expect.objectContaining({ name: 'StoreBusyError', reason: 'lock-busy' }))
  expect(waits).toEqual(Array.from({ length: 60 }).fill(500))
  expect(read).toHaveBeenCalledTimes(61)
})

it('f23 returns the status once the store is free', async () => {
  let busy = 2
  const status = { storePath: root, budget: 8, held: 0, leases: [], queue: [] }
  const read = vi.fn(() => {
    if (busy-- > 0)
      throw new StoreBusyError('entry-busy')
    return status
  })
  await expect(readStatusWithin({ now: () => 0, wait: async () => {}, read })).resolves.toBe(status)
  expect(read).toHaveBeenCalledTimes(3)
})

describe('f18 a process snapshot that times out while status prunes a dead owner', () => {
  const dead = 2_000_000_001
  const timedOut = (): never => {
    throw Object.assign(new Error('spawnSync powershell.exe ETIMEDOUT'), { code: 'ETIMEDOUT' })
  }

  beforeEach(() => {
    vi.spyOn(liveness, 'isAlive').mockImplementation(pid => pid !== dead)
    mkdirSync(join(root, 'leases'))
    writeFileSync(join(root, 'leases', 'dead.json'), JSON.stringify({ id: 'dead', pid: dead, startedAt: 1, class: 'test', slots: 6, exclusive: false, cwd: '/w', command: 'dead', createdAt: Date.now(), workload: [] }))
  })

  it('is reported busy, not as the raw spawn error', () => {
    vi.spyOn(processes, 'snapshotProcesses').mockImplementation(timedOut)
    expect(() => readStatus({ root })).toThrow(expect.objectContaining({ name: 'StoreBusyError', reason: 'snapshot-failed' }))
  })

  it('is retried by pnpm slots status, which then prunes the dead lease', async () => {
    vi.spyOn(processes, 'snapshotProcesses').mockImplementationOnce(timedOut).mockReturnValue({ platform: process.platform, processes: [] })
    await expect(readStatusWithin({ root, now: () => 0, wait: async () => {} })).resolves.toMatchObject({ held: 0, leases: [] })
  })
})
