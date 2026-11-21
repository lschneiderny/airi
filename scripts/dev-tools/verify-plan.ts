import type { GatedRun } from './lib/gated-tests'
import type { ChangedFile } from './lib/git'
import type { VerifyStatsOptions } from './verify-history'

import { renderLoopPaths } from '../../packages/qa-tools/src/track/paths'
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

/** QA that `pnpm verify --gate` runs itself after its steps pass, when the changed paths need it. */
export type GateQa = 'smoke' | 'model-tests' | 'motion-affected'

/**
 * What a rule needs from the gate's QA: the smoke, an affected verdict, or the `qa:test:model` files gated on one
 * `AIRI_QA_*` variable. `qa:test:model` runs every gated file whose variables are set, so a pass meets only the
 * variables of the files that ran.
 */
export type GateNeed = 'smoke' | 'motion-affected' | `AIRI_QA_${string}`

function qaFor(need: GateNeed): GateQa {
  return need === 'smoke' || need === 'motion-affected' ? need : 'model-tests'
}

/**
 * Checks beyond the three steps, keyed by the changed paths that need them, so an agent learns them from the verify
 * output instead of reading the policy. `gateNeeds` names what the gate's QA must meet for a rule; when all of it is
 * met, the rule needs nothing more. Keep in step with "Checks by change type" in `docs/ai/context/testing.md`; rows that need
 * judgment, such as "a visible change", stay only there.
 */
const followUpRules: readonly { paths: RegExp, reason: string, checks: string, gateNeeds: readonly GateNeed[] }[] = [
  {
    paths: /^(?:apps\/stage-tamagotchi|packages\/(?:stage-ui[^/]*|stage-shared|stage-pages|stage-layouts|character-mind))\/src\//,
    reason: 'app runtime changed',
    checks: 'pnpm qa:smoke, which pnpm verify --gate runs',
    gateNeeds: ['smoke'],
  },
  {
    paths: /^packages\/(?:(?:motion-driver-natural|motion-driver-magic|model-driver-magic-live2d)\/src|stage-ui-live2d\/src\/composables\/live2d)\//,
    reason: 'Natural or Live2D motion changed',
    checks: 'pnpm qa:test:model with AIRI_QA_RIG_FORBOOTH set, which pnpm verify --gate runs',
    gateNeeds: ['AIRI_QA_RIG_FORBOOTH'],
  },
  {
    paths: /^packages\/(?:motion-driver-humanoid|stage-ui-mmd)\/src\//,
    reason: 'MMD body motion changed',
    checks: 'pnpm qa:test:model with AIRI_QA_MMD_MODEL set and pnpm qa:motion3d affected, which pnpm verify --gate runs; unless affected prints NOT AFFECTED, pnpm qa:motion3d run for each affected scenario, and pnpm qa:motion3d diff printing IDENTICAL between base and tip for each scenario the change must not move',
    gateNeeds: ['AIRI_QA_MMD_MODEL', 'motion-affected'],
  },
  {
    paths: /^packages\/lab-tools\/src\/t2-3d\/reports\//,
    reason: 'a lab:motion3d report rule changed',
    checks: 'labelled lab:motion3d inject cases sealed before scoring, and the report version bump in its own commit',
    gateNeeds: [],
  },
  {
    paths: new RegExp(renderLoopPaths.map(row => row.re.source).join('|')),
    reason: 'render-loop code changed',
    checks: 'the nightly perf tracker benches this branch once it is pushed with an open PR (pnpm perf status shows its findings); to measure before landing, bench base and tip as the perf-qa procedure in packages/qa-tools/README.md#perf-reports says',
    gateNeeds: [],
  },
  {
    paths: /^packages\/stage-ui-mmd\/src\/composables\/mmd\/work-budget\.json$/,
    reason: 'a headless work budget changed',
    checks: 'state why each raised budget is needed in the commit body and in the entry reason',
    gateNeeds: [],
  },
]

/** A test file changes no runtime behavior, so it alone needs no follow-up check. */
const testFile = /\.(?:browser\.)?test\.[cm]?[jt]sx?$/

