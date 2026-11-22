import type { GatedRun } from './lib/gated-tests'
import type { VerifyRun } from './verify-history'
import type { GateNeed, GateQaOutcome, VerifyArgs, VerifyStep } from './verify-plan'

import process from 'node:process'

import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { delimiter, join, relative } from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { newestMtime } from '../../packages/lab-tools/src/model/core-agent-dist'
import { loadQaEnv } from '../../packages/qa-tools/src/env/load'
import { compileCacheEnv } from './lib/compile-cache'
import { capture, chunkByLength, nodeCommandChunkLimitsFor, run, shimCommandChunkLimits } from './lib/exec'
import { gatedNotice, listGatedTestFiles, planGatedRun, qaGatedFiles } from './lib/gated-tests'
import { changedFiles, git, gitCommonDir, repoRoot, workingTreeHash } from './lib/git'
import { appendVerifyRun, formatVerifyStats, readVerifyStats } from './verify-history'
import { readLastPass, writeLastPass } from './verify-last-pass'
import { advanceLastPass, defaultWaitSeconds, followUpChecks, gateQaCommand, gateQaFor, gateQaOutcome, lintAllFixable, modelTestsOutcome, parseVerifyArgs, planVerify, relatedTestCommand, selectVerifyScope, staleBuildPackagePaths, staleBuildTurboArgs, testPrerequisiteTurboArgs, typecheckFilters, verifyUsage } from './verify-plan'
import { createRunRecord, latestRunRecord, newRunId, pruneRuns, runLogPath, runsDir, waitForRun, writeRunRecord } from './verify-runs'

interface Command {
  label: string
  /**
   * The arguments, or a function that decides them when the command's turn comes, from what the commands before it left
   * on disk. A function that returns `null` skips the command.
   */
  args: string[] | (() => string[] | null)
  /** The package directory the command runs in, relative to the root. Without it, the command runs in the root. */
  packagePath?: string
  env?: Record<string, string>
}

/** Lines of a failed command's output that verify prints when its output is not a terminal. */
const failureTailLines = 60

/**
 * Verify's own output. Every line and all command output go to the run log. On a terminal, command output also streams
 * to the console; otherwise the console gets only `say` lines, which the run record keeps as the run's report.
 */
class Reporter {
  readonly lines: string[] = []

  constructor(readonly tty: boolean, readonly logPath: string | null) {}

  say(line: string): void {
    console.info(line)
    this.lines.push(line)
    this.log(`${line}\n`)
  }

  /** A line of command output that the log already holds, repeated for a reader without a terminal. */
  quote(line: string): void {
    console.info(line)
    this.lines.push(line)
  }

  /** Progress a terminal reader wants and an agent does not. */
  detail(line: string): void {
    if (this.tty)
      console.info(line)
    this.log(`${line}\n`)
  }

  log(text: string): void {
    if (this.logPath)
      appendFileSync(this.logPath, text)
  }
}

/**
 * Runs one command with its output in the run log. On a terminal the output also streams; otherwise a nonzero exit
 * prints the output's tail under `label`.
 */
async function runLogged(out: Reporter, label: string, command: string, args: string[], options: { cwd: string, env: NodeJS.ProcessEnv }): Promise<{ exitCode: number, output: string }> {
  let output = ''
  const exitCode = await run(command, args, {
    ...options,
    echo: out.tty,
    onOutput: (text) => {
      output += text
      out.log(text)
    },
  })
  if (exitCode !== 0 && !out.tty) {
    const lines = stripVTControlCharacters(output).trimEnd().split('\n')
    out.say(`\n${label} exited ${exitCode}${lines.length > failureTailLines ? `; its last ${failureTailLines} lines (all of it is in the full log)` : ''}:`)
    for (const line of lines.slice(-failureTailLines))
      out.quote(line)
  }
  return { exitCode, output }
}

interface StepResult {
  step: VerifyStep
  status: 'passed' | 'failed' | 'skipped'
  detail: string
  durationMs: number
}

function workspacePackages(root: string): { paths: string[], rootDependencyPaths: string[] } {
  const listing = JSON.parse(capture(process.execPath, [join(root, 'node_modules/turbo/bin/turbo'), 'ls', '--output=json'], { cwd: root })) as { packages: { items: { name: string, path: string }[] } }
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>, devDependencies?: Record<string, string> }
  const rootWorkspaceDeps = new Set(Object.entries({ ...manifest.dependencies, ...manifest.devDependencies }).filter(([, range]) => range.startsWith('workspace:')).map(([name]) => name))
  return {
    paths: listing.packages.items.map(item => item.path.replaceAll('\\', '/')),
    rootDependencyPaths: listing.packages.items.filter(item => rootWorkspaceDeps.has(item.name)).map(item => item.path.replaceAll('\\', '/')),
  }
}

