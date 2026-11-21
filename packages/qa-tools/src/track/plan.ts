import type { BenchComparison, BenchMetric, BenchRunRecord } from '@proj-airi/stage-shared/perf/usage'

import type { BenchScenarioId } from '../bench/matrix'
import type { BenchScenarioAttribution, BenchScenarioComparison } from '../perf/bench'
import type { AcceptancePredicates, AcceptedCost } from './accepted-costs'
import type { BaselineResetEvent, FindingCloseEvent, FindingOpenEvent, OpenFinding, TrackEvent } from './findings'

import { TZDate } from '@date-fns/tz'
import { BENCH_METRICS, BENCH_MIN_RUNS, compareBench, environmentKey } from '@proj-airi/stage-shared/perf/usage'
import { isAfter, isBefore, subDays } from 'date-fns'

import { BENCH_V1, estimateSeconds, planLaunches } from '../bench/matrix'
import { acceptanceFor } from './accepted-costs'
import { closeCheck, findingId, reproduceCommand } from './findings'
import { scenariosForPaths } from './paths'

type Subject = FindingOpenEvent['subject']
type Baseline = FindingOpenEvent['baseline']
type Compared = Extract<BenchComparison, { status: 'compared' }>

/** A main anchor is a benched main tip 3 to 6 days old, inside the 7-day bench staleness window. */
const ANCHOR_MIN_DAYS = 3
const ANCHOR_MAX_DAYS = 6

/** Git facts are resolved by the caller, including each PR's merge base with its own base ref. */
export interface PlanInput {
  readonly mainTip: string | null
  readonly prs: readonly { readonly number: number, readonly head: string, readonly baselineSha: string, readonly baseRef: string, readonly changedPaths: readonly string[] }[] | null
  readonly runs: readonly BenchRunRecord[]
  readonly events: readonly TrackEvent[]
  readonly now: number
  readonly tickId: string
  readonly deadline?: number
  readonly manual?: { readonly baselineSha: string, readonly subjectSha: string, readonly scenario?: BenchScenarioId, readonly runs: number }
  readonly tickRuns?: readonly BenchRunRecord[]
  readonly accepted?: readonly AcceptedCost[]
  readonly introducing?: (id: string, subjectSha: string) => Promise<string | null>
  readonly isAncestor?: AcceptancePredicates['isAncestor']
}

export interface BenchStep {
  readonly kind: 'bench' | 'rebaseline'
  readonly sha: string
  readonly scenarios: readonly BenchScenarioId[]
  readonly runs: number
}

/** Each metric has exactly one baseline per scenario and regular baseline, even after an accepted cost. */
export type MetricBaseline = Baseline & { readonly scenario: BenchScenarioId, readonly metrics: readonly BenchMetric[] }
export interface SubjectPlan {
  readonly subject: Subject
  readonly baselines: readonly MetricBaseline[]
  readonly scenarios: readonly BenchScenarioId[]
  readonly runs: number
  readonly steps: readonly BenchStep[]
  readonly resets: readonly BaselineResetEvent[]
  readonly outcome: 'planned' | 'already-benched' | 'deferred'
  readonly reason?: 'capacity'
  readonly estimateSeconds: number
}

/**
 * Select current environments independently by scenario. Pass tick runs when available so this tick wins over
 * history. The returned runs are the only sides and noise history callers should pass to compareBenchRefs.
 */
export function eligibleRuns(runs: readonly BenchRunRecord[], tickRuns: readonly BenchRunRecord[] = []): BenchRunRecord[] {
  const newest = new Map<string, BenchRunRecord>()
  for (const source of [runs, tickRuns]) {
    const current = new Map<string, BenchRunRecord>()
    for (const run of source) {
      if (run.valid && (!current.has(run.scenario) || run.t >= (current.get(run.scenario)?.t ?? 0)))
        current.set(run.scenario, run)
    }
    for (const [scenario, run] of current)
      newest.set(scenario, run)
  }
  return runs.filter(run => run.valid && environmentKey(run) === environmentKey(newest.get(run.scenario) ?? run))
}

