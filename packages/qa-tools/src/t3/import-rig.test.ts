import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveLive2DRig } from './import-rig'

describe('resolveLive2DRig', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-rig-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('fails when the variable is unset, the directory is missing, or no model3 file is within depth 2', () => {
    expect(() => resolveLive2DRig({})).toThrow(/AIRI_QA_RIG_FORBOOTH is not set/)
    expect(() => resolveLive2DRig({ AIRI_QA_RIG_FORBOOTH: join(dir, 'missing') })).toThrow(/is not a directory/)
    mkdirSync(join(dir, 'a', 'b', 'c'), { recursive: true })
    writeFileSync(join(dir, 'a', 'b', 'c', 'deep.model3.json'), '{}')
    expect(() => resolveLive2DRig({ AIRI_QA_RIG_FORBOOTH: dir })).toThrow(/no \*\.model3\.json at depth <= 2/)
  })

  it('finds the model directory of a nested rig', () => {
    mkdirSync(join(dir, 'rig'))
    writeFileSync(join(dir, 'rig', 'model.model3.json'), '{}')
    expect(resolveLive2DRig({ AIRI_QA_RIG_FORBOOTH: dir })).toMatchObject({ modelDir: join(dir, 'rig'), model3: join(dir, 'rig', 'model.model3.json') })
  })
})
