import type { CpuClass } from './classes'
import type { Decision } from './grant'
import type { StoreRequest } from './store'

import process from 'node:process'

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { classes } from './classes'

type WaitReason = Extract<Decision, { kind: 'wait' }>['reason'] | 'queue-ahead' | 'lock-busy' | 'lock-lost' | 'entry-busy' | 'snapshot-failed'

export interface HistoryEvent {
  ts: number
  event: 'ticket' | 'wait' | 'grant' | 'release' | 'abort' | 'unreadable'
  id: string
  seq: number | null
  class: CpuClass
  min: number
  max: number
  slots: number
  budget: number
  heldBefore: number | null
  queueAhead: number | null
  waitMs: number
  heldMs: number
  lastWaitReason: WaitReason | null
  pid: number
  cwd: string
  command: string
}

export function historyRoot(): string {
  return resolve(process.env.AIRI_CPU_SLOTS_HISTORY_DIR
    ?? (process.platform === 'win32'
      ? join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'airi-cpu-slots', 'history')
      : join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'airi-cpu-slots')))
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Best-effort telemetry must never strand a committed lease or interrupt its release. */
export function appendHistory(event: HistoryEvent): void {
  try {
    const root = historyRoot()
    mkdirSync(root, { recursive: true })
    const path = join(root, 'events.jsonl')
    try {
      if (statSync(path).size > 5 * 1024 * 1024)
        renameSync(path, join(root, 'events.1.jsonl'))
    }
    catch (error) {
      if (!missing(error))
        throw error
    }
    appendFileSync(path, `${JSON.stringify(event)}\n`)
  }
  catch (error) {
    console.error(`cpu-slots: history write failed (${String(error)})`)
  }
}

/** One acquisition's event context; callers observe under the lock and append only after it returns. */
export class LeaseHistory {
  private readonly startedAt = Date.now()
  private grantedAt: number | undefined
  private ticketSeq: number | null = null
  private ticketRecorded: number | null = null
  private waited = false
  private slots = 0
  private heldBefore: number | null = null
  private queueAhead: number | null = null
  private lastWaitReason: WaitReason | null = null
  waitMs = 0

  constructor(private readonly request: StoreRequest, private readonly id: string, private readonly budget: number) {}

  get seq(): number | undefined {
    return this.ticketSeq ?? undefined
  }

  observe(seq: number, heldBefore: number, queueAhead: number, reason: WaitReason | null): void {
    this.ticketSeq = seq
    this.heldBefore = heldBefore
    this.queueAhead = queueAhead
    if (reason)
      this.lastWaitReason = reason
  }

  ticket(): void {
    if (this.ticketRecorded !== this.ticketSeq) {
      this.ticketRecorded = this.ticketSeq
      this.record('ticket')
    }
  }

  wait(reason?: WaitReason): void {
    if (reason)
      this.lastWaitReason = reason
    if (!this.waited) {
      this.waited = true
      this.record('wait')
    }
  }

  grant(slots: number): void {
    this.slots = slots
    this.grantedAt = Date.now()
    this.waitMs = this.grantedAt - this.startedAt
    this.record('grant')
  }

  record(event: HistoryEvent['event']): void {
    const ts = Date.now()
    appendHistory({
      ts,
      event,
      id: this.id,
      seq: this.ticketSeq,
      class: this.request.class,
      min: Math.min(this.request.min ?? classes[this.request.class].min, this.budget),
      max: Math.min(this.request.max ?? classes[this.request.class].max, this.budget),
      slots: this.slots,
      budget: this.budget,
      heldBefore: this.heldBefore,
      queueAhead: this.queueAhead,
      waitMs: this.grantedAt === undefined ? ts - this.startedAt : this.waitMs,
      heldMs: this.grantedAt === undefined ? 0 : ts - this.grantedAt,
      lastWaitReason: this.lastWaitReason,
      pid: process.pid,
      cwd: this.request.cwd,
      command: this.request.command,
    })
  }
}

/** A positive duration with an explicit unit, in milliseconds. */
export function parseSince(input: string): number {
  const match = /^(\d+)(ms|[smhd])$/.exec(input)
  const units: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  const duration = match ? Number(match[1]) * units[match[2]] : 0
  if (!Number.isSafeInteger(duration) || duration <= 0)
    throw new Error(`bad duration: ${input}`)
  return duration
}

function isEvent(value: unknown): value is HistoryEvent {
  if (typeof value !== 'object' || value === null)
    return false
  const row = value as Record<string, unknown>
  return ['ticket', 'wait', 'grant', 'release', 'abort', 'unreadable'].includes(String(row.event))
    && typeof row.class === 'string' && Object.hasOwn(classes, row.class)
    && ['id', 'cwd', 'command'].every(key => typeof row[key] === 'string')
    && ['ts', 'min', 'max', 'slots', 'budget', 'waitMs', 'heldMs', 'pid'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key]))
    && ['seq', 'heldBefore', 'queueAhead'].every(key => row[key] === null || (typeof row[key] === 'number' && Number.isFinite(row[key])))
    && (row.lastWaitReason === null || ['queue-empty', 'over-budget', 'exclusive-held', 'leases-held', 'insufficient-slots', 'head-aging', 'queue-ahead', 'lock-busy', 'lock-lost', 'entry-busy', 'snapshot-failed'].includes(String(row.lastWaitReason)))
}

function distribution(values: number[]): { median: number, p90: number } {
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return {
    median: values.length === 0 ? 0 : values.length % 2 ? values[middle] : (values[middle - 1] + values[middle]) / 2,
    p90: values.length === 0 ? 0 : values[Math.ceil(values.length * 0.9) - 1],
  }
}

export function readHistory(since = 0): {
  malformed: number
  classes: Partial<Record<CpuClass, { count: number, waitMs: ReturnType<typeof distribution>, heldMs: ReturnType<typeof distribution> }>>
  topWaits: HistoryEvent[]
} {
  const events: HistoryEvent[] = []
  let malformed = 0
  for (const name of ['events.1.jsonl', 'events.jsonl']) {
    let text: string
    try {
      text = readFileSync(join(historyRoot(), name), 'utf8')
    }
    catch (error) {
      if (missing(error))
        continue
      throw error
    }
    for (const line of text.split('\n').filter(line => line.trim())) {
      let value: unknown
      try {
        value = JSON.parse(line)
      }
      catch (error) {
        if (!(error instanceof SyntaxError))
          throw error
      }
      if (!isEvent(value))
        malformed++
      else if (value.ts >= since)
        events.push(value)
    }
  }
  const summary: ReturnType<typeof readHistory> = { malformed, classes: {}, topWaits: [] }
  for (const cpuClass of Object.keys(classes) as CpuClass[]) {
    const grants = events.filter(event => event.class === cpuClass && event.event === 'grant')
    const releases = events.filter(event => event.class === cpuClass && event.event === 'release')
    if (grants.length || releases.length) {
      summary.classes[cpuClass] = {
        count: grants.length,
        waitMs: distribution(grants.map(event => event.waitMs)),
        heldMs: distribution(releases.map(event => event.heldMs)),
      }
    }
  }
  summary.topWaits = events.filter(event => event.event === 'grant').sort((a, b) => b.waitMs - a.waitMs).slice(0, 5)
  return summary
}
