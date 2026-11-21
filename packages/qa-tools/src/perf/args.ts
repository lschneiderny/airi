import type { BenchMetric, FeatureMetric, UsageFeatureKey } from '@proj-airi/stage-shared/perf/usage'
import type { GenericSchema, InferOutput } from 'valibot'

import type { BenchRef } from './bench'

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { BENCH_METRICS, FEATURE_METRICS, USAGE_FEATURE_KEYS } from '@proj-airi/stage-shared/perf/usage'
import { check, picklist, pipe, regex, safeParse, string } from 'valibot'

import { parseBenchRef } from './bench'

export class PerfUsageError extends Error {}

const PERF_USAGE = [
  'Usage: pnpm perf sessions [--since <n>m|h|d] [--json] [--dir <path>]...',
  '       pnpm perf incident (--list | <id>) [--json] [--dir <path>]...',
  `       pnpm perf features [--feature ${USAGE_FEATURE_KEYS.join('|')}] [--metric ${FEATURE_METRICS.join('|')}] [--seed <n>] [--json] [--dir <path>]...`,
  '       pnpm perf compare <shaA> <shaB> [--include-dirty] [--json] [--dir <path>]...',
  '       pnpm perf bench [--scenario <id>] [--since <n>m|h|d] [--json]',
  `       pnpm perf compare --bench <refA> <refB> [--scenario <id>] [--metric ${BENCH_METRICS.join('|')}] [--json]`,
  '       pnpm perf status [--json]',
  'A bench ref is a sha (at least 4 hex digits), HEAD, or worktree.',
].join('\n')

export const PERF_HELP = [
  PERF_USAGE,
  '',
  'features compares a metric between the values of one usage feature (all features without --feature), per stratum.',
  'compare prints per-stratum medians of two commits\' usage sessions; dirty cells are excluded unless --include-dirty.',
  'Both are observational: usage sessions are not controlled experiments. Cells the app recorded on a contended host',
  'are dropped.',
  'features reports 90% percentile-bootstrap intervals, which under-cover at small sample sizes. The paired estimate',
  'decides only from 8 sessions holding both values; paired comparisons have low power below about 8 sessions.',
  'status summarizes the perf tracker: its last tick, open findings, the outcome mix, accepted costs and the stage',
  'costs of the latest benched main tip. It only reads.',
].join('\n')

/** `null` dirs means the platform defaults; `--dir` replaces them. */
export type PerfCommand
  = | { readonly kind: 'sessions', readonly dirs: readonly string[] | null, readonly sinceMs: number | null, readonly json: boolean }
    | { readonly kind: 'incident-list', readonly dirs: readonly string[] | null, readonly json: boolean }
    | { readonly kind: 'incident', readonly id: string, readonly dirs: readonly string[] | null, readonly json: boolean }
    | { readonly kind: 'features', readonly dirs: readonly string[] | null, readonly feature: UsageFeatureKey | null, readonly metric: FeatureMetric, readonly seed: number, readonly json: boolean }
    | { readonly kind: 'compare', readonly dirs: readonly string[] | null, readonly shaA: string, readonly shaB: string, readonly includeDirty: boolean, readonly json: boolean }
    | { readonly kind: 'bench', readonly scenario: string | null, readonly sinceMs: number | null, readonly json: boolean }
    | { readonly kind: 'compare-bench', readonly a: BenchRef, readonly b: BenchRef, readonly scenario: string | null, readonly metric: BenchMetric | null, readonly json: boolean }
    | { readonly kind: 'status', readonly json: boolean }
    | { readonly kind: 'help' }

/** An incident id names `incidents/<id>.json`, so it must stay a plain file name inside that directory. */
const IncidentIdSchema = pipe(string(), regex(/^[\w.-]+$/), check(id => id !== '.' && id !== '..'))

const FeatureSchema = picklist(USAGE_FEATURE_KEYS)
const MetricSchema = picklist(FEATURE_METRICS)
const BenchMetricSchema = picklist(BENCH_METRICS)
const SeedSchema = pipe(string(), regex(/^\d{1,9}$/))
const ShaPrefixSchema = pipe(string(), regex(/^[0-9a-f]{4,40}$/i))

function parseOption<TSchema extends GenericSchema<string>>(schema: TSchema, name: string, value: string): InferOutput<TSchema> {
  const parsed = safeParse(schema, value)
  if (!parsed.success)
    throw new PerfUsageError(`Invalid ${name} "${value}"\n${PERF_USAGE}`)
  return parsed.output
}

const SINCE_UNIT_MS: ReadonlyMap<string, number> = new Map([['m', 60_000], ['h', 3_600_000], ['d', 86_400_000]])

function parseSince(value: string): number {
  const match = /^(\d+)([a-z])$/.exec(value)
  const unitMs = match === null ? undefined : SINCE_UNIT_MS.get(match[2])
  const amount = Number(match?.[1])
  if (unitMs === undefined || !(amount > 0))
    throw new PerfUsageError(`--since must be a positive duration such as 30m, 12h or 7d, received "${value}"`)
  return amount * unitMs
}

