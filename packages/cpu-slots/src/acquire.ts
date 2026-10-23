import type { CpuClass } from './classes'
import type { StoredLease, StoreRequest, Ticket } from './store'

import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { parseBudget } from './budget'
import { classes } from './classes'
import { CpuSlotsError } from './errors'
import { decide } from './grant'
import { Store, StoreBusyError } from './store'

export interface AcquireOptions extends StoreRequest {
  signal?: AbortSignal
}

export interface Lease {
  id: string
  grant: number | null
  exclusive: boolean
  inherited: boolean
  /** Ticket sequence of an acquired lease, which fixes the grant order. */
  seq?: number
  env: Partial<Record<'AIRI_CPU_LEASE' | 'AIRI_CPU_GRANT' | 'AIRI_CPU_CLASS', string>>
  addWorkload: (pid: number) => void
  release: () => void
}

/**
 * Process-wide state, shared by every copy of this module in the process: Vite bundles each config
 * file separately, so module-level variables would give each config file its own state.
 */
export interface ProcessState {
  /** The in-process lease per store; reuse is reference counted so only the last release frees it. */
  held: Map<string, { lease: Lease, retain: () => Lease }>
  /** The worker grant chosen by the first wrapped vitest config in this process. */
  vitestGrant?: number
}

export function processState(): ProcessState {
  const registry = globalThis as typeof globalThis & Record<symbol, ProcessState | undefined>
  return registry[Symbol.for('@proj-airi/cpu-slots')] ??= { held: new Map() }
}

const held = processState().held

export function storeRoot(): string {
  return resolve(process.env.AIRI_CPU_SLOTS_DIR
    ?? join(process.platform === 'win32' ? process.env.LOCALAPPDATA ?? tmpdir() : tmpdir(), 'airi-cpu-slots'))
}

/**
 * Longest all exit handlers together may block on a busy store lock; pruning reclaims anything left
 * behind. A store call already running at the deadline (a process snapshot takes about 0.5 s on
 * win32) still finishes, for about 2.5 s in total.
 */
const EXIT_BUSY_BUDGET_MS = 2_000
let exitDeadline: number | undefined

/**
 * Runs one exit step against the deadline every exit handler shares, fixed when the first of them
 * runs. Once it has passed, later steps are skipped and left to pruning.
 */
function beforeExitDeadline(step: (deadline: number) => void): void {
  exitDeadline ??= Date.now() + EXIT_BUSY_BUDGET_MS
  if (Date.now() < exitDeadline)
    step(exitDeadline)
}

