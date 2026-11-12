import type { VerifyRun } from './verify-history'
import type { VerifyStep } from './verify-plan'

import process from 'node:process'

import { readFileSync } from 'node:fs'
import { delimiter, join, relative } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { acquire } from '@proj-airi/cpu-slots'

import { compileCacheEnv } from './lib/compile-cache'
import { capture, chunkByLength, nodeCommandChunkLimits, run, shimCommandChunkLimits } from './lib/exec'
import { gatedNotice, listGatedTestFiles } from './lib/gated-tests'
import { changedFiles, git, gitCommonDir, repoRoot, workingTreeHash } from './lib/git'
import { decideReuse, envKeyOf, readLastPass, readTreeRecords, toolchainOf, writeLastPass, writeTreeRecord } from './verify-cache'
import { appendVerifyRun, formatVerifyStats, readVerifyStats } from './verify-history'
import { advanceLastPass, lintAllFixable, parseVerifyArgs, planStepLease, planVerify, selectBrowserTestProjects, selectVerifyScope, testPrerequisiteTurboArgs, touchesAppRuntime, typecheckFilters, verifyUsage } from './verify-plan'

interface Command {
  label: string
  args: string[]
  /** Whether the granted slot count is passed to the command as `--concurrency`. */
  concurrency?: boolean
}

