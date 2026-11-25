import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { ClearanceModel, ClearanceResults, ClearanceRow, ComparedResults } from '../clearance/results'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { readGitStateFromRepo } from '../../evidence/run'
import { clearanceResultsSchema, clearanceRow, FAIL_ABOVE_SCENARIO, formatComparison, formatResults, modelsFromList, modelsFromPaths, rigsAbove } from '../clearance/results'
import { clipClaimsAnArm, motion3dScenarios } from '../scenarios'

const usage = 'Usage: qa:motion3d clearance (--models <dir> | --list <file>) --out <new directory> [--scenarios idle-drive,speak,walk] [--seconds 40] [--seed 1] [--parallel 1-3] [--compare <clearance.json>] [--fail-above <share>]'
/** Each run is a heavy check (one core, about 1 GB); the repository allows at most three at once. */
const MAX_PARALLEL = 3
const QA_TOOLS = resolve(import.meta.dirname, '..', '..', '..')

class Refusal extends Error {
  override readonly name = 'Refusal'
}

interface Options {
  readonly models: readonly ClearanceModel[]
  readonly out: string
  readonly scenarios: readonly string[]
  readonly seconds: number
  readonly seed: number
  readonly parallel: number
  readonly compare: string | null
  readonly failAbove: number | null
}

async function parseOptions(args: readonly string[], cwd: string): Promise<Options> {
  const { values } = parseArgs({ args: [...args], strict: true, allowPositionals: false, options: {
    'models': { type: 'string' },
    'list': { type: 'string' },
    'out': { type: 'string' },
    'scenarios': { type: 'string', default: 'idle-drive,speak,walk' },
    'seconds': { type: 'string', default: '40' },
    'seed': { type: 'string', default: '1' },
    'parallel': { type: 'string', default: String(MAX_PARALLEL) },
    'compare': { type: 'string' },
    'fail-above': { type: 'string' },
  } })
  if ((values.models === undefined) === (values.list === undefined) || !values.out)
    throw new Refusal(usage)
  const out = resolve(cwd, values.out)
  if (existsSync(out))
    throw new Refusal(`--out already exists: ${out}`)
  const scenarios = values.scenarios.split(',').map(id => id.trim()).filter(Boolean)
  const unknown = scenarios.filter(id => !motion3dScenarios.some(scenario => scenario.id === id))
  // A scenario given twice would run twice into one run directory.
  if (!scenarios.length || unknown.length || new Set(scenarios).size !== scenarios.length)
    throw new Refusal(`--scenarios must name each scenario once, among: ${motion3dScenarios.map(scenario => scenario.id).join(', ')}`)
  const seconds = Number(values.seconds)
  const seed = Number(values.seed)
  const parallel = Number(values.parallel)
  if (!(seconds > 0) || !Number.isSafeInteger(seed) || !Number.isSafeInteger(parallel) || parallel < 1 || parallel > MAX_PARALLEL)
    throw new Refusal(`--seconds must be positive, --seed an integer, and --parallel 1 to ${MAX_PARALLEL}`)
  // The runner's own cap, checked here so a length it refuses is a refusal of the sweep and not a failed run of every model.
  const tooLong = scenarios.filter(id => seconds > (motion3dScenarios.find(scenario => scenario.id === id)?.maxSeconds ?? 120))
  if (tooLong.length)
    throw new Refusal(`--seconds ${seconds} is longer than the runner allows for: ${tooLong.join(', ')}`)
  const claimed = scenarios.filter(id => motion3dScenarios.some(scenario => scenario.id === id && clipClaimsAnArm(scenario, seed, seconds)))
  if (claimed.length)
    throw new Refusal(`the measure does not judge clip-driven arms, and a clip claims an arm in: ${claimed.join(', ')}`)
  const failAbove = values['fail-above'] === undefined ? null : Number(values['fail-above'])
  if (failAbove !== null && (!(failAbove >= 0) || !(failAbove <= 1)))
    throw new Refusal('--fail-above must be a share in [0, 1]')
  if (failAbove !== null && !scenarios.includes(FAIL_ABOVE_SCENARIO))
    throw new Refusal(`--fail-above reads the ${FAIL_ABOVE_SCENARIO} scenario; include it in --scenarios`)
  let models: ClearanceModel[]
  if (values.models !== undefined) {
    const dir = resolve(cwd, values.models)
    if (!existsSync(dir) || !statSync(dir).isDirectory())
      throw new Refusal(`--models must name a folder: ${dir}`)
    models = modelsFromPaths((await readdir(dir, { recursive: true })).map(path => join(dir, path)).filter(path => statSync(path).isFile()))
  }
  else {
    const list = resolve(cwd, values.list ?? '')
    try {
      models = modelsFromList(await readFile(list, 'utf8'), dirname(list))
    }
    catch (error) {
      throw new Refusal(`--list ${list}: ${errorMessageFrom(error) ?? 'unreadable'}`)
    }
  }
  const missing = models.filter(model => !existsSync(model.path))
  if (!models.length || missing.length)
    throw new Refusal(models.length ? `model files not found: ${missing.map(model => model.path).join(', ')}` : 'no .pmx model found')
  return { models, out, scenarios, seconds, seed, parallel, compare: values.compare === undefined ? null : resolve(cwd, values.compare), failAbove }
}

