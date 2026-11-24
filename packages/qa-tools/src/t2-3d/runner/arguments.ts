import type { GaitStyle, GaitStyleKey, MutableGaitStyle } from '@proj-airi/motion-driver-humanoid/locomotion'

import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { GAIT_STYLE_BOUNDS, GAIT_STYLE_KEYS, NEUTRAL_GAIT_STYLE } from '@proj-airi/motion-driver-humanoid/locomotion'

import { clipClaimsAnArm, motion3dScenarios } from '../scenarios'

export class Motion3dUsageError extends Error {
  override readonly name = 'Motion3dUsageError'
}

/** Style values given in degrees on the command line. */
const ANGLE_KEYS: ReadonlySet<GaitStyleKey> = new Set(['elbowCarry', 'armOut', 'lean', 'head'])

/**
 * `key=value,...` over `GaitStyle`'s keys, angles in degrees; unnamed keys keep the neutral walk's value. A value outside
 * `GAIT_STYLE_BOUNDS` is refused rather than clamped, so a run records the style it was asked for.
 */
function parseWalkStyle(text: string): GaitStyle {
  const style: MutableGaitStyle = { ...NEUTRAL_GAIT_STYLE }
  const pairs = text.split(',')
  if (pairs.some(pair => pair.split('=').length !== 2))
    throw new Motion3dUsageError('--walk-style must be one or more key=value assignments separated by commas')
  for (const pair of pairs) {
    const [name = '', raw = ''] = pair.split('=')
    const key = GAIT_STYLE_KEYS.find(candidate => candidate === name)
    if (!key)
      throw new Motion3dUsageError(`--walk-style keys must be among: ${GAIT_STYLE_KEYS.join(', ')}`)
    if (raw.trim() === '')
      throw new Motion3dUsageError(`--walk-style ${key} needs a value`)
    const value = Number(raw) * (ANGLE_KEYS.has(key) ? Math.PI / 180 : 1)
    const [min, max] = GAIT_STYLE_BOUNDS[key]
    if (!Number.isFinite(value) || value < min - 1e-9 || value > max + 1e-9)
      throw new Motion3dUsageError(`--walk-style ${key} must lie within its bounds`)
    style[key] = value
  }
  return style
}

/** `valence,arousal,tension`: the mood the body reads, held for the whole run. */
function parseMood(text: string) {
  const parts = text.split(',')
  if (parts.length !== 3 || parts.some(part => part.trim() === ''))
    throw new Motion3dUsageError('--mood must be valence,arousal,tension')
  const [valence, arousal, tension] = parts.map(Number)
  const unit = (value: number | undefined, min: number) => value !== undefined && Number.isFinite(value) && value >= min && value <= 1
  if (!unit(valence, -1) || !unit(arousal, -1) || !unit(tension, 0))
    throw new Motion3dUsageError('--mood must be valence,arousal,tension with valence and arousal in [-1, 1] and tension in [0, 1]')
  return { valence: valence as number, arousal: arousal as number, tension: tension as number }
}

/** Parses user inputs once, before creating evidence. */
export function parseRunArguments(args: readonly string[], cwd: string) {
  try {
    const { values } = parseArgs({
      args: [...args],
      options: {
        'model': { type: 'string' },
        'scenario': { type: 'string' },
        'seed': { type: 'string', default: '1' },
        'seconds': { type: 'string' },
        'warmup': { type: 'string' },
        'out': { type: 'string' },
        'verify-determinism': { type: 'boolean', default: false },
        'acts': { type: 'string', default: 'on' },
        'walk-style': { type: 'string' },
        'mood': { type: 'string' },
        'energy': { type: 'string' },
        'pep': { type: 'string' },
        'clearance': { type: 'boolean', default: false },
      },
      strict: true,
      allowPositionals: false,
    })
    if (!values.model)
      throw new Motion3dUsageError('--model <pmx> is required')
    const model = resolve(cwd, values.model)
    if (extname(model).toLowerCase() !== '.pmx' || !statSync(model).isFile())
      throw new Motion3dUsageError('--model must name a PMX file')
    accessSync(model, constants.R_OK)
    const scenario = motion3dScenarios.find(entry => entry.id === values.scenario)
    if (!scenario)
      throw new Motion3dUsageError(`--scenario must be one of: ${motion3dScenarios.map(entry => entry.id).join(', ')}`)
    if (!values.out)
      throw new Motion3dUsageError('--out <directory> is required')
    const out = resolve(cwd, values.out)
    if (existsSync(out))
      throw new Motion3dUsageError(`--out already exists: ${out}`)
    const seed = Number(values.seed)
    const seconds = Number(values.seconds ?? scenario.seconds)
    const warmupSeconds = Number(values.warmup ?? scenario.warmupSeconds)
    if (!Number.isSafeInteger(seed))
      throw new Motion3dUsageError('--seed must be a safe integer')
    if (values.clearance && clipClaimsAnArm(scenario, seed, seconds))
      throw new Motion3dUsageError(`--clearance does not judge clip-driven arms, and a clip claims an arm in ${scenario.id}`)
    const maxSeconds = scenario.maxSeconds ?? 120
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > maxSeconds || Math.round(seconds * 60) < 1)
      throw new Motion3dUsageError(`--seconds must be positive, at most ${maxSeconds} for ${scenario.id}, and include at least one 60 Hz frame`)
    if (!Number.isFinite(warmupSeconds) || warmupSeconds < 0 || warmupSeconds > 120)
      throw new Motion3dUsageError('--warmup must be between 0 and 120 seconds')
    const acts = (['on', 'off'] as const).find(value => value === values.acts)
    if (!acts)
      throw new Motion3dUsageError('--acts must be on or off')
    const walkStyle = values['walk-style'] === undefined ? null : parseWalkStyle(values['walk-style'])
    const mood = values.mood === undefined ? null : parseMood(values.mood)
    const energy = values.energy === undefined ? null : values.energy.trim() === '' ? Number.NaN : Number(values.energy)
    if (energy !== null && (!(energy >= 0) || !(energy <= 1)))
      throw new Motion3dUsageError('--energy must lie in [0, 1]')
    const pep = values.pep === undefined ? 0 : values.pep.trim() === '' ? Number.NaN : Number(values.pep)
    if (!(pep >= 0) || !(pep <= 1))
      throw new Motion3dUsageError('--pep must lie in [0, 1]')
    return { model, scenario, seed, seconds, warmupSeconds, out, verifyDeterminism: values['verify-determinism'], acts, walkStyle, mood, energy, pep, clearance: values.clearance }
  }
  catch (error) {
    if (error instanceof Motion3dUsageError)
      throw error
    throw new Motion3dUsageError(errorMessageFrom(error) ?? 'invalid run arguments', { cause: error })
  }
}
