import type { StageMode, StageScenario } from './gates'

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { acquire } from '@proj-airi/cpu-slots'

import { captureStage } from './capture'
import { CaptureRefusal } from './capture-channel'
import { formatGateResults, readStageEvidence, runStageGates } from './gates'
import { runHandOff } from './handoff'
import { measureAttached, measurePairs, measureScenario } from './measure'

export const stageUsage = `Usage:
  stage capture --port <cdp port> --scenario <idle|walk|attach> --seconds <s> --out <dir> [--mode window|desktop] [--shots 12] [--seed 1]
  stage measure --mode <window|desktop> --port <cdp port> [--seconds 60] [--attempts 3] --out <json>
  stage measure --pairs <n> --profile <profile dir> [--seconds 60] [--settle 10] [--attempts 3] --out <json>
  stage measure --mode <window|desktop> --port <cdp port> --scenario <gesture-walk|action-preempt> --clip <clip name> [--seconds 12] [--attempts 3] --out <json>
  stage handoff --model <MMD model> [--seconds 120] --out <json>
  stage gate <json> [<json>...]

measure --port attaches to a running app started with APP_REMOTE_DEBUG=true and an MMD model mounted.
measure --pairs launches the app per run (window, desktop, window, ...) on a copy of the profile.
measure --scenario walks her 600 DIP and plays the imported clip over the walk (gesture-walk, looped) or into it
(action-preempt, with a second goal and a stop after --seconds of playing).
handoff launches the desktop stage on a fresh profile, imports the model, and walks her to another display. It needs
a session with more than one display: pnpm qa:display run --outputs 2 -- pnpm qa:stage handoff ...
gate prints PASS, FAIL or NO INPUT for stage-walk-skate, stage-arm-penetration, stage-frame-budget,
stage-gesture-walk, stage-action-preempt and stage-handoff.`

const scenarioNames: readonly StageScenario[] = ['gesture-walk', 'action-preempt']

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
export async function runStageCli(argv: readonly string[], context: { repoRoot: string, cwd: string, selfPids: readonly number[], signal?: AbortSignal }): Promise<number> {
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
    if (command === 'capture') {
      const { values } = parse(() => parseArgs({
        args: [...rest],
        options: { port: { type: 'string' }, scenario: { type: 'string' }, seconds: { type: 'string' }, out: { type: 'string' }, mode: { type: 'string' }, shots: { type: 'string' }, seed: { type: 'string' } },
        strict: true,
      }))
      if (!values.port || !values.scenario || !values.seconds || !values.out)
        throw new UsageError('capture needs --port, --scenario, --seconds and --out')
      const mode = values.mode ?? 'window'
      if (mode !== 'window' && mode !== 'desktop')
        throw new UsageError('--mode must be window or desktop')
      const seconds = Number(values.seconds)
      if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120)
        throw new UsageError('--seconds must be greater than 0 and at most 120')
      const port = positiveInteger('port', values.port, 0)
      if (port > 65535)
        throw new UsageError('--port must be at most 65535')
      const seed = values.seed === undefined ? 1 : Number(values.seed)
      if (!Number.isSafeInteger(seed))
        throw new UsageError('--seed must be a safe integer')
      const capture = await captureStage({
        repoRoot: context.repoRoot,
        out: resolve(context.cwd, values.out),
        port,
        mode,
        scenario: values.scenario,
        seconds,
        shots: positiveInteger('shots', values.shots, 12),
        seed,
      })
      console.info(JSON.stringify({ ok: capture.valid, out: resolve(context.cwd, values.out), frames: capture.frames, fps: capture.fps, failure: capture.failure }))
      return capture.valid ? 0 : 1
    }
    if (command === 'gate') {
      const { positionals } = parse(() => parseArgs({ args: [...rest], options: {}, allowPositionals: true, strict: true }))
      return runGate(positionals, context.cwd)
    }
    if (command === 'handoff') {
      const { values } = parse(() => parseArgs({ args: [...rest], options: { model: { type: 'string' }, seconds: { type: 'string' }, out: { type: 'string' } }, strict: true }))
      if (!values.model)
        throw new UsageError('handoff needs --model <MMD model>')
      if (!values.out)
        throw new UsageError('--out is required')
      const limitSeconds = positiveInteger('seconds', values.seconds, 120)
      const signal = context.signal ?? new AbortController().signal
      const lease = await acquire({ class: 'live', command: 'qa:stage handoff', cwd: context.repoRoot, signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]) })
      try {
        const { record, runDir, teardownOk } = await runHandOff({ repoRoot: context.repoRoot, model: resolve(context.cwd, values.model), limitSeconds, signal, lease })
        writeJson(resolve(context.cwd, values.out), record)
        console.info(JSON.stringify({ runDir, refusal: record.refusal, timedOut: record.timedOut, samples: record.perFrameSeries.rows.length, from: record.from, goals: record.goals, final: record.final }))
        if (record.refusal)
          log(`qa-tools stage: ${record.refusal}`)
        return record.refusal === null && !record.timedOut && teardownOk ? 0 : 1
      }
      finally {
        lease.release()
      }
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
        scenario: { type: 'string' },
        clip: { type: 'string' },
        out: { type: 'string' },
      },
      strict: true,
    }))
    if (!values.out)
      throw new UsageError('--out is required')
    const out = resolve(context.cwd, values.out)
    const scenario = values.scenario
    if (scenario !== undefined && !scenarioNames.includes(scenario as StageScenario))
      throw new UsageError(`--scenario must be ${scenarioNames.join(' or ')}, got ${scenario}`)
    if (scenario !== undefined && !values.clip)
      throw new UsageError('--scenario needs --clip <clip name>')
    if (scenario === undefined && values.clip !== undefined)
      throw new UsageError('--clip needs --scenario')
    if (scenario !== undefined && values.pairs !== undefined)
      throw new UsageError('--scenario attaches to a running app; drop --pairs')
    // A scenario's seconds are the walk span with the gesture or the playing time before the stop, not a frame window.
    const seconds = positiveInteger('seconds', values.seconds, scenario === undefined ? 60 : 12)
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
    const port = positiveInteger('port', values.port, 0)
    if (scenario !== undefined) {
      const record = await measureScenario({ port, mode, scenario: scenario as StageScenario, clip: values.clip!, seconds, attempts, log })
      writeJson(out, record)
      console.info(JSON.stringify({ scenario: record.scenario, clip: record.clip, samples: record.series.rows.length, stopAtMs: record.stopAtMs, refusal: record.refusal, p95StageMs: record.measurement?.p95StageMs ?? null, valid: record.valid }))
      if (!record.valid)
        log(`qa-tools stage: every attempt was INVALID-CONCURRENT-LOAD; the record is kept with valid: false`)
      return record.valid ? 0 : 1
    }
    const record = await measureAttached({ port, mode, seconds, attempts, log })
    writeJson(out, record)
    console.info(JSON.stringify(record.result))
    if (!record.valid)
      log(`qa-tools stage: every attempt was INVALID-CONCURRENT-LOAD; the record is kept with valid: false`)
    return record.valid ? 0 : 1
  }
  catch (error) {
    const usage = error instanceof UsageError
    console.error(`qa-tools stage: ${errorMessageFrom(error) ?? 'unknown error'}${usage ? `\n${stageUsage}` : ''}`)
    return usage || error instanceof CaptureRefusal ? 2 : 1
  }
}