function secondsFor(scenarios: readonly BenchScenarioId[], runs: number) {
  return estimateSeconds(planLaunches(BENCH_V1.filter(row => scenarios.includes(row.id)), runs))
}

/**
 * Plans bench sides and metric baselines without performing I/O. Keep the raw history here to detect environment
 * resets; eligibleRuns narrows it before cache decisions. Predicates may read git in the composing caller.
 * Deferred plans retain their steps and resets for the tick log, but none of their steps may execute.
 */
export async function planSubjects(input: PlanInput): Promise<SubjectPlan[]> {
  const { mainTip, prs, events, manual, now } = input
  const benched = events.filter((event): event is Extract<TrackEvent, { event: 'subject' }> =>
    event.event === 'subject' && (event.outcome === 'benched' || event.outcome === 'already-benched'))
  const mains = benched.filter(event => event.subject.kind === 'main' && event.subject.sha !== mainTip).toSorted((a, b) => b.t - a.t)
  const previous = mains[0]
  // UTC days are always 24 hours, so the window does not shift across a daylight saving change.
  const today = new TZDate(now, 'UTC')
  const anchor = mains.find(event => !isAfter(event.t, subDays(today, ANCHOR_MIN_DAYS)) && !isBefore(event.t, subDays(today, ANCHOR_MAX_DAYS)))
  const allScenarios = BENCH_V1.map(row => row.id)
  const queue: { subject: Subject, baselines: Baseline[], scenarios: readonly BenchScenarioId[], runs: number }[] = []
  if (manual) {
    queue.push({ subject: { kind: 'manual', sha: manual.subjectSha }, baselines: [{ kind: 'manual', sha: manual.baselineSha }], scenarios: manual.scenario ? [manual.scenario] : allScenarios, runs: manual.runs })
  }
  else {
    if (mainTip) {
      const baselines: Baseline[] = []
      if (previous)
        baselines.push({ kind: 'previous', sha: previous.subject.sha })
      if (anchor)
        baselines.push({ kind: 'anchor', sha: anchor.subject.sha })
      queue.push({ subject: { kind: 'main', sha: mainTip }, baselines, scenarios: allScenarios, runs: 5 })
    }
    const lastBench = (number: number) => Math.max(-Infinity, ...benched.filter(event => event.subject.kind === 'pr' && event.subject.pr === number).map(event => event.t))
    for (const pr of [...(prs ?? [])].sort((a, b) => lastBench(a.number) - lastBench(b.number))) {
      const scenarios = scenariosForPaths(pr.changedPaths)
      if (scenarios.length)
        queue.push({ subject: { kind: 'pr', sha: pr.head, pr: pr.number }, baselines: [{ kind: 'merge-base', sha: pr.baselineSha }], scenarios, runs: BENCH_MIN_RUNS })
    }
  }
  const eligible = eligibleRuns(input.runs, input.tickRuns)
  const result: SubjectPlan[] = []
  let remainingSeconds = input.deadline === undefined ? Infinity : (input.deadline - now) / 1000
  for (const item of queue) {
    const baselines: MetricBaseline[] = []
    for (const regular of item.baselines) {
      for (const scenario of item.scenarios) {
        const metrics = new Map<BenchMetric, Baseline>(BENCH_METRICS.map(metric => [metric, regular]))
        for (const entry of input.accepted ?? []) {
          if (entry.scenario !== scenario)
            continue
          if (!input.introducing || !input.isAncestor)
            throw new Error('Accepted-cost planning requires introducing and isAncestor')
          const sha = await input.introducing(entry.id, item.subject.sha)
          if (sha && !(await input.isAncestor(sha, regular.sha))) {
            const current = metrics.get(entry.metric)
            // Several accepted entries may name one metric: retain the latest reachable introducing commit.
            if (current?.kind !== 'accepted' || await input.isAncestor(current.sha, sha))
              metrics.set(entry.metric, { kind: 'accepted', sha })
          }
        }
        const grouped = new Map<string, MetricBaseline>()
        for (const [metric, baseline] of metrics) {
          const key = `${baseline.kind}:${baseline.sha}`
          const row = grouped.get(key)
          grouped.set(key, { ...baseline, scenario, metrics: [...(row?.metrics ?? []), metric] })
        }
        baselines.push(...[...grouped.values()].sort((a, b) => Number(a.kind === 'accepted') - Number(b.kind === 'accepted')))
      }
    }
    const sides = new Map<string, Set<BenchScenarioId>>()
    for (const baseline of baselines)
      sides.set(baseline.sha, new Set([...(sides.get(baseline.sha) ?? []), baseline.scenario]))
    sides.set(item.subject.sha, new Set([...(sides.get(item.subject.sha) ?? []), ...item.scenarios]))
    const steps: BenchStep[] = []
    const resets: BaselineResetEvent[] = []
    for (const [sha, scenarios] of sides) {
      const missing: BenchScenarioId[] = []
      for (const scenario of scenarios) {
        const clean = eligible.filter(run => run.sha === sha && run.scenario === scenario && !run.dirty && run.diffHash === null)
        if (clean.length < item.runs)
          missing.push(scenario)
        const current = eligible.find(run => run.scenario === scenario)
        const old = input.runs.filter(run => run.sha === sha && run.scenario === scenario)
        if (current && old.length > 0 && !old.some(run => environmentKey(run) === environmentKey(current))) {
          resets.push({
            v: 1,
            event: 'baseline-reset',
            t: now,
            tickId: input.tickId,
            subjectSha: item.subject.sha,
            baselineSha: sha,
            scenario,
            kind: 'environment',
            reasons: ['environment-changed'],
          })
        }
      }
      if (missing.length)
        steps.push({ kind: 'bench', sha, scenarios: missing, runs: item.runs })
    }
    // Reserve the same fresh ABBA block confirmation executes, for every distinct baseline/scenario pair.
    const pairs = new Set(baselines.map(row => `${row.sha}:${row.scenario}`))
    const reserve = [...pairs].reduce((sum, pair) => {
      const row = baselines.find(row => `${row.sha}:${row.scenario}` === pair)
      return sum + (row ? secondsFor([row.scenario], BENCH_MIN_RUNS) * 4 : 0)
    }, 0)
    const cost = steps.reduce((sum, step) => sum + secondsFor(step.scenarios, step.runs), reserve)
    const deferred = cost > remainingSeconds
    if (!deferred)
      remainingSeconds -= cost
    result.push({
      ...item,
      baselines,
      steps,
      resets,
      estimateSeconds: cost,
      outcome: deferred ? 'deferred' : steps.length ? 'planned' : 'already-benched',
      ...(deferred ? { reason: 'capacity' as const } : {}),
    })
  }
  return result
}

