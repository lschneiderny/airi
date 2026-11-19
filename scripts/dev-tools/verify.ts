import type { VerifyRun } from './verify-history'
import type { VerifyStep } from './verify-plan'

import process from 'node:process'

import { readFileSync } from 'node:fs'
import { delimiter, join, relative } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import { compileCacheEnv } from './lib/compile-cache'
import { capture, chunkByLength, nodeCommandChunkLimitsFor, run, shimCommandChunkLimits } from './lib/exec'
import { gatedNotice, listGatedTestFiles } from './lib/gated-tests'
import { changedFiles, git, gitCommonDir, repoRoot, workingTreeHash } from './lib/git'
import { appendVerifyRun, formatVerifyStats, readVerifyStats } from './verify-history'
import { readLastPass, writeLastPass } from './verify-last-pass'
import { advanceLastPass, followUpChecks, lintAllFixable, parseVerifyArgs, planVerify, relatedTestCommand, selectVerifyScope, testPrerequisiteTurboArgs, typecheckFilters, verifyUsage } from './verify-plan'

interface Command {
  label: string
  args: string[]
  /** The package directory the command runs in, relative to the root. Without it, the command runs in the root. */
  packagePath?: string
  env?: Record<string, string>
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

function commandsFor(step: VerifyStep, root: string, plan: ReturnType<typeof planVerify>, testedPackagePaths: string[]): Command[] | string {
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
  return [rebuild, ...rootRelated, ...packageRelated]
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
  const env = { ...process.env, ...compileCacheEnv(process.env, root), [pathKey]: `${join(root, 'node_modules/.bin')}${delimiter}${process.env[pathKey] ?? ''}` }

  console.info(`verify: merge base with ${args.base} ${base.slice(0, 9)}, tree ${tree.slice(0, 9)}`)
  const followUps = followUpChecks(changedFiles(root, base, tree))
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
    console.info(`[${step}] scope: ${scope.mode === 'incremental' ? `incremental from ${scope.base} (${scope.reason})` : `branch (${scope.reason})`}`)
    const changed = changedFiles(root, scope.base, tree)
    const history: Pick<VerifyRun, 'scopeBase' | 'mode' | 'commands' | 'files'> = {
      scopeBase: scope.base,
      mode: scope.mode,
      commands: [],
      files: changed.map(file => file.path),
    }
    console.info(`[${step}] ${changed.length} changed file(s)`)
    if (args.dryRun) {
      for (const file of changed)
        console.info(`  ${file.deleted ? 'D' : 'M'} ${file.path}`)
    }
    const plan = planVerify(changed, workspaces.paths, workspaces.rootDependencyPaths)
    const affected = step === 'test' ? withDependents(root, plan.testPackagePaths) : []
    const commands = commandsFor(step, root, plan, affected)
    if (typeof commands === 'string') {
      finish({ step, status: 'skipped', detail: commands, durationMs: 0 }, history)
      continue
    }
    if (step === 'test')
      gatedTestNotice = gatedNotice(listGatedTestFiles(root), affected, changed.map(file => file.path), process.env)
    if (args.dryRun) {
      for (const item of commands)
        console.info(`[${step}] ${item.label}\n  ${item.packagePath ? `(in ${item.packagePath}) ` : ''}node ${[relative(root, item.args[0]), ...item.args.slice(1)].join(' ')}`)
      finish({ step, status: 'skipped', detail: 'dry run', durationMs: 0 }, history)
      continue
    }
    const started = Date.now()
    let failed: string | null = null
    const executed: string[][] = []
    const execution = { ...history, commands: executed }
    let output = ''
    const keepLintOutput = (text: string) => {
      output += text
    }
    try {
      for (const item of commands) {
        console.info(`\n[${step}] ${item.label}`)
        executed.push([process.execPath, ...item.args])
        const exitCode = await run(process.execPath, item.args, { cwd: item.packagePath ? join(root, item.packagePath) : root, env: { ...env, ...item.env }, onOutput: step === 'lint' ? keepLintOutput : undefined })
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
        if (lintAllFixable(output))
          console.info('\nhint: every lint problem above is auto-fixable: run pnpm lint:fix, then verify again')
      }
      continue
    }
    const labels = commands.map(item => item.label).join('; ')
    if (workingTreeHash(root) !== tree) {
      finish({ step, status: 'passed', detail: `${labels} (not recorded: files changed during the step)`, durationMs }, execution)
      continue
    }
    recordStep(step)
    finish({ step, status: 'passed', detail: labels, durationMs }, execution)
  }

  console.info('\nverify summary')
  for (const result of results)
    console.info(`  ${result.step.padEnd(9)} ${result.status.padEnd(7)} ${result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s ` : ''}${result.detail}`)
  if (gatedTestNotice)
    console.info(gatedTestNotice)
  if (followUps.length > 0) {
    console.info('\nalso needed, not run by verify (docs/ai/context/testing.md):')
    for (const line of followUps)
      console.info(`  ${line}`)
  }
  return results.some(result => result.status === 'failed') ? 1 : 0
}

main().then(code => process.exit(code), (error) => {
  console.error(`verify broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  process.exit(1)
})
