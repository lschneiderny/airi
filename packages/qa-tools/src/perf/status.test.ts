import type { BenchRunRecord } from '@proj-airi/stage-shared/perf/usage'

import type { FindingOpenEvent, TrackEvent } from '../track/findings'
import type { StatusInputs } from './status'

import { execFile, execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { ACCEPTED_COSTS_PATH } from '../track/accepted-costs'
import { closeCheck, findingId, reproduceCommand } from '../track/findings'
import { formatStatus } from './format'
import { buildStatus } from './status'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const NOW = 1_794_000_000_000
const OLD_TIP = 'a'.repeat(40)
const TIP = 'b'.repeat(40)
const BASE = 'c'.repeat(40)

function benchRun(sha: string, t: number, stages?: Record<string, number>, overrides: Partial<BenchRunRecord> = {}): BenchRunRecord {
  return {
    v: 1,
    t,
    sessionId: `bench-${t}`,
    kind: 'bench-run',
    matrix: 'bench-v1',
    scenario: 'mmd-idle',
    scenarioVersion: 1,
    run: 1,
    sha,
    dirty: false,
    diffHash: null,
    modelFingerprint: 'fp-1',
    host: { platform: 'linux', arch: 'x64', cpuModel: 'cpu', cores: 16, totalMemKb: 32_000_000, gpu: null },
    buildMode: 'dev',
    electronVersion: '43.8.7',
    valid: true,
    metrics: {
      fps: 60,
      p50FrameMs: 16,
      p95FrameMsApprox: 18,
      share21: 0,
      share36: 0,
      share100: 0,
      stageWindowCpuPct: 40,
      stageWindowCpuMsPerFrame: 4,
      gpuCpuPct: 10,
      browserCpuPct: 5,
      stageWindowWorkingSetKb: 300_000,
      stageSumMeanMs: null,
      recorderMs: 1,
    },
    stages: stages === undefined ? undefined : Object.fromEntries(Object.entries(stages).map(([id, msPerFrame]) => [id, { msPerFrame, p95MsApprox: msPerFrame, n: 100 }])),
    ...overrides,
  }
}

function openEvent(t: number, subjectSha: string, overrides: Partial<FindingOpenEvent> = {}): FindingOpenEvent {
  const scenario = 'mmd-idle'
  const metric = 'p95FrameMsApprox'
  const baseline = { kind: 'previous' as const, sha: BASE }
  const subject = overrides.subject ?? { kind: 'main' as const, sha: subjectSha }
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
    rangeCommits: 1,
    renderLoopCommits: [],
    reproduce: reproduceCommand(scenario, baseline.sha, subject.sha),
    closeCheck: closeCheck({ scenario, metric, baseline }),
    ...overrides,
  }
}

function mainSubject(t: number, sha: string): TrackEvent {
  return {
    v: 1,
    t,
    event: 'subject',
    tickId: `tick-${t}`,
    subject: { kind: 'main', sha },
    baseline: null,
    scenarios: ['mmd-idle'],
    outcome: 'benched',
  }
}

const empty: StatusInputs = { runs: [], events: [], accepted: [], mainTip: null, now: NOW }

