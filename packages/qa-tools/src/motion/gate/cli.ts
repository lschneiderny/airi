import type { CpuClass, Lease } from '@proj-airi/cpu-slots'
import type { Band, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { ClosureWriter } from '../cache/lookup'
import type { GateLevel, GateSelection } from './options'

import process from 'node:process'

import { execFile, execFileSync, spawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { cpus, freemem, totalmem } from 'node:os'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { acquire, CpuSlotsError } from '@proj-airi/cpu-slots'

import { resolveVitestEntry } from '../../env/pnpm'
import { createRun } from '../../evidence/run'
import { T2SetupError } from '../../t2/errors'
import { loadT2Runtime } from '../../t2/runner'
import { cacheFinishedRun, lookupResult, prepareCache, replayHit } from '../cache/lookup'
import { aggregateEmotion, aggregateLiveliness, formatSummary } from './aggregate'
import { emotionGateFor, gateBands, gateEmotions, livelinessGateFor } from './options'
import { runT3Gate } from './t3-gate'

export const gateUsage = `Usage: motion gate <emotion | liveliness> --level <t1 | t2 | t3> [--rig forbooth] [--emotions a,b] [--bands clear,strong] [--seeds N] [--workers N] [--timeout-minutes N] [--t1-report <run dir>] [--rescore <gate run dir>] [--fresh]

  --level    t1 (controller simulation), t2 (headless real rig) or t3 (rendered Electron app, committed cells only)
  --rig      forbooth (required for t2 and t3; local rig and core environment variables)
  --t1-report  T3 emotion only: the T1 emotion run dir the transfer ratios divide by (default: the newest at this commit)
  --rescore    T3 emotion only: score an archived gate run dir again from its session traces, launching nothing
  --emotions comma list of: ${gateEmotions.join(', ')} (emotion gate only; default all)
  --bands    comma list of: ${gateBands.join(', ')} (emotion gate only; default all)
  --seeds    run at most N seeds per variant, a reduced run that the report records (emotion gate only)
  --workers  Vitest workers (default: the CPU slot grant; a larger value is clamped to it); the report is the same for any count
  --fresh    t1 only: skip the result cache lookup and compute the run (the result is still stored). A cached run is a local check, so acceptance evidence needs --fresh
Exit codes: 0 every check passed, 1 a check failed or the run broke, 2 usage, T2/T3 setup error or a T3 refusal before launch, 130 T3 interrupted.`

export interface GateCommand {
  target: 'emotion' | 'liveliness'
  level: GateLevel
  selection: GateSelection
  /** The requested worker count, or `null` for the CPU slot grant (resolved after acquire). */
  workers: number | null
  timeoutMinutes: number
  /** `--level t3` emotion gate: the T1 reference run dir, or `null` to find it. */
  t1Report: string | null
  /** `--level t3` emotion gate: an archived gate run dir to re-score, or `null` for a live run. */
  rescore: string | null
  /** `--level t1`: skip the cache lookup. */
  fresh: boolean
}

export type ParsedGateArgs = { ok: true, command: GateCommand } | { ok: false, message: string }

function parseList<T extends string>(raw: string | undefined, valid: readonly T[], name: string): T[] | string {
  if (raw === undefined)
    return [...valid]
  const items = raw.split(',').map(item => item.trim()).filter(Boolean)
  if (!items.length)
    return `--${name} is empty. Valid values: ${valid.join(', ')}`
  const unknown = items.filter(item => !valid.includes(item as T))
  if (unknown.length)
    return `Unknown ${name === 'emotions' ? 'emotion' : 'band'} ${unknown.map(item => JSON.stringify(item)).join(', ')}. Valid ${name}: ${valid.join(', ')}`
  return [...new Set(items)] as T[]
}

function parsePositiveInteger(raw: string | undefined, name: string): number | null | string {
  if (raw === undefined)
    return null
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : `--${name} must be a positive integer, got ${JSON.stringify(raw)}`
}

/** Validates `gate` arguments (everything after the `gate` word is the caller's `rest`). */
export function parseGateArgs(rest: string[]): ParsedGateArgs {
  let values: { 'level'?: string, 'rig'?: string, 'emotions'?: string, 'bands'?: string, 'seeds'?: string, 'workers'?: string, 'timeout-minutes'?: string, 't1-report'?: string, 'rescore'?: string, 'fresh'?: boolean }
  let positionals: string[]
  try {
    ({ values, positionals } = parseArgs({
      args: rest,
      options: { 'level': { type: 'string' }, 'rig': { type: 'string' }, 'emotions': { type: 'string' }, 'bands': { type: 'string' }, 'seeds': { type: 'string' }, 'workers': { type: 'string' }, 'timeout-minutes': { type: 'string' }, 't1-report': { type: 'string' }, 'rescore': { type: 'string' }, 'fresh': { type: 'boolean' } },
      strict: true,
      allowPositionals: true,
    }))
  }
  catch (error) {
    return { ok: false, message: errorMessageFrom(error) ?? 'invalid arguments' }
  }
  const [target, ...extra] = positionals
  if (target !== 'emotion' && target !== 'liveliness')
    return { ok: false, message: `Unknown gate ${JSON.stringify(target ?? '')}. Valid gates: emotion, liveliness` }
  if (extra.length)
    return { ok: false, message: `Unexpected argument ${JSON.stringify(extra[0])}` }
  if (values.level !== 't1' && values.level !== 't2' && values.level !== 't3')
    return { ok: false, message: values.level === undefined ? '--level is required. Valid levels: t1, t2, t3' : `Level ${JSON.stringify(values.level)} is not available. Valid levels: t1, t2, t3` }
  if (values.level !== 't1' && values.rig !== 'forbooth')
    return { ok: false, message: `--level ${values.level} requires --rig forbooth` }
  if (values.level === 't1' && values.rig !== undefined)
    return { ok: false, message: '--rig applies to --level t2 or t3 only' }
  if (values.level === 't3' && (values.emotions !== undefined || values.bands !== undefined || values.seeds !== undefined || values.workers !== undefined || values['timeout-minutes'] !== undefined))
    return { ok: false, message: '--emotions, --bands, --seeds, --workers and --timeout-minutes do not apply to --level t3, which runs the committed cells of naturalEmotionT3Gate' }
  if (values.fresh && values.level !== 't1')
    return { ok: false, message: '--fresh applies to --level t1 only; T2 and T3 runs are never cached' }
  if (values['t1-report'] !== undefined && (values.level !== 't3' || target !== 'emotion'))
    return { ok: false, message: '--t1-report applies to the emotion gate at --level t3 only' }
  if (values.rescore !== undefined && (values.level !== 't3' || target !== 'emotion' || values['t1-report'] !== undefined))
    return { ok: false, message: '--rescore applies to the emotion gate at --level t3 only, and takes its T1 reference from the archived run' }
  if (target === 'liveliness' && (values.emotions !== undefined || values.bands !== undefined || values.seeds !== undefined))
    return { ok: false, message: '--emotions, --bands and --seeds apply to the emotion gate only' }

  const emotions = parseList<PerformanceEmotion>(values.emotions, gateEmotions, 'emotions')
  if (typeof emotions === 'string')
    return { ok: false, message: emotions }
  const bands = parseList<Band>(values.bands, gateBands, 'bands')
  if (typeof bands === 'string')
    return { ok: false, message: bands }
  const seeds = parsePositiveInteger(values.seeds, 'seeds')
  if (typeof seeds === 'string')
    return { ok: false, message: seeds }
  const workers = parsePositiveInteger(values.workers, 'workers')
  if (typeof workers === 'string')
    return { ok: false, message: workers }
  const timeoutMinutes = parsePositiveInteger(values['timeout-minutes'], 'timeout-minutes')
  if (typeof timeoutMinutes === 'string')
    return { ok: false, message: timeoutMinutes }
  return {
    ok: true,
    command: { target, level: values.level, selection: { emotions, bands, seedsLimit: seeds }, workers, timeoutMinutes: timeoutMinutes ?? (target === 'emotion' ? 90 : 30), t1Report: values['t1-report'] ?? null, rescore: values.rescore ?? null, fresh: values.fresh ?? false },
  }
}

const gatesFile = 'packages/stage-ui-live2d/src/composables/live2d/natural-motion/gates.ts'

/** Git blob SHA of the file holding the gate rules, so the report names the exact rules (uncommitted edits included). */
function gateFileSha(repoRoot: string): string {
  return execFileSync('git', ['-C', repoRoot, 'hash-object', gatesFile], { encoding: 'utf8' }).trim()
}

/** CPU utilization over `ms`, 0..1; Windows has no load average, so this records how busy the machine already was. */
async function sampleCpuUtilization(ms = 500): Promise<number> {
  const read = () => cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 })
  const before = read()
  await new Promise(done => setTimeout(done, ms))
  const after = read()
  const total = after.total - before.total
  return total > 0 ? 1 - (after.idle - before.idle) / total : 0
}

