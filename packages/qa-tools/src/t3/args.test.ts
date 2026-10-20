import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadT3Scenario, parseT3Args, resolveRig, T3UsageError } from './args'

const fixturesDir = resolve(import.meta.dirname, '..', '..', 'fixtures', 'scenarios')

describe('parseT3Args', () => {
  it('reads --rig, --scenario and --keep-open', () => {
    expect(parseT3Args(['--rig', 'forbooth', '--scenario', 'builtin:t3-smoke', '--keep-open'])).toEqual({ rig: 'forbooth', scenario: 'builtin:t3-smoke', keepOpen: true })
  })

  it.each([
    [[], /--rig is required/],
    [['--rig', 'bear', '--scenario', 'x'], /Unknown rig "bear"/],
    [['--rig', 'forbooth'], /--scenario is required/],
    [['--rig', 'forbooth', '--scenario', 'x', '--seconds', '3'], /Unknown option/],
  ])('rejects %j as a usage error', (argv, message) => {
    expect(() => parseT3Args(argv)).toThrow(T3UsageError)
    expect(() => parseT3Args(argv)).toThrow(message)
  })
})

describe('resolveRig', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-rig-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('fails when the variable is unset, the directory is missing, or no model3 file is within depth 2', () => {
    expect(() => resolveRig('forbooth', {})).toThrow(/AIRI_QA_RIG_FORBOOTH is not set/)
    expect(() => resolveRig('forbooth', { AIRI_QA_RIG_FORBOOTH: join(dir, 'missing') })).toThrow(/is not a directory/)
    mkdirSync(join(dir, 'a', 'b', 'c'), { recursive: true })
    writeFileSync(join(dir, 'a', 'b', 'c', 'deep.model3.json'), '{}')
    expect(() => resolveRig('forbooth', { AIRI_QA_RIG_FORBOOTH: dir })).toThrow(/no \*\.model3\.json at depth <= 2/)
  })

  it('finds the model directory of a nested rig', () => {
    mkdirSync(join(dir, 'rig'))
    writeFileSync(join(dir, 'rig', 'model.model3.json'), '{}')
    expect(resolveRig('forbooth', { AIRI_QA_RIG_FORBOOTH: dir })).toMatchObject({ modelDir: join(dir, 'rig'), model3: join(dir, 'rig', 'model.model3.json') })
  })
})

describe('loadT3Scenario', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-scenario-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const write = (name: string, value: unknown) => {
    writeFileSync(join(dir, name), JSON.stringify(value))
    return join(dir, name)
  }
  const base = { version: 1, id: 's', seed: 1, durationSeconds: 10, levels: ['t3'], events: [] }

  it('loads the builtin smoke scenario', () => {
    expect(loadT3Scenario('builtin:t3-smoke', { fixturesDir, cwd: dir }).scenario.id).toBe('t3-smoke')
  })

  it('rejects unknown builtins, invalid scenarios, missing t3, and scenarios longer than 599 s', () => {
    expect(() => loadT3Scenario('builtin:nope', { fixturesDir, cwd: dir })).toThrow(/No builtin scenario "nope"/)
    expect(() => loadT3Scenario(write('bad.json', { ...base, version: 2 }), { fixturesDir, cwd: dir })).toThrow(/is invalid/)
    expect(() => loadT3Scenario(write('t1.json', { ...base, levels: ['t1'] }), { fixturesDir, cwd: dir })).toThrow(/does not list level "t3"/)
    expect(() => loadT3Scenario(write('long.json', { ...base, durationSeconds: 600 }), { fixturesDir, cwd: dir })).toThrow(/limited to 599 s/)
    expect(loadT3Scenario(write('ok.json', { ...base, durationSeconds: 599 }), { fixturesDir, cwd: dir }).scenario.durationSeconds).toBe(599)
  })
})
