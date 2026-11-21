import type { BenchRunRecord } from './records'

import { madSigma, median } from './compare-stats'

/** The bench-run metrics that comparisons judge. */
export const BENCH_METRICS = [
  'p95FrameMsApprox',
  'fps',
  'stageWindowCpuPct',
  'stageWindowCpuMsPerFrame',
  'stageWindowWorkingSetKb',
] as const satisfies readonly (keyof BenchRunRecord['metrics'])[]
export type BenchMetric = (typeof BENCH_METRICS)[number]

/** The smallest difference worth reporting per metric, whatever the measured noise. */
export const BENCH_PRACTICAL_FLOORS: Readonly<Record<BenchMetric, number>> = {
  p95FrameMsApprox: 0.5,
  fps: 1,
  stageWindowCpuPct: 2,
  // The CPU floor at 60 fps: 2 % of one core is 20 ms per second, about 0.33 ms per frame.
  stageWindowCpuMsPerFrame: 0.3,
  stageWindowWorkingSetKb: 20_000,
}

/** Only a higher fps is better; higher frame time, CPU, and memory are worse. */
const HIGHER_IS_BETTER: Readonly<Record<BenchMetric, boolean>> = {
  p95FrameMsApprox: false,
  fps: true,
  stageWindowCpuPct: false,
  stageWindowCpuMsPerFrame: false,
  stageWindowWorkingSetKb: false,
}

/** A difference must exceed this many sigma. */
export const BENCH_SIGMA_FACTOR = 2
/** Noise is pooled over A, B, and up to this many trailing clean history commits; fewer means low confidence. */
export const BENCH_HISTORY_COMMITS = 10
/** Each side, and each history commit, needs at least this many runs. */
export const BENCH_MIN_RUNS = 3
/** Groups whose newest runs are further apart are stale. */
export const BENCH_STALE_MS = 7 * 24 * 60 * 60 * 1000

export type BenchRefusalReason
  = | 'no-runs'
    | 'too-few-runs'
    | 'mixed-groups'
    | 'invalid-run'
    | 'host-mismatch'
    | 'build-mode-mismatch'
    | 'electron-mismatch'
    | 'scenario-mismatch'
    | 'model-mismatch'

export interface BenchRefusal {
  readonly reason: BenchRefusalReason
  readonly detail: string
}

/** Runs of one commit state: a sha and, for a dirty tree, its diff hash. */
export interface BenchGroup {
  readonly sha: string
  readonly diffHash: string | null
  readonly dirty: boolean
}

export interface BenchRunValue {
  readonly run: number
  readonly t: number
  readonly value: number
}

export type BenchVerdict = 'regression' | 'improvement' | 'within-noise'

export type BenchComparison
  = | { readonly status: 'refused', readonly refusals: readonly BenchRefusal[] }
    | {
      readonly status: 'compared'
      readonly metric: BenchMetric
      readonly groupA: BenchGroup
      readonly groupB: BenchGroup
      readonly valuesA: readonly BenchRunValue[]
      readonly valuesB: readonly BenchRunValue[]
      readonly medianA: number
      readonly medianB: number
      /** `medianB - medianA`. */
      readonly difference: number
      /** Scaled MAD of every run's residual from its own group's median. */
      readonly sigma: number
      readonly noise: 'pooled' | 'pair-local'
      /** Comparable clean history commits found; they enter `sigma` only when there are {@link BENCH_HISTORY_COMMITS}. */
      readonly historyCommits: number
      readonly lowConfidence: boolean
      readonly practicalFloor: number
      /** B runs on the side of `medianA` the difference points to, and how many are required. */
      readonly agreement: { readonly count: number, readonly required: number, readonly of: number }
      readonly verdict: BenchVerdict
      readonly stale: boolean
    }

export interface CompareBenchParams {
  readonly runsA: readonly BenchRunRecord[]
  readonly runsB: readonly BenchRunRecord[]
  /** Any earlier runs; only valid, clean runs comparable to A and B count. */
  readonly history: readonly BenchRunRecord[]
  readonly metric: BenchMetric
}

const groupKey = (run: BenchRunRecord) => JSON.stringify([run.sha, run.diffHash])
const hostKey = ({ host }: BenchRunRecord) => JSON.stringify([host.platform, host.arch, host.cpuModel, host.cores, host.totalMemKb, host.gpu])
const scenarioKey = (run: BenchRunRecord) => JSON.stringify([run.matrix, run.scenario, run.scenarioVersion])

/** Host and model identity only; code-state differences still belong to the comparison refusal policy. */
export function environmentKey(run: BenchRunRecord): string {
  return JSON.stringify([hostKey(run), run.modelFingerprint])
}

