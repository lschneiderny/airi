import type { StoreFs } from '../src/fs-adapter'
import type { ProcessSnapshot } from '../src/processes'
import type { StoredLease, StoreOptions } from '../src/store'

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { nodeFs } from '../src/fs-adapter'
import { decide } from '../src/grant'
import { snapshotProcesses } from '../src/processes'
import { Store, StoreBusyError } from '../src/store'

let root: string
let clock: number
let live: Set<number>
let reused: Set<number>
let processes: ProcessSnapshot
let snapshot: ReturnType<typeof vi.fn<() => ProcessSnapshot>>

const request = { class: 'test', command: 'test command', cwd: '/worktree' } as const

function createStore(pid = 10, overrides: Partial<StoreOptions> = {}): Store {
  return new Store({
    root,
    budget: 6,
    pid,
    startedAt: 1_000,
    now: () => clock,
    isAlive: pid => live.has(pid),
    isSameProcess: pid => !reused.has(pid),
    snapshotProcesses: snapshot,
    processStartedAt: () => clock,
    ...overrides,
  })
}

/** Live owners appear with their recorded start time, or a new one when their pid was reused. */
function observe(): ProcessSnapshot {
  return {
    platform: processes.platform,
    processes: [
      ...[...live].map(pid => ({ pid, ppid: 1, startedAt: reused.has(pid) ? 9_000_000_000 : 1_000 })),
      ...processes.processes,
    ],
  }
}

function putLease(id: string, pid: number): void {
  nodeFs.mkdir(join(root, 'leases'))
  writeJson(join(root, 'leases', `${id}.json`), {
    id,
    pid,
    startedAt: 1_000,
    class: 'test',
    slots: 3,
    exclusive: false,
    cwd: '/worktree',
    command: 'test command',
    createdAt: clock,
    workload: [],
  })
}

function writeJson(path: string, value: unknown): void {
  nodeFs.write(path, JSON.stringify(value))
  nodeFs.touch(path, clock)
}

function putLock(pid: number, token = 'owner'): void {
  const path = join(root, 'broker.lock')
  nodeFs.mkdir(path)
  writeJson(join(path, 'owner.json'), { token, pid, startedAt: 1_000, at: clock })
  nodeFs.touch(path, clock)
}

function takeLease(store = createStore()): StoredLease {
  const ticket = store.enqueue(request)
  const lease = store.grant(ticket.seq, 6)
  expect(lease).toBeDefined()
  return lease!
}

function expireWithoutGap(store: Store): void {
  clock += 23_000
  store.snapshot()
  clock += 23_000
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'airi-cpu-store-'))
  clock = 1_000_000
  live = new Set([10, 20, 30])
  reused = new Set()
  processes = { platform: 'win32', processes: [] }
  snapshot = vi.fn(observe)
})

afterEach(() => {
  nodeFs.remove(root)
})

