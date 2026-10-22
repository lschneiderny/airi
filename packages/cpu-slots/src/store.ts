import type { CpuClass } from './classes'
import type { StoreFs } from './fs-adapter'
import type { BrokerState, LeaseRecord, TicketRecord } from './grant'
import type { ProcessIdentity, WorkloadOwner } from './liveness'
import type { ProcessSnapshot } from './processes'

import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import { classes } from './classes'
import { nodeFs } from './fs-adapter'
import { decide } from './grant'
import { isAlive, isSameProcess, workloadAlive } from './liveness'
import { processStartedAt, snapshotProcesses } from './processes'

export interface Ticket extends TicketRecord, ProcessIdentity {
  id: string
  cwd: string
  command: string
  createdAt: number
}

export interface StoredLease extends LeaseRecord, WorkloadOwner {
  id: string
  class: CpuClass
  cwd: string
  command: string
}

export interface StoreState extends BrokerState {
  leases: StoredLease[]
  tickets: Ticket[]
}

/** A ticket file the queue cannot read. Status lists it so a waiter is never invisible. */
export interface MalformedTicket {
  file: string
  pid?: number
  mtimeMs: number
}

export interface StoreRequest {
  class: CpuClass
  min?: number
  max?: number
  cwd: string
  command: string
}

interface LockOwner extends ProcessIdentity {
  token: string
  at: number
}

export interface StoreOptions {
  root: string
  budget?: number
  now?: () => number
  pid?: number
  startedAt?: number
  isAlive?: (pid: number) => boolean
  isSameProcess?: (pid: number, startedAt: number) => boolean
  snapshotProcesses?: () => ProcessSnapshot
  processStartedAt?: (pid: number) => number | undefined
  fs?: StoreFs
  /** Runs before a mutation, with the lock checked again after the hook returns. */
  beforeCommit?: (path: string) => void
  /** Blocks between rename retries; tests inject a no-op. */
  sleep?: (ms: number) => void
}

export type StoreBusyReason = 'lock-busy' | 'lock-lost' | 'entry-busy' | 'snapshot-failed'

export class StoreBusyError extends Error {
  constructor(
    public readonly reason: StoreBusyReason,
    /** The lock owner, when known; for `entry-busy` on the lock, the last owner this store read. */
    public readonly owner?: LockOwner,
    now?: number,
    /** The store entry that stayed unreadable or could not be replaced, for `entry-busy`. */
    public readonly path?: string,
    detail?: string,
  ) {
    super(owner && now !== undefined && now - owner.at > 30_000
      ? `lock held by pid ${owner.pid} for ${Math.floor((now - owner.at) / 1_000)}s`
      : [reason, path ?? detail].filter(Boolean).join(': '))
    this.name = 'StoreBusyError'
  }
}

/** Pauses between rename attempts while another process briefly holds the entry open. */
const renameRetryDelaysMs = [1, 2, 4, 8, 16]

