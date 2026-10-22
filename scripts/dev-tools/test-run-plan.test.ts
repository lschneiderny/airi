import type { TestRunSuite } from './test-run-plan'

import { describe, expect, it } from 'vitest'

import { runSuites, summarizeSuites, testRunSuites } from './test-run-plan'

const suites: TestRunSuite[] = [
  { label: 'a', command: 'run a' },
  { label: 'b', command: 'run b' },
  { label: 'c', command: 'run c' },
]

function clock() {
  let now = 0
  return () => (now += 1000)
}

describe('testRunSuites', () => {
  it('keeps the suites and order of the former && chain', () => {
    expect(testRunSuites.map(suite => suite.command)).toEqual([
      'pnpm exec vitest run',
      'pnpm run test-stage-tamagotchi:run',
      'pnpm run test-stage-web:run',
      'pnpm run test-stage-pages:run',
      'pnpm run test-ui:run',
      'pnpm run test-stage-ui-live2d:run',
      'pnpm run test-model-driver-lipsync:run',
      'pnpm run test-stage-ui-three:run',
      'pnpm run test-stage-ui-mmd:run',
    ])
  })
})

describe('runSuites', () => {
  it('runs every suite after a failure, in order', async () => {
    const ran: string[] = []
    const results = await runSuites(suites, async (suite) => {
      ran.push(suite.label)
      return suite.label === 'a' ? 1 : 0
    }, clock())

    expect(ran).toEqual(['a', 'b', 'c'])
    expect(results.map(result => result.exitCode)).toEqual([1, 0, 0])
    expect(results[0].durationMs).toBe(1000)
  })

  it('records a suite that cannot start and still runs the next one', async () => {
    const results = await runSuites(suites, async (suite) => {
      if (suite.label === 'b')
        throw new Error('spawn pnpm ENOENT')
      return 0
    }, clock())

    expect(results.map(result => result.suite.label)).toEqual(['a', 'b', 'c'])
    expect(results[1]).toMatchObject({ exitCode: null, error: 'spawn pnpm ENOENT' })
  })
})

describe('summarizeSuites', () => {
  const result = (label: string, exitCode: number | null) => ({ suite: { label, command: label }, exitCode, durationMs: 1500 })

  it('exits 0 when every suite passed', () => {
    const summary = summarizeSuites([result('a', 0), result('b', 0)])
    expect(summary.exitCode).toBe(0)
    expect(summary.lines.at(-1)).toBe('2/2 suites passed')
  })

  it('exits 1 and names each failed suite, including one ended by a signal', () => {
    const summary = summarizeSuites([result('a', 1), result('b', 0), result('c', null)])
    expect(summary.exitCode).toBe(1)
    expect(summary.lines).toHaveLength(5)
    expect(summary.lines[1]).toContain('FAILED')
    expect(summary.lines[3]).toContain('exit signal')
    expect(summary.lines.at(-1)).toBe('1/3 suites passed; failed: a, c')
  })
})
