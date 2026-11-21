import type { FindingOpenEvent } from './findings'

import process from 'node:process'

import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { appendTrackEvent, closeCheck, findingId, foldFindings, readTrackEvents, reproduceCommand } from './findings'

const BIN = resolve(import.meta.dirname, '../../bin/track.ts')

function openEvent(subjectSha: string): FindingOpenEvent {
  const scenario = 'mmd-idle'
  const metric = 'p95FrameMsApprox'
  const baseline = { kind: 'previous' as const, sha: 'a'.repeat(40) }
  const subject = { kind: 'main' as const, sha: subjectSha }
  return {
    v: 1,
    t: 1,
    event: 'finding-open',
    id: findingId({ scenario, metric, baseline, subject }),
    tickId: 'tick-1',
    scenario,
    metric,
    subject,
    baseline,
    medianA: 10,
    medianB: 12,
    difference: 2,
    practicalFloor: 0.5,
    sigma: 0.2,
    lowConfidence: false,
    topStages: [],
    noStageMoved: true,
    rangeCommits: 1,
    renderLoopCommits: [],
    reproduce: reproduceCommand(scenario, baseline.sha, subject.sha),
    closeCheck: closeCheck({ scenario, metric, baseline }),
  }
}

describe('pnpm perf:track close', { timeout: 60_000 }, () => {
  let dir: string
  let trackPath: string
  const track = (...args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', BIN, ...args], {
    cwd: resolve(import.meta.dirname, '../..'),
    env: { ...process.env, AIRI_PERF_BENCH_DIR: dir },
    encoding: 'utf8',
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'airi-track-close-'))
    trackPath = join(dir, 'track.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('closes an open finding by hand and refuses a second close with the open ids', async () => {
    const closing = openEvent('b'.repeat(40))
    const remaining = openEvent('c'.repeat(40))
    appendTrackEvent(trackPath, closing)
    appendTrackEvent(trackPath, remaining)

    const first = track('close', closing.id, '--resolution', 'noise', '--note', 'qa')
    expect(first.stderr).toBe('')
    expect(first.status).toBe(0)
    const fold = foldFindings((await readTrackEvents(trackPath)).events)
    expect(fold.outcomes).toEqual({ fixed: 0, accepted: 0, noise: 1 })
    expect(fold.closed[0].close).toMatchObject({ id: closing.id, resolution: 'noise', at: null, note: 'qa', by: 'manual' })
    expect(fold.open.map(finding => finding.id)).toEqual([remaining.id])

    const written = readFileSync(trackPath, 'utf8')
    const second = track('close', closing.id, '--resolution', 'fixed')
    expect(second.status).toBe(2)
    expect(second.stderr).toContain(remaining.id)
    expect(readFileSync(trackPath, 'utf8')).toBe(written)
  })

  it('refuses an unknown id without creating the log', () => {
    const result = track('close', 'mmd-idle:fps:aaaaaaa..bbbbbbb', '--resolution', 'noise')
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('no open findings')
    expect(() => readFileSync(trackPath)).toThrow(/ENOENT/)
  })
})
