import type { BenchScenario } from './matrix'

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { BENCH_V1, BenchUsageError, selectScenarios } from './matrix'

export const BENCH_USAGE = `Usage: pnpm qa:display run -- pnpm qa:bench [--scenario <${BENCH_V1.map(scenario => scenario.id).join('|')}>] [--runs <n>] [--out <dir>]
  [--repo-root <checkout>] [--not-after <ISO time>]

Runs the bench-v1 matrix (or one scenario) --runs times (default 5, at least 3). Each launch waits for a calm host,
starts the window stage on a fresh profile with perf recording on, imports the model from .env.qa
(AIRI_QA_MMD_MODEL, AIRI_QA_RIG_FORBOOTH), and appends one bench-run record to bench.jsonl in the per-machine state
directory (AIRI_PERF_BENCH_DIR overrides it). Run artifacts go to --out (default .temp/qa/<timestamp>-bench).
--repo-root measures another checkout: its .env.qa, app, scripts and default --out, with this checkout's harness.
--not-after (for example 2026-11-21T06:00:00Z) starts no launch after that time and keeps the records made so far.
Exit codes: 0 every run is valid, 1 a run broke or is invalid, 2 invalid arguments or refused setup, 3 the host stayed
busy or no model mounted in time, 4 --not-after was reached before a launch, 130 interrupted.`

/** Fewer runs give `pnpm perf compare --bench` no usable median. */
export const BENCH_MIN_RUNS = 3

export type BenchCommand
  = | { readonly kind: 'help' }
    | {
      readonly kind: 'run'
      readonly scenarios: readonly BenchScenario[]
      readonly runs: number
      readonly out: string | null
      /** The checkout to measure; `null` measures the running one. */
      readonly repoRoot: string | null
      readonly notAfter: Date | null
    }

/** A full ISO 8601 time with an explicit offset; `Date.parse` alone accepts junk such as `1`. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/

function isParseArgsError(error: unknown): error is Error {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS')
}

/**
 * Parses `qa:bench` arguments; a relative `--out` or `--repo-root` resolves against `cwd`, the caller's directory.
 * @throws {BenchUsageError} for anything that is not a valid command.
 */
export function parseBenchArgs(argv: readonly string[], cwd: string): BenchCommand {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        'scenario': { type: 'string' },
        'runs': { type: 'string' },
        'out': { type: 'string' },
        'repo-root': { type: 'string' },
        'not-after': { type: 'string' },
        'help': { type: 'boolean', default: false },
      },
    })
  }
  catch (error) {
    if (isParseArgsError(error))
      throw new BenchUsageError(error.message)
    throw error
  }
  const { values } = parsed
  if (values.help)
    return { kind: 'help' }
  const runs = values.runs === undefined ? 5 : Number(values.runs)
  if (!Number.isSafeInteger(runs) || runs < BENCH_MIN_RUNS)
    throw new BenchUsageError(`--runs must be an integer of at least ${BENCH_MIN_RUNS}, received "${values.runs}"`)
  if (values.out !== undefined && !values.out.trim())
    throw new BenchUsageError('--out must not be empty')
  const repoRoot = values['repo-root'] === undefined ? null : resolve(cwd, values['repo-root'])
  if (repoRoot !== null && !existsSync(join(repoRoot, 'apps/stage-tamagotchi/package.json')))
    throw new BenchUsageError(`--repo-root ${repoRoot} is not an AIRI checkout: it has no apps/stage-tamagotchi/package.json`)
  const notAfterText = values['not-after']
  const notAfterMs = notAfterText === undefined ? Number.NaN : Date.parse(notAfterText)
  if (notAfterText !== undefined && (!ISO_TIME.test(notAfterText) || Number.isNaN(notAfterMs)))
    throw new BenchUsageError(`--not-after must be an ISO time with an offset, such as 2026-11-21T06:00:00Z, received "${notAfterText}"`)
  return {
    kind: 'run',
    scenarios: selectScenarios(values.scenario),
    runs,
    out: values.out === undefined ? null : resolve(cwd, values.out),
    repoRoot,
    notAfter: notAfterText === undefined ? null : new Date(notAfterMs),
  }
}
