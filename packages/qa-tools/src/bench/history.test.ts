import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { appendBenchLine, benchHistoryPath } from './history'

describe('bench history location', () => {
  it.each([
    ['linux', {}, '/home/u/.local/state/airi-perf/bench.jsonl'],
    ['linux', { XDG_STATE_HOME: '/state' }, '/state/airi-perf/bench.jsonl'],
    ['darwin', { XDG_STATE_HOME: '/state' }, '/Users/u/Library/Application Support/airi-perf/bench.jsonl'],
    ['win32', { LOCALAPPDATA: 'D:\\Local' }, 'D:\\Local\\airi-perf\\bench.jsonl'],
    ['win32', {}, 'C:\\Users\\u\\AppData\\Local\\airi-perf\\bench.jsonl'],
  ] as const)('resolves the %s state dir for %j', (platform, env, expected) => {
    const homedir = platform === 'win32' ? 'C:\\Users\\u' : platform === 'darwin' ? '/Users/u' : '/home/u'
    expect(benchHistoryPath({ platform, env, homedir })).toBe(expected)
  })

  it('puts bench.jsonl directly in AIRI_PERF_BENCH_DIR on every platform', () => {
    for (const platform of ['linux', 'darwin', 'win32'] as const)
      expect(benchHistoryPath({ platform, env: { AIRI_PERF_BENCH_DIR: '/bench', XDG_STATE_HOME: '/state' }, homedir: '/home/u' })).toMatch(/^[/\\]bench[/\\]bench\.jsonl$/)
  })
})

describe('bench history file', () => {
  let dir: string | undefined

  afterEach(() => {
    if (dir)
      rmSync(dir, { recursive: true, force: true })
  })

  it('appends lines to an owner-only file and keeps the earlier ones', () => {
    dir = mkdtempSync(join(tmpdir(), 'qa-bench-history-'))
    const path = join(dir, 'nested', 'bench.jsonl')
    appendBenchLine(path, '{"run":1}')
    appendBenchLine(path, '{"run":2}')

    expect(readFileSync(path, 'utf8')).toBe('{"run":1}\n{"run":2}\n')
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })
})
