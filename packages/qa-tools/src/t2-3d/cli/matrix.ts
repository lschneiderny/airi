import type { Motion3dCliContext } from '../../../bin/motion3d'
import type { MatrixFile, PlannedRun } from '../matrix/plan'
import type { CommandRecord, MatrixReceipt } from '../matrix/receipt'

import process from 'node:process'

import { createHash } from 'node:crypto'
import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { readGitStateFromRepo } from '../../evidence/run'
import { sha256 } from '../gate/load'
import { matrixFileSchema, planMatrix, preflightRefusals, reportArguments, runArguments } from '../matrix/plan'
import { compareReceipts, formatReceipt, receiptExitCode, receiptSchema, reportErrors, summarizeVerdict } from '../matrix/receipt'
import { runMotion3dChild } from './motion3d-child'
import { readVerdict } from './verdicts'

const usage = 'Usage: qa:motion3d matrix <matrix file> --out <new directory> [--parallel <n>] [--memory-floor <MB>] [--allow-dirty] [--fail-on <status>[,<status>...]] [--runs-from <folder>] [--compare <receipt.json>] | qa:motion3d matrix compare <then receipt.json> <now receipt.json>'
const RUN_FILES = ['trace.json', 'summary.json', 'run.json']

class Refusal extends Error {
  override readonly name = 'Refusal'
}

async function parsedJson<T>(path: string, schema: v.GenericSchema<unknown, T>, what: string): Promise<T> {
  let json: unknown
  try {
    json = JSON.parse(await readFile(path, 'utf8'))
  }
  catch (error) {
    throw new Refusal(`cannot read ${what} ${path}: ${errorMessageFrom(error) ?? 'unreadable'}`)
  }
  const parsed = v.safeParse(schema, json)
  if (!parsed.success)
    throw new Refusal(`${path} is not a ${what}: ${v.summarize(parsed.issues)}`)
  return parsed.output
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path))
    hash.update(chunk)
  return hash.digest('hex')
}

/** MemAvailable in MB, or null on a platform without /proc/meminfo. */
function memoryAvailable(): number | null {
  if (!existsSync('/proc/meminfo'))
    return null
  const match = /^MemAvailable:\s+(\d+) kB/m.exec(readFileSync('/proc/meminfo', 'utf8'))
  return match ? Math.floor(Number(match[1]) / 1024) : null
}

/** Why a run's trace does not belong to this matrix: another scenario, seed, model or (for a made run) commit. */
async function traceErrors(dir: string, run: PlannedRun, modelSha256: string, commit: string | null): Promise<string[]> {
  const path = join(dir, 'trace.json')
  if (!existsSync(path))
    return ['no trace.json']
  const header = v.safeParse(v.object({ source: v.object({ gitSha: v.nullable(v.string()), scenario: v.object({ id: v.string(), seed: v.nullable(v.number()) }) }), rig: v.object({ assetSha256: v.nullable(v.string()) }) }), JSON.parse(await readFile(path, 'utf8')))
  if (!header.success)
    return [`unreadable trace.json: ${v.summarize(header.issues)}`]
  const { source, rig } = header.output
  return [
    ...(source.scenario.id === run.scenario && source.scenario.seed === run.seed ? [] : [`trace is ${source.scenario.id} seed ${source.scenario.seed}, declared ${run.scenario} seed ${run.seed}`]),
    ...(rig.assetSha256 === modelSha256 ? [] : [`trace model ${rig.assetSha256}, rig ${run.rig} is ${modelSha256}`]),
    ...(commit === null || source.gitSha === commit ? [] : [`trace commit ${source.gitSha}, matrix commit ${commit}`]),
  ]
}

interface Options {
  readonly file: string
  readonly out: string
  readonly parallel: number
  readonly memoryFloor: number
  readonly allowDirty: boolean
  readonly failOn: readonly string[]
  readonly runsFrom: string | null
  readonly compare: string | null
}

