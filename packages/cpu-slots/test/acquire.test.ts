import type { AcquireOptions, Lease } from '../src/acquire'
import type { ProcessSnapshot } from '../src/processes'

import process from 'node:process'

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acquire } from '../src/acquire'
import { nodeFs } from '../src/fs-adapter'
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

  it.each<[string, unknown, string]>([
    ['no cwd or command', { class: 'typecheck' }, 'bad-command'],
    ['no command', { class: 'typecheck', cwd: '/test-worktree' }, 'bad-command'],
    ['an array command', { class: 'typecheck', cwd: '/test-worktree', command: ['a', 'b'] }, 'bad-command'],
    ['no cwd', { class: 'typecheck', command: 'test' }, 'bad-cwd'],
  ])('rejects a request with %s before writing a ticket', async (_name, malformed, error) => {
    // Fake timers stop the poll loop of an implementation that queues instead of rejecting.
    vi.useFakeTimers()
    await expect(acquire(malformed as AcquireOptions)).rejects.toThrow(error)
    expect(readdirSync(root)).toEqual([])
  })

  it('looks a workload start time up once per registration, not on every busy-lock retry', async () => {
    vi.useFakeTimers()
    const started = vi.spyOn(processes, 'processStartedAt').mockReturnValue(123)
    const lease = await take()
    // A live owner holds the broker lock; its future timestamp keeps identity on the mocked isSameProcess.
    const lock = join(root, 'broker.lock')
    mkdirSync(lock)
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ token: 'other', pid: process.pid, startedAt: 1, at: Date.now() + 3_600_000 }))
    lease.addWorkload(4242)
    await vi.advanceTimersByTimeAsync(100)
    rmSync(lock, { recursive: true })
    await vi.advanceTimersByTimeAsync(25)
    expect(started).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(join(root, 'leases', `${lease.id}.json`), 'utf8')).workload).toEqual([{ pid: 4242, startedAt: 123 }])
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
    const held = holderStore.enqueue({ ...request, min: 8, max: 8 })
    const holder = holderStore.grant(held.seq, 8, held.id)!
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
    const blockLease = store.grant(blocker.seq, 8, blocker.id)!
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
    const parent = store.grant(ticket.seq, 6, ticket.id)!
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
    const record = store.grant(ticket.seq, 6, ticket.id)!
    if (registered)
      store.addWorkload(record, 20)
    expect(workloadAlive(record, snapshot)).toBe(alive)
    expect(store.releaseIfIdle(record)).toBe(!alive)
    expect(snapshots).toHaveBeenCalledTimes(1)
    ownerAlive = false
    expect(store.snapshot().leases.some(lease => lease.id === record.id)).toBe(alive)
  })
})

