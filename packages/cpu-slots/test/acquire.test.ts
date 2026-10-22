import type { Lease } from '../src/acquire'
import type { ProcessSnapshot } from '../src/processes'

import process from 'node:process'

import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acquire } from '../src/acquire'
import { workloadAlive } from '../src/liveness'
import { Store } from '../src/store'

import * as liveness from '../src/liveness'
import * as processes from '../src/processes'

let root: string
let leases: Lease[]
const request = { class: 'test', cwd: '/test-worktree', command: 'test' } as const

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'airi-cpu-acquire-'))
  leases = []
  vi.stubEnv('AIRI_CPU_SLOTS_DIR', root)
  vi.stubEnv('AIRI_CPU_BUDGET', '8')
  vi.stubEnv('AIRI_CPU_SLOTS', '')
  vi.stubEnv('CI', '')
  vi.stubEnv('AIRI_CPU_LEASE', '')
  vi.stubEnv('AIRI_CPU_GRANT', '')
  vi.spyOn(liveness, 'isSameProcess').mockReturnValue(true)
  vi.spyOn(processes, 'snapshotProcesses').mockReturnValue({ platform: process.platform, processes: [] })
})

afterEach(() => {
  for (const lease of leases)
    lease.release()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

async function take(options: Parameters<typeof acquire>[0] = request): Promise<Lease> {
  const lease = await acquire(options)
  leases.push(lease)
  return lease
}

describe('acquire lifecycle', () => {
  it('a10 reuses in process, caps the class, rejects exclusive, and never changes env or signal handlers', async () => {
    const env = { ...process.env }
    const signals = [process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]
    const first = await take()
    const second = await take({ ...request, class: 'browser' })
    expect(first.grant).toBe(6)
    expect(second).toMatchObject({ id: first.id, grant: 4, inherited: true })
    expect(second.env.AIRI_CPU_CLASS).toBe('test')
    expect(readdirSync(join(root, 'tickets'))).toEqual([])
    await expect(take({ ...request, class: 'exclusive' })).rejects.toThrow('exclusive-under-shared')
    expect(process.env).toEqual(env)
    expect([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]).toEqual(signals)
  })

  it('reference counts in-process reuse so only the last release frees the lease', async () => {
    const first = await take()
    const second = await take({ ...request, class: 'browser' })
    const store = new Store({ root, budget: 8 })
    second.release()
    second.release()
    expect(store.snapshot().leases).toHaveLength(1)
    first.release()
    expect(store.snapshot().leases).toHaveLength(0)
  })

  it('a11 release then reacquire queues a new class and lease', async () => {
    const first = await take()
    first.release()
    const second = await take({ ...request, class: 'lint' })
    expect(second).toMatchObject({ grant: 1, inherited: false })
    expect(second.id).not.toBe(first.id)
  })

  it.each([['CI', '1'], ['AIRI_CPU_SLOTS', 'off']])('a13 %s=%s creates no files', async (key, value) => {
    vi.stubEnv(key, value)
    expect((await take()).grant).toBeNull()
    expect(readdirSync(root)).toEqual([])
  })

  it('falls back when the store is below a regular file', async () => {
    const file = join(root, 'file')
    writeFileSync(file, '')
    vi.stubEnv('AIRI_CPU_SLOTS_DIR', join(file, 'store'))
    const warning = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await take()).grant).toBeNull()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('running unbrokered'))
  })

  it('re-enqueues a pruned ticket and cancels without leaving a ticket', async () => {
    vi.useFakeTimers()
    const holderStore = new Store({ root, budget: 8 })
    const holder = holderStore.grant(holderStore.enqueue({ ...request, min: 8, max: 8 }).seq, 8)!
    const abort = new AbortController()
    const pending = acquire({ ...request, signal: abort.signal })
    const rejected = expect(pending).rejects.toThrow('cancel-test')
    const store = new Store({ root, budget: 8 })
    const first = store.snapshot().tickets[0]
    store.removeTicket(first.seq)
    await vi.advanceTimersByTimeAsync(500)
    const second = store.snapshot().tickets[0]
    expect(second.seq).toBeGreaterThan(first.seq)
    abort.abort(new Error('cancel-test'))
    await rejected
    expect(store.snapshot().tickets).toEqual([])
    holderStore.releaseIfIdle(holder)
  })

  it('a14 twenty concurrent calls acquire in ticket order', async () => {
    vi.useFakeTimers()
    const holder = await take({ ...request, class: 'exclusive' })
    // Concurrent requests start before the first is held, so isolate them from in-process reuse.
    holder.release()
    const store = new Store({ root, budget: 8 })
    const blocker = store.enqueue({ ...request, class: 'exclusive' })
    const blockLease = store.grant(blocker.seq, 8)!
    const order: number[] = []
    const pending = Array.from({ length: 20 }, (_, index) => acquire({ ...request, class: 'exclusive' }).then((lease) => {
      order.push(index)
      lease.release()
    }))
    expect(store.snapshot().tickets).toHaveLength(20)
    store.releaseIfIdle(blockLease)
    await vi.runAllTimersAsync()
    await Promise.all(pending)
    expect(order).toEqual(Array.from({ length: 20 }, (_, index) => index))
  })

  it('a10 inherits a live store lease without queueing, then queues after release', async () => {
    const store = new Store({ root, budget: 8 })
    const ticket = store.enqueue(request)
    const parent = store.grant(ticket.seq, 6)!
    vi.stubEnv('AIRI_CPU_LEASE', parent.id)
    vi.stubEnv('AIRI_CPU_GRANT', '6')
    const child = await take({ ...request, class: 'browser' })
    expect(child).toMatchObject({ id: parent.id, grant: 4, inherited: true })
    expect(store.snapshot().tickets).toEqual([])
    await expect(acquire({ ...request, class: 'exclusive' })).rejects.toThrow('exclusive-under-shared')
    child.release()
    expect(store.snapshot().leases).toHaveLength(1)
    store.releaseIfIdle(parent)
    expect((await take()).inherited).toBe(false)
  })
})