describe('token checked lock', () => {
  it('a2 keeps a live same-process lock at +120 seconds', () => {
    putLock(20)
    const store = createStore()
    clock += 120_000
    expect(() => store.enqueue(request)).toThrow(StoreBusyError)
    expect(() => store.enqueue(request)).toThrow('lock held by pid 20 for 120s')
    expect(JSON.parse(nodeFs.read(join(root, 'broker.lock', 'owner.json'))).token).toBe('owner')
  })

  it('a2 breaks a dead-pid lock', () => {
    putLock(20)
    live.delete(20)
    expect(createStore().enqueue(request).seq).toBe(1)
  })

  it('a2 breaks a reused-pid lock', () => {
    putLock(20)
    reused.add(20)
    expect(createStore().enqueue(request).seq).toBe(1)
  })

  it('a3 restores the replacement token after a double break', () => {
    putLock(30, 'stale')
    live.delete(30)
    let raced = false
    const fs: StoreFs = {
      ...nodeFs,
      rename(from, to) {
        if (!raced && from === join(root, 'broker.lock')) {
          raced = true
          writeJson(join(from, 'owner.json'), { token: 'A', pid: 20, startedAt: 1_000, at: clock })
        }
        nodeFs.rename(from, to)
      },
    }
    expect(() => createStore(10, { fs }).enqueue(request)).toThrow(StoreBusyError)
    expect(JSON.parse(nodeFs.read(join(root, 'broker.lock', 'owner.json'))).token).toBe('A')
    expect(nodeFs.list(root).filter(name => name.endsWith('.tomb'))).toEqual([])
  })

  it('reports a publication during the tombstone rename-back as busy and later cleans the stranded tombstone', () => {
    putLock(40, 'stale')
    const lock = join(root, 'broker.lock')
    let step = 0
    const fs: StoreFs = {
      ...nodeFs,
      rename(from, to) {
        if (step === 0 && from === lock) {
          step = 1
          writeJson(join(from, 'owner.json'), { token: 'A', pid: 20, startedAt: 1_000, at: clock })
        }
        else if (step === 1 && to === lock) {
          step = 2
          putLock(30, 'C')
        }
        nodeFs.rename(from, to)
      },
    }
    expect(() => createStore(10, { fs }).enqueue(request)).toThrow(StoreBusyError)
    expect(step).toBe(2)
    expect(JSON.parse(nodeFs.read(join(lock, 'owner.json'))).token).toBe('C')
    const tombs = () => nodeFs.list(root).filter(name => name.endsWith('.tomb'))
    expect(tombs()).toHaveLength(1)
    expect(JSON.parse(nodeFs.read(join(root, tombs()[0], 'owner.json'))).token).toBe('A')
    expect(() => createStore().snapshot()).toThrow(StoreBusyError)
    expect(tombs()).toHaveLength(1)
    live.delete(20)
    live.delete(30)
    expect(createStore().enqueue(request).seq).toBe(1)
    expect(tombs()).toEqual([])
  })

  it('cleans an ownerless tombstone only after ten seconds', () => {
    const tomb = join(root, 'broker.lock.abandoned.tomb')
    nodeFs.mkdir(tomb)
    nodeFs.touch(tomb, clock)
    const store = createStore()
    store.snapshot()
    expect(nodeFs.list(root)).toContain('broker.lock.abandoned.tomb')
    clock += 10_001
    store.snapshot()
    expect(nodeFs.list(root)).not.toContain('broker.lock.abandoned.tomb')
  })

  it('a4 keeps a slow live holder and sequences subsequent commits strictly', () => {
    const second = createStore(20)
    let interleaved = false
    const first = createStore(10, {
      beforeCommit() {
        if (interleaved)
          return
        interleaved = true
        clock += 120_000
        expect(() => second.enqueue(request)).toThrow(StoreBusyError)
      },
    })
    const a = first.enqueue(request)
    const b = second.enqueue(request)
    expect([a.seq, b.seq]).toEqual([1, 2])
  })

  it('rejects a commit after ownership changes without deleting the replacement lock', () => {
    let changed = false
    const store = createStore(10, {
      beforeCommit() {
        if (changed)
          return
        changed = true
        writeJson(join(root, 'broker.lock', 'owner.json'), { token: 'replacement', pid: 20, startedAt: 1_000, at: clock })
      },
    })
    expect(() => store.enqueue(request)).toThrow(expect.objectContaining({ reason: 'lock-lost' }))
    expect(nodeFs.list(join(root, 'tickets'))).toEqual([])
    expect(nodeFs.list(root)).not.toContain('counter.json')
    expect(JSON.parse(nodeFs.read(join(root, 'broker.lock', 'owner.json'))).token).toBe('replacement')
  })

  it.each(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY', 'EEXIST'])('a12 treats publication %s as busy and cleans its temporary directory', (code) => {
    let failed = false
    const fs: StoreFs = {
      ...nodeFs,
      rename(from, to) {
        if (!failed && to === join(root, 'broker.lock')) {
          failed = true
          throw Object.assign(new Error(code), { code })
        }
        nodeFs.rename(from, to)
      },
    }
    const store = createStore(10, { fs })
    expect(() => store.enqueue(request)).toThrow(StoreBusyError)
    expect(nodeFs.list(root).filter(name => name.startsWith('broker.lock'))).toEqual([])
    expect(store.enqueue(request).seq).toBe(1)
  })

  it('a12 creates the missing root after publication ENOENT and retries on the next poll', () => {
    let failed = false
    const fs: StoreFs = {
      ...nodeFs,
      rename(from, to) {
        if (!failed && to === join(root, 'broker.lock')) {
          failed = true
          nodeFs.remove(root)
          throw Object.assign(new Error('missing'), { code: 'ENOENT' })
        }
        nodeFs.rename(from, to)
      },
    }
    const store = createStore(10, { fs })
    expect(() => store.enqueue(request)).toThrow(StoreBusyError)
    expect(store.enqueue(request).seq).toBe(1)
  })

  it.each(['EPERM', 'EBUSY'])('a12 retries two %s errors on lease rename without losing the lease', (code) => {
    let failures = 0
    const fs: StoreFs = {
      ...nodeFs,
      rename(from, to) {
        if (to.includes(`${join(root, 'leases')}`) && failures < 2) {
          failures++
          throw Object.assign(new Error(code), { code })
        }
        nodeFs.rename(from, to)
      },
    }
    const store = createStore(10, { fs })
    const lease = takeLease(store)
    expect(failures).toBe(2)
    expect(store.snapshot().leases).toEqual([lease])
    expect(nodeFs.list(join(root, 'leases'))).toEqual([`${lease.id}.json`])
  })

  it('bounds rename retries and retains the ticket when publication never succeeds', () => {
    let attempts = 0
    const fs: StoreFs = {
      ...nodeFs,
      rename(from, to) {
        if (to.includes(join(root, 'leases'))) {
          attempts++
          throw Object.assign(new Error('busy'), { code: 'EBUSY' })
        }
        nodeFs.rename(from, to)
      },
    }
    const store = createStore(10, { fs })
    const ticket = store.enqueue(request)
    expect(() => store.grant(ticket.seq, 6)).toThrow('busy')
    expect(attempts).toBe(6)
    expect(store.snapshot().tickets).toEqual([ticket])
    expect(nodeFs.list(join(root, 'leases'))).toEqual([])
  })

  it('rechecks the token before retrying an interrupted lease rename', () => {
    let interrupted = false
    const fs: StoreFs = {
      ...nodeFs,
      rename(from, to) {
        if (!interrupted && to.includes(join(root, 'leases'))) {
          interrupted = true
          writeJson(join(root, 'broker.lock', 'owner.json'), { token: 'replacement', pid: 20, startedAt: 1_000, at: clock })
          throw Object.assign(new Error('permission'), { code: 'EPERM' })
        }
        nodeFs.rename(from, to)
      },
    }
    const store = createStore(10, { fs })
    const ticket = store.enqueue(request)
    expect(() => store.grant(ticket.seq, 6)).toThrow(expect.objectContaining({ reason: 'lock-lost' }))
    expect(nodeFs.list(join(root, 'leases'))).toEqual([])
    expect(JSON.parse(nodeFs.read(join(root, 'broker.lock', 'owner.json'))).token).toBe('replacement')
  })

  it.each([false, true])('a19 an interrupted temporary publication never blocks; owner alive=%s', (alive) => {
    const fs: StoreFs = {
      ...nodeFs,
      write(path, text) {
        nodeFs.write(path, text)
        if (path.endsWith('owner.json'))
          throw new Error('simulated crash after owner write')
      },
    }
    expect(() => createStore(20, { fs }).enqueue(request)).toThrow('simulated crash')
    const orphan = nodeFs.list(root).find(name => name.endsWith('.tmp'))!
    expect(orphan).toBeDefined()
    if (!alive)
      live.delete(20)
    expect(createStore(10).enqueue(request).seq).toBe(1)
    expect(nodeFs.list(root).includes(orphan)).toBe(alive)
    if (alive) {
      live.delete(20)
      createStore(30).snapshot()
      expect(nodeFs.list(root)).not.toContain(orphan)
    }
    putLock(20)
    live.add(20)
    clock += 120_000
    expect(() => createStore(30).enqueue(request)).toThrow(StoreBusyError)
  })

  it('cleans ownerless temporary directories only after ten seconds', () => {
    const orphan = join(root, 'broker.lock.abandoned.tmp')
    nodeFs.mkdir(orphan)
    nodeFs.touch(orphan, clock)
    const store = createStore()
    store.snapshot()
    expect(nodeFs.list(root)).toContain('broker.lock.abandoned.tmp')
    clock += 10_001
    store.snapshot()
    expect(nodeFs.list(root)).not.toContain('broker.lock.abandoned.tmp')
  })

  // win32 rejects a directory rename while another process has a handle inside it, such as a waiter
  // reading owner.json. Only the rename that retires the published lock fails here.
  function lockedTomb(fails: () => boolean): { fs: StoreFs, attempts: () => number } {
    let attempts = 0
    const lock = join(root, 'broker.lock')
    const fs: StoreFs = {
      ...nodeFs,
      rename(from, to) {
        if (from === lock && to.endsWith('.tomb')) {
          attempts++
          if (fails())
            throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
        }
        nodeFs.rename(from, to)
      },
    }
    return { fs, attempts: () => attempts }
  }

  it.each(['its owner', 'another store'])('a lock whose retirement fails six times is reclaimed by %s on its next call', (next) => {
    let failures = 6
    const { fs, attempts } = lockedTomb(() => failures-- > 0)
    const owner = createStore(10, { fs })
    expect(owner.transact(() => 'work')).toBe('work')
    expect(attempts()).toBe(6)
    expect(nodeFs.list(root)).toContain('broker.lock')
    const store = next === 'its owner' ? owner : createStore(20, { fs })
    expect(store.transact(() => 'next')).toBe('next')
    expect(nodeFs.list(root).filter(name => name.startsWith('broker.lock'))).toEqual([])
    expect(createStore(30).enqueue(request).seq).toBe(1)
    expect(owner.transact(() => 'again')).toBe('again')
    // A retired lock is reclaimed without judging its live owner's identity.
    expect(snapshot).not.toHaveBeenCalled()
  })

  it('keeps a lock whose retirement fails past every retry busy for all, commits once, and frees it when the rename works', () => {
    let blocked = true
    const { fs, attempts } = lockedTomb(() => blocked)
    const owner = createStore(10, { fs })
    const other = createStore(20, { fs })
    const ticket = owner.enqueue(request)
    for (let poll = 0; poll < 5; poll++) {
      expect(() => other.snapshot()).toThrow(StoreBusyError)
      expect(() => owner.snapshot()).toThrow(StoreBusyError)
    }
    expect(attempts()).toBe(66)
    expect(nodeFs.list(join(root, 'tickets'))).toEqual([`${ticket.seq}.json`])
    blocked = false
    expect(other.snapshot().tickets).toEqual([ticket])
    expect(owner.snapshot().tickets).toEqual([ticket])
    expect(nodeFs.list(root).filter(name => name.startsWith('broker.lock'))).toEqual([])
    expect(snapshot).not.toHaveBeenCalled()
  })

  /**
   * A store whose first tombstone rename of the published lock is delayed until `racer` has broken
   * that same lock and published its own: the rename lands inside racer's transaction and moves
   * racer's lock aside, racer's commit sees lock-lost, and the delayed store restores the lock on
   * the token mismatch. `failures` EPERM renames come first.
   */
  function delayedBreaker(pid: number, racer: Store, failures = 0): Store {
    let raced = false
    const lock = join(root, 'broker.lock')
    return createStore(pid, {
      fs: {
        ...nodeFs,
        rename(from, to) {
          if (from === lock && to.endsWith('.tomb')) {
            if (failures-- > 0)
              throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
            if (!raced) {
              raced = true
              expect(() => racer.transact(() => nodeFs.rename(from, to))).toThrow(expect.objectContaining({ reason: 'lock-lost' }))
              return
            }
          }
          nodeFs.rename(from, to)
        },
      },
    })
  }

  it('w2 an owner whose delayed reclaim restores a newer lock leaves no lock that wedges the store', () => {
    const other = createStore(20)
    const owner = delayedBreaker(10, other, 6)
    expect(owner.transact(() => 'work')).toBe('work')
    expect(() => owner.transact(() => 'next')).toThrow(StoreBusyError)
    expect(nodeFs.list(root)).toContain('broker.lock')
    expect(owner.transact(() => 'owner')).toBe('owner')
    expect(other.transact(() => 'other')).toBe('other')
    expect(createStore(30).enqueue(request).seq).toBe(1)
    expect(nodeFs.list(root).filter(name => name.startsWith('broker.lock'))).toEqual([])
  })

  it('w1 a losing breaker that restores the winner\'s lock leaves no lock that wedges the store', () => {
    live.add(40)
    let failures = 6
    const owner = createStore(10, { fs: lockedTomb(() => failures-- > 0).fs })
    expect(owner.transact(() => 'work')).toBe('work')
    const winner = createStore(20)
    const loser = delayedBreaker(30, winner)
    expect(() => loser.snapshot()).toThrow(StoreBusyError)
    expect(nodeFs.list(root)).toContain('broker.lock')
    for (const store of [winner, loser, owner, createStore(40)])
      expect(store.transact(() => 'proceeds')).toBe('proceeds')
    expect(createStore(40).enqueue(request).seq).toBe(1)
  })

  it('w3 a losing breaker of a dead owner\'s lock leaves no lock that wedges the store', () => {
    putLock(40, 'stale')
    const winner = createStore(20)
    const loser = delayedBreaker(30, winner)
    expect(() => loser.snapshot()).toThrow(StoreBusyError)
    expect(nodeFs.list(root)).toContain('broker.lock')
    for (const store of [winner, loser, createStore(10)])
      expect(store.transact(() => 'proceeds')).toBe('proceeds')
  })

  it('s7 a lock moved aside while its owner marks it retired is still breakable once restored', () => {
    let failures = 6
    let raced = false
    const lock = join(root, 'broker.lock')
    const aside = join(root, 'broker.lock.loser.tomb')
    const owner = createStore(10, {
      fs: {
        ...lockedTomb(() => failures-- > 0).fs,
        write(path, text) {
          if (raced || !path.includes('retired')) {
            nodeFs.write(path, text)
            return
          }
          raced = true
          nodeFs.rename(lock, aside)
          try {
            nodeFs.write(path, text)
          }
          finally {
            nodeFs.rename(aside, lock)
          }
        },
      },
    })
    expect(owner.transact(() => 'work')).toBe('work')
    expect(raced).toBe(true)
    expect(nodeFs.list(root)).toContain('broker.lock')
    expect(createStore(20).transact(() => 'other')).toBe('other')
    expect(createStore(30).enqueue(request).seq).toBe(1)
  })

  it.each([1, Infinity])('a retirement marker that fails to write %s time(s) never hides the commit or wedges the store', (markFailures) => {
    let failures = 6
    let markAttempts = 0
    const owner = createStore(10, {
      fs: {
        ...lockedTomb(() => failures-- > 0).fs,
        write(path, text) {
          if (path.includes('retired') && markAttempts++ < markFailures)
            throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
          nodeFs.write(path, text)
        },
      },
    })
    expect(owner.transact(() => 'work')).toBe('work')
    expect(markAttempts).toBeGreaterThan(0)
    expect(owner.transact(() => 'again')).toBe('again')
    expect(createStore(20).enqueue(request).seq).toBe(1)
  })

  it('treats a busy tombstone removal after retiring its own lock as done', () => {
    let failed = false
    const fs: StoreFs = {
      ...nodeFs,
      remove(path) {
        if (!failed && path.endsWith('.tomb')) {
          failed = true
          throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
        }
        nodeFs.remove(path)
      },
    }
    expect(createStore(10, { fs }).transact(() => 'work')).toBe('work')
    expect(failed).toBe(true)
    expect(nodeFs.list(root)).not.toContain('broker.lock')
    expect(createStore(20).enqueue(request).seq).toBe(1)
  })

  it('breaks a hand-created ownerless published lock only after ten seconds', () => {
    const path = join(root, 'broker.lock')
    nodeFs.mkdir(path)
    nodeFs.touch(path, clock)
    const store = createStore()
    expect(() => store.snapshot()).toThrow(StoreBusyError)
    clock += 10_001
    expect(store.snapshot()).toEqual({ leases: [], tickets: [] })
  })
})

