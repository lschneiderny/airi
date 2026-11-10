import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readLastPass, readPass, verifyCacheKey, writeLastPass, writePass } from './verify-cache'

const parts = { tree: 'abc', step: 'lint', command: ['moeru-lint.js', 'a.ts'], node: 'v26.0.0', platform: 'win32' }

describe('verifyCacheKey', () => {
  it('changes when the tree, the command, or the toolchain changes', () => {
    const key = verifyCacheKey(parts)
    expect(verifyCacheKey({ ...parts })).toBe(key)
    expect(verifyCacheKey({ ...parts, tree: 'abd' })).not.toBe(key)
    expect(verifyCacheKey({ ...parts, command: ['moeru-lint.js', 'b.ts'] })).not.toBe(key)
    expect(verifyCacheKey({ ...parts, node: 'v26.1.0' })).not.toBe(key)
  })
})

describe('pass store', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-cache-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a pass and misses an unknown key', () => {
    const key = verifyCacheKey(parts)
    const pass = { key, step: 'lint', tree: 'abc', command: parts.command, passedAt: '2026-10-20T00:00:00.000Z', durationMs: 5, scopeBase: 'base', mode: 'branch' as const }
    writePass(dir, pass)
    expect(readPass(dir, key)).toEqual(pass)
    expect(readPass(dir, verifyCacheKey({ ...parts, tree: 'other' }))).toBeNull()
  })

  it('treats a corrupt entry or a key mismatch as a miss', () => {
    writeFileSync(join(dir, 'torn.json'), '{"key":')
    expect(readPass(dir, 'torn')).toBeNull()
    writeFileSync(join(dir, 'moved.json'), JSON.stringify({ key: 'elsewhere' }))
    expect(readPass(dir, 'moved')).toBeNull()
  })

  it('prunes entries older than 30 days when it writes', () => {
    const old = join(dir, 'old.json')
    writeFileSync(old, '{}')
    const now = Date.now()
    const fortyDaysAgo = (now - 40 * 24 * 60 * 60 * 1000) / 1000
    utimesSync(old, fortyDaysAgo, fortyDaysAgo)
    const key = verifyCacheKey(parts)
    writePass(dir, { key, step: 'lint', tree: 'abc', command: [], passedAt: '', durationMs: 0, scopeBase: 'base', mode: 'branch' }, now)
    expect(readPass(dir, 'old')).toBeNull()
    expect(readPass(dir, key)).not.toBeNull()
  })

  it('round-trips per-branch entries with encoded slashes and distinct branch names', () => {
    const record = {
      mergeBase: 'a'.repeat(40),
      steps: { test: { tree: 'b'.repeat(40), head: 'c'.repeat(40), recordedAt: '2026-11-10T00:00:00.000Z' } },
    }
    writeLastPass(dir, 'luke/feat/test', record)
    expect(readLastPass(dir, 'luke/feat/test')).toEqual(record)
    expect(readLastPass(dir, 'luke%2Ffeat%2Ftest')).toBeNull()
  })

  it.each([
    '{"mergeBase":',
    'null',
    JSON.stringify({ mergeBase: 'a'.repeat(40), steps: { test: { tree: 4 } } }),
    JSON.stringify({ mergeBase: 'a'.repeat(40), steps: { test: { tree: '--help', head: 'c'.repeat(40), recordedAt: 'now' } } }),
  ])('treats malformed last-pass data as a missing record: %s', (data) => {
    mkdirSync(join(dir, 'last'))
    writeFileSync(join(dir, 'last', 'branch.json'), data)
    expect(readLastPass(dir, 'branch')).toBeNull()
  })
})