describe('buildStatus', () => {
  it('reports an empty state as stale, low-confidence and without findings', () => {
    const status = buildStatus(empty)

    expect(status).toMatchObject({
      lastTick: null,
      trackerStale: true,
      mainTip: null,
      lowConfidence: true,
      open: [],
      recentlyClosed: [],
      outcomes: { fixed: 0, accepted: 0, noise: 0, noiseShare: null },
      accepted: [],
      baselineResets: [],
      ghFailureStreak: 0,
      stages: [],
    })
    expect(formatStatus(status).split('\n')[0]).toMatch(/^stale/)
  })

  it('counts the outcome mix of closed findings and keeps only those closed in the last 14 days', () => {
    const fixed = openEvent(NOW - 20 * DAY, 'd'.repeat(40))
    const noise = openEvent(NOW - 3 * DAY, 'e'.repeat(40))
    const open = openEvent(NOW - DAY, TIP, { subject: { kind: 'pr', sha: TIP, pr: 12 } })
    const status = buildStatus({
      ...empty,
      events: [
        fixed,
        { v: 1, t: NOW - 15 * DAY, event: 'finding-close', id: fixed.id, resolution: 'fixed', at: TIP, note: '', by: 'manual' },
        noise,
        { v: 1, t: NOW - 2 * DAY, event: 'finding-close', id: noise.id, resolution: 'noise', at: null, note: '', by: 'tracker' },
        open,
      ],
    })

    expect(status.outcomes).toEqual({ fixed: 1, accepted: 0, noise: 1, noiseShare: 0.5 })
    expect(status.open.map(finding => finding.id)).toEqual([open.id])
    expect(status.recentlyClosed.map(finding => finding.id)).toEqual([noise.id])
    expect(formatStatus(status)).toContain(open.id)
  })

  it('takes per-stage medians from the latest benched main tip only, sorted by cost', () => {
    const status = buildStatus({
      ...empty,
      runs: [
        benchRun(OLD_TIP, NOW - 3 * DAY, { 'body-head': 9, 'physics': 9 }),
        benchRun(TIP, NOW - DAY, { 'body-head': 1, 'physics': 3 }),
        benchRun(TIP, NOW - DAY + 1, { 'body-head': 2, 'physics': 5 }),
        benchRun(TIP, NOW - DAY + 2, { 'body-head': 3, 'physics': 4 }),
        benchRun(TIP, NOW - DAY + 3, { 'body-head': 50, 'physics': 50 }, { valid: false }),
        benchRun(TIP, NOW - DAY + 4, { 'body-head': 50, 'physics': 50 }, { dirty: true, diffHash: 'f'.repeat(64) }),
        benchRun(TIP, NOW - DAY + 5, undefined),
      ],
      events: [mainSubject(NOW - 3 * DAY, OLD_TIP), mainSubject(NOW - DAY, TIP)],
      mainTip: TIP,
    })

    expect(status.stages).toEqual([{ scenario: 'mmd-idle', sha: TIP, stages: [{ id: 'physics', msPerFrame: 4 }, { id: 'body-head', msPerFrame: 2 }] }])
    expect(status.mainTip).toEqual({ sha: TIP, benched: true, benchedAt: NOW - DAY + 5 })
  })

  it('takes stages from the current main tip when it is benched, with or without a subject event for it', () => {
    const current = [benchRun(TIP, NOW - HOUR, { physics: 2 })]
    const old = benchRun(OLD_TIP, NOW - 3 * DAY, { physics: 9 })
    const expected = [{ scenario: 'mmd-idle', sha: TIP, stages: [{ id: 'physics', msPerFrame: 2 }] }]

    expect(buildStatus({ ...empty, runs: current, mainTip: TIP }).stages).toEqual(expected)
    expect(buildStatus({ ...empty, runs: [old, ...current], events: [mainSubject(NOW - 3 * DAY, OLD_TIP)], mainTip: TIP }).stages).toEqual(expected)
  })

  it('falls back to the newest benched main subject when the current main tip is not benched', () => {
    const status = buildStatus({
      ...empty,
      runs: [benchRun(OLD_TIP, NOW - 3 * DAY, { physics: 9 })],
      events: [mainSubject(NOW - 3 * DAY, OLD_TIP)],
      mainTip: TIP,
    })

    expect(status.stages).toEqual([{ scenario: 'mmd-idle', sha: OLD_TIP, stages: [{ id: 'physics', msPerFrame: 9 }] }])
  })

  it('uses the median, not the mean, of a stage over skewed runs', () => {
    const runs = [1, 2, 20].map((ms, index) => benchRun(TIP, NOW - HOUR + index, { physics: ms }))

    expect(buildStatus({ ...empty, runs, mainTip: TIP }).stages[0].stages).toEqual([{ id: 'physics', msPerFrame: 2 }])
  })

  it('counts distinct clean commits, not runs, for confidence', () => {
    const runs = Array.from({ length: 10 }, (_, index) => benchRun(TIP, NOW - index))

    expect(buildStatus({ ...empty, runs }).lowConfidence).toBe(true)
  })

  it('keeps baseline resets from the last 14 days', () => {
    const reset = (t: number): TrackEvent => ({ v: 1, t, event: 'baseline-reset', tickId: 'tick-1', subjectSha: TIP, baselineSha: BASE, scenario: 'mmd-idle', kind: 'environment', reasons: ['host'] })

    expect(buildStatus({ ...empty, events: [reset(NOW - 15 * DAY), reset(NOW - DAY)] }).baselineResets.map(event => event.t)).toEqual([NOW - DAY])
  })

  it('prints one qualifier line each, then the gh failure line, before the open findings', () => {
    const status = buildStatus({
      ...empty,
      events: [
        { v: 1, t: NOW - HOUR, event: 'tick-start', tickId: 'tick-1', trigger: 'timer' },
        { v: 1, t: NOW - HOUR, event: 'discovery', tickId: 'tick-1', mainTip: TIP, prs: null, ghError: 'gh: not logged in' },
        { v: 1, t: NOW - HOUR, event: 'discovery', tickId: 'tick-1', mainTip: TIP, prs: null, ghError: 'gh: not logged in' },
      ],
      mainTip: TIP,
    })
    const lines = formatStatus(status).split('\n')

    expect(lines.slice(0, 3).map(line => line.split(':')[0])).toEqual(['lowConfidence', 'main tip not benched', 'gh failed on the last 2 ticks'])
    expect(lines[2]).toBe('gh failed on the last 2 ticks: open PRs are not being benched')
    expect(lines[3]).toBe('open findings:')
  })

  it('reports the last tick, staleness, an unbenched main tip and the gh failure streak', () => {
    const status = buildStatus({
      ...empty,
      events: [
        { v: 1, t: NOW - 50 * HOUR, event: 'tick-start', tickId: 'tick-old', trigger: 'timer' },
        { v: 1, t: NOW - 49 * HOUR, event: 'tick-end', tickId: 'tick-old', exitCode: 1, durationMs: HOUR },
        { v: 1, t: NOW - 49 * HOUR, event: 'discovery', tickId: 'tick-old', mainTip: TIP, prs: null, ghError: 'gh: not logged in' },
      ],
      mainTip: TIP,
    })

    expect(status.lastTick).toEqual({ tickId: 'tick-old', startedAt: NOW - 50 * HOUR, ageHours: 50, exitCode: 1 })
    expect(status.trackerStale).toBe(true)
    expect(status.mainTip).toEqual({ sha: TIP, benched: false, benchedAt: null })
    expect(status.ghFailureStreak).toBe(1)
    expect(buildStatus({ ...empty, events: [{ v: 1, t: NOW - 47 * HOUR, event: 'tick-start', tickId: 'tick-new', trigger: 'timer' }] }).trackerStale).toBe(false)
  })

  it('is confident from 10 distinct clean commits and keeps accepted costs with their commits', () => {
    const shas = Array.from({ length: 10 }, (_, index) => `${index}`.repeat(40))
    const accepted = [{ id: 'mmd-physics-cost', scenario: 'mmd-idle' as const, metric: 'fps' as const, reason: 'physics', accepted: '2026-11-01', commit: null }]
    const status = buildStatus({ ...empty, runs: shas.map((sha, index) => benchRun(sha, NOW - index)), accepted })

    expect(status.lowConfidence).toBe(false)
    expect(buildStatus({ ...empty, runs: shas.slice(1).map((sha, index) => benchRun(sha, NOW - index)) }).lowConfidence).toBe(true)
    expect(status.accepted).toEqual([{ id: 'mmd-physics-cost', scenario: 'mmd-idle', metric: 'fps', reason: 'physics', commit: null }])
  })
})

