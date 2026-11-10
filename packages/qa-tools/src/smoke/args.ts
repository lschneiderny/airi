import { extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { parse, picklist } from 'valibot'

export class SmokeUsageError extends Error {}

export const smokeUsage = 'Usage: pnpm qa:smoke [--model <path>] [--kind live2d|mmd|vrm] [--stage-host window|desktop] [--expect-host window|desktop] [--xwayland] [--electron-arg=<switch>...] [--settle <seconds>] [--allow <json>] [--out <dir>]'

export function parseSmokeArgs(argv: readonly string[], cwd: string) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      'model': { type: 'string' },
      'kind': { type: 'string' },
      'stage-host': { type: 'string', default: 'window' },
      'expect-host': { type: 'string' },
      'xwayland': { type: 'boolean', default: false },
      'electron-arg': { type: 'string', multiple: true, default: [] },
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
  // A platform that gates the desktop stage keeps the classic window; `--expect-host window` makes that the pass.
  const expectHost = parse(picklist(['window', 'desktop']), values['expect-host'] ?? stageHost)
  if (expectHost === 'desktop' && stageHost !== 'desktop')
    throw new SmokeUsageError('--expect-host desktop needs --stage-host desktop')
  const electronArgs = values['electron-arg']
  if (electronArgs.some(arg => !/^--[a-z0-9]/i.test(arg)))
    throw new SmokeUsageError('--electron-arg takes one Chromium or Electron switch, written --electron-arg=--<switch>')
  return {
    model: values.model ? resolve(cwd, values.model) : undefined,
    kind,
    stageHost,
    expectHost,
    xwayland: values.xwayland,
    electronArgs,
    settleMs: settle * 1000,
    allow: values.allow ? resolve(cwd, values.allow) : undefined,
    out: values.out ? resolve(cwd, values.out) : undefined,
  }
}

export type SmokeOptions = ReturnType<typeof parseSmokeArgs>
