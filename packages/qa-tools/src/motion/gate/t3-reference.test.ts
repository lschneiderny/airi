import process from 'node:process'

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runGateCli } from './cli'
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
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('runGateCli --level t3 --t1-report', () => {
  async function run(reference: string): Promise<{ code: number, errors: string[], slots: string[] }> {
    const slotsDir = join(root, 'slots')
    vi.stubEnv('AIRI_CPU_SLOTS_DIR', slotsDir)
    const errors: string[] = []
    vi.spyOn(console, 'error').mockImplementation((message: string) => void errors.push(message))
    const env: NodeJS.ProcessEnv = { ...process.env, AIRI_CPU_SLOTS_DIR: slotsDir }
    delete env.AIRI_QA_RIG_FORBOOTH
    const code = await runGateCli(['emotion', '--level', 't3', '--rig', 'forbooth', '--t1-report', reference], root, env)
    return { code, errors, slots: existsSync(slotsDir) ? readdirSync(slotsDir) : [] }
  }

  it('refuses a cached reference before any lease or rig setup', async () => {
    const dir = runDir('20261022-000000-motion-gate-emotion-t1', { gitSha: 'abc', cache: { hit: true, sourceRunId: 's', entryId: 'e' } })
    const result = await run(dir)
    expect(result.code).toBe(2)
    expect(result.errors).toEqual([`T1 reference ${dir} is a cached run; rerun it with --fresh`])
    expect(result.slots).toEqual([])
  })

  it('refuses a reference that is not a run directory before any lease', async () => {
    const result = await run(join(root, 'missing'))
    expect(result.code).toBe(2)
    expect(result.errors[0]).toContain('is not a run directory')
    expect(result.slots).toEqual([])
  })
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
