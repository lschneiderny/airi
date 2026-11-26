import type { SecondOrderState } from '../dynamics'
import type { BodySide } from './channels'
import type { BodyReactionKind, BodyReactionReport } from './contracts'
import type { PerformanceContext, PerformanceLayer, PerformancePlan } from './stack'

import { advanceSecondOrder, createLagChain, minJerk, secondOrderCoefficients } from '../dynamics'
import { ARM_START, BODY_CHANNELS, BODY_TICK, CHANNEL_GROUPS, channelIndex, DEG, freeShare, SIDES } from './channels'

/** 4d flinch: a step through the 3a response at 3.5 Hz and damping 0.45, released after 0.25 s; it peaks near 80 ms and rings once. */
const FLINCH = { response: secondOrderCoefficients({ f: 3.5, zeta: 0.45, r: 0 }, BODY_TICK), release: 0.25 }
/**
 * The poked side's guard: the forearm comes across the spot as fast as the trunk recoils, and is held a little longer
 * before it lets go; the far arm follows `delay` later at `share` of it, through a slower response. The far arm comes
 * late and stays low (`FAR_GUARD`), so the poked side stays the focus: at 0.12 s and the guard's own shape it joined in
 * time to open both arms into one recoil (audit of 2026-11-25).
 */
const GUARD = {
  response: secondOrderCoefficients({ f: 3, zeta: 0.6, r: 0 }, BODY_TICK),
  release: 0.6,
  far: { response: secondOrderCoefficients({ f: 1.6, zeta: 0.8, r: 0 }, BODY_TICK), delay: 0.3, share: 0.35 },
}
/**
 * Degrees of a body poke's guard on the poked arm, in arm channel order: clavicle elevation, protraction, flexion,
 * abduction, elbow. The elbow stays a little out so the forearm crosses in front of the side: a guard that clamped the
 * arm in (abduction -10) ran it into a slim rig's torso proxy, and the collision projection stopped it in one frame.
 */
const BODY_GUARD = [6, 4, 12, 10, 45] as const
/** The far arm's share of a body poke's guard: the shoulder draws in and the forearm lifts a little, the hand low. */
const FAR_GUARD = [3, 4, 4, 0, 20] as const
/**
 * After a body poke she looks down at where it landed: the neck pitches down and turns and tilts toward the spot,
 * degrees, from `delay` after the poke for `hold` seconds, through a 2.5 Hz response. Natural's poke nudge throws the
 * head away and up first, as it does for a head poke; the look then carries it down to the spot, so the two pokes no
 * longer end in the same head recoil. A low poke draws the look further down (`lowPitch` per unit of touch y, which the stage reports downward).
 */
const LOOK = { response: secondOrderCoefficients({ f: 2.5, zeta: 0.8, r: 0 }, BODY_TICK), delay: 0.15, hold: 0.8, pitch: 12, lowPitch: 6, yaw: 12, roll: 6 } as const
/** A head poke hunches the poked side's shoulder toward the ear, and the far one less. */
const HEAD_GUARD = [10, 2, 6, 0, 15] as const
/**
 * After a head poke the poked side's hand goes to the side of the head where it was hit (the hair tuck's `hair-touch`
 * key) and stays there this long from the poke, then lets go; only on a rig that reaches the key.
 */
const HEAD_TOUCH_SECONDS = 1.4
/** The poke surprise dedupe window (the character mind's `POKE_SURPRISE_DEDUPE_MS`): a poke this soon after the last flinches at 0.6. */
const REPEAT = { seconds: 2, scale: 0.6 }
/**
 * How long the trunk follows Natural's head pulse after a head poke: 15 of the longest poke nudge tau (`touch.ts`
 * `pokeNudgeTau.max` 0.18 s, `impulses.ts` `pulseLifetime`), then a fade so the link settles on zero.
 */
const HEAD_FOLLOW = { seconds: 15 * 0.18, fade: 0.5, share: 0.3, delay: 0.09 }
/** 4d pet: the trunk follows Natural's stroke-driven head rock at 0.35 (upper, 120 ms late) and 0.18 (mid, 220 ms late). */
const PET = { upper: { share: 0.35, delay: 0.12 }, mid: { share: 0.18, delay: 0.22 } }
/**
 * The pet's give: the near shoulder drops and rolls in toward the hand as she leans into it, faster than it lets go, so
 * it relaxes back after the hand leaves (time constants, seconds).
 */
const PET_GIVE = { in: 0.25, out: 0.7 }
/**
 * Degrees at a full give: she inclines her head into the hand through the neck (roll toward it, a little bow), and the
 * near shoulder comes up to meet the inclined head while the far one drops, a one-sided give that reads in one still. A
 * held pet that only dropped both shoulders left the head and the near shoulder where they were (audit of 2026-11-25).
 */
