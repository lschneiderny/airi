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

  it('loads the near-band touch approach without changing the strokes, rest, or pokes', () => {
    const scenario = loadT3Scenario('builtin:t3-touch', { fixturesDir, cwd: dir }).scenario
    const pointer = scenario.events.filter(event => event.kind === 'pointer')
    const approach = pointer.filter(event => event.at < 4.5)
    expect(approach).toHaveLength(27)
    expect(approach[0]).toEqual({ kind: 'pointer', at: 2, phase: 'move', x: 1.9, y: 0 })
    expect(approach.at(-1)).toEqual({ kind: 'pointer', at: 2.433333, phase: 'move', x: 0.6, y: 0 })
    for (let index = 1; index < approach.length; index++) {
      const previous = approach[index - 1]
      const current = approach[index]
      expect((previous.x - current.x) / (current.at - previous.at)).toBeCloseTo(3, 3)
    }
    const strokes = pointer.filter(event => event.at >= 4.5 && event.at <= 8.5)
    expect(strokes).toHaveLength(241)
    expect(strokes[0].at).toBe(4.5)
    expect(strokes.at(-1)?.at).toBe(8.5)
    expect(Math.min(...strokes.map(event => event.x))).toBe(-0.4)
    expect(Math.max(...strokes.map(event => event.x))).toBe(0.4)
    expect(strokes.every(event => event.phase === 'move' && event.y === 0)).toBe(true)
    for (let index = 1; index < strokes.length; index++)
      expect(strokes[index].at - strokes[index - 1].at).toBeCloseTo(1 / 60, 5)
    const pokes = pointer.filter(event => event.phase === 'down' || event.phase === 'up')
    expect(pokes).toEqual([
      { kind: 'pointer', at: 10, phase: 'down', x: 0, y: 1.1 },
      { kind: 'pointer', at: 10.2, phase: 'up', x: 0, y: 1.1 },
      { kind: 'pointer', at: 12, phase: 'down', x: 0, y: -0.35 },
      { kind: 'pointer', at: 12.2, phase: 'up', x: 0, y: -0.35 },
    ])
    expect(pokes[0].at - strokes.at(-1)!.at).toBe(1.5)
    expect(pointer.every(event => Math.abs(event.x) <= 1.9)).toBe(true)
    expect(scenario.events.at(-1)).toEqual(pokes.at(-1))
    expect(scenario.screenshotsAt).toEqual([6.5, 10.3, 12.3])
  })

  it('rejects unknown builtins, invalid scenarios, missing t3, and scenarios longer than 599 s', () => {
    expect(() => loadT3Scenario('builtin:nope', { fixturesDir, cwd: dir })).toThrow(/No builtin scenario "nope"/)
    expect(() => loadT3Scenario(write('bad.json', { ...base, version: 2 }), { fixturesDir, cwd: dir })).toThrow(/is invalid/)
    expect(() => loadT3Scenario(write('t1.json', { ...base, levels: ['t1'] }), { fixturesDir, cwd: dir })).toThrow(/does not list level "t3"/)
    expect(() => loadT3Scenario(write('long.json', { ...base, durationSeconds: 600 }), { fixturesDir, cwd: dir })).toThrow(/limited to 599 s/)
    expect(loadT3Scenario(write('ok.json', { ...base, durationSeconds: 599 }), { fixturesDir, cwd: dir }).scenario.durationSeconds).toBe(599)
  })
})