describe('win32 sharing errors on entries in flux', () => {
  /**
   * Fails `op` on matching paths with `code`, as NTFS does while another process renames or deletes
   * the entry: opening a file inside a delete-pending directory fails with EPERM.
   */
  function flux(op: 'read' | 'stat' | 'remove', matches: (path: string) => boolean, code: string, failures = Infinity): StoreFs {
    const fail = (path: string): void => {
      if (matches(path) && failures-- > 0)
        throw Object.assign(new Error(code), { code })
    }
    return {
      ...nodeFs,
      read(path) {
        if (op === 'read')
          fail(path)
        return nodeFs.read(path)
      },
      stat(path) {
        if (op === 'stat')
          fail(path)
        return nodeFs.stat(path)
      },
      remove(path) {
        if (op === 'remove')
          fail(path)
        nodeFs.remove(path)
      },
    }
  }

  function putEntry(name: string, pid: number): string {
    const path = join(root, name)
    nodeFs.mkdir(path)
    writeJson(join(path, 'owner.json'), { token: 'flux', pid, startedAt: 1_000, at: clock })
    nodeFs.touch(path, clock)
    return path
  }

  it.each([
    ['tmp', 'EPERM'],
    ['tmp', 'EBUSY'],
    ['tomb', 'EPERM'],
    ['tomb', 'EBUSY'],
  ])('f4-b1 skips a .%s lock entry whose owner read fails with %s, then tidies it once it settles', (kind, code) => {
    const entry = putEntry(`broker.lock.flux.${kind}`, 20)
    live.delete(20)
    const store = createStore(10, { fs: flux('read', path => path.startsWith(entry), code) })
    expect(store.enqueue(request).seq).toBe(1)
    expect(nodeFs.list(root)).toContain(`broker.lock.flux.${kind}`)
    expect(createStore(10).enqueue(request).seq).toBe(2)
    expect(nodeFs.list(root).filter(name => name.startsWith('broker.lock'))).toEqual([])
  })

  it.each(['EPERM', 'EBUSY'])('skips a retirement marker and a dead lock entry that fail with %s while being deleted', (code) => {
    const marker = join(root, 'broker.lock.flux.retired')
    writeJson(marker, { token: 'flux', pid: 20, startedAt: 1_000, at: clock })
    const entry = putEntry('broker.lock.dead.tmp', 20)
    live.delete(20)
    expect(createStore(10, { fs: flux('read', path => path === marker, code) }).enqueue(request).seq).toBe(1)
    expect(createStore(10, { fs: flux('remove', path => path === entry, code) }).enqueue(request).seq).toBe(2)
    expect(nodeFs.list(root)).toContain('broker.lock.dead.tmp')
    expect(createStore(10).enqueue(request).seq).toBe(3)
    expect(nodeFs.list(root).filter(name => name.startsWith('broker.lock'))).toEqual([])
  })

  it.each(['EPERM', 'EBUSY'])('reports the published lock as busy while its owner read fails with %s', (code) => {
    putLock(20)
    const owner = join(root, 'broker.lock', 'owner.json')
    const store = createStore(10, { fs: flux('read', path => path === owner, code, 1) })
    expect(() => store.enqueue(request)).toThrow(StoreBusyError)
    expect(JSON.parse(nodeFs.read(owner)).token).toBe('owner')
    live.delete(20)
    expect(store.enqueue(request).seq).toBe(1)
  })

  it.each(['EPERM', 'EBUSY'])('reports a breaker whose tombstone read fails with %s as busy and cleans the stranded tombstone later', (code) => {
    putLock(20, 'stale')
    live.delete(20)
    const store = createStore(10, { fs: flux('read', path => path.includes('.tomb'), code, 1) })
    expect(() => store.enqueue(request)).toThrow(StoreBusyError)
    expect(nodeFs.list(root).filter(name => name.endsWith('.tomb'))).toHaveLength(1)
    expect(store.enqueue(request).seq).toBe(1)
    expect(nodeFs.list(root).filter(name => name.startsWith('broker.lock'))).toEqual([])
  })

  it.each([
    ['read', 'EPERM'],
    ['read', 'EBUSY'],
    ['stat', 'EPERM'],
    ['stat', 'EBUSY'],
  ] as const)('reports a lease whose %s fails with %s as busy instead of dropping it', (op, code) => {
    const lease = takeLease(createStore(20))
    const store = createStore(10, { fs: flux(op, path => path.startsWith(join(root, 'leases')), code, 1) })
    expect(() => store.snapshot()).toThrow(StoreBusyError)
    expect(store.snapshot().leases).toEqual([lease])
  })

  it.each(['EACCES', 'EROFS'])('still fails fast on %s from a lock entry read or an unwritable store root', (code) => {
    const entry = putEntry('broker.lock.denied.tmp', 20)
    expect(() => createStore(10, { fs: flux('read', path => path.startsWith(entry), code) }).enqueue(request))
      .toThrow(expect.objectContaining({ code }))
    nodeFs.remove(entry)
    const unwritable: StoreFs = {
      ...nodeFs,
      mkdir(path) {
        if (path.endsWith('.tmp'))
          throw Object.assign(new Error(code), { code })
        nodeFs.mkdir(path)
      },
    }
    expect(() => createStore(10, { fs: unwritable }).enqueue(request)).toThrow(expect.objectContaining({ code }))
  })
})

