/// <reference types="node" />
import type { Live2DNaturalMotionAttention } from '../src/composables/live2d/natural-motion-adapter'

import process from 'node:process'

import { Live2DNaturalMotionAdapter } from '../src/composables/live2d/natural-motion-adapter'
import { readLive2DRigProfile } from '../src/composables/live2d/natural-motion/rig-profile'
import { naturalTraceParameterIds } from '../src/composables/live2d/natural-motion/trace'

/**
 * Natural frame-cost micro-benchmark: `frames` adapter compositions (each one `advance` plus
 * posture and face composition) on a stub Cubism core at 60 Hz, idle, no observer.
 * Prints the median of `runs` timed runs after three untimed warm-up runs, as wall time and as process
 * CPU time. Not a test: compare the medians before and after a runtime change on the same machine; on a
 * loaded machine compare CPU time, which excludes the time the process waits for a core. Under
 * `--expose-gc` every timed run starts from a collected heap, which keeps garbage from earlier runs out of the timing.
 *
 * Usage, from this package: node --expose-gc --import tsx scripts/bench-natural.ts [--frames 10000] [--runs 5]
 */
function option(name: string, fallback: number) {
  const index = process.argv.indexOf(name)
  const value = index < 0 ? fallback : Number(process.argv[index + 1])
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`)
  return value
}

const frames = option('--frames', 10_000)
const runs = option('--runs', 5)

/** Rig ranges as [default, minimum, maximum], shaped like common Cubism rigs. */
function range(id: string): [number, number, number] {
  if (id.startsWith('ParamAngle'))
    return [0, -30, 30]
  if (id.startsWith('ParamBodyAngle'))
    return [0, -10, 10]
  if (/Open|Smile|Cheek|Breath/.test(id))
    return [/EyeLOpen|EyeROpen/.test(id) ? 1 : 0, 0, 1]
  return [0, -1, 1]
}

function stubModel() {
  const ids = [...naturalTraceParameterIds]
  const parameters = {
    ids,
    defaultValues: new Float32Array(ids.map(id => range(id)[0])),
    minimumValues: new Float32Array(ids.map(id => range(id)[1])),
    maximumValues: new Float32Array(ids.map(id => range(id)[2])),
  }
  const values = new Float32Array(parameters.defaultValues)
  const model = {
    coreModel: {
      getParameterValueByIndex: (index: number) => values[index],
      setParameterValueByIndex: (index: number, value: number) => {
        values[index] = value
      },
    },
    updateFocus: () => {},
  }
  return { model, profile: readLive2DRigProfile(parameters, undefined) }
}

const attention: Live2DNaturalMotionAttention = {
  driver: 'natural',
  manualActive: false,
  springActive: false,
  exclusive: false,
  performance: { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' },
  energy: 0.5,
  voice: { speaking: false, level: 0, speechEndedAtSeconds: null },
  autoBlink: true,
  manualBreathActive: false,
  clipOwnedIds: new Set<string>(),
  pendingEmotions: [],
  heldEmotion: null,
  emotionStrengths: {},
  cursor: null,
  cursorDismissed: false,
  placement: null,
  chat: null,
  pendingPokes: [],
  pet: null,
}

function run() {
  const { model, profile } = stubModel()
  const adapter = new Live2DNaturalMotionAdapter(model, profile, () => attention, undefined, () => 0.5)
  const started = performance.now()
  const cpuStarted = process.cpuUsage()
  for (let frame = 0; frame < frames; frame++) {
    adapter.frame(frame / 60)
    model.updateFocus()
  }
  const cpu = process.cpuUsage(cpuStarted)
  const wall = performance.now() - started
  adapter.dispose()
  return { wall, cpu: (cpu.user + cpu.system) / 1000 }
}

for (let warmUp = 0; warmUp < 3; warmUp++)
  run()
const gc = (globalThis as { gc?: () => void }).gc
const timings = Array.from({ length: runs }, () => {
  gc?.()
  return run()
})
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const round = (value: number) => Number(value.toFixed(3))
const wall = timings.map(timing => timing.wall)
const cpu = timings.map(timing => timing.cpu)
process.stdout.write(`${JSON.stringify({
  frames,
  runs,
  medianMs: round(median(wall)),
  cpuMedianMs: round(median(cpu)),
  usPerFrame: round(median(wall) * 1000 / frames),
  timingsMs: wall.map(round),
  cpuTimingsMs: cpu.map(round),
})}\n`)