describe('audit follow-ups (2026-10-22)', () => {
  const owner = (): string => join(root, 'broker.lock', 'owner.json')
  const epermError = (): Error => Object.assign(new Error('EPERM'), { code: 'EPERM' })

  /**
   * Fails the next read of the lock's owner.json with EPERM, once `trigger` has seen a matching rename or
   * remove: the store then reports entry-busy from its next lock check, after that step committed.
   */
  function failLockCheckAfter(trigger: (op: 'rename' | 'remove', path: string) => boolean): () => number {
    const original = { ...nodeFs }
    let armed = false
    let fired = 0
    vi.spyOn(nodeFs, 'rename').mockImplementation((from, to) => {
      original.rename(from, to)
      if (!fired && trigger('rename', to))
        armed = true
    })
    vi.spyOn(nodeFs, 'remove').mockImplementation((path) => {
      original.remove(path)
      if (!fired && trigger('remove', path))
        armed = true
    })
    vi.spyOn(nodeFs, 'read').mockImplementation((path) => {
      if (armed && path === owner()) {
        armed = false
        fired++
        throw epermError()
      }
      return original.read(path)
    })
    return () => fired
  }

  /** Starts an acquire that the test settles by aborting, and records how it settled. */
  function track(options: AcquireOptions): { abort: AbortController, settled: () => { lease?: Lease, error?: unknown } | undefined } {
    const abort = new AbortController()
    let result: { lease?: Lease, error?: unknown } | undefined
    acquire({ ...options, signal: abort.signal }).then((lease) => {
      leases.push(lease)
      result = { lease }
    }, (error: unknown) => {
      result = { error }
    })
    return { abort, settled: () => result }
  }

  const grantedTicket = (op: 'rename' | 'remove', path: string): boolean => op === 'remove' && /tickets[\\/]\d+\.json$/.test(path)
  const writtenLease = (op: 'rename' | 'remove', path: string): boolean => op === 'rename' && path.startsWith(join(root, 'leases'))

  it('f31 a lock check that fails after the grant committed leaves one lease, not two', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fired = failLockCheckAfter(grantedTicket)
    const call = track(request)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fired()).toBe(1)
    const lease = call.settled()?.lease
    expect(readdirSync(join(root, 'leases'))).toEqual([`${lease!.id}.json`])
    expect(lease).toMatchObject({ grant: 6, inherited: false })
    expect(readdirSync(join(root, 'tickets'))).toEqual([])
    call.abort.abort()
  })

  it.each([
    ['after the grant committed', grantedTicket],
    ['between the lease write and the ticket removal', writtenLease],
  ] as const)('f31 an exclusive request whose lock check fails %s is granted instead of waiting on itself', async (_name, trigger) => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fired = failLockCheckAfter(trigger)
    const call = track({ ...request, class: 'exclusive' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fired()).toBe(1)
    try {
      expect(call.settled()?.lease).toMatchObject({ grant: 8, exclusive: true })
      expect(readdirSync(join(root, 'leases'))).toHaveLength(1)
    }
    finally {
      call.abort.abort()
    }
  })

  it('f24 names a store entry that stays busy for 30 s with its last holder, and rejects with entry-unreadable after 5 min', async () => {
    vi.useFakeTimers()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    // A live foreign owner holds the lock, so the first poll records it; then its owner.json stays unreadable.
    const lock = join(root, 'broker.lock')
    mkdirSync(lock)
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ token: 'other', pid: process.pid, startedAt: 1, at: Date.now() + 3_600_000 }))
    const call = track(request)
    const read = nodeFs.read
    vi.spyOn(nodeFs, 'read').mockImplementation((path) => {
      if (path === owner())
        throw epermError()
      return read(path)
    })
    try {
      await vi.advanceTimersByTimeAsync(100)
      expect(errors).not.toHaveBeenCalledWith(expect.stringContaining('busy for'))
      vi.setSystemTime(Date.now() + 30_000)
      await vi.advanceTimersByTimeAsync(50)
      expect(errors).toHaveBeenCalledWith(expect.stringContaining(`${owner()} busy for 30s; lock last held by pid ${process.pid}`))
      expect(call.settled()).toBeUndefined()
      vi.setSystemTime(Date.now() + 270_000)
      await vi.advanceTimersByTimeAsync(50)
      expect(call.settled()?.error).toMatchObject({ name: 'CpuSlotsError', code: 'entry-unreadable', message: `entry-unreadable: ${owner()}` })
    }
    finally {
      call.abort.abort()
    }
  })

  it('f18 keeps a waiter queued through a failed process snapshot instead of rejecting it', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const dead = 2_000_000_001
    vi.spyOn(liveness, 'isAlive').mockImplementation(pid => pid !== dead)
    mkdirSync(join(root, 'leases'), { recursive: true })
    writeFileSync(join(root, 'leases', 'dead.json'), JSON.stringify({ id: 'dead', pid: dead, startedAt: 1, class: 'exclusive', slots: 8, exclusive: true, cwd: '/w', command: 'dead', createdAt: Date.now(), workload: [] }))
    vi.mocked(processes.snapshotProcesses).mockImplementationOnce(() => {
      throw Object.assign(new Error('spawnSync powershell.exe ETIMEDOUT'), { code: 'ETIMEDOUT' })
    })
    const call = track(request)
    await vi.advanceTimersByTimeAsync(3_000)
    try {
      expect(call.settled()?.lease).toMatchObject({ grant: 6 })
      expect(readdirSync(join(root, 'leases'))).not.toContain('dead.json')
    }
    finally {
      call.abort.abort()
    }
  })

  it('f08 exit writes a retirement marker that the release could not', async () => {
    vi.resetModules()
    const fresh = {
      acquire: (await import('../src/acquire')).acquire,
      fs: (await import('../src/fs-adapter')).nodeFs,
      liveness: await import('../src/liveness'),
      processes: await import('../src/processes'),
    }
    vi.spyOn(fresh.liveness, 'isSameProcess').mockReturnValue(true)
    vi.spyOn(fresh.processes, 'snapshotProcesses').mockReturnValue({ platform: process.platform, processes: [] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Exit listeners are collected instead of registered, so the test runs them itself.
    const exits: (() => void)[] = []
    const on = process.on.bind(process)
    vi.spyOn(process, 'on').mockImplementation(((event: string, listener: () => void) => {
      if (event !== 'exit')
        return on(event, listener)
      exits.push(listener)
      return process
    }) as typeof process.on)
    const lease = await fresh.acquire(request)
    const lock = join(root, 'broker.lock')
    let blocked = true
    let markFailures = 2
    const original = { ...fresh.fs }
    vi.spyOn(fresh.fs, 'rename').mockImplementation((from, to) => {
      if (blocked && from === lock && to.endsWith('.tomb'))
        throw epermError()
      original.rename(from, to)
    })
    vi.spyOn(fresh.fs, 'write').mockImplementation((path, text) => {
      if (path.endsWith('.retired') && markFailures-- > 0)
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      original.write(path, text)
    })
    lease.release()
    const markers = (): string[] => readdirSync(root).filter(name => name.endsWith('.retired'))
    expect(markers()).toEqual([])
    for (const listener of exits)
      listener()
    expect(markers()).toHaveLength(1)
    blocked = false
    expect(new Store({ root, budget: 8 }).snapshot()).toEqual({ leases: [], tickets: [] })
  })
})