describe('releaseIfIdle uses the pruning workload rule', () => {
  const rows: { name: string, registered: boolean, snapshot: ProcessSnapshot, alive: boolean }[] = [
    { name: 'registered workload', registered: true, snapshot: { platform: 'win32', processes: [{ pid: 20, ppid: 1, startedAt: 100 }] }, alive: true },
    { name: 'dead workload with win32 descendant', registered: true, snapshot: { platform: 'win32', processes: [{ pid: 30, ppid: 20, startedAt: 101 }] }, alive: true },
    { name: 'dead workload with POSIX group', registered: true, snapshot: { platform: 'linux', processes: [{ pid: 30, ppid: 1, pgid: 20, startedAt: 101 }] }, alive: true },
    { name: 'unregistered owner descendant', registered: false, snapshot: { platform: 'win32', processes: [{ pid: 30, ppid: 10, startedAt: 101 }] }, alive: true },
    { name: 'all gone', registered: true, snapshot: { platform: 'win32', processes: [] }, alive: false },
    { name: 'reused workload pid', registered: true, snapshot: { platform: 'win32', processes: [{ pid: 20, ppid: 1, startedAt: -3000 }] }, alive: false },
  ]
  it.each(rows)('$name', ({ registered, snapshot, alive }) => {
    const snapshots = vi.fn(() => snapshot)
    let ownerAlive = true
    const store = new Store({
      root,
      budget: 8,
      pid: 10,
      startedAt: 100,
      now: () => 100,
      isAlive: () => ownerAlive,
      isSameProcess: () => true,
      processStartedAt: () => 100,
      snapshotProcesses: snapshots,
    })
    const ticket = store.enqueue(request)
    const record = store.grant(ticket.seq, 6)!
    if (registered)
      store.addWorkload(record, 20)
    expect(workloadAlive(record, snapshot)).toBe(alive)
    expect(store.releaseIfIdle(record)).toBe(!alive)
    expect(snapshots).toHaveBeenCalledTimes(1)
    ownerAlive = false
    expect(store.snapshot().leases.some(lease => lease.id === record.id)).toBe(alive)
  })
})
