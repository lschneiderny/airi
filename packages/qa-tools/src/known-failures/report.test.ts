import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fileFailureName, parseVitestJsonReport } from './report'

const packageDir = join('C:', 'repo', 'packages', 'stage-shared')

// Trimmed copy of Vitest 4 `--reporter=json` output (extra fields such as meta and tags kept to prove they are ignored).
function report(testResults: unknown[]) {
  return JSON.stringify({ numTotalTests: 3, success: false, startTime: 0, snapshot: {}, testResults })
}

const options = { package: '@proj-airi/stage-shared', project: 'default' as const, packageDir }

describe('parseVitestJsonReport', () => {
  it('builds relative files, " > " joined names, statuses and the first error line', () => {
    const results = parseVitestJsonReport(report([{
      name: join(packageDir, 'src', 'store', 'a.test.ts'),
      status: 'failed',
      message: '',
      startTime: 0,
      endTime: 1,
      assertionResults: [
        { ancestorTitles: ['store', 'reset'], title: 'restores', fullName: 'store reset restores', status: 'failed', failureMessages: ['TypeError: Cannot read properties of undefined (reading \'getItem\')\n    at a.test.ts:1:1'], meta: {}, tags: [] },
        { ancestorTitles: ['store'], title: 'writes', fullName: 'store writes', status: 'passed', failureMessages: [], meta: {}, tags: [] },
        { ancestorTitles: [], title: 'later', fullName: 'later', status: 'todo', failureMessages: null, meta: {}, tags: [] },
      ],
    }]), options)

    expect(results).toEqual([
      { package: '@proj-airi/stage-shared', project: 'default', file: 'src/store/a.test.ts', name: 'store > reset > restores', status: 'failed', firstError: 'TypeError: Cannot read properties of undefined (reading \'getItem\')' },
      { package: '@proj-airi/stage-shared', project: 'default', file: 'src/store/a.test.ts', name: 'store > writes', status: 'passed', firstError: undefined },
      { package: '@proj-airi/stage-shared', project: 'default', file: 'src/store/a.test.ts', name: 'later', status: 'skipped', firstError: undefined },
    ])
  })

  it('reports a file that failed without a failing test as a failure', () => {
    const results = parseVitestJsonReport(report([{
      name: join(packageDir, 'src', 'b.test.ts'),
      status: 'failed',
      message: 'Failed to load url ./missing (resolved id: ./missing)',
      assertionResults: [],
    }]), options)

    expect(results).toEqual([{ package: '@proj-airi/stage-shared', project: 'default', file: 'src/b.test.ts', name: fileFailureName, status: 'failed', firstError: 'Failed to load url ./missing (resolved id: ./missing)' }])
  })

  it('collapses duplicate names so any failing duplicate fails the key', () => {
    const results = parseVitestJsonReport(report([{
      name: join(packageDir, 'src', 'c.test.ts'),
      status: 'failed',
      message: '',
      assertionResults: [
        { ancestorTitles: [], title: 'twin', status: 'failed', failureMessages: ['Error: one'] },
        { ancestorTitles: [], title: 'twin', status: 'passed', failureMessages: [] },
      ],
    }]), options)

    expect(results.map(item => [item.name, item.status])).toEqual([['twin', 'failed']])
  })

  it('rejects truncated and wrongly shaped reports', () => {
    expect(() => parseVitestJsonReport('{"testResults": [', options)).toThrow(/not valid JSON/)
    expect(() => parseVitestJsonReport(JSON.stringify({ success: true }), options)).toThrow(/unexpected shape/)
  })
})
