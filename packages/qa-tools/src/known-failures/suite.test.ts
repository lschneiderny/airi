import type { KnownFailureRegistry } from './schema'
import type { SuiteRun, SuiteTarget } from './suite'

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { evaluateSuiteRun, resolveSuiteTargets, summarizeRun } from './suite'

const target: SuiteTarget = { package: '@proj-airi/stage-shared', dir: 'packages/stage-shared', project: 'default' }
const packageDir = join('C:', 'repo', 'packages', 'stage-shared')

function reportText(statuses: Array<'passed' | 'failed'>) {
  return JSON.stringify({
    success: !statuses.includes('failed'),
    testResults: [{
      name: join(packageDir, 'src', 'a.test.ts'),
      status: statuses.includes('failed') ? 'failed' : 'passed',
      message: '',
      assertionResults: statuses.map((status, index) => ({ ancestorTitles: ['s'], title: `t${index}`, status, failureMessages: status === 'failed' ? ['Error: boom'] : [] })),
    }],
  })
}

function run(overrides: Partial<SuiteRun>): SuiteRun {
  return { target, packageDir, exitCode: 0, output: '', logFile: 'vitest.log', ...overrides }
}

const registry: KnownFailureRegistry = {
  version: 1,
  entries: [{ package: target.package, project: 'default', file: 'src/a.test.ts', name: 's > t1', reason: 'localStorage is undefined in the node project', since: '2026-10-20', removeWhen: 'storage is provided' }],
}

describe('resolveSuiteTargets', () => {
  it('expands --all to every suite and never includes the qa-tools gate project', () => {
    const targets = resolveSuiteTargets({ packages: [], all: true })

    expect(targets.map(item => `${item.package}:${item.project}`)).toEqual([
      '@proj-airi/stage-shared:default',
      '@proj-airi/stage-ui-live2d:node',
      '@proj-airi/stage-ui-live2d:browser',
      '@proj-airi/stage-ui:node',
      '@proj-airi/stage-ui:browser',
      '@proj-airi/qa-tools:node',
      '@proj-airi/scenarios-stage-tamagotchi-electron:default',
      '@proj-airi/pipelines-audio:default',
    ])
  })

  it('filters by project and rejects unknown packages or missing projects', () => {
    expect(resolveSuiteTargets({ packages: ['@proj-airi/stage-ui'], project: 'browser', all: false }).map(item => item.project)).toEqual(['browser'])
    expect(() => resolveSuiteTargets({ packages: ['@proj-airi/nope'], all: false })).toThrow(/unknown --package/)
    expect(() => resolveSuiteTargets({ packages: ['@proj-airi/stage-shared'], project: 'node', all: false })).toThrow(/no Vitest project "node"/)
    expect(() => resolveSuiteTargets({ packages: [], all: false })).toThrow(/--all or at least one --package/)
  })
})

describe('evaluateSuiteRun and summarizeRun', () => {
  it('exits 0 when every failure is known', () => {
    const outcome = evaluateSuiteRun(run({ exitCode: 1, reportText: reportText(['passed', 'failed']) }))
    const summary = summarizeRun([outcome], registry)

    expect(outcome.error).toBeUndefined()
    expect(summary.exitCode).toBe(0)
    expect(summary.diff.knownFailing).toHaveLength(1)
    expect(summary.counts[0]).toMatchObject({ passed: 1, failed: 1 })
  })

  it('exits 1 on a new failure', () => {
    const summary = summarizeRun([evaluateSuiteRun(run({ exitCode: 1, reportText: reportText(['failed', 'failed']) }))], registry)

    expect(summary.exitCode).toBe(1)
    expect(summary.diff.newFailures.map(item => item.name)).toEqual(['s > t0'])
  })

  it('treats a crash without a report as a suite error, not a pass, and does not judge its entries', () => {
    const summary = summarizeRun([evaluateSuiteRun(run({ exitCode: 1 }))], registry)

    expect(summary.exitCode).toBe(1)
    expect(summary.suiteErrors[0].error).toMatch(/without writing a JSON report/)
    expect(summary.diff.fixedKnown).toEqual([])
  })

  it('treats a timeout as a suite error even when a report exists', () => {
    const outcome = evaluateSuiteRun(run({ exitCode: null, timedOutAfterSeconds: 5, reportText: reportText(['passed']) }))

    expect(outcome.error).toMatch(/timed out after 5s/)
    expect(outcome.results).toBeUndefined()
    expect(summarizeRun([outcome], registry).exitCode).toBe(1)
  })

  it('treats a non-zero exit without failing tests and unhandled errors as suite errors', () => {
    expect(evaluateSuiteRun(run({ exitCode: 1, reportText: reportText(['passed']) })).error).toMatch(/no failing test/)
    expect(evaluateSuiteRun(run({ exitCode: 1, reportText: reportText(['failed']), output: 'Vitest caught 1 unhandled error during the test run.' })).error).toMatch(/unhandled errors/)
    expect(evaluateSuiteRun(run({ exitCode: 1, reportText: '{' })).error).toMatch(/not valid JSON/)
  })

  it('reports a known failure that now passes as fixed while still exiting 0', () => {
    const summary = summarizeRun([evaluateSuiteRun(run({ reportText: reportText(['passed', 'passed']) }))], registry)

    expect(summary.exitCode).toBe(0)
    expect(summary.diff.fixedKnown.map(item => [item.entry.name, item.observed])).toEqual([['s > t1', 'passed']])
  })
})
