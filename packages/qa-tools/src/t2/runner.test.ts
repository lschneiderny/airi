import type { CatalogEntry } from '@proj-airi/stage-shared/expression-performance'

import type { T2Runtime } from './runner'

import process from 'node:process'

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildEmotionTrial } from '@proj-airi/stage-shared/motion-scenario'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import catalogJson from '../../fixtures/forbooth-catalog.json'

import { defaultCorePath, loadCubismCoreInNode } from './core-node'
import { T2SetupError } from './errors'
import { loadT2Runtime, runT2 } from './runner'

const catalog = catalogJson as CatalogEntry[]
const rigRoot = process.env.AIRI_QA_RIG_FORBOOTH
const corePath = process.env.AIRI_QA_CUBISM_CORE ?? defaultCorePath
const skipReason = !rigRoot
  ? 'AIRI_QA_RIG_FORBOOTH is not set; rigs are local-only and never committed'
  : !existsSync(corePath) ? `the Cubism core is missing at ${corePath}; set AIRI_QA_CUBISM_CORE` : undefined
if (skipReason)
  console.info(`[qa-tools] T2 rig tests skipped: ${skipReason}`)

/** A 10 s trial: 4 s idle, a 2 s hold, 4 s after. */
const trial = (seed = 1) => buildEmotionTrial({ emotion: 'angry', band: 'strong', variant: 'full', seed, warmup: 4, hold: 2, post: 4 })

describe('t2 setup errors', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true })
  })

  it('exits 2 and names the missing .moc3 for an empty rig folder, before it needs a core', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'qa-t2-empty-'))
    dirs.push(empty)

    const error = await loadT2Runtime({ rigRoot: empty, corePath: join(empty, 'no-core.js') }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(T2SetupError)
    expect((error as T2SetupError).exitCode).toBe(2)
    expect((error as T2SetupError).message).toContain('.moc3')
  })

  it('exits 2 for a missing rig folder', async () => {
    const error = await loadT2Runtime({ rigRoot: join(tmpdir(), 'qa-t2-does-not-exist') }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(T2SetupError)
    expect((error as T2SetupError).exitCode).toBe(2)
  })

  it.each(['{', 'null', '[]'])('exits 2 for an invalid model3.json: %s', async (json) => {
    const dir = mkdtempSync(join(tmpdir(), 'qa-t2-invalid-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'invalid.model3.json'), json)

    const error = await loadT2Runtime({ rigRoot: dir }).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(T2SetupError)
    expect((error as T2SetupError).exitCode).toBe(2)
    expect((error as T2SetupError).message).toContain('invalid.model3.json')
  })

  it('exits 2 for a missing Cubism core', async () => {
    const error = await loadCubismCoreInNode(join(tmpdir(), 'qa-t2-no-core.js')).catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(T2SetupError)
    expect((error as T2SetupError).message).toContain('AIRI_QA_CUBISM_CORE')
  })
})

describe('runT2', () => {
  let runtime: T2Runtime
  beforeAll(async () => {
    if (!skipReason)
      runtime = await loadT2Runtime()
  }, 60_000)

  it.skipIf(skipReason)('serializes two runs of one 10 s scenario to the same bytes, whatever ran in between', () => {
    const first = JSON.stringify(runT2(trial(), runtime, { catalog }))
    const other = JSON.stringify(runT2(trial(2), runtime, { catalog }))

    expect(JSON.stringify(runT2(trial(), runtime, { catalog }))).toBe(first)
    expect(other).not.toBe(first)
  }, 120_000)

  it.skipIf(skipReason)('moves the rig and raises the angry switch parameter through the shared scenario sink', () => {
    const trace = runT2(trial(), runtime, { catalog })

    expect(trace.meta.model).toBe('forbooth')
    expect(Math.max(...trace.channels.Param60)).toBeGreaterThan(0)
    expect(Math.max(...trace.channels.ParamBrowLY) - Math.min(...trace.channels.ParamBrowLY)).toBeGreaterThan(0)
  }, 60_000)

  it.skipIf(skipReason)('records the same parameters with and without mesh deformation', () => {
    const record = (deform: boolean) => {
      const frames: number[][] = []
      runT2(trial(), runtime, { catalog, deform, observe: (values) => {
        frames.push(Array.from(values))
      } })
      return frames
    }
    const without = record(false)

    expect(without.length).toBeGreaterThan(0)
    expect(record(true)).toEqual(without)
  }, 120_000)
})
