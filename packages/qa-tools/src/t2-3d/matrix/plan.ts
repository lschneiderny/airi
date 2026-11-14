import * as v from 'valibot'

export const MATRIX_REPORT_COMMANDS = ['gate', 'gaze-order', 'gesture-timing', 'emotion-table', 'cue-body', 'ownership', 'turn', 'pops', 'idle-acts', 'walk-form', 'rest'] as const

const name = v.pipe(v.string(), v.regex(/^[\w.-]+$/, 'use letters, digits, ".", "_" and "-"'))
const positive = v.pipe(v.number(), v.finite(), v.minValue(Number.MIN_VALUE))
/** A rig names its model by an environment variable or an explicit path, never by a line of `.env.qa` split by hand. */
const rigSchema = v.union([
  v.strictObject({ env: v.pipe(v.string(), v.regex(/^[A-Z_]\w*$/)) }),
  v.strictObject({ path: v.pipe(v.string(), v.minLength(1)) }),
])
const runSchema = v.strictObject({
  id: name,
  rig: name,
  scenario: v.pipe(v.string(), v.minLength(1)),
  seeds: v.pipe(v.array(v.pipe(v.number(), v.safeInteger())), v.minLength(1)),
  seconds: v.optional(positive),
  warmup: v.optional(v.pipe(v.number(), v.finite(), v.minValue(0))),
  acts: v.optional(v.picklist(['on', 'off'])),
  criterion: v.optional(v.string()),
})
const reportSchema = v.strictObject({
  id: name,
  command: v.picklist(MATRIX_REPORT_COMMANDS),
  /** Run ids, or run group ids standing for every seed of the group in seed order. */
  runs: v.pipe(v.array(name), v.minLength(1)),
  /** Options that take run folders, such as `--idle` or `--pair`, with the run ids they take. */
  options: v.optional(v.record(v.pipe(v.string(), v.regex(/^--[a-z][a-z-]*$/)), v.pipe(v.array(name), v.minLength(1)))),
  /** Other arguments, such as `--require <ids>`, passed as written. */
  flags: v.optional(v.array(v.string())),
  criterion: v.optional(v.string()),
})
export const matrixFileSchema = v.strictObject({
  kind: v.literal('motion3d-matrix'),
  version: v.literal(1),
  note: v.optional(v.string()),
  rigs: v.record(name, rigSchema),
  runs: v.array(runSchema),
  reports: v.array(reportSchema),
})
export type MatrixFile = v.InferOutput<typeof matrixFileSchema>
export type MatrixRig = MatrixFile['rigs'][string]

export interface PlannedRun {
  /** `<group>-s<seed>`, the folder name under `runs/`. */
  readonly id: string
  readonly group: string
  readonly rig: string
  readonly scenario: string
  readonly seed: number
  readonly seconds?: number
  readonly warmup?: number
  readonly acts?: 'on' | 'off'
  readonly criterion: string | null
}

export interface PlannedReport {
  readonly id: string
  readonly command: typeof MATRIX_REPORT_COMMANDS[number]
  readonly runs: readonly string[]
  readonly options: readonly (readonly [string, readonly string[]])[]
  readonly flags: readonly string[]
  readonly criterion: string | null
}

export interface MatrixPlan {
  readonly runs: readonly PlannedRun[]
  readonly reports: readonly PlannedReport[]
  /** Problems in the matrix itself; a non-empty list refuses before anything runs. */
  readonly refusals: readonly string[]
}

