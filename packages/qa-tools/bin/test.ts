import type { Buffer } from 'node:buffer'

import type { KnownFailureRegistry } from '../src/known-failures/schema'
import type { SuiteOutcome, SuiteTarget } from '../src/known-failures/suite'

import process, { argv, execPath, exit, kill, platform, stderr, stdout } from 'node:process'

import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { acquire } from '@proj-airi/cpu-slots'

import { resolveVitestEntry } from '../src/env/pnpm'
import { createRun } from '../src/evidence/run'
import { parseKnownFailureRegistry } from '../src/known-failures/schema'
import { evaluateSuiteRun, resolveSuiteTargets, summarizeRun } from '../src/known-failures/suite'

const usage = `Usage: pnpm qa:test (--all | --package <name> [--package <name> ...]) [--project node|browser]
                     [--registry <file>] [--timeout <seconds per suite>]

Runs each selected Vitest suite with the JSON reporter and compares failures with the known-failures registry.
Exit 1: a NEW failure, or a suite that timed out, crashed, or wrote no report. Exit 2: bad arguments or registry.`

const repoRoot = resolve(import.meta.dirname, '..', '..', '..')
const defaultRegistry = resolve(import.meta.dirname, '..', 'known-failures.json')
const defaultTimeoutSeconds = 1800

function label(target: SuiteTarget): string {
  return `${target.package} [${target.project}]`
}

function suiteFileBase(target: SuiteTarget): string {
  return `vitest-${target.package.replace(/^@[^/]+\//, '')}-${target.project}`
}

/** Browser projects drive a real browser and get the `browser` class; every other suite gets `test`. */
function suiteClass(target: SuiteTarget): 'browser' | 'test' {
  return target.project === 'browser' ? 'browser' : 'test'
}

function killTree(pid: number) {
  // Vitest starts workers and browsers; killing only the direct child would leave them running.
  if (platform === 'win32')
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', shell: false })
  else
    kill(-pid, 'SIGKILL')
}

async function runSuite(target: SuiteTarget, runDir: string, vitestEntry: string, timeoutSeconds: number): Promise<SuiteOutcome> {
  const packageDir = join(repoRoot, target.dir)
  const base = suiteFileBase(target)
  const reportFile = join(runDir, `${base}.json`)
  const logFile = join(runDir, `${base}.log`)
  const args = [vitestEntry, 'run', '--config', join(packageDir, 'vitest.config.ts')]
  if (target.project !== 'default')
    args.push('--project', target.project)
  args.push('--reporter=json', `--outputFile=${reportFile}`)

  // The suite's own vitest wrapper enforces the cap from the lease env, so no --maxWorkers flag is passed here.
  // The wait is bounded by the per-suite timeout; the run is bounded by it again below.
  const lease = await acquire({ class: suiteClass(target), command: `qa:test ${label(target)}`, cwd: packageDir, signal: AbortSignal.timeout(timeoutSeconds * 1000) })
  const log = createWriteStream(logFile)
  log.write(`$ ${execPath} ${args.join(' ')}\n(cwd ${packageDir})\n\n`)
  let output = ''
  const started = Date.now()
  stdout.write(`running ${label(target)} ...\n`)

  const child = spawn(execPath, args, { cwd: packageDir, env: { ...process.env, ...lease.env }, shell: false, stdio: ['ignore', 'pipe', 'pipe'], detached: platform !== 'win32' })
  if (child.pid !== undefined)
    lease.addWorkload(child.pid)
  const collect = (chunk: Buffer) => {
    output += chunk.toString()
    log.write(chunk)
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    if (child.pid !== undefined)
      killTree(child.pid)
  }, timeoutSeconds * 1000)

  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', code => resolveExit(code))
  }).finally(() => {
    clearTimeout(timer)
    lease.release()
  })
  await new Promise<void>(resolveEnd => log.end(resolveEnd))

  const outcome = evaluateSuiteRun({
    target,
    packageDir,
    exitCode,
    timedOutAfterSeconds: timedOut ? timeoutSeconds : undefined,
    reportText: !timedOut && existsSync(reportFile) ? readFileSync(reportFile, 'utf8') : undefined,
    output,
    logFile,
  })
  stdout.write(`  done in ${Math.round((Date.now() - started) / 1000)}s, vitest exit ${exitCode ?? 'signal'}${outcome.error ? ` - SUITE ERROR: ${outcome.error}` : ''}\n`)
  return outcome
}

function testLine(test: { package: string, project: string, file: string, name: string }): string {
  return `${test.package} [${test.project}] ${test.file} > ${test.name}`
}