/**
 * Waits for a CPU slot lease. Returns the lease, or an exit code after printing why it could not be taken.
 * `timeoutMinutes` bounds the wait, so a stuck holder cannot hang the command forever.
 */
export async function acquireLease(request: { class: CpuClass, command: string, cwd: string, timeoutMinutes?: number }): Promise<Lease | number> {
  try {
    return await acquire({ class: request.class, command: request.command, cwd: request.cwd, signal: request.timeoutMinutes === undefined ? undefined : AbortSignal.timeout(request.timeoutMinutes * 60_000) })
  }
  catch (error) {
    console.error(`Cannot get CPU slots: ${errorMessageFrom(error) ?? 'unknown error'}`)
    return error instanceof CpuSlotsError ? 2 : 1
  }
}

/** The worker count for a run: the grant by default, an explicit request clamped to it. Without a grant (CI or slots off) the old default applies. */
export function resolveWorkers(requested: number | null, grant: number | null): number {
  if (grant === null)
    return requested ?? Math.max(1, cpus().length - 1)
  if (requested !== null && requested > grant) {
    console.info(`--workers ${requested} clamped to grant ${grant}`)
    return grant
  }
  return requested ?? grant
}

interface VitestResult {
  exitCode: number | null
  timedOut: boolean
}

function runVitest(repoRoot: string, files: string[], env: NodeJS.ProcessEnv, workers: number, logFile: string, timeoutMs: number, lease: Lease): Promise<VitestResult> {
  return new Promise((done, fail) => {
    const log = openSync(logFile, 'w')
    const child = spawn(process.execPath, [resolveVitestEntry(), 'run', '--config', 'packages/qa-tools/vitest.config.ts', '--project', 'gate', '--maxWorkers', String(workers), ...files], {
      cwd: repoRoot,
      env,
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
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      closeSync(log)
      fail(error)
    })
    child.once('close', (exitCode) => {
      clearTimeout(timer)
      closeSync(log)
      done({ exitCode, timedOut })
    })
  })
}

