import { extname, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { parse, picklist } from 'valibot'

export class AppUsageError extends Error {}

export function parseAppArgs(argv: readonly string[], cwd: string) {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      'model': { type: 'string' },
      'kind': { type: 'string' },
      'say': { type: 'string', multiple: true },
      'script': { type: 'string' },
      'set': { type: 'string' },
      'expect': { type: 'string', default: 'turn' },
      'timeout': { type: 'string', default: '60' },
      'out': { type: 'string' },
      'keep-open': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  })
  if (positionals.length !== 1 || positionals[0] !== 'run' || !values.model?.trim() || !values.say?.length)
    throw new AppUsageError('Usage: pnpm qa:app run --model <path> --say <text> [--say <text>] [--kind live2d|mmd|vrm] [--script file|--set id] [--expect act,tts] [--timeout seconds] [--out dir] [--keep-open] [--dry-run]')
  if (values.script !== undefined && values.set !== undefined)
    throw new AppUsageError('--script and --set are mutually exclusive')
  for (const value of [...values.say, values.script, values.set, values.out]) {
    if (value !== undefined && !value.trim())
      throw new AppUsageError('Text and paths must not be empty')
  }
  const timeout = Number(values.timeout)
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 3600)
    throw new AppUsageError('--timeout must be greater than zero and at most 3600 seconds')
  const extension = extname(values.model).toLowerCase()
  const inferred = extension === '.vrm' ? 'vrm' : ['.pmx', '.pmd'].includes(extension) ? 'mmd' : 'live2d'
  const kind = parse(picklist(['live2d', 'mmd', 'vrm']), values.kind ?? inferred)
  const expect = [...new Set(values.expect.split(',').map(kind => parse(picklist(['act', 'expression', 'clip', 'tts', 'turn']), kind.trim())))]
  return {
    model: resolve(cwd, values.model),
    kind,
    say: values.say,
    script: values.script ? resolve(cwd, values.script) : undefined,
    set: values.set,
    expect,
    timeoutMs: timeout * 1000,
    out: values.out ? resolve(cwd, values.out) : undefined,
    keepOpen: values['keep-open'],
    dryRun: values['dry-run'],
  }
}

export type AppOptions = ReturnType<typeof parseAppArgs>
