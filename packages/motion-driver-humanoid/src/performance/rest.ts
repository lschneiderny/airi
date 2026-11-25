import type { BodySide } from './channels'
import type { BodyRest } from './contracts'
import type { LayerOutput, PerformanceContext, PerformanceLayer, PerformanceModulation, PerformancePlan } from './stack'

import { minJerk } from '../dynamics'
import { deriveSeed, gaussian } from '../noise'
import { createRandomStream } from '../random'
import { ARM_START, BODY_CHANNELS, CHANNEL_GROUPS, channelIndex, DEG, freeShare, SIDES } from './channels'

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

const c = channelIndex

/**
 * Architecture 4f's clip-free long states, entered and left over its 1.5 s ramp. Rest: the support goes fully to one
 * side, the torso lower +3, the clavicles -2 and the head +3 deg; breath depth 1.3, sway 1.4, tempo 0.6. Doze: the
 * pelvis drops 0.012 L and the torso lower +3; the head sinks to +18 over 4 to 9 s, recovers in 0.35 s with a 3 deg
 * overshoot up, settles, then pauses 9 to 25 s (lognormal); breath depth 1.5, sway 1.5, tempo 0.5. 4b's nod shares
 * split the head (0.7) and neck (0.3), and the torso mid follows at 0.12. The rest's pelvis lateral gain is 1.25: the
 * pelvis goes a quarter further over the stance foot than the posture takes it for the support it carries.
 *
 * The hands are clasped low in front (the gesture layer's two-hand `clasp` at 6.3's front-low anchor, act 6's) or
 * hang, chosen per rest by the seed, one in two; a rig whose arms cannot reach the anchor keeps them hanging (6.3). A
 * foot re-plant while she rests moves her to the other leg (`side` follows the full-weight support another act-order
 * layer plans), so over a long rest she changes legs.
 *
 * The rest's tension is 0.2 and the doze's 0.1 on 4c's K scale (`followerK`), which the arm followers read as an
 * offset from the neutral 0.40, so her arms hang looser while she rests and looser still while she dozes.
 */
const REST = { ramp: 1.5, lower: 3, clavicle: -2, head: 3, breath: 1.3, sway: 1.4, tempo: 0.6, lateralGain: 1.25, clasped: 0.5, tension: 0.2 } as const
const DOZE = { lower: 3, pelvis: 0.012, sink: [4, 9], head: 18, recovery: 0.35, overshoot: 3, settle: 1.3, pause: [9, 25], breath: 1.5, sway: 1.5, tempo: 0.5, tension: 0.1 } as const
const NOD = { head: 0.7, neck: 0.3, mid: 0.12 } as const
/**
 * What the stand-life passes add to 4f, so a rest or a doze reads apart from standing in one still, from the front
 * (stand-life audit ranks 8 and 3). Both round the chest (`mid` and `upper` pitch, degrees), bring the shoulders
 * forward (`protraction`) and let the hanging arms go heavy: the upper arms roll in (`twist`) and the elbows let go of
 * their bend (`elbow`), so the backs of the hands come round to the front. The shoulders drop no further than 4f's -2:
 * below it the clavicle's joint limit softens the drop to a degree and stills the breath the shoulders carry.
 * The rest tilts the head toward the stance side (`headRoll`) and adds to 4f's head drop (`head`); the doze droops the
 * head between nods (`head`), sinks the pelvis further on softer knees (`pelvis`, leg lengths on 4f's) and its knees
 * give with each sink and catch it (`nodPelvis`, leg lengths at the full sink, with `nodUpper` of the nod in the upper
 * chest and `nodLower` in the lower trunk). The rest keeps 4f's pelvis over the stance foot: a further free-hip drop
 * raised the stance hip past the reach of a narrow-stanced rig's straight stance leg. The sizes are the layer's: the
 * first pass's (chest 3.5 degrees, shoulders forward 3, no arm release) still left a front still of the rest reading
 * as standing.
 */
const SETTLED = {
  rest: { mid: 3.5, upper: 2.5, protraction: 6, twist: 6, elbow: -5, head: 2, headRoll: 4 },
  doze: { mid: 3.5, upper: 2.5, protraction: 6, twist: 8, elbow: -6, head: 5, pelvis: 0.002, nodPelvis: 0.006, nodUpper: 0.08, nodLower: 0.06 },
} as const
/**
 * The order of the settling: each part's share of the pose rises over `[delay, seconds]` from the start of a rest or
 * doze, under the stack's 1.5 s ramp, so the pelvis settles first, the chest rolls down after it and the head dips
 * last. On waking the trunk lets go over `wake` seconds, faster than the stack's ramp that the head keeps, so her chest
 * is up before her head and gaze have come back. A doze entered from a rest starts settled.
 */
const STAGES = { pelvis: [0, 0.8], chest: [0.3, 1.2], head: [0.7, 1.5], wake: 0.8 } as const
type Stage = 'pelvis' | 'chest' | 'head'
const STAGE_OF: Partial<Record<number, Stage>> = {}
for (const channel of ['pelvisX', 'pelvisY', 'pelvisZ', 'hipsRoll', 'lowerPitch', 'leftFootPitch', 'rightFootPitch'] as const)
  STAGE_OF[c(channel)] = 'pelvis'
for (const channel of ['midPitch', 'upperPitch', 'leftClavElev', 'leftClavProt', 'rightClavElev', 'rightClavProt', 'leftTwist', 'rightTwist', 'leftElbow', 'rightElbow'] as const)
  STAGE_OF[c(channel)] = 'chest'
