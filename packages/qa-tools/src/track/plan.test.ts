import type { BenchRefusalReason, BenchRunRecord } from '@proj-airi/stage-shared/perf/usage'

import type { AcceptedCost } from './accepted-costs'
import type { TrackEvent } from './findings'
import type { Candidate, PlanInput } from './plan'

import { BENCH_STALE_MS } from '@proj-airi/stage-shared/perf/usage'
import { describe, expect, it } from 'vitest'

import { compareBenchRefs } from '../perf/bench'
import { foldFindings } from './findings'
import { acceptedCloses, buildFinding, confirmCandidates, confirmSteps, eligibleRuns, fixedCloses, judgeComparison, matchOpen, planSubjects } from './plan'

const NOW = 1_794_000_000_000
const BASE = 'a'.repeat(40)
const HEAD = 'b'.repeat(40)
const K = 'c'.repeat(40)
const NEXT = 'd'.repeat(40)
const ANCHOR = 'e'.repeat(40)
const scenarios = ['mmd-idle', 'mmd-talk', 'live2d-idle'] as const
const subject = { kind: 'pr', sha: HEAD, pr: 1 } as const
const baseline = { kind: 'merge-base', sha: BASE } as const
const accepted: AcceptedCost = { id: 'physics-cost', scenario: 'mmd-idle', metric: 'p95FrameMsApprox', reason: 'More physics work.', accepted: '2026-11-20' }

