import type { FindingOpenEvent, TrackEvent } from './findings'

import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { appendTrackEvent, closeCheck, findingId, foldFindings, readTrackEvents, reproduceCommand, trackHistoryPath } from './findings'

const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const FIX = 'c'.repeat(40)

function openEvent(t: number, overrides: Partial<FindingOpenEvent> = {}): FindingOpenEvent {
  const scenario = overrides.scenario ?? 'mmd-idle'
  const metric = overrides.metric ?? 'p95FrameMsApprox'
  const baseline = overrides.baseline ?? { kind: 'previous' as const, sha: BASE }
  const subject = overrides.subject ?? { kind: 'main' as const, sha: HEAD }
  return {
    v: 1,
    t,
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
    topStages: [{ id: 'body-head', deltaMsPerFrame: 1.5, z: 4 }],
    noStageMoved: false,
    rangeCommits: 3,
    renderLoopCommits: [{ sha: HEAD, subject: 'feat(stage-ui-mmd): add a stage' }],
    reproduce: reproduceCommand(scenario, baseline.sha, subject.sha),
    closeCheck: closeCheck({ scenario, metric, baseline }),
    ...overrides,
  }
}

function closeEvent(t: number, id: string, resolution: 'fixed' | 'accepted' | 'noise'): TrackEvent {
  return { v: 1, t, event: 'finding-close', id, resolution, at: resolution === 'noise' ? null : FIX, note: 'n', by: 'manual' }
}

describe('track history location', () => {
  it('puts track.jsonl beside bench.jsonl in the state dir', () => {
    expect(trackHistoryPath({ platform: 'linux', env: {}, homedir: '/home/user' })).toBe('/home/user/.local/state/airi-perf/track.jsonl')
    expect(trackHistoryPath({ platform: 'win32', env: { LOCALAPPDATA: 'D:\\Local' }, homedir: 'C:\\Users\\u' })).toBe('D:\\Local\\airi-perf\\track.jsonl')
  })

  it('moves with AIRI_PERF_BENCH_DIR', () => {
    expect(trackHistoryPath({ platform: 'linux', env: { AIRI_PERF_BENCH_DIR: '/bench' }, homedir: '/home/user' })).toBe('/bench/track.jsonl')
  })
})

describe('track history file', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir)
      rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('round-trips appended events through an owner-only file', async () => {
    dir = mkdtempSync(join(tmpdir(), 'qa-track-history-'))
    const path = join(dir, 'nested', 'track.jsonl')
    const events: TrackEvent[] = [
      { v: 1, t: 1, event: 'tick-start', tickId: 'tick-1', trigger: 'timer' },
      { v: 1, t: 2, event: 'discovery', tickId: 'tick-1', mainTip: HEAD, prs: [{ number: 7, head: FIX, baselineSha: BASE, baseRef: 'main' }] },
      { v: 1, t: 3, event: 'subject', tickId: 'tick-1', subject: { kind: 'pr', sha: FIX, pr: 7 }, baseline: null, scenarios: ['mmd-idle'], outcome: 'deferred', reason: 'capacity' },
      openEvent(4),
      { v: 1, t: 5, event: 'tick-end', tickId: 'tick-1', exitCode: 0, durationMs: 4 },
    ]
    for (const event of events)
      appendTrackEvent(path, event)

    expect(await readTrackEvents(path)).toEqual({ events, counts: { path, malformed: 0, unknownVersion: 0 }, found: true })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(statSync(join(dir, 'nested')).mode & 0o777).toBe(0o700)
  })

  it('round-trips a zero-noise top stage with a null z', async () => {
    dir = mkdtempSync(join(tmpdir(), 'qa-track-zero-noise-'))
    const path = join(dir, 'track.jsonl')
    const event = openEvent(1, { topStages: [{ id: 'physics', deltaMsPerFrame: 1, z: null, zeroNoise: true }] })

    appendTrackEvent(path, event)

    expect((await readTrackEvents(path)).events).toEqual([event])
  })

  it('refuses to append an invalid event', () => {
    dir = mkdtempSync(join(tmpdir(), 'qa-track-history-'))
    const path = join(dir, 'track.jsonl')
    const invalid: TrackEvent = { v: 1, t: -1, event: 'tick-start', tickId: 'tick-1', trigger: 'timer' }

    expect(() => appendTrackEvent(path, invalid)).toThrow()
    expect(() => readFileSync(path)).toThrow()
  })

  it('counts non-JSON, schema-invalid and unknown-version lines without throwing', async () => {
    dir = mkdtempSync(join(tmpdir(), 'qa-track-history-'))
    const path = join(dir, 'track.jsonl')
    const valid = JSON.stringify({ v: 1, t: 1, event: 'tick-start', tickId: 'tick-1', trigger: 'manual' })
    const invalid = JSON.stringify({ v: 1, t: 1, event: 'tick-start', tickId: 'tick-1' })
    const future = JSON.stringify({ v: 2, t: 1, event: 'tick-start', tickId: 'tick-1', trigger: 'manual' })
    writeFileSync(path, [valid, '{', invalid, future, '', valid].join('\n'))

    const read = await readTrackEvents(path)

    expect(read.events).toHaveLength(2)
    expect(read.counts).toEqual({ path, malformed: 2, unknownVersion: 1 })
  })

  it('reads a missing file as empty', async () => {
    dir = mkdtempSync(join(tmpdir(), 'qa-track-history-'))
    const path = join(dir, 'track.jsonl')

    expect(await readTrackEvents(path)).toEqual({ events: [], counts: { path, malformed: 0, unknownVersion: 0 }, found: false })
  })
})