function matchedRules(changed: ChangedFile[]) {
  const paths = changed.map(({ path }) => path).filter(path => !testFile.test(path))
  return followUpRules.filter(rule => paths.some(path => rule.paths.test(path)))
}

/** One line per follow-up check the changed files still need, in rule order. A rule whose gate needs are all `met` is left out. */
export function followUpChecks(changed: ChangedFile[], met: ReadonlySet<GateNeed> = new Set()): string[] {
  return matchedRules(changed)
    .filter(rule => rule.gateNeeds.length === 0 || rule.gateNeeds.some(need => !met.has(need)))
    .map(rule => `${rule.checks} (${rule.reason})`)
}

/** The QA the gate runs for the changed files, in rule order, each once. */
export function gateQaFor(changed: ChangedFile[]): GateQa[] {
  return [...new Set(matchedRules(changed).flatMap(rule => rule.gateNeeds.map(qaFor)))]
}

/**
 * The command for one gate QA, or why it cannot run here. On Linux the smoke runs inside a `qa:display` session of its
 * own, which `after` stops; macOS has no QA display. `motion-affected` reads commits, so it compares the merge base with
 * HEAD.
 */
export function gateQaCommand(qa: GateQa, platform: NodeJS.Platform, mergeBase: string, session: string): { argv: string[], after?: string[] } | string {
  if (qa === 'smoke') {
    if (platform === 'linux')
      return { argv: ['pnpm', 'qa:display', 'run', '--name', session, '--', 'pnpm', '--silent', 'qa:smoke'], after: ['pnpm', 'qa:display', 'down', '--name', session] }
    return platform === 'darwin' ? { argv: ['pnpm', '--silent', 'qa:smoke'] } : `not run: no checked smoke on ${platform}`
  }
  if (qa === 'model-tests')
    return { argv: ['pnpm', '--silent', 'qa:test:model'] }
  return { argv: ['pnpm', '--silent', 'qa:motion3d', 'affected', mergeBase, 'HEAD'] }
}

export interface GateQaOutcome {
  status: 'passed' | 'failed' | 'skipped'
  /** The rule needs this QA met. */
  met: GateNeed[]
  detail: string
}

const ansi = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

const affectedExitCodes = { 'NOT AFFECTED': 0, 'AFFECTED': 1, 'CANNOT TELL': 2 } as const
const affectedVerdictLine = /^affected [0-9a-f]+\.\.[0-9a-f]+: (NOT AFFECTED|AFFECTED|CANNOT TELL)\r?$/m

/**
 * Reads the smoke's exit code, or the verdict of `qa:motion3d affected`. `affected` exits 1 or 2 for its verdicts, but
 * also for a thrown error or a usage error, so only its printed verdict line, with the exit code that verdict returns,
 * counts as a verdict; anything else is a failure.
 */
export function gateQaOutcome(qa: 'smoke' | 'motion-affected', exitCode: number, output = ''): GateQaOutcome {
  if (qa === 'smoke')
    return exitCode === 0 ? { status: 'passed', met: ['smoke'], detail: 'qa:smoke' } : { status: 'failed', met: [], detail: `qa:smoke exited ${exitCode}` }
  const verdict = affectedVerdictLine.exec(output.replace(ansi, ''))?.[1] as keyof typeof affectedExitCodes | undefined
  if (verdict === undefined || affectedExitCodes[verdict] !== exitCode)
    return { status: 'failed', met: [], detail: `qa:motion3d affected exited ${exitCode}${verdict === undefined ? ' without a verdict' : ` after printing ${verdict}`}` }
  if (verdict === 'NOT AFFECTED')
    return { status: 'passed', met: ['motion-affected'], detail: 'qa:motion3d affected: NOT AFFECTED, no identity runs needed' }
  return { status: 'passed', met: [], detail: `qa:motion3d affected: ${verdict}, identity runs still needed` }
}