function isParseArgsError(error: unknown): error is Error {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS')
}

/**
 * Parses `pnpm perf` arguments. Relative `--dir` paths resolve against `cwd`, the caller's directory.
 * @throws {PerfUsageError} for anything that is not a valid command.
 */
export function parsePerfArgs(argv: readonly string[], cwd: string): PerfCommand {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        'dir': { type: 'string', multiple: true },
        'since': { type: 'string' },
        'list': { type: 'boolean', default: false },
        'json': { type: 'boolean', default: false },
        'feature': { type: 'string' },
        'metric': { type: 'string' },
        'seed': { type: 'string' },
        'include-dirty': { type: 'boolean', default: false },
        'bench': { type: 'boolean', default: false },
        'scenario': { type: 'string' },
        'help': { type: 'boolean', short: 'h', default: false },
      },
    })
  }
  catch (error) {
    if (isParseArgsError(error))
      throw new PerfUsageError(`${error.message}\n${PERF_USAGE}`)
    throw error
  }
  const { values, positionals } = parsed
  if (values.help)
    return { kind: 'help' }
  const featureOptions = values.feature !== undefined || values.metric !== undefined || values.seed !== undefined
  if (values.dir?.some(dir => !dir.trim()))
    throw new PerfUsageError('--dir must not be empty')
  const dirs = values.dir?.map(dir => resolve(cwd, dir)) ?? null
  const [command, ...rest] = positionals
  const benchOnly = values.bench || values.scenario !== undefined || values.metric !== undefined
  if (values.scenario !== undefined && !values.scenario.trim())
    throw new PerfUsageError('--scenario must not be empty')
  const scenario = values.scenario ?? null
  switch (command) {
    case 'bench':
      if (rest.length > 0 || values.list || dirs !== null || values.bench || featureOptions || values['include-dirty'])
        throw new PerfUsageError(PERF_USAGE)
      return { kind: 'bench', scenario, sinceMs: values.since === undefined ? null : parseSince(values.since), json: values.json }
    case 'compare': {
      if (!values.bench) {
        if (rest.length !== 2 || values.list || values.since !== undefined || featureOptions || values.scenario !== undefined)
          throw new PerfUsageError(PERF_USAGE)
        return {
          kind: 'compare',
          dirs,
          shaA: parseOption(ShaPrefixSchema, 'sha prefix', rest[0]),
          shaB: parseOption(ShaPrefixSchema, 'sha prefix', rest[1]),
          includeDirty: values['include-dirty'],
          json: values.json,
        }
      }
      if (rest.length !== 2 || values.list || dirs !== null || values.since !== undefined || values.feature !== undefined || values.seed !== undefined || values['include-dirty'])
        throw new PerfUsageError(PERF_USAGE)
      const [a, b] = rest.map(parseBenchRef)
      if (a === null || b === null)
        throw new PerfUsageError(`Invalid bench ref in "${rest.join(' ')}"\n${PERF_USAGE}`)
      const metric = values.metric === undefined ? null : safeParse(BenchMetricSchema, values.metric)
      if (metric !== null && !metric.success)
        throw new PerfUsageError(`--metric must be one of ${BENCH_METRICS.join(', ')}, received "${values.metric}"`)
      return { kind: 'compare-bench', a, b, scenario, metric: metric?.output ?? null, json: values.json }
    }
    case 'sessions':
      if (rest.length > 0 || values.list || featureOptions || values['include-dirty'] || benchOnly)
        throw new PerfUsageError(PERF_USAGE)
      return { kind: 'sessions', dirs, sinceMs: values.since === undefined ? null : parseSince(values.since), json: values.json }
    case 'incident': {
      if (values.since !== undefined || benchOnly || rest.length > 1 || values.list === (rest.length === 1) || featureOptions || values['include-dirty'])
        throw new PerfUsageError(PERF_USAGE)
      if (values.list)
        return { kind: 'incident-list', dirs, json: values.json }
      const id = safeParse(IncidentIdSchema, rest[0])
      if (!id.success)
        throw new PerfUsageError(`Invalid incident id "${rest[0]}"`)
      return { kind: 'incident', id: id.output, dirs, json: values.json }
    }
    case 'features':
      if (rest.length > 0 || values.list || values.since !== undefined || values['include-dirty'] || values.bench || values.scenario !== undefined)
        throw new PerfUsageError(PERF_USAGE)
      return {
        kind: 'features',
        dirs,
        feature: values.feature === undefined ? null : parseOption(FeatureSchema, '--feature', values.feature),
        metric: values.metric === undefined ? 'p50FrameMs' : parseOption(MetricSchema, '--metric', values.metric),
        seed: values.seed === undefined ? 1 : Number(parseOption(SeedSchema, '--seed', values.seed)),
        json: values.json,
      }
    case 'status':
      if (rest.length > 0 || values.list || dirs !== null || values.since !== undefined || featureOptions || values['include-dirty'] || benchOnly)
        throw new PerfUsageError(PERF_USAGE)
      return { kind: 'status', json: values.json }
    default:
      throw new PerfUsageError(PERF_USAGE)
  }
}
