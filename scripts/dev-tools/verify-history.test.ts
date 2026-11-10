import type { VerifyRun } from './verify-history'

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appendVerifyRun, readVerifyStats } from './verify-history'
import { parseVerifyArgs } from './verify-plan'

const run: VerifyRun = {
  ts: 1000,
  worktree: '/work/lane',
  branch: 'luke/feat/lane',
  head: 'head',
  tree: 'tree',
  scopeBase: 'base',
  mode: 'branch',
  step: 'lint',
  status: 'pass',
  durationMs: 100,
  commands: [['lint', 'file.ts']],
  files: ['file.ts'],
  waitMs: 12,
  grant: 1,
}

describe('verify history', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-history-'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(dir, { recursive: true, force: true })
  })

  it.each(['pass', 'fail', 'cached', 'skipped'] as const)('persists a complete %s record', (status) => {
    const record = { ...run, status }
    appendVerifyRun(dir, record)
    expect(JSON.parse(readFileSync(join(dir, 'runs.jsonl'), 'utf8'))).toEqual(record)
  })

  it('rotates only above five MiB and reads both generations', () => {
    const path = join(dir, 'runs.jsonl')
    const archive = join(dir, 'runs.1.jsonl')
    const padding = ' '.repeat(5 * 1024 * 1024)
    writeFileSync(path, padding)
    appendVerifyRun(dir, run)
    expect(existsSync(archive)).toBe(false)
    const failed = { ...run, status: 'fail' as const }
    appendVerifyRun(dir, failed)
    expect(existsSync(archive)).toBe(true)
    expect(readFileSync(archive, 'utf8')).toBe(`${padding}${JSON.stringify(run)}\n`)
    expect(readFileSync(path, 'utf8')).toBe(`${JSON.stringify(failed)}\n`)
    expect(readVerifyStats(dir).steps.lint?.counts).toEqual({ pass: 1, fail: 1, cached: 0, skipped: 0 })
  })

  it('counts malformed records while retaining valid records since the cutoff', () => {
    const values = [run, { ...run, ts: 2000, status: 'fail' }, null, {}, { ...run, durationMs: -1 }, { ...run, grant: 'one' }]
    writeFileSync(join(dir, 'runs.jsonl'), `${values.map(value => JSON.stringify(value)).join('\n')}\nnot json\n`)
    const stats = readVerifyStats(dir, 1500)
    expect(stats.malformed).toBe(5)
    expect(stats.steps.lint?.counts).toEqual({ pass: 0, fail: 1, cached: 0, skipped: 0 })
  })

  it('summarizes statuses, executed durations, modes and the five slowest runs', () => {
    const rows: VerifyRun[] = [
      ...[10, 20, 30, 40, 50, 60].map((durationMs, index) => ({
        ...run,
        durationMs,
        worktree: `/work/${index}`,
        branch: `branch-${index}`,
      })),
      { ...run, durationMs: 100, status: 'fail', mode: 'incremental' },
      { ...run, durationMs: 0, status: 'cached', mode: 'incremental' },
      { ...run, durationMs: 0, status: 'skipped', step: 'typecheck' },
    ]
    writeFileSync(join(dir, 'runs.jsonl'), `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
    const stats = readVerifyStats(dir)
    expect(stats.steps.lint).toEqual({
      count: 8,
      counts: { pass: 6, fail: 1, cached: 1, skipped: 0 },
      failureRate: 1 / 7,
      durationMs: { median: 40, p90: 100 },
    })
    expect(stats.modes.branch).toEqual({
      count: 7,
      counts: { pass: 6, fail: 0, cached: 0, skipped: 1 },
      failureRate: 0,
      durationMs: { median: 35, p90: 60 },
    })
    expect(stats.modes.incremental?.counts).toEqual({ pass: 0, fail: 1, cached: 1, skipped: 0 })
    expect(stats.slowest.map(row => [row.durationMs, row.worktree, row.branch])).toEqual([
      [100, '/work/lane', 'luke/feat/lane'],
      [60, '/work/5', 'branch-5'],
      [50, '/work/4', 'branch-4'],
      [40, '/work/3', 'branch-3'],
      [30, '/work/2', 'branch-2'],
    ])
  })

  it('returns an empty summary for missing history', () => {
    expect(readVerifyStats(dir)).toEqual({ malformed: 0, steps: {}, modes: {}, slowest: [] })
  })

  it('warns about an unwritable history without changing the verification result', () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
    const path = join(dir, 'file')
    writeFileSync(path, '')
    expect(() => appendVerifyRun(path, run)).not.toThrow()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('verify: history write failed'))
  })
})

describe('verify stats arguments', () => {
  it('accepts statistics with a duration and JSON output in any order', () => {
    expect(parseVerifyArgs(['--json', '--since', '2h', '--stats'])).toMatchObject({
      ok: true,
      args: { stats: { sinceMs: 7_200_000, json: true } },
    })
    expect(parseVerifyArgs(['--stats'])).toMatchObject({ ok: true, args: { stats: { sinceMs: 0, json: false } } })
  })

  it.each([
    ['--stats', '--since', '0s'],
    ['--stats', '--since', 'wat'],
    ['--stats', '--since'],
    ['--stats', '--since', '999999999999999999999d'],
    ['--json'],
    ['--since', '1h'],
    ['--stats', '--force'],
    ['--stats', '--only', 'lint'],
  ])('rejects invalid or mixed stats options: %s', (...argv) => {
    expect(parseVerifyArgs(argv).ok).toBe(false)
  })
})