export interface Candidate {
  readonly scenario: string
  readonly metric: BenchMetric
  readonly subject: Subject
  readonly baseline: Baseline
  readonly comparison: Compared
}
export type ConfirmedCandidate = Candidate & { readonly confirmed: true }

/** Refusals never open findings. The caller shares `rebenched` across every comparison of a subject in one tick. */
export function judgeComparison(input: {
  readonly scenarioComparison: BenchScenarioComparison
  readonly subject: Subject
  readonly baseline: Baseline
  readonly events: readonly TrackEvent[]
  readonly tickId: string
  readonly now: number
  readonly rebenched?: boolean
}): { outcome: 'candidates' | 'baseline-reset' | 'rebench' | 'ignored', candidates: Candidate[], resets: BaselineResetEvent[], reasons: string[] } {
  const { scenarioComparison: source, subject, baseline } = input
  const result: { candidates: Candidate[], resets: BaselineResetEvent[], reasons: string[] } = { candidates: [], resets: [], reasons: [] }
  if (source.status === 'refused') {
    const reasons = source.refusals.map(refusal => refusal.reason)
    if (reasons.includes('host-mismatch') || reasons.includes('model-mismatch'))
      throw new Error(`Eligibility invariant failed: ${reasons.join(', ')}`)
    result.reasons = reasons
    if (reasons.some(reason => reason === 'electron-mismatch' || reason === 'build-mode-mismatch' || reason === 'scenario-mismatch')) {
      const recorded = input.events.some(event => event.event === 'baseline-reset' && event.kind === 'not-comparable' && event.subjectSha === subject.sha && event.baselineSha === baseline.sha && event.scenario === source.scenario)
      if (!recorded)
        result.resets.push({ v: 1, event: 'baseline-reset', t: input.now, tickId: input.tickId, subjectSha: subject.sha, baselineSha: baseline.sha, scenario: source.scenario, kind: 'not-comparable', reasons })
      return { ...result, outcome: recorded ? 'ignored' : 'baseline-reset' }
    }
    const countsOnly = reasons.length > 0 && reasons.every(reason => reason === 'no-runs' || reason === 'too-few-runs')
    return { ...result, outcome: countsOnly && !input.rebenched ? 'rebench' : 'ignored' }
  }
  for (const comparison of source.comparisons) {
    if (comparison.stale) {
      result.reasons.push('stale')
      continue
    }
    if (comparison.verdict === 'regression')
      result.candidates.push({ scenario: source.scenario, metric: comparison.metric, subject, baseline, comparison })
  }
  return { ...result, outcome: 'candidates' }
}

