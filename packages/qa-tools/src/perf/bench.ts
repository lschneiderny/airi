import type { BenchComparison, BenchMetric, BenchRefusal, BenchRunRecord } from '@proj-airi/stage-shared/perf/usage'

import { attributeStages, BENCH_METRICS, compareBench, median } from '@proj-airi/stage-shared/perf/usage'

/** The code state a bench group was recorded from: a commit, plus the diff hash of a dirty tree. */
export interface BenchCodeState {
  readonly sha: string
  readonly diffHash: string | null
}

/** A sha (prefix of at least 4 hex digits) names that clean commit, `HEAD` the checked-out commit, `worktree` the tree as it is. */
export type BenchRef
  = | { readonly kind: 'sha', readonly text: string, readonly prefix: string }
    | { readonly kind: 'head', readonly text: 'HEAD' }
    | { readonly kind: 'worktree', readonly text: 'worktree' }

const SHA_PREFIX = /^[0-9a-f]{4,40}$/i

export function parseBenchRef(text: string): BenchRef | null {
  if (text === 'HEAD')
    return { kind: 'head', text }
  if (text === 'worktree')
    return { kind: 'worktree', text }
  return SHA_PREFIX.test(text) ? { kind: 'sha', text, prefix: text.toLowerCase() } : null
}

const sameState = (run: BenchRunRecord, state: BenchCodeState) => run.sha === state.sha && run.diffHash === state.diffHash
const stateKey = (run: BenchRunRecord) => JSON.stringify([run.scenario, run.sha, run.diffHash])

export interface BenchGroupRow extends BenchCodeState {
  readonly scenario: string
  readonly dirty: boolean
  readonly runs: number
  readonly validRuns: number
  readonly firstT: number
  readonly lastT: number
  /** Over the valid runs; `null` when the group has none. */
  readonly medians: Readonly<Record<BenchMetric, number | null>>
}

/** Groups runs by scenario and code state, oldest group first; `sinceMs` keeps runs recorded within that window. */
export function listBenchGroups(runs: readonly BenchRunRecord[], options: { readonly now: number, readonly sinceMs: number | null, readonly scenario: string | null }): BenchGroupRow[] {
  const groups = new Map<string, BenchRunRecord[]>()
  for (const run of runs) {
    if ((options.sinceMs !== null && run.t < options.now - options.sinceMs) || (options.scenario !== null && run.scenario !== options.scenario))
      continue
    groups.set(stateKey(run), [...(groups.get(stateKey(run)) ?? []), run])
  }
  return [...groups.values()].map((group) => {
    const valid = group.filter(run => run.valid)
    const times = group.map(run => run.t)
    const [{ scenario, sha, diffHash, dirty }] = group
    const medianOf = (metric: BenchMetric) => (valid.length > 0 ? median(valid.map(run => run.metrics[metric])) : null)
    return {
      scenario,
      sha,
      diffHash,
      dirty,
      runs: group.length,
      validRuns: valid.length,
      firstT: Math.min(...times),
      lastT: Math.max(...times),
      medians: {
        p95FrameMsApprox: medianOf('p95FrameMsApprox'),
        fps: medianOf('fps'),
        stageWindowCpuPct: medianOf('stageWindowCpuPct'),
        stageWindowCpuMsPerFrame: medianOf('stageWindowCpuMsPerFrame'),
        stageWindowWorkingSetKb: medianOf('stageWindowWorkingSetKb'),
      },
    }
  }).sort((left, right) => left.firstT - right.firstT)
}

export interface BenchSide {
  readonly ref: string
  readonly group: BenchCodeState
  /** Invalid runs of the group, left out of the comparison. */
  readonly excluded: readonly { readonly run: number, readonly t: number, readonly invalidReason: string }[]
}

/** The timed stages that moved in each direction; informational only, a metric's verdict picks which one applies. */
export interface BenchScenarioAttribution {
  readonly regression: ReturnType<typeof attributeStages>
  readonly improvement: ReturnType<typeof attributeStages>
}

export type BenchScenarioComparison = { readonly scenario: string, readonly a: BenchSide, readonly b: BenchSide } & (
  | { readonly status: 'refused', readonly refusals: readonly BenchRefusal[] }
  | {
    readonly status: 'compared'
    readonly comparisons: readonly Extract<BenchComparison, { status: 'compared' }>[]
    readonly attribution: BenchScenarioAttribution
  }
)

