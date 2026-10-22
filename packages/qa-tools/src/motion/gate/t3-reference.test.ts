import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { findT1Reference } from './t3-gate'

let root: string

function runDir(name: string, manifest: unknown): string {
  const dir = join(root, '.temp', 'qa', name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'run.json'), JSON.stringify(manifest))
  return dir
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'qa-t3-reference-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('findT1Reference', () => {
  it('refuses a cached run named by --t1-report', () => {
    const dir = runDir('20261022-000000-motion-gate-emotion-t1', { gitSha: 'abc', cache: { hit: true, sourceRunId: 's', entryId: 'e' } })
    expect(findT1Reference(root, 'abc', dir)).toBe(`T1 reference ${dir} is a cached run; rerun it with --fresh`)
  })

  it('does not pick a cached run when searching for the newest reference', () => {
    const dir = runDir('20261022-000000-motion-gate-emotion-t1', { gitSha: 'abc', cache: { hit: true, sourceRunId: 's', entryId: 'e' } })
    const result = findT1Reference(root, 'abc', null)
    expect(typeof result).toBe('string')
    expect(result).toContain(`${dir}: cached run`)
  })
})
