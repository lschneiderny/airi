import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { ReplayError } from './script'

export function parseServeArgs(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      'script': { type: 'string' },
      'set': { type: 'string' },
      'run-key': { type: 'string' },
      'port': { type: 'string', default: '0' },
      'host': { type: 'string', default: '127.0.0.1' },
      'log': { type: 'string', default: '.temp/qa/llm-requests.jsonl' },
      'chunk-chars': { type: 'string', default: '16' },
      'delay-ms': { type: 'string', default: '0' },
    },
  })
  if (positionals.length !== 1 || positionals[0] !== 'serve')
    throw new ReplayError('Usage: pnpm qa:llm serve [--script file.json|jsonl | --set id [--run-key key]] [--port 0] [--host 127.0.0.1] [--log file.jsonl] [--chunk-chars N] [--delay-ms N]')
  if (values.script !== undefined && values.set !== undefined)
    throw new ReplayError('--script and --set are mutually exclusive')
  if (values['run-key'] !== undefined && values.set === undefined)
    throw new ReplayError('--run-key requires --set')
  for (const name of ['script', 'set', 'run-key', 'host', 'log'] as const) {
    if (values[name] !== undefined && !values[name]?.trim())
      throw new ReplayError(`--${name} must not be empty`)
  }
  const numbers = [
    ['port', values.port, 0, 65535],
    ['chunk-chars', values['chunk-chars'], 1, 1048576],
    ['delay-ms', values['delay-ms'], 0, 60000],
  ] as const
  for (const [name, value, min, max] of numbers) {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max)
      throw new ReplayError(`--${name} must be an integer from ${min} to ${max}`)
  }
  return {
    script: values.script ? resolve(values.script) : undefined,
    set: values.set,
    runKey: values['run-key'],
    port: Number(values.port),
    host: values.host,
    log: resolve(values.log),
    chunkChars: Number(values['chunk-chars']),
    delayMs: Number(values['delay-ms']),
  }
}