/** Expands every run group into one run per seed and resolves every report's run references. */
export function planMatrix(file: MatrixFile): MatrixPlan {
  const refusals: string[] = []
  const runs = file.runs.flatMap(group => group.seeds.map(seed => ({
    id: `${group.id}-s${seed}`,
    group: group.id,
    rig: group.rig,
    scenario: group.scenario,
    seed,
    ...(group.seconds === undefined ? {} : { seconds: group.seconds }),
    ...(group.warmup === undefined ? {} : { warmup: group.warmup }),
    ...(group.acts === undefined ? {} : { acts: group.acts }),
    criterion: group.criterion ?? null,
  })))
  const duplicates = (ids: readonly string[]) => [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
  for (const id of duplicates(runs.map(run => run.id)))
    refusals.push(`run id ${id} is declared twice`)
  for (const id of duplicates(file.runs.map(run => run.id)))
    refusals.push(`run group ${id} is declared twice`)
  for (const id of duplicates(file.reports.map(report => report.id)))
    refusals.push(`report id ${id} is declared twice`)
  for (const group of file.runs.filter(group => !(group.rig in file.rigs)))
    refusals.push(`run group ${group.id} names rig ${group.rig}, which the matrix does not declare`)
  const resolve = (report: string, ref: string): string[] => {
    if (runs.some(run => run.id === ref))
      return [ref]
    const seeds = runs.filter(run => run.group === ref).map(run => run.id)
    if (!seeds.length)
      refusals.push(`report ${report} names run ${ref}, which the matrix does not declare`)
    return seeds
  }
  const reports = file.reports.map((report) => {
    for (const flag of (report.flags ?? []).filter(flag => flag === '--json' || flag === '--out'))
      refusals.push(`report ${report.id} passes ${flag}; the matrix owns it`)
    return {
      id: report.id,
      command: report.command,
      runs: report.runs.flatMap(ref => resolve(report.id, ref)),
      options: Object.entries(report.options ?? {}).map(([option, refs]) => [option, refs.flatMap(ref => resolve(report.id, ref))] as const),
      flags: report.flags ?? [],
      criterion: report.criterion ?? null,
    }
  })
  return { runs, reports, refusals }
}

export interface PreflightFacts {
  readonly dirty: boolean
  readonly allowDirty: boolean
  /** Each declared rig's resolved model path (null when its variable is unset) and whether that file exists. */
  readonly rigs: Readonly<Record<string, { readonly path: string | null, readonly exists: boolean, readonly source: string }>>
  /** Entries already in the output folder; any entry refuses, so two matrices never share one folder. */
  readonly outEntries: readonly string[]
}

export function preflightRefusals(facts: PreflightFacts): string[] {
  const refusals: string[] = []
  if (facts.dirty && !facts.allowDirty)
    refusals.push('the worktree is dirty; commit first, or pass --allow-dirty (recorded in the receipt)')
  for (const [rig, model] of Object.entries(facts.rigs)) {
    if (model.path === null)
      refusals.push(`rig ${rig}: ${model.source} is not set`)
    else if (!model.exists)
      refusals.push(`rig ${rig}: model ${JSON.stringify(model.path)} (${model.source}) does not exist`)
  }
  if (facts.outEntries.length)
    refusals.push(`the output folder already holds ${facts.outEntries.slice(0, 5).join(', ')}${facts.outEntries.length > 5 ? ', ...' : ''}`)
  return refusals
}

/** Arguments of `qa:motion3d run` for one planned run; every path is absolute and stays one argument. */
export function runArguments(run: PlannedRun, model: string, out: string): string[] {
  return [
    'run',
    '--model',
    model,
    '--scenario',
    run.scenario,
    '--seed',
    String(run.seed),
    ...(run.seconds === undefined ? [] : ['--seconds', String(run.seconds)]),
    ...(run.warmup === undefined ? [] : ['--warmup', String(run.warmup)]),
    ...(run.acts === undefined ? [] : ['--acts', run.acts]),
    '--out',
    out,
  ]
}

export function reportArguments(report: PlannedReport, runDir: (id: string) => string, json: string): string[] {
  return [
    report.command,
    ...report.runs.map(runDir),
    ...report.options.flatMap(([option, ids]) => [option, ...ids.map(runDir)]),
    ...report.flags,
    '--json',
    json,
  ]
}