/** Runs `qa:motion3d run` in its own Node process, as the root script does, with its output in `log`. */
function runChild(args: readonly string[], log: string, signal: AbortSignal): Promise<number> {
  return new Promise((done, fail) => {
    const out = createWriteStream(log)
    const child = spawn(process.execPath, ['--import', 'tsx', join(QA_TOOLS, 'bin', 'motion3d.ts'), 'run', ...args], { cwd: QA_TOOLS, env: { ...process.env, INIT_CWD: QA_TOOLS }, stdio: ['ignore', 'pipe', 'pipe'], signal, killSignal: 'SIGTERM' })
    child.stdout.pipe(out, { end: false })
    child.stderr.pipe(out, { end: false })
    child.on('error', (error) => {
      if (error.name !== 'AbortError')
        fail(error)
    })
    child.on('close', code => out.end(() => done(code ?? 130)))
  })
}

/** One model and scenario: run it with `--clearance` and read its summary. */
async function measure(model: ClearanceModel, scenario: string, options: Options, signal: AbortSignal): Promise<ClearanceRow> {
  const run = join('runs', `${model.label}--${scenario}`)
  const log = join(options.out, 'logs', `${model.label}--${scenario}.log`)
  const exitCode = await runChild(['--model', model.path, '--scenario', scenario, '--seed', String(options.seed), '--seconds', String(options.seconds), '--out', join(options.out, run), '--clearance'], log, signal)
  const summaryPath = join(options.out, run, 'summary.json')
  let summary: unknown = null
  if (existsSync(summaryPath)) {
    try {
      summary = JSON.parse(await readFile(summaryPath, 'utf8'))
    }
    catch (error) {
      summary = { unreadable: errorMessageFrom(error) ?? 'unreadable' }
    }
  }
  return clearanceRow({ label: model.label, scenario, run, exitCode, summary })
}

/** The earlier results `--compare` names; an unreadable or invalid file is a refusal. */
async function readCompared(path: string): Promise<ComparedResults> {
  try {
    return v.parse(clearanceResultsSchema, JSON.parse(await readFile(path, 'utf8')))
  }
  catch (error) {
    throw new Refusal(`--compare ${path}: ${errorMessageFrom(error) ?? 'unreadable'}`)
  }
}

/**
 * `qa:motion3d clearance`: runs each scenario with `--clearance` on every model, at most three at a time, writes
 * `clearance.json` with one row per model and scenario, and prints the table, and with `--compare` each row before and
 * after. Exit 0 when every run was measured, 1 when a run ended without a summary or a rig's `idle-drive` pierced
 * share exceeds `--fail-above`, 2 on a refusal, 130 when interrupted. Ticks without a clear arm pose do not fail it.
 */
export async function clearanceMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  try {
    const options = await parseOptions(args, context.cwd)
    const before = options.compare === null ? null : await readCompared(options.compare)
    const git = readGitStateFromRepo(context.repoRoot)
    await mkdir(join(options.out, 'logs'), { recursive: true })
    const jobs = options.models.flatMap(model => options.scenarios.map(scenario => ({ model, scenario })))
    console.info(`qa:motion3d clearance: ${jobs.length} runs (${options.models.length} models x ${options.scenarios.length} scenarios), ${options.seconds} s, seed ${options.seed}, ${options.parallel} at a time`)
    const rows = new Map<number, ClearanceRow>()
    let next = 0
    const worker = async () => {
      while (next < jobs.length && !context.signal.aborted) {
        const index = next++
        const { model, scenario } = jobs[index]
        const row = await measure(model, scenario, options, context.signal)
        rows.set(index, row)
        console.info(`${row.label} ${row.scenario}: ${row.clearance ? `pierced ${(100 * row.clearance.piercedShare).toFixed(1)} %` : `failed (exit ${row.exitCode})`}`)
      }
    }
    await Promise.all(Array.from({ length: options.parallel }, worker))
    if (context.signal.aborted)
      return 130
    const ordered = jobs.map((_, i) => rows.get(i)).filter(row => row !== undefined)
    const results: ClearanceResults = { kind: 'motion3d-clearance', version: 1, gitSha: git.gitSha, dirty: git.dirty, seed: options.seed, seconds: options.seconds, scenarios: options.scenarios, rows: ordered }
    await writeFile(join(options.out, 'clearance.json'), `${JSON.stringify(results, null, 2)}\n`)
    console.info(formatResults(ordered))
    if (before)
      console.info(formatComparison(before, ordered))
    const failed = ordered.filter(row => !row.clearance)
    const above = options.failAbove === null ? [] : rigsAbove(ordered, options.failAbove)
    if (above.length)
      console.error(`qa:motion3d clearance: ${FAIL_ABOVE_SCENARIO} pierced above ${(100 * (options.failAbove ?? 0)).toFixed(1)} % on ${above.join(', ')}`)
    if (failed.length)
      console.error(`qa:motion3d clearance: ${failed.length} runs ended without a measure; see ${join(options.out, 'logs')}`)
    console.info(`results: ${join(options.out, 'clearance.json')}`)
    return failed.length || above.length ? 1 : 0
  }
  catch (error) {
    if (context.signal.aborted)
      return 130
    const refused = error instanceof Refusal || (error instanceof TypeError && 'code' in error && String(error.code).startsWith('ERR_PARSE_ARGS'))
    console.error(`qa:motion3d clearance: ${errorMessageFrom(error) ?? 'unknown failure'}`)
    return refused ? 2 : 1
  }
}
