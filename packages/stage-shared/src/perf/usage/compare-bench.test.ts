import type { BenchComparison, BenchRefusalReason } from './compare-bench'
import type { BenchRunRecord } from './records'

import { describe, expect, it } from 'vitest'

import { compareBench } from './compare-bench'

const T0 = 1_794_000_000_000
const DAY = 86_400_000
const host = { platform: 'linux', arch: 'x64', cpuModel: 'AMD Ryzen 7 5800X3D', cores: 16, totalMemKb: 32_000_000, gpu: null }
/** Run spread around a commit's centre: a MAD of 0.5, so a scaled-MAD sigma of 0.7413. */
const OFFSETS = [-1, -0.5, 0, 0.5, 1]
const SIGMA = 1.4826 * 0.5

interface RunOptions { sha?: string, dirty?: boolean, diffHash?: string | null, t?: number, run?: number }

function run(p95FrameMsApprox: number, options: RunOptions = {}, overrides: Partial<BenchRunRecord> = {}): BenchRunRecord {
  return {
    v: 1,
    t: options.t ?? T0,
    sessionId: `bench-${options.sha ?? 'a'}-${options.run ?? 0}`,
    kind: 'bench-run',
    matrix: 'bench-v1',
    scenario: 'mmd-idle',
    scenarioVersion: 1,
    run: options.run ?? 0,
    sha: options.sha ?? 'a',
    dirty: options.dirty ?? false,
    diffHash: options.diffHash ?? null,
    modelFingerprint: 'fp-1',
    host,
    buildMode: 'dev',
    electronVersion: '43.8.7',
    leaseClass: 'exclusive',
    valid: true,
    metrics: {
      fps: 1000 / p95FrameMsApprox,
      p50FrameMs: 16,
      p95FrameMsApprox,
      share21: 0,
      share36: 0,
      share100: 0,
      stageWindowCpuPct: 40,
      gpuCpuPct: 10,
      browserCpuPct: 5,
      stageWindowWorkingSetKb: 300_000,
      stageSumMeanMs: null,
      recorderMs: 1,
    },
    ...overrides,
  }
}

function commit(values: number[], options: RunOptions = {}): BenchRunRecord[] {
  return values.map((value, index) => run(value, { ...options, run: index }))
}

const around = (centre: number) => OFFSETS.map(offset => centre + offset)

/** Ten trailing clean commits with the same spread, so noise is pooled from history. */
const history = Array.from({ length: 10 }, (_, index) => commit(around(16), { sha: `h${index}`, t: T0 - (index + 1) * DAY })).flat()

function compared(result: BenchComparison): Extract<BenchComparison, { status: 'compared' }> {
  if (result.status !== 'compared')
    throw new Error(`expected a comparison, got refusals ${result.refusals.map(refusal => refusal.reason).join(', ')}`)
  return result
}

