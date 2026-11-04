import type { SimulationResult } from './simulate'

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { characterUsage, runCharacterCli } from './cli'
import { BUILTIN_SCENARIOS } from './scenario'

const packageRoot = join(import.meta.dirname, '..', '..')
const tempDir = mkdtempSync(join(tmpdir(), 'qa-character-'))

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

function cli(argv: string[]) {
  const out: string[] = []
  const err: string[] = []
  const code = runCharacterCli(argv, { stdout: text => out.push(text), stderr: text => err.push(text), cwd: packageRoot })
  return { code, out: out.join(''), err: err.join('') }
}

function simulateJson(argv: string[]): { code: number, result: SimulationResult } {
  const { code, out } = cli(['simulate', ...argv, '--json'])
  return { code, result: JSON.parse(out) as SimulationResult }
}

function tempFile(name: string, content: string): string {
  const file = join(tempDir, name)
  writeFileSync(file, content)
  return file
}

describe('runCharacterCli arguments', () => {
  it('prints usage on stdout and exits 0 for help', () => {
    const { code, out, err } = cli(['help'])
    expect(code).toBe(0)
    expect(out).toBe(characterUsage)
    expect(err).toBe('')
  })

  it.each([
    [[], 'missing command'],
    [['bogus'], 'unknown command "bogus"'],
    [['simulate', '--scenario', 'typical-month', '--bogus'], '--bogus'],
    [['simulate'], '--scenario is required'],
    [['simulate', '--scenario', 'typical-month', '--days', '0'], '--days must be a positive integer'],
    [['simulate', '--scenario', 'typical-month', '--seed', '-1'], '--seed'],
    [['simulate', '--scenario', 'typical-month', 'extra'], 'unexpected argument "extra"'],
    [['render'], '--stage is required'],
    [['render', '--stage', 'soulmate'], 'unknown stage "soulmate"'],
    [['render', '--stage', 'close', '--mood', 'ecstatic'], 'unknown mood bucket "ecstatic"'],
    [['render', '--stage', 'close', '--mood', 'good,low'], 'two valence buckets'],
  ])('exits 2 with a message and usage for %j', (argv, message) => {
    const { code, out, err } = cli(argv)
    expect(code).toBe(2)
    expect(out).toBe('')
    expect(err).toContain(message)
    expect(err).toContain(characterUsage)
  })

  it('exits 2 for a scenario that is neither built in nor a file', () => {
    const { code, err } = cli(['simulate', '--scenario', 'no-such-scenario'])
    expect(code).toBe(2)
    expect(err).toContain('Unknown scenario "no-such-scenario"')
    expect(err).toContain(BUILTIN_SCENARIOS.join(', '))
  })

  it('exits 2 for a scenario file that is not JSON', () => {
    const { code, err } = cli(['simulate', '--scenario', tempFile('broken.json', '{"name": "broken", "days": 3,')])
    expect(code).toBe(2)
    expect(err).toContain('Cannot read scenario')
  })

  it('exits 2 for a scenario file that fails the schema or has an invalid cue', () => {
    const unknownKind = tempFile('kind.json', JSON.stringify({ name: 'x', description: '', days: 1, routines: [{ events: [{ at: '08:00', kind: 'hug' }] }] }))
    expect(cli(['simulate', '--scenario', unknownKind])).toMatchObject({ code: 2, err: expect.stringContaining('routines.0.events.0.kind') })
    const badCue = tempFile('cue.json', JSON.stringify({ name: 'x', description: '', days: 1, routines: [{ events: [{ at: '08:00', kind: 'model-cue', cue: 'happier: no' }] }] }))
    expect(cli(['simulate', '--scenario', badCue])).toMatchObject({ code: 2, err: expect.stringContaining('not a valid MOOD cue body') })
  })
})

describe('simulate', () => {
  it('reproduces the A7 typical month: closeness 0.35 ± 0.03 on day 30 with every invariant held', () => {
    const { code, result } = simulateJson(['--scenario', 'typical-month', '--days', '30', '--seed', '41'])
    expect(code).toBe(0)
    expect(result.violations).toEqual([])
    expect(result.daily).toHaveLength(30)
    expect(Math.abs(result.daily[29]!.levels.closeness - 0.35)).toBeLessThanOrEqual(0.03)
    expect(result.summary.rejectedEvents).toBe(0)
  })

  it('is deterministic for a seed', () => {
    expect(simulateJson(['--scenario', 'typical-month', '--days', '10', '--seed', '7'])).toEqual(simulateJson(['--scenario', 'typical-month', '--days', '10', '--seed', '7']))
  })

  it('holds the model-only raw valence at or below 0.65 under one brighter cue per minute', () => {
    const { code, result } = simulateJson(['--scenario', 'model-spam', '--days', '3'])
    expect(code).toBe(0)
    expect(result.summary.modelOnlyRawBound).toBe(0.65)
    expect(result.summary.maxModelOnlyRaw).toBeLessThanOrEqual(0.65)
    // The budget is actually reached, so the bound is exercised rather than trivially met.
    expect(result.summary.maxModelOnlyRaw).toBeGreaterThan(0.5)
  })

  it('turns pointed only once unanswered reach-outs lead the reasons', () => {
    const { code, result } = simulateJson(['--scenario', 'hurt'])
    expect(code).toBe(0)
    expect(result.daily[7]!.valence.min).toBeLessThan(-0.45)
    expect(result.daily[7]!.pointedHours).toBe(0)
    expect(result.summary.firstPointedDay).toBe(9)
  })

  it('keeps closeness and trust through an absence', () => {
    const { code, result } = simulateJson(['--scenario', 'absence'])
    expect(code).toBe(0)
    const beforeAway = result.daily[9]!.levels
    expect(result.daily[29]!.levels.closeness).toBe(beforeAway.closeness)
    expect(result.daily[29]!.levels.trust).toBe(beforeAway.trust)
  })

  it('exits 1 and names the invariant when a scenario injects a bogus delta of 5', () => {
    const { code, out } = cli(['simulate', '--scenario', 'src/character-state/fixtures/invariant-violation.json'])
    expect(code).toBe(1)
    expect(out).toContain('raw-headroom')
    expect(out).toMatch(/invariants: \d+ violation/)
  })
})

describe('render', () => {
  it.each(['stranger', 'friendly', 'close', 'intimate'] as const)('matches the committed %s stage fixture', (stage) => {
    const fixture = JSON.parse(readFileSync(join(packageRoot, 'model-eval', 'fixtures', 'character-stages', `${stage}.json`), 'utf8')) as { stage: string, text: string }
    const { code, out } = cli(['render', '--stage', stage])
    expect(code).toBe(0)
    expect(fixture.stage).toBe(stage)
    expect(out).toBe(fixture.text === '' ? '' : `${fixture.text}\n`)
  })

  it('renders the named mood buckets', () => {
    expect(cli(['render', '--stage', 'friendly', '--mood', 'low,tense']).out).toBe('Feeling: low, steady, tense.\nYou two: you are friendly and at ease with him; you can tease him a little.\n')
  })
})