const PET_INCLINE = { roll: 8, pitch: 3, nearShoulder: 5, farShoulder: -3 } as const
const REST = 1e-6

const c = channelIndex

interface Flinch {
  readonly start: number
  readonly region: 'head' | 'body'
  /** The poke's side in the body's sign: +1 her right, -1 her left (touch x is +1 on her left). */
  readonly side: number
  readonly y: number
  readonly scale: number
  readonly state: SecondOrderState
  readonly guard: SecondOrderState
  readonly far: SecondOrderState
  readonly look: SecondOrderState
  readonly farDelay: ReturnType<typeof createLagChain>
}

/**
 * Layer 7 of 3g: architecture 4d's touch reactions on the body, additive. Touch `x` runs from -1 to 1 as the stage
 * reports it, from the viewer's left to the viewer's right, so +x is her left while she faces the viewer; Natural turns
 * her head away from a poke and toward a petting hand on the same reading.
 *
 * A body poke recoils the trunk and pelvis away from the spot and turns the chest away; the poked side protects itself
 * first, its arm clamping in with the forearm across the spot, and the far arm follows later and softer. A head poke lets
 * the upper torso follow Natural's head pulse, hunches the poked side's shoulder toward the ear, and takes the poked
 * side's hand to the side of the head for a moment where the rig reaches it. A pet leans the trunk into the hand, lets
 * the near shoulder give and roll in, relaxes the fingers, lets the trunk follow Natural's stroke rock, and pulls the
 * support toward the hand. Arm terms yield to an arm a gesture moves; owned groups receive no term.
 */