describe('tickets, leases, and heartbeat', () => {
  it('a5 prunes a dead head waiter so the next ticket can run', () => {
    const first = createStore(20).enqueue(request)
    const store = createStore()
    const second = store.enqueue(request)
    live.delete(20)
    expect(store.snapshot().tickets.map(ticket => ticket.seq)).toEqual([second.seq])
    expect(store.grant(first.seq, 6)).toBeUndefined()
    expect(store.grant(second.seq, 6)?.pid).toBe(10)
  })

  it('a6 re-enqueues an untouched expired waiter at the back', () => {
    const store = createStore()
    const first = store.enqueue(request)
    expireWithoutGap(store)
    const second = createStore(20).enqueue(request)
    expect(store.snapshot().tickets).toEqual([second])
    expect(store.touchTicket(first.seq)).toBe(false)
    const replacement = store.enqueue(request)
    expect(replacement.seq).toBeGreaterThan(second.seq)
    expect(store.snapshot().tickets.map(ticket => ticket.seq)).toEqual([second.seq, replacement.seq])
  })

  it('touches tickets with the injected clock and removes them explicitly', () => {
    const store = createStore()
    const ticket = store.enqueue(request)
    clock += 500
    expect(store.touchTicket(ticket.seq)).toBe(true)
    expect(nodeFs.stat(join(root, 'tickets', `${ticket.seq}.json`)).mtimeMs).toBe(clock)
    store.removeTicket(ticket.seq)
    expect(store.snapshot().tickets).toEqual([])
  })

  it('a7 keeps a stale heartbeat with a live same-process owner and blocks replacement', () => {
    const store = createStore()
    const lease = takeLease(store)
    const next = createStore(20).enqueue(request)
    expireWithoutGap(store)
    createStore(20).touchTicket(next.seq)
    expect(store.snapshot().leases).toEqual([lease])
    expect(store.grant(next.seq, 6)).toBeUndefined()
  })

  it.each(['dead', 'reused'] as const)('a7b/a7c replaces a stale lease when its owner is %s', (state) => {
    const holder = createStore(20)
    takeLease(holder)
    const observer = createStore()
    const next = observer.enqueue(request)
    expireWithoutGap(observer)
    observer.touchTicket(next.seq)
    if (state === 'dead')
      live.delete(20)
    else
      reused.add(20)
    expect(observer.snapshot().leases).toEqual([])
    expect(observer.grant(next.seq, 6)?.pid).toBe(10)
  })

  it('prunes a dead owner immediately even with a fresh heartbeat', () => {
    takeLease(createStore(20))
    live.delete(20)
    expect(createStore().snapshot().leases).toEqual([])
  })

  it('checks lease identity only once the heartbeat becomes stale, from the batched snapshot', () => {
    const same = vi.fn(() => true)
    const store = createStore(10, { isSameProcess: same })
    takeLease(store)
    store.snapshot()
    expect(snapshot).not.toHaveBeenCalled()
    clock += 45_000
    store.snapshot()
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(same).not.toHaveBeenCalled()
  })

  it('judges every stale lease and ticket in one tick from a single process snapshot', () => {
    nodeFs.mkdir(join(root, 'tickets'))
    for (const [index, pid] of [10, 20, 30].entries()) {
      putLease(`lease-${pid}`, pid)
      writeJson(join(root, 'tickets', `${index + 1}.json`), {
        seq: index + 1,
        id: `ticket-${pid}`,
        pid,
        startedAt: 1_000,
        class: 'test',
        min: 1,
        max: 1,
        exclusive: false,
        cwd: '/worktree',
        command: 'test command',
        createdAt: clock,
      })
    }
    clock += 46_000
    for (const name of nodeFs.list(join(root, 'tickets')))
      nodeFs.touch(join(root, 'tickets', name), clock - 3_000)
    const same = vi.fn(() => true)
    const state = createStore(10, { isSameProcess: same, budget: 12 }).snapshot()
    expect(state.leases).toHaveLength(3)
    expect(state.tickets).toHaveLength(3)
    expect(snapshot).toHaveBeenCalledTimes(1)
    expect(same).not.toHaveBeenCalled()
  })

  it('a8 skips ticket pruning for a long observer tick, then prunes on its next poll', () => {
    const store = createStore()
    const ticket = store.enqueue(request)
    clock += 46_000
    expect(store.snapshot().tickets).toEqual([ticket])
    clock += 500
    expect(store.snapshot().tickets).toEqual([])
  })

  it('a9 restores a hand-deleted lease and blocks grants while over budget', () => {
    const store = createStore()
    const first = takeLease(store)
    nodeFs.remove(join(root, 'leases', `${first.id}.json`))
    const second = takeLease(createStore(20))
    store.heartbeat(first)
    const ticket = createStore(30).enqueue(request)
    const state = store.snapshot()
    expect(state.leases.reduce((total, lease) => total + lease.slots, 0)).toBe(12)
    expect(decide(state, 6)).toEqual({ kind: 'wait', reason: 'over-budget' })
    expect(store.grant(ticket.seq, 6)).toBeUndefined()
    expect(store.release(first)).toBe(true)
    expect(store.snapshot().leases).toEqual([second])
  })

  it('heartbeats use the injected clock without rewriting the lease', () => {
    const store = createStore()
    const lease = takeLease(store)
    const path = join(root, 'leases', `${lease.id}.json`)
    const body = nodeFs.read(path)
    clock += 10_000
    store.heartbeat(lease)
    expect(nodeFs.stat(path).mtimeMs).toBe(clock)
    expect(nodeFs.read(path)).toBe(body)
  })

  it('ignores malformed JSON and temporary files, pruning malformed JSON only when stale', () => {
    const store = createStore()
    store.snapshot()
    for (const dir of ['leases', 'tickets']) {
      const path = join(root, dir, 'bad.json')
      nodeFs.write(path, '{broken')
      nodeFs.touch(path, clock)
      writeJson(join(root, dir, 'schema.json'), { slots: -1 })
      nodeFs.write(join(root, dir, 'unfinished.json.tmp'), '{')
    }
    expect(store.snapshot()).toEqual({ leases: [], tickets: [] })
    expect(nodeFs.list(join(root, 'leases'))).toHaveLength(3)
    clock += 45_000
    expect(store.snapshot()).toEqual({ leases: [], tickets: [] })
    for (const dir of ['leases', 'tickets'])
      expect(nodeFs.list(join(root, dir))).toEqual(['unfinished.json.tmp'])
  })

  it('recovers a malformed counter above the sequence of every queued ticket', () => {
    const store = createStore()
    const first = store.enqueue(request)
    nodeFs.write(join(root, 'counter.json'), '{')
    expect(store.enqueue(request).seq).toBe(first.seq + 1)
  })

  it('grants only the queue head with the decision slots', () => {
    const store = createStore()
    const a = store.enqueue(request)
    const b = store.enqueue(request)
    expect(store.grant(b.seq, 6)).toBeUndefined()
    expect(store.grant(a.seq, 5)).toBeUndefined()
    expect(store.grant(a.seq, 6)?.slots).toBe(6)
    expect(store.grant(b.seq, 6)).toBeUndefined()
  })

  it('serializes exclusive requests with finite clamped bounds', () => {
    const store = createStore()
    const ticket = store.enqueue({ ...request, class: 'exclusive' })
    expect(ticket).toMatchObject({ min: 6, max: 6, exclusive: true })
    expect(store.snapshot().tickets).toEqual([ticket])
    expect(store.grant(ticket.seq, 6)?.exclusive).toBe(true)
  })
})

