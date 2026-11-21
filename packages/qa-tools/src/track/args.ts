import type { FindingResolution } from './findings'

import { parseArgs } from 'node:util'

import { minValue, picklist, pipe, regex, safeInteger, safeParse, string, transform } from 'valibot'

export class TrackUsageError extends Error {}

const TRACK_USAGE = [
  'Usage: pnpm perf:track tick [--subject <ref> --baseline <ref>] [--scenario <id>] [--runs <n>] [--deadline HH:MM] [--plan-only] [--trigger timer|manual]',
  '       pnpm perf:track close <id> --resolution fixed|accepted|noise [--at <sha>] [--note <text>]',
  '       pnpm perf:track install-timer [--ref <ref>]',
  '       pnpm perf:track uninstall-timer',
].join('\n')

export const TRACK_HELP = [
  TRACK_USAGE,
  '',
  'tick benches the subjects the tracker plans and records findings in track.jsonl beside bench.jsonl.',
  '--subject and --baseline together bench one manual pair. --runs is at least 3 (default 5); --deadline defaults to 06:30.',
  '--plan-only, or AIRI_PERF_TRACK_PLAN_ONLY=1, records the plan without benching.',
  'close records how an open finding ended; pnpm perf status shows the outcome mix.',
].join('\n')

export type TrackCommand
  = | {
    readonly kind: 'tick'
    /** Set when `--subject` and `--baseline` name one manual pair. */
    readonly manual: { readonly subject: string, readonly baseline: string } | null
    readonly scenario: string | null
    readonly runs: number
    /** Local `HH:MM` after which no new bench starts. */
    readonly deadline: string
    readonly planOnly: boolean
    readonly trigger: 'timer' | 'manual'
  }
  | { readonly kind: 'close', readonly id: string, readonly resolution: FindingResolution, readonly at: string | null, readonly note: string }
  | { readonly kind: 'install-timer', readonly ref: string | null }
  | { readonly kind: 'uninstall-timer' }
  | { readonly kind: 'help' }

const ResolutionSchema = picklist(['fixed', 'accepted', 'noise'])
const TriggerSchema = picklist(['timer', 'manual'])
const RunsSchema = pipe(string(), regex(/^\d+$/), transform(Number), safeInteger(), minValue(3))
const DeadlineSchema = pipe(string(), regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/))
const ShaSchema = pipe(string(), regex(/^[0-9a-f]{7,64}$/))

const OPTIONS = {
  'subject': { type: 'string' },
  'baseline': { type: 'string' },
  'scenario': { type: 'string' },
  'runs': { type: 'string' },
  'deadline': { type: 'string' },
  'plan-only': { type: 'boolean' },
  'trigger': { type: 'string' },
  'resolution': { type: 'string' },
  'at': { type: 'string' },
  'note': { type: 'string' },
  'ref': { type: 'string' },
  'help': { type: 'boolean', short: 'h' },
} as const

type OptionName = keyof typeof OPTIONS

const COMMAND_OPTIONS: ReadonlyMap<string, readonly OptionName[]> = new Map([
  ['tick', ['subject', 'baseline', 'scenario', 'runs', 'deadline', 'plan-only', 'trigger']],
  ['close', ['resolution', 'at', 'note']],
  ['install-timer', ['ref']],
  ['uninstall-timer', []],
])

function usage(message: string): TrackUsageError {
  return new TrackUsageError(`${message}\n${TRACK_USAGE}`)
}

function isParseArgsError(error: unknown): error is Error {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS')
}

function nonEmpty(name: string, value: string | undefined): string | null {
  if (value === undefined)
    return null
  if (!value.trim())
    throw usage(`--${name} must not be empty`)
  return value
}

/**
 * Parses `pnpm perf:track` arguments. `env` supplies `AIRI_PERF_TRACK_PLAN_ONLY`.
 * @throws {TrackUsageError} for anything that is not a valid command.
 */
export function parseTrackArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>>): TrackCommand {
  let parsed
  try {
    parsed = parseArgs({ args: [...argv], allowPositionals: true, options: OPTIONS })
  }
  catch (error) {
    if (isParseArgsError(error))
      throw usage(error.message)
    throw error
  }
  const { values, positionals } = parsed
  if (values.help)
    return { kind: 'help' }
  const [command, ...rest] = positionals
  const allowed = command === undefined ? undefined : COMMAND_OPTIONS.get(command)
  if (allowed === undefined)
    throw usage(command === undefined ? 'Missing subcommand' : `Unknown subcommand "${command}"`)
  const foreign = Object.keys(values).find(name => !allowed.includes(name as OptionName))
  if (foreign !== undefined)
    throw usage(`--${foreign} does not apply to ${command}`)

  switch (command) {
    case 'tick': {
      if (rest.length > 0)
        throw usage('tick takes no positional arguments')
      const subject = nonEmpty('subject', values.subject)
      const baseline = nonEmpty('baseline', values.baseline)
      if ((subject === null) !== (baseline === null))
        throw usage('--subject and --baseline must be given together')
      const runs = values.runs === undefined ? null : safeParse(RunsSchema, values.runs)
      if (runs !== null && !runs.success)
        throw usage(`--runs must be a whole number of at least 3, received "${values.runs}"`)
      if (values.deadline !== undefined && !safeParse(DeadlineSchema, values.deadline).success)
        throw usage(`--deadline must be HH:MM, received "${values.deadline}"`)
      const trigger = values.trigger === undefined ? null : safeParse(TriggerSchema, values.trigger)
      if (trigger !== null && !trigger.success)
        throw usage(`--trigger must be timer or manual, received "${values.trigger}"`)
      return {
        kind: 'tick',
        manual: subject !== null && baseline !== null ? { subject, baseline } : null,
        scenario: nonEmpty('scenario', values.scenario),
        runs: runs?.output ?? 5,
        deadline: values.deadline ?? '06:30',
        planOnly: values['plan-only'] === true || env.AIRI_PERF_TRACK_PLAN_ONLY === '1',
        trigger: trigger?.output ?? 'manual',
      }
    }
    case 'close': {
      if (rest.length !== 1)
        throw usage('close takes exactly one finding id')
      const resolution = safeParse(ResolutionSchema, values.resolution)
      if (!resolution.success)
        throw usage(`--resolution must be fixed, accepted or noise, received "${values.resolution ?? ''}"`)
      if (values.at !== undefined && !safeParse(ShaSchema, values.at).success)
        throw usage(`--at must be a lowercase commit sha of at least 7 hex digits, received "${values.at}"`)
      return { kind: 'close', id: rest[0], resolution: resolution.output, at: values.at ?? null, note: values.note ?? '' }
    }
    case 'install-timer':
      if (rest.length > 0)
        throw usage('install-timer takes no positional arguments')
      return { kind: 'install-timer', ref: nonEmpty('ref', values.ref) }
    default:
      if (rest.length > 0)
        throw usage('uninstall-timer takes no positional arguments')
      return { kind: 'uninstall-timer' }
  }
}
