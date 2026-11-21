import type { VerifyRunRecord } from './verify-runs'

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createRunRecord, latestRunRecord, pruneRuns, readRunRecord, runLogPath, waitForRun, writeRunRecord } from './verify-runs'

function record(id: string, overrides: Partial<VerifyRunRecord> = {}): VerifyRunRecord {
  return { id, pid: 42, worktree: '/home/user/airi', status: 'running', startedAt: 0, finishedAt: null, exitCode: null, log: `${id}.log`, report: [], ...overrides }
}

describe('verify run records', () => {
  let cache: string

  beforeEach(() => {
    cache = mkdtempSync(join(tmpdir(), 'verify-runs-'))
  })

  afterEach(() => {
    rmSync(cache, { recursive: true, force: true })
  })

  it('creates a record only when the run has none, so a recorded end is never replaced', () => {
    expect(createRunRecord(cache, record('1-1'))).toBe(true)
    writeRunRecord(cache, record('1-1', { status: 'passed', exitCode: 0 }))

    expect(createRunRecord(cache, record('1-1'))).toBe(false)
    expect(readRunRecord(cache, '1-1')).toMatchObject({ status: 'passed', exitCode: 0 })
  })

  it('finds the newest run of the asking worktree, not of another worktree', () => {
    writeRunRecord(cache, record('100-1'))
    writeRunRecord(cache, record('900-2'))
    writeRunRecord(cache, record('1000-3', { worktree: '/home/user/airi-wt/other' }))
    expect(latestRunRecord(cache, '/home/user/airi')?.id).toBe('900-2')
  })

  it('keeps the newest runs and removes older records with their logs', () => {
    for (const id of ['1-1', '2-1', '10-1']) {
      writeRunRecord(cache, record(id))
      writeFileSync(runLogPath(cache, id), 'output\n')
    }
    pruneRuns(cache, 2)
    expect(readRunRecord(cache, '1-1')).toBeNull()
    expect(existsSync(runLogPath(cache, '1-1'))).toBe(false)
    expect(readRunRecord(cache, '2-1')).not.toBeNull()
    expect(readRunRecord(cache, '10-1')).not.toBeNull()
  })

  it('returns a run\'s end as soon as it is recorded', async () => {
    writeRunRecord(cache, record('1-1'))
    let polls = 0
    const outcome = await waitForRun(cache, '1-1', {
      timeoutMs: 60_000,
      alive: () => true,
      sleep: async () => {
        if (++polls === 3)
          writeRunRecord(cache, record('1-1', { status: 'failed', exitCode: 1, report: ['test failed'] }))
      },
    })
    expect(outcome).toMatchObject({ kind: 'finished', record: { exitCode: 1, report: ['test failed'] } })
    expect(polls).toBe(3)
  })

  it('reports a run whose process died without recording an end', async () => {
    writeRunRecord(cache, record('1-1'))
    expect(await waitForRun(cache, '1-1', { timeoutMs: 60_000, alive: () => false })).toMatchObject({ kind: 'lost' })
  })

  it('stops at the timeout while the run is still going', async () => {
    writeRunRecord(cache, record('1-1'))
    let clock = 0
    const outcome = await waitForRun(cache, '1-1', {
      timeoutMs: 5_000,
      alive: () => true,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
    })
    expect(outcome.kind).toBe('running')
    expect(clock).toBe(5_000)
  })

  it('reports an unknown run id', async () => {
    expect(await waitForRun(cache, '7-7', { timeoutMs: 0 })).toEqual({ kind: 'missing' })
  })
})
