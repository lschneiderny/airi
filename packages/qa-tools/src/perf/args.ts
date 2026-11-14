import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { check, pipe, regex, safeParse, string } from 'valibot'

export class PerfUsageError extends Error {}

export const PERF_USAGE = 'Usage: pnpm perf sessions [--since <n>m|h|d] [--json] [--dir <path>]... | pnpm perf incident (--list | <id>) [--json] [--dir <path>]...'

/** `null` dirs means the platform defaults; `--dir` replaces them. */
export type PerfCommand
  = | { readonly kind: 'sessions', readonly dirs: readonly string[] | null, readonly sinceMs: number | null, readonly json: boolean }
    | { readonly kind: 'incident-list', readonly dirs: readonly string[] | null, readonly json: boolean }
    | { readonly kind: 'incident', readonly id: string, readonly dirs: readonly string[] | null, readonly json: boolean }

/** An incident id names `incidents/<id>.json`, so it must stay a plain file name inside that directory. */
const IncidentIdSchema = pipe(string(), regex(/^[\w.-]+$/), check(id => id !== '.' && id !== '..'))

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
        dir: { type: 'string', multiple: true },
        since: { type: 'string' },
        list: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
      },
    })
  }
  catch (error) {
    if (isParseArgsError(error))
      throw new PerfUsageError(`${error.message}\n${PERF_USAGE}`)
    throw error
  }
  const { values, positionals } = parsed
  if (values.dir?.some(dir => !dir.trim()))
    throw new PerfUsageError('--dir must not be empty')
  const dirs = values.dir?.map(dir => resolve(cwd, dir)) ?? null
  const [command, ...rest] = positionals
  switch (command) {
    case 'sessions':
      if (rest.length > 0 || values.list)
        throw new PerfUsageError(PERF_USAGE)
      return { kind: 'sessions', dirs, sinceMs: values.since === undefined ? null : parseSince(values.since), json: values.json }
    case 'incident': {
      if (values.since !== undefined || rest.length > 1 || values.list === (rest.length === 1))
        throw new PerfUsageError(PERF_USAGE)
      if (values.list)
        return { kind: 'incident-list', dirs, json: values.json }
      const id = safeParse(IncidentIdSchema, rest[0])
      if (!id.success)
        throw new PerfUsageError(`Invalid incident id "${rest[0]}"`)
      return { kind: 'incident', id: id.output, dirs, json: values.json }
    }
    default:
      throw new PerfUsageError(PERF_USAGE)
  }
}