describe('write then verify', () => {
  it.each([
    ['A17 shared/shared', 'test', 'test'],
    ['A18 exclusive/shared', 'exclusive', 'test'],
    ['A18 shared/exclusive', 'test', 'exclusive'],
  ] as const)('%s never keeps conflicting grants after simulated lock failure', (_name, firstClass, secondClass) => {
    let interleaved = false
    const second = createStore(20)
    const a = createStore(10).enqueue({ ...request, class: firstClass })
    const b = second.enqueue({ ...request, class: secondClass })
    const first = createStore(10, {
      beforeCommit(path) {
        if (interleaved || !path.includes(join(root, 'leases')))
          return
        interleaved = true
        // Force two stale views past the lock check. The real accounting and
        // write-then-verify path are unchanged in both stores.
        const lock = join(root, 'broker.lock')
        const saved = nodeFs.read(join(lock, 'owner.json'))
        nodeFs.remove(lock)
        const ticketPath = join(root, 'tickets', `${a.seq}.json`)
        nodeFs.rename(ticketPath, `${ticketPath}.tmp`)
        expect(second.grant(b.seq, 6)).toBeDefined()
        nodeFs.rename(`${ticketPath}.tmp`, ticketPath)
        nodeFs.mkdir(lock)
        nodeFs.write(join(lock, 'owner.json'), saved)
      },
    })
    expect(first.grant(a.seq, 6)).toBeUndefined()
    expect(interleaved).toBe(true)
    const state = first.snapshot()
    expect(state.leases).toHaveLength(1)
    expect(state.leases[0].pid).toBe(20)
    expect(state.leases.reduce((total, lease) => total + lease.slots, 0)).toBeLessThanOrEqual(6)
    expect(state.tickets).toEqual([a])
  })
})

