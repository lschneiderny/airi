import type { BodyCueKind, BodyCueReport, BodyPerformanceInput } from './contracts'
import type { PerformanceContext, PerformanceLayer, PerformancePlan } from './stack'

import { createLagChain, minJerk } from '../dynamics'
import { ARM_START, BODY_CHANNELS, BODY_TICK, channelGroup, channelIndex, DEG, SIDES } from './channels'

/**
 * Multiples of architecture 4b's below-neck terms; head terms keep Natural's amplitude. Nod and shake are head
 * gestures with a trunk echo, the glance's trunk follows its head at three times 3a's head-attitude share, and the
 * shrug and lean are 4b as written (lead ruling R5; sizes in `E/g3/b/amplitude-sources.md`).
 */
export const CUE_SCALES: Readonly<Record<BodyCueKind, number>> = { nod: 4, shake: 4, glance: 3, shrug: 1, lean: 1 }

/** One Natural nod dip (`cue-gestures.ts`): 0.45 s, 6.6 deg (0.22 x 30), 0.8 of the previous dip. */
const NOD = { dip: 0.45, degrees: 6.6, decay: 0.8 }
/** Natural's shake: 0.5 s per count at 2 Hz, 7.5 deg (0.25 x 30) under a raised-cosine window. */
const SHAKE = { count: 0.5, hz: 2, degrees: 7.5 }
/** 3a head-attitude chain: the upper torso takes 0.25 of a held head yaw through one 250 ms link. */
const GLANCE_LINK = { share: 0.25, delay: 0.25 }

const c = channelIndex
const raisedCosine = (u: number) => u <= 0 || u >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * u)

/** Piecewise minimum-jerk path through `[time, value]` knots, starting at 0; every knot has zero velocity. */
function path(t: number, knots: readonly (readonly [number, number])[]): number {
  let from: readonly [number, number] = [0, 0]
  for (const knot of knots) {
    if (t < knot[0])
      return from[1] + (knot[1] - from[1]) * minJerk((t - from[0]) / (knot[0] - from[0]))
    from = knot
  }
  return from[1]
}

/** 4b nod, head and neck together, positive down: a 1 deg lift for 80 ms before the first dip, an 8 % rebound after each. */
function nod(age: number, count: number): number {
  if (age <= 0 || age >= NOD.dip * count)
    return 0
  const dip = Math.floor(age / NOD.dip)
  const a = age - dip * NOD.dip
  const depth = NOD.degrees * NOD.decay ** dip
  const down: readonly (readonly [number, number])[] = dip === 0 ? [[0.08, -1], [0.2, depth]] : [[0.2, depth]]
  return path(a, [...down, [0.38, -0.08 * depth], [NOD.dip, 0]])
}

/** Natural's shake toward `side`, with no anticipation (Unit B test list; architecture 9.2). */
function shake(age: number, count: number, side: number): number {
  return side * SHAKE.degrees * raisedCosine(age / (SHAKE.count * count)) * Math.sin(2 * Math.PI * SHAKE.hz * age)
}

/** Natural's shrug timing (rise 0.25 s, held to 0.65 s, fall 0.45 s). */
function shrugEnvelope(age: number): number {
  return age < 0.65 ? minJerk(age / 0.25) : 1 - minJerk((age - 0.65) / 0.45)
}

/** 4b shrug clavicle: dips 1.5 deg for 70 ms, rises to `peak`, holds, falls through a 1 deg undershoot. */
function shrugClavicle(age: number, peak: number): number {
  return age <= 0 ? 0 : path(age, [[0.07, -1.5], [0.32, peak], [0.65, peak], [1, -1], [1.1, 0]])
}

/** Natural's lean timing (rise 0.3 s, held to 2.3 s, fall 0.3 s). */
function leanEnvelope(age: number): number {
  return age < 2.3 ? minJerk(age / 0.3) : 1 - minJerk((age - 2.3) / 0.3)
}

interface Clip {
  readonly kind: BodyCueKind
  readonly count: number
  readonly side: number
  readonly start: number
  readonly duration: number
  readonly gaze: { readonly yaw: number, readonly pitch: number }
  readonly headYaw: number
  readonly link: ReturnType<typeof createLagChain> | null
}

/** Seconds after a clip starts until every term, including its lags and the glance link's settle, is back at zero. */
function clipSeconds(clip: Clip): number {
  switch (clip.kind) {
    case 'nod': return NOD.dip * clip.count + 0.12
    case 'shake': return SHAKE.count * clip.count + 0.09
    case 'shrug': return 1.1 + 0.04
    case 'lean': return 2.6
    case 'glance': return 2 * clip.duration + 1.5
  }
}

/**
 * Layer 6 of 3g: architecture 4b's whole-body realisations of Natural's cue gestures. The layer plays the nod and the
 * shake on the head itself (Natural's period and amplitude, with the nod's anticipation) and asks the posture to drop
 * Natural's head cue through `plan.suppressHeadCue`. The lean forces the support and the glance plans the gaze for the
 * cue's duration. All terms are additive (the shrug adds to whatever the arms do); owned groups receive no term.
 */
