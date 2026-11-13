import type { SecondOrderState } from '../dynamics'
import type { BodySide } from './channels'
import type { BodyReactionKind, BodyReactionReport } from './contracts'
import type { PerformanceContext, PerformanceLayer, PerformancePlan } from './stack'

import { advanceSecondOrder, createLagChain, minJerk, secondOrderCoefficients } from '../dynamics'
import { ARM_START, BODY_CHANNELS, BODY_TICK, CHANNEL_GROUPS, channelIndex, DEG, freeShare, SIDES } from './channels'

/** 4d flinch: a step through the 3a response at 3.5 Hz and damping 0.45, released after 0.25 s; it peaks near 80 ms and rings once. */
const FLINCH = { response: secondOrderCoefficients({ f: 3.5, zeta: 0.45, r: 0 }, BODY_TICK), release: 0.25 }
/** Natural's poke dedupe window (`touch.ts` `pokeSurpriseDedupeSeconds`): a poke this soon after the last flinches at 0.6. */
const REPEAT = { seconds: 2, scale: 0.6 }
/**
 * How long the trunk follows Natural's head pulse after a head poke: 15 of the longest poke nudge tau (`touch.ts`
 * `pokeNudgeTau.max` 0.18 s, `impulses.ts` `pulseLifetime`), then a fade so the link settles on zero.
 */
const HEAD_FOLLOW = { seconds: 15 * 0.18, fade: 0.5, share: 0.3, delay: 0.09 }
/** 4d pet: the trunk follows Natural's stroke-driven head rock at 0.35 (upper, 120 ms late) and 0.18 (mid, 220 ms late). */
const PET = { upper: { share: 0.35, delay: 0.12 }, mid: { share: 0.18, delay: 0.22 } }
const REST = 1e-6

const c = channelIndex

interface Flinch {
  readonly start: number
  readonly region: 'head' | 'body'
  readonly x: number
  readonly y: number
  readonly scale: number
  readonly state: SecondOrderState
}

/**
 * Layer 7 of 3g: architecture 4d's touch reactions on the body, additive. A body poke flinches the trunk, pelvis and the
 * poked side's shoulder and elbow away from the point; a head poke lets the upper torso follow Natural's head pulse
 * and lifts both shoulders. A pet relaxes the shoulders, leans toward the hand and lets the trunk follow Natural's
 * stroke rock. `x` runs from -1 to 1 the way Natural's touch does (Natural turns and rolls the head away from +x the
 * same way the trunk does here). Arm terms yield to an arm a gesture moves; owned groups receive no term.
 */
