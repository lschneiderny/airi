import type { Lease } from '@proj-airi/cpu-slots'

import type { ClosureWriter } from '../cache/lookup'
import type { ValidationOptions, ValidationSection } from './plan'

import process from 'node:process'

import { execFile, execFileSync, spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { emotionGate } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/gates'

import { resolveVitestEntry } from '../../env/pnpm'
import { createRun } from '../../evidence/run'
import { cacheFinishedRun, lookupResult, prepareCache, replayHit } from '../cache/lookup'
import { acquireLease, resolveWorkers } from '../gate/cli'
import { evaluateValidation, formatValidationSummary } from './evaluate'
import { buildValidationPlan, validationSections } from './plan'
import { recordsPartialName, scorePartialName } from './units'

export const validateUsage = `Usage: motion validate-scorer --level t1 [--sections ${validationSections.join(',')}] [--seeds N] [--workers N] [--timeout-minutes N] [--fresh]

  --level     t1 (the only level available)
  --sections  comma list of validation sections (default all)
  --seeds     run at most N seeds per range, a reduced run that validation.json records
  --workers   parallel Vitest processes per phase (default: the CPU slot grant; a larger value is clamped to it); results do not depend on it
  --fresh     skip the result cache lookup and compute the run (the result is still stored). A cached run is a local check, so acceptance evidence needs --fresh
Exit codes: 0 every threshold met, 1 a threshold missed or the run broke, 2 usage error.`

export interface ValidateCommand {
  options: ValidationOptions
  /** The requested process count, or `null` for the CPU slot grant (resolved after acquire). */
  workers: number | null
  timeoutMinutes: number
  /** Skip the cache lookup. */
  fresh: boolean
}

export type ParsedValidateArgs = { ok: true, command: ValidateCommand } | { ok: false, message: string }

function positiveInteger(raw: string | undefined, name: string): number | null | string {
  if (raw === undefined)
    return null
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : `--${name} must be a positive integer, got ${JSON.stringify(raw)}`
}

export function parseValidateArgs(rest: string[]): ParsedValidateArgs {
  let values: { 'level'?: string, 'sections'?: string, 'seeds'?: string, 'workers'?: string, 'timeout-minutes'?: string, 'fresh'?: boolean }
  let positionals: string[]
  try {
    ({ values, positionals } = parseArgs({
      args: rest,
      options: { 'level': { type: 'string' }, 'sections': { type: 'string' }, 'seeds': { type: 'string' }, 'workers': { type: 'string' }, 'timeout-minutes': { type: 'string' }, 'fresh': { type: 'boolean' } },
      strict: true,
      allowPositionals: true,
    }))
  }
  catch (error) {
    return { ok: false, message: errorMessageFrom(error) ?? 'invalid arguments' }
  }
  if (positionals.length)
    return { ok: false, message: `Unexpected argument ${JSON.stringify(positionals[0])}` }
  if (values.level !== 't1')
    return { ok: false, message: values.level === undefined ? '--level is required. Valid levels: t1' : `Level ${JSON.stringify(values.level)} is not available. Valid levels: t1` }
  let sections: ValidationSection[] = [...validationSections]
  if (values.sections !== undefined) {
    const items = values.sections.split(',').map(item => item.trim()).filter(Boolean)
    const unknown = items.filter(item => !validationSections.includes(item as ValidationSection))
    if (!items.length || unknown.length)
      return { ok: false, message: `Unknown section ${unknown.map(item => JSON.stringify(item)).join(', ') || '(empty)'}. Valid sections: ${validationSections.join(', ')}` }
    sections = validationSections.filter(section => items.includes(section))
  }
  const seeds = positiveInteger(values.seeds, 'seeds')
  if (typeof seeds === 'string')
    return { ok: false, message: seeds }
  const workers = positiveInteger(values.workers, 'workers')
  if (typeof workers === 'string')
    return { ok: false, message: workers }
  const timeoutMinutes = positiveInteger(values['timeout-minutes'], 'timeout-minutes')
  if (typeof timeoutMinutes === 'string')
    return { ok: false, message: timeoutMinutes }
  return { ok: true, command: { options: { sections, seedsLimit: seeds }, workers, timeoutMinutes: timeoutMinutes ?? 180, fresh: values.fresh ?? false } }
}

/** Runs one phase as `shards` parallel Vitest processes of `gates/validation.gate.ts`; each owns a slice of the work. */
async function runPhase(repoRoot: string, phase: 'generate' | 'score', shards: number, env: NodeJS.ProcessEnv, runDir: string, deadline: number, lease: Lease): Promise<string[]> {
  const failures = await Promise.all(Array.from({ length: shards }, (_, shard) => new Promise<string | null>((done, fail) => {
    const logFile = join(runDir, `vitest-${phase}-${shard}.log`)
    const log = openSync(logFile, 'w')
    const child = spawn(process.execPath, [resolveVitestEntry(), 'run', '--config', 'packages/qa-tools/vitest.config.ts', '--project', 'gate', '--maxWorkers', '1', 'gates/validation.gate.ts'], {
      cwd: repoRoot,
      env: { ...env, ...lease.env, QA_RUN_DIR: runDir, QA_VALIDATION_PHASE: phase, QA_VALIDATION_SHARD: String(shard), QA_VALIDATION_SHARDS: String(shards) },
      stdio: ['ignore', log, log],
    })
    if (child.pid !== undefined)
      lease.addWorkload(child.pid)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      if (process.platform === 'win32' && child.pid)
        execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], () => {})
      else
        child.kill('SIGKILL')
    }, Math.max(1, deadline - Date.now()))
    child.once('error', (error) => {
      clearTimeout(timer)
      closeSync(log)
      fail(error)
    })
    child.once('close', (exitCode) => {
      clearTimeout(timer)
      closeSync(log)
      done(exitCode === 0 ? null : `${phase} shard ${shard} ${timedOut ? 'timed out' : `exited ${exitCode}`}; log ${logFile}\n${readFileSync(logFile, 'utf8').slice(-1500)}`)
    })
  })))
  return failures.filter((failure): failure is string => failure !== null)
}

