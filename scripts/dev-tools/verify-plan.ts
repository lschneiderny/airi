import type { AcquireOptions } from '@proj-airi/cpu-slots'

import type { BrowserTestProject } from './lib/browser-projects'
import type { ChangedFile } from './lib/git'
import type { VerifyStatsOptions } from './verify-history'

import { classes } from '@proj-airi/cpu-slots'

import { browserRootConfig } from './lib/browser-projects'
import { parseStatsArgs } from './verify-history'

/** Lint runs first: it is the cheapest step, and a lint failure stops verify before the slower steps start. */
export const verifySteps = ['lint', 'typecheck', 'test'] as const
export type VerifyStep = typeof verifySteps[number]

export interface VerifiedTree {
  readonly tree: string
  readonly head: string
  readonly recordedAt: string
}

export interface LastVerifyPass {
  readonly mergeBase: string
  readonly steps: Partial<Record<VerifyStep, VerifiedTree>>
}

export interface VerifyContext {
  readonly branch: string | null
  readonly mergeBase: string
  readonly gate: boolean
}

export interface VerifyScope {
  readonly mode: 'incremental' | 'branch'
  readonly base: string
  readonly reason: string
}

/** HEAD is deliberately not a baseline: commits made without verification must remain in scope. */
export function selectVerifyScope(context: VerifyContext, previous: { record: LastVerifyPass | null, step: VerifyStep, treeExists: boolean }): VerifyScope {
  const { record, step, treeExists } = previous
  const entry = record?.steps[step]
  if (!context.branch)
    return { mode: 'branch', base: context.mergeBase, reason: 'detached HEAD' }
  if (context.gate)
    return { mode: 'branch', base: context.mergeBase, reason: 'gate' }
  if (!record)
    return { mode: 'branch', base: context.mergeBase, reason: 'missing record' }
  if (record.mergeBase !== context.mergeBase)
    return { mode: 'branch', base: context.mergeBase, reason: 'merge base moved' }
  if (!entry)
    return { mode: 'branch', base: context.mergeBase, reason: 'missing step entry' }
  if (!treeExists)
    return { mode: 'branch', base: context.mergeBase, reason: 'recorded tree missing' }
  return { mode: 'incremental', base: entry.tree, reason: `recorded ${entry.recordedAt}` }
}

/** Only call for the unchanged tree checked by a step, from its selected branch or verified-tree scope. */
export function advanceLastPass(record: LastVerifyPass | null, context: VerifyContext, result: { step: VerifyStep, status: 'passed' | 'failed' | 'skipped', entry: VerifiedTree }): LastVerifyPass | null {
  if (!context.branch || result.status !== 'passed')
    return record
  return {
    mergeBase: context.mergeBase,
    steps: { ...(record?.mergeBase === context.mergeBase ? record.steps : {}), [result.step]: result.entry },
  }
}