export function createCueLayer(): PerformanceLayer {
  const channels = new Float64Array(BODY_CHANNELS.length)
  const report: BodyCueReport & { seq: number, kind: BodyCueKind | null } = { seq: 0, kind: null }
  let clips: Clip[] = []
  let cueSeq: number | null = null
  let time = 0

  function admit(context: PerformanceContext) {
    const cue = context.input.events.cue
    const seq = cue?.seq ?? 0
    // The first tick only latches: a record that predates this layer (a reset performer) is not replayed.
    if (cueSeq !== null && cue && seq !== cueSeq) {
      const previous = context.previous.channels
      clips.push({
        kind: cue.kind,
        count: cue.count,
        side: cue.side < 0 ? -1 : 1,
        start: time,
        duration: Math.max(0, cue.end - cue.start),
        gaze: { yaw: context.input.gaze.yaw, pitch: context.input.gaze.pitch },
        headYaw: previous[c('neckYaw')] + previous[c('headYaw')],
        link: cue.kind === 'glance' ? createLagChain([GLANCE_LINK.delay], BODY_TICK) : null,
      })
      report.seq++
      report.kind = cue.kind
    }
    cueSeq = seq
    clips = clips.filter(clip => time - clip.start <= clipSeconds(clip))
  }

  function play(clip: Clip, context: PerformanceContext) {
    const age = time - clip.start
    const scale = CUE_SCALES[clip.kind]
    switch (clip.kind) {
      case 'nod': {
        channels[c('headPitch')] += 0.7 * nod(age, clip.count) * DEG
        channels[c('neckPitch')] += 0.3 * nod(age - 0.03, clip.count) * DEG
        channels[c('midPitch')] += scale * 0.12 * nod(age - 0.07, clip.count) * DEG
        channels[c('lowerPitch')] += scale * 0.06 * nod(age - 0.12, clip.count) * DEG
        break
      }
      case 'shake': {
        const head = shake(age, clip.count, clip.side)
        channels[c('headYaw')] += 0.65 * head * DEG
        channels[c('neckYaw')] += 0.35 * shake(age - 0.025, clip.count, clip.side) * DEG
        channels[c('headRoll')] += 0.12 * head * DEG
        channels[c('upperYaw')] += scale * -0.08 * shake(age - 0.09, clip.count, clip.side) * DEG
        break
      }
      case 'shrug': {
        const envelope = shrugEnvelope(age)
        for (const side of SIDES) {
          const start = ARM_START[side]
          const own = (side === 'right') === (clip.side > 0)
          channels[start] += scale * (own ? shrugClavicle(age, 14) : shrugClavicle(age - 0.04, 11)) * DEG
          channels[start + 3] += scale * 6 * envelope * DEG
          channels[start + 5] += scale * 18 * envelope * DEG
          channels[start + 6] += scale * -50 * envelope * DEG
          channels[start + 7] += scale * -15 * envelope * DEG
        }
        channels[c('lowerPitch')] += scale * -1.5 * envelope * DEG
        break
      }
      case 'lean': {
        const envelope = leanEnvelope(age)
        channels[c('lowerRoll')] += scale * 3 * clip.side * envelope * DEG
        channels[c('lowerPitch')] += scale * 3 * envelope * DEG
        channels[c('midRoll')] += scale * 2 * clip.side * envelope * DEG
        channels[c('midPitch')] += scale * 2 * envelope * DEG
        break
      }
      case 'glance': {
        // The head's yaw change since the cue, faded out over one glance after the cue ends so the link settles on
        // zero instead of carrying the head's later wander.
        const previous = context.previous.channels
        const window = age < clip.duration ? 1 : 1 - minJerk((age - clip.duration) / clip.duration)
        const turn = previous[c('neckYaw')] + previous[c('headYaw')] - clip.headYaw
        channels[c('upperYaw')] += scale * GLANCE_LINK.share * (clip.link?.step(window * turn)[0] ?? 0)
        break
      }
    }
  }

  function free(input: BodyPerformanceInput, groups: readonly ('lowerBody' | 'upperBody')[]) {
    return groups.every(group => input.owned[group] <= 0.5)
  }

  return {
    id: 'cue',
    order: 'cue',
    mode: 'additive',
    mask: new Float64Array(BODY_CHANNELS.length).fill(1),
    // Every term starts at zero with zero slope, so the stack adds no entry ramp.
    enterSeconds: 0,
    plan(context: PerformanceContext): PerformancePlan {
      const plan: { support?: number, gaze?: PerformancePlan['gaze'], suppressHeadCue?: boolean } = {}
      for (const clip of clips) {
        const age = context.time - clip.start
        if ((clip.kind === 'nod' && age < NOD.dip * clip.count) || (clip.kind === 'shake' && age < SHAKE.count * clip.count))
          plan.suppressHeadCue = true
        if (clip.kind === 'lean' && age < clip.duration && free(context.input, ['lowerBody', 'upperBody']))
          plan.support = clip.side
        if (clip.kind === 'glance' && age < clip.duration)
          plan.gaze = { yaw: clip.gaze.yaw + clip.side * 14 * DEG, pitch: clip.gaze.pitch - 1 * DEG, kind: 'sustained' }
      }
      return plan
    },
    step(context: PerformanceContext) {
      time = context.time
      admit(context)
      channels.fill(0)
      for (const clip of clips)
        play(clip, context)
      if (clips.length) {
        for (let channel = 0; channel < channels.length; channel++)
          channels[channel] *= Math.max(0, Math.min(1, 1 - 2 * context.input.owned[channelGroup(BODY_CHANNELS[channel])]))
      }
      return { channels, weight: clips.length ? 1 : 0, sequence: 0, cue: report }
    },
    reset() {
      clips = []
      cueSeq = null
      time = 0
      Object.assign(report, { seq: 0, kind: null })
    },
  }
}