interface StepResult {
  step: VerifyStep
  status: 'passed' | 'cached' | 'failed' | 'skipped'
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

function commandsFor(step: VerifyStep, root: string, plan: ReturnType<typeof planVerify>, browserProjects: string[]): Command[] | string {
  const node = (entry: string, args: string[]) => [join(root, entry), ...args]
  if (step === 'typecheck') {
    if (plan.typecheck.kind === 'none')
      return 'no workspace package changed'
    const filters = typecheckFilters(plan.typecheck, plan.typecheckPackagePaths)
    const label = plan.typecheck.kind === 'all' ? `every package (${plan.typecheck.reason})` : 'changed packages and their dependents'
    return [{ label, args: node('node_modules/turbo/bin/turbo', ['run', 'typecheck', ...filters, '--output-logs=errors-only']), concurrency: true }]
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
    return 'no code file changed'
  const configs: { config: string, projects: string[] }[] = [
    { config: 'vitest.config.ts', projects: [] },
    ...(browserProjects.length ? [{ config: 'vitest.browser.config.ts', projects: browserProjects }] : []),
  ]
  // `vitest related` resolves relative paths against each project's package root.
  const absoluteFiles = plan.testFiles.map(file => join(root, file))
  const rebuild: Command = {
    label: 'rebuild stale workspace packages',
    args: node('node_modules/turbo/bin/turbo', testPrerequisiteTurboArgs),
    concurrency: true,
  }
  const related: Command[] = configs.flatMap(({ config, projects }) => chunkByLength(absoluteFiles, nodeCommandChunkLimits).map(files => ({
    label: `tests related to changes (${config}${projects.length ? `, projects ${projects.join(', ')}` : ''})`,
    args: node('node_modules/vitest/vitest.mjs', ['related', '--run', '--passWithNoTests', '--config', config, ...projects.flatMap(project => ['--project', project]), ...files]),
  })))
  return [rebuild, ...related]
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
  const treePassDir = join(cacheDir, 'tree-passes')
  const historyDir = process.env.AIRI_VERIFY_HISTORY_DIR ?? cacheDir
  if (args.stats) {
    const stats = readVerifyStats(historyDir, args.stats.sinceMs ? Date.now() - args.stats.sinceMs : 0)
    console.info(args.stats.json ? JSON.stringify(stats, null, 2) : formatVerifyStats(stats))
    return 0
  }
  let base: string
  try {
    base = git(root, ['merge-base', 'HEAD', args.base])
  }
  catch (error) {
    console.error(`Cannot find the merge base with ${args.base}: ${errorMessageFrom(error) ?? 'unknown error'}`)
    return 2
  }
  const workspaces = workspacePackages(root)
  const tree = workingTreeHash(root)
  const branch = git(root, ['branch', '--show-current']) || null
  const head = git(root, ['rev-parse', 'HEAD'])
  const context = { branch, mergeBase: base, gate: args.gate }
  const toolchain = toolchainOf(process.version, process.platform)
  const envKey = envKeyOf(process.env)
  // Shared passes are read and written only for a committed tree: HEAD's tree with nothing staged, unstaged or untracked.
  const isClean = () => git(root, ['status', '--porcelain', '--untracked-files=normal']) === '' && git(root, ['rev-parse', 'HEAD^{tree}']) === tree
  const record = branch && !args.gate ? readLastPass(cacheDir, branch) : null
  const recordStep = (step: VerifyStep, status: 'passed' | 'cached') => {
    if (!branch)
      return
    // Reread so a completed step never replaces another step's newer record with the startup copy.
    const next = advanceLastPass(readLastPass(cacheDir, branch), context, {
      step,
      status,
      entry: { tree, head, recordedAt: new Date().toISOString() },
    })
    if (next)
      writeLastPass(cacheDir, branch, next)
  }
  // Windows spells the variable `Path`; a second `PATH` key would hide the system directories.
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  const env = { ...process.env, ...compileCacheEnv(process.env, root), [pathKey]: `${join(root, 'node_modules/.bin')}${delimiter}${process.env[pathKey] ?? ''}` }

  const slotsEnabled = !process.env.CI && process.env.AIRI_CPU_SLOTS !== 'off'
  console.info(`verify: merge base with ${args.base} ${base.slice(0, 9)}, tree ${tree.slice(0, 9)}`)
  if (args.gate && touchesAppRuntime(changedFiles(root, base, tree)))
    console.info('gate reminder: app runtime changed; run pnpm qa:display run -- pnpm qa:smoke before landing.')
  const results: StepResult[] = []
  const finish = (result: StepResult, history: Pick<VerifyRun, 'scopeBase' | 'mode' | 'commands' | 'files' | 'waitMs' | 'grant'>) => {
    results.push(result)
    if (!args.dryRun) {
      const status = { passed: 'pass', failed: 'fail', cached: 'cached', skipped: 'skipped' } as const
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
      finish({ step, status: 'skipped', detail: 'not run: lint failed', durationMs: 0 }, { scopeBase: base, mode: 'branch', commands: [], files: [], waitMs: 0, grant: null })
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
    console.info(`[${step}] scope: ${scope.mode === 'incremental' ? `incremental from ${scope.base} (${scope.reason})` : `branch (${scope.reason})`}`)
    const changed = changedFiles(root, scope.base, tree)
    const history: Pick<VerifyRun, 'scopeBase' | 'mode' | 'commands' | 'files' | 'waitMs' | 'grant'> = {
      scopeBase: scope.base,
      mode: scope.mode,
      commands: [],
      files: changed.map(file => file.path),
      waitMs: 0,
      grant: null,
    }
    console.info(`[${step}] ${changed.length} changed file(s)`)
    if (args.dryRun) {
      for (const file of changed)
        console.info(`  ${file.deleted ? 'D' : 'M'} ${file.path}`)
    }
    const plan = planVerify(changed, workspaces.paths, workspaces.rootDependencyPaths)
    const affected = step === 'test' ? withDependents(root, plan.testPackagePaths) : []
    const browserProjects = step === 'test' ? selectBrowserTestProjects(affected) : []
    const commands = commandsFor(step, root, plan, browserProjects)
    if (typeof commands === 'string') {
      finish({ step, status: 'skipped', detail: commands, durationMs: 0 }, history)
      continue
    }
    if (step === 'test')
      gatedTestNotice = gatedNotice(listGatedTestFiles(root), affected, changed.map(file => file.path), process.env)
    const decision = args.dryRun
      ? null
      : decideReuse({ step, tree, toolchain, envKey, gate: args.gate, changed: changed.map(file => file.path), clean: isClean(), noCache: args.force }, readTreeRecords(treePassDir, tree))
    if (decision?.kind === 'reuse' && workingTreeHash(root) === tree) {
      const { pass } = decision
      console.info(`[${step}] cached: passed at ${tree.slice(0, 12)} in ${pass.worktree} at ${pass.at} (${pass.mode} pass covering ${pass.covers.length} file(s) from ${pass.coverBase.slice(0, 9)}; this scope asks ${changed.length})`)
      recordStep(step, 'cached')
      finish({ step, status: 'cached', detail: `passed at ${tree.slice(0, 12)} in ${pass.worktree} at ${pass.at}`, durationMs: 0 }, { ...history, commands: commands.map(item => [process.execPath, ...item.args]) })
      continue
    }
    if (decision?.kind === 'run' && decision.reason !== 'no pass at this tree')
      console.info(`[${step}] not reused: ${decision.reason}`)
    const affectedTypecheckCount = step === 'typecheck' && plan.typecheck.kind === 'affected'
      ? withDependents(root, plan.typecheckPackagePaths).length
      : 0
    const leasePlan = planStepLease(step, plan.typecheck, affectedTypecheckCount)
    if (args.dryRun) {
      console.info(`[${step}] acquire one lease (class ${leasePlan.class}${leasePlan.max !== undefined ? `, max ${leasePlan.max}` : ''})`)
      for (const item of commands)
        console.info(`[${step}] ${item.label}\n  node ${[relative(root, item.args[0]), ...item.args.slice(1), ...(item.concurrency && slotsEnabled ? ['--concurrency={grant}'] : [])].join(' ')}`)
      finish({ step, status: 'skipped', detail: 'dry run', durationMs: 0 }, history)
      continue
    }
    const started = Date.now()
    let failed: string | null = null
    const lease = await acquire({ ...leasePlan, cwd: root, command: `verify ${step}` }).catch((error: unknown) => {
      finish({ step, status: 'failed', detail: 'lease acquisition failed', durationMs: Date.now() - started }, history)
      throw error
    })
    const executed: string[][] = []
    const execution = { ...history, commands: executed, waitMs: lease.waitMs ?? 0, grant: lease.grant }
    let output = ''
    const keepLintOutput = (text: string) => {
      output += text
    }
    try {
      for (const item of commands) {
        console.info(`\n[${step}] ${item.label}`)
        const args = item.concurrency && lease.grant !== null ? [...item.args, `--concurrency=${lease.grant}`] : item.args
        executed.push([process.execPath, ...args])
        const exitCode = await run(process.execPath, args, { cwd: root, env: { ...env, ...lease.env }, onSpawn: lease.addWorkload, onOutput: step === 'lint' ? keepLintOutput : undefined })
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
    finally {
      lease.release()
    }
    const durationMs = Date.now() - started
    if (failed) {
      writeTreeRecord(treePassDir, { kind: 'failure', step, tree, toolchain, envKey, worktree: root, at: new Date().toISOString() })
      finish({ step, status: 'failed', detail: failed, durationMs }, execution)
      if (step === 'lint') {
        lintFailed = true
        if (lintAllFixable(output))
          console.info('\nhint: every lint problem above is auto-fixable: run pnpm lint:fix, then verify again')
      }
      continue
    }
    const labels = commands.map(item => item.label).join('; ')
    if (workingTreeHash(root) !== tree) {
      finish({ step, status: 'passed', detail: `${labels} (not cached: files changed during the step)`, durationMs }, execution)
      continue
    }
    if (isClean()) {
      // An incremental pass continues the per-branch record, so it vouches for the whole range from the merge base.
      const coverBase = scope.mode === 'incremental' ? base : scope.base
      const covers = scope.mode === 'incremental' ? changedFiles(root, coverBase, tree).map(file => file.path) : changed.map(file => file.path)
      writeTreeRecord(treePassDir, { kind: 'pass', step, tree, toolchain, envKey, mode: scope.mode, covers, coverBase, worktree: root, branch, at: new Date().toISOString(), durationMs })
    }
    recordStep(step, 'passed')
    finish({ step, status: 'passed', detail: labels, durationMs }, execution)
  }

  console.info('\nverify summary')
  for (const result of results)
    console.info(`  ${result.step.padEnd(9)} ${result.status.padEnd(7)} ${result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s ` : ''}${result.detail}`)
  if (gatedTestNotice)
    console.info(gatedTestNotice)
  return results.some(result => result.status === 'failed') ? 1 : 0
}

main().then(code => process.exit(code), (error) => {
  console.error(`verify broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  process.exit(1)
})