/** `runs` describes the initial pass; confirmation always uses three runs per invocation, without consulting caches. */
export function confirmSteps(candidate: Pick<Candidate, 'scenario' | 'baseline' | 'subject'>, _runs: number): BenchStep[] {
  const scenario = BENCH_V1.find(row => row.id === candidate.scenario)
  if (!scenario)
    throw new Error(`Unknown bench scenario: ${candidate.scenario}`)
  return [candidate.baseline.sha, candidate.subject.sha, candidate.subject.sha, candidate.baseline.sha]
    .map(sha => ({ kind: 'bench', sha, scenarios: [scenario.id], runs: BENCH_MIN_RUNS }))
}

/** Only runs from the fresh confirmation window may keep a candidate; cached initial runs cannot confirm it. */
export function confirmCandidates(input: {
  readonly candidates: readonly Candidate[]
  readonly runs: readonly BenchRunRecord[]
  readonly confirmStartT: number
  readonly history: readonly BenchRunRecord[]
}): ConfirmedCandidate[] {
  const current = eligibleRuns([...input.history, ...input.runs], input.runs.filter(run => run.t >= input.confirmStartT))
  const eligible = eligibleRuns(input.runs, current)
  const history = eligibleRuns(input.history, current)
  return input.candidates.flatMap((candidate) => {
    const fresh = eligible.filter(run => run.scenario === candidate.scenario && run.t >= input.confirmStartT && !run.dirty && run.diffHash === null)
    const comparison = compareBench({
      runsA: fresh.filter(run => run.sha === candidate.baseline.sha),
      runsB: fresh.filter(run => run.sha === candidate.subject.sha),
      history: history.filter(run => run.scenario === candidate.scenario),
      metric: candidate.metric,
    })
    return comparison.status === 'compared' && comparison.verdict === 'regression' && !comparison.stale
      ? [{ ...candidate, comparison, confirmed: true as const }]
      : []
  })
}

/** Range overlap may be by sha or patch identity, so a PR finding survives a rebase merge onto main. */
export async function matchOpen(input: {
  readonly candidate: Candidate
  readonly open: readonly OpenFinding[]
  readonly rangesOverlap: (finding: OpenFinding, candidate: Candidate) => Promise<boolean>
}): Promise<OpenFinding | undefined> {
  for (const finding of input.open) {
    if (finding.scenario === input.candidate.scenario && finding.metric === input.candidate.metric && await input.rangesOverlap(finding, input.candidate))
      return finding
  }
}

