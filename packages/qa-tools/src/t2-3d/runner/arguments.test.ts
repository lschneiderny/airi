import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, it } from 'vitest'

import { runMotion3d } from '../cli/run'
import { parseRunArguments } from './arguments'

const directories: string[] = []
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))

function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), 'motion3d-arguments-'))
  directories.push(cwd)
  writeFileSync(join(cwd, 'model.pmx'), 'external model bytes')
  return { cwd, repoRoot: cwd, signal: new AbortController().signal }
}

it('resolves paths against the caller and applies scenario defaults', () => {
  const context = fixture()
  const options = parseRunArguments(['--model', 'model.pmx', '--scenario', 'idle', '--seed', '2', '--out', 'capture', '--verify-determinism'], context.cwd)
  expect(options.model).toBe(join(context.cwd, 'model.pmx'))
  expect(options.out).toBe(join(context.cwd, 'capture'))
  expect([options.seed, options.seconds, options.warmupSeconds, options.verifyDeterminism]).toEqual([2, 60, 10, true])
})

it('takes the acts switch for the idle-acts pair, on by default', () => {
  const context = fixture()
  const parse = (extra: string[]) => parseRunArguments(['--model', 'model.pmx', '--scenario', 'idle', '--out', 'capture', ...extra], context.cwd).acts
  expect([parse([]), parse(['--acts', 'off'])]).toEqual(['on', 'off'])
})

it('takes a walk style in degrees for its angles, a held mood and a starting energy, all unset by default', () => {
  const context = fixture()
  const parse = (extra: string[]) => parseRunArguments(['--model', 'model.pmx', '--scenario', 'walk', '--out', 'capture', ...extra], context.cwd)
  expect(parse([])).toMatchObject({ walkStyle: null, mood: null, energy: null })
  const options = parse(['--walk-style', 'armSwing=0.5,head=10,wristCarry=10,handCurl=2', '--mood=-0.5,0.25,0.75', '--energy', '0.2'])
  expect(options.walkStyle).toMatchObject({ armSwing: 0.5, speed: 1, handCurl: 2 })
  expect(options.walkStyle?.head).toBeCloseTo(10 * Math.PI / 180, 12)
  expect(options.walkStyle?.wristCarry).toBeCloseTo(10 * Math.PI / 180, 12)
  expect(options.mood).toEqual({ valence: -0.5, arousal: 0.25, tension: 0.75 })
  expect(options.energy).toBe(0.2)
})

it('takes a pep for the whole run, the calm 0 by default', () => {
  const context = fixture()
  const parse = (extra: string[]) => parseRunArguments(['--model', 'model.pmx', '--scenario', 'speak', '--out', 'capture', ...extra], context.cwd).pep
  expect([parse([]), parse(['--pep', '0.5']), parse(['--pep', '1'])]).toEqual([0, 0.5, 1])
})

it.each(['idle', 'sleepy-no-clip'])('accepts up to 600 s for the idle-class scenario %s (owner decision O1)', (scenario) => {
  const context = fixture()
  expect(parseRunArguments(['--model', 'model.pmx', '--scenario', scenario, '--seconds', '600', '--out', 'capture'], context.cwd).seconds).toBe(600)
})

it.each([
  ['missing model', ['--scenario', 'idle', '--out', 'capture']],
  ['unreadable model', ['--model', 'missing.pmx', '--scenario', 'idle', '--out', 'capture']],
  ['unknown scenario', ['--model', 'model.pmx', '--scenario', 'missing', '--out', 'capture']],
  ['existing output', ['--model', 'model.pmx', '--scenario', 'idle', '--out', '.']],
  ['idle duration over its cap', ['--model', 'model.pmx', '--scenario', 'idle', '--seconds', '601', '--out', 'capture']],
  ['duration over the cap of a scenario that is not idle-class', ['--model', 'model.pmx', '--scenario', 'gaze-shift', '--seconds', '121', '--out', 'capture']],
  ['invalid seed', ['--model', 'model.pmx', '--scenario', 'idle', '--seed', 'NaN', '--out', 'capture']],
  ['invalid acts switch', ['--model', 'model.pmx', '--scenario', 'idle', '--acts', 'maybe', '--out', 'capture']],
  ['unknown walk style key', ['--model', 'model.pmx', '--scenario', 'walk', '--walk-style', 'swagger=2', '--out', 'capture']],
  ['walk style value out of bounds', ['--model', 'model.pmx', '--scenario', 'walk', '--walk-style', 'armSwing=5', '--out', 'capture']],
  ['mood out of range', ['--model', 'model.pmx', '--scenario', 'walk', '--mood', '0,0,2', '--out', 'capture']],
  ['energy out of range', ['--model', 'model.pmx', '--scenario', 'walk', '--energy', '1.5', '--out', 'capture']],
  ['walk style key without a value', ['--model', 'model.pmx', '--scenario', 'walk', '--walk-style', 'head', '--out', 'capture']],
  ['mood with an empty value', ['--model', 'model.pmx', '--scenario', 'walk', '--mood=0,,0', '--out', 'capture']],
  ['empty energy', ['--model', 'model.pmx', '--scenario', 'walk', '--energy=', '--out', 'capture']],
  ['pep out of range', ['--model', 'model.pmx', '--scenario', 'speak', '--pep', '1.5', '--out', 'capture']],
  ['empty pep', ['--model', 'model.pmx', '--scenario', 'speak', '--pep=', '--out', 'capture']],
  ['walk style assignment with two values', ['--model', 'model.pmx', '--scenario', 'walk', '--walk-style=head=10=2', '--out', 'capture']],
  ['empty walk style', ['--model', 'model.pmx', '--scenario', 'walk', '--walk-style=', '--out', 'capture']],
])('refuses %s with exit 2 before a run starts', async (_, args) => {
  expect(await runMotion3d(args, fixture())).toBe(2)
})

it('takes the clearance measure, and refuses it for a scenario in which a clip claims an arm', () => {
  const context = fixture()
  const parse = (scenario: string, extra: string[]) => parseRunArguments(['--model', 'model.pmx', '--scenario', scenario, '--out', 'capture', ...extra], context.cwd)
  expect([parse('idle', []).clearance, parse('idle', ['--clearance']).clearance]).toEqual([false, true])
  expect(parse('gesture-under-clip', []).clearance).toBe(false)
  expect(() => parse('gesture-under-clip', ['--clearance'])).toThrow('clip-driven arms')
})
