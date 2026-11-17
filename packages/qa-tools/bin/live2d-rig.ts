import type { Band, CatalogEntry, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { argv, cwd, exit, stderr, stdout } from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'
import { buildEmotionTrial } from '@proj-airi/stage-shared/motion-scenario'

import { loadQaEnv } from '../src/env/load'
import { T2SetupError } from '../src/t2/errors'
import { loadT2Runtime, runT2 } from '../src/t2/runner'

loadQaEnv(join(import.meta.dirname, '../../..'))

const bands: readonly Band[] = ['slight', 'clear', 'strong']

const usage = `Usage: pnpm qa:live2d-rig [--emotion angry] [--band strong] [--seed 1] [--out <trace.json>]

Runs one 10 s emotion trial (4 s idle, a 2 s hold, 4 s after) through the Natural driver on the local ForBOOTH
rig and Cubism Core in Node, without the app or a GPU. Reads AIRI_QA_RIG_FORBOOTH and AIRI_QA_CUBISM_CORE.
Prints a JSON summary: samples, moving channels, the trace sha256, and the speed multiple. --out writes the trace.
Exit codes: 0 the rig ran, 1 the run broke, 2 invalid arguments or a missing rig or core.
`

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/forbooth-catalog.json'), 'utf8')) as CatalogEntry[]

class UsageError extends Error {}

function parseOptions() {
  let values: { emotion?: string, band?: string, seed?: string, out?: string, help?: boolean }
  try {
    values = parseArgs({
      args: argv.slice(2),
      options: {
        emotion: { type: 'string', default: 'angry' },
        band: { type: 'string', default: 'strong' },
        seed: { type: 'string', default: '1' },
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }).values
  }
  catch (error) {
    throw new UsageError(errorMessageFrom(error) ?? 'invalid arguments')
  }
  const emotion = PERFORMANCE_EMOTIONS.find(name => name === values.emotion)
  if (!emotion)
    throw new UsageError(`Unknown emotion ${JSON.stringify(values.emotion)}; known: ${PERFORMANCE_EMOTIONS.join(', ')}`)
  const band = bands.find(name => name === values.band)
  if (!band)
    throw new UsageError(`Unknown band ${JSON.stringify(values.band)}; known: ${bands.join(', ')}`)
  const seed = Number(values.seed)
  if (!Number.isInteger(seed) || seed < 1)
    throw new UsageError(`--seed must be a positive integer, got ${JSON.stringify(values.seed)}`)
  return { emotion: emotion satisfies PerformanceEmotion, band, seed, out: values.out, help: values.help ?? false }
}

async function main(): Promise<number> {
  let options: ReturnType<typeof parseOptions>
  try {
    options = parseOptions()
  }
  catch (error) {
    if (!(error instanceof UsageError))
      throw error
    stderr.write(`qa-tools live2d-rig: ${error.message}\n\n${usage}`)
    return 2
  }
  if (options.help) {
    stdout.write(usage)
    return 0
  }
  const runtime = await loadT2Runtime()
  const scenario = buildEmotionTrial({ emotion: options.emotion, band: options.band, variant: 'full', seed: options.seed, warmup: 4, hold: 2, post: 4 })
  const started = performance.now()
  const trace = runT2(scenario, runtime, { catalog })
  const wallSeconds = (performance.now() - started) / 1000
  const json = JSON.stringify(trace)
  if (options.out)
    writeFileSync(resolve(cwd(), options.out), `${json}\n`)
  const channels = Object.values(trace.channels)
  stdout.write(`${JSON.stringify({
    scenario: scenario.id,
    durationSeconds: scenario.durationSeconds,
    core: runtime.core,
    samples: trace.t.length,
    channels: channels.length,
    movingChannels: channels.filter(channel => Math.max(...channel) - Math.min(...channel) > 0).length,
    sha256: createHash('sha256').update(json).digest('hex'),
    wallSeconds,
    speedMultiple: scenario.durationSeconds / wallSeconds,
    ...(options.out ? { trace: resolve(cwd(), options.out) } : {}),
  }, null, 2)}\n`)
  return 0
}

main().then(exit, (error: unknown) => {
  stderr.write(`qa-tools live2d-rig: ${errorMessageFrom(error) ?? 'run failed'}\n`)
  exit(error instanceof T2SetupError ? error.exitCode : 1)
})
