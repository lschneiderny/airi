import process from 'node:process'

import { linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * One verify run, written when it starts and again when it ends, so `pnpm verify --wait` can block on a run
 * that another process started. `report` holds the lines verify printed when its output was not a terminal:
 * step lines, failure tails, the summary, and follow-up checks.
 */
export interface VerifyRunRecord {
  id: string
  pid: number
  worktree: string
  status: 'running' | 'passed' | 'failed'
  startedAt: number
  finishedAt: number | null
  exitCode: number | null
  log: string
  report: string[]
}

/** Runs kept in `<git common dir>/airi-verify/runs/`. Older records and logs are removed when a run starts. */
export const keptRuns = 30

export function runsDir(cacheDir: string): string {
  return join(cacheDir, 'runs')
}

export function newRunId(now: number, pid: number): string {
  return `${now}-${pid}`
}

export function runLogPath(cacheDir: string, id: string): string {
  return join(runsDir(cacheDir), `${id}.log`)
}

function recordPath(cacheDir: string, id: string): string {
  return join(runsDir(cacheDir), `${id}.json`)
}

function isRecord(value: unknown): value is VerifyRunRecord {
  if (typeof value !== 'object' || value === null)
    return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string'
    && typeof record.pid === 'number'
    && typeof record.worktree === 'string'
    && (record.status === 'running' || record.status === 'passed' || record.status === 'failed')
    && typeof record.startedAt === 'number'
    && typeof record.log === 'string'
    && Array.isArray(record.report)
}

export function writeRunRecord(cacheDir: string, record: VerifyRunRecord): void {
  mkdirSync(runsDir(cacheDir), { recursive: true })
  const path = recordPath(cacheDir, record.id)
  // Write and rename, so a waiting reader never sees a half-written record.
  writeFileSync(`${path}.${process.pid}.tmp`, JSON.stringify(record))
  renameSync(`${path}.${process.pid}.tmp`, path)
}

/**
 * Writes the record only when the run has none yet, and reports whether it did. The link is atomic and never replaces
 * a file, so a record the run itself already wrote, even its end, always wins.
 */
export function createRunRecord(cacheDir: string, record: VerifyRunRecord): boolean {
  mkdirSync(runsDir(cacheDir), { recursive: true })
  const path = recordPath(cacheDir, record.id)
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(record))
  try {
    linkSync(temporary, path)
    return true
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      return false
    throw error
  }
  finally {
    rmSync(temporary, { force: true })
  }
}

export function readRunRecord(cacheDir: string, id: string): VerifyRunRecord | null {
  try {
    const value: unknown = JSON.parse(readFileSync(recordPath(cacheDir, id), 'utf8'))
    return isRecord(value) ? value : null
  }
  catch {
    return null
  }
}

function runIds(cacheDir: string): string[] {
  try {
    return readdirSync(runsDir(cacheDir))
      .filter(name => name.endsWith('.json'))
      .map(name => name.slice(0, -'.json'.length))
      .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10))
  }
  catch {
    return []
  }
}

/** The newest run that started in this worktree. */
export function latestRunRecord(cacheDir: string, worktree: string): VerifyRunRecord | null {
  for (const id of runIds(cacheDir).reverse()) {
    const record = readRunRecord(cacheDir, id)
    if (record?.worktree === worktree)
      return record
  }
  return null
}

export function pruneRuns(cacheDir: string, keep = keptRuns): void {
  const ids = runIds(cacheDir)
  for (const id of ids.slice(0, Math.max(0, ids.length - keep))) {
    rmSync(recordPath(cacheDir, id), { force: true })
    rmSync(runLogPath(cacheDir, id), { force: true })
  }
}

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

export type WaitOutcome
  = | { kind: 'finished', record: VerifyRunRecord }
    | { kind: 'running', record: VerifyRunRecord }
    | { kind: 'lost', record: VerifyRunRecord }
    | { kind: 'missing' }

export interface WaitOptions {
  timeoutMs: number
  pollMs?: number
  alive?: (pid: number) => boolean
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/** Blocks until the run records an end, its process dies without one, or the timeout passes. */
export async function waitForRun(cacheDir: string, id: string, options: WaitOptions): Promise<WaitOutcome> {
  const { timeoutMs, pollMs = 1000, alive = processAlive, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = options
  const deadline = now() + timeoutMs
  for (;;) {
    const record = readRunRecord(cacheDir, id)
    if (!record)
      return { kind: 'missing' }
    if (record.status !== 'running')
      return { kind: 'finished', record }
    if (!alive(record.pid)) {
      // The process can write its end between the read above and the liveness check.
      const last = readRunRecord(cacheDir, id)
      return last && last.status !== 'running' ? { kind: 'finished', record: last } : { kind: 'lost', record }
    }
    if (now() >= deadline)
      return { kind: 'running', record }
    await sleep(Math.min(pollMs, Math.max(0, deadline - now())))
  }
}
