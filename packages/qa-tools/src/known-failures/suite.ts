import type { FailureDiff } from './diff'
import type { TestResult } from './report'
import type { KnownFailureProject } from './schema'

import { errorMessageFrom } from '@moeru/std'

import { diffFailures } from './diff'
import { parseVitestJsonReport } from './report'

export interface SuiteTarget {
  package: string
  /** Package directory relative to the repository root, with forward slashes. */
  dir: string
  project: KnownFailureProject
}

// Packages the runner knows, with the Vitest projects each config declares (`default` = no projects).
// qa-tools runs only `node`: its `gate` project runs only through the gate CLI.
export const suitePackages: ReadonlyArray<{ package: string, dir: string, projects: readonly KnownFailureProject[] }> = [
  { package: '@proj-airi/stage-shared', dir: 'packages/stage-shared', projects: ['default'] },
  { package: '@proj-airi/stage-ui-live2d', dir: 'packages/stage-ui-live2d', projects: ['node', 'browser'] },
  { package: '@proj-airi/stage-ui', dir: 'packages/stage-ui', projects: ['node', 'browser'] },
  { package: '@proj-airi/qa-tools', dir: 'packages/qa-tools', projects: ['node'] },
  { package: '@proj-airi/scenarios-stage-tamagotchi-electron', dir: 'packages/scenarios-stage-tamagotchi-electron', projects: ['default'] },
  { package: '@proj-airi/pipelines-audio', dir: 'packages/pipelines-audio', projects: ['default'] },
]

export interface TargetSelection {
  packages: readonly string[]
  project?: string
  all: boolean
}

/** Expands CLI selection into suites in {@link suitePackages} order; throws on unknown packages or projects. */
export function resolveSuiteTargets(selection: TargetSelection): SuiteTarget[] {
  if (selection.project !== undefined && selection.project !== 'node' && selection.project !== 'browser')
    throw new Error(`qa-tools: --project must be "node" or "browser", got "${selection.project}"`)
  if (!selection.all && selection.packages.length === 0)
    throw new Error('qa-tools: pass --all or at least one --package <name>')
  const known = new Set(suitePackages.map(item => item.package))
  const unknown = selection.packages.filter(name => !known.has(name))
  if (unknown.length > 0)
    throw new Error(`qa-tools: unknown --package ${unknown.join(', ')}; known packages: ${[...known].join(', ')}`)

  const targets: SuiteTarget[] = []
  for (const item of suitePackages) {
    if (!selection.all && !selection.packages.includes(item.package))
      continue
    const projects = item.projects.filter(project => selection.project === undefined || project === selection.project)
    if (projects.length === 0 && !selection.all)
      throw new Error(`qa-tools: ${item.package} has no Vitest project "${selection.project}"; its projects: ${item.projects.join(', ')}`)
    for (const project of projects)
      targets.push({ package: item.package, dir: item.dir, project })
  }
  return targets
}

/** What happened to one spawned Vitest process. */
export interface SuiteRun {
  target: SuiteTarget
  /** Absolute package directory. */
  packageDir: string
  exitCode: number | null
  timedOutAfterSeconds?: number
  /** Report file text, or undefined when Vitest wrote none. */
  reportText?: string
  /** Combined stdout and stderr of the Vitest process. */
  output: string
  logFile: string
}

export interface SuiteOutcome {
  target: SuiteTarget
  /** Undefined when the suite produced no usable report; its registry entries are then not evaluated. */
  results?: TestResult[]
  /** Set when the suite itself failed (timeout, crash, missing report, unhandled errors). Always fails the run. */
  error?: string
}

const unhandledErrorsPattern = /Vitest caught \d+ unhandled errors?/

/**
 * Classifies one suite run.
 *
 * Returns:
 * - `error` for a timeout, a missing or unreadable report, unhandled errors, or a non-zero exit with no failing test.
 *   None of these can be matched by the registry: a known failure is a failing test, never a broken run.
 */
export function evaluateSuiteRun(run: SuiteRun): SuiteOutcome {
  const { target } = run
  if (run.timedOutAfterSeconds !== undefined)
    return { target, error: `timed out after ${run.timedOutAfterSeconds}s; the process tree was killed. See ${run.logFile}` }
  if (run.reportText === undefined)
    return { target, error: `vitest exited ${run.exitCode ?? 'by signal'} without writing a JSON report (crash, config or startup error). See ${run.logFile}` }

  let results: TestResult[]
  try {
    results = parseVitestJsonReport(run.reportText, { package: target.package, project: target.project, packageDir: run.packageDir })
  }
  catch (error) {
    return { target, error: `${errorMessageFrom(error) ?? 'unreadable Vitest report'}. See ${run.logFile}` }
  }

  if (unhandledErrorsPattern.test(run.output))
    return { target, results, error: `vitest reported unhandled errors. See ${run.logFile}` }
  if (run.exitCode !== 0 && !results.some(result => result.status === 'failed'))
    return { target, results, error: `vitest exited ${run.exitCode ?? 'by signal'} but reported no failing test. See ${run.logFile}` }
  return { target, results }
}

export interface RunSummary {
  exitCode: 0 | 1
  diff: FailureDiff
  suiteErrors: Array<{ target: SuiteTarget, error: string }>
  counts: Array<{ target: SuiteTarget, passed: number, failed: number, skipped: number }>
}

/** Exit 1 when any suite errored or any failure is new; known, fixed, and flaky-passed results alone exit 0. */
export function summarizeRun(outcomes: readonly SuiteOutcome[], registry: Parameters<typeof diffFailures>[1]): RunSummary {
  const reported = outcomes.filter(outcome => outcome.results !== undefined)
  const results = reported.flatMap(outcome => outcome.results ?? [])
  const diff = diffFailures(results, registry, reported.map(outcome => outcome.target))
  const suiteErrors = outcomes.flatMap(outcome => outcome.error === undefined ? [] : [{ target: outcome.target, error: outcome.error }])
  const counts = reported.map(outcome => ({
    target: outcome.target,
    passed: outcome.results?.filter(result => result.status === 'passed').length ?? 0,
    failed: outcome.results?.filter(result => result.status === 'failed').length ?? 0,
    skipped: outcome.results?.filter(result => result.status === 'skipped').length ?? 0,
  }))
  const exitCode = suiteErrors.length > 0 || diff.newFailures.length > 0 ? 1 : 0
  return { exitCode, diff, suiteErrors, counts }
}