function runs(sha: string, value = 16, options: Partial<BenchRunRecord> = {}): BenchRunRecord[] {
  return Array.from({ length: 5 }, (_, index) => ({
    v: 1,
    kind: 'bench-run',
    t: NOW + index,
    sessionId: `bench-${index}`,
    matrix: 'bench-v1',
    scenario: 'mmd-idle',
    scenarioVersion: 1,
    run: index + 1,
    sha,
    dirty: false,
    diffHash: null,
    modelFingerprint: 'mmd-fixture',
    buildMode: 'dev',
    electronVersion: '43',
    host: { platform: 'linux', arch: 'x64', cpuModel: 'fixture-cpu', cores: 8, totalMemKb: 1000, gpu: null },
    valid: true,
    metrics: {
      fps: 60,
      p50FrameMs: 16,
      p95FrameMsApprox: value,
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
    ...options,
  }))
}

function benched(sha: string, t = NOW - 1, pr?: number): TrackEvent {
  return {
    v: 1,
    event: 'subject',
    t,
    tickId: 'earlier',
    subject: pr === undefined ? { kind: 'main', sha } : { kind: 'pr', sha, pr },
    baseline: null,
    scenarios: [...scenarios],
    outcome: 'benched',
  }
}

function pr(number = 1, head = HEAD, changedPaths = ['packages/stage-ui-mmd/src/body.ts']) {
  return { number, head, baselineSha: BASE, baseRef: 'feature-parent', changedPaths }
}

function input(overrides: Partial<PlanInput> = {}): PlanInput {
  return { mainTip: null, prs: [pr()], runs: [], events: [], now: NOW, tickId: 'tick-1', ...overrides }
}

function comparison(history = [...runs(BASE), ...runs(HEAD, 20)]) {
  const result = compareBenchRefs({
    runs: eligibleRuns(history),
    a: { kind: 'sha', text: BASE, prefix: BASE },
    b: { kind: 'sha', text: HEAD, prefix: HEAD },
    local: null,
    scenario: 'mmd-idle',
    metric: null,
  })
  if (!result.ok || !result.scenarios[0])
    throw new Error('Fixture must produce a scenario comparison')
  return result.scenarios[0]
}

function judged(history?: BenchRunRecord[]) {
  return judgeComparison({ scenarioComparison: comparison(history), subject, baseline, events: [], tickId: 'tick-1', now: NOW })
}

function candidate(): Candidate {
  const first = judged().candidates[0]
  if (!first)
    throw new Error('Fixture must regress')
  return first
}

function confirmed() {
  const [result] = confirmCandidates({ candidates: [candidate()], runs: [...runs(BASE), ...runs(HEAD, 20)], confirmStartT: NOW, history: [] })
  if (!result)
    throw new Error('Fixture must confirm')
  return result
}

function finding() {
  return buildFinding({ candidate: confirmed(), attribution: { stages: [], timed: false, noStageMoved: true }, rangeCommits: 2, renderLoopCommits: [{ sha: HEAD, subject: 'feat: more physics' }], tickId: 'tick-1', now: NOW })
}

describe('planSubjects', () => {
  it('plans the main tip with five runs and its newest different benched predecessor', async () => {
    const result = await planSubjects(input({ mainTip: HEAD, prs: [], events: [benched(ANCHOR, NOW - 20), benched(BASE, NOW - 10), benched(HEAD)] }))
    expect(result[0]).toMatchObject({ subject: { kind: 'main', sha: HEAD }, scenarios, runs: 5 })
    expect(result[0]?.baselines.map(row => row.sha)).toEqual([BASE, BASE, BASE])
  })

  it.each([[2, false], [4, true], [7, false]] as const)('uses a %i-day main anchor only in the 3 to 6 day window', async (days, present) => {
    const result = await planSubjects(input({ mainTip: HEAD, prs: [], events: [benched(ANCHOR, NOW - days * BENCH_STALE_MS / 7), benched(BASE)] }))
    expect(result[0]?.baselines.filter(row => row.kind === 'anchor').map(row => row.sha)).toEqual(present ? [ANCHOR, ANCHOR, ANCHOR] : [])
  })

  it('uses the merge base of a stacked PR even when its base branch moved', async () => {
    const [result] = await planSubjects(input())
    expect(result?.baselines).toEqual([
      { kind: 'merge-base', sha: BASE, scenario: 'mmd-idle', metrics: expect.any(Array) },
      { kind: 'merge-base', sha: BASE, scenario: 'mmd-talk', metrics: expect.any(Array) },
    ])
    expect(result?.runs).toBe(3)
  })

  it('does not schedule a PR that changes only chat state', async () => {
    expect(await planSubjects(input({ prs: [pr(1, HEAD, ['packages/stage-ui/src/stores/chat.ts'])] }))).toEqual([])
  })

  it('queues main, never-benched PRs in discovery order, then the oldest PR bench', async () => {
    const result = await planSubjects(input({
      mainTip: NEXT,
      prs: [pr(1), pr(3), pr(2), pr(4)],
      events: [benched(BASE, NOW - 100, 2), benched(HEAD, NOW - 1, 1)],
    }))
    expect(result.map(row => row.subject.pr ?? 'main')).toEqual(['main', 3, 4, 2, 1])
  })

  it('defers a fifth PR that does not fit and starts a smaller later PR', async () => {
    const prs = Array.from({ length: 6 }, (_, i) => pr(i + 1, String(i + 1).repeat(40), i === 5 ? ['packages/stage-ui-live2d/src/body.ts'] : undefined))
    const unconstrained = await planSubjects(input({ prs }))
    const four = unconstrained.slice(0, 4).reduce((sum, row) => sum + row.estimateSeconds, 0)
    const smaller = unconstrained[5]?.estimateSeconds ?? 0
    const result = await planSubjects(input({ prs, deadline: NOW + (four + smaller) * 1000 }))
    expect(result.map(row => row.outcome)).toEqual(['planned', 'planned', 'planned', 'planned', 'deferred', 'planned'])
    expect(result[4]?.reason).toBe('capacity')
  })

  it('recognizes eligible valid clean cached sides and still plans comparisons', async () => {
    const history = scenarios.flatMap(scenario => [...runs(BASE, 16, { scenario }), ...runs(HEAD, 16, { scenario })])
    const [result] = await planSubjects(input({ runs: history }))
    expect(result?.steps).toEqual([])
    expect(result?.outcome).toBe('already-benched')
    expect(result?.baselines).toHaveLength(2)
  })

  it('does not count invalid or dirty runs as cached', async () => {
    const [result] = await planSubjects(input({ runs: [...runs(BASE, 16, { valid: false }), ...runs(HEAD, 16, { dirty: true })] }))
    expect(result?.steps.map(step => step.sha)).toEqual([BASE, HEAD])
  })

  it.each([3, 5])('requires all %i eligible clean runs before caching a scenario', async (requested) => {
    const cached = scenarios.flatMap(scenario => runs(BASE, 16, { scenario }).slice(0, requested))
    const otherScenarios = scenarios.filter(scenario => scenario !== 'mmd-idle')
      .flatMap(scenario => runs(HEAD, 16, { scenario }).slice(0, requested))
    for (const count of [1, requested - 1, requested]) {
      const [result] = await planSubjects(input({
        manual: { baselineSha: BASE, subjectSha: HEAD, runs: requested },
        runs: [...cached, ...otherScenarios, ...runs(HEAD).slice(0, count)],
      }))
      expect(result?.steps).toEqual(count === requested
        ? []
        : [{ kind: 'bench', sha: HEAD, scenarios: ['mmd-idle'], runs: requested }])
      expect(result?.outcome).toBe(count === requested ? 'already-benched' : 'planned')
    }
  })

  it.each([
    ['dirty flag', { dirty: true, diffHash: null }],
    ['dirty diff', { dirty: true, diffHash: 'fixture-diff' }],
    ['invalid', { valid: false }],
  ] satisfies [string, Partial<BenchRunRecord>][])('rebenches the exact scenario when a %s run would fill its cache', async (_, overrides) => {
    const cached = scenarios.flatMap(scenario => runs(BASE, 16, { scenario }))
    const otherScenarios = scenarios.filter(scenario => scenario !== 'mmd-idle')
      .flatMap(scenario => runs(HEAD, 16, { scenario }))
    const [result] = await planSubjects(input({
      manual: { baselineSha: BASE, subjectSha: HEAD, runs: 3 },
      runs: [...cached, ...otherScenarios, ...runs(HEAD).slice(0, 2), ...runs(HEAD, 16, overrides).slice(2, 3)],
    }))
    expect(result?.steps).toEqual([{ kind: 'bench', sha: HEAD, scenarios: ['mmd-idle'], runs: 3 }])
  })

  it('keeps separate model keys when the newest run is Live2D', async () => {
    const history = scenarios.flatMap((scenario, i) => [
      ...runs(BASE, 16, { scenario, modelFingerprint: scenario, t: NOW + i }),
      ...runs(HEAD, 16, { scenario, modelFingerprint: scenario, t: NOW + i }),
    ])
    const [result] = await planSubjects(input({ mainTip: HEAD, prs: [], events: [benched(BASE)], runs: history }))
    expect(eligibleRuns(history)).toHaveLength(30)
    expect(result?.resets).toEqual([])
    expect(result?.steps).toEqual([])
  })

  it('records an environment reset before capacity deferral and recovers next tick', async () => {
    const changed = runs(HEAD, 20).map(run => ({ ...run, host: { ...run.host, gpu: 'fixture-new-gpu' }, t: NOW + 10 }))
    const history = [...runs(BASE), ...changed]
    const [first] = await planSubjects(input({ prs: [pr(1, HEAD, ['packages/stage-ui-live2d/src/body.ts', 'packages/stage-ui-mmd/src/body.ts'])], runs: history, deadline: NOW }))
    expect(first?.resets).toMatchObject([{ kind: 'environment', baselineSha: BASE, scenario: 'mmd-idle' }])
    expect(first?.outcome).toBe('deferred')
    const recovered = [...history, ...runs(BASE).map(run => ({ ...run, host: { ...run.host, gpu: 'fixture-new-gpu' }, t: NOW + 20 }))]
    const [second] = await planSubjects(input({ runs: recovered, events: first?.resets }))
    expect(second?.resets).toEqual([])
    expect(comparison(recovered).status).toBe('compared')
  })

  it('retains a deferred environment rebench and recovers only from the next tick scheduled runs', async () => {
    const manual = { baselineSha: BASE, subjectSha: HEAD, scenario: 'mmd-idle' as const, runs: 3 }
    const changed = runs(HEAD, 20).map(run => ({ ...run, host: { ...run.host, gpu: 'fixture-new-gpu' }, t: NOW + 10 }))
    const history = [...runs(BASE), ...changed]
    const [first] = await planSubjects(input({ manual, runs: history, deadline: NOW }))
    expect(first?.outcome).toBe('deferred')
    expect(first?.resets).toMatchObject([{ kind: 'environment', subjectSha: HEAD, baselineSha: BASE, scenario: 'mmd-idle' }])
    expect(first?.steps).toEqual([{ kind: 'bench', sha: BASE, scenarios: ['mmd-idle'], runs: 3 }])
    if (!first)
      throw new Error('Expected the first tick plan')
    const events: TrackEvent[] = [
      ...first.resets,
      { v: 1, t: NOW, event: 'subject', tickId: 'tick-1', subject: first.subject, baseline: { kind: 'manual', sha: BASE }, scenarios: [...first.scenarios], outcome: 'deferred', reason: 'capacity' },
    ]
    // A deferred tick executes no steps. The next tick must schedule the baseline before any recovery can exist.
    const [second] = await planSubjects(input({ manual, runs: history, events, tickId: 'tick-2', now: NOW + 20 }))
    expect(second?.outcome).toBe('planned')
    expect(second?.steps).toEqual([{ kind: 'bench', sha: BASE, scenarios: ['mmd-idle'], runs: 3 }])
    if (!second)
      throw new Error('Expected the second tick plan')
    const produced = second.steps.flatMap(step => step.scenarios.flatMap(scenario =>
      runs(step.sha, 16, { scenario, t: NOW + 20 }).slice(0, step.runs).map(run => ({ ...run, host: { ...run.host, gpu: 'fixture-new-gpu' } }))))
    const recovered = [...history, ...produced]
    const [completed] = await planSubjects(input({ manual, runs: recovered, tickRuns: produced, events, tickId: 'tick-2', now: NOW + 20 }))
    expect(completed?.resets).toEqual([])
    expect(completed?.steps).toEqual([])
    expect(completed?.outcome).toBe('already-benched')
    const compared = comparison(recovered)
    expect(compared.status).toBe('compared')
    expect(judgeComparison({ scenarioComparison: compared, subject: second.subject, baseline: { kind: 'manual', sha: BASE }, events, tickId: 'tick-2', now: NOW + 20 }).candidates.map(row => row.metric)).toEqual(['p95FrameMsApprox'])
  })

  it('lets runs recorded in this tick choose the environment ahead of history', () => {
    const old = runs(BASE, 16, { t: NOW + 100 })
    const current = runs(HEAD, 20, { t: NOW, modelFingerprint: 'new-model' })
    expect(eligibleRuns([...old, ...current], current).map(run => run.sha)).toEqual(Array.from({ length: 5 }).fill(HEAD))
  })

  it('runs a daytime manual plan without a deadline using the requested count and scenario', async () => {
    const [result] = await planSubjects(input({ now: new Date('2026-11-20T14:00:00Z').getTime(), manual: { baselineSha: BASE, subjectSha: HEAD, scenario: 'mmd-talk', runs: 7 } }))
    expect(result).toMatchObject({ subject: { kind: 'manual', sha: HEAD }, scenarios: ['mmd-talk'], runs: 7, outcome: 'planned' })
    expect(result?.baselines).toMatchObject([{ kind: 'manual', sha: BASE }])
    expect(result?.steps.map(step => step.runs)).toEqual([7, 7])
  })

  it('uses all scenarios in manual mode and honors an explicit deadline', async () => {
    const [result] = await planSubjects(input({ manual: { baselineSha: BASE, subjectSha: HEAD, runs: 3 }, deadline: NOW }))
    expect(result?.scenarios).toEqual(scenarios)
    expect(result?.outcome).toBe('deferred')
  })

  it('counts the fresh ABBA reserve even when both sides are cached', async () => {
    const [result] = await planSubjects(input({ runs: [...runs(BASE), ...runs(HEAD)], manual: { baselineSha: BASE, subjectSha: HEAD, runs: 3, scenario: 'mmd-idle' } }))
    expect(result?.estimateSeconds).toBe(12 * 240)
  })

  it.each([[4319, 'deferred'], [4320, 'planned']] as const)('charges both missing sides and ABBA against %i seconds of capacity', async (seconds, outcome) => {
    const [result] = await planSubjects(input({
      manual: { baselineSha: BASE, subjectSha: HEAD, scenario: 'mmd-idle', runs: 3 },
      deadline: NOW + seconds * 1000,
    }))
    // Each idle launch takes 100 + 20 + 120 seconds: six initial launches and twelve fresh ABBA launches.
    expect(result?.estimateSeconds).toBe(4320)
    expect(result?.outcome).toBe(outcome)
    expect(result?.steps).toEqual([
      { kind: 'bench', sha: BASE, scenarios: ['mmd-idle'], runs: 3 },
      { kind: 'bench', sha: HEAD, scenarios: ['mmd-idle'], runs: 3 },
    ])
  })

  it('uses the newest already-benched main predecessor as the previous baseline', async () => {
    const previous = benched(BASE, NOW - 1)
    if (previous.event !== 'subject')
      throw new Error('Expected a subject event')
    const [result] = await planSubjects(input({
      mainTip: HEAD,
      prs: [],
      events: [benched(ANCHOR, NOW - 2), { ...previous, outcome: 'already-benched' }, benched(HEAD)],
    }))
    expect(result?.baselines.map(row => ({ kind: row.kind, sha: row.sha, scenario: row.scenario }))).toEqual([
      { kind: 'previous', sha: BASE, scenario: 'mmd-idle' },
      { kind: 'previous', sha: BASE, scenario: 'mmd-talk' },
      { kind: 'previous', sha: BASE, scenario: 'live2d-idle' },
    ])
  })

  it('rebaselines only the accepted metric on later ticks and flags a further slowdown', async () => {
    const history = [...runs(BASE), ...runs(HEAD, 20)]
    expect(judged(history).candidates.map(row => row.metric)).toEqual(['p95FrameMsApprox'])
    const options = { accepted: [accepted], introducing: async () => K, isAncestor: async (a: string, b: string) => a === b }
    const [second] = await planSubjects(input({ ...options, prs: [pr(1, NEXT)], runs: [...history, ...runs(K, 20), ...runs(NEXT, 20)] }))
    expect(second?.baselines.filter(row => row.scenario === 'mmd-idle')).toEqual([
      { ...baseline, scenario: 'mmd-idle', metrics: ['fps', 'stageWindowCpuPct', 'stageWindowCpuMsPerFrame', 'stageWindowWorkingSetKb'] },
      { kind: 'accepted', sha: K, scenario: 'mmd-idle', metrics: ['p95FrameMsApprox'] },
    ])
    const quiet = compareBenchRefs({ runs: [...runs(K, 20), ...runs(NEXT, 20)], a: { kind: 'sha', text: K, prefix: K }, b: { kind: 'sha', text: NEXT, prefix: NEXT }, scenario: 'mmd-idle', metric: accepted.metric, local: null })
    expect(quiet.ok && quiet.scenarios[0]?.status === 'compared' && quiet.scenarios[0].comparisons[0]?.verdict).toBe('within-noise')
    if (!quiet.ok || !quiet.scenarios[0])
      throw new Error('Expected accepted comparison')
    expect(judgeComparison({ scenarioComparison: quiet.scenarios[0], subject: { ...subject, sha: NEXT }, baseline: { kind: 'accepted', sha: K }, events: [], tickId: 'tick-2', now: NOW }).candidates).toEqual([])
    const [third] = await planSubjects(input({ ...options, prs: [pr(1, NEXT)], runs: [...runs(BASE), ...runs(K, 20), ...runs(NEXT, 24)] }))
    expect(third?.baselines.filter(row => row.kind === 'accepted')).toEqual([{ kind: 'accepted', sha: K, scenario: 'mmd-idle', metrics: [accepted.metric] }])
    const later = compareBenchRefs({ runs: [...runs(K, 20), ...runs(NEXT, 24)], a: { kind: 'sha', text: K, prefix: K }, b: { kind: 'sha', text: NEXT, prefix: NEXT }, scenario: 'mmd-idle', metric: accepted.metric, local: null })
    if (!later.ok || !later.scenarios[0])
      throw new Error('Expected later comparison')
    const nextCandidates = judgeComparison({ scenarioComparison: later.scenarios[0], subject: { ...subject, sha: NEXT }, baseline: { kind: 'accepted', sha: K }, events: [], tickId: 'tick-3', now: NOW }).candidates
    const [confirmed] = confirmCandidates({ candidates: nextCandidates, runs: [...runs(K, 20), ...runs(NEXT, 24)], history: [], confirmStartT: NOW })
    if (!confirmed)
      throw new Error('Further slowdown must confirm')
    expect(buildFinding({ candidate: confirmed, attribution: { stages: [], timed: false, noStageMoved: true }, rangeCommits: 1, renderLoopCommits: [], tickId: 'tick-3', now: NOW })).toMatchObject({ event: 'finding-open', baseline: { kind: 'accepted', sha: K }, subject: { sha: NEXT } })
  })

  it('resolves an accepted entry again on main after a rebase merge', async () => {
    const [result] = await planSubjects(input({ mainTip: NEXT, prs: [], events: [benched(BASE)], accepted: [accepted], introducing: async (_id, ref) => ref === NEXT ? ANCHOR : K, isAncestor: async () => false }))
    expect(result?.baselines.filter(row => row.kind === 'accepted')).toEqual([{ kind: 'accepted', sha: ANCHOR, scenario: 'mmd-idle', metrics: [accepted.metric] }])
    expect(result?.steps.map(step => step.sha)).toEqual([BASE, ANCHOR, NEXT])
  })

  it('keeps the regular baseline when acceptance predates it or is absent', async () => {
    for (const introducing of [async () => null, async () => K]) {
      const [result] = await planSubjects(input({ accepted: [accepted], introducing, isAncestor: async () => true }))
      expect(result?.baselines.map(row => row.kind)).toEqual(['merge-base', 'merge-base'])
    }
  })
})

describe('judging and confirmation', () => {
  it.each(['electron-mismatch', 'build-mode-mismatch', 'scenario-mismatch'] as const)('records %s once and does not retry on the next tick', (reason) => {
    const source = { ...comparison(), status: 'refused' as const, refusals: [{ reason, detail: reason }] }
    const options = { scenarioComparison: source, subject, baseline, events: [], tickId: 'tick-1', now: NOW }
    const first = judgeComparison(options)
    expect(first).toMatchObject({ outcome: 'baseline-reset', candidates: [], resets: [{ kind: 'not-comparable', reasons: [reason] }] })
    expect(judgeComparison({ ...options, events: first.resets, tickId: 'tick-2' })).toMatchObject({ outcome: 'ignored', resets: [], candidates: [] })
  })

  it.each(['host-mismatch', 'model-mismatch'] as const)('throws if %s escapes eligibility filtering', (reason) => {
    expect(() => judgeComparison({ scenarioComparison: { ...comparison(), status: 'refused', refusals: [{ reason, detail: reason }] }, subject, baseline, events: [], tickId: 't', now: NOW })).toThrow(reason)
  })

  it.each(['no-runs', 'too-few-runs'] as const)('rebenches %s once per subject per tick then ignores it', (reason) => {
    const options = { scenarioComparison: { ...comparison(), status: 'refused' as const, refusals: [{ reason, detail: reason }] }, subject, baseline, events: [], tickId: 't', now: NOW }
    expect(judgeComparison(options)).toMatchObject({ outcome: 'rebench', candidates: [], reasons: [reason] })
    expect(judgeComparison({ ...options, rebenched: true })).toMatchObject({ outcome: 'ignored', reasons: [reason] })
  })

  it.each(['mixed-groups', 'invalid-run'] satisfies BenchRefusalReason[])('ignores %s without a retry or finding', (reason) => {
    expect(judgeComparison({ scenarioComparison: { ...comparison(), status: 'refused', refusals: [{ reason, detail: reason }] }, subject, baseline, events: [], tickId: 't', now: NOW })).toMatchObject({ outcome: 'ignored', candidates: [], resets: [], reasons: [reason] })
  })

  it('gives environment invariant failures precedence over other refusals', () => {
    expect(() => judgeComparison({ scenarioComparison: { ...comparison(), status: 'refused', refusals: [{ reason: 'too-few-runs', detail: '' }, { reason: 'host-mismatch', detail: '' }] }, subject, baseline, events: [], tickId: 't', now: NOW })).toThrow('host-mismatch')
  })

  it('creates one candidate for each regressing metric and never for stale comparisons', () => {
    expect(judged().candidates.map(row => row.metric)).toEqual(['p95FrameMsApprox'])
    expect(judged([...runs(BASE, 16, { t: NOW - BENCH_STALE_MS - 1 }), ...runs(HEAD, 20)]).candidates).toEqual([])
  })

  it('keeps every regressing metric while leaving quiet metrics out', () => {
    const slower = runs(HEAD, 20).map(run => ({ ...run, metrics: { ...run.metrics, fps: 45, stageWindowCpuPct: 50 } }))
    expect(judged([...runs(BASE), ...slower]).candidates.map(row => row.metric)).toEqual(['p95FrameMsApprox', 'fps', 'stageWindowCpuPct'])
  })

  it.each(['A', 'B', 'both'] as const)('always confirms A B B A when %s is cached', async (cached) => {
    const history = [...(cached !== 'B' ? runs(BASE) : []), ...(cached !== 'A' ? runs(HEAD, 20) : [])]
    const [plan] = await planSubjects(input({ runs: history, manual: { baselineSha: BASE, subjectSha: HEAD, scenario: 'mmd-idle', runs: 5 } }))
    expect(plan?.steps.map(step => step.sha)).toEqual(cached === 'both' ? [] : cached === 'A' ? [HEAD] : [BASE])
    const block = confirmSteps(candidate(), 5)
    expect(block.map(step => [step.sha, step.runs, step.scenarios])).toEqual([
      [BASE, 3, ['mmd-idle']],
      [HEAD, 3, ['mmd-idle']],
      [HEAD, 3, ['mmd-idle']],
      [BASE, 3, ['mmd-idle']],
    ])
  })

  it('drops an initial regression when fresh ABBA runs no longer regress', () => {
    const history = [...runs(BASE, 16, { t: NOW - 10 }), ...runs(HEAD, 20, { t: NOW - 10 })]
    expect(confirmCandidates({ candidates: [candidate()], runs: [...history, ...runs(BASE), ...runs(HEAD)], confirmStartT: NOW, history })).toEqual([])
  })

  it('requires fresh eligible runs on both sides rather than reusing cached regressions', () => {
    expect(confirmCandidates({ candidates: [candidate()], runs: [...runs(BASE, 16, { t: NOW - 1 }), ...runs(HEAD, 20)], confirmStartT: NOW, history: [] })).toEqual([])
  })

  it('never counts noise history as fresh confirmation runs', () => {
    expect(confirmCandidates({
      candidates: [candidate()],
      runs: runs(HEAD, 20),
      confirmStartT: NOW,
      history: runs(BASE),
    })).toEqual([])
  })

  it('filters confirmation sides and noise history by each scenario environment', () => {
    const newHost = { ...runs(BASE)[0]?.host, platform: 'linux', arch: 'x64', cpuModel: 'fixture-cpu', cores: 8, totalMemKb: 1000, gpu: 'fixture-new-gpu' }
    const old = [...runs(BASE, 16, { t: NOW - 100 }), ...runs(HEAD, 30, { t: NOW - 100 })]
    const fresh = [...runs(BASE, 16, { host: newHost }), ...runs(HEAD, 16, { host: newHost })]
    expect(confirmCandidates({ candidates: [candidate()], runs: [...old, ...fresh], confirmStartT: NOW, history: old })).toEqual([])
  })

  it('confirms a fresh regression with filtered history and marks it confirmed', () => {
    expect(confirmed()).toMatchObject({ confirmed: true, comparison: { verdict: 'regression' } })
  })

  it('uses ten eligible noisy history commits during confirmation and excludes another model history', () => {
    const history = Array.from({ length: 10 }, (_, group) =>
      runs((group + 1).toString(16).padStart(40, '0'), 16, { t: NOW - 100 })
        .map((run, index) => ({ ...run, metrics: { ...run.metrics, p95FrameMsApprox: 6 + index * 5 } }))).flat()
    const fresh = [...runs(BASE), ...runs(HEAD, 20)]
    expect(confirmCandidates({ candidates: [candidate()], runs: fresh, confirmStartT: NOW, history })).toEqual([])
    const ineligible = history.map(run => ({ ...run, modelFingerprint: 'other-fixture-model' }))
    const confirmed = confirmCandidates({ candidates: [candidate()], runs: fresh, confirmStartT: NOW, history: ineligible })
    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]?.comparison).toMatchObject({ verdict: 'regression', sigma: 0, historyCommits: 0, noise: 'pair-local' })
  })

  it('includes the minimum three confirmation runs per side exactly at confirmStartT', () => {
    const fresh = [...runs(BASE, 16, { t: NOW }).slice(0, 3), ...runs(HEAD, 20, { t: NOW }).slice(0, 3)]
    const confirmed = confirmCandidates({ candidates: [candidate()], runs: fresh, confirmStartT: NOW, history: [] })
    expect(confirmed).toHaveLength(1)
    expect(confirmed[0]?.comparison.valuesA.map(run => run.t)).toEqual([NOW, NOW, NOW])
    expect(confirmed[0]?.comparison.valuesB.map(run => run.t)).toEqual([NOW, NOW, NOW])
  })
})