describe('pnpm perf status', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir)
      rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('exits 0 with JSON that resolves accepted costs to their introducing commit and reads origin/main', async () => {
    dir = mkdtempSync(join(tmpdir(), 'qa-perf-status-'))
    const repo = join(dir, 'repo')
    const benchDir = join(dir, 'bench')
    mkdirSync(join(repo, 'packages/qa-tools/perf'), { recursive: true })
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=qa', '-c', 'user.email=qa@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' }).trim()
    git('init', '--quiet')
    writeFileSync(join(repo, ACCEPTED_COSTS_PATH), JSON.stringify({ entries: [{ id: 'mmd-physics-cost', scenario: 'mmd-idle', metric: 'fps', reason: 'physics', accepted: '2026-11-01' }] }))
    git('add', '.')
    git('commit', '--quiet', '-m', 'accept')
    const introducing = git('rev-parse', 'HEAD')
    git('update-ref', 'refs/remotes/origin/main', introducing)

    const packageDir = fileURLToPath(new URL('../..', import.meta.url))
    const { stdout } = await promisify(execFile)('node', ['--import', 'tsx', 'bin/perf.ts', 'status', '--json'], {
      cwd: packageDir,
      env: { ...process.env, INIT_CWD: repo, AIRI_PERF_BENCH_DIR: benchDir },
      encoding: 'utf8',
    })
    const status: unknown = JSON.parse(stdout)

    expect(status).toMatchObject({ mainTip: { sha: introducing, benched: false }, accepted: [{ id: 'mmd-physics-cost', commit: introducing }] })
  })
})
