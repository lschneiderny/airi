import type { BenchRunRecord } from '@proj-airi/stage-shared/perf/usage'

import type { BenchCompareParams, BenchCompareResult } from './bench'

import { describe, expect, it } from 'vitest'

import { compareBenchRefs, listBenchGroups, parseBenchRef } from './bench'
import { formatBenchCompare } from './format'

const T0 = 1_794_000_000_000
const DAY = 86_400_000
const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const host = { platform: 'linux', arch: 'x64', cpuModel: 'AMD Ryzen 7 5800X3D', cores: 16, totalMemKb: 32_000_000, gpu: null }
/** A MAD of 0.5 around each commit's centre, so a scaled-MAD sigma of 0.7413. */
const OFFSETS = [-1, -0.5, 0, 0.5, 1]
const SIGMA = 1.4826 * 0.5

interface RunOptions { sha?: string, diffHash?: string | null, t?: number, run?: number, scenario?: string }

function run(p95FrameMsApprox: number, options: RunOptions = {}, overrides: Partial<BenchRunRecord> = {}): BenchRunRecord {
  const diffHash = options.diffHash ?? null
  return {
    v: 1,
    t: options.t ?? T0,
    sessionId: `bench-${options.run ?? 0}`,
    kind: 'bench-run',
    matrix: 'bench-v1',
    scenario: options.scenario ?? 'mmd-idle',
    scenarioVersion: 1,
    run: options.run ?? 1,
    sha: options.sha ?? SHA_A,
    dirty: diffHash !== null,
    diffHash,
    modelFingerprint: 'fp-1',
    host,
    buildMode: 'dev',
    electronVersion: '43.8.7',
    leaseClass: 'exclusive',
    valid: true,
    metrics: {
      fps: 60,
      p50FrameMs: 16,
      p95FrameMsApprox,
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
    ...overrides,
  }
}

const commit = (centre: number, options: RunOptions = {}) => OFFSETS.map((offset, index) => run(centre + offset, { ...options, run: index + 1 }))
/** Ten clean commits benched before A and B, so noise is pooled from the history file. */
const history = Array.from({ length: 10 }, (_, index) => commit(16, { sha: `${index}`.repeat(40), t: T0 - (index + 1) * DAY })).flat()

function ref(text: string) {
  const parsed = parseBenchRef(text)
  if (parsed === null)
    throw new Error(`invalid ref ${text}`)
  return parsed
}

function compare(runs: readonly BenchRunRecord[], params: Partial<Omit<BenchCompareParams, 'runs'>> = {}): BenchCompareResult {
  return compareBenchRefs({ runs, a: ref(SHA_A.slice(0, 9)), b: ref(SHA_B.slice(0, 9)), local: null, scenario: 'mmd-idle', metric: 'p95FrameMsApprox', ...params })
}

function scenariosOf(result: BenchCompareResult) {
  if (!result.ok)
    throw new Error(result.message)
  return result.scenarios
}

describe('compareBenchRefs', () => {
  it('reports a 3-sigma slowdown on all five runs as a regression, pooling noise from the history file', () => {
    const [scenario] = scenariosOf(compare([...history, ...commit(16), ...commit(16 + 3 * SIGMA, { sha: SHA_B, t: T0 + 1 })]))

    expect(scenario.status).toBe('compared')
    expect(scenario.status === 'compared' && scenario.comparisons[0]).toMatchObject({ verdict: 'regression', lowConfidence: false, historyCommits: 10, agreement: { count: 5, of: 5 } })
  })

  it('refuses runs from another host', () => {
    const otherHost = commit(16, { sha: SHA_B }).map(entry => ({ ...entry, host: { ...host, cpuModel: 'Apple M2' } }))

    const [scenario] = scenariosOf(compare([...commit(16), ...otherHost]))

    expect(scenario.status === 'refused' && scenario.refusals.map(refusal => refusal.reason)).toEqual(['host-mismatch'])
  })

  it('fails with "no bench runs for <ref>" when a ref has no runs', () => {
    expect(compare(commit(16), { b: ref('c0ffee1') })).toEqual({ ok: false, message: 'no bench runs for c0ffee1' })
    expect(compare([...commit(16), ...commit(16, { sha: SHA_B, scenario: 'mmd-talk' })])).toEqual({ ok: false, message: `no bench runs for ${SHA_B.slice(0, 9)} in scenario mmd-idle` })
  })

  it('compares only the valid runs of a group and reports the others with their reasons', () => {
    const runsB = commit(16, { sha: SHA_B }).map((entry, index) => (index === 0 ? { ...entry, valid: false, invalidReason: 'host-contended' } : entry))

    const [scenario] = scenariosOf(compare([...commit(16), ...runsB]))

    expect(scenario.b.excluded).toEqual([{ run: 1, t: T0, invalidReason: 'host-contended' }])
    expect(scenario.status === 'compared' && scenario.comparisons[0].valuesB.map(entry => entry.run)).toEqual([2, 3, 4, 5])
  })

  it('resolves worktree to the current sha and diff hash, and HEAD to the clean commit', () => {
    const dirty = commit(18, { diffHash: 'd1', t: T0 + 1 })
    const runs = [...commit(16), ...dirty, ...commit(20, { diffHash: 'd0' })]

    const [scenario] = scenariosOf(compare(runs, { a: ref('HEAD'), b: ref('worktree'), local: { sha: SHA_A, diffHash: 'd1' } }))

    expect(scenario.a.group).toEqual({ sha: SHA_A, diffHash: null })
    expect(scenario.b.group).toEqual({ sha: SHA_A, diffHash: 'd1' })
    expect(scenario.status === 'compared' && scenario.comparisons[0].medianB).toBe(18)
  })

  it('compares every scenario either ref has, on every judged metric, without --scenario and --metric', () => {
    const runs = [...commit(16), ...commit(16, { sha: SHA_B }), ...commit(16, { scenario: 'mmd-talk' }), ...commit(16, { sha: SHA_B, scenario: 'mmd-talk' })]

    const scenarios = scenariosOf(compare(runs, { scenario: null, metric: null }))

    expect(scenarios.map(entry => entry.scenario)).toEqual(['mmd-idle', 'mmd-talk'])
    expect(scenarios[0].status === 'compared' && scenarios[0].comparisons.map(entry => entry.metric)).toEqual(['p95FrameMsApprox', 'fps', 'stageWindowCpuPct', 'stageWindowCpuMsPerFrame', 'stageWindowWorkingSetKb'])
  })

  it('refuses a sha prefix that matches two commits', () => {
    const result = compare([...commit(16, { sha: `abcd${'1'.repeat(36)}` }), ...commit(16, { sha: `abcd${'2'.repeat(36)}` })], { a: ref('abcd1'), b: ref('abcd') })

    expect(result).toEqual({ ok: false, message: `bench ref abcd is ambiguous: abcd${'1'.repeat(36)}, abcd${'2'.repeat(36)}` })
  })
})

describe('parseBenchRef', () => {
  it.each(['HEAD', 'worktree', 'abcd', SHA_A, 'ABCDEF1'])('accepts %s', (text) => {
    expect(parseBenchRef(text)).not.toBeNull()
  })

  it.each(['head', 'main', 'abc', `${SHA_A}0`, 'HEAD~1', ''])('rejects %j', (text) => {
    expect(parseBenchRef(text)).toBeNull()
  })
})

describe('listBenchGroups', () => {
  it('groups runs by scenario, sha and diff hash with medians over the valid runs, within --since', () => {
    const runs = [
      ...commit(16, { t: T0 - 10 * DAY, sha: SHA_B }),
      ...commit(16),
      ...commit(18, { diffHash: 'd1' }),
      run(99, { run: 6 }, { valid: false, invalidReason: 'host-contended' }),
    ]

    const groups = listBenchGroups(runs, { now: T0, sinceMs: DAY, scenario: null })

    expect(groups.map(group => [group.sha, group.diffHash, group.runs, group.validRuns, group.medians.p95FrameMsApprox])).toEqual([
      [SHA_A, null, 6, 5, 16],
      [SHA_A, 'd1', 5, 5, 18],
    ])
  })
})

describe('formatBenchCompare', () => {
  it('prints every run value, sigma, floor, verdict, confidence and staleness, and refusals with reasons', () => {
    const compared = compare([...commit(16), ...commit(16, { sha: SHA_B })])
    const refused = compare([...commit(16), ...commit(16, { sha: SHA_B }).map(entry => ({ ...entry, electronVersion: '44.0.0' }))])
    if (!compared.ok || !refused.ok)
      throw new Error('expected two comparisons')

    const text = formatBenchCompare(compared.scenarios)

    for (const value of [...OFFSETS.map(offset => (16 + offset).toFixed(2)), 'sigma 0.741', 'floor 0.5', 'within-noise', 'lowConfidence true', 'stale false'])
      expect(text).toContain(value)
    expect(formatBenchCompare(refused.scenarios)).toContain('electron-mismatch: 43.8.7 vs 44.0.0')
  })
})