for (const channel of ['neckPitch', 'headPitch', 'neckRoll', 'headRoll'] as const)
  STAGE_OF[c(channel)] = 'head'

/** The share of `stage` shown `age` seconds into a rest (`STAGES`); 1 for a layer that started settled. */
export function settledShare(stage: Stage, age: number): number {
  const [delay, seconds] = STAGES[stage]
  return minJerk(Math.max(0, Math.min(1, (age - delay) / seconds)))
}

/** The trunk's share left `since` seconds after the wake (`STAGES.wake`); the head keeps the stack's ramp. */
export function wakingTrunkShare(since: number): number {
  return 1 - minJerk(Math.max(0, Math.min(1, since / STAGES.wake)))
}

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
  let clasped = false
  /** Whether this episode settles in stages (`STAGES`): not when it follows another one still shown. */
  let staged = true
  let nods: { at: number, sink: number }[] = []
  let tick = -1

  /** One arm's share of the settled shoulders, and of the heavy hang (`SETTLED`) when the hand hangs. */
  function settleArm(arm: BodySide, clavicle: number, settled: { protraction: number, twist: number, elbow: number }, hanging: boolean) {
    const start = ARM_START[arm]
    channels[start] = clavicle * DEG
    channels[start + 1] = settled.protraction * DEG
    if (hanging) {
      channels[start + 4] = settled.twist * DEG
      channels[start + 5] = settled.elbow * DEG
    }
  }

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
        staged = shown === null
        shown = rest
        since = time
        side = random() < 0.5 ? -1 : 1
        nods = rest === 'doze' ? planNods(random) : []
        // The hands come from a stream of their own, so the side and nod draws keep their order.
        clasped = rest === 'rest' && createRandomStream(deriveSeed(options.seed, 400 + episodes))() < REST.clasped
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
    const { legIk } = context.traits
    const support = context.previous.support
    if (shown === 'rest') {
      const settled = SETTLED.rest
      channels[c('lowerPitch')] = REST.lower * DEG
      channels[c('midPitch')] = settled.mid * DEG
      channels[c('upperPitch')] = settled.upper * DEG
      // The head drops and tilts toward the leg she stands on (positive support is the right foot).
      const toward = Math.sign(support)
      channels[c('headPitch')] = 0.65 * (REST.head + settled.head) * DEG
      channels[c('neckPitch')] = 0.35 * (REST.head + settled.head) * DEG
      channels[c('headRoll')] = 0.65 * toward * settled.headRoll * DEG
      channels[c('neckRoll')] = 0.35 * toward * settled.headRoll * DEG
      for (const arm of SIDES)
        settleArm(arm, REST.clavicle, settled, !clasped)
      // The posture's lateral gain (`posture.ts`), scaled to 4f's 1.25 by the remaining quarter.
      const { feet, legLength } = context.traits
      if (legIk)
        channels[c('pelvisX')] = -(REST.lateralGain - 1) * 0.38 * Math.abs(feet.left.ankle.x - feet.right.ankle.x) / (2 * legLength) * support
      if (state === 'rest' && free('lowerBody') && free('upperBody'))
        plan.support = side
      if (state === 'rest' && clasped)
        plan.armForm = { side: 'both', form: 'clasp' }
      modulation.tempo = REST.tempo
      modulation.amplitude = REST.sway
      modulation.breath = REST.breath
      modulation.followerK = REST.tension
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
      const settled = SETTLED.doze
      // The head rests forward between nods; a nod's sink takes the chest and the knees with it, and its catch
      // straightens them, so the knees do not hold one bend through a long nod.
      const sunk = Math.max(0, pitch) / DOZE.head
      channels[c('headPitch')] = NOD.head * (pitch + settled.head) * DEG
      channels[c('neckPitch')] = NOD.neck * (pitch + settled.head) * DEG
      channels[c('midPitch')] = (NOD.mid * pitch + settled.mid) * DEG
      channels[c('upperPitch')] = (settled.nodUpper * pitch + settled.upper) * DEG
      channels[c('lowerPitch')] = DOZE.lower * DEG
      channels[c('pelvisY')] = -DOZE.pelvis - settled.pelvis - (legIk ? settled.nodPelvis * sunk : 0)
      channels[c('lowerPitch')] += settled.nodLower * pitch * DEG
      for (const arm of SIDES)
        settleArm(arm, 0, settled, true)
      modulation.tempo = DOZE.tempo
      modulation.amplitude = DOZE.sway
      modulation.breath = DOZE.breath
      modulation.followerK = DOZE.tension
    }
    output.modulation = modulation
    const waking = state === 'none' ? wakingTrunkShare(time - endedAt) : 1
    for (let channel = 0; channel < channels.length; channel++) {
      const stage = STAGE_OF[channel]
      const share = stage === undefined ? 1 : (staged ? settledShare(stage, age) : 1) * (stage === 'head' ? 1 : waking)
      channels[channel] *= share * freeShare(input.owned[CHANNEL_GROUPS[channel]])
    }
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
      // A later act-order layer that plans her full weight onto a foot (the act layer's re-plant while she rests) moves
      // the rest to that leg; the merged plan is complete by the time layers step.
      const planned = context.plan.support
      if (state === 'rest' && (planned === 1 || planned === -1))
        side = planned
      output.weight = state === 'none' ? 0 : 1
      output.sequence = episodes
      return output
    },
    reset() {
      state = 'none'
      shown = null
      staged = true
      episodes = 0
      clasped = false
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
