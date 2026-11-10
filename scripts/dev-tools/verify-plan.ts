import type { AcquireOptions } from '@proj-airi/cpu-slots'

import type { ChangedFile } from './lib/git'

import { classes } from '@proj-airi/cpu-slots'

export const verifySteps = ['typecheck', 'lint', 'test'] as const
export type VerifyStep = typeof verifySteps[number]

/**
 * Root files that change what every package's typecheck sees. A change to one of them typechecks
 * every package, because Turbo's `[ref]` filter maps root files to no package.
 */
const typecheckGlobalFile = /^(?:tsconfig[^/]*\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|[^/]+\.d\.ts)$/

const codeFile = /\.(?:[cm]?[jt]sx?|vue)$/
const binaryFile = /\.(?:png|jpe?g|gif|webp|avif|ico|icns|bmp|svgz|mp[34]|wav|ogg|flac|webm|mov|zip|7z|gz|tgz|woff2?|ttf|otf|moc3|vrm|pmx|pmd|vmd|glb|gltf|bin|exe|dll|node|wasm|pdf|psd)$/i

export interface ExtraTestConfig {
  config: string
  project?: string
}

/** Vitest configs that `pnpm test:run` runs besides the root config, with the project it selects. */
export const extraTestConfigs: ExtraTestConfig[] = [
  { config: 'apps/stage-tamagotchi/vitest.config.ts', project: 'browser' },
  { config: 'packages/stage-ui/vitest.config.ts' },
  { config: 'packages/stage-ui-live2d/vitest.config.ts', project: 'browser' },
  { config: 'packages/model-driver-lipsync/vitest.config.ts', project: 'browser' },
  { config: 'packages/stage-ui-three/vitest.config.ts', project: 'browser' },
  { config: 'packages/stage-ui-mmd/vitest.config.ts', project: 'browser' },
  { config: 'packages/stage-pages/vitest.config.ts' },
  { config: 'apps/stage-web/vitest.config.ts', project: 'browser' },
  { config: 'packages/audio/vitest.config.ts', project: 'browser' },
]

/**
 * Turbo arguments that rebuild stale workspace package output before the test step. Tests import `dist` output such as
 * the i18n locales, and a pull or merge that changes package sources leaves it stale while the install step stays
 * skipped. Turbo skips a package whose input hash is unchanged.
 */
export const testPrerequisiteTurboArgs = ['run', 'build', '-F=./packages/*', '--output-logs=errors-only']

export type TypecheckScope = { kind: 'none' } | { kind: 'affected' } | { kind: 'all', reason: string }

/** One request covers every command in a step, including the test build prerequisite. */
export function planStepLease(step: VerifyStep, typecheck: TypecheckScope, affectedPackageCount: number): Pick<AcquireOptions, 'class' | 'max'> {
  if (step === 'typecheck' && typecheck.kind === 'affected')
    return { class: step, max: Math.max(classes.typecheck.min, affectedPackageCount) }
  return { class: step }
}

export interface VerifyPlan {
  typecheck: TypecheckScope
  lintFiles: string[]
  testFiles: string[]
  /**
   * Workspace package directories that hold a changed code file. The extra configs only hold package tests, so they
   * run only for these packages and the packages that depend on them.
   */
  testPackagePaths: string[]
}

function packageOf(path: string, packagePaths: string[]): string | undefined {
  return packagePaths.find(packagePath => path === packagePath || path.startsWith(`${packagePath}/`))
}

function inPackage(path: string, packagePaths: string[]): boolean {
  return packageOf(path, packagePaths) !== undefined
}

/**
 * Keeps the extra configs whose package is in `affectedPackagePaths`: the packages with a changed code file plus every
 * package that depends on one. A config in any other package cannot import the changed code, so `vitest related`
 * would only start its browser to find nothing.
 */
