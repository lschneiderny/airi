import type { CpuClass } from './classes'
import type { StoredLease, StoreRequest, Ticket } from './store'

import process from 'node:process'

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
  env: Partial<Record<'AIRI_CPU_LEASE' | 'AIRI_CPU_GRANT' | 'AIRI_CPU_CLASS', string>>
  addWorkload: (pid: number) => void
  release: () => void
}

const held = new Map<string, Lease>()

export function storeRoot(): string {
  return resolve(process.env.AIRI_CPU_SLOTS_DIR
    ?? join(process.platform === 'win32' ? process.env.LOCALAPPDATA ?? tmpdir() : tmpdir(), 'airi-cpu-slots'))
}

/** Synchronous callers (exit handlers) cannot wait for the next poll, so they retry a busy lock briefly. */
function whileBusy<T>(fn: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return fn()
    }
    catch (error) {
      if (!(error instanceof StoreBusyError) || attempt >= 200)
        throw error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
    }
  }
}

function noop(): Lease {
  return { id: '', grant: null, exclusive: false, inherited: false, env: {}, addWorkload() {}, release() {} }
}

function reuse(lease: Lease, request: AcquireOptions): Lease {
  if (classes[request.class].exclusive && !lease.exclusive)
    throw new CpuSlotsError('exclusive-under-shared')
  const grant = Math.min(request.max ?? classes[request.class].max, lease.grant!)
  return { ...lease, grant, inherited: true, env: { ...lease.env, AIRI_CPU_GRANT: String(grant) } }
}

function owned(store: Store, record: StoredLease): Lease {
  const heartbeat = setInterval(() => {
    try {
      store.heartbeat(record)
    }
    catch (error) {
      console.error(`cpu-slots: heartbeat failed (${String(error)})`)
    }
  }, 10_000)
  heartbeat.unref()
  let released = false
  const release = (): void => {
    if (released)
      return
    // Always use the store's synchronous snapshot guard, even without registered work.
    whileBusy(() => store.releaseIfIdle(record))
    released = true
    clearInterval(heartbeat)
    held.delete(store.root)
    // eslint-disable-next-line ts/no-use-before-define -- mutual reference resolved before it runs
    process.removeListener('exit', onExit)
  }
  const onExit = (): void => {
    try {
      release()
    }
    catch {
      // A failed snapshot or busy lock cannot prove idleness. Leave pruning to an observer.
    }
  }
  const lease: Lease = {
    id: record.id,
    grant: record.slots,
    exclusive: record.exclusive,
    inherited: false,
    env: { AIRI_CPU_LEASE: record.id, AIRI_CPU_GRANT: String(record.slots), AIRI_CPU_CLASS: record.class },
    addWorkload: pid => whileBusy(() => store.addWorkload(record, pid)),
    release,
  }
  held.set(store.root, lease)
  process.on('exit', onExit)
  return lease
}

/** Poll timers keep queued callers alive; only an acquired lease has an unreferenced heartbeat. */
export async function acquire(request: AcquireOptions): Promise<Lease> {
  if (!Object.hasOwn(classes, request.class))
    throw new Error('bad-class')
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
  if (current)
    return reuse(current, request)
  const store = new Store({ root, budget })
  let ticket: Ticket | undefined
  let waiting = false
  let inheritedChecked = false
  return new Promise<Lease>((resolveLease, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (): void => {
      clearTimeout(timer)
      // eslint-disable-next-line ts/no-use-before-define -- mutual reference resolved before it runs
      request.signal?.removeEventListener('abort', onAbort)
    }
    const tick = (): void => {
      try {
        if (request.signal?.aborted) {
          if (ticket)
            store.removeTicket(ticket.seq)
          finish()
          reject(request.signal.reason ?? new Error('cancelled'))
          return
        }
        const result = store.transact(() => {
          if (!inheritedChecked) {
            const parent = store.snapshot().leases.find(lease => lease.id === process.env.AIRI_CPU_LEASE)
            inheritedChecked = true
            if (parent) {
              const advertised = Number(process.env.AIRI_CPU_GRANT)
              const grant = Number.isSafeInteger(advertised) && advertised > 0 ? Math.min(advertised, parent.slots) : parent.slots
              return reuse({
                id: parent.id,
                grant,
                exclusive: parent.exclusive,
                inherited: true,
                env: { AIRI_CPU_LEASE: parent.id, AIRI_CPU_GRANT: String(grant), AIRI_CPU_CLASS: parent.class },
                addWorkload: pid => store.addWorkload(parent, pid),
                release() {},
              }, request)
            }
          }
          if (!ticket || !store.touchTicket(ticket.seq))
            ticket = store.enqueue(request)
          const state = store.snapshot()
          const decision = decide(state, budget)
          if (decision.kind === 'grant' && decision.ticketSeq === ticket.seq) {
            const record = store.grant(ticket.seq, decision.slots)
            if (record)
              return owned(store, record)
          }
          if (!waiting) {
            console.error(`cpu-slots: waiting for ${Math.min(min, budget)} slot(s) of ${request.class} (held ${state.leases.reduce((sum, lease) => sum + lease.slots, 0)}/${budget}, ${state.tickets.filter(other => other.seq < ticket!.seq).length} ahead)`)
            waiting = true
          }
        })
        if (result) {
          finish()
          console.error(`cpu-slots: granted ${result.grant} (${request.class})`)
          resolveLease(result)
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
        if (!waiting) {
          console.error(`cpu-slots: waiting for ${Math.min(min, budget)} slot(s) of ${request.class} (held ?/${budget}, ? ahead; ${error.message})`)
          waiting = true
        }
      }
      timer = setTimeout(tick, 500)
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