/** Run fields that must agree across A, B, and history for their values to be comparable. */
const COMPARABLE: readonly { readonly reason: BenchRefusalReason, readonly key: (run: BenchRunRecord) => string }[] = [
  { reason: 'host-mismatch', key: hostKey },
  { reason: 'build-mode-mismatch', key: run => run.buildMode },
  { reason: 'electron-mismatch', key: run => run.electronVersion },
  { reason: 'scenario-mismatch', key: scenarioKey },
  { reason: 'model-mismatch', key: run => run.modelFingerprint },
]

const comparableKey = (run: BenchRunRecord) => JSON.stringify(COMPARABLE.map(field => field.key(run)))
const newest = (runs: readonly BenchRunRecord[]) => Math.max(...runs.map(run => run.t))

function refusalsOf(runsA: readonly BenchRunRecord[], runsB: readonly BenchRunRecord[]): BenchRefusal[] {
  const refusals: BenchRefusal[] = []
  for (const [side, runs] of [['A', runsA], ['B', runsB]] as const) {
    if (runs.length === 0)
      refusals.push({ reason: 'no-runs', detail: `${side} has no runs` })
    else if (runs.length < BENCH_MIN_RUNS)
      refusals.push({ reason: 'too-few-runs', detail: `${side} has ${runs.length} runs (needs >= ${BENCH_MIN_RUNS})` })
    const groups = new Set(runs.map(groupKey))
    if (groups.size > 1)
      refusals.push({ reason: 'mixed-groups', detail: `${side} mixes ${[...groups].join(', ')}` })
    const invalid = runs.filter(run => !run.valid)
    if (invalid.length > 0)
      refusals.push({ reason: 'invalid-run', detail: `${side} runs ${invalid.map(run => `${run.run} (${run.invalidReason ?? 'invalid'})`).join(', ')}` })
  }
  const all = [...runsA, ...runsB]
  for (const field of COMPARABLE) {
    const values = new Set(all.map(field.key))
    if (values.size > 1)
      refusals.push({ reason: field.reason, detail: [...values].join(' vs ') })
  }
  return refusals
}

function residuals(values: readonly number[]): number[] {
  const centre = median(values)
  return values.map(value => value - centre)
}

/**
 * Up to {@link BENCH_HISTORY_COMMITS} trailing clean commits other than A and B, each with enough valid runs: the
 * newest whose runs all precede B's first run, so a later commit never sets the noise for an earlier comparison.
 */
function historyGroups(params: Pick<CompareBenchParams, 'runsA' | 'runsB' | 'history'>, reference: BenchRunRecord): BenchRunRecord[][] {
  const excluded = new Set([groupKey(params.runsA[0]), groupKey(params.runsB[0])])
  const firstRunOfB = Math.min(...params.runsB.map(run => run.t))
  const comparable = comparableKey(reference)
  const groups = new Map<string, BenchRunRecord[]>()
  for (const run of params.history) {
    const key = groupKey(run)
    if (!run.valid || run.dirty || excluded.has(key) || comparableKey(run) !== comparable)
      continue
    groups.set(key, [...(groups.get(key) ?? []), run])
  }
  return [...groups.values()]
    .filter(runs => runs.length >= BENCH_MIN_RUNS && newest(runs) < firstRunOfB)
    .sort((left, right) => newest(right) - newest(left))
    .slice(0, BENCH_HISTORY_COMMITS)
}

/** Judges non-empty numeric sides with already selected, comparable history groups. */
export function judgeDifference(params: {
  readonly valuesA: readonly number[]
  readonly valuesB: readonly number[]
  readonly historyGroups: readonly (readonly number[])[]
  readonly floor: number
  readonly higherIsWorse: boolean
}) {
  const { valuesA: a, valuesB: b, historyGroups: history, floor: practicalFloor, higherIsWorse } = params
  const pooled = history.length >= BENCH_HISTORY_COMMITS
  const noiseGroups = pooled ? [a, b, ...history] : [a, b]
  const sigma = madSigma(noiseGroups.flatMap(residuals))

  const medianA = median(a)
  const medianB = median(b)
  const difference = medianB - medianA
  const agreement = {
    count: difference === 0 ? 0 : b.filter(value => Math.sign(value - medianA) === Math.sign(difference)).length,
    required: Math.ceil((4 * b.length) / 5),
    of: b.length,
  }
  const significant = Math.abs(difference) > BENCH_SIGMA_FACTOR * sigma && Math.abs(difference) > practicalFloor && agreement.count >= agreement.required
  const worse = higherIsWorse ? difference > 0 : difference < 0
  return {
    medianA,
    medianB,
    difference,
    sigma,
    noise: pooled ? 'pooled' as const : 'pair-local' as const,
    historyCommits: history.length,
    lowConfidence: !pooled,
    practicalFloor,
    agreement,
    verdict: significant ? (worse ? 'regression' as const : 'improvement' as const) : 'within-noise' as const,
  }
}

