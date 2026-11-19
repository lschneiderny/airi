import type { BenchScenario } from './matrix'

import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { BENCH_V1, BenchUsageError, selectScenarios } from './matrix'

export const BENCH_USAGE = `Usage: pnpm qa:display run -- pnpm qa:bench [--scenario <${BENCH_V1.map(scenario => scenario.id).join('|')}>] [--runs <n>] [--out <dir>]

Runs the bench-v1 matrix (or one scenario) --runs times (default 5, at least 3). Each launch waits for a calm host,
starts the window stage on a fresh profile with perf recording on, imports the model from .env.qa
(AIRI_QA_MMD_MODEL, AIRI_QA_RIG_FORBOOTH), and appends one bench-run record to bench.jsonl in the per-machine state
directory (AIRI_PERF_BENCH_DIR overrides it). Run artifacts go to --out (default .temp/qa/<timestamp>-bench).
Exit codes: 0 every run is valid, 1 a run broke or is invalid, 2 invalid arguments or refused setup, 3 the host stayed
busy or no model mounted in time, 130 interrupted.`

/** Fewer runs give `pnpm perf compare --bench` no usable median. */
export const BENCH_MIN_RUNS = 3

export type BenchCommand
  = | { readonly kind: 'help' }
    | { readonly kind: 'run', readonly scenarios: readonly BenchScenario[], readonly runs: number, readonly out: string | null }

function isParseArgsError(error: unknown): error is Error {
  return error instanceof Error && 'code' in error && typeof error.code === 'string' && error.code.startsWith('ERR_PARSE_ARGS')
}

/**
 * Parses `qa:bench` arguments; a relative `--out` resolves against `cwd`, the caller's directory.
 * @throws {BenchUsageError} for anything that is not a valid command.
 */
export function parseBenchArgs(argv: readonly string[], cwd: string): BenchCommand {
  let parsed
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        scenario: { type: 'string' },
        runs: { type: 'string' },
        out: { type: 'string' },
        help: { type: 'boolean', default: false },
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
  return { kind: 'run', scenarios: selectScenarios(values.scenario), runs, out: values.out === undefined ? null : resolve(cwd, values.out) }
}
