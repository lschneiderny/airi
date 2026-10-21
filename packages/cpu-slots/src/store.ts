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
}

export class StoreBusyError extends Error {
  constructor(public readonly reason: 'lock-busy' | 'lock-lost', public readonly owner?: LockOwner, now?: number) {
    super(owner && now !== undefined && now - owner.at > 30_000
      ? `lock held by pid ${owner.pid} for ${Math.floor((now - owner.at) / 1_000)}s`
      : reason)
    this.name = 'StoreBusyError'
  }
}

function code(error: unknown): unknown {
  return error instanceof Error && 'code' in error ? error.code : undefined
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function identity(value: unknown): value is ProcessIdentity {
  return object(value) && Number.isSafeInteger(value.pid) && Number(value.pid) > 0 && Number.isFinite(value.startedAt)
}

function owner(value: unknown): value is LockOwner {
  return identity(value) && 'token' in value && typeof value.token === 'string' && 'at' in value && Number.isFinite(value.at)
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
  private token?: string
  private lastTick: number
  private skipTicketPruningAt?: number
  private processCache?: { at: number, snapshot: ProcessSnapshot }

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
      // Never remove another owner's lock, including one installed during a hook.
      const current = this.readOwner(join(this.root, 'broker.lock'))
      if (current?.token === token)
        this.retireLock(current)
    }
  }

  enqueue(request: StoreRequest): Ticket {
    return this.transact(() => {
      const defaults = classes[request.class]
      const min = Math.min(request.min ?? defaults.min, this.budget)
      const max = Math.min(request.max ?? defaults.max, this.budget)
      if (!Number.isSafeInteger(min) || min < 1 || !Number.isSafeInteger(max) || max < min)
        throw new Error('Invalid slot range')
      const state = this.snapshot()
      const counter = this.readJson(join(this.root, 'counter.json'))
      const next = object(counter) && Number.isSafeInteger(counter.next) ? Number(counter.next) : 1
      const seq = Math.max(next, 1, ...state.tickets.map(ticket => ticket.seq + 1))
      const ticket: Ticket = {
        seq,
        id: randomUUID(),
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

  touchTicket(seq: number): boolean {
    return this.transact(() => {
      this.checkToken()
      try {
        this.fs.touch(this.ticketPath(seq), this.now())
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

  grant(ticketSeq: number, slots: number): StoredLease | undefined {
    return this.transact(() => {
      const state = this.snapshot()
      const decision = decide(state, this.budget)
      if (decision.kind !== 'grant' || decision.ticketSeq !== ticketSeq || decision.slots !== slots)
        return undefined
      const ticket = state.tickets.find(ticket => ticket.seq === ticketSeq)!
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
      const live = this.snapshot().leases
      const own = live.find(record => record.id === lease.id)
      const others = live.filter(record => record.id !== lease.id)
      if (!own || live.reduce((total, record) => total + record.slots, 0) > this.budget
        || (lease.exclusive ? others.length > 0 : others.some(record => record.exclusive))) {
        this.remove(path)
        return undefined
      }
      this.remove(this.ticketPath(ticketSeq))
      return lease
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

  addWorkload(lease: StoredLease, pid: number): void {
    // Even a child that exits before the lookup remains an ancestry anchor for
    // its surviving descendants. Registration time conservatively bounds identity.
    const startedAt = this.started(pid) ?? this.now()
    this.transact(() => {
      const current = this.readJson(this.leasePath(lease.id))
      const workload = leaseRecord(current) ? current.workload : lease.workload
      const next = [...workload.filter(work => work.pid !== pid), { pid, startedAt }]
      this.write(this.leasePath(lease.id), { ...lease, workload: next })
      lease.workload = next
    })
  }

  /** Shared guard for explicit release and the caller's synchronous exit cleanup. */
  releaseIfIdle(lease: StoredLease): boolean {
    return this.transact(() => {
      const current = this.readJson(this.leasePath(lease.id))
      if (workloadAlive(leaseRecord(current) ? current : lease, this.processes()))
        return false
      this.remove(this.leasePath(lease.id))
      return true
    })
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
      const leases = this.records('leases', leaseRecord).filter(({ value, path, mtimeMs }) => {
        const ownerAlive = this.alive(value.pid) && (now - mtimeMs < 45_000 || this.sameProcess(value.pid, value.startedAt))
        if (ownerAlive || workloadAlive(value, this.cachedProcesses()))
          return true
        // An old positive snapshot can only delay pruning. An old negative
        // cannot prove that a newly orphaned workload has already exited.
        if (this.processCache!.at < now)
          return true
        this.remove(path)
        return false
      }).map(({ value }) => value)
      const tickets = this.records('tickets', ticketRecord).filter(({ value, path, mtimeMs }) => {
        if (this.skipTicketPruningAt === now)
          return true
        if (now - mtimeMs < 45_000 && this.alive(value.pid) && this.sameProcess(value.pid, value.startedAt))
          return true
        this.remove(path)
        return false
      }).map(({ value }) => value).sort((a, b) => a.seq - b.seq)
      return { leases, tickets }
    })
  }

  private cachedProcesses(): ProcessSnapshot {
    const now = this.now()
    if (!this.processCache || now - this.processCache.at >= 2_000 || now < this.processCache.at)
      this.processCache = { at: now, snapshot: this.processes() }
    return this.processCache.snapshot
  }

  private records<T>(directory: string, valid: (value: unknown) => value is T): { value: T, path: string, mtimeMs: number }[] {
    const result: { value: T, path: string, mtimeMs: number }[] = []
    for (const name of this.fs.list(join(this.root, directory))) {
      if (!name.endsWith('.json'))
        continue
      const path = join(this.root, directory, name)
      try {
        const value = this.readJson(path)
        const { mtimeMs } = this.fs.stat(path)
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
    const path = join(this.root, 'broker.lock')
    const current = this.readOwner(path)
    if (current) {
      if (this.alive(current.pid) && this.sameProcess(current.pid, current.startedAt))
        throw new StoreBusyError('lock-busy', current, this.now())
      if (!this.retireLock(current))
        throw new StoreBusyError('lock-busy')
    }
    else {
      try {
        if (this.now() - this.fs.stat(path).mtimeMs <= 10_000 || !this.retireLock(undefined))
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
      return token
    }
    catch (error) {
      if (code(error) === 'ENOENT') {
        this.prepare()
        throw new StoreBusyError('lock-busy')
      }
      if (['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EBUSY'].includes(String(code(error))))
        throw new StoreBusyError('lock-busy')
      throw error
    }
    finally {
      this.fs.remove(temporary)
    }
  }

  private cleanTemporaryLocks(): void {
    for (const name of this.fs.list(this.root)) {
      if (!/^broker\.lock\..+\.tmp$/.test(name))
        continue
      const path = join(this.root, name)
      const current = this.readOwner(path)
      try {
        if (current
          ? !this.alive(current.pid) || !this.sameProcess(current.pid, current.startedAt)
          : this.now() - this.fs.stat(path).mtimeMs > 10_000) {
          this.fs.remove(path)
        }
      }
      catch (error) {
        if (code(error) !== 'ENOENT')
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
      throw error
    }
    if (this.readOwner(tomb)?.token !== expected?.token) {
      this.rename(tomb, path)
      return false
    }
    this.fs.remove(tomb)
    return true
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
      throw error
    }
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

  private rename(from: string, to: string, checkOwnership = false): void {
    for (let attempt = 0; ; attempt++) {
      try {
        if (checkOwnership)
          this.checkToken()
        this.fs.rename(from, to)
        return
      }
      catch (error) {
        if (attempt >= 5 || !['EPERM', 'EBUSY'].includes(String(code(error))))
          throw error
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