export function createReactionLayer(): PerformanceLayer {
  const channels = new Float64Array(BODY_CHANNELS.length)
  const report: BodyReactionReport & { seq: number, kind: BodyReactionKind | null } = { seq: 0, kind: null }
  let flinches: Flinch[] = []
  let pokeSeq: number | null = null
  let lastPoke = Number.NEGATIVE_INFINITY
  let headFollow: { start: number, link: ReturnType<typeof createLagChain>[] } | null = null
  let petting = false
  let petMoving = false
  let petLinks = createPetLinks()
  let time = 0

  function createPetLinks() {
    return {
      upper: [0, 1, 2].map(() => createLagChain([PET.upper.delay], BODY_TICK)),
      mid: [0, 1, 2].map(() => createLagChain([PET.mid.delay], BODY_TICK)),
    }
  }

  function notify(kind: BodyReactionKind) {
    report.seq++
    report.kind = kind
  }

  function admit(context: PerformanceContext) {
    const poke = context.input.events.poke
    const seq = poke?.seq ?? 0
    // The first tick only latches: a record that predates this layer (a reset performer) is not replayed.
    if (pokeSeq !== null && poke && seq !== pokeSeq) {
      const scale = time - lastPoke < REPEAT.seconds ? REPEAT.scale : 1
      lastPoke = time
      flinches.push({ start: time, region: poke.region, x: Math.max(-1, Math.min(1, poke.x)), y: Math.max(-1, Math.min(1, poke.y)), scale, state: { y: 0, v: 0, x: 0 } })
      if (poke.region === 'head')
        headFollow = { start: time, link: [0, 1, 2].map(() => createLagChain([HEAD_FOLLOW.delay], BODY_TICK)) }
      notify(poke.region === 'head' ? 'head-poke' : 'body-poke')
    }
    pokeSeq = seq
    const pet = context.input.events.pet
    if (pet.active && !petting)
      notify('pet')
    petting = pet.active
  }

  function addFlinch(flinch: Flinch, context: PerformanceContext) {
    advanceSecondOrder(flinch.state, time - flinch.start < FLINCH.release ? 1 : 0, FLINCH.response)
    const k = flinch.scale * flinch.state.y
    const activation = context.previous.diagnostics.gesture.activation
    const arm = (side: BodySide, channel: number, degrees: number) => {
      channels[ARM_START[side] + channel] += (1 - activation[side]) * k * degrees * DEG
    }
    if (flinch.region === 'head') {
      for (const side of SIDES)
        arm(side, 0, 4)
      return
    }
    const { x, y } = flinch
    channels[c('midYaw')] += k * -4 * x * DEG
    channels[c('midRoll')] += k * -2.5 * x * DEG
    channels[c('pelvisX')] += k * 0.01 * x
    if (x !== 0) {
      const poked: BodySide = x > 0 ? 'right' : 'left'
      arm(poked, 0, 5)
      arm(poked, 5, 10)
    }
    if (y > 0.3) {
      channels[c('lowerPitch')] += k * 4 * DEG
      channels[c('pelvisZ')] -= k * 0.01
    }
  }

  function addHeadFollow(context: PerformanceContext): boolean {
    if (!headFollow)
      return false
    const age = time - headFollow.start
    const fade = age < HEAD_FOLLOW.seconds ? 1 : 1 - minJerk((age - HEAD_FOLLOW.seconds) / HEAD_FOLLOW.fade)
    const pulse = context.input.head.terms.impulse
    const axes = [pulse.yaw, pulse.pitch, pulse.roll]
    let moving = fade > 0
    for (let axis = 0; axis < 3; axis++) {
      const value = headFollow.link[axis].step(fade * axes[axis])[0]
      channels[c('upperYaw') + axis] += HEAD_FOLLOW.share * value
      moving ||= Math.abs(value) > REST
    }
    if (!moving)
      headFollow = null
    return moving
  }

  function addPet(context: PerformanceContext): boolean {
    const { pet } = context.input.events
    const rock = context.input.head.terms.pet
    const axes = [rock.yaw, rock.pitch, rock.roll]
    let moving = pet.level > 0
    for (let axis = 0; axis < 3; axis++) {
      const upper = petLinks.upper[axis].step(axes[axis])[0]
      const mid = petLinks.mid[axis].step(axes[axis])[0]
      channels[c('upperYaw') + axis] += PET.upper.share * upper
      channels[c('midYaw') + axis] += PET.mid.share * mid
      moving ||= Math.abs(upper) > REST || Math.abs(mid) > REST
    }
    if (!moving) {
      // Settle the links exactly at rest once a pet has faded, so the next pet starts from zero.
      if (petMoving)
        petLinks = createPetLinks()
      petMoving = false
      return false
    }
    petMoving = true
    const l = pet.level
    channels[c('lowerPitch')] += 2 * l * DEG
    channels[c('midRoll')] += 2 * pet.x * l * DEG
    for (const side of SIDES) {
      const start = ARM_START[side]
      channels[start] += -3 * l * DEG
      for (let finger = start + 12; finger < start + 24; finger++)
        channels[finger] += -0.2 * l * context.rest[finger]
    }
    return true
  }

  return {
    id: 'reaction',
    order: 'reaction',
    mode: 'additive',
    mask: new Float64Array(BODY_CHANNELS.length).fill(1),
    // Every term starts at zero through its own response or level, so the stack adds no entry ramp.
    enterSeconds: 0,
    plan(context: PerformanceContext): PerformancePlan {
      const { pet } = context.input.events
      const { owned } = context.input
      // 4d: the support is pulled toward the petting hand while the pet is more than half in.
      if (pet.level > 0.5 && pet.x !== 0 && owned.lowerBody <= 0.5 && owned.upperBody <= 0.5)
        return { support: pet.x > 0 ? 1 : -1 }
      return {}
    },
    step(context: PerformanceContext) {
      time = context.time
      admit(context)
      channels.fill(0)
      for (const flinch of flinches)
        addFlinch(flinch, context)
      flinches = flinches.filter(f => time - f.start < FLINCH.release || Math.abs(f.state.y) > REST || Math.abs(f.state.v) > REST)
      const following = addHeadFollow(context)
      const petted = addPet(context)
      const active = flinches.length > 0 || following || petted
      if (active) {
        for (let channel = 0; channel < channels.length; channel++)
          channels[channel] *= freeShare(context.input.owned[CHANNEL_GROUPS[channel]])
      }
      return { channels, weight: active ? 1 : 0, sequence: 0, reaction: report }
    },
    reset() {
      flinches = []
      pokeSeq = null
      lastPoke = Number.NEGATIVE_INFINITY
      headFollow = null
      petting = false
      petMoving = false
      petLinks = createPetLinks()
      time = 0
      Object.assign(report, { seq: 0, kind: null })
    },
  }
}
