import { accessSync, constants, existsSync, statSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'

import { motion3dScenarios } from '../scenarios'

export class Motion3dUsageError extends Error {
  override readonly name = 'Motion3dUsageError'
}

/** Parses user inputs once, before taking a lease or creating evidence. */
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
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120 || Math.round(seconds * 60) < 1)
      throw new Motion3dUsageError('--seconds must be positive, at most 120, and include at least one 60 Hz frame')
    if (!Number.isFinite(warmupSeconds) || warmupSeconds < 0 || warmupSeconds > 120)
      throw new Motion3dUsageError('--warmup must be between 0 and 120 seconds')
    return { model, scenario, seed, seconds, warmupSeconds, out, verifyDeterminism: values['verify-determinism'] }
  }
  catch (error) {
    if (error instanceof Motion3dUsageError)
      throw error
    throw new Motion3dUsageError(errorMessageFrom(error) ?? 'invalid run arguments', { cause: error })
  }
}
