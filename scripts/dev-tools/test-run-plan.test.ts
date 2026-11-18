import type { WorkspaceManifest } from './test-run-plan'

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { testRunExclusions, testsWithoutRunner } from './test-run-plan'
import { relatedTestCommand } from './verify-plan'

describe('testsWithoutRunner', () => {
  const manifest = (path: string, scripts: Record<string, string> = {}): WorkspaceManifest => ({ path, scripts })

  it('names a package that holds tests but has no test:run script, by its nearest manifest', () => {
    const packages = [manifest('packages/a', { 'test:run': 'vitest run' }), manifest('packages/a/fixtures/nested'), manifest('packages/b', { test: 'vitest' })]
    const files = ['packages/a/src/x.test.ts', 'packages/a/fixtures/nested/y.test.ts', 'packages/b/src/z.test.ts', 'packages/b/src/w.test.ts']
    expect(testsWithoutRunner(files, packages)).toEqual(['packages/a/fixtures/nested', 'packages/b'])
  })

  it('accepts root tests under scripts/ and names any other root test file', () => {
    expect(testsWithoutRunner(['scripts/dev-tools/verify.test.ts', 'scripts/dev.test.mjs', 'tools/orphan.test.ts'], [])).toEqual(['tools/orphan.test.ts'])
  })

  it('skips the listed exclusions', () => {
    expect(testsWithoutRunner(['apps/component-calling/src/index.test.ts'], [manifest('apps/component-calling')])).toEqual([])
  })
})

describe('the repository', () => {
  const root = join(import.meta.dirname, '..', '..')
  const tracked = (...patterns: string[]) => execFileSync('git', ['ls-files', ...patterns], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  const packages = tracked('*/package.json').map(file => ({
    path: dirname(file),
    scripts: (JSON.parse(readFileSync(join(root, file), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {},
  }))

  it('has a runner for every tracked test file', () => {
    expect(testsWithoutRunner(tracked('*.test.ts', '*.test.mts', '*.test.js', '*.test.mjs', '*.spec.ts'), packages)).toEqual([])
  })

  it('excludes only packages that still exist without a test:run script', () => {
    const stale = Object.keys(testRunExclusions).filter(path => packages.find(candidate => candidate.path === path)?.scripts['test:run'] !== undefined || !packages.some(candidate => candidate.path === path))
    expect(stale).toEqual([])
  })

  it('can run related tests in every package, because each test:run script is a plain vitest run', () => {
    const unsupported = packages.filter(candidate => candidate.scripts['test:run'] !== undefined && relatedTestCommand(candidate.scripts['test:run']) === null)
    expect(unsupported.map(candidate => `${candidate.path}: ${candidate.scripts['test:run']}`)).toEqual([])
  })
})