describe('finding lifecycle', () => {
  it('builds a confirmed finding with attribution, range and closure commands', () => {
    const result = finding()
    expect(result).toMatchObject({
      event: 'finding-open',
      subject,
      baseline,
      metric: 'p95FrameMsApprox',
      medianA: 16,
      medianB: 20,
      rangeCommits: 2,
      renderLoopCommits: [{ sha: HEAD, subject: 'feat: more physics' }],
      lowConfidence: true,
      reproduce: `pnpm perf:track tick --baseline ${BASE} --subject ${HEAD} --scenario mmd-idle`,
      closeCheck: `pnpm perf compare --bench ${BASE} <fix sha> --scenario mmd-idle --metric p95FrameMsApprox shows within-noise or improvement`,
    })
  })

  it('copies zero-noise stage attribution into the finding', () => {
    const result = buildFinding({
      candidate: confirmed(),
      attribution: { stages: [{ id: 'physics', deltaMsPerFrame: 1, z: null, zeroNoise: true }], timed: true, noStageMoved: false },
      rangeCommits: 1,
      renderLoopCommits: [],
      tickId: 'tick-1',
      now: NOW,
    })
    expect(result.topStages).toEqual([{ id: 'physics', deltaMsPerFrame: 1, z: null, zeroNoise: true }])
  })

  it('observes an overlapping anchor finding again across ticks instead of opening a duplicate', async () => {
    const open = foldFindings([finding()]).open
    const next = { ...confirmed(), baseline: { kind: 'anchor' as const, sha: ANCHOR } }
    const match = await matchOpen({ candidate: next, open, rangesOverlap: async () => true })
    expect(match?.id).toBe(open[0]?.id)
    if (!match)
      throw new Error('Expected overlapping finding')
    const folded = foldFindings([finding(), { v: 1, t: NOW + 1, event: 'observed-again', id: match.id, tickId: 'tick-2', subject: next.subject, baselineSha: next.baseline.sha, difference: next.comparison.difference }])
    expect(folded.open).toHaveLength(1)
    expect(folded.open[0]?.observedAgain).toBe(1)
  })

  it('matches patch-equivalent PR and main ranges after a rebase merge', async () => {
    expect(await matchOpen({ candidate: { ...confirmed(), subject: { kind: 'main', sha: NEXT } }, open: foldFindings([finding()]).open, rangesOverlap: async () => true })).toMatchObject({ id: finding().id })
  })

  it('does not match disjoint ranges or another metric or scenario', async () => {
    const open = foldFindings([finding()]).open
    expect(await matchOpen({ candidate: candidate(), open, rangesOverlap: async () => false })).toBeUndefined()
    expect(await matchOpen({ candidate: { ...candidate(), metric: 'fps' }, open, rangesOverlap: async () => true })).toBeUndefined()
    expect(await matchOpen({ candidate: { ...candidate(), scenario: 'live2d-idle' }, open, rangesOverlap: async () => true })).toBeUndefined()
  })

  it.each([K, NEXT])('closes an in-range or late acceptance at %s and benches its introducing sha', async (introducing) => {
    const result = await acceptedCloses({
      open: foldFindings([finding()]).open,
      accepted: [{ entry: accepted, introducing }],
      isAncestor: async (a, b) => a === b || (introducing === K ? a === K && b === HEAD : a === HEAD && b === NEXT),
      inRange: async () => false,
      now: NOW + 1,
    })
    expect(result.closes).toMatchObject([{ event: 'finding-close', id: finding().id, resolution: 'accepted', by: 'tracker', at: introducing }])
    expect(result.steps).toEqual([{ kind: 'rebaseline', sha: introducing, scenarios: ['mmd-idle'], runs: 3 }])
    expect(foldFindings([finding(), ...result.closes]).open).toEqual([])
  })

  it('rejects unrelated acceptance and accepts a patch-equivalent landed range', async () => {
    const options = { open: foldFindings([finding()]).open, accepted: [{ entry: accepted, introducing: NEXT }], isAncestor: async () => false, now: NOW }
    expect((await acceptedCloses({ ...options, inRange: async () => false })).closes).toEqual([])
    expect((await acceptedCloses({ ...options, inRange: async () => true })).closes).toHaveLength(1)
  })

  it.each(['within-noise', 'improvement'] as const)('closes fixed on a later same-PR %s comparison with the finding baseline', (verdict) => {
    const next = { ...candidate(), subject: { ...subject, sha: NEXT }, comparison: { ...candidate().comparison, verdict } }
    const closes = fixedCloses({ open: foldFindings([finding()]).open, comparisons: [next], now: NOW + 1 })
    expect(closes).toMatchObject([{ id: finding().id, resolution: 'fixed', at: NEXT, by: 'tracker' }])
    expect(foldFindings([finding(), ...closes]).open).toEqual([])
  })

  it('does not close fixed for the same sha, another line, another baseline or another metric', () => {
    const quiet = { ...candidate(), comparison: { ...candidate().comparison, verdict: 'within-noise' as const } }
    const comparisons = [
      quiet,
      { ...quiet, subject: { kind: 'main' as const, sha: NEXT } },
      { ...quiet, subject: { ...subject, sha: NEXT, pr: 2 } },
      { ...quiet, subject: { ...subject, sha: NEXT }, baseline: { ...baseline, sha: K } },
      { ...quiet, subject: { ...subject, sha: NEXT }, metric: 'fps' as const },
    ]
    expect(fixedCloses({ open: foldFindings([finding()]).open, comparisons, now: NOW + 1 })).toEqual([])
  })

  it('closes a main finding on a later main subject', () => {
    const opened = { ...finding(), subject: { kind: 'main' as const, sha: HEAD } }
    const quiet = { ...candidate(), subject: { kind: 'main' as const, sha: NEXT }, comparison: { ...candidate().comparison, verdict: 'within-noise' as const } }
    expect(fixedCloses({ open: foldFindings([opened]).open, comparisons: [quiet], now: NOW + 1 })).toMatchObject([{ resolution: 'fixed', at: NEXT }])
  })
})
