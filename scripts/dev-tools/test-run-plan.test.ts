import type { TestRunSuite } from './test-run-plan'

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readBrowserTestProjects } from './lib/browser-projects'
import { buildWorkspacePackagesCommand, runSuites, summarizeSuites, testRunSuites, vitestConfigCoverage } from './test-run-plan'

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
  it('rebuilds stale packages, runs the root config, then gives each browser project its own process', () => {
    const suites = testRunSuites([{ name: 'stage-ui:browser', packagePath: 'packages/stage-ui' }, { name: 'audio:browser', packagePath: 'packages/audio' }])

    expect(suites.map(suite => suite.command)).toEqual([
      buildWorkspacePackagesCommand,
      'pnpm exec vitest run',
      'pnpm exec vitest run --config vitest.browser.config.ts --project stage-ui:browser',
      'pnpm exec vitest run --config vitest.browser.config.ts --project audio:browser',
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

describe('vitestConfigCoverage', () => {
  const root = join(import.meta.dirname, '..', '..')
  const trackedConfigs = execFileSync('git', ['ls-files', '**/vitest.config.*', '**/vitest.*.config.*', 'vitest.config.*', 'vitest.*.config.*'], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && line !== 'vitest.config.ts')
  const rootConfig = readFileSync(join(root, 'vitest.config.ts'), 'utf8')
  const browserPackages = new Set(readBrowserTestProjects(root).map(project => project.packagePath))

  it('accounts for every tracked Vitest config', () => {
    expect(Object.keys(vitestConfigCoverage).sort()).toEqual([...trackedConfigs].sort())
  })

  it('explains each excluded config', () => {
    const unexplained = Object.entries(vitestConfigCoverage).filter(([, entry]) => entry.runBy.length === 0 && !entry.note)
    expect(unexplained.map(([config]) => config)).toEqual([])
  })

  it('points each runner at a project that exists', () => {
    const missing: string[] = []
    for (const [config, entry] of Object.entries(vitestConfigCoverage)) {
      if (entry.runBy.includes('root') && !rootConfig.includes(dirname(config)))
        missing.push(`${config}: the root config names no project in ${dirname(config)}`)
      if (entry.runBy.includes('browser-root') && config !== 'vitest.browser.config.ts' && !browserPackages.has(dirname(config)))
        missing.push(`${config}: the browser root names no project in ${dirname(config)}`)
    }
    expect(missing).toEqual([])
  })
})
