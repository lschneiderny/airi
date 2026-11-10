import type { VerifyScope, VerifyStep } from './verify-plan'

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface VerifyStatsOptions {
  sinceMs: number
  json: boolean
}

export function parseStatsArgs(argv: string[]): { ok: true, stats: VerifyStatsOptions } | { ok: false, message: string } {
  const stats = { sinceMs: 0, json: false }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--stats')
      continue
    if (flag === '--json') {
      stats.json = true
      continue
    }
    if (flag === '--since') {
      const value = argv[++index] ?? ''
      const match = /^(\d+)(ms|[smhd])$/.exec(value)
      const units: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }
      const duration = match ? Number(match[1]) * units[match[2]] : 0
      if (!Number.isSafeInteger(duration) || duration <= 0)
        return { ok: false, message: `Invalid --since duration: ${value}` }
      stats.sinceMs = duration
      continue
    }
    return { ok: false, message: `Unknown statistics argument ${JSON.stringify(flag)}` }
  }
  return { ok: true, stats }
}

export interface VerifyRun {
  readonly ts: number
  readonly worktree: string
  readonly branch: string | null
  readonly head: string
  readonly tree: string
  readonly scopeBase: string
  readonly mode: VerifyScope['mode']
  readonly step: VerifyStep
  readonly status: 'pass' | 'fail' | 'cached' | 'skipped'
  readonly durationMs: number
  readonly commands: string[][]
  readonly files: string[]
  readonly waitMs: number
  readonly grant: number | null
}

function missing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Telemetry is separate from pass records and must never change a check's outcome. */
export function appendVerifyRun(dir: string, record: VerifyRun): void {
  try {
    mkdirSync(dir, { recursive: true })
    const path = join(dir, 'runs.jsonl')
    try {
      if (statSync(path).size > 5 * 1024 * 1024)
        renameSync(path, join(dir, 'runs.1.jsonl'))
    }
    catch (error) {
      if (!missing(error))
        throw error
    }
    appendFileSync(path, `${JSON.stringify(record)}\n`)
  }
  catch (error) {
    console.error(`verify: history write failed (${String(error)})`)
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Parse the JSONL boundary once; malformed lines never participate in statistics. */
function isRun(value: unknown): value is VerifyRun {
  return object(value)
    && nonnegative(value.ts) && nonnegative(value.durationMs) && nonnegative(value.waitMs)
    && (value.grant === null || (nonnegative(value.grant) && Number.isInteger(value.grant)))
    && ['worktree', 'head', 'tree', 'scopeBase'].every(key => typeof value[key] === 'string')
    && (value.branch === null || typeof value.branch === 'string')
    && (value.mode === 'branch' || value.mode === 'incremental')
    && (value.step === 'typecheck' || value.step === 'lint' || value.step === 'test')
    && (value.status === 'pass' || value.status === 'fail' || value.status === 'cached' || value.status === 'skipped')
    && strings(value.files) && Array.isArray(value.commands) && value.commands.every(strings)
}

function summarize(runs: VerifyRun[]) {
  const counts = { pass: 0, fail: 0, cached: 0, skipped: 0 }
  for (const run of runs)
    counts[run.status]++
  const durations = runs.filter(run => run.status === 'pass' || run.status === 'fail').map(run => run.durationMs).sort((a, b) => a - b)
  const middle = Math.floor(durations.length / 2)
  return {
    count: runs.length,
    counts,
    failureRate: counts.fail / (counts.pass + counts.fail || 1),
    durationMs: {
      median: durations.length === 0 ? 0 : durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2,
      p90: durations.length === 0 ? 0 : durations[Math.ceil(durations.length * 0.9) - 1],
    },
  }
}

export interface VerifyStats {
  malformed: number
  steps: Partial<Record<VerifyStep, ReturnType<typeof summarize>>>
  modes: Partial<Record<VerifyScope['mode'], ReturnType<typeof summarize>>>
  slowest: VerifyRun[]
}

export function readVerifyStats(dir: string, since = 0): VerifyStats {
  const runs: VerifyRun[] = []
  let malformed = 0
  for (const name of ['runs.1.jsonl', 'runs.jsonl']) {
    let text: string
    try {
      text = readFileSync(join(dir, name), 'utf8')
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
      if (!isRun(value))
        malformed++
      else if (value.ts >= since)
        runs.push(value)
    }
  }
  const stats: VerifyStats = { malformed, steps: {}, modes: {}, slowest: [] }
  for (const step of ['typecheck', 'lint', 'test'] as const) {
    const selected = runs.filter(run => run.step === step)
    if (selected.length)
      stats.steps[step] = summarize(selected)
  }
  for (const mode of ['branch', 'incremental'] as const) {
    const selected = runs.filter(run => run.mode === mode)
    if (selected.length)
      stats.modes[mode] = summarize(selected)
  }
  stats.slowest = runs.filter(run => run.status === 'pass' || run.status === 'fail').sort((a, b) => b.durationMs - a.durationMs).slice(0, 5)
  return stats
}

export function formatVerifyStats(stats: VerifyStats): string {
  const lines = [`verify history (malformed: ${stats.malformed})`]
  for (const [group, entries] of Object.entries({ step: stats.steps, mode: stats.modes })) {
    for (const [name, summary] of Object.entries(entries)) {
      lines.push(`${group} ${name}: count ${summary.count}, pass ${summary.counts.pass}, fail ${summary.counts.fail}, cached ${summary.counts.cached}, skipped ${summary.counts.skipped}, failure ${(summary.failureRate * 100).toFixed(1)}%, duration median ${summary.durationMs.median}ms, p90 ${summary.durationMs.p90}ms`)
    }
  }
  lines.push('slowest five runs:')
  for (const run of stats.slowest)
    lines.push(`  ${run.durationMs}ms ${run.step} ${run.status} ${run.mode} ${run.worktree} (${run.branch ?? 'detached HEAD'})`)
  return lines.join('\n')
}
