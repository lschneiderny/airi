import type { Motion3dClearance } from './measure'

import { basename, extname, isAbsolute, resolve } from 'node:path'

import * as v from 'valibot'

/** One model of a clearance sweep: the label its results carry, and the file it loads (never written to results). */
export interface ClearanceModel {
  readonly label: string
  readonly path: string
}

/**
 * One run of a sweep. A run that ended without a measure has `clearance: null` and `error` says which part is missing.
 * The run's own output stays in its log: a log line can hold a local path, and results never do.
 */
export interface ClearanceRow {
  readonly label: string
  readonly scenario: string
  /** The run directory, relative to the results file. */
  readonly run: string
  readonly exitCode: number
  readonly error: string | null
  readonly assetSha256: string | null
  /** Performer ticks, warm-up included, on which an arm had no clear pose (`summary.collisions.count`). */
  readonly noClearPoseTicks: number | null
  readonly clearance: Motion3dClearance | null
}

export interface ClearanceResults {
  readonly kind: 'motion3d-clearance'
  readonly version: 1
  readonly gitSha: string | null
  readonly dirty: boolean
  readonly seed: number
  readonly seconds: number
  readonly scenarios: readonly string[]
  readonly rows: readonly ClearanceRow[]
}

/** The fields of a results file that a comparison reads. */
export const clearanceResultsSchema = v.object({
  kind: v.literal('motion3d-clearance'),
  version: v.literal(1),
  rows: v.array(v.object({
    label: v.string(),
    scenario: v.string(),
    noClearPoseTicks: v.nullable(v.number()),
    clearance: v.nullable(v.object({
      piercedShare: v.number(),
      upperArmDeg: v.object({ mean: v.number() }),
      cloth: v.object({ reversalMean: v.number() }),
    })),
  })),
})
export type ComparedResults = v.InferOutput<typeof clearanceResultsSchema>

/** The fields of a run's `summary.json` a sweep reads. */
export const runSummarySchema = v.object({
  provenance: v.object({ assetSha256: v.optional(v.string()) }),
  collisions: v.object({ count: v.number() }),
  clearance: v.optional(v.custom<Motion3dClearance>(value => typeof value === 'object' && value !== null && 'piercedShare' in value, 'not a clearance block')),
})

/** What one finished `qa:motion3d run --clearance` left: its exit code and its `summary.json`, if any. */
export interface FinishedRun {
  readonly label: string
  readonly scenario: string
  readonly run: string
  readonly exitCode: number
  /** The parsed JSON of `summary.json`, or null when the run wrote none. */
  readonly summary: unknown
}

/**
 * The row of one run. A run with performer ticks without a clear arm pose exits 1 but still writes its summary, so its
 * row is measured and carries the ticks; only a run without a readable clearance block becomes a failed row.
 */
export function clearanceRow(finished: FinishedRun): ClearanceRow {
  const { label, scenario, run, exitCode } = finished
  const failed = (error: string | null): ClearanceRow => ({ label, scenario, run, exitCode, error, assetSha256: null, noClearPoseTicks: null, clearance: null })
  if (finished.summary === null)
    return failed('the run wrote no summary')
  const parsed = v.safeParse(runSummarySchema, finished.summary)
  if (!parsed.success)
    return failed('summary.json is not a run summary')
  const summary = parsed.output
  return {
    label,
    scenario,
    run,
    exitCode,
    error: summary.clearance ? null : 'the summary has no clearance block',
    assetSha256: summary.provenance.assetSha256 ?? null,
    noClearPoseTicks: summary.collisions.count,
    clearance: summary.clearance ?? null,
  }
}

/** The scenario whose pierced share `--fail-above` reads: the resting arm. */
export const FAIL_ABOVE_SCENARIO = 'idle-drive'

/** The name a volume that folds case and Unicode normal form would give a label's folder. */
const labelKey = (label: string) => label.normalize('NFC').toLowerCase()

/**
 * Labels from file stems, in path order; a repeated stem gets the first of `-2`, `-3` and so on that no model has. Two
 * stems that differ only in case or in Unicode normal form repeat, because a label names a folder and the macOS volume
 * folds both.
 */
function withLabels(entries: readonly { path: string, label: string | null }[]): ClearanceModel[] {
  const stems = entries.map(({ path, label }) => label ?? basename(path, extname(path)))
  const key = labelKey
  const taken = new Set(stems.map(key))
  const seen = new Set<string>()
  return entries.map(({ path }, i) => {
    const stem = stems[i]
    if (!seen.has(key(stem))) {
      seen.add(key(stem))
      return { path, label: stem }
    }
    let count = 2
    while (taken.has(key(`${stem}-${count}`)))
      count++
    taken.add(key(`${stem}-${count}`))
    return { path, label: `${stem}-${count}` }
  })
}

