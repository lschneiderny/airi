import type { TestResult } from './report'
import type { KnownFailureEntry, KnownFailureRegistry } from './schema'

import { describe, expect, it } from 'vitest'

import { diffFailures } from './diff'

function result(name: string, status: TestResult['status'], overrides: Partial<TestResult> = {}): TestResult {
  return { package: '@proj-airi/stage-ui', project: 'node', file: 'src/a.test.ts', name, status, ...overrides }
}

function entry(name: string, overrides: Partial<KnownFailureEntry> = {}): KnownFailureEntry {
  return {
    package: '@proj-airi/stage-ui',
    project: 'node',
    file: 'src/a.test.ts',
    name,
    reason: 'localStorage is undefined in the node project',
    since: '2026-10-20',
    removeWhen: 'the store test provides storage',
    ...overrides,
  }
}

function registry(...entries: KnownFailureEntry[]): KnownFailureRegistry {
  return { version: 1, entries }
}

describe('diffFailures', () => {
  it('separates new failures from known ones', () => {
    const diff = diffFailures([result('s > known', 'failed'), result('s > new', 'failed'), result('s > ok', 'passed')], registry(entry('s > known')))

    expect(diff.newFailures.map(item => item.name)).toEqual(['s > new'])
    expect(diff.knownFailing.map(item => item.entry.name)).toEqual(['s > known'])
    expect(diff.fixedKnown).toEqual([])
    expect(diff.flakyPassed).toEqual([])
  })

  it('reports a non-flaky entry that passed as fixed', () => {
    const diff = diffFailures([result('s > known', 'passed')], registry(entry('s > known')))

    expect(diff.fixedKnown).toEqual([{ entry: entry('s > known'), observed: 'passed' }])
    expect(diff.newFailures).toEqual([])
  })

  it('keeps a flaky entry that passed out of fixed, and still flags an unregistered failure as new', () => {
    const flaky = entry('s > flaky', { project: 'browser', flaky: true })
    const diff = diffFailures([
      result('s > flaky', 'passed', { project: 'browser' }),
      result('s > flaky sibling', 'failed', { project: 'browser' }),
    ], registry(flaky))

    expect(diff.flakyPassed).toEqual([flaky])
    expect(diff.fixedKnown).toEqual([])
    expect(diff.newFailures.map(item => item.name)).toEqual(['s > flaky sibling'])
  })

  it('counts a failing flaky entry as known', () => {
    const flaky = entry('s > flaky', { flaky: true })
    const diff = diffFailures([result('s > flaky', 'failed')], registry(flaky))

    expect(diff.knownFailing).toEqual([{ entry: flaky, result: result('s > flaky', 'failed') }])
  })

  it('matches on package, project, file and full name', () => {
    const registered = registry(entry('s > known'))

    for (const mismatch of [{ package: '@proj-airi/stage-shared' }, { project: 'browser' as const }, { file: 'src/b.test.ts' }, { name: 's > known extra' }]) {
      const diff = diffFailures([result('s > known', 'failed', mismatch)], registered)

      expect(diff.newFailures).toHaveLength(1)
      expect(diff.knownFailing).toEqual([])
    }
  })

  it('reports entries of a suite that ran but did not contain the test as not run', () => {
    const diff = diffFailures([result('s > other', 'passed')], registry(entry('s > renamed')))

    expect(diff.fixedKnown).toEqual([{ entry: entry('s > renamed'), observed: 'not-run' }])
  })

  it('ignores entries of suites that did not report', () => {
    const diff = diffFailures([result('s > ok', 'passed')], registry(entry('s > known', { project: 'browser' })))

    expect(diff.fixedKnown).toEqual([])
  })

  it('uses the explicit suite list so an empty suite still judges its entries', () => {
    const diff = diffFailures([], registry(entry('s > known')), [{ package: '@proj-airi/stage-ui', project: 'node' }])

    expect(diff.fixedKnown).toEqual([{ entry: entry('s > known'), observed: 'not-run' }])
  })
})