/** Accepts only confirmed candidates. Match against open ranges before building a new finding. */
export function buildFinding(input: {
  readonly candidate: ConfirmedCandidate
  readonly attribution: Omit<BenchScenarioAttribution['regression'], 'stages'> & { readonly stages: Readonly<FindingOpenEvent['topStages']> }
  readonly rangeCommits: number
  readonly renderLoopCommits: FindingOpenEvent['renderLoopCommits']
  readonly tickId: string
  readonly now: number
}): FindingOpenEvent {
  const { candidate, attribution } = input
  const { comparison, scenario, metric, subject, baseline } = candidate
  return {
    v: 1,
    event: 'finding-open',
    t: input.now,
    tickId: input.tickId,
    id: findingId(candidate),
    scenario,
    metric,
    subject,
    baseline,
    medianA: comparison.medianA,
    medianB: comparison.medianB,
    difference: comparison.difference,
    practicalFloor: comparison.practicalFloor,
    sigma: comparison.sigma,
    lowConfidence: comparison.lowConfidence,
    topStages: [...attribution.stages],
    noStageMoved: attribution.noStageMoved,
    rangeCommits: input.rangeCommits,
    renderLoopCommits: input.renderLoopCommits,
    reproduce: reproduceCommand(scenario, baseline.sha, subject.sha),
    closeCheck: closeCheck(candidate),
  }
}

/** Accepted entries have already been resolved in the applicable history by the caller. */
export async function acceptedCloses(input: {
  readonly open: readonly OpenFinding[]
  readonly accepted: readonly { readonly entry: AcceptedCost, readonly introducing: string }[]
  readonly isAncestor: AcceptancePredicates['isAncestor']
  readonly inRange: AcceptancePredicates['rangeLandedIn']
  readonly now: number
}): Promise<{ closes: FindingCloseEvent[], steps: BenchStep[] }> {
  const closes: FindingCloseEvent[] = []
  const steps: BenchStep[] = []
  for (const finding of input.open) {
    for (const { entry, introducing } of input.accepted) {
      if (finding.scenario !== entry.scenario)
        continue
      if (await acceptanceFor({
        entry,
        introducing,
        finding: { scenario: entry.scenario, metric: finding.metric, baseline: finding.baseline.sha, subject: finding.subject.sha },
        isAncestor: input.isAncestor,
        rangeLandedIn: input.inRange,
      })) {
        closes.push({ v: 1, event: 'finding-close', t: input.now, id: finding.id, resolution: 'accepted', at: introducing, note: entry.reason, by: 'tracker' })
        if (!steps.some(step => step.sha === introducing && step.scenarios.includes(entry.scenario)))
          steps.push({ kind: 'rebaseline', sha: introducing, scenarios: [entry.scenario], runs: BENCH_MIN_RUNS })
        break
      }
    }
  }
  return { closes, steps }
}

/** Comparisons must be against the finding's baseline, on a later subject of the same tracked line. */
export function fixedCloses(input: { readonly open: readonly OpenFinding[], readonly comparisons: readonly Candidate[], readonly now: number }): FindingCloseEvent[] {
  return input.open.flatMap((finding) => {
    const fixed = input.comparisons.find(row =>
      row.subject.sha !== finding.subject.sha && row.subject.kind === finding.subject.kind
      && (row.subject.kind === 'main' || (row.subject.kind === 'pr' && row.subject.pr === finding.subject.pr))
      && row.baseline.sha === finding.baseline.sha && row.scenario === finding.scenario && row.metric === finding.metric
      && !row.comparison.stale && (row.comparison.verdict === 'within-noise' || row.comparison.verdict === 'improvement'))
    return fixed ? [{ v: 1, event: 'finding-close', t: input.now, id: finding.id, resolution: 'fixed', at: fixed.subject.sha, note: '', by: 'tracker' }] : []
  })
}
