import type { TestResult } from './report'
import type { KnownFailureEntry, KnownFailureRegistry } from './schema'

import { failureKey } from './schema'

export interface KnownFailingResult {
  entry: KnownFailureEntry
  result: TestResult
}

export interface FixedKnownFailure {
  entry: KnownFailureEntry
  /** `not-run`: the suite ran but this test was missing or skipped, so the entry no longer matches anything. */
  observed: 'passed' | 'not-run'
}

export interface FailureDiff {
  /** Failed tests without a registry entry. Any of these fails the run. */
  newFailures: TestResult[]
  /** Failed tests that match an entry (flaky or not). */
  knownFailing: KnownFailingResult[]
  /** Non-flaky entries that passed, and entries of any kind that matched no test: remove them from the registry. */
  fixedKnown: FixedKnownFailure[]
  /** Flaky entries whose test passed this time; they stay in the registry. */
  flakyPassed: KnownFailureEntry[]
}

export interface SuiteId {
  package: string
  project: KnownFailureEntry['project']
}

/**
 * Compares test results with the known-failures registry.
 *
 * Use when:
 * - Deciding whether a test run has failures that are not already known at base.
 *
 * Expects:
 * - `suites` lists the package/project pairs that produced a report. Entries of other suites are ignored, so a suite
 *   that was not run or crashed never makes its entries look fixed. Defaults to the suites present in `results`.
 */
export function diffFailures(results: readonly TestResult[], registry: KnownFailureRegistry, suites?: readonly SuiteId[]): FailureDiff {
  const ranSuites = new Set((suites ?? results).map(suite => JSON.stringify([suite.package, suite.project])))
  const entries = new Map(registry.entries.map(entry => [failureKey(entry), entry]))
  const observed = new Map(results.map(result => [failureKey(result), result]))

  const diff: FailureDiff = { newFailures: [], knownFailing: [], fixedKnown: [], flakyPassed: [] }
  for (const result of results) {
    if (result.status !== 'failed')
      continue
    const entry = entries.get(failureKey(result))
    if (entry)
      diff.knownFailing.push({ entry, result })
    else
      diff.newFailures.push(result)
  }

  for (const [key, entry] of entries) {
    if (!ranSuites.has(JSON.stringify([entry.package, entry.project])))
      continue
    const result = observed.get(key)
    if (result?.status === 'failed')
      continue
    if (result?.status === 'passed') {
      if (entry.flaky)
        diff.flakyPassed.push(entry)
      else
        diff.fixedKnown.push({ entry, observed: 'passed' })
      continue
    }
    diff.fixedKnown.push({ entry, observed: 'not-run' })
  }
  return diff
}