/**
 * Compares bench runs of two commit states (A, the reference, and B) on one metric. It refuses runs that are
 * invalid or not comparable. A dirty A or B is allowed, but dirty runs never enter the noise history. The verdict
 * is a regression or improvement only when the difference exceeds {@link BENCH_SIGMA_FACTOR} sigma and the
 * practical floor and at least 4 of 5 B runs (all of 3) lie on its side of A's median.
 */
export function compareBench(params: CompareBenchParams): BenchComparison {
  const { runsA, runsB, metric } = params
  const refusals = refusalsOf(runsA, runsB)
  if (refusals.length > 0)
    return { status: 'refused', refusals }

  const valuesOf = (runs: readonly BenchRunRecord[]) => runs.map(run => ({ run: run.run, t: run.t, value: run.metrics[metric] }))
  const valuesA = valuesOf(runsA)
  const valuesB = valuesOf(runsB)
  const groupOf = (run: BenchRunRecord): BenchGroup => ({ sha: run.sha, diffHash: run.diffHash, dirty: run.dirty })
  return {
    status: 'compared',
    metric,
    groupA: groupOf(runsA[0]),
    groupB: groupOf(runsB[0]),
    valuesA,
    valuesB,
    ...judgeDifference({
      valuesA: valuesA.map(entry => entry.value),
      valuesB: valuesB.map(entry => entry.value),
      historyGroups: historyGroups(params, runsA[0]).map(runs => runs.map(run => run.metrics[metric])),
      floor: BENCH_PRACTICAL_FLOORS[metric],
      higherIsWorse: !HIGHER_IS_BETTER[metric],
    }),
    stale: Math.abs(newest(runsA) - newest(runsB)) > BENCH_STALE_MS,
  }
}

/** Informational movement of one timed stage; signed values always describe B minus A. */
export interface StageAttribution {
  readonly id: string
  readonly deltaMsPerFrame: number
  /** `null` when the stage has no measured noise. */
  readonly z: number | null
  /** The stage's sigma is 0, so it qualifies on its shift alone and ranks ahead of every finite z. */
  readonly zeroNoise: boolean
}

/**
 * Ranks stages in the requested direction without assigning stage verdicts. Missing timings mean not recorded.
 * Call after comparing valid, comparable sides. History uses the same clean, trailing groups as the metric judge,
 * but stages pool history once three runs carry that stage. Stages with zero noise have no z: they rank first,
 * largest shift first.
 */
export function attributeStages(params: Pick<CompareBenchParams, 'runsA' | 'runsB' | 'history'> & {
  readonly direction: 'regression' | 'improvement'
}): { readonly stages: readonly StageAttribution[], readonly timed: boolean, readonly noStageMoved: boolean } {
  const { runsA, runsB, direction } = params
  const sign = direction === 'regression' ? 1 : -1
  const timed = runsA.some(run => run.stages !== undefined) && runsB.some(run => run.stages !== undefined)
  if (!timed)
    return { stages: [], timed, noStageMoved: true }

  const history = historyGroups(params, runsA[0])
  const ids = new Set(runsA.flatMap(run => Object.keys(run.stages ?? {})))
  const stages: StageAttribution[] = []
  for (const id of ids) {
    const valuesOf = (runs: readonly BenchRunRecord[]) => runs.flatMap(run => run.stages?.[id] === undefined ? [] : [run.stages[id].msPerFrame])
    const a = valuesOf(runsA)
    const b = valuesOf(runsB)
    if (b.length === 0)
      continue
    const groups = history.map(valuesOf).filter(values => values.length > 0)
    const pooled = groups.reduce((count, values) => count + values.length, 0) >= BENCH_MIN_RUNS
    const sigma = madSigma((pooled ? [a, b, ...groups] : [a, b]).flatMap(residuals))
    const deltaMsPerFrame = median(b) - median(a)
    const zeroNoise = sigma === 0
    const z = zeroNoise ? null : deltaMsPerFrame / sigma
    if (sign * deltaMsPerFrame > 0.02 && (z === null || sign * z > 1))
      stages.push({ id, deltaMsPerFrame, z, zeroNoise })
  }
  stages.sort((left, right) => left.z === null || right.z === null
    ? Number(right.z === null) - Number(left.z === null) || Math.abs(right.deltaMsPerFrame) - Math.abs(left.deltaMsPerFrame)
    : sign * (right.z - left.z))
  return { stages: stages.slice(0, 5), timed, noStageMoved: stages.length === 0 }
}
