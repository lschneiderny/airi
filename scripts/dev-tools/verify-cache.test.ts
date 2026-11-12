import type { ReuseRequest, TreeFailure, TreePass } from './verify-cache'

import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { decideReuse, envKeyOf, maxTreeRecords, readLastPass, readTreeRecords, writeLastPass, writeTreeRecord } from './verify-cache'

const tree = 'a'.repeat(40)
const pass: TreePass = {
  kind: 'pass',
  step: 'test',
  tree,
  toolchain: 'v26.11.1 linux',
  envKey: 'none',
  mode: 'incremental',
  covers: ['packages/a/src/x.ts', 'packages/a/src/y.ts', 'README.md'],
  coverBase: 'b'.repeat(40),
  worktree: '/work/worker',
  branch: 'luke/feat/x',
  at: '2026-11-12T10:00:00.000Z',
  durationMs: 1000,
}
const request: ReuseRequest = { step: 'test', tree, toolchain: pass.toolchain, envKey: pass.envKey, gate: false, changed: ['packages/a/src/x.ts', 'packages/a/src/y.ts', 'README.md'], clean: true, noCache: false }
const failure = (at: string): TreeFailure => ({ kind: 'failure', step: 'test', tree, toolchain: pass.toolchain, envKey: pass.envKey, worktree: '/work/lead', at })

describe('decideReuse', () => {
  it('reuses another worktree\'s pass at the same tree for an equal or narrower scope', () => {
    expect(decideReuse(request, [pass])).toEqual({ kind: 'reuse', pass })
    expect(decideReuse({ ...request, changed: ['packages/a/src/x.ts'] }, [pass])).toEqual({ kind: 'reuse', pass })
  })

  it('reruns a scope that asks for a file the pass did not cover', () => {
    expect(decideReuse({ ...request, changed: [...request.changed, 'packages/b/src/z.ts'] }, [pass])).toMatchObject({ kind: 'run' })
  })

  it.each([
    ['a dirty tree', { clean: false }],
    ['--no-cache', { noCache: true }],
    ['another Node version', { toolchain: 'v26.13.0 linux' }],
    ['other gated-test variables', { envKey: 'with-model' }],
    ['another step', { step: 'lint' as const }],
    ['another tree', { tree: 'c'.repeat(40) }],
  ])('never reuses for %s', (_, change) => {
    expect(decideReuse({ ...request, ...change }, [pass])).toMatchObject({ kind: 'run' })
  })

  it('gives --gate only a pass that checked the whole branch itself', () => {
    expect(decideReuse({ ...request, gate: true }, [pass])).toMatchObject({ kind: 'run' })
    const branchPass = { ...pass, mode: 'branch' as const }
    expect(decideReuse({ ...request, gate: true }, [pass, branchPass])).toEqual({ kind: 'reuse', pass: branchPass })
  })

  it('lets a failure at the tree outrank every earlier pass, and a later pass outrank the failure', () => {
    expect(decideReuse(request, [pass, failure('2026-11-12T11:00:00.000Z')])).toMatchObject({ kind: 'run', reason: 'a later run at this tree failed' })
    const later = { ...pass, at: '2026-11-12T12:00:00.000Z' }
    expect(decideReuse(request, [pass, failure('2026-11-12T11:00:00.000Z'), later])).toEqual({ kind: 'reuse', pass: later })
  })
})

describe('envKeyOf', () => {
  it('changes with an AIRI_QA_ variable only', () => {
    const key = envKeyOf({ PATH: '/bin' })
    expect(envKeyOf({ PATH: '/usr/bin', HOME: '/home' })).toBe(key)
    expect(envKeyOf({ PATH: '/bin', AIRI_QA_MMD_MODEL: '/models/a.pmx' })).not.toBe(key)
  })
})

describe('tree record store', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'verify-cache-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips passes and failures of one tree, oldest first, and skips malformed records', () => {
    writeTreeRecord(dir, failure('2026-11-12T11:00:00.000Z'))
    writeTreeRecord(dir, pass)
    writeTreeRecord(dir, { ...pass, tree: 'c'.repeat(40) })
    writeFileSync(join(dir, `${tree}-test-pass-torn.json`), '{"kind":')
    writeFileSync(join(dir, `${tree}-test-pass-narrow.json`), JSON.stringify({ ...pass, covers: 'everything' }))
    expect(readTreeRecords(dir, tree)).toEqual([pass, failure('2026-11-12T11:00:00.000Z')])
  })

  it('drops records older than 30 days and keeps the newest when the store is full', () => {
    const now = Date.now()
    const old = join(dir, `${'d'.repeat(40)}-lint-pass-old.json`)
    writeFileSync(old, '{}')
    utimesSync(old, (now - 40 * 86_400_000) / 1000, (now - 40 * 86_400_000) / 1000)
    for (let i = 0; i < maxTreeRecords; i++) {
      const file = join(dir, `${'e'.repeat(40)}-lint-pass-${i}.json`)
      writeFileSync(file, '{}')
      utimesSync(file, (now - 86_400_000 + i) / 1000, (now - 86_400_000 + i) / 1000)
    }
    writeTreeRecord(dir, pass, now)
    const names = readdirSync(dir)
    expect(names).toHaveLength(maxTreeRecords)
    expect(names).not.toContain(`${'d'.repeat(40)}-lint-pass-old.json`)
    expect(names).not.toContain(`${'e'.repeat(40)}-lint-pass-0.json`)
    expect(readTreeRecords(dir, tree)).toEqual([pass])
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