export function selectExtraTestConfigs(affectedPackagePaths: string[]): ExtraTestConfig[] {
  const affected = new Set(affectedPackagePaths)
  return extraTestConfigs.filter(({ config }) => affected.has(config.slice(0, config.lastIndexOf('/'))))
}

/**
 * Decides what each step covers. `packagePaths` are workspace package directories relative to the root, using `/`.
 * `rootDependencyPaths` are the directories of the workspace packages the root `package.json` depends on. Turbo's
 * `...[ref]` filter reaches the root workspace through them, and from there every package, so a change confined to one
 * of them uses the same directory scope as a root config change.
 */
export function planVerify(changed: ChangedFile[], packagePaths: string[], rootDependencyPaths: string[] = []): VerifyPlan {
  const present = changed.filter(file => !file.deleted).map(file => file.path)
  const globalFile = changed.find(file => typecheckGlobalFile.test(file.path))
  let typecheck: TypecheckScope = { kind: 'none' }
  if (globalFile) {
    typecheck = { kind: 'all', reason: `${globalFile.path} changed` }
  }
  else if (changed.some(file => inPackage(file.path, packagePaths))) {
    const rootDependency = changed.find(file => inPackage(file.path, rootDependencyPaths))
    typecheck = rootDependency
      ? { kind: 'all', reason: `${rootDependency.path} is in a root dependency` }
      : { kind: 'affected' }
  }
  const testFiles = present.filter(path => codeFile.test(path))
  return {
    typecheck,
    lintFiles: present.filter(path => !binaryFile.test(path)),
    testFiles,
    testPackagePaths: [...new Set(testFiles.map(path => packageOf(path, packagePaths)).filter(path => path !== undefined))],
  }
}

const workerFlag = /^--(?:maxWorkers|concurrency)(?:=|$)/

/**
 * Drops the CPU-budget flags (`--maxWorkers`, `--concurrency`) so the verify cache key does not depend on the
 * grant a run happened to receive. Both `--flag=N` and `--flag N` spellings are removed.
 */
export function stripWorkerFlags(command: string[]): string[] {
  const kept: string[] = []
  for (let index = 0; index < command.length; index++) {
    const token = command[index]
    if (!workerFlag.test(token)) {
      kept.push(token)
      continue
    }
    if (!token.includes('='))
      index++
  }
  return kept
}

export interface VerifyArgs {
  base: string
  steps: VerifyStep[]
  force: boolean
  dryRun: boolean
}

export type ParsedVerifyArgs = { ok: true, args: VerifyArgs } | { ok: false, message: string }

export const verifyUsage = `Usage: pnpm verify [--base <ref>] [--only typecheck,lint,test] [--force] [--dry-run]

  --base     compare against the merge base with <ref> (default main)
  --only     run only these steps (default all)
  --force    ignore cached passes for this working tree
  --dry-run  print the plan and commands without running them
Exit codes: 0 every step passed, 1 a step failed, 2 usage error.`

export function parseVerifyArgs(argv: string[]): ParsedVerifyArgs {
  const args: VerifyArgs = { base: 'main', steps: [...verifySteps], force: false, dryRun: false }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--force') {
      args.force = true
    }
    else if (flag === '--dry-run') {
      args.dryRun = true
    }
    else if (flag === '--base' || flag === '--only') {
      const value = argv[++index]
      if (!value || value.startsWith('--'))
        return { ok: false, message: `${flag} needs a value` }
      if (flag === '--base') {
        args.base = value
        continue
      }
      const steps = value.split(',').map(step => step.trim()).filter(Boolean)
      const unknown = steps.filter(step => !verifySteps.includes(step as VerifyStep))
      if (!steps.length || unknown.length)
        return { ok: false, message: `Unknown step ${unknown.join(', ') || '(empty)'}. Valid steps: ${verifySteps.join(', ')}` }
      args.steps = verifySteps.filter(step => steps.includes(step))
    }
    else {
      return { ok: false, message: `Unknown argument ${JSON.stringify(flag)}` }
    }
  }
  return { ok: true, args }
}