describe('workload registration, pruning, and release parity', () => {
  it('registers workload identity atomically and deduplicates a pid', () => {
    const store = createStore()
    const lease = takeLease(store)
    store.addWorkload(lease, 40)
    store.addWorkload(lease, 40)
    expect(lease.workload).toEqual([{ pid: 40, startedAt: clock }])
    expect(store.snapshot().leases[0].workload).toEqual(lease.workload)
    expect(nodeFs.list(join(root, 'leases'))).toEqual([`${lease.id}.json`])
  })

  it('retains the ancestry anchor when a workload exits before its creation time can be read', () => {
    const store = createStore(10, { processStartedAt: () => undefined })
    const lease = takeLease(store)
    store.addWorkload(lease, 40)
    expect(lease.workload).toEqual([{ pid: 40, startedAt: clock }])
    processes = { platform: 'win32', processes: [{ pid: 50, ppid: 40, startedAt: clock + 100 }] }
    expect(store.release(lease)).toBe(false)
    live.delete(10)
    expect(createStore(20).snapshot().leases).toEqual([lease])
  })

  it.each([
    { name: 'live registered workload', platform: 'win32', registered: true, records: [{ pid: 40, ppid: 1, startedAt: 1_000_000 }], kept: true },
    { name: 'dead Windows workload with live descendant', platform: 'win32', registered: true, records: [{ pid: 50, ppid: 40, startedAt: 1_000_100 }], kept: true },
    { name: 'dead POSIX group leader', platform: 'linux', registered: true, records: [{ pid: 50, ppid: 1, pgid: 40, startedAt: 1_000_100 }], kept: true },
    { name: 'unregistered owner child', platform: 'win32', registered: false, records: [{ pid: 50, ppid: 20, startedAt: 1_000_100 }], kept: true },
    { name: 'reused workload pid', platform: 'win32', registered: true, records: [{ pid: 40, ppid: 1, startedAt: 1_100_000 }], kept: false },
    { name: 'everything gone', platform: 'win32', registered: true, records: [], kept: false },
  ] as const)('pruning and release agree for $name', ({ platform, registered, records, kept }) => {
    const store = createStore(20)
    const lease = takeLease(store)
    if (registered)
      store.addWorkload(lease, 40)
    processes = { platform, processes: [...records] }
    expect(store.releaseIfIdle(lease)).toBe(!kept)
    expect(snapshot).toHaveBeenCalledTimes(1)
    // Recreate the same record to independently exercise pruning.
    writeJson(join(root, 'leases', `${lease.id}.json`), lease)
    live.delete(20)
    expect(createStore().snapshot().leases.some(record => record.id === lease.id)).toBe(kept)
  })

  it('takes at most one slow-path snapshot per two seconds per observer', () => {
    const holder = createStore(20)
    const lease = takeLease(holder)
    holder.addWorkload(lease, 40)
    live.delete(20)
    processes = { platform: 'win32', processes: [{ pid: 40, ppid: 1, startedAt: clock }] }
    const observer = createStore()
    expect(observer.snapshot().leases).toHaveLength(1)
    clock += 500
    expect(observer.snapshot().leases).toHaveLength(1)
    expect(snapshot).toHaveBeenCalledTimes(1)
    clock += 1_500
    processes = { platform: 'win32', processes: [] }
    expect(observer.snapshot().leases).toEqual([])
    expect(snapshot).toHaveBeenCalledTimes(2)
  })

  it('always takes a fresh release snapshot even with no registered workloads', () => {
    const store = createStore()
    const lease = takeLease(store)
    processes = { platform: 'win32', processes: [{ pid: 40, ppid: 10, startedAt: clock }] }
    expect(store.release(lease)).toBe(false)
    processes = { platform: 'win32', processes: [] }
    expect(store.release(lease)).toBe(true)
    expect(snapshot).toHaveBeenCalledTimes(2)
  })

  it('does not use a cached negative snapshot to prune newly orphaned work', () => {
    takeLease(createStore(30))
    live.delete(30)
    const observer = createStore()
    expect(observer.snapshot().leases).toEqual([])
    const holder = createStore(20)
    const lease = takeLease(holder)
    holder.addWorkload(lease, 40)
    clock += 500
    live.delete(20)
    processes = { platform: 'win32', processes: [{ pid: 40, ppid: 1, startedAt: 1_000_000 }] }
    expect(observer.snapshot().leases).toEqual([lease])
    expect(snapshot).toHaveBeenCalledTimes(1)
    clock += 1_500
    expect(observer.snapshot().leases).toEqual([lease])
    expect(snapshot).toHaveBeenCalledTimes(2)
  })

  it('does not prune a lease against a snapshot captured before its owner died in the same tick', () => {
    const sorted: StoreFs = { ...nodeFs, list: path => nodeFs.list(path).sort() }
    putLease('a-lease', 30)
    putLease('b-lease', 20)
    live.delete(30)
    // The capture triggered by a-lease predates b-lease's owner death and the
    // child that owner spawned just before it died.
    snapshot.mockImplementationOnce(() => {
      const captured = observe()
      live.delete(20)
      processes = { platform: 'win32', processes: [{ pid: 50, ppid: 20, startedAt: clock + 1 }] }
      return captured
    })
    const observer = createStore(10, { fs: sorted })
    const ids = () => observer.snapshot().leases.map(lease => lease.id)
    expect(ids()).toEqual(['b-lease'])
    expect(ids()).toEqual(['b-lease'])
    expect(snapshot).toHaveBeenCalledTimes(1)
    clock += 2_000
    expect(ids()).toEqual(['b-lease'])
    expect(snapshot).toHaveBeenCalledTimes(2)
    processes = { platform: 'win32', processes: [] }
    clock += 2_000
    expect(ids()).toEqual([])
  })

  it('does not let a pre-death snapshot prune under a frozen clock', () => {
    takeLease(createStore(30))
    live.delete(30)
    const observer = createStore()
    expect(observer.snapshot().leases).toEqual([])
    const holder = createStore(20)
    const lease = takeLease(holder)
    holder.addWorkload(lease, 40)
    live.delete(20)
    processes = { platform: 'win32', processes: [{ pid: 40, ppid: 1, startedAt: clock }] }
    expect(observer.snapshot().leases).toEqual([lease])
    const ticket = observer.enqueue(request)
    expect(observer.grant(ticket.seq, 6)).toBeUndefined()
    expect(snapshot).toHaveBeenCalledTimes(1)
  })

  it('keeps a lease whose dead owner pid was reused by the snapshot probe while its child lives', () => {
    putLease('b-lease', 20)
    live.delete(20)
    const created = clock
    const observer = createStore(10, {
      snapshotProcesses: () => snapshotProcesses('win32', () => ({
        pid: 20,
        stdout: JSON.stringify([
          { ProcessId: 10, ParentProcessId: 4, CreationDate: '/Date(1000)/' },
          { ProcessId: 20, ParentProcessId: 10, CreationDate: `/Date(${created + 50})/` },
          { ProcessId: 50, ParentProcessId: 20, CreationDate: `/Date(${created + 10})/` },
        ]),
      })),
    })
    expect(observer.snapshot().leases.map(lease => lease.id)).toEqual(['b-lease'])
  })

  it('accepts a fresh snapshot taken after the observer tick began', () => {
    takeLease(createStore(20))
    live.delete(20)
    const observer = createStore(10, { now: () => clock++ })
    expect(observer.snapshot().leases).toEqual([])
    expect(snapshot).toHaveBeenCalledTimes(1)
  })
})