describe('foldFindings', () => {
  it('derives the id from scenario, metric and both short shas', () => {
    expect(openEvent(1).id).toBe('mmd-idle:p95FrameMsApprox:aaaaaaa..bbbbbbb')
  })

  it('keeps the first open of an id and ignores a duplicate open', () => {
    const first = openEvent(1)
    const fold = foldFindings([first, openEvent(2, { medianB: 99 })])

    expect(fold.open).toHaveLength(1)
    expect(fold.open[0]).toMatchObject({ t: 1, medianB: 12, observedAgain: 0, lastSeenT: 1 })
  })

  it('counts observed-again events on an open finding and ignores them for others', () => {
    const open = openEvent(1)
    const fold = foldFindings([
      open,
      { v: 1, t: 5, event: 'observed-again', id: open.id, tickId: 'tick-2', subject: { kind: 'main', sha: FIX }, baselineSha: BASE, difference: 2.1 },
      { v: 1, t: 6, event: 'observed-again', id: 'unknown', tickId: 'tick-2', subject: { kind: 'main', sha: FIX }, baselineSha: BASE, difference: 2.1 },
    ])

    expect(fold.open[0]).toMatchObject({ observedAgain: 1, lastSeenT: 5 })
  })

  it('moves a closed finding out of open, counts outcomes, and ignores unknown and repeated closes', () => {
    const a = openEvent(1)
    const b = openEvent(2, { scenario: 'live2d-idle' })
    const c = openEvent(3, { metric: 'fps' })
    const d = openEvent(4, { metric: 'stageWindowCpuPct' })
    const fold = foldFindings([
      a,
      b,
      c,
      d,
      closeEvent(5, a.id, 'fixed'),
      closeEvent(6, b.id, 'accepted'),
      closeEvent(7, c.id, 'noise'),
      closeEvent(8, a.id, 'noise'),
      closeEvent(9, 'mmd-idle:fps:0000000..1111111', 'fixed'),
    ])

    expect(fold.open.map(entry => entry.id)).toEqual([d.id])
    expect(fold.closed.map(entry => [entry.id, entry.close.resolution])).toEqual([[a.id, 'fixed'], [b.id, 'accepted'], [c.id, 'noise']])
    expect(fold.outcomes).toEqual({ fixed: 1, accepted: 1, noise: 1 })
  })

  it('starts a new open entry when a closed id opens again', () => {
    const a = openEvent(1)
    const fold = foldFindings([a, closeEvent(2, a.id, 'noise'), openEvent(3)])

    expect(fold.open).toMatchObject([{ id: a.id, t: 3, observedAgain: 0 }])
    expect(fold.closed).toMatchObject([{ id: a.id, t: 1 }])
  })

  it('reports the latest tick-start with its own tick-end', () => {
    const fold = foldFindings([
      { v: 1, t: 1, event: 'tick-start', tickId: 'tick-1', trigger: 'timer' },
      { v: 1, t: 2, event: 'tick-end', tickId: 'tick-1', exitCode: 0, durationMs: 1 },
      { v: 1, t: 3, event: 'tick-start', tickId: 'tick-2', trigger: 'manual' },
    ])

    expect(fold.lastTick).toEqual({ tickId: 'tick-2', startT: 3, endT: null, exitCode: null })
    expect(foldFindings([
      { v: 1, t: 1, event: 'tick-start', tickId: 'tick-1', trigger: 'timer' },
      { v: 1, t: 4, event: 'tick-end', tickId: 'tick-1', exitCode: 1, durationMs: 3 },
    ]).lastTick).toEqual({ tickId: 'tick-1', startT: 1, endT: 4, exitCode: 1 })
    expect(foldFindings([]).lastTick).toBeNull()
  })

  it('collects baseline resets and counts the trailing gh failure streak', () => {
    const reset: TrackEvent = { v: 1, t: 1, event: 'baseline-reset', tickId: 'tick-1', subjectSha: HEAD, baselineSha: BASE, scenario: 'mmd-idle', kind: 'not-comparable', reasons: ['electron-mismatch'] }
    const discovery = (t: number, ghError?: string): TrackEvent => ({ v: 1, t, event: 'discovery', tickId: `tick-${t}`, mainTip: HEAD, prs: ghError ? null : [], ...(ghError ? { ghError } : {}) })
    const fold = foldFindings([reset, discovery(2, 'gh: offline'), discovery(3), discovery(4, 'gh: offline'), discovery(5, 'gh: auth')])

    expect(fold.baselineResets).toEqual([reset])
    expect(fold.ghFailureStreak).toBe(2)
    expect(foldFindings([discovery(1)]).ghFailureStreak).toBe(0)
  })
})

describe('finding commands', () => {
  it('reproduces with repo-relative text only', () => {
    const command = reproduceCommand('mmd-idle', BASE, HEAD)

    expect(command).toBe(`pnpm perf:track tick --baseline ${BASE} --subject ${HEAD} --scenario mmd-idle`)
    expect(command).not.toMatch(/(?:^|\s)\//)
  })

  it('names the compare that proves a fix', () => {
    expect(closeCheck({ scenario: 'mmd-idle', metric: 'fps', baseline: { kind: 'previous', sha: BASE } }))
      .toBe(`pnpm perf compare --bench ${BASE} <fix sha> --scenario mmd-idle --metric fps shows within-noise or improvement`)
  })
})