/** Synchronous callers cannot wait for another poll, so they retry a busy lock until the deadline. */
export function whileBusy<T>(fn: () => T, deadline: number): T {
  for (;;) {
    try {
      return fn()
    }
    catch (error) {
      if (!(error instanceof StoreBusyError) || Date.now() >= deadline)
        throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
}

const activeWriters = new Set<Writer>()
/** Stores that held a lease in this process; exit writes their unwritten retirement markers. */
const leaseStores = new Set<Store>()
/** The exit cleanup of each lease this module copy owns and has not freed. */
const leaseExits = new Set<() => void>()
let exitHooked = false

/** The exit handlers of every copy of this module, run by one process `exit` listener. */
const exitHandlersKey = Symbol.for('@proj-airi/cpu-slots/exit-handlers')

function runExitHandlers(): void {
  for (const onExit of leaseExits)
    onExit()
  for (const writer of activeWriters) {
    try {
      beforeExitDeadline(deadline => writer.flush(deadline))
    }
    catch {
      // A busy lock at exit leaves the write to pruning by the next observer.
    }
  }
  for (const store of leaseStores)
    store.retryRetirements()
}

/**
 * Adds this module copy's exit handlers to the one process `exit` listener, which the first copy
 * registers. Leases share it, and so do the copies Vite bundles per config file, so holding many
 * leases never adds a listener per lease (that tripped MaxListenersExceededWarning).
 */
function hookExit(): void {
  if (exitHooked)
    return
  exitHooked = true
  const registry = globalThis as typeof globalThis & Record<symbol, Set<() => void> | undefined>
  let handlers = registry[exitHandlersKey]
  if (!handlers) {
    const created = new Set<() => void>()
    handlers = registry[exitHandlersKey] = created
    process.on('exit', () => {
      for (const handler of created)
        handler()
    })
  }
  handlers.add(runExitHandlers)
}

/** How long one store entry may stay unreadable before the waiting line names it, and before acquire gives up. */
const ENTRY_BUSY_REPORT_MS = 30_000
const ENTRY_BUSY_LIMIT_MS = 300_000

/**
 * Store writes after acquisition (workload registration, release) run in order. A busy lock is
 * retried on a referenced timer, so a pending write keeps the process alive without blocking its
 * event loop. Owned and inherited leases share it.
 */
class Writer {
  private readonly pending: { run: () => void, attempts: number }[] = []
  private retry: ReturnType<typeof setTimeout> | undefined

  submit(run: () => void): void {
    this.pending.push({ run, attempts: 0 })
    activeWriters.add(this)
    hookExit()
    if (!this.retry)
      this.pump()
  }

  /** Drains synchronously for an exit handler; throws if the lock stays busy past the deadline. */
  flush(deadline: number): void {
    clearTimeout(this.retry)
    this.retry = undefined
    for (const op of this.pending.splice(0))
      whileBusy(op.run, deadline)
    activeWriters.delete(this)
  }

  private readonly pump = (): void => {
    this.retry = undefined
    while (this.pending.length) {
      const op = this.pending[0]
      try {
        op.run()
        this.pending.shift()
      }
      catch (error) {
        if (error instanceof StoreBusyError && ++op.attempts < 200) {
          this.retry = setTimeout(this.pump, 25)
          return
        }
        this.pending.shift()
        console.error(`cpu-slots: store write failed (${String(error)})`)
      }
    }
    activeWriters.delete(this)
  }
}

/** A busy lock retries the write; the OS start-time lookup (a PowerShell spawn on win32) runs once. */
function registration(store: Store, lease: StoredLease, pid: number): () => void {
  let startedAt: number | undefined
  return () => store.addWorkload(lease, pid, startedAt ??= store.workloadStartedAt(pid))
}

function noop(): Lease {
  return { id: '', grant: null, exclusive: false, inherited: false, env: {}, addWorkload() {}, release() {} }
}

function reuse(lease: Lease, request: AcquireOptions): Lease {
  const grant = Math.min(request.max ?? classes[request.class].max, lease.grant!)
  return { ...lease, grant, inherited: true, env: { ...lease.env, AIRI_CPU_GRANT: String(grant) } }
}

function assertShareable(lease: Lease, request: AcquireOptions): void {
  if (classes[request.class].exclusive && !lease.exclusive)
    throw new CpuSlotsError('exclusive-under-shared')
}

function owned(store: Store, record: StoredLease, seq: number): Lease {
  leaseStores.add(store)
  const heartbeat = setInterval(() => {
    try {
      store.heartbeat(record)
    }
    catch (error) {
      console.error(`cpu-slots: heartbeat failed (${String(error)})`)
    }
  }, 10_000)
  heartbeat.unref()

  const writer = new Writer()
  let released = false
  const free = (): void => {
    released = true
    clearInterval(heartbeat)
    held.delete(store.root)
    // eslint-disable-next-line ts/no-use-before-define -- mutual reference resolved before it runs
    leaseExits.delete(onExit)
    // Always use the store's snapshot guard, even without registered work. A store whose markers are
    // all written needs no retry at exit.
    writer.submit(() => {
      store.releaseIfIdle(record)
      if (store.retryRetirements())
        leaseStores.delete(store)
    })
  }
  let refs = 1
  const handle = (): Lease => {
    let done = false
    return {
      id: record.id,
      grant: record.slots,
      exclusive: record.exclusive,
      inherited: false,
      seq,
      env: { AIRI_CPU_LEASE: record.id, AIRI_CPU_GRANT: String(record.slots), AIRI_CPU_CLASS: record.class },
      addWorkload: pid => writer.submit(registration(store, record, pid)),
      release() {
        if (done)
          return
        done = true
        if (--refs === 0)
          free()
      },
    }
  }
  const onExit = (): void => {
    try {
      beforeExitDeadline(deadline => writer.flush(deadline))
      if (!released)
        beforeExitDeadline(deadline => whileBusy(() => store.releaseIfIdle(record), deadline))
    }
    catch {
      // A failed snapshot or busy lock cannot prove idleness. Leave pruning to an observer.
    }
    store.retryRetirements()
  }
  const lease = handle()
  held.set(store.root, {
    lease,
    retain() {
      refs++
      return handle()
    },
  })
  leaseExits.add(onExit)
  hookExit()
  return lease
}

/** Poll timers keep queued callers alive; only an acquired lease has an unreferenced heartbeat. */
export async function acquire(request: AcquireOptions): Promise<Lease> {
  if (!Object.hasOwn(classes, request.class))
    throw new Error('bad-class')
  // A ticket the store cannot read is never granted, so reject before writing one.
  if (typeof request.command !== 'string' || !request.command)
    throw new Error('bad-command')
  if (typeof request.cwd !== 'string' || !request.cwd)
    throw new Error('bad-cwd')
  const defaults = classes[request.class]
  const min = request.min ?? defaults.min
  const max = request.max ?? defaults.max
  if ((request.min !== undefined && (!Number.isSafeInteger(min) || min < 1))
    || (request.max !== undefined && (!Number.isSafeInteger(max) || max < 1)) || min > max) {
    throw new Error('bad-range')
  }
  if (process.env.CI || process.env.AIRI_CPU_SLOTS === 'off')
    return noop()
  const budget = parseBudget()
  const root = storeRoot()
  const current = held.get(root)
  if (current) {
    assertShareable(current.lease, request)
    return reuse(current.retain(), request)
  }
  const store = new Store({ root, budget })
  // One id for the whole call: every ticket it queues and the lease it is granted carry it, so a retry
  // finds what an earlier, failed transaction of this call already committed.
  const id = randomUUID()
  let ticket: Ticket | undefined
  let waiting = false
  let inheritedChecked = false
  /** The store entry that has stayed unreadable on every poll since `since`. */
  let unreadable: { path: string, since: number, reported: boolean } | undefined
  return new Promise<Lease>((resolveLease, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      clearTimeout(timer)
      // eslint-disable-next-line ts/no-use-before-define -- mutual reference resolved before it runs
      request.signal?.removeEventListener('abort', onAbort)
    }
    const tick = (): void => {
      // A busy lock is brief, so it is retried sooner than the regular poll.
      let delay = 500
      // A process capture the transaction asked for is taken after its lock; the next poll uses it at once.
      const captures = store.captureCount
      try {
        if (request.signal?.aborted) {
          store.withdraw(id)
          finish()
          reject(request.signal.reason ?? new Error('cancelled'))
          return
        }
        const result = store.transact((): Lease | { record: StoredLease, seq: number } | undefined => {
          if (!inheritedChecked) {
            const parent = store.snapshot().leases.find(lease => lease.id === process.env.AIRI_CPU_LEASE)
            if (parent) {
              const advertised = Number(process.env.AIRI_CPU_GRANT)
              const grant = Number.isSafeInteger(advertised) && advertised > 0 ? Math.min(advertised, parent.slots) : parent.slots
              const writer = new Writer()
              const inherited: Lease = {
                id: parent.id,
                grant,
                exclusive: parent.exclusive,
                inherited: true,
                env: { AIRI_CPU_LEASE: parent.id, AIRI_CPU_GRANT: String(grant), AIRI_CPU_CLASS: parent.class },
                addWorkload: pid => writer.submit(registration(store, parent, pid)),
                release() {},
              }
              assertShareable(inherited, request)
              return reuse(inherited, request)
            }
          }
          // Adopt this call's lease before touching or queueing a ticket. A transaction can report busy
          // after its grant committed, even between grant()'s own steps, which no rule in transact()
          // can classify; a new ticket would then wait on that lease forever. The id finds it every time.
          const adopted = ticket && store.adopt(id)
          if (adopted)
            return { record: adopted, seq: ticket!.seq }
          if (!ticket || !store.touchTicket(ticket.seq, id))
            ticket = store.enqueue(request, id)
          const state = store.snapshot()
          const decision = decide(state, budget)
          if (decision.kind === 'grant' && decision.ticketSeq === ticket.seq) {
            const record = store.grant(ticket.seq, decision.slots, id)
            if (record)
              return { record, seq: ticket.seq }
          }
          if (!waiting) {
            console.error(`cpu-slots: waiting for ${Math.min(min, budget)} slot(s) of ${request.class} (held ${state.leases.reduce((sum, lease) => sum + lease.slots, 0)}/${budget}, ${state.tickets.filter(other => other.seq < ticket!.seq).length} ahead)`)
            waiting = true
          }
        })
        // Only a committed transaction settles the inheritance check; a busy one repeats it.
        inheritedChecked = true
        unreadable = undefined
        if (store.captureCount !== captures)
          delay = 50
        if (result) {
          // Registration (heartbeat, exit hook) happens once the transaction has committed, so a
          // retried transaction never registers the same lease twice.
          const lease = 'record' in result ? owned(store, result.record, result.seq) : result
          finish()
          console.error(`cpu-slots: granted ${lease.grant} (${request.class})`)
          resolveLease(lease)
          return
        }
      }
      catch (error) {
        if (!(error instanceof StoreBusyError)) {
          finish()
          const code = error instanceof Error && 'code' in error ? error.code : undefined
          if (['EROFS', 'EACCES', 'ENOENT', 'ENOTDIR'].includes(String(code))) {
            console.error(`cpu-slots: store unavailable (${code}), running unbrokered`)
            resolveLease(noop())
          }
          else {
            reject(error)
          }
          return
        }
        delay = 50
        if (!waiting) {
          console.error(`cpu-slots: waiting for ${Math.min(min, budget)} slot(s) of ${request.class} (held ?/${budget}, ? ahead; ${error.message})`)
          waiting = true
        }
        if (error.reason === 'entry-busy' && error.path) {
          const now = Date.now()
          if (unreadable?.path !== error.path)
            unreadable = { path: error.path, since: now, reported: false }
          const elapsed = now - unreadable.since
          if (elapsed >= ENTRY_BUSY_LIMIT_MS) {
            // The ticket is left behind: the store cannot be written, and pruning drops it 45 s after its last touch.
            finish()
            reject(new CpuSlotsError('entry-unreadable', unreadable.path))
            return
          }
          if (elapsed >= ENTRY_BUSY_REPORT_MS && !unreadable.reported) {
            unreadable.reported = true
            const holder = error.owner ? `; lock last held by pid ${error.owner.pid}` : ''
            console.error(`cpu-slots: waiting for ${Math.min(min, budget)} slot(s) of ${request.class} (${unreadable.path} busy for ${Math.floor(elapsed / 1_000)}s${holder})`)
          }
        }
        else {
          unreadable = undefined
        }
      }
      timer = setTimeout(tick, delay)
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      tick()
    }
    request.signal?.addEventListener('abort', onAbort, { once: true })
    tick()
  })
}

export type { CpuClass }
