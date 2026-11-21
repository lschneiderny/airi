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

/** A commit whose CPU ms per frame and `body-head` stage sit at the given centres, with a 0.1 ms spread; `render` never moves. */
function timedCommit(cpuMsPerFrame: number, bodyHeadMs: number, options: RunOptions = {}): BenchRunRecord[] {
  return OFFSETS.map((offset, index) => {
    const base = run(16, { ...options, run: index + 1 })
    const stage = (msPerFrame: number) => ({ msPerFrame, p95MsApprox: msPerFrame * 2, n: 600 })
    return {
      ...base,
      metrics: { ...base.metrics, stageWindowCpuMsPerFrame: cpuMsPerFrame + offset * 0.1 },
      stages: { 'body-head': stage(bodyHeadMs + offset * 0.1), 'render': stage(2 + offset * 0.1) },
    }
  })
}

const timedHistory = Array.from({ length: 10 }, (_, index) => timedCommit(4, 1, { sha: `${index}`.repeat(40), t: T0 - (index + 1) * DAY })).flat()

describe('stage attribution', () => {
  const compareCpu = (runs: readonly BenchRunRecord[]) => compare(runs, { metric: 'stageWindowCpuMsPerFrame' })

  it('ranks the stage that grew under a regression, in JSON and text', () => {
    const result = compareCpu([...timedHistory, ...timedCommit(4, 1), ...timedCommit(5, 2, { sha: SHA_B, t: T0 + 1 })])
    const [scenario] = scenariosOf(result)
    if (scenario.status !== 'compared')
      throw new Error('expected a comparison')

    expect(scenario.comparisons[0].verdict).toBe('regression')
    expect(scenario.attribution.regression.stages[0].id).toBe('body-head')
    expect(scenario.attribution.regression.stages.map(stage => stage.id)).not.toContain('render')
    const text = formatBenchCompare(scenariosOf(result))
    expect(text).toContain('stage attribution (informational)')
    expect(text).toContain('stage body-head  +1.00 ms/frame')
  })

  it('prints the shrunk stage with signed values under an improvement', () => {
    const result = compareCpu([...timedHistory, ...timedCommit(5, 2), ...timedCommit(4, 1, { sha: SHA_B, t: T0 + 1 })])
    const [scenario] = scenariosOf(result)

    expect(scenario.status === 'compared' && scenario.comparisons[0].verdict).toBe('improvement')
    const text = formatBenchCompare(scenariosOf(result))
    expect(text).toContain('stage body-head  -1.00 ms/frame  (z -')
    expect(text).not.toContain('no timed stage moved')
  })

  it('says no timed stage moved when the metric moved but every stage held', () => {
    const text = formatBenchCompare(scenariosOf(compareCpu([...timedHistory, ...timedCommit(4, 1), ...timedCommit(5, 1, { sha: SHA_B, t: T0 + 1 })])))

    expect(text).toContain('  no timed stage moved: the cost is outside the timed stages (GPU, compositor, or untimed work)')
  })

  it('says stage timings were not recorded when the runs carry no stages', () => {
    const text = formatBenchCompare(scenariosOf(compare([...history, ...commit(16), ...commit(16 + 3 * SIGMA, { sha: SHA_B, t: T0 + 1 })])))

    expect(text).toContain('stage timings not recorded for this scenario')
  })

  it('prints no attribution under a within-noise verdict', () => {
    const text = formatBenchCompare(scenariosOf(compareCpu([...timedHistory, ...timedCommit(4, 1), ...timedCommit(4, 2, { sha: SHA_B, t: T0 + 1 })])))

    expect(text).toContain('within-noise')
    expect(text).not.toContain('stage attribution')
  })

  it('gives a refused scenario no attribution', () => {
    const otherHost = timedCommit(5, 2, { sha: SHA_B }).map(entry => ({ ...entry, host: { ...host, cpuModel: 'Apple M2' } }))

    const [scenario] = scenariosOf(compareCpu([...timedCommit(4, 1), ...otherHost]))

    expect(scenario.status).toBe('refused')
    expect('attribution' in scenario).toBe(false)
  })
})