/** The given package directories plus every workspace package that depends on one, through Turbo's package graph. */
function withDependents(root: string, packagePaths: string[]): string[] {
  if (!packagePaths.length)
    return []
  const filters = packagePaths.map(path => `--filter=...{./${path}}`)
  const listing = JSON.parse(capture(process.execPath, [join(root, 'node_modules/turbo/bin/turbo'), 'ls', ...filters, '--output=json'], { cwd: root })) as { packages: { items: { path: string }[] } }
  return listing.packages.items.map(item => item.path.replaceAll('\\', '/'))
}

function testRunScript(root: string, packagePath: string): string | undefined {
  return (JSON.parse(readFileSync(join(root, packagePath, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts?.['test:run']
}

function commandsFor(step: VerifyStep, root: string, plan: ReturnType<typeof planVerify>, testedPackagePaths: string[], packagePaths: string[]): Command[] | string {
  const node = (entry: string, args: string[]) => [join(root, entry), ...args]
  if (step === 'typecheck') {
    if (plan.typecheck.kind === 'none')
      return 'no workspace package changed'
    const filters = typecheckFilters(plan.typecheck, plan.typecheckPackagePaths)
    const label = plan.typecheck.kind === 'all' ? `every package (${plan.typecheck.reason})` : 'changed packages and their dependents'
    return [{ label, args: node('node_modules/turbo/bin/turbo', ['run', 'typecheck', ...filters, '--output-logs=errors-only']) }]
  }
  if (step === 'lint') {
    if (!plan.lintFiles.length)
      return 'no lintable file changed'
    return chunkByLength(plan.lintFiles, shimCommandChunkLimits).map((files, index, all) => ({
      label: `${files.length} changed file(s)${all.length > 1 ? ` [batch ${index + 1}/${all.length}]` : ''}`,
      args: node('node_modules/@moeru/eslint-config/src/moeru-lint.js', files),
    }))
  }
  if (!plan.testFiles.length)
    return 'no code or test data file changed'
  // `vitest related` resolves relative paths against the directory it starts in, so the files are absolute.
  const chunks = chunkByLength(plan.testFiles.map(file => join(root, file)), nodeCommandChunkLimitsFor(process.platform))
  const rebuild: Command = {
    label: 'rebuild stale workspace packages',
    args: node('node_modules/turbo/bin/turbo', testPrerequisiteTurboArgs),
  }
  // Decided after the rebuild, so a package Turbo just rebuilt is not built twice.
  const forceStale: Command = {
    label: 'force-rebuild packages whose dist is older than src',
    args: () => {
      const stale = staleBuildPackagePaths(packagePaths, path => newestMtime(join(root, path)))
      return stale.length ? node('node_modules/turbo/bin/turbo', staleBuildTurboArgs(stale)) : null
    },
  }
  const rootRelated: Command[] = chunks.map(files => ({
    label: 'tests related to changes (root projects)',
    args: node('node_modules/vitest/vitest.mjs', ['related', '--run', '--passWithNoTests', '--config', 'vitest.config.ts', ...files]),
  }))
  // One Vitest process per package, in the package's own directory and config, one after the other.
  const packageRelated: Command[] = testedPackagePaths.flatMap((packagePath) => {
    const script = testRunScript(root, packagePath)
    const command = script === undefined ? null : relatedTestCommand(script)
    if (!command)
      return []
    return chunks.map(files => ({
      label: `tests related to changes (${packagePath})`,
      args: node('node_modules/vitest/vitest.mjs', [...command.args, ...files]),
      packagePath,
      env: command.env,
    }))
  })
  return [rebuild, forceStale, ...rootRelated, ...packageRelated]
}

/** The plan `pnpm qa:test:model` makes in this environment: the same files, with `.env.qa` loaded without overriding. */
function modelTestsPlan(root: string, env: NodeJS.ProcessEnv): GatedRun {
  const qaEnv = { ...env }
  const { file } = loadQaEnv(root, qaEnv)
  return planGatedRun(qaGatedFiles(listGatedTestFiles(root)), qaEnv, file, existsSync)
}

async function waitCommand(cacheDir: string, root: string, wait: { id: string | null, timeoutMs: number }): Promise<number> {
  const id = wait.id ?? latestRunRecord(cacheDir, root)?.id
  if (!id) {
    console.error('No verify run has started in this worktree.')
    return 2
  }
  const outcome = await waitForRun(cacheDir, id, { timeoutMs: wait.timeoutMs })
  if (outcome.kind === 'missing') {
    console.error(`No verify run ${id} in ${runsDir(cacheDir)}.`)
    return 2
  }
  const { record } = outcome
  if (outcome.kind === 'running') {
    console.info(`verify run ${id} is still running after ${Math.round(wait.timeoutMs / 1000)}s. Wait again with pnpm verify --wait ${id}\nlog: ${record.log}`)
    return 3
  }
  if (outcome.kind === 'lost') {
    console.info(`verify run ${id} (pid ${record.pid}) ended without recording a result. Its log: ${record.log}`)
    return 1
  }
  console.info(`verify run ${id}, started ${Math.round((Date.now() - record.startedAt) / 1000)}s ago:`)
  for (const line of record.report)
    console.info(line)
  // Any run that did not pass is 1 here; 2 stays a usage error of this --wait.
  return record.exitCode === 0 ? 0 : 1
}

/** Starts this command again as a detached process with the same arguments, minus `--detach`. */
function detach(cacheDir: string, root: string): number {
  const id = newRunId(Date.now(), process.pid)
  const argv = process.argv.slice(2).filter(arg => arg !== '--detach')
  const child = spawn(process.execPath, [...process.execArgv, process.argv[1], ...argv], {
    cwd: process.cwd(),
    env: { ...process.env, AIRI_VERIFY_RUN_ID: id },
    detached: true,
    stdio: 'ignore',
  })
  child.unref()
  if (child.pid === undefined) {
    console.error('verify could not start a background run.')
    return 1
  }
  // Written here as well as by the run, so a --wait that follows at once finds the record. Only when the run has not
  // written its own yet: a fast run can already have recorded its end.
  createRunRecord(cacheDir, { id, pid: child.pid, worktree: root, status: 'running', startedAt: Date.now(), finishedAt: null, exitCode: null, log: runLogPath(cacheDir, id), report: [] })
  console.info(`verify run ${id} started in the background.\n  wait: pnpm verify --wait ${id}   (blocks up to ${defaultWaitSeconds}s; allow the call 10 minutes)\n  log:  ${runLogPath(cacheDir, id)}`)
  return 0
}

async function main(): Promise<number> {
  const parsed = parseVerifyArgs(process.argv.slice(2))
  if (!parsed.ok) {
    console.error(`${parsed.message}\n${verifyUsage}`)
    return 2
  }
  const { args } = parsed
  const root = repoRoot(process.cwd())
  const cacheDir = join(gitCommonDir(root), 'airi-verify')
  const historyDir = process.env.AIRI_VERIFY_HISTORY_DIR ?? cacheDir
  if (args.stats) {
    const stats = readVerifyStats(historyDir, args.stats.sinceMs ? Date.now() - args.stats.sinceMs : 0)
    console.info(args.stats.json ? JSON.stringify(stats, null, 2) : formatVerifyStats(stats))
    return 0
  }
  if (args.wait)
    return waitCommand(cacheDir, root, args.wait)
  if (args.detach)
    return detach(cacheDir, root)
  if (args.dryRun)
    return verifyRun(args, root, cacheDir, historyDir, new Reporter(Boolean(process.stdout.isTTY), null))

  const id = process.env.AIRI_VERIFY_RUN_ID ?? newRunId(Date.now(), process.pid)
  const log = runLogPath(cacheDir, id)
  pruneRuns(cacheDir)
  mkdirSync(runsDir(cacheDir), { recursive: true })
  const startedAt = Date.now()
  const record = { id, pid: process.pid, worktree: root, startedAt, log }
  writeRunRecord(cacheDir, { ...record, status: 'running', finishedAt: null, exitCode: null, report: [] })
  const reporter = new Reporter(Boolean(process.stdout.isTTY), log)
  let code = 1
  try {
    code = await verifyRun(args, root, cacheDir, historyDir, reporter)
  }
  catch (error) {
    reporter.say(`verify broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  }
  finally {
    reporter.say(`full log: ${log}`)
    writeRunRecord(cacheDir, { ...record, status: code === 0 ? 'passed' : 'failed', finishedAt: Date.now(), exitCode: code, report: reporter.lines })
  }
  return code
}

async function verifyRun(args: VerifyArgs, root: string, cacheDir: string, historyDir: string, out: Reporter): Promise<number> {
  let base: string
  try {
    base = git(root, ['merge-base', 'HEAD', args.base])
  }
  catch (error) {
    out.say(`Cannot find the merge base with ${args.base}: ${errorMessageFrom(error) ?? 'unknown error'}`)
    return 2
  }
  const workspaces = workspacePackages(root)
  const tree = workingTreeHash(root)
  const branch = git(root, ['branch', '--show-current']) || null
  const head = git(root, ['rev-parse', 'HEAD'])
  const context = { branch, mergeBase: base, gate: args.gate }
  const record = branch && !args.gate ? readLastPass(cacheDir, branch) : null
  const recordStep = (step: VerifyStep) => {
    if (!branch)
      return
    // Reread so a completed step never replaces another step's newer record with the startup copy.
    const next = advanceLastPass(readLastPass(cacheDir, branch), context, {
      step,
      status: 'passed',
      entry: { tree, head, recordedAt: new Date().toISOString() },
    })
    if (next)
      writeLastPass(cacheDir, branch, next)
  }
  // Windows spells the variable `Path`; a second `PATH` key would hide the system directories.
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  // Checks never inherit this run's id; a verify they start is a run of its own.
  const { AIRI_VERIFY_RUN_ID: _runId, ...inherited } = process.env
  // Output is piped so the run log keeps it, which turns colors off in the tools; on a terminal they get them back.
  const color = out.tty && process.env.FORCE_COLOR === undefined && process.env.NO_COLOR === undefined ? { FORCE_COLOR: '1' } : {}
  const env = { ...inherited, ...color, ...compileCacheEnv(process.env, root), [pathKey]: `${join(root, 'node_modules/.bin')}${delimiter}${process.env[pathKey] ?? ''}` }

  out.say(`verify: merge base with ${args.base} ${base.slice(0, 9)}, tree ${tree.slice(0, 9)}`)
  const branchChanges = changedFiles(root, base, tree)
  const results: StepResult[] = []
  const finish = (result: StepResult, history: Pick<VerifyRun, 'scopeBase' | 'mode' | 'commands' | 'files'>) => {
    results.push(result)
    if (!args.dryRun) {
      const status = { passed: 'pass', failed: 'fail', skipped: 'skipped' } as const
      appendVerifyRun(historyDir, {
        ts: Date.now(),
        worktree: root,
        branch,
        head,
        tree,
        ...history,
        step: result.step,
        status: status[result.status],
        durationMs: result.durationMs,
      })
    }
  }
  let gatedTestNotice: string | null = null
  let lintFailed = false
  for (const step of args.steps) {
    if (lintFailed) {
      finish({ step, status: 'skipped', detail: 'not run: lint failed', durationMs: 0 }, { scopeBase: base, mode: 'branch', commands: [], files: [] })
      continue
    }
    const entry = record?.steps[step]
    let treeExists = false
    if (entry && record?.mergeBase === base) {
      try {
        git(root, ['cat-file', '-e', `${entry.tree}^{tree}`])
        treeExists = true
      }
      catch {
        // Pruned objects invalidate the incremental baseline; selectVerifyScope explains the fallback.
      }
    }
    const scope = selectVerifyScope(context, { record, step, treeExists })
    out.say(`[${step}] scope: ${scope.mode === 'incremental' ? `incremental from ${scope.base} (${scope.reason})` : `branch (${scope.reason})`}`)
    const changed = changedFiles(root, scope.base, tree)
    const history: Pick<VerifyRun, 'scopeBase' | 'mode' | 'commands' | 'files'> = {
      scopeBase: scope.base,
      mode: scope.mode,
      commands: [],
      files: changed.map(file => file.path),
    }
    out.say(`[${step}] ${changed.length} changed file(s)`)
    if (args.dryRun) {
      for (const file of changed)
        out.say(`  ${file.deleted ? 'D' : 'M'} ${file.path}`)
    }
    const plan = planVerify(changed, workspaces.paths, workspaces.rootDependencyPaths)
    const affected = step === 'test' ? withDependents(root, plan.testPackagePaths) : []
    const commands = commandsFor(step, root, plan, affected, workspaces.paths)
    if (typeof commands === 'string') {
      finish({ step, status: 'skipped', detail: commands, durationMs: 0 }, history)
      continue
    }
    if (step === 'test')
      gatedTestNotice = gatedNotice(listGatedTestFiles(root), affected, changed.map(file => file.path), process.env)
    if (args.dryRun) {
      for (const item of commands) {
        const line = typeof item.args === 'function' ? '(decided after the commands before it)' : `node ${[relative(root, item.args[0]), ...item.args.slice(1)].join(' ')}`
        out.say(`[${step}] ${item.label}\n  ${item.packagePath ? `(in ${item.packagePath}) ` : ''}${line}`)
      }
      finish({ step, status: 'skipped', detail: 'dry run', durationMs: 0 }, history)
      continue
    }
    const started = Date.now()
    let failed: string | null = null
    const executed: string[][] = []
    const execution = { ...history, commands: executed }
    let stepOutput = ''
    try {
      for (const item of commands) {
        const args = typeof item.args === 'function' ? item.args() : item.args
        if (!args) {
          out.detail(`\n[${step}] ${item.label}: none`)
          continue
        }
        out.detail(`\n[${step}] ${item.label}`)
        executed.push([process.execPath, ...args])
        const { exitCode, output } = await runLogged(out, `[${step}] ${item.label}`, process.execPath, args, { cwd: item.packagePath ? join(root, item.packagePath) : root, env: { ...env, ...item.env } })
        stepOutput += output
        if (exitCode !== 0) {
          failed = `${item.label} exited ${exitCode}`
          break
        }
      }
    }
    catch (error) {
      finish({ step, status: 'failed', detail: 'command execution failed', durationMs: Date.now() - started }, execution)
      throw error
    }
    const durationMs = Date.now() - started
    if (failed) {
      finish({ step, status: 'failed', detail: failed, durationMs }, execution)
      if (step === 'lint') {
        lintFailed = true
        if (lintAllFixable(stepOutput))
          out.say('\nhint: every lint problem above is auto-fixable: run pnpm lint:fix, then verify again')
      }
      continue
    }
    const labels = commands.length > 3 ? `${commands.length} commands` : commands.map(item => item.label).join('; ')
    if (workingTreeHash(root) !== tree) {
      finish({ step, status: 'passed', detail: `${labels} (not recorded: files changed during the step)`, durationMs }, execution)
      continue
    }
    recordStep(step)
    finish({ step, status: 'passed', detail: labels, durationMs }, execution)
  }

  const qaResults: (GateQaOutcome & { durationMs: number })[] = []
  const met = new Set<GateNeed>()
  if (args.gate && !results.some(result => result.status === 'failed')) {
    for (const qa of gateQaFor(branchChanges)) {
      const command = gateQaCommand(qa, process.platform, base, `verify-${process.pid}`)
      if (typeof command === 'string') {
        qaResults.push({ status: 'skipped', met: [], detail: command, durationMs: 0 })
        continue
      }
      if (args.dryRun) {
        out.say(`[qa] ${command.argv.join(' ')}`)
        continue
      }
      if (qa === 'motion-affected' && git(root, ['rev-parse', 'HEAD^{tree}']) !== tree) {
        qaResults.push({ status: 'skipped', met: [], detail: 'qa:motion3d affected: not run, it reads commits and the working tree has uncommitted changes', durationMs: 0 })
        continue
      }
      const plan = qa === 'model-tests' ? modelTestsPlan(root, env) : null
      if (plan && !plan.ok) {
        qaResults.push({ ...modelTestsOutcome(plan), durationMs: 0 })
        continue
      }
      out.detail(`\n[qa] ${command.argv.join(' ')}`)
      const started = Date.now()
      try {
        const { exitCode, output } = await runLogged(out, `[qa] ${command.argv.join(' ')}`, command.argv[0], command.argv.slice(1), { cwd: root, env })
        const outcome = qa === 'model-tests' ? modelTestsOutcome(plan!, exitCode) : gateQaOutcome(qa, exitCode, output)
        for (const need of outcome.met)
          met.add(need)
        qaResults.push({ ...outcome, durationMs: Date.now() - started })
      }
      finally {
        if (command.after)
          await runLogged(out, `[qa] ${command.after.join(' ')}`, command.after[0], command.after.slice(1), { cwd: root, env })
      }
    }
  }
  const followUps = followUpChecks(branchChanges, met)

  out.say('\nverify summary')
  for (const result of results)
    out.say(`  ${result.step.padEnd(9)} ${result.status.padEnd(7)} ${result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s ` : ''}${result.detail}`)
  for (const result of qaResults)
    out.say(`  ${'qa'.padEnd(9)} ${result.status.padEnd(7)} ${result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s ` : ''}${result.detail}`)
  if (gatedTestNotice)
    out.say(gatedTestNotice)
  if (followUps.length > 0) {
    out.say('\nalso needed, not run by verify (docs/ai/context/testing.md):')
    for (const line of followUps)
      out.say(`  ${line}`)
  }
  return [...results, ...qaResults].some(result => result.status === 'failed') ? 1 : 0
}

main().then(code => process.exit(code), (error) => {
  console.error(`verify broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  process.exit(1)
})