function blockFor(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

interface ProcessCache {
  at: number
  /** Observation order. A capture can prove absence only for deaths observed before it began. */
  seq: number
  snapshot: ProcessSnapshot
}

/** Rename errors that mean another process holds or replaced the path; the caller retries on its next poll. */
const busyCodes = ['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EBUSY']

function code(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

/**
 * Opening or stating an entry fails with these codes on win32 while another process renames or
 * deletes it: a file inside a delete-pending directory reports EPERM, and a sharing violation
 * reports EBUSY. The entry settles within one transaction, so a read that hits one is retried.
 */
function inFlux(error: unknown): boolean {
  return ['EPERM', 'EBUSY'].includes(String(code(error)))
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function identity(value: unknown): value is ProcessIdentity {
  return object(value) && Number.isSafeInteger(value.pid) && Number(value.pid) > 0 && Number.isFinite(value.startedAt)
}

function owner(value: unknown): value is LockOwner {
  return identity(value) && 'token' in value && typeof value.token === 'string' && /^[\w-]+$/.test(value.token)
    && 'at' in value && Number.isFinite(value.at)
}

function commonRecord(value: unknown): value is Record<string, unknown> & ProcessIdentity {
  return identity(value) && object(value)
    && typeof value.id === 'string' && /^[\w-]+$/.test(value.id)
    && typeof value.class === 'string' && Object.hasOwn(classes, value.class)
    && typeof value.cwd === 'string' && typeof value.command === 'string'
    && typeof value.exclusive === 'boolean' && Number.isFinite(value.createdAt)
}

function ticketRecord(value: unknown): value is Ticket {
  return commonRecord(value) && Number.isSafeInteger(value.seq) && Number(value.seq) > 0
    && Number.isSafeInteger(value.min) && Number(value.min) > 0
    && Number.isSafeInteger(value.max) && Number(value.max) >= Number(value.min)
}

function leaseRecord(value: unknown): value is StoredLease {
  return commonRecord(value) && Number.isSafeInteger(value.slots) && Number(value.slots) > 0
    && Array.isArray(value.workload) && value.workload.every(identity)
}

/**
 * One synchronous broker operation per poll. Busy/lost locks throw StoreBusyError;
 * callers retry on their next poll. No timers or environment reads live here.
 */
export class Store {
  readonly root: string
  readonly budget: number
  private readonly fs: StoreFs
  private readonly now: () => number
  private readonly pid: number
  private readonly startedAt: number
  private readonly alive: (pid: number) => boolean
  private readonly sameProcess: (pid: number, startedAt: number) => boolean
  private readonly processes: () => ProcessSnapshot
  private readonly started: (pid: number) => number | undefined
  private readonly beforeCommit?: (path: string) => void
  private readonly sleep: (ms: number) => void
  private token?: string
  /** The last foreign owner read from the published lock, named when its owner.json stays unreadable. */
  private lockOwner?: LockOwner
  /** When the last process lookup failed; lookups pause 2 s after a failure, like the regular cap. */
  private lookupFailedAt?: number
  /**
   * Tokens of this instance's finished locks whose retirement marker could not be
   * written. lock() writes them again, and this instance may break those locks.
   */
  private readonly unmarked = new Set<string>()
  private lastTick: number
  private skipTicketPruningAt?: number
  private processCache?: ProcessCache
  private observations = 0
  /** First observation of each lease's owner death, so a later capture can judge its workload. */
  private readonly deaths = new Map<string, number>()

  constructor(options: StoreOptions) {
    this.root = options.root
    this.budget = options.budget ?? 12
    this.fs = options.fs ?? nodeFs
    this.now = options.now ?? Date.now
    this.pid = options.pid ?? process.pid
    this.startedAt = options.startedAt ?? performance.timeOrigin
    this.alive = options.isAlive ?? isAlive
    this.sameProcess = options.isSameProcess ?? isSameProcess
    this.processes = options.snapshotProcesses ?? snapshotProcesses
    this.started = options.processStartedAt ?? processStartedAt
    this.beforeCommit = options.beforeCommit
    this.sleep = options.sleep ?? blockFor
    this.lastTick = this.now()
  }

  transact<T>(fn: () => T): T {
    if (this.token) {
      this.checkToken()
      return fn()
    }
    this.prepare()
    const token = this.lock()
    this.token = token
    try {
      this.checkToken()
      const result = fn()
      this.checkToken()
      return result
    }
    finally {
      this.token = undefined
      this.leave(token)
    }
  }

  /**
   * Queues `request` under ticket `id`. A caller that retries after a failed transaction passes the
   * same id, and gets back the ticket that transaction may already have committed instead of a second one.
   */
  enqueue(request: StoreRequest, id: string = randomUUID()): Ticket {
    return this.transact(() => {
      const defaults = classes[request.class]
      const min = Math.min(request.min ?? defaults.min, this.budget)
      const max = Math.min(request.max ?? defaults.max, this.budget)
      if (!Number.isSafeInteger(min) || min < 1 || !Number.isSafeInteger(max) || max < min)
        throw new Error('Invalid slot range')
      const state = this.snapshot()
      const existing = state.tickets.find(ticket => ticket.id === id)
      if (existing)
        return existing
      const counter = this.readJson(join(this.root, 'counter.json'))
      const next = object(counter) && Number.isSafeInteger(counter.next) ? Number(counter.next) : 1
      const seq = Math.max(next, 1, ...state.tickets.map(ticket => ticket.seq + 1))
      const ticket: Ticket = {
        seq,
        id,
        pid: this.pid,
        startedAt: this.startedAt,
        class: request.class,
        min,
        max,
        exclusive: defaults.exclusive,
        cwd: request.cwd,
        command: request.command,
        createdAt: this.now(),
      }
      this.write(join(this.root, 'counter.json'), { next: seq + 1 })
      this.write(this.ticketPath(seq), ticket)
      return ticket
    })
  }

  /** Refreshes ticket `id` at `seq`. False when that file is gone or now holds another ticket. */
  touchTicket(seq: number, id: string): boolean {
    return this.transact(() => {
      this.checkToken()
      const path = this.ticketPath(seq)
      const current = this.readJson(path)
      if (!ticketRecord(current) || current.id !== id)
        return false
      try {
        this.fs.touch(path, this.now())
        return true
      }
      catch (error) {
        if (code(error) === 'ENOENT')
          return false
        throw error
      }
    })
  }

  removeTicket(seq: number): void {
    this.transact(() => this.remove(this.ticketPath(seq)))
  }

  /** Grants ticket `ticketId` at `ticketSeq` when it heads the queue for `slots`; a seq that now holds another ticket is refused. */
  grant(ticketSeq: number, slots: number, ticketId: string): StoredLease | undefined {
    return this.transact(() => {
      const state = this.snapshot()
      const decision = decide(state, this.budget)
      if (decision.kind !== 'grant' || decision.ticketSeq !== ticketSeq || decision.slots !== slots)
        return undefined
      const ticket = state.tickets.find(ticket => ticket.seq === ticketSeq)!
      if (ticket.id !== ticketId)
        return undefined
      const lease: StoredLease = {
        id: ticket.id,
        pid: ticket.pid,
        startedAt: ticket.startedAt,
        class: ticket.class,
        slots,
        exclusive: ticket.exclusive,
        cwd: ticket.cwd,
        command: ticket.command,
        createdAt: this.now(),
        workload: [],
      }
      const path = this.leasePath(lease.id)
      this.write(path, lease)
      if (!this.fits(lease, this.snapshot().leases)) {
        this.remove(path)
        return undefined
      }
      this.remove(this.ticketPath(ticketSeq))
      return lease
    })
  }

  /**
   * The lease a grant of ticket `id` committed when that grant's transaction failed after its write:
   * its caller never learned of the lease, and would otherwise queue again and wait on its own lease.
   * The lease is verified again like a fresh grant, and its ticket, when still queued, is removed.
   */
  adopt(id: string): StoredLease | undefined {
    return this.transact(() => {
      const path = this.leasePath(id)
      if (this.readJson(path) === undefined)
        return undefined
      const state = this.snapshot()
      const lease = state.leases.find(record => record.id === id)
      if (!lease || lease.pid !== this.pid)
        return undefined
      if (!this.fits(lease, state.leases)) {
        this.remove(path)
        return undefined
      }
      for (const ticket of state.tickets.filter(ticket => ticket.id === id))
        this.remove(this.ticketPath(ticket.seq))
      return lease
    })
  }

  /** Removes ticket `id` and any lease a grant committed for it, for a caller that stops waiting. */
  withdraw(id: string): void {
    this.transact(() => {
      for (const ticket of this.snapshot().tickets.filter(ticket => ticket.id === id))
        this.remove(this.ticketPath(ticket.seq))
      this.remove(this.leasePath(id))
    })
  }

  heartbeat(lease: StoredLease): void {
    try {
      this.fs.touch(this.leasePath(lease.id), this.now())
    }
    catch (error) {
      if (code(error) !== 'ENOENT')
        throw error
      // Hand deletion is outside the accounting guarantee; restore even over budget.
      this.transact(() => this.write(this.leasePath(lease.id), lease))
    }
  }

  /**
   * Even a child that exits before the lookup remains an ancestry anchor for its
   * surviving descendants. Registration time conservatively bounds identity.
   */
  workloadStartedAt(pid: number): number {
    return this.started(pid) ?? this.now()
  }

  /** Callers that retry a busy lock pass the start time they looked up once. */
  addWorkload(lease: StoredLease, pid: number, startedAt = this.workloadStartedAt(pid)): void {
    this.transact(() => {
      const current = this.readJson(this.leasePath(lease.id))
      const workload = leaseRecord(current) ? current.workload : lease.workload
      const next = [...workload.filter(work => work.pid !== pid), { pid, startedAt }]
      this.write(this.leasePath(lease.id), { ...lease, workload: next })
      lease.workload = next
    })
  }

  /**
   * Shared guard for explicit release and the caller's synchronous exit cleanup. A release is often the
   * last transaction of its process, so it retries unwritten retirement markers afterwards.
   */
  releaseIfIdle(lease: StoredLease): boolean {
    try {
      return this.transact(() => {
        const current = this.readJson(this.leasePath(lease.id))
        if (workloadAlive(leaseRecord(current) ? current : lease, this.lookup(this.processes)))
          return false
        this.remove(this.leasePath(lease.id))
        return true
      })
    }
    finally {
      this.retryRetirements()
    }
  }

  /** Writes again the retirement markers this instance could not write; lock(), release, and exit call it. */
  retryRetirements(): void {
    for (const token of this.unmarked)
      this.markRetired(token)
  }

  release(lease: StoredLease): boolean {
    return this.releaseIfIdle(lease)
  }

  snapshot(): StoreState {
    return this.transact(() => {
      const now = this.now()
      if (now - this.lastTick > 30_000 || now < this.lastTick)
        this.skipTicketPruningAt = now
      this.lastTick = now
      const skipTickets = this.skipTicketPruningAt === now
      // Observe every owner before any process snapshot is captured. A capture
      // taken before an owner died has no record of the children it spawned
      // last, so it can never prove that owner's workload is gone.
      const owners = this.records('leases', leaseRecord)
        .map(record => ({ ...record, alive: this.alive(record.value.pid), seq: ++this.observations }))
      const waiters = this.records('tickets', ticketRecord)
        .map(record => ({ ...record, alive: skipTickets || this.alive(record.value.pid) }))
      const present = new Set(owners.map(({ value }) => value.id))
      for (const id of this.deaths.keys()) {
        if (!present.has(id))
          this.deaths.delete(id)
      }
      for (const { value, mtimeMs, alive, seq } of owners) {
        const death = !alive
          ? seq
          : now - mtimeMs >= 45_000 ? this.identityDeath(value, value.createdAt) : undefined
        if (death === undefined)
          this.deaths.delete(value.id)
        else
          this.deaths.set(value.id, Math.min(death, this.deaths.get(value.id) ?? death))
      }
      const leases = owners.filter(({ value, path }) => {
        const death = this.deaths.get(value.id)
        if (death === undefined)
          return true
        const processes = this.processesAfter(death)
        if (!processes || workloadAlive(value, processes))
          return true
        this.deaths.delete(value.id)
        this.remove(path)
        return false
      }).map(({ value }) => value)
      // Waiters touch their ticket every 500 ms, so identity is rechecked only
      // once a ticket misses about four touches. A steady queue then costs no
      // process lookups; a reused pid is caught at most 2 s after its last touch.
      const tickets = waiters.filter(({ value, path, mtimeMs, alive }) => {
        if (skipTickets)
          return true
        if (now - mtimeMs < 45_000 && alive && (now - mtimeMs < 2_000 || this.identityDeath(value, value.createdAt) === undefined))
          return true
        this.remove(path)
        return false
      }).map(({ value }) => value).sort((a, b) => a.seq - b.seq)
      return { leases, tickets }
    })
  }

  /** Ticket files that fail validation and are not yet stale; snapshot() prunes stale ones. */
  malformedTickets(): MalformedTicket[] {
    return this.transact(() => {
      const result: MalformedTicket[] = []
      for (const file of this.fs.list(join(this.root, 'tickets'))) {
        if (!file.endsWith('.json'))
          continue
        const path = join(this.root, 'tickets', file)
        try {
          const value = this.readJson(path)
          if (ticketRecord(value))
            continue
          const mtimeMs = this.mtime(path)
          const pid = object(value) && Number.isSafeInteger(value.pid) ? Number(value.pid) : undefined
          result.push({ file, ...(pid === undefined ? {} : { pid }), mtimeMs })
        }
        catch (error) {
          if (code(error) !== 'ENOENT')
            throw error
        }
      }
      return result
    })
  }

  /** M4 caps process snapshots at one per 2 s per observer; a clock jump backwards resets the cap. */
  private canRefresh(now: number): boolean {
    const cache = this.processCache
    return !cache || now - cache.at >= 2_000 || now < cache.at
  }

  private refresh(now: number): ProcessCache {
    const failed = this.lookupFailedAt
    if (failed !== undefined && now >= failed && now - failed < 2_000)
      throw new StoreBusyError('snapshot-failed', undefined, undefined, undefined, 'waiting 2 s after a failed process lookup')
    this.processCache = { at: now, seq: ++this.observations, snapshot: this.lookup(this.processes) }
    return this.processCache
  }

  /**
   * Runs a process lookup. A failed one, such as a PowerShell snapshot that hits its 10 s timeout, proves
   * nothing about any process, so it is reported busy and every caller retries it on a later poll.
   */
  private lookup<T>(read: () => T): T {
    try {
      const result = read()
      this.lookupFailedAt = undefined
      return result
    }
    catch (error) {
      this.lookupFailedAt = this.now()
      throw new StoreBusyError('snapshot-failed', undefined, undefined, undefined, String(error))
    }
  }

  /**
   * A snapshot whose capture began after `death`, or undefined until the cap
   * allows one. The lease keeps counting meanwhile, so reclaim waits at most one
   * 2 s window plus the observer's next poll.
   */
  private processesAfter(death: number): ProcessSnapshot | undefined {
    const now = this.now()
    const cache = this.canRefresh(now) ? this.refresh(now) : this.processCache!
    return cache.seq > death ? cache.snapshot : undefined
  }

  /**
   * Checks the identity of a pid that `isAlive` reported live, using one batched
   * snapshot for the whole tick instead of one OS lookup per record. `since` is a
   * time after the process started, so a capture taken later can miss the pid
   * only if it has exited. Returns undefined for the same process, otherwise the
   * observation order of its death.
   */
  private identityDeath({ pid, startedAt }: ProcessIdentity, since: number): number | undefined {
    const now = this.now()
    if (now > since && this.canRefresh(now))
      this.refresh(now)
    const cache = this.processCache
    if (cache && cache.at > since) {
      const info = cache.snapshot.processes.find(record => record.pid === pid)
      if (info && Math.abs(info.startedAt - startedAt) <= 2_000)
        return undefined
      // A different process holding the pid proves the owner died before this
      // capture began. An absent pid may have exited while it was running.
      return info ? cache.seq - 0.5 : cache.seq
    }
    return this.lookup(() => this.sameProcess(pid, startedAt)) ? undefined : ++this.observations
  }

  private ownerGone(owner: LockOwner): boolean {
    return !this.alive(owner.pid) || this.identityDeath(owner, owner.at) !== undefined
  }

  /**
   * A lock that no transaction holds: one its owner marked retired after its
   * transaction ended, one of this instance's own whose marker is still unwritten,
   * or one whose owner is gone. The cheap checks run first, so a retired lock costs
   * no process lookup.
   */
  private reclaimable(owner: LockOwner): boolean {
    if (this.unmarked.has(owner.token))
      return true
    const marker = this.readJson(this.markerPath(owner.token))
    return (object(marker) && marker.token === owner.token) || this.ownerGone(owner)
  }

  /** Outside every lock directory, so it applies wherever a breaker has moved that directory. */
  private markerPath(token: string): string {
    return join(this.root, `broker.lock.${token}.retired`)
  }

  private records<T>(directory: string, valid: (value: unknown) => value is T): { value: T, path: string, mtimeMs: number }[] {
    const result: { value: T, path: string, mtimeMs: number }[] = []
    for (const name of this.fs.list(join(this.root, directory))) {
      if (!name.endsWith('.json'))
        continue
      const path = join(this.root, directory, name)
      try {
        // A record in flux is never skipped: a missing lease would undercount usage, and a
        // missing ticket would let a later waiter jump the queue. readJson and mtime report it busy.
        const value = this.readJson(path)
        const mtimeMs = this.mtime(path)
        if (valid(value))
          result.push({ value, path, mtimeMs })
        else if (this.now() - mtimeMs >= 45_000)
          this.remove(path)
      }
      catch (error) {
        if (code(error) !== 'ENOENT')
          throw error
      }
    }
    return result
  }

  private prepare(): void {
    this.fs.mkdir(this.root)
    this.fs.mkdir(join(this.root, 'tickets'))
    this.fs.mkdir(join(this.root, 'leases'))
  }

  private lock(): string {
    this.cleanTemporaryLocks()
    this.retryRetirements()
    const path = join(this.root, 'broker.lock')
    const current = this.readOwner(path)
    if (current) {
      this.lockOwner = current
      if (!this.reclaimable(current))
        throw new StoreBusyError('lock-busy', current, this.now())
      if (!this.retireLock(current))
        throw new StoreBusyError('lock-busy')
    }
    else {
      try {
        if (this.now() - this.mtime(path) <= 10_000 || !this.retireLock(undefined))
          throw new StoreBusyError('lock-busy')
      }
      catch (error) {
        if (code(error) !== 'ENOENT')
          throw error
      }
    }
    const token = randomUUID()
    const temporary = `${path}.${token}.tmp`
    this.fs.mkdir(temporary)
    this.fs.touch(temporary, this.now())
    this.fs.write(join(temporary, 'owner.json'), JSON.stringify({
      token,
      pid: this.pid,
      startedAt: this.startedAt,
      at: this.now(),
    }))
    try {
      this.fs.rename(temporary, path)
    }
    catch (error) {
      // Only an unpublished lock is cleaned up here. After a successful rename,
      // nothing may throw before transact owns the token and its finally can
      // retire or mark the lock.
      this.fs.remove(temporary)
      if (code(error) === 'ENOENT') {
        this.prepare()
        throw new StoreBusyError('lock-busy')
      }
      if (busyCodes.includes(String(code(error))))
        throw new StoreBusyError('lock-busy')
      throw error
    }
    return token
  }

  /**
   * Removes unpublished `.tmp` lock directories and stranded `.tomb` directories
   * once no transaction can hold them, or after 10 s without an owner, and
   * retirement markers once their owner's pid is dead, when M3 covers that lock
   * anyway. Markers skip the identity lookup: one left by a reused pid is inert
   * garbage. None of them ever blocks an acquirer; this only keeps the root tidy.
   *
   * Other processes rename and delete these entries concurrently, so an entry that has vanished
   * or is in flux is skipped and left to a later call. Any other error, such as EACCES or EROFS
   * from an unusable store, still fails.
   */
  private cleanTemporaryLocks(): void {
    for (const name of this.fs.list(this.root)) {
      const path = join(this.root, name)
      const retired = name.endsWith('.retired') && name.startsWith('broker.lock.')
      if (!retired && !/^broker\.lock\..+\.(?:tmp|tomb)$/.test(name))
        continue
      try {
        if (retired) {
          const marker = this.readJson(path)
          if (owner(marker) ? !this.alive(marker.pid) : this.now() - this.mtime(path) > 10_000)
            this.fs.remove(path)
          continue
        }
        const current = this.readOwner(path)
        if (current
          ? this.reclaimable(current)
          : this.now() - this.mtime(path) > 10_000) {
          this.fs.remove(path)
          // A lock directory is never copied, so its marker now names nothing.
          if (current)
            this.forget(current.token)
        }
      }
      catch (error) {
        if (!(error instanceof StoreBusyError) && code(error) !== 'ENOENT' && !inFlux(error))
          throw error
      }
    }
  }

  private retireLock(expected: LockOwner | undefined): boolean {
    const path = join(this.root, 'broker.lock')
    const tomb = `${path}.${randomUUID()}.tomb`
    try {
      this.rename(path, tomb)
    }
    catch (error) {
      if (code(error) === 'ENOENT')
        return false
      if (error instanceof StoreBusyError || busyCodes.includes(String(code(error))))
        throw new StoreBusyError('lock-busy')
      throw error
    }
    // An unreadable tombstone throws StoreBusyError and stays set aside: others delete only
    // reclaimable tombstones, and a racing owner sees lock-lost and marks its lock retired, so
    // cleanTemporaryLocks removes it. Renaming it back could publish a half-deleted, ownerless lock.
    if (this.readOwner(tomb)?.token !== expected?.token) {
      try {
        this.rename(tomb, path)
      }
      catch (error) {
        // Another acquirer published, or cleaned the tombstone, while the lock
        // was set aside. The stranded owner sees lock-lost on its next commit,
        // and cleanTemporaryLocks removes the tombstone once that owner is gone.
        if (code(error) === 'ENOENT' || error instanceof StoreBusyError || busyCodes.includes(String(code(error))))
          throw new StoreBusyError('lock-busy')
        throw error
      }
      return false
    }
    try {
      this.fs.remove(tomb)
    }
    catch (error) {
      // The lock is already retired. Another acquirer's cleanTemporaryLocks may be
      // reading the tombstone; it never blocks anyone and is cleaned up later.
      if (!busyCodes.includes(String(code(error))))
        throw error
    }
    if (expected)
      this.forget(expected.token)
    return true
  }

  /** Drops the retirement marker of a lock whose directory no longer exists. */
  private forget(token: string): void {
    this.unmarked.delete(token)
    try {
      this.fs.remove(this.markerPath(token))
    }
    catch (error) {
      // A leftover marker names a lock that no longer exists, so it authorizes
      // nothing; cleanTemporaryLocks removes it once its owner is gone.
      if (!busyCodes.includes(String(code(error))))
        throw error
    }
  }

  /**
   * Ends this instance's hold on the lock `token` after its transaction. If the
   * lock is still published under that token, it is retired. Otherwise it may sit
   * in a breaker's tombstone that is renamed back later, and on win32 the retire
   * rename itself fails with EPERM while another process has a handle inside the
   * lock directory. In both cases the lock is marked retired, so any copy of it
   * that is ever published again stays breakable instead of wedging every process.
   * No failure escapes, so a committed transaction is never reported as failed: a
   * busy one is expected, and any other is reported on stderr.
   */
  private leave(token: string): void {
    let retired = false
    try {
      // Never remove another owner's lock, including one installed during a hook.
      const current = this.readOwner(join(this.root, 'broker.lock'))
      retired = current?.token === token && this.retireLock(current)
    }
    catch (error) {
      if (!(error instanceof StoreBusyError))
        console.error(`cpu-slots: could not retire the store lock; it is marked retired instead (${String(error)})`)
    }
    finally {
      if (!retired)
        this.markRetired(token)
    }
  }

  /**
   * Records that this instance never uses the lock `token` again. A failed write
   * must not hide a committed transaction: the token is kept, lock() writes it
   * again on this instance's next call, and meanwhile this instance may break it.
   */
  private markRetired(token: string): void {
    try {
      this.fs.write(this.markerPath(token), JSON.stringify({ token, pid: this.pid, startedAt: this.startedAt, at: this.now() }))
      this.unmarked.delete(token)
    }
    catch {
      this.unmarked.add(token)
    }
  }

  private readOwner(path: string): LockOwner | undefined {
    const value = this.readJson(join(path, 'owner.json'))
    return owner(value) ? value : undefined
  }

  private readJson(path: string): unknown {
    try {
      return JSON.parse(this.fs.read(path))
    }
    catch (error) {
      if (code(error) === 'ENOENT' || error instanceof SyntaxError)
        return undefined
      if (inFlux(error))
        throw this.entryBusy(path)
      throw error
    }
  }

  /** Names the entry, and for the published lock's owner.json the last owner this store read there. */
  private entryBusy(path: string): StoreBusyError {
    const lockEntry = path === join(this.root, 'broker.lock', 'owner.json')
    return new StoreBusyError('entry-busy', lockEntry ? this.lockOwner : undefined, undefined, path)
  }

  private mtime(path: string): number {
    try {
      return this.fs.stat(path).mtimeMs
    }
    catch (error) {
      if (inFlux(error))
        throw this.entryBusy(path)
      throw error
    }
  }

  /** Write-then-verify: whether `lease` may stand beside the live leases of a fresh snapshot. */
  private fits(lease: StoredLease, live: StoredLease[]): boolean {
    const others = live.filter(record => record.id !== lease.id)
    return live.some(record => record.id === lease.id)
      && live.reduce((total, record) => total + record.slots, 0) <= this.budget
      && !(lease.exclusive ? others.length > 0 : others.some(record => record.exclusive))
  }

  private checkToken(): void {
    if (!this.token || this.readOwner(join(this.root, 'broker.lock'))?.token !== this.token)
      throw new StoreBusyError('lock-lost')
  }

  private write(path: string, value: unknown): void {
    this.checkToken()
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      this.fs.write(temporary, JSON.stringify(value))
      this.fs.touch(temporary, this.now())
      this.beforeCommit?.(path)
      this.checkToken()
      this.rename(temporary, path, true)
    }
    finally {
      this.fs.remove(temporary)
    }
  }

  private remove(path: string): void {
    this.beforeCommit?.(path)
    this.checkToken()
    this.fs.remove(path)
  }

  /**
   * Retries a win32 sharing error after a short, growing pause. One that outlasts every retry means
   * another process still holds the entry, so it is reported busy and retried on the caller's next poll.
   */
  private rename(from: string, to: string, checkOwnership = false): void {
    for (let attempt = 0; ; attempt++) {
      try {
        if (checkOwnership)
          this.checkToken()
        this.fs.rename(from, to)
        return
      }
      catch (error) {
        if (!inFlux(error))
          throw error
        if (attempt >= renameRetryDelaysMs.length)
          throw new StoreBusyError('entry-busy', undefined, undefined, to)
        this.sleep(renameRetryDelaysMs[attempt])
      }
    }
  }

  private ticketPath(seq: number): string {
    return join(this.root, 'tickets', `${seq}.json`)
  }

  private leasePath(id: string): string {
    return join(this.root, 'leases', `${id}.json`)
  }
}