function parseCliArgs() {
  return parseArgs({
    args: argv.slice(2).filter(arg => arg !== '--'),
    options: {
      package: { type: 'string', multiple: true, default: [] },
      project: { type: 'string' },
      all: { type: 'boolean', default: false },
      registry: { type: 'string' },
      timeout: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  }).values
}

async function main(): Promise<number> {
  let values: ReturnType<typeof parseCliArgs>
  try {
    values = parseCliArgs()
  }
  catch (error) {
    stderr.write(`${errorMessageFrom(error) ?? 'invalid arguments'}\n\n${usage}\n`)
    return 2
  }
  if (values.help) {
    stdout.write(`${usage}\n`)
    return 0
  }

  let targets: SuiteTarget[]
  let registry: KnownFailureRegistry
  const registryFile = values.registry === undefined ? defaultRegistry : resolve(values.registry)
  const timeoutSeconds = values.timeout === undefined ? defaultTimeoutSeconds : Number(values.timeout)
  try {
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
      throw new Error(`qa-tools: --timeout must be a positive number of seconds, got "${values.timeout}"`)
    targets = resolveSuiteTargets({ packages: values.package, project: values.project, all: values.all })
    if (!existsSync(registryFile))
      throw new Error(`qa-tools: known-failures registry ${registryFile} does not exist`)
    registry = parseKnownFailureRegistry(readFileSync(registryFile, 'utf8'), registryFile)
  }
  catch (error) {
    stderr.write(`${errorMessageFrom(error) ?? 'invalid arguments or registry'}\n`)
    return 2
  }

  const runLabel = values.all ? 'all' : [...values.package.map(name => name.replace(/^@[^/]+\//, '')), ...(values.project ? [values.project] : [])].join('_')
  const run = createRun({ tool: 'test', label: runLabel, repoRoot })
  const runDir = run.dir
  stdout.write(`registry: ${registryFile} (${registry.entries.length} entries)\nrun directory: ${runDir}\nper-suite timeout: ${timeoutSeconds}s\n\n`)

  const vitestEntry = resolveVitestEntry()
  const outcomes: SuiteOutcome[] = []
  for (const target of targets)
    outcomes.push(await runSuite(target, runDir, vitestEntry, timeoutSeconds))

  const summary = summarizeRun(outcomes, registry)
  const { diff } = summary
  const lines: string[] = ['', 'SUITES']
  for (const target of targets) {
    const counts = summary.counts.find(item => item.target === target)
    const error = summary.suiteErrors.find(item => item.target === target)
    lines.push(`  ${label(target)}: ${counts ? `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped` : 'no results'}${error ? ` - SUITE ERROR: ${error.error}` : ''}`)
  }
  lines.push('', `NEW failures: ${diff.newFailures.length}`)
  for (const result of diff.newFailures)
    lines.push(`  - ${testLine(result)}`, `      ${result.firstError ?? ''}`)
  lines.push('', `KNOWN failing: ${diff.knownFailing.length}`)
  for (const { entry } of diff.knownFailing)
    lines.push(`  - ${testLine(entry)}${entry.flaky ? ' (flaky)' : ''}`)
  lines.push('', `FIXED known failures (remove from registry): ${diff.fixedKnown.length}`)
  for (const { entry, observed } of diff.fixedKnown)
    lines.push(`  - ${testLine(entry)}${observed === 'not-run' ? ' (not run: renamed, deleted, or skipped; verify before removing)' : ''}`)
  lines.push('', `FLAKY entries that passed: ${diff.flakyPassed.length}`)
  for (const entry of diff.flakyPassed)
    lines.push(`  - ${testLine(entry)}`)
  if (summary.suiteErrors.length > 0) {
    lines.push('', `SUITE ERRORS: ${summary.suiteErrors.length}`)
    for (const { target, error } of summary.suiteErrors)
      lines.push(`  - ${label(target)}: ${error}`)
  }
  lines.push('', `exit ${summary.exitCode}`)
  stdout.write(`${lines.join('\n')}\n`)
  writeFileSync(run.path('summary.json'), `${JSON.stringify({ registry: registryFile, ...summary }, null, 2)}\n`)
  for (const target of targets) {
    const base = suiteFileBase(target)
    for (const [name, kind] of [[`${base}.json`, 'vitest-json-report'], [`${base}.log`, 'vitest-log']] as const) {
      if (existsSync(run.path(name)))
        run.addArtifact(name, kind)
    }
  }
  run.addArtifact('summary.json', 'known-failures-summary')
  run.finish({ exitCode: summary.exitCode, summary: `${diff.newFailures.length} new, ${diff.knownFailing.length} known, ${diff.fixedKnown.length} fixed, ${diff.flakyPassed.length} flaky passed, ${summary.suiteErrors.length} suite errors` })
  return summary.exitCode
}

main().then(
  code => exit(code),
  (error: unknown) => {
    stderr.write(`qa-tools: test runner failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    exit(1)
  },
)