/** Every `.pmx` path of a folder listing, sorted, labelled by file stem. */
export function modelsFromPaths(paths: readonly string[]): ClearanceModel[] {
  return withLabels([...paths].filter(path => extname(path).toLowerCase() === '.pmx').sort().map(path => ({ path, label: null })))
}

/**
 * A list file: one model path per line, optionally followed by a tab and a label. Blank lines and lines starting with
 * `#` are skipped; a relative path resolves against `baseDir`. A label given twice is refused.
 */
export function modelsFromList(text: string, baseDir: string): ClearanceModel[] {
  const entries = text.split(/\r?\n/).filter(line => line.trim() !== '' && !line.trimStart().startsWith('#')).map((line) => {
    const [path = '', label = ''] = line.split('\t')
    return { path: isAbsolute(path.trim()) ? path.trim() : resolve(baseDir, path.trim()), label: label.trim() || null }
  })
  const labels = entries.flatMap(entry => entry.label === null ? [] : [entry.label])
  const folded = labels.map(labelKey)
  const repeated = labels.find((_, i) => folded.indexOf(folded[i]) !== i)
  if (repeated !== undefined)
    throw new Error(`the list gives the label ${repeated} twice`)
  // A label names the run's folder and log file, so it must stay one path segment.
  const nested = labels.find(label => /[/\\]/.test(label))
  if (nested !== undefined)
    throw new Error(`the label ${nested} contains a path separator`)
  return withLabels(entries)
}

/** The rigs whose `idle-drive` pierced share exceeds `share`. */
export function rigsAbove(rows: readonly ClearanceRow[], share: number): string[] {
  return rows.filter(row => row.scenario === FAIL_ABOVE_SCENARIO && (row.clearance?.piercedShare ?? 0) > share).map(row => row.label)
}

const percent = (share: number) => (100 * share).toFixed(1)

/** One line per row: pierced, deep and per-class shares, episodes, arm angle, cloth reversals, ticks and the top material. */
export function formatResults(rows: readonly ClearanceRow[]): string {
  const header = ['rig', 'scenario', 'pierced %', 'deep %', 'episodes', 'longest s', 'arm deg', 'reversal %', 'no clear pose', 'top material']
  const cells = rows.map((row) => {
    const c = row.clearance
    if (!c)
      return [row.label, row.scenario, `failed (exit ${row.exitCode}): ${row.error ?? 'no summary'}`]
    return [row.label, row.scenario, percent(c.piercedShare), percent(c.depth.deepShare), String(c.episodes.count), c.episodes.longestSeconds.toFixed(1), c.upperArmDeg.mean.toFixed(1), percent(c.cloth.reversalMean), String(row.noClearPoseTicks ?? '-'), c.topMaterials[0]?.material ?? '-']
  })
  const widths = header.map((title, i) => Math.max(title.length, ...cells.filter(line => line.length === header.length).map(line => line[i].length)))
  return [header, ...cells].map(line => line.map((cell, i) => i === line.length - 1 ? cell : cell.padEnd(widths[i])).join('  ')).join('\n')
}

/** Before and after per rig and scenario: pierced share, arm angle, cloth reversals and ticks without a clear arm pose. */
export function formatComparison(before: ComparedResults, after: readonly ClearanceRow[]): string {
  const key = (row: { label: string, scenario: string }) => `${row.label}\t${row.scenario}`
  const earlier = new Map(before.rows.map(row => [key(row), row]))
  const lines = after.map((row) => {
    const then = earlier.get(key(row))
    earlier.delete(key(row))
    if (!then)
      return `${row.label} ${row.scenario}: not in the earlier results`
    const now = row.clearance
    if (!now || !then.clearance)
      return `${row.label} ${row.scenario}: ${then.clearance ? 'measured' : 'failed'} → ${now ? 'measured' : 'failed'}`
    return `${row.label} ${row.scenario}: pierced ${percent(then.clearance.piercedShare)} → ${percent(now.piercedShare)} %, arm ${then.clearance.upperArmDeg.mean.toFixed(1)} → ${now.upperArmDeg.mean.toFixed(1)} deg, reversal ${percent(then.clearance.cloth.reversalMean)} → ${percent(now.cloth.reversalMean)} %, no clear pose ${then.noClearPoseTicks ?? '-'} → ${row.noClearPoseTicks ?? '-'}`
  })
  return [...lines, ...[...earlier.values()].map(row => `${row.label} ${row.scenario}: only in the earlier results`)].join('\n')
}