describe('compareBench', () => {
  it('reports a 3-sigma slowdown that all five runs agree on as a regression', () => {
    const result = compared(compareBench({ runsA: commit(around(16)), runsB: commit(around(16 + 3 * SIGMA), { sha: 'b' }), history, metric: 'p95FrameMsApprox' }))

    expect(result.verdict).toBe('regression')
    expect(result.sigma).toBeCloseTo(SIGMA)
    expect(result.noise).toBe('pooled')
    expect(result.historyCommits).toBe(10)
    expect(result.lowConfidence).toBe(false)
    expect(result.agreement).toEqual({ count: 5, required: 4, of: 5 })
    expect(result.valuesB.map(entry => entry.value)).toEqual(around(16 + 3 * SIGMA))
  })

  it('reports a higher fps as an improvement', () => {
    const runsA = commit([60, 60.5, 61, 61.5, 62]).map(entry => ({ ...entry, metrics: { ...entry.metrics, fps: entry.metrics.p95FrameMsApprox } }))
    const runsB = runsA.map(entry => ({ ...entry, sha: 'b', metrics: { ...entry.metrics, fps: entry.metrics.fps + 5 } }))

    expect(compared(compareBench({ runsA, runsB, history: [], metric: 'fps' })).verdict).toBe('improvement')
  })

  it('keeps a large shift within noise when only three of five runs agree', () => {
    const result = compared(compareBench({ runsA: commit(around(16)), runsB: commit([15.5, 15.8, 19, 19.2, 19.4], { sha: 'b' }), history, metric: 'p95FrameMsApprox' }))

    expect(result.difference).toBeGreaterThan(2 * result.sigma)
    expect(result.agreement).toEqual({ count: 3, required: 4, of: 5 })
    expect(result.verdict).toBe('within-noise')
  })

  it('requires all of three runs to agree', () => {
    const runsA = commit([15.5, 16, 16.5])

    const all = compared(compareBench({ runsA, runsB: commit([19, 19.5, 20], { sha: 'b' }), history, metric: 'p95FrameMsApprox' }))
    const two = compared(compareBench({ runsA, runsB: commit([15, 19.5, 20], { sha: 'b' }), history, metric: 'p95FrameMsApprox' }))

    expect(all.verdict).toBe('regression')
    expect(two).toMatchObject({ verdict: 'within-noise', agreement: { count: 2, required: 3, of: 3 } })
  })

  it('keeps a shift above 2 sigma but below the practical floor within noise', () => {
    const tight = (centre: number) => [centre - 0.02, centre - 0.01, centre, centre + 0.01, centre + 0.02]

    const result = compared(compareBench({ runsA: commit(tight(16)), runsB: commit(tight(16.4), { sha: 'b' }), history: [], metric: 'p95FrameMsApprox' }))

    expect(result.difference).toBeGreaterThan(2 * result.sigma)
    expect(result.practicalFloor).toBe(0.5)
    expect(result.verdict).toBe('within-noise')
  })

  it('uses pair-local noise with low confidence when fewer than ten history commits exist', () => {
    const result = compared(compareBench({ runsA: commit(around(16)), runsB: commit(around(16), { sha: 'b' }), history: history.slice(0, 4 * OFFSETS.length), metric: 'p95FrameMsApprox' }))

    expect(result).toMatchObject({ historyCommits: 4, noise: 'pair-local', lowConfidence: true, verdict: 'within-noise' })
  })

  it('compares a dirty working tree against a clean commit and keeps dirty runs out of the noise history', () => {
    const nineClean = history.slice(0, 9 * OFFSETS.length)
    const dirtyHistory = commit(around(16), { sha: 'h0', dirty: true, diffHash: 'other-work', t: T0 - DAY })
    const runsB = commit(around(16), { sha: 'a', dirty: true, diffHash: 'd1' })

    const result = compared(compareBench({ runsA: commit(around(16)), runsB, history: [...nineClean, ...dirtyHistory], metric: 'p95FrameMsApprox' }))

    expect(result.groupB).toEqual({ sha: 'a', diffHash: 'd1', dirty: true })
    expect(result).toMatchObject({ historyCommits: 9, noise: 'pair-local', lowConfidence: true })
  })

  it('pools only history commits whose runs all precede B', () => {
    const nineEarlier = history.slice(0, 9 * OFFSETS.length)
    const later = commit(around(16), { sha: 'later', t: T0 + DAY })
    const overlapping = [...commit(around(16), { sha: 'overlap', t: T0 - DAY }), run(16, { sha: 'overlap', t: T0, run: 5 })]

    const result = compared(compareBench({ runsA: commit(around(16)), runsB: commit(around(16), { sha: 'b' }), history: [...nineEarlier, ...later, ...overlapping], metric: 'p95FrameMsApprox' }))

    expect(result).toMatchObject({ historyCommits: 9, noise: 'pair-local', lowConfidence: true })
  })

  it('handles identical values without dividing by zero', () => {
    const flat = (value: number) => Array.from<number>({ length: 5 }).fill(value)

    const same = compared(compareBench({ runsA: commit(flat(16)), runsB: commit(flat(16), { sha: 'b' }), history: [], metric: 'p95FrameMsApprox' }))
    const slower = compared(compareBench({ runsA: commit(flat(16)), runsB: commit(flat(17), { sha: 'b' }), history: [], metric: 'p95FrameMsApprox' }))

    expect(same).toMatchObject({ sigma: 0, difference: 0, verdict: 'within-noise' })
    expect(slower).toMatchObject({ sigma: 0, difference: 1, verdict: 'regression' })
  })

  it('marks groups whose newest runs are more than seven days apart as stale', () => {
    const fresh = compared(compareBench({ runsA: commit(around(16)), runsB: commit(around(16), { sha: 'b', t: T0 + 7 * DAY }), history, metric: 'p95FrameMsApprox' }))
    const stale = compared(compareBench({ runsA: commit(around(16)), runsB: commit(around(16), { sha: 'b', t: T0 + 7 * DAY + 1 }), history, metric: 'p95FrameMsApprox' }))

    expect(fresh.stale).toBe(false)
    expect(stale.stale).toBe(true)
  })

  it.each<[string, (runs: BenchRunRecord[]) => BenchRunRecord[], BenchRefusalReason]>([
    ['another host', runs => runs.map(entry => ({ ...entry, host: { ...host, cpuModel: 'Apple M2' } })), 'host-mismatch'],
    ['another build mode', runs => runs.map(entry => ({ ...entry, buildMode: 'packaged' as const })), 'build-mode-mismatch'],
    ['another Electron', runs => runs.map(entry => ({ ...entry, electronVersion: '44.0.0' })), 'electron-mismatch'],
    ['another scenario', runs => runs.map(entry => ({ ...entry, scenario: 'mmd-talk' })), 'scenario-mismatch'],
    ['another scenario version', runs => runs.map(entry => ({ ...entry, scenarioVersion: 2 })), 'scenario-mismatch'],
    ['another model', runs => runs.map(entry => ({ ...entry, modelFingerprint: 'fp-2' })), 'model-mismatch'],
    ['an invalid run', runs => runs.map((entry, index) => (index === 0 ? { ...entry, valid: false, invalidReason: 'host-contended' } : entry)), 'invalid-run'],
    ['two commits on one side', runs => runs.map((entry, index) => (index === 0 ? { ...entry, sha: 'c' } : entry)), 'mixed-groups'],
    ['two runs', runs => runs.slice(0, 2), 'too-few-runs'],
    ['no runs', () => [], 'no-runs'],
  ])('refuses B with %s', (_, change, reason) => {
    const result = compareBench({ runsA: commit(around(16)), runsB: change(commit(around(16), { sha: 'b' })), history, metric: 'p95FrameMsApprox' })

    expect(result.status).toBe('refused')
    expect(result.status === 'refused' && result.refusals.map(refusal => refusal.reason)).toContain(reason)
  })
})