export type BenchCompareResult
  = | { readonly ok: true, readonly scenarios: readonly BenchScenarioComparison[] }
    | { readonly ok: false, readonly message: string }

export interface BenchCompareParams {
  readonly runs: readonly BenchRunRecord[]
  readonly a: BenchRef
  readonly b: BenchRef
  /** The checkout's state, needed only for `HEAD` and `worktree`. */
  readonly local: BenchCodeState | null
  readonly scenario: string | null
  readonly metric: BenchMetric | null
}

function resolveRef(ref: BenchRef, runs: readonly BenchRunRecord[], local: BenchCodeState | null): { state: BenchCodeState } | { message: string } {
  switch (ref.kind) {
    case 'sha': {
      const shas = [...new Set(runs.filter(run => run.sha.startsWith(ref.prefix)).map(run => run.sha))].sort()
      if (shas.length > 1)
        return { message: `bench ref ${ref.text} is ambiguous: ${shas.join(', ')}` }
      return shas.length === 1 ? { state: { sha: shas[0], diffHash: null } } : { message: `no bench runs for ${ref.text}` }
    }
    case 'head':
    case 'worktree':
      if (local === null)
        throw new Error(`resolving ${ref.text} needs the checkout's state`)
      return { state: ref.kind === 'head' ? { sha: local.sha, diffHash: null } : local }
    default: {
      const unhandled: never = ref
      return unhandled
    }
  }
}

/**
 * Compares the bench runs of two refs with `compareBench`, per scenario (`scenario`, else every scenario either ref
 * has) and per metric (`metric`, else every judged metric). Each side holds the valid runs of its code state; the
 * invalid ones are reported in `excluded`. The whole history is passed as noise history, which `compareBench`
 * narrows to comparable clean commits benched before B. Fails when a ref names no runs.
 */
export function compareBenchRefs(params: BenchCompareParams): BenchCompareResult {
  const { runs, scenario } = params
  const sides: { ref: BenchRef, state: BenchCodeState, runs: BenchRunRecord[] }[] = []
  for (const ref of [params.a, params.b]) {
    const resolved = resolveRef(ref, runs, params.local)
    if ('message' in resolved)
      return { ok: false, message: resolved.message }
    const own = runs.filter(run => sameState(run, resolved.state) && (scenario === null || run.scenario === scenario))
    if (own.length === 0)
      return { ok: false, message: `no bench runs for ${ref.text}${scenario === null ? '' : ` in scenario ${scenario}`}` }
    sides.push({ ref, state: resolved.state, runs: own })
  }
  const [a, b] = sides
  const scenarios = [...new Set([...a.runs, ...b.runs].map(run => run.scenario))].sort()
  const metrics = params.metric === null ? BENCH_METRICS : [params.metric]
  return {
    ok: true,
    scenarios: scenarios.map((id) => {
      const ofScenario = (side: typeof a) => side.runs.filter(run => run.scenario === id)
      const sideOf = (side: typeof a): BenchSide => ({
        ref: side.ref.text,
        group: side.state,
        excluded: ofScenario(side).filter(run => !run.valid).map(run => ({ run: run.run, t: run.t, invalidReason: run.invalidReason ?? 'invalid' })),
      })
      const valid = (side: typeof a) => ofScenario(side).filter(run => run.valid)
      const history = runs.filter(run => run.scenario === id)
      const runsA = valid(a)
      const runsB = valid(b)
      const results = metrics.map(metric => compareBench({ runsA, runsB, history, metric }))
      const head = { scenario: id, a: sideOf(a), b: sideOf(b) }
      // Refusals depend on the runs only, so they are the same for every metric.
      const refused = results.find(result => result.status === 'refused')
      if (refused !== undefined)
        return { ...head, status: 'refused', refusals: refused.refusals }
      return {
        ...head,
        status: 'compared',
        comparisons: results.filter(result => result.status === 'compared'),
        attribution: {
          regression: attributeStages({ runsA, runsB, history, direction: 'regression' }),
          improvement: attributeStages({ runsA, runsB, history, direction: 'improvement' }),
        },
      }
    }),
  }
}