async function runMatrix(options: Options, context: Motion3dCliContext): Promise<number> {
  const startedAt = new Date().toISOString()
  const matrix: MatrixFile = await parsedJson(options.file, matrixFileSchema, 'motion3d-matrix file')
  const then = options.compare === null ? null : await parsedJson(options.compare, receiptSchema, 'matrix receipt')
  const plan = planMatrix(matrix)
  const rigs = Object.fromEntries(Object.entries(matrix.rigs).map(([rig, entry]) => {
    const path = 'env' in entry ? (process.env[entry.env] || null) : resolve(dirname(options.file), entry.path)
    return [rig, { path, exists: path !== null && existsSync(path), source: 'env' in entry ? `$${entry.env}` : 'path' }]
  }))
  const git = readGitStateFromRepo(context.repoRoot)
  const refusals = [...plan.refusals, ...preflightRefusals({ dirty: git.dirty, allowDirty: options.allowDirty, rigs, outEntries: existsSync(options.out) ? readdirSync(options.out) : [] })]
  for (const run of options.runsFrom === null ? [] : plan.runs.filter(run => !existsSync(join(options.runsFrom ?? '', run.id, 'trace.json'))))
    refusals.push(`--runs-from has no ${run.id}/trace.json`)
  if (refusals.length)
    throw new Refusal(`refusing to start: ${refusals.join('; ')}`)
  const models = Object.fromEntries(await Promise.all(Object.entries(rigs).map(async ([rig, model]) => [rig, { source: model.source, path: model.path ?? '', sha256: await fileSha256(model.path ?? '') }] as const)))
  const runDir = (id: string) => join(options.out, 'runs', id)
  for (const folder of ['runs', 'verdicts', 'logs'])
    await mkdir(join(options.out, folder), { recursive: true })
  const memory = memoryAvailable() === null ? 'no /proc/meminfo on this platform: runs start without a memory wait' : `runs wait while MemAvailable is under ${options.memoryFloor} MB; parallel ${options.parallel}`
  console.info(`qa:motion3d matrix: ${plan.runs.length} runs, ${plan.reports.length} reports at ${git.gitSha}${git.dirty ? ' (dirty)' : ''}; ${memory}`)
  const commands: CommandRecord[] = []
  const queue = [...plan.runs]
  const worker = async () => {
    for (let run = queue.shift(); run && !context.signal.aborted; run = queue.shift()) {
      const model = models[run.rig]
      const base = { id: run.id, criterion: run.criterion }
      if (options.runsFrom !== null) {
        await mkdir(runDir(run.id))
        const from = join(options.runsFrom, run.id)
        for (const name of RUN_FILES.filter(name => existsSync(join(from, name))))
          await copyFile(join(from, name), join(runDir(run.id), name))
        commands.push({ ...base, kind: 'copy', argv: [from], exitCode: 0, durationMs: 0, errors: await traceErrors(runDir(run.id), run, model.sha256, null) })
        continue
      }
      while ((memoryAvailable() ?? Number.POSITIVE_INFINITY) < options.memoryFloor && !context.signal.aborted)
        await sleep(5000)
      if (context.signal.aborted)
        return
      const child = await runMotion3dChild(runArguments(run, model.path, runDir(run.id)), join(options.out, 'logs', `${run.id}.out`), context.signal)
      const errors = child.exitCode === 0 ? await traceErrors(runDir(run.id), run, model.sha256, git.gitSha) : [`run exited ${child.exitCode}`]
      commands.push({ ...base, kind: 'run', argv: [...child.argv], exitCode: child.exitCode, durationMs: child.durationMs, errors })
      console.info(`run ${run.id}: exit ${child.exitCode} (${(child.durationMs / 1000).toFixed(0)} s)${errors.length ? `; ${errors.join('; ')}` : ''}`)
    }
  }
  await Promise.all(Array.from({ length: options.parallel }, worker))
  commands.sort((a, b) => plan.runs.findIndex(run => run.id === a.id) - plan.runs.findIndex(run => run.id === b.id))
  for (const report of plan.reports) {
    if (context.signal.aborted)
      return 130
    const json = join(options.out, 'verdicts', `${report.id}.json`)
    const child = await runMotion3dChild(reportArguments(report, runDir, json), join(options.out, 'logs', `${report.id}.out`), context.signal)
    const verdict = await readVerdict(json)
    const given = [...report.runs, ...report.options.flatMap(([, ids]) => ids)].map(runDir)
    commands.push({ id: report.id, kind: 'report', criterion: report.criterion, argv: [...child.argv], exitCode: child.exitCode, durationMs: child.durationMs, ...(typeof verdict === 'string' ? {} : { verdict: summarizeVerdict(json, verdict) }), errors: reportErrors(child.exitCode, verdict, given) })
    console.info(`report ${report.id}: exit ${child.exitCode}, ${typeof verdict === 'string' ? `ERROR ${verdict}` : `${verdict.report} v${verdict.reportVersion ?? '-'} ${verdict.verdict}`}`)
  }
  const receipt: MatrixReceipt = {
    kind: 'motion3d-matrix-receipt',
    version: 1,
    matrix: { path: options.file, sha256: sha256(await readFile(options.file)) },
    commit: git.gitSha,
    dirty: git.dirty,
    allowDirty: options.allowDirty,
    startedAt,
    endedAt: new Date().toISOString(),
    rigs: models,
    runsFrom: options.runsFrom,
    memory,
    failOn: [...options.failOn],
    commands,
    exitCode: receiptExitCode(commands, options.failOn),
  }
  await writeFile(join(options.out, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)
  await writeFile(join(options.out, 'receipt.md'), formatReceipt(receipt))
  console.info(`receipt: ${join(options.out, 'receipt.md')}; exit ${receipt.exitCode}`)
  return then === null ? receipt.exitCode : Math.max(receipt.exitCode, printComparison(then, receipt))
}

function printComparison(then: MatrixReceipt, now: MatrixReceipt): number {
  const rows = compareReceipts(then, now)
  for (const row of rows)
    console.info(`${row.same ? 'SAME' : 'DIFFERENT'} ${row.id}: then ${row.then}; now ${row.now}`)
  const different = rows.filter(row => !row.same).length
  console.info(`compared ${rows.length} commands: ${different} different`)
  return different ? 1 : 0
}

/**
 * `qa:motion3d matrix`: runs a declared scenario x seed x rig matrix and its reports at one commit and writes
 * `receipt.json` and `receipt.md`. Exit 0 when every command ran and every verdict file was read, 1 on an error (or a
 * verdict `--fail-on` names, or a `--compare` difference), 2 when it refuses before running, 130 when interrupted.
 */
export async function matrixMotion3d(args: readonly string[], context: Motion3dCliContext): Promise<number> {
  try {
    if (args[0] === 'compare') {
      if (args.length !== 3)
        throw new Refusal(usage)
      return printComparison(await parsedJson(resolve(context.cwd, args[1]), receiptSchema, 'matrix receipt'), await parsedJson(resolve(context.cwd, args[2]), receiptSchema, 'matrix receipt'))
    }
    const { values, positionals } = parseArgs({ args: [...args], allowPositionals: true, strict: true, options: {
      'out': { type: 'string' },
      'parallel': { type: 'string', default: '2' },
      'memory-floor': { type: 'string', default: '8000' },
      'allow-dirty': { type: 'boolean', default: false },
      'fail-on': { type: 'string' },
      'runs-from': { type: 'string' },
      'compare': { type: 'string' },
    } })
    const parallel = Number(values.parallel)
    const memoryFloor = Number(values['memory-floor'])
    if (positionals.length !== 1 || !values.out || !Number.isSafeInteger(parallel) || parallel < 1 || !Number.isFinite(memoryFloor) || memoryFloor < 0)
      throw new Refusal(usage)
    const at = (path: string | undefined) => path === undefined ? null : resolve(context.cwd, path)
    return await runMatrix({
      file: resolve(context.cwd, positionals[0]),
      out: resolve(context.cwd, values.out),
      parallel,
      memoryFloor,
      allowDirty: values['allow-dirty'],
      failOn: values['fail-on']?.split(',').map(status => status.trim().toUpperCase()).filter(Boolean) ?? [],
      runsFrom: at(values['runs-from']),
      compare: at(values.compare),
    }, context)
  }
  catch (error) {
    if (!(error instanceof Refusal) && (!(error instanceof TypeError) || !('code' in error) || !String(error.code).startsWith('ERR_PARSE_ARGS')))
      throw error
    console.error(`qa:motion3d matrix: ${error.message}`)
    return 2
  }
}