/** Runs the scorer validation end to end. Returns the process exit code: 0 all thresholds met, 1 missed or broken, 2 usage. */
export async function runValidateCli(rest: string[], repoRoot: string, env: NodeJS.ProcessEnv = process.env, closure?: ClosureWriter): Promise<number> {
  const parsed = parseValidateArgs(rest)
  if (!parsed.ok) {
    console.error(`${parsed.message}\n${validateUsage}`)
    return 2
  }
  const { options, timeoutMinutes } = parsed.command
  const gateFileSha = () => execFileSync('git', ['-C', repoRoot, 'hash-object', 'packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts'], { encoding: 'utf8' }).trim()
  const fileSha = gateFileSha()
  const shardEnv = { ...env, QA_VALIDATION_SECTIONS: options.sections.join(','), ...(options.seedsLimit === null ? {} : { QA_SEEDS: String(options.seedsLimit) }) }
  // The process count is not an input: results do not depend on it.
  const cachePlan = prepareCache({ repoRoot, args: { command: 'validate-scorer', level: 't1', sections: options.sections, seeds: options.seedsLimit }, env: shardEnv, gateFileSha })
  // A hit starts no process and takes no lease.
  const hit = cachePlan ? lookupResult(cachePlan, repoRoot, parsed.command.fresh) : null
  if (cachePlan && hit)
    return replayHit({ hit, repoRoot, label: 'validate-scorer-t1', gate: { id: emotionGate.id, version: String(emotionGate.version), fileSha }, startedAtMs: cachePlan.startedAtMs })
  const lease = await acquireLease({ class: 'gate', command: `qa:motion validate-scorer ${rest.join(' ')}`, cwd: repoRoot, timeoutMinutes })
  if (typeof lease === 'number')
    return lease
  const workers = resolveWorkers(parsed.command.workers, lease.grant)
  let run: ReturnType<typeof createRun>
  try {
    run = createRun({ tool: 'motion', label: 'validate-scorer-t1', repoRoot, gate: { id: emotionGate.id, version: String(emotionGate.version), fileSha } })
  }
  catch (error) {
    lease.release()
    throw error
  }
  const started = Date.now()
  const deadline = started + timeoutMinutes * 60_000
  const plan = buildValidationPlan(emotionGate, options)
  const finish = (exitCode: number, summary: string) => {
    lease.release()
    const wallSeconds = Math.round((Date.now() - started) / 100) / 10
    writeFileSync(run.path('timing.json'), `${JSON.stringify({ wallSeconds, workers, grant: lease.grant, cores: cpus().length, units: plan.units.length, jobs: plan.jobs.length }, null, 2)}\n`)
    run.addArtifact('timing.json', 'timing')
    run.finish({ exitCode, summary: `${summary} [wall ${wallSeconds}s, ${workers} processes]` })
    console.info(`run ${run.runId} (${wallSeconds}s, ${workers} processes): ${summary}`)
    return exitCode
  }

  try {
    for (const phase of ['generate', 'score'] as const) {
      const items = phase === 'generate' ? plan.units.map(recordsPartialName) : plan.jobs.map(scorePartialName)
      const failures = await runPhase(repoRoot, phase, Math.min(workers, items.length), shardEnv, run.dir, deadline, lease)
      const missing = items.filter(name => !existsSync(join(run.dir, 'partials', name)))
      if (failures.length || missing.length) {
        console.error(`Validation ${phase} phase broke:\n${failures.join('\n')}${missing.length ? `\n${missing.length} partial(s) missing, for example ${missing.slice(0, 5).join(', ')}` : ''}`)
        return finish(1, `validation ${phase} phase broke`)
      }
    }
    const report = evaluateValidation({ runDir: run.dir, plan, gate: emotionGate, options, fileSha })
    writeFileSync(run.path('validation.json'), `${JSON.stringify(report, null, 2)}\n`)
    run.addArtifact('validation.json', 'report')
    const summary = formatValidationSummary(report)
    writeFileSync(run.path('summary.txt'), summary)
    run.addArtifact('summary.txt', 'summary')
    console.info(summary)
    const verdictSummary = report.thresholdsMet ? 'every threshold met' : `thresholds missed: ${Object.entries(report.verdicts).filter(([, verdict]) => verdict !== true).map(([name]) => name).join(', ')}`
    const exitCode = finish(report.thresholdsMet ? 0 : 1, verdictSummary)
    if (cachePlan)
      cacheFinishedRun({ plan: cachePlan, repoRoot, closure, runDir: run.dir, sourceRunId: run.runId, exitCode, summary: verdictSummary, artifacts: ['validation.json', 'summary.txt'] })
    return exitCode
  }
  catch (error) {
    console.error(`Validation broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
    return finish(1, `validation broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  }
}
