import type { MotionBandsFile, MotionVerdict } from '../gate/types'
import type { PreparedTrace } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'
import type { Motion3dRunSummary } from '../runner/measurement'

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { prepareTrace } from '../metrics'
import { readTrace } from '../read-trace'

/** Invalid input for a report: a missing file or a trace the rule cannot read. Exit code 2, never a FAIL. */
export class ReportUsageError extends Error {
  override readonly name = 'ReportUsageError'
}

export interface ReportConstant {
  readonly name: string
  readonly value: number | string
  readonly unit: string
  readonly source: string
}

/** One required rule of a criterion-level report: its id, the rule as written, the measured value and the verdict. */
export interface ReportRequirement {
  readonly id: string
  readonly rule: string
  readonly value: string
  readonly pass: boolean
}

export interface CriterionReport<Detail> {
  readonly kind: string
  readonly version: number
  readonly inputs: readonly string[]
  readonly constants: readonly ReportConstant[]
  readonly requirements: readonly ReportRequirement[]
  readonly verdict: 'PASS' | 'FAIL'
  readonly detail: Detail
}

export function criterionReport<Detail>(kind: string, version: number, inputs: readonly string[], constants: readonly ReportConstant[], requirements: readonly ReportRequirement[], detail: Detail): CriterionReport<Detail> {
  return { kind, version, inputs, constants, requirements, verdict: requirements.every(r => r.pass) ? 'PASS' : 'FAIL', detail }
}

export function requirement(id: string, rule: string, value: string, pass: boolean): ReportRequirement {
  return { id, rule, value, pass }
}

/** Header, constants with their sources and every requirement; `body` adds the report's own tables. */
export function formatReport(report: CriterionReport<unknown>, body: readonly string[]): string {
  return `${[
    `${report.kind} version ${report.version}: ${report.verdict}`,
    `inputs: ${report.inputs.join(', ')}`,
    'constants:',
    ...report.constants.map(c => `  ${c.name} = ${c.value} ${c.unit} (${c.source})`),
    'requirements:',
    ...report.requirements.map(r => `  ${r.pass ? 'PASS' : 'FAIL'} ${r.id}: ${r.value}; rule: ${r.rule}`),
    '',
    ...body,
  ].join('\n')}\n`
}

export interface LoadedRun {
  readonly dir: string
  readonly input: DecodedMotionTrace
  readonly p: PreparedTrace
  readonly summary: Motion3dRunSummary | null
  readonly gate: MotionVerdict | null
}

/** Reads `trace.json` (required) and `summary.json` and `gate.json` (when present) of one run directory. */
export async function loadRun(dir: string): Promise<LoadedRun> {
  const path = join(dir, 'trace.json')
  if (!existsSync(path))
    throw new ReportUsageError(`${dir} has no trace.json`)
  const input = await readTrace(path)
  const json = async <T>(name: string): Promise<T | null> => existsSync(join(dir, name)) ? JSON.parse(await readFile(join(dir, name), 'utf8')) as T : null
  return { dir, input, p: prepareTrace(input), summary: await json<Motion3dRunSummary>('summary.json'), gate: await json<MotionVerdict>('gate.json') }
}

export function requireSummary(run: LoadedRun): Motion3dRunSummary {
  if (!run.summary)
    throw new ReportUsageError(`${run.dir} has no summary.json; run qa:motion3d run first`)
  return run.summary
}

export function requireGate(run: LoadedRun): MotionVerdict {
  if (!run.gate)
    throw new ReportUsageError(`${run.dir} has no gate.json; run qa:motion3d gate on it first`)
  return run.gate
}

export async function writeReport(dir: string, name: string, report: CriterionReport<unknown>, text: string): Promise<void> {
  await writeFile(join(dir, `${name}.json`), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(join(dir, `${name}.txt`), text)
}

/** Labelled scenario peaks (`emphasis` events with source `scenario`) in the scored span, trace seconds. */
export function labelledPeaks(run: LoadedRun): number[] {
  const { trace } = run.input
  return trace.events.flatMap(e => e.kind === 'emphasis' && e.source === 'scenario' && e.t >= trace.scoredFrom ? [e.t] : [])
}

/** Every `marker` label with the given prefix, split on ':' after it, with its time. */
export function markers(run: LoadedRun, prefix: string): { t: number, parts: string[] }[] {
  return run.input.trace.events.flatMap(e => e.kind === 'marker' && e.label.startsWith(prefix) ? [{ t: e.t, parts: e.label.slice(prefix.length).split(':') }] : [])
}

/** The status of one metric in a gate verdict; `missing` when the verdict does not list it. */
export function gateStatus(gate: MotionVerdict, id: string): { status: string, value: number | null } {
  const metric = gate.metrics.find(m => m.id === id)
  return metric ? { status: metric.status, value: metric.value } : { status: 'missing', value: null }
}

/** The printed band of a metric in the frozen bands file, whatever its status. */
export function printedBand(bands: MotionBandsFile, scenario: 'talk' | 'emotion', id: string): { lo: number | null, hi: number | null } {
  const band = bands.classes[scenario]?.metrics[id]
  return { lo: band?.lo ?? null, hi: band?.hi ?? null }
}

export const fixed = (value: number | null, digits = 3): string => value === null || !Number.isFinite(value) ? '-' : value.toFixed(digits)
