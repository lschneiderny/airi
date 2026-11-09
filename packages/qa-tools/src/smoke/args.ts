import { extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { parse, picklist } from 'valibot'

export class SmokeUsageError extends Error {}

export const smokeUsage = 'Usage: pnpm qa:smoke [--model <path>] [--kind live2d|mmd|vrm] [--stage-host window|desktop] [--settle <seconds>] [--allow <json>] [--out <dir>]'

export function parseSmokeArgs(argv: readonly string[], cwd: string) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      'model': { type: 'string' },
      'kind': { type: 'string' },
      'stage-host': { type: 'string', default: 'window' },
      'settle': { type: 'string', default: '20' },
      'allow': { type: 'string' },
      'out': { type: 'string' },
    },
  })
  if (positionals.length)
    throw new SmokeUsageError(smokeUsage)
  for (const value of [values.model, values.allow, values.out]) {
    if (value !== undefined && !value.trim())
      throw new SmokeUsageError('Paths must not be empty')
  }
  if (values.kind !== undefined && values.model === undefined)
    throw new SmokeUsageError('--kind needs --model')
  const settle = Number(values.settle)
  if (!Number.isFinite(settle) || settle < 0 || settle > 600)
    throw new SmokeUsageError('--settle must be between 0 and 600 seconds')
  const extension = values.model ? extname(values.model).toLowerCase() : ''
  const inferred = extension === '.vrm' ? 'vrm' : ['.pmx', '.pmd'].includes(extension) ? 'mmd' : 'live2d'
  const kind = parse(picklist(['live2d', 'mmd', 'vrm']), values.kind ?? inferred)
  const stageHost = parse(picklist(['window', 'desktop']), values['stage-host'])
  // The desktop stage serves MMD models only; any other model would leave it at once.
  if (stageHost === 'desktop' && (values.model === undefined || kind !== 'mmd'))
    throw new SmokeUsageError('--stage-host desktop needs an MMD --model')
  return {
    model: values.model ? resolve(cwd, values.model) : undefined,
    kind,
    stageHost,
    settleMs: settle * 1000,
    allow: values.allow ? resolve(cwd, values.allow) : undefined,
    out: values.out ? resolve(cwd, values.out) : undefined,
  }
}

export type SmokeOptions = ReturnType<typeof parseSmokeArgs>