export function createReactionLayer(): PerformanceLayer {
  const channels = new Float64Array(BODY_CHANNELS.length)
  const report: BodyReactionReport & { seq: number, kind: BodyReactionKind | null } = { seq: 0, kind: null }
  let flinches: Flinch[] = []
  let pokeSeq: number | null = null
  let lastPoke = Number.NEGATIVE_INFINITY
  let headFollow: { start: number, link: ReturnType<typeof createLagChain>[] } | null = null
  let headTouch: { side: BodySide, until: number } | null = null
  let petting = false
  let petMoving = false
  let petLinks = createPetLinks()
  /** The shoulders' give and the hand's side in the body's sign (+1 her right), which outlast the pet level by `PET_GIVE.out`. */
  let give = 0
  let giveSide = 0
  /** The posture's target when the pet's weight shift began; null while it plans none. */
  let petResume: number | null = null
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
      const side = -Math.max(-1, Math.min(1, poke.x))
      const state = () => ({ y: 0, v: 0, x: 0 })
      flinches.push({ start: time, region: poke.region, side, y: Math.max(-1, Math.min(1, poke.y)), scale, state: state(), guard: state(), far: state(), look: state(), farDelay: createLagChain([GUARD.far.delay], BODY_TICK) })
      if (poke.region === 'head') {
        headFollow = { start: time, link: [0, 1, 2].map(() => createLagChain([HEAD_FOLLOW.delay], BODY_TICK)) }
        headTouch = context.capabilities.hairTouch ? { side: side > 0 ? 'right' : 'left', until: time + HEAD_TOUCH_SECONDS } : null
      }
      notify(poke.region === 'head' ? 'head-poke' : 'body-poke')
    }
    pokeSeq = seq
    if (headTouch && time >= headTouch.until)
      headTouch = null
    const pet = context.input.events.pet
    if (pet.active && !petting)
      notify('pet')
    petting = pet.active
  }

  function addFlinch(flinch: Flinch, context: PerformanceContext) {
    const age = time - flinch.start
    advanceSecondOrder(flinch.state, age < FLINCH.release ? 1 : 0, FLINCH.response)
    advanceSecondOrder(flinch.guard, age < GUARD.release ? 1 : 0, GUARD.response)
    advanceSecondOrder(flinch.far, flinch.farDelay.step(flinch.guard.y)[0], GUARD.far.response)
    advanceSecondOrder(flinch.look, flinch.region === 'body' && age >= LOOK.delay && age < LOOK.delay + LOOK.hold ? 1 : 0, LOOK.response)
    const k = flinch.scale * flinch.state.y
    const activation = context.previous.diagnostics.gesture.activation
    const s = flinch.side
    const poked: BodySide = s > 0 ? 'right' : 'left'
    const far: BodySide = s > 0 ? 'left' : 'right'
    // The near arm's share falls off toward the midline, so a central poke guards both sides alike.
    const near = Math.abs(s)
    const guard = (side: BodySide, weight: number, degrees: readonly number[]) => {
      const share = (1 - activation[side]) * weight * DEG
      for (let j = 0; j < 4; j++)
        channels[ARM_START[side] + j] += share * degrees[j]
      channels[ARM_START[side] + 5] += share * degrees[4]
    }
    const g = flinch.scale * flinch.guard.y
    const f = flinch.scale * flinch.far.y
    const degrees = flinch.region === 'head' ? HEAD_GUARD : BODY_GUARD
    guard(poked, g * (0.5 + 0.5 * near), degrees)
    // At the midline the far arm takes the near arm's half share in the near arm's response, so which side of the
    // middle a central poke lands on does not pick the arm that leads; toward a side it takes its own late, low share.
    guard(far, (1 - near) * 0.5 * g + near * GUARD.far.share * f, flinch.region === 'head' ? degrees : degrees.map((d, j) => d + near * (FAR_GUARD[j] - d)))
    if (flinch.region === 'head') {
      // The trunk leans a little away from the hit as the head is knocked.
      channels[c('midRoll')] += k * -1.5 * s * DEG
      return
    }
    // The hips jump away from the spot and the chest turns away from it, while the poked flank closes over it: the waist
    // leans away and the chest bends back toward the spot, a C around the touch rather than a lean of the whole trunk.
    channels[c('midYaw')] += k * 4 * s * DEG
    channels[c('midRoll')] += k * 3 * s * DEG
    channels[c('lowerRoll')] += k * -2.5 * s * DEG
    channels[c('pelvisX')] += k * 0.012 * s
    // She looks down at it.
    const look = flinch.scale * flinch.look.y * DEG
    channels[c('neckPitch')] += look * (LOOK.pitch + LOOK.lowPitch * Math.max(0, flinch.y))
    channels[c('neckYaw')] += look * -LOOK.yaw * s
    channels[c('neckRoll')] += look * LOOK.roll * s
    if (flinch.y > 0.3) {
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
    const l = pet.level
    // The hand's side in the body's sign, +1 her right, full a quarter of the head from its middle.
    if (l > 0)
      giveSide = Math.max(-1, Math.min(1, -2 * pet.x))
    give += (l - give) * (1 - Math.exp(-BODY_TICK / (l > give ? PET_GIVE.in : PET_GIVE.out)))
    if (l === 0 && give < REST)
      give = 0
    let moving = l > 0 || give > 0
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
    // She leans into the hand: the trunk rolls toward its side, more in the chest than the waist, and lets go as slowly
    // as the shoulder.
    channels[c('lowerPitch')] += 2 * give * DEG
    channels[c('midRoll')] += 3 * giveSide * give * DEG
    channels[c('lowerRoll')] += 1.5 * giveSide * give * DEG
    channels[c('neckRoll')] += PET_INCLINE.roll * giveSide * give * DEG
    channels[c('neckPitch')] += PET_INCLINE.pitch * give * DEG
    const activation = context.previous.diagnostics.gesture.activation
    for (const side of SIDES) {
      const start = ARM_START[side]
      // The near shoulder comes up toward the inclined head and rolls in toward the hand; the far one drops. The rest
      // pose holds the clavicles about a degree above their lower limit, so the far drop saturates there.
      const near = Math.max(0, (side === 'right' ? 1 : -1) * giveSide)
      const far = Math.max(0, -(side === 'right' ? 1 : -1) * giveSide)
      const free = (1 - activation[side]) * give * DEG
      channels[start] += free * (PET_INCLINE.nearShoulder * near + PET_INCLINE.farShoulder * far)
      channels[start + 1] += free * 3 * near
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
      const { owned } = context.input
      const plan: { support?: number, armForm?: PerformancePlan['armForm'] } = {}
      // A head poke's hand to the spot; it waits for an arm a clip or gesture holds, as every arm form does.
      if (headTouch && time < headTouch.until && owned[`${headTouch.side}Arm`] <= 0.5)
        plan.armForm = { side: headTouch.side, form: 'hair-touch' }
      // 4d: the support follows the give toward the petting hand, fully once it is half in, and back to the stance she
      // had: the posture keeps the last planned support until its own next shift.
      if (give > 0 && giveSide !== 0 && owned.lowerBody <= 0.5 && owned.upperBody <= 0.5) {
        petResume ??= context.previous.diagnostics.shiftTarget
        plan.support = petResume + (Math.sign(giveSide) - petResume) * Math.min(1, 2 * give)
      }
      else {
        petResume = null
      }
      return plan
    },
    step(context: PerformanceContext) {
      time = context.time
      admit(context)
      channels.fill(0)
      for (const flinch of flinches)
        addFlinch(flinch, context)
      const settled = (state: SecondOrderState) => Math.abs(state.y) <= REST && Math.abs(state.v) <= REST
      flinches = flinches.filter(f => time - f.start < Math.max(GUARD.release + GUARD.far.delay, LOOK.delay + LOOK.hold) || !settled(f.state) || !settled(f.guard) || !settled(f.far) || !settled(f.look))
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
      headTouch = null
      petting = false
      petMoving = false
      petLinks = createPetLinks()
      give = giveSide = 0
      petResume = null
      time = 0
      Object.assign(report, { seq: 0, kind: null })
    },
  }
}