/**
 * Reads `qa:test:model` from the plan it makes (`planGatedRun`), which the gate makes first in the same environment,
 * and from its exit code when it ran. A pass meets the variables of the files that ran. A plan that runs nothing
 * because no variable is set is skipped without running; one whose set variable names a missing path fails, since
 * that model was meant to run.
 */
export function modelTestsOutcome(plan: GatedRun, exitCode?: number): GateQaOutcome {
  if (!plan.ok)
    return { status: plan.reason === 'missing' ? 'failed' : 'skipped', met: [], detail: `qa:test:model: not run: ${plan.message}` }
  const variables = [...new Set(plan.run.flatMap(file => file.variables))].filter((name): name is `AIRI_QA_${string}` => name.startsWith('AIRI_QA_'))
  if (exitCode === 0)
    return { status: 'passed', met: variables, detail: `qa:test:model: files gated on ${variables.join(', ')}` }
  return { status: 'failed', met: [], detail: `qa:test:model exited ${exitCode ?? 'without running'}` }
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
/**
 * Files that a root test reads from disk, which `vitest related` cannot see, so a change to one of them runs its test
 * directly: the policy docs, and the renderer sources and state registry that the storage write scan reads.
 */
const fileGuards: readonly { files: RegExp, test: string }[] = [
  { files: /^docs\/ai\/context\/[^/]+\.md$/, test: 'scripts/dev-tools/policy-docs.test.ts' },
  { files: /^(?:packages\/[^/]+\/src|apps\/stage-tamagotchi\/src\/renderer)\/.+\.(?:ts|vue)$/, test: 'scripts/dev-tools/storage-writes.test.ts' },
]
/** Prose that no compiler reads, so a change to it alone needs no typecheck. */
const docFile = /\.(?:md|mdx|txt)$/i
const binaryFile = /\.(?:png|jpe?g|gif|webp|avif|ico|icns|bmp|svgz|mp[34]|wav|ogg|flac|webm|mov|zip|7z|gz|tgz|woff2?|ttf|otf|moc3|vrm|pmx|pmd|vmd|glb|gltf|bin|exe|dll|node|wasm|pdf|psd)$/i

/**
 * Turbo arguments that rebuild stale workspace package output before the test step. Tests import `dist` output such as
 * the i18n locales, and a pull or merge that changes package sources leaves it stale while the install step stays
 * skipped. Turbo skips a package whose input hash is unchanged.
 */
export const testPrerequisiteTurboArgs = ['run', 'build', '-F=./packages/*', '--output-logs=errors-only']

export interface RelatedTestCommand {
  /** Variables the package's `test:run` script sets before Vitest, such as `NODE_OPTIONS`. */
  env: Record<string, string>
  /** Vitest arguments. The caller appends the changed files. */
  args: string[]
}

/**
 * Turns a package's `test:run` script into the `vitest related` command that runs only the tests reaching the changed
 * files. The script stays the one definition of how the package's tests start: its config, its project selection, and
 * its environment carry over.
 *
 * Returns:
 * - `null` when the script is not a plain `vitest run`. Such a package cannot run related tests.
 */
export function relatedTestCommand(script: string): RelatedTestCommand | null {
  const match = /^((?:[A-Z_][A-Z0-9_]*=\S+\s+)*)vitest run((?:\s+\S+)*)$/.exec(script.trim())
  if (!match)
    return null
  const env = Object.fromEntries(match[1].trim().split(/\s+/).filter(Boolean).map((pair) => {
    const separator = pair.indexOf('=')
    return [pair.slice(0, separator), pair.slice(separator + 1)]
  }))
  return { env, args: ['related', '--run', '--passWithNoTests', ...match[2].trim().split(/\s+/).filter(Boolean)] }
}

export type TypecheckScope = { kind: 'none' } | { kind: 'affected' } | { kind: 'all', reason: string }

/** Directory filters work for both commit and tree baselines; Turbo's [ref] selector needs a commit. */
export function typecheckFilters(scope: TypecheckScope, packagePaths: string[]): string[] {
  switch (scope.kind) {
    case 'none': return []
    case 'all': return ['-F=./packages/*', '-F=./apps/*', '-F=./server/**', '-F=./services/*']
    case 'affected': return packagePaths.map(path => `--filter=...{./${path}}`)
  }
}

export interface VerifyPlan {
  typecheck: TypecheckScope
  typecheckPackagePaths: string[]
  lintFiles: string[]
  testFiles: string[]
  /**
   * Workspace package directories that hold a changed code or test data file. Related tests run in these packages and
   * in the packages that depend on them; no other package can import the changed code.
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
  const guardTests = fileGuards.filter(guard => present.some(path => guard.files.test(path))).map(guard => guard.test)
  const testFiles = [...new Set([...present.filter(path => codeFile.test(path) || (testDataFile.test(path) && !toolingFile.test(path))), ...guardTests])]
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
  /** Start the run in a detached process, print its id, and return at once. */
  detach: boolean
  stats?: VerifyStatsOptions
  /** Block on a run that already started instead of starting one. A null id means the newest run in this worktree. */
  wait?: { id: string | null, timeoutMs: number }
}

export type ParsedVerifyArgs = { ok: true, args: VerifyArgs } | { ok: false, message: string }

/**
 * How long `--wait` blocks by default: under the 10-minute ceiling agent harnesses put on one tool call,
 * and longer than a typical full verify, so one call usually sees the end.
 */
export const defaultWaitSeconds = 540

export const verifyUsage = `Usage: pnpm verify [--gate] [--base <ref>] [--only lint,typecheck,test] [--dry-run] [--detach]
       pnpm verify --wait [<run id>] [--timeout <seconds>]
       pnpm verify --stats [--since <duration>] [--json]

  --stats    summarize step history without running checks
  --since    include history from this duration ago (positive integer ms, s, m, h, d)
  --json     print statistics as JSON
  --gate     check the full branch instead of changes since each step's last pass
  --base     compare against the merge base with <ref> (default main)
  --only     run only these steps (default all)
  --dry-run  print the plan and commands without running them
  --detach   run in the background; print the run id and return
  --wait     block until a run ends and print its report (default: this worktree's newest run)
  --timeout  stop waiting after this many seconds (default ${defaultWaitSeconds})
Exit codes: 0 every step passed, 1 a step failed or the run died (--wait: the waited run did not pass), 2 usage error,
3 still running after --timeout.`

function parseWaitArgs(argv: string[]): ParsedVerifyArgs {
  const wait = { id: null as string | null, timeoutMs: defaultWaitSeconds * 1000 }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--wait') {
      const next = argv[index + 1]
      if (next !== undefined && !next.startsWith('--')) {
        wait.id = next
        index++
      }
    }
    else if (flag === '--timeout') {
      const seconds = Number(argv[++index])
      if (!Number.isSafeInteger(seconds) || seconds < 0)
        return { ok: false, message: `--timeout needs a whole number of seconds` }
      wait.timeoutMs = seconds * 1000
    }
    else {
      return { ok: false, message: `${JSON.stringify(flag)} does not combine with --wait` }
    }
  }
  return { ok: true, args: { base: 'main', steps: [], dryRun: false, gate: false, detach: false, wait } }
}

export function parseVerifyArgs(argv: string[]): ParsedVerifyArgs {
  if (argv.includes('--stats')) {
    const parsed = parseStatsArgs(argv)
    return parsed.ok
      ? { ok: true, args: { base: 'main', steps: [], dryRun: false, gate: false, detach: false, stats: parsed.stats } }
      : parsed
  }
  if (argv.includes('--wait'))
    return parseWaitArgs(argv)
  const args: VerifyArgs = { base: 'main', steps: [...verifySteps], dryRun: false, gate: false, detach: false }
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index]
    if (flag === '--gate') {
      args.gate = true
    }
    else if (flag === '--detach') {
      args.detach = true
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
  // A dry run writes no run record, so a detached one would leave nothing for --wait.
  if (args.dryRun && args.detach)
    return { ok: false, message: '--dry-run prints the plan at once; drop --detach' }
  return { ok: true, args }
}

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
