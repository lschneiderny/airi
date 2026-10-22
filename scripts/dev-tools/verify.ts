import type { CpuClass } from '@proj-airi/cpu-slots'

import type { VerifyStep } from './verify-plan'

import process from 'node:process'

import { readFileSync } from 'node:fs'
import { delimiter, join, relative } from 'node:path'

import { errorMessageFrom } from '@moeru/std'
import { acquire } from '@proj-airi/cpu-slots'

import { capture, chunkByLength, nodeCommandChunkLimits, run, shimCommandChunkLimits } from './lib/exec'
import { changedFiles, git, gitCommonDir, repoRoot, workingTreeHash } from './lib/git'
import { readPass, verifyCacheKey, writePass } from './verify-cache'
import { extraTestConfigs, parseVerifyArgs, planVerify, stripWorkerFlags, testPrerequisiteTurboArgs, verifyUsage } from './verify-plan'

interface Command {
  label: string
  args: string[]
  /** The CPU slot class the command runs under. */
  cpuClass: CpuClass
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

function commandsFor(step: VerifyStep, root: string, base: string, plan: ReturnType<typeof planVerify>): Command[] | string {
  const node = (entry: string, args: string[]) => [join(root, entry), ...args]
  if (step === 'typecheck') {
    if (plan.typecheck.kind === 'none')
      return 'no workspace package changed'
    const filters = plan.typecheck.kind === 'all'
      ? ['-F=./packages/*', '-F=./apps/*', '-F=./server/**', '-F=./services/*']
      : [`--filter=...[${base}]`]
    const label = plan.typecheck.kind === 'all' ? `every package (${plan.typecheck.reason})` : 'changed packages and their dependents'
    return [{ label, args: node('node_modules/turbo/bin/turbo', ['run', 'typecheck', ...filters, '--output-logs=errors-only']), cpuClass: 'typecheck', concurrency: true }]
  }
  if (step === 'lint') {
    if (!plan.lintFiles.length)
      return 'no lintable file changed'
    return chunkByLength(plan.lintFiles, shimCommandChunkLimits).map((files, index, all) => ({
      label: `${files.length} changed file(s)${all.length > 1 ? ` [batch ${index + 1}/${all.length}]` : ''}`,
      args: node('node_modules/@moeru/eslint-config/src/moeru-lint.js', files),
      cpuClass: 'lint',
    }))
  }
  if (!plan.testFiles.length)
    return 'no code file changed'
  const configs = [{ config: 'vitest.config.ts', project: undefined as string | undefined }, ...(plan.extraTestConfigs ? extraTestConfigs : [])]
  // `vitest related` resolves relative paths against the config's root, and the extra configs are rooted in their packages.
  const absoluteFiles = plan.testFiles.map(file => join(root, file))
  const rebuild: Command = {
    label: 'rebuild stale workspace packages',
    args: node('node_modules/turbo/bin/turbo', testPrerequisiteTurboArgs),
    cpuClass: 'build',
    concurrency: true,
  }
  const related: Command[] = configs.flatMap(({ config, project }) => chunkByLength(absoluteFiles, nodeCommandChunkLimits).map(files => ({
    label: `tests related to changes (${config}${project ? `, project ${project}` : ''})`,
    args: node('node_modules/vitest/vitest.mjs', ['related', '--run', '--passWithNoTests', '--config', config, ...(project ? ['--project', project] : []), ...files]),
    // Every extra config holds browser projects; the root config only runs node tests. The child's vitest wrapper enforces the cap.
    cpuClass: project || config !== 'vitest.config.ts' ? 'browser' : 'test',
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
  let base: string
  try {
    base = git(root, ['merge-base', 'HEAD', args.base])
  }
  catch (error) {
    console.error(`Cannot find the merge base with ${args.base}: ${errorMessageFrom(error) ?? 'unknown error'}`)
    return 2
  }
  const changed = changedFiles(root, base)
  const workspaces = workspacePackages(root)
  const plan = planVerify(changed, workspaces.paths, workspaces.rootDependencyPaths)
  const tree = workingTreeHash(root)
  const cacheDir = join(gitCommonDir(root), 'airi-verify')
  // Windows spells the variable `Path`; a second `PATH` key would hide the system directories.
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  const env = { ...process.env, [pathKey]: `${join(root, 'node_modules/.bin')}${delimiter}${process.env[pathKey] ?? ''}` }

  const slotsEnabled = !process.env.CI && process.env.AIRI_CPU_SLOTS !== 'off'
  console.info(`verify: ${changed.length} changed file(s) since ${args.base} (${base.slice(0, 9)}), tree ${tree.slice(0, 9)}`)
  const results: StepResult[] = []
  for (const step of args.steps) {
    const commands = commandsFor(step, root, base, plan)
    if (typeof commands === 'string') {
      results.push({ step, status: 'skipped', detail: commands, durationMs: 0 })
      continue
    }
    const command = stripWorkerFlags(commands.flatMap(item => item.args))
    const key = verifyCacheKey({ tree, step, command, node: process.version, platform: process.platform })
    const cached = args.force ? null : readPass(cacheDir, key)
    if (cached) {
      results.push({ step, status: 'cached', detail: `passed ${cached.passedAt} on this tree`, durationMs: 0 })
      continue
    }
    if (args.dryRun) {
      for (const item of commands)
        console.info(`[${step}] ${item.label} (class ${item.cpuClass})\n  node ${[relative(root, item.args[0]), ...item.args.slice(1), ...(item.concurrency && slotsEnabled ? ['--concurrency={grant}'] : [])].join(' ')}`)
      results.push({ step, status: 'skipped', detail: 'dry run', durationMs: 0 })
      continue
    }
    const started = Date.now()
    let failed: string | null = null
    for (const item of commands) {
      console.info(`\n[${step}] ${item.label}`)
      const lease = await acquire({ class: item.cpuClass, cwd: root, command: `verify ${step}: ${item.label}` })
      let exitCode: number
      try {
        const args = item.concurrency && lease.grant !== null ? [...item.args, `--concurrency=${lease.grant}`] : item.args
        exitCode = await run(process.execPath, args, { cwd: root, env: { ...env, ...lease.env }, onSpawn: lease.addWorkload })
      }
      finally {
        lease.release()
      }
      if (exitCode !== 0) {
        failed = `${item.label} exited ${exitCode}`
        break
      }
    }
    const durationMs = Date.now() - started
    if (failed) {
      results.push({ step, status: 'failed', detail: failed, durationMs })
      continue
    }
    const labels = commands.map(item => item.label).join('; ')
    if (workingTreeHash(root) !== tree) {
      results.push({ step, status: 'passed', detail: `${labels} (not cached: files changed during the step)`, durationMs })
      continue
    }
    writePass(cacheDir, { key, step, tree, command, passedAt: new Date().toISOString(), durationMs })
    results.push({ step, status: 'passed', detail: labels, durationMs })
  }

  console.info('\nverify summary')
  for (const result of results)
    console.info(`  ${result.step.padEnd(9)} ${result.status.padEnd(7)} ${result.durationMs ? `${(result.durationMs / 1000).toFixed(1)}s ` : ''}${result.detail}`)
  return results.some(result => result.status === 'failed') ? 1 : 0
}

main().then(code => process.exit(code), (error) => {
  console.error(`verify broke: ${errorMessageFrom(error) ?? 'unknown error'}`)
  process.exit(1)
})
