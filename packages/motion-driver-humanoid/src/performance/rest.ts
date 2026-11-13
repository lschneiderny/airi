import type { BodyRest } from './contracts'
import type { LayerOutput, PerformanceContext, PerformanceLayer, PerformanceModulation, PerformancePlan } from './stack'

import { minJerk } from '../dynamics'
import { deriveSeed, gaussian } from '../noise'
import { createRandomStream } from '../random'
import { ARM_START, BODY_CHANNELS, channelGroup, channelIndex, DEG, SIDES } from './channels'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const c = channelIndex

/**
 * Architecture 4f's clip-free long states, entered and left over its 1.5 s ramp. Rest: the support goes fully to one
 * side, the torso lower +3, the clavicles -2 and the head +3 deg; breath depth 1.3, sway 1.4, tempo 0.6. Doze: the
 * pelvis drops 0.012 L and the torso lower +3; the head sinks to +18 over 4 to 9 s, recovers in 0.35 s with a 3 deg
 * overshoot up, settles, then pauses 9 to 25 s (lognormal); breath depth 1.5, sway 1.5, tempo 0.5. 4b's nod shares
 * split the head (0.7) and neck (0.3), and the torso mid follows at 0.12.
 */
const REST = { ramp: 1.5, lower: 3, clavicle: -2, head: 3, breath: 1.3, sway: 1.4, tempo: 0.6 } as const
const DOZE = { lower: 3, pelvis: 0.012, sink: [4, 9], head: 18, recovery: 0.35, overshoot: 3, settle: 1.3, pause: [9, 25], breath: 1.5, sway: 1.5, tempo: 0.5 } as const
const NOD = { head: 0.7, neck: 0.3, mid: 0.12 } as const

export interface RestLayerOptions {
  readonly seed: number
}

/**
 * Layer 4 of 3g, below the act layer: the procedural rest or doze the director chooses when Natural settles her in or
 * she falls asleep and the model has no sit or sleep clip (`directive.rest`). It decides nothing; without a rest
 * directive it stays at weight 0. The stack eases it in and out over 4f's 1.5 s.
 */
export function createRestLayer(options: RestLayerOptions): PerformanceLayer {
  const channels = new Float64Array(BODY_CHANNELS.length)
  const output: Mutable<LayerOutput> = { channels, weight: 0, sequence: 0 }
  const modulation: Mutable<PerformanceModulation> = { tempo: 1, amplitude: 1, breath: 1, sighSeq: 0 }
  let plan: Mutable<PerformancePlan> = {}
  let state: BodyRest = 'none'
  /** The state the layer still shows while it eases out. */
  let shown: Exclude<BodyRest, 'none'> | null = null
  let since = 0
  /** When the director's rest ended; the layer shows the state until its exit ramp has run. */
  let endedAt = 0
  let episodes = 0
  let side = 1
  let nods: { at: number, sink: number }[] = []
  let tick = -1

  function update(context: PerformanceContext) {
    if (context.tick === tick)
      return
    tick = context.tick
    const { input, time } = context
    const rest = input.directive.rest
    if (rest !== state) {
      state = rest
      endedAt = time
      if (rest !== 'none') {
        // Each rest or doze episode draws its own side or nod times from a stream of its own count.
        episodes++
        const random = createRandomStream(deriveSeed(options.seed, 300 + episodes))
        shown = rest
        since = time
        side = random() < 0.5 ? -1 : 1
        nods = rest === 'doze' ? planNods(random) : []
      }
    }
    channels.fill(0)
    plan = {}
    output.modulation = undefined
    // Its modulation would override an emotion's once the layer has eased out, so the state is let go then.
    if (state === 'none' && time - endedAt >= REST.ramp)
      shown = null
    if (!shown)
      return
    const age = time - since
    const free = (group: 'lowerBody' | 'upperBody') => input.owned[group] <= 0.5
    if (shown === 'rest') {
      channels[c('lowerPitch')] = REST.lower * DEG
      channels[c('headPitch')] = 0.65 * REST.head * DEG
      channels[c('neckPitch')] = 0.35 * REST.head * DEG
      for (const arm of SIDES)
        channels[ARM_START[arm]] = REST.clavicle * DEG
      if (state === 'rest' && free('lowerBody') && free('upperBody'))
        plan.support = side
      modulation.tempo = REST.tempo
      modulation.amplitude = REST.sway
      modulation.breath = REST.breath
    }
    else {
      let pitch = 0
      for (const nod of nods) {
        const local = age - nod.at
        if (local < 0 || local >= nod.sink + DOZE.recovery + DOZE.settle)
          continue
        if (local < nod.sink)
          pitch = DOZE.head * minJerk(local / nod.sink)
        else if (local < nod.sink + DOZE.recovery)
          pitch = DOZE.head + (-DOZE.overshoot - DOZE.head) * minJerk((local - nod.sink) / DOZE.recovery)
        else
          pitch = -DOZE.overshoot * (1 - minJerk((local - nod.sink - DOZE.recovery) / DOZE.settle))
      }
      channels[c('headPitch')] = NOD.head * pitch * DEG
      channels[c('neckPitch')] = NOD.neck * pitch * DEG
      channels[c('midPitch')] = NOD.mid * pitch * DEG
      channels[c('lowerPitch')] = DOZE.lower * DEG
      channels[c('pelvisY')] = -DOZE.pelvis
      modulation.tempo = DOZE.tempo
      modulation.amplitude = DOZE.sway
      modulation.breath = DOZE.breath
    }
    output.modulation = modulation
    for (let channel = 0; channel < channels.length; channel++)
      channels[channel] *= Math.max(0, Math.min(1, 1 - 2 * input.owned[channelGroup(BODY_CHANNELS[channel])]))
  }

  return {
    id: 'rest',
    order: 'act',
    mode: 'additive',
    mask: new Float64Array(BODY_CHANNELS.length).fill(1),
    enterSeconds: REST.ramp,
    exitSeconds: REST.ramp,
    plan(context: PerformanceContext) {
      update(context)
      return plan
    },
    step(context: PerformanceContext) {
      update(context)
      output.weight = state === 'none' ? 0 : 1
      output.sequence = episodes
      return output
    },
    reset() {
      state = 'none'
      shown = null
      episodes = 0
      nods = []
      tick = -1
      plan = {}
      channels.fill(0)
      output.modulation = undefined
    },
  }
}

/** An hour of 4f's nod-off cycles from the first sink, which starts after the 1.5 s entry. */
function planNods(random: () => number): { at: number, sink: number }[] {
  const nods: { at: number, sink: number }[] = []
  let at = REST.ramp
  while (at < 3600) {
    const sink = DOZE.sink[0] + (DOZE.sink[1] - DOZE.sink[0]) * random()
    nods.push({ at, sink })
    // Lognormal inside 4f's 9 to 25 s: the range's geometric middle (15 s) as median and a quarter of its log width as
    // the spread, so the range spans two spreads either side; clamped to it.
    const pause = Math.max(DOZE.pause[0], Math.min(DOZE.pause[1], Math.exp(Math.log(Math.sqrt(DOZE.pause[0] * DOZE.pause[1])) + Math.log(DOZE.pause[1] / DOZE.pause[0]) / 4 * gaussian(random))))
    at += sink + DOZE.recovery + DOZE.settle + pause
  }
  return nods
}
