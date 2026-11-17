import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readLastPass, writeLastPass } from './verify-last-pass'

describe('last-pass record', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-last-pass-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
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
