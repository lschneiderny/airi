import type { Band, CatalogEntry, PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'
import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { argv, cwd, exit, stderr, stdout } from 'node:process'
import { parseArgs } from 'node:util'

import { errorMessageFrom } from '@moeru/std'
import { PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'
import { buildEmotionTrial } from '@proj-airi/stage-shared/motion-scenario'

import { loadQaEnv } from '../src/env/load'
import { T2SetupError } from '../src/t2/errors'
import { loadT2Runtime, runT2 } from '../src/t2/runner'
import { measureRigScreenProfile, ScreenMotionRecorder } from '../src/t2/screen-motion'

loadQaEnv(join(import.meta.dirname, '../../..'))

const bands: readonly Band[] = ['slight', 'clear', 'strong']

const usage = `Usage: pnpm qa:live2d-rig [--emotion angry] [--band strong] [--seed 1] [--out <trace.json>]
       pnpm qa:live2d-rig --idle <seconds> [--rig <folder>] [--pep 0] [--hz 60] [--seed 1] [--out <trace.json>]

Runs one 10 s emotion trial (4 s idle, a 2 s hold, 4 s after) through the Natural driver on the local ForBOOTH
rig and Cubism Core in Node, without the app or a GPU. Reads AIRI_QA_RIG_FORBOOTH and AIRI_QA_CUBISM_CORE.
Prints a JSON summary: samples, moving channels, the trace sha256, and the speed multiple. --out writes the trace.

--idle runs Natural's idle for that many seconds (30 to 3600) instead, deforms the mesh every frame, and prints how
the picture moved, in % of model height: the head's moves per minute and their sizes, how fast and how jerkily the
drawn parts move, and how far each posture channel can move the picture on this rig. --rig measures another rig
folder, --pep sets the character's pep (0 to 1), and --hz steps the model at another frame rate (30 to 240).
Exit codes: 0 the rig ran, 1 the run broke, 2 invalid arguments or a missing rig or core.
`

/** Idle seconds left out of the picture summary: the rig's physics settles from its rest pose. */
const idleSettleSeconds = 5

const catalog = JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/forbooth-catalog.json'), 'utf8')) as CatalogEntry[]

class UsageError extends Error {}

function parseOptions() {
  let values: { emotion?: string, band?: string, seed?: string, out?: string, idle?: string, rig?: string, pep?: string, hz?: string, help?: boolean }
  try {
    values = parseArgs({
      args: argv.slice(2),
      options: {
        emotion: { type: 'string', default: 'angry' },
        band: { type: 'string', default: 'strong' },
        seed: { type: 'string', default: '1' },
        out: { type: 'string' },
        idle: { type: 'string' },
        rig: { type: 'string' },
        pep: { type: 'string', default: '0' },
        hz: { type: 'string', default: '60' },
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
  const numberIn = (flag: string, text: string | undefined, min: number, max: number) => {
    const value = Number(text)
    if (text === undefined || text.trim() === '' || !Number.isFinite(value) || value < min || value > max)
      throw new UsageError(`--${flag} must be a number from ${min} to ${max}, got ${JSON.stringify(text)}`)
    return value
  }
  const idle = values.idle === undefined ? undefined : numberIn('idle', values.idle, 30, 3600)
  const pep = numberIn('pep', values.pep, 0, 1)
  const hz = numberIn('hz', values.hz, 30, 240)
  if (idle === undefined && (values.rig !== undefined || pep !== 0 || hz !== 60))
    throw new UsageError('--rig, --pep and --hz need --idle; the emotion trial runs ForBOOTH at pep 0 and 60 Hz')
  return { emotion: emotion satisfies PerformanceEmotion, band, seed, out: values.out, idle, rig: values.rig, pep, hz, help: values.help ?? false }
}

/** Runs Natural's idle on a rig and prints how its picture moved. */
async function runIdle(options: ReturnType<typeof parseOptions> & { idle: number }): Promise<number> {
  const runtime = await loadT2Runtime(options.rig ? { rigRoot: resolve(cwd(), options.rig) } : {})
  const profile = measureRigScreenProfile(runtime)
  // The product home, as the stage runs it; the sink's default is the desk fixture of the liveliness gate.
  const scenario: MotionScenario = { version: 1, id: `idle-${options.idle}s`, seed: options.seed, durationSeconds: options.idle, home: 'product', levels: ['t2'], events: [] }
  const recorder = new ScreenMotionRecorder(profile, Math.round(options.idle * options.hz) + 1)
  const started = performance.now()
  const trace = runT2(scenario, runtime, { deform: true, pep: options.pep, hz: options.hz, afterFrame: drawables => recorder.sample(drawables) })
  const wallSeconds = (performance.now() - started) / 1000
  if (options.out)
    writeFileSync(resolve(cwd(), options.out), `${JSON.stringify(trace)}\n`)
  stdout.write(`${JSON.stringify({
    rig: basename(runtime.rig.modelJsonPath),
    seconds: options.idle,
    seed: options.seed,
    pep: options.pep,
    hz: options.hz,
    core: runtime.core,
    modelHeight: profile.modelHeight,
    drawables: profile.visible.length,
    headMarker: { parameter: profile.head.parameter, drawables: profile.head.drawables.length },
    ...recorder.summarize(options.hz, idleSettleSeconds),
    channels: profile.channels,
    wallSeconds,
    ...(options.out ? { trace: resolve(cwd(), options.out) } : {}),
  }, (_, value: unknown) => typeof value === 'number' ? Number(value.toFixed(3)) : value, 2)}\n`)
  return 0
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
  if (options.idle !== undefined)
    return runIdle({ ...options, idle: options.idle })
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