export function touchesAppRuntime(changed: ChangedFile[]): boolean {
  return changed.some(({ path }) => /^(?:apps\/stage-tamagotchi|packages\/(?:stage-ui[^/]*|stage-shared|stage-pages|stage-layouts))\/src\//.test(path))
}

/**
 * Root files that change what every package's typecheck sees. A change to one of them typechecks
 * every package, because Turbo's `[ref]` filter maps root files to no package.
 */
const typecheckGlobalFile = /^(?:tsconfig[^/]*\.json|package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json|[^/]+\.d\.ts)$/

const codeFile = /\.(?:[cm]?[jt]sx?|vue)$/
/** Data that tests import, such as fixtures, gate bands, and locales. `vitest related` finds the tests that import it. */
const testDataFile = /\.(?:json5?|jsonc|ya?ml)$/
/** Manifests and compiler configs that no test imports; a change to one alone would only start browsers to find nothing. */
const toolingFile = /(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|turbo\.json)$/
/** Prose that no compiler reads, so a change to it alone needs no typecheck. */
const docFile = /\.(?:md|mdx|txt)$/i
const binaryFile = /\.(?:png|jpe?g|gif|webp|avif|ico|icns|bmp|svgz|mp[34]|wav|ogg|flac|webm|mov|zip|7z|gz|tgz|woff2?|ttf|otf|moc3|vrm|pmx|pmd|vmd|glb|gltf|bin|exe|dll|node|wasm|pdf|psd)$/i

/**
 * Turbo arguments that rebuild stale workspace package output before the test step. Tests import `dist` output such as
 * the i18n locales, and a pull or merge that changes package sources leaves it stale while the install step stays
 * skipped. Turbo skips a package whose input hash is unchanged.
 */
export const testPrerequisiteTurboArgs = ['run', 'build', '-F=./packages/*', '--output-logs=errors-only']

export type TypecheckScope = { kind: 'none' } | { kind: 'affected' } | { kind: 'all', reason: string }

/** Directory filters work for both commit and tree baselines; Turbo's [ref] selector needs a commit. */
export function typecheckFilters(scope: TypecheckScope, packagePaths: string[]): string[] {
  switch (scope.kind) {
    case 'none': return []
    case 'all': return ['-F=./packages/*', '-F=./apps/*', '-F=./server/**', '-F=./services/*']
    case 'affected': return packagePaths.map(path => `--filter=...{./${path}}`)
  }
}

/** One request covers every command in a step, including the test build prerequisite. */
export function planStepLease(step: VerifyStep, typecheck: TypecheckScope, affectedPackageCount: number): Pick<AcquireOptions, 'class' | 'max'> {
  if (step === 'typecheck' && typecheck.kind === 'affected')
    return { class: step, max: Math.max(classes.typecheck.min, affectedPackageCount) }
  return { class: step }
}

export interface VerifyPlan {
  typecheck: TypecheckScope
  typecheckPackagePaths: string[]
  lintFiles: string[]
  testFiles: string[]
  /**
   * Workspace package directories that hold a changed code or test data file. Browser projects only hold package tests, so they run
   * only for these packages and the packages that depend on them.
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
 * The browser projects whose package is in `affectedPackagePaths`: the packages with a changed code file plus every
 * package that depends on one. A project in any other package cannot import the changed code, so `vitest related`
 * would only start its browser to find nothing.
 */
export function selectBrowserTestProjects(affectedPackagePaths: string[], projects: BrowserTestProject[]): string[] {
  const affected = new Set(affectedPackagePaths)
  return projects.filter(project => affected.has(project.packagePath)).map(project => project.name)
}

export interface TestRun {
  config: string
  projects: string[]
}

/** The Vitest processes of the test step: the root config, then one process per affected browser project. */
export function planTestRuns(browserProjects: string[]): TestRun[] {
  // NOTICE:
  // One Vitest process per browser project: two Vite roots in one process make `@vitejs/plugin-vue` serve a scoped
  // style under the other root's id (process-wide descriptor cache, root-relative ids).
  // Source: `@vitejs/plugin-vue` 6.0.8 `createDescriptor`; `scripts/dev-tools/README.md`.
  // Remove when the plugin keys that cache per server.
  return [
    { config: 'vitest.config.ts', projects: [] },
    ...browserProjects.map(project => ({ config: browserRootConfig, projects: [project] })),
  ]
}

/**
 * Decides what each step covers. `packagePaths` are workspace package directories relative to the root, using `/`.
 * `rootDependencyPaths` are the directories of the workspace packages the root `package.json` depends on. Turbo's
 * `...[ref]` filter reaches the root workspace through them, and from there every package, so a change confined to one
 * of them uses the same directory scope as a root config change.
 */
export function planVerify(changed: ChangedFile[], packagePaths: string[], rootDependencyPaths: string[] = []): VerifyPlan {
  const present = changed.filter(file => !file.deleted).map(file => file.path)
  const typed = changed.filter(file => !docFile.test(file.path))
  const globalFile = typed.find(file => typecheckGlobalFile.test(file.path))
  let typecheck: TypecheckScope = { kind: 'none' }
  if (globalFile) {
    typecheck = { kind: 'all', reason: `${globalFile.path} changed` }
  }
  else if (typed.some(file => inPackage(file.path, packagePaths))) {
    const rootDependency = typed.find(file => inPackage(file.path, rootDependencyPaths))
    typecheck = rootDependency
      ? { kind: 'all', reason: `${rootDependency.path} is in a root dependency` }
      : { kind: 'affected' }
  }
  const testFiles = present.filter(path => codeFile.test(path) || (testDataFile.test(path) && !toolingFile.test(path)))
  return {
    typecheck,
    typecheckPackagePaths: [...new Set(typed.map(file => packageOf(file.path, packagePaths)).filter(path => path !== undefined))],
    lintFiles: present.filter(path => !binaryFile.test(path)),
    testFiles,
    testPackagePaths: [...new Set(testFiles.map(path => packageOf(path, packagePaths)).filter(path => path !== undefined))],
  }
}

export interface VerifyArgs {
  base: string
  steps: VerifyStep[]
  dryRun: boolean
  gate: boolean
  stats?: VerifyStatsOptions
}

export type ParsedVerifyArgs = { ok: true, args: VerifyArgs } | { ok: false, message: string }

export const verifyUsage = `Usage: pnpm verify [--gate] [--base <ref>] [--only lint,typecheck,test] [--dry-run]
       pnpm verify --stats [--since <duration>] [--json]

  --stats    summarize step history without running checks
  --since    include history from this duration ago (positive integer ms, s, m, h, d)
  --json     print statistics as JSON
  --gate     check the full branch instead of changes since each step's last pass
  --base     compare against the merge base with <ref> (default main)
  --only     run only these steps (default all)
  --dry-run  print the plan and commands without running them
Exit codes: 0 every step passed, 1 a step failed, 2 usage error.`

export function parseVerifyArgs(argv: string[]): ParsedVerifyArgs {
  if (argv.includes('--stats')) {
    const parsed = parseStatsArgs(argv)
    return parsed.ok
      ? { ok: true, args: { base: 'main', steps: [], dryRun: false, gate: false, stats: parsed.stats } }
      : parsed
  }
  const args: VerifyArgs = { base: 'main', steps: [...verifySteps], dryRun: false, gate: false }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--gate') {
      args.gate = true
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

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/**
 * True when ESLint's summary says every reported problem can be fixed by `--fix`. Reads the stylish summary
 * ("N problems (E errors, W warnings)" and "X errors and Y warnings potentially fixable"), summed over lint batches.
 * Output without an ESLint summary (oxlint stopped first, or a crash) gives no hint.
 */
export function lintAllFixable(output: string): boolean {
  const text = output.replace(ansi, '')
  let errors = 0
  let warnings = 0
  let fixableErrors = 0
  let fixableWarnings = 0
  let summaries = 0
  for (const match of text.matchAll(/\d+ problems? \((\d+) errors?, (\d+) warnings?\)/g)) {
    summaries++
    errors += Number(match[1])
    warnings += Number(match[2])
  }
  for (const match of text.matchAll(/(\d+) errors? and (\d+) warnings? potentially fixable/g)) {
    fixableErrors += Number(match[1])
    fixableWarnings += Number(match[2])
  }
  return summaries > 0 && errors + warnings > 0 && fixableErrors === errors && fixableWarnings === warnings
}
