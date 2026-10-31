import type { StageMode } from './gates'

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { formatGateResults, readStageEvidence, runStageGates } from './gates'
import { measureAttached, measurePairs } from './measure'

export const stageUsage = `Usage:
  stage measure --mode <window|desktop> --port <cdp port> [--seconds 60] [--attempts 3] --out <json>
  stage measure --pairs <n> --profile <profile dir> [--seconds 60] [--settle 10] [--attempts 3] --out <json>
  stage gate <json> [<json>...]

measure --port attaches to a running app started with APP_REMOTE_DEBUG=true and an MMD model mounted.
measure --pairs launches the app per run (window, desktop, window, ...) on a copy of the profile.
gate prints PASS, FAIL or NO INPUT for stage-walk-skate, stage-arm-penetration and stage-frame-budget.`

class UsageError extends Error {}

function positiveInteger(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined)
    return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new UsageError(`--${name} must be a positive integer, got ${value}`)
  return parsed
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`)
}

function runGate(paths: readonly string[], cwd: string): number {
  if (paths.length === 0)
    throw new UsageError('gate needs at least one evidence JSON')
  const evidence = paths.flatMap((path) => {
    try {
      return readStageEvidence(path, JSON.parse(readFileSync(resolve(cwd, path), 'utf8')))
    }
    catch (error) {
      const message = errorMessageFrom(error) ?? 'unreadable evidence'
      throw new UsageError(message.startsWith(path) ? message : `${path}: ${message}`)
    }
  })
  const results = runStageGates(evidence)
  console.info(formatGateResults(results))
  if (results.some(result => result.verdict === 'FAIL'))
    return 1
  return results.every(result => result.verdict === 'NO INPUT') ? 2 : 0
}

/**
 * `qa:stage` entry. Relative paths resolve against `cwd` (the caller's directory, not the package directory pnpm runs
 * in). Exit codes: 0 every gate with input passed or the measurement is valid, 1 a gate failed, a run broke or every
 * attempt saw concurrent load, 2 usage error, unreadable evidence or no gate input.
 */
export async function runStageCli(argv: readonly string[], context: { repoRoot: string, cwd: string, selfPids: readonly number[] }): Promise<number> {
  const [command, ...rest] = argv
  const log = (line: string) => console.error(line)
  const parse = <T>(read: () => T): T => {
    try {
      return read()
    }
    catch (error) {
      throw new UsageError(errorMessageFrom(error) ?? 'invalid arguments')
    }
  }
  try {
    if (command === 'gate') {
      const { positionals } = parse(() => parseArgs({ args: [...rest], options: {}, allowPositionals: true, strict: true }))
      return runGate(positionals, context.cwd)
    }
    if (command !== 'measure')
      throw new UsageError(command ? `unknown command ${command}` : 'missing command')

    const { values } = parse(() => parseArgs({
      args: [...rest],
      options: {
        mode: { type: 'string' },
        port: { type: 'string' },
        pairs: { type: 'string' },
        profile: { type: 'string' },
        seconds: { type: 'string' },
        settle: { type: 'string' },
        attempts: { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
    }))
    if (!values.out)
      throw new UsageError('--out is required')
    const out = resolve(context.cwd, values.out)
    const seconds = positiveInteger('seconds', values.seconds, 60)
    const attempts = positiveInteger('attempts', values.attempts, 3)

    if (values.pairs !== undefined) {
      if (values.mode || values.port)
        throw new UsageError('--pairs launches the app itself and alternates modes; drop --mode and --port')
      if (!values.profile)
        throw new UsageError('--pairs needs --profile <profile dir> with onboarding done and the model selected')
      const record = await measurePairs({
        repoRoot: context.repoRoot,
        profile: resolve(context.cwd, values.profile),
        pairs: positiveInteger('pairs', values.pairs, 3),
        seconds,
        settleSeconds: positiveInteger('settle', values.settle, 10),
        attempts,
        selfPids: context.selfPids,
        log,
        onRun: partial => writeJson(out, partial),
      })
      console.info(`qa-tools stage: wrote ${record.runs.length} runs (${record.failures.length} failed) to ${out}`)
      return record.failures.length > 0 || record.runs.some(entry => !entry.valid) ? 1 : 0
    }

    if (values.mode !== 'window' && values.mode !== 'desktop')
      throw new UsageError(`--mode must be window or desktop, got ${values.mode ?? 'nothing'}`)
    if (!values.port)
      throw new UsageError('--port <cdp port> is required without --pairs')
    const mode: StageMode = values.mode
    const record = await measureAttached({ port: positiveInteger('port', values.port, 0), mode, seconds, attempts, log })
    writeJson(out, record)
    console.info(JSON.stringify(record.result))
    if (!record.valid)
      log(`qa-tools stage: every attempt was INVALID-CONCURRENT-LOAD; the record is kept with valid: false`)
    return record.valid ? 0 : 1
  }
  catch (error) {
    const usage = error instanceof UsageError
    console.error(`qa-tools stage: ${errorMessageFrom(error) ?? 'unknown error'}${usage ? `\n${stageUsage}` : ''}`)
    return usage ? 2 : 1
  }
}