/** Targets recorded with every run; they are not asserted. */
const timingTargets = { fullGateSeconds: 300, smokeSeconds: 60, cores: 16 }

/** Runs one gate end to end. Returns 0 pass, 1 fail or broken run, 2 usage or rig setup error. */
export async function runGateCli(rest: string[], repoRoot: string, env: NodeJS.ProcessEnv = process.env, closure?: ClosureWriter): Promise<number> {
  const parsed = parseGateArgs(rest)
  if (!parsed.ok) {
    console.error(`${parsed.message}\n${gateUsage}`)
    return 2
  }
  const { target, level, selection, timeoutMinutes } = parsed.command
  if (level === 't3') {
    // A re-score launches nothing, so it takes no lease.
    if (parsed.command.rescore !== null)
      return runT3Gate({ target, t1Report: parsed.command.t1Report, rescore: parsed.command.rescore }, repoRoot, env, () => gateFileSha(repoRoot))
    const t3Lease = await acquireLease({ class: 'exclusive', command: `qa:motion ${rest.join(' ')}`, cwd: repoRoot })
    if (typeof t3Lease === 'number')
      return t3Lease
    try {
      return await runT3Gate({ target, t1Report: parsed.command.t1Report, rescore: null }, repoRoot, env, () => gateFileSha(repoRoot))
    }
    finally {
      t3Lease.release()
    }
  }
  if (level === 't2') {
    try {
      await loadT2Runtime({ rigRoot: env.AIRI_QA_RIG_FORBOOTH, corePath: env.AIRI_QA_CUBISM_CORE })
    }
    catch (error) {
      console.error(`T2 setup failed: ${errorMessageFrom(error) ?? 'unknown error'}`)
      return error instanceof T2SetupError ? 2 : 1
    }
  }
  const emotionGate = emotionGateFor(level)
  const naturalIdleLivelinessGate = livelinessGateFor(level)
  const gate = target === 'emotion' ? emotionGate : naturalIdleLivelinessGate
  const fileSha = gateFileSha(repoRoot)
  const gateEnv = {
    QA_GATE: gate.id,
    QA_LEVEL: level,
    QA_EMOTIONS: selection.emotions.join(','),
    QA_BANDS: selection.bands.join(','),
    ...(selection.seedsLimit === null ? {} : { QA_SEEDS: String(selection.seedsLimit) }),
  }
  // Only T1 is cached. The worker count is not an input: the report is the same for any count.
  const cachePlan = level === 't1'
    ? prepareCache({ repoRoot, args: { command: 'gate', target, level, emotions: selection.emotions, bands: selection.bands, seeds: selection.seedsLimit }, env: { ...env, ...gateEnv }, gateFileSha: () => gateFileSha(repoRoot) })
    : null
  // A hit starts no process and takes no lease.
  const hit = cachePlan ? lookupResult(cachePlan, repoRoot, parsed.command.fresh) : null
  if (cachePlan && hit)
    return replayHit({ hit, repoRoot, label: `gate-${target}-${level}`, gate: { id: gate.id, version: String(gate.version), fileSha }, startedAtMs: cachePlan.startedAtMs })
  const lease = await acquireLease({ class: 'gate', command: `qa:motion ${rest.join(' ')}`, cwd: repoRoot, timeoutMinutes })
  if (typeof lease === 'number')
    return lease
  const workers = resolveWorkers(parsed.command.workers, lease.grant)

  let run
  try {
    run = createRun({ tool: 'motion', label: `gate-${target}-${level}`, repoRoot, gate: { id: gate.id, version: String(gate.version), fileSha } })
  }
  catch (error) {
    console.error(`Cannot start the run: ${errorMessageFrom(error) ?? 'unknown error'}`)
    lease.release()
    return 1
  }

  const cpuBefore = await sampleCpuUtilization()
  const started = Date.now()
  const files = target === 'emotion'
    ? [...selection.emotions.map(emotion => `gates/emotion-${emotion}.gate.ts`), 'gates/null.gate.ts']
    : ['gates/liveliness.gate.ts']
  mkdirSync(run.path('partials'), { recursive: true })

  const finish = (exitCode: number, summary: string) => {
    lease.release()
    const wallSeconds = Math.round((Date.now() - started) / 100) / 10
    const timing = {
      wallSeconds,
      workers,
      grant: lease.grant,
      cores: cpus().length,
      cpuUtilizationBefore: Math.round(cpuBefore * 1000) / 1000,
      freeMemoryGb: Math.round(freemem() / 2 ** 30 * 10) / 10,
      totalMemoryGb: Math.round(totalmem() / 2 ** 30 * 10) / 10,
      targets: timingTargets,
      note: 'Targets are not asserted.',
    }
    writeFileSync(run.path('timing.json'), `${JSON.stringify(timing, null, 2)}\n`)
    run.addArtifact('timing.json', 'timing')
    run.finish({ exitCode, summary: `${summary} [wall ${wallSeconds}s, ${workers} workers of ${timing.cores} cores, cpu busy before ${Math.round(cpuBefore * 100)}%]` })
    console.info(`run ${run.runId} (${wallSeconds}s, ${workers} workers, cpu busy before ${Math.round(cpuBefore * 100)}%)`)
    return exitCode
  }

  try {
    const result = await runVitest(repoRoot, files, {
      ...env,
      ...lease.env,
      ...gateEnv,
      QA_RUN_DIR: run.dir,
    }, workers, run.path('vitest.log'), timeoutMinutes * 60_000, lease)
    run.addArtifact('vitest.log', 'log')
    if (result.exitCode !== 0) {
      const reason = result.timedOut ? `timed out after ${timeoutMinutes} min` : `vitest exited ${result.exitCode}`
      console.error(`Gate run broke (${reason}); see ${run.path('vitest.log')}\n${readFileSync(run.path('vitest.log'), 'utf8').slice(-2000)}`)
      return finish(1, `gate run broke: ${reason}`)
    }

    const context = { runDir: run.dir, fileSha, level }
    const report = target === 'emotion' ? aggregateEmotion(context, emotionGate, selection) : aggregateLiveliness(context, naturalIdleLivelinessGate)
    writeFileSync(run.path('report.json'), `${JSON.stringify(report, null, 2)}\n`)
    run.addArtifact('report.json', 'report')
    const summary = formatSummary(report)
    writeFileSync(run.path('summary.txt'), summary)
    run.addArtifact('summary.txt', 'summary')
    console.info(summary)
    const verdictSummary = report.pass ? 'all checks passed' : `${report.results.filter(result => result.verdict !== 'pass').length} check(s) failed or incomplete`
    const exitCode = finish(report.pass ? 0 : 1, verdictSummary)
    if (cachePlan)
      cacheFinishedRun({ plan: cachePlan, repoRoot, closure, runDir: run.dir, sourceRunId: run.runId, exitCode, summary: verdictSummary, artifacts: ['report.json', 'summary.txt'] })
    return exitCode
  }
  catch (error) {
    console.error(`Gate run broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
    return finish(1, `gate run broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  }
}
