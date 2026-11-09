import { extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { parse, picklist } from 'valibot'

export class SmokeUsageError extends Error {}

export const smokeUsage = 'Usage: pnpm qa:smoke [--model <path>] [--kind live2d|mmd|vrm] [--settle <seconds>] [--allow <json>] [--out <dir>]'

export function parseSmokeArgs(argv: readonly string[], cwd: string) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      model: { type: 'string' },
      kind: { type: 'string' },
      settle: { type: 'string', default: '20' },
      allow: { type: 'string' },
      out: { type: 'string' },
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
  return {
    model: values.model ? resolve(cwd, values.model) : undefined,
    kind: parse(picklist(['live2d', 'mmd', 'vrm']), values.kind ?? inferred),
    settleMs: settle * 1000,
    allow: values.allow ? resolve(cwd, values.allow) : undefined,
    out: values.out ? resolve(cwd, values.out) : undefined,
  }
}

export type SmokeOptions = ReturnType<typeof parseSmokeArgs>
