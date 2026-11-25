import type { Vec3 } from '../types'
import type { ArmKey } from './arm-key'
import type { BodySide } from './channels'
import type { BodyArmForm, BodyGestureForm, BodyRigTraits } from './contracts'
import type { HandShape } from './hand-shapes'

import { solveArmKey } from './arm-key'
import { ARM_START, DEG, JOINT_LIMITS, SIDES } from './channels'
import { BodyCollision, KEY_HEADROOM } from './collision'
import { writeHandShape } from './hand-shapes'
import { BodySkeleton } from './skeleton'

export type SpeechGestureForm = Exclude<BodyGestureForm, BodyArmForm>

/** One form of architecture 4a's table with unit A's amplitude scale. Angles in radians, times in seconds. */
export interface GestureFormSpec {
  readonly shape: HandShape
  /**
   * How far the stroke's hand goes from the relaxed hand toward `shape`: a beat's fingers close part of the way to a
   * cup on the downstroke and open again on the way back, so the hand works with the beat instead of riding it still.
   */
  readonly shapeShare: number
  /** 4a's stroke displacement from the ready key, arm lengths `[out, up, forward]`, before gain and scale. */
  readonly stroke: readonly [number, number, number]
  /**
   * Scale against 4a's stroke (unit A `amplitude-sources.md`): 2.0 sets the median form at energy 0.65 to the human
   * stationary talk p90 travel (0.253 A); point and chop stop where their peak speed at energy 0.65 reaches the human
   * talk p90 peak speed (3.70 A/s).
   */
  readonly scale: number
  readonly pron: number
  readonly wflex: number
  readonly wdev: number
  readonly strokeSeconds: number
  readonly hold: readonly [number, number]
  readonly hands: 'one' | 'either' | 'two'
}

export const GESTURE_FORMS: Readonly<Record<SpeechGestureForm, GestureFormSpec>> = {
  'beat': { shape: 'cup', shapeShare: 0.45, stroke: [0, -0.06, 0.03], scale: 2, pron: 20 * DEG, wflex: 10 * DEG, wdev: 0, strokeSeconds: 0.11, hold: [0.1, 0.25], hands: 'one' },
  'palm-up': { shape: 'open', shapeShare: 1, stroke: [0.07, -0.01, 0.1], scale: 2, pron: -70 * DEG, wflex: -12 * DEG, wdev: 0, strokeSeconds: 0.16, hold: [0.3, 0.8], hands: 'either' },
  'press': { shape: 'open', shapeShare: 1, stroke: [0, -0.1, 0.02], scale: 2, pron: 80 * DEG, wflex: -8 * DEG, wdev: 0, strokeSeconds: 0.15, hold: [0.25, 0.6], hands: 'either' },
  'point': { shape: 'point', shapeShare: 1, stroke: [-0.02, 0.04, 0.16], scale: 1.46, pron: 60 * DEG, wflex: 0, wdev: 0, strokeSeconds: 0.14, hold: [0.3, 0.7], hands: 'one' },
  'chop': { shape: 'flat', shapeShare: 1, stroke: [0, -0.14, 0.01], scale: 1.55, pron: 0, wflex: 0, wdev: 10 * DEG, strokeSeconds: 0.13, hold: [0.1, 0.2], hands: 'one' },
  'frame': { shape: 'open', shapeShare: 1, stroke: [0.05, -0.03, 0], scale: 2, pron: 0, wflex: 0, wdev: 0, strokeSeconds: 0.15, hold: [0.3, 0.8], hands: 'two' },
}

/**
 * A beat's stroke paths, A: the form's own down and forward, a shallower one further forward, and a diagonal one out
 * to the arm's side. Each beat of a hand takes the path after the one its last beat took, so consecutive beats differ in
 * depth or direction; all three are about as long as the form's own, so a beat's amplitude stays where unit A set it.
 */
export const BEAT_PATHS: readonly (readonly [number, number, number])[] = [GESTURE_FORMS.beat.stroke, [0.01, -0.035, 0.055], [0.04, -0.045, 0.025]]

/**
 * The held arm forms (4a, 4e): hand shape, palm orientation and the contact anchor they reach for; the thinking hand
 * stops 0.04 A short of its chin anchor. `anchor` moves the seed toward the arm's own side and up, in arm lengths: the
 * hand rests on the upper chest beside the sternum, and comes to the chin and jaw from the side. The hand to chest
 * goes 0.15 A up, which puts the wrist on the upper chest above the bust: at 0.05 A the march stopped on the
 * bust's front on chested rigs and left the hand floating in front of the chest. The yawn's hand covers
 * the mouth 0.06 A in front of it (4e act 9), at the chin seed, palm toward the face as the thinking hand holds it; it
 * comes 0.08 A to its own side, the nearest offset from the midline, in 0.02 A steps, at which Chisa's and Ellen's arms
 * solve a key inside their limits (E/g4/a/scratch/probe-cover.ts).
 *
 * The clasp is a two-hand contact (6.3, used by 4e act 6 and 4f's rest): both hands go to the front-low anchor, the
 * hips pushed forward, each wrist half a hand length to its own side of it, so the wrists are one hand length apart and
 * the hands, which point on along the forearms, overlap across the midline. 6.3 keeps two-hand wrists 0.9 of a hand
 * length apart unless the pose defines a contact; this one does. Neither row sets the hand's orientation: the palms
 * turn halfway toward the body (pronation 45 between the hang's 0 and the hand to chest's 75), the wrist straight, the
 * elbows a little out (the hand to chest's 25 less its 10 for the arm in front of the body).
 *
 * The clasp's height is "hands clasped just below waist" (Stanford Oral Communication Program, delivery), measured on
 * ANSUR II's women (Gordon et al. 2014, NATICK/TR-15/007, summary statistics, female means): waist height (omphalion,
 * the navel) 98.01 cm (p. 223), trochanterion height 84.54 cm (p. 209), lateral malleolus height 6.27 cm (p. 161),
 * hand breadth 7.82 cm (p. 127); stature 162.85 cm (p. 193). On the rig the trochanterion, the top of the greater trochanter, stands for the hip
 * joint, which is the top of the leg IK chains (`BodyRigTraits.legs`, the height of their two `hip` joints), and the
 * lateral malleolus for the ankle joint, so the hip-to-ankle span 84.54 - 6.27 = 78.27 cm is the rig's `legLength`
 * (thigh plus shin). Leg length scales the proportions rather than stature, because the rig has no top-of-head
 * landmark and its legs are the span the band sits on. The waist is (98.01 - 84.54) / 78.27 = 0.172 L above the hip
 * joints. "Just below" the waist puts the top of the clasped hands at the waist line, and the wrists, which the
 * anchor places, one hand breadth below the top of the hands: 7.82 / 78.27 = 0.100 L under the waist, so
 * (98.01 - 84.54 - 7.82) / 78.27 = 0.072 L above the hip joints (`FRONT_LOW_HEIGHT`). The seed keeps the hips' midline and depth, and a rig without leg joints has no clasp height, so it does
 * not clasp. As 6.3 states, a rig that cannot reach the anchor does not clasp: its hands hang.
 *
 * The hair tuck (4e act 8) is two keys on one arm: `hair-touch`, the combing fingertips at the side of the head at the
 * tragion, and `hair-sweep`, the same height one ear breadth further back, which the gesture layer reaches from the
 * held `hair-touch` without going home (`after`). Moore 1985 (Ethology and Sociobiology 6(4):237-247) observed the
 * gesture as "raising one hand and pushing her fingers through her hair or running her palm along the surface of her
 * hair"; the row puts the hand where the tuck lays the hair behind the ear, the side of the head behind the brow line.
 * The contact is the fingertips (`TUCK`), not the wrist the other forms place, and the solve turns and bends the hand
 * at the wrist so that they reach it with the palm toward the head (`bentHand`), in place of the forms' fixed
 * pronation and flexion.
 */
export const ARM_FORMS: Readonly<Record<BodyArmForm, { readonly shape: HandShape | Readonly<Record<BodySide, HandShape>>, readonly pron: number, readonly wflex: number, readonly swivel: number, readonly short: number, readonly seed: 'chest' | 'chin' | 'front-low' | 'tragion', readonly anchor: { readonly side: number, readonly up: number }, readonly hands: 'one' | 'both', readonly sweep?: number, readonly after?: BodyArmForm }>> = {
  'hand-to-chest': { shape: 'relaxed', pron: 75 * DEG, wflex: -10 * DEG, swivel: 25 * DEG, short: 0, seed: 'chest', anchor: { side: 0.05, up: 0.15 }, hands: 'one' },
  'thinking-hand': { shape: 'thinking', pron: 20 * DEG, wflex: -20 * DEG, swivel: 10 * DEG, short: 0.04, seed: 'chin', anchor: { side: 0.1, up: 0 }, hands: 'one' },
  'cover-mouth': { shape: 'relaxed', pron: 20 * DEG, wflex: -20 * DEG, swivel: 10 * DEG, short: 0.06, seed: 'chin', anchor: { side: 0.08, up: 0 }, hands: 'one' },
  'hair-touch': { shape: 'comb', pron: 20 * DEG, wflex: 0, swivel: 10 * DEG, short: 0, seed: 'tragion', anchor: { side: 0, up: 0 }, hands: 'one' },
  'hair-sweep': { shape: 'comb', pron: 20 * DEG, wflex: 0, swivel: 10 * DEG, short: 0, seed: 'tragion', anchor: { side: 0, up: 0 }, hands: 'one', sweep: 1, after: 'hair-touch' },
  'clasp': { shape: { left: 'relaxed', right: 'wrap' }, pron: 45 * DEG, wflex: 0, swivel: 15 * DEG, short: 0, seed: 'front-low', anchor: { side: 0, up: 0 }, hands: 'both' },
}

/** Whether `form` is a held arm form (`ARM_FORMS`), not a speech gesture's. */
export function isArmForm(form: SpeechGestureForm | BodyArmForm): form is BodyArmForm {
  return Object.hasOwn(ARM_FORMS, form)
}

/** Writes the hand of arm form `form` on `side` into a side's arm block (`writeHandShape`); a form may name a hand per side. */
export function writeArmFormHand(form: BodyArmForm, side: BodySide, pose: Float64Array): void {
  const { shape } = ARM_FORMS[form]
  writeHandShape(typeof shape === 'string' ? shape : shape[side], pose)
}

const relaxedHand = new Float64Array(26)
writeHandShape('relaxed', relaxedHand)

/**
 * Writes `shape` into a side's arm block `share` of the way from the relaxed hand (channels 9 to 25), as a static mix
 * of the two hands' joint angles: a key's hand, not a moment on the closing path (`blendHand`).
 */
export function writeHandShare(shape: HandShape, share: number, pose: Float64Array): void {
  writeHandShape(shape, pose)
  for (let j = 9; j < 26; j++)
    pose[j] += (1 - share) * (relaxedHand[j] - pose[j])
}

/** Writes the hand a speech form's stroke lands with (`GestureFormSpec.shapeShare`). */
export function writeFormHand(form: SpeechGestureForm, pose: Float64Array): void {
  writeHandShare(GESTURE_FORMS[form].shape, GESTURE_FORMS[form].shapeShare, pose)
}

/**
 * A ready key's place against 4a's ready key: the hand moved out, up and forward in arm lengths, and the elbow swung out
 * by `swivel` radians.
 */
export interface ReadyOffset {
  readonly out: number
  readonly up: number
  readonly forward: number
  readonly swivel: number
}

export const NO_OFFSET: ReadyOffset = { out: 0, up: 0, forward: 0, swivel: 0 }

export function addOffsets(a: ReadyOffset, b: ReadyOffset): ReadyOffset {
  return { out: a.out + b.out, up: a.up + b.up, forward: a.forward + b.forward, swivel: a.swivel + b.swivel }
}

/** Architecture 4a's energy gain on stroke size, energy in [0, 1]. */
export function gestureGain(energy: number): number {
  return Math.max(0.5, Math.min(1.5, 0.55 + 0.9 * energy))
}

/** Architecture 4a's tempo divisor on stroke and preparation durations, energy in [0, 1]. */
export function gestureTempo(energy: number): number {
  return 0.85 + 0.3 * Math.max(0, Math.min(1, energy))
}

/** Arm and hand channels of one side: 26 values in `BODY_CHANNELS` order from that side's `ClavElev`. */
export type ArmPose = Float64Array

const PUSH_STEPS = 8
const PUSH_STEP = 0.02
const PATH_SAMPLES = 10
/**
 * Architecture 6.3's anchor march, in arm lengths: the hand point starts this far in front of the seed, steps in, and
 * stops this far beyond the hand capsule's radius from the nearest collider. A key then backs off from the anchor in
 * steps, as far as `backOff`, while the elbow swings out from the form's swivel to `swivel`.
 */
const ANCHOR = { start: 1, step: 0.005, clearance: 0.01, backOffStep: 0.01, backOff: 0.2, swivelStep: 5 * DEG, swivel: 80 * DEG } as const
/**
 * The front-low anchor's height above the hip joints, in leg lengths: one hand breadth under the waist on ANSUR II's
 * women, waist (omphalion) minus trochanterion minus hand breadth over trochanterion minus lateral malleolus height
 * (`ARM_FORMS`).
 */
const FRONT_LOW_HEIGHT = (98.01 - 84.54 - 7.82) / (84.54 - 6.27)
/**
 * The hair tuck's anchor on ANSUR II's women (Gordon et al. 2014, NATICK/TR-15/007, female means, cm): head breadth
 * 14.78 (p. 134), the widest span of the head above the ears; tragion to top of head 12.65 (p. 208); ear breadth 3.32
 * (p. 104). The rig's head breadth is the widest span of its head proxies across the head bone, which scales the other
 * two: the tragion stands that far under the top of the proxies over the head bone, and the sweep carries the
 * fingertips that far back, from the front of the ear to behind it. The depth is 6.3's temple seed's, the head bone's.
 * The fingertips are the end of the hand, a hand length from the wrist along the hand as the wrist bends it.
 */
const TUCK = { headBreadth: 14.78, tragionTop: 12.65, earBreadth: 3.32 } as const
/**
 * How far the tuck's palm may roll about the hand from facing the side of the head when the wrist turns it there in
 * full (`bentHand`). Keys whose palm faces the head go first (Moore 1985: the palm runs along the hair); by least joint
 * change alone the tuck chose hands held up beside the head palm forward, a salute rather than a touch.
 */
const TUCK_PALM_ROLL = 50 * DEG
/**
 * Where the hair tuck's reach passes on its way between the rest arm and a tuck key, as each channel's share of the way
 * from the rest arm: flex, abduct, twist and elbow, then every wrist and hand channel. The elbow and the forward flex
 * lead while the upper arm stays low, so the hand comes up in front of the chest and then out to the temple. Straight
 * from rest, every joint at once, the arm swung out to the side with the elbow high and the palm forward, a wave, the
 * wrist 0.3 to 0.4 arm lengths out beyond where the touch holds it; through this via, 0.15 to 0.24. A stronger lead
 * asks the elbow for more than the act layer's easing allows (0.25 degrees per tick per tick) in the reach's time.
 */
const TUCK_VIA = { flex: 0.75, abduct: 0.2, twist: 0.2, elbow: 0.62, hand: 0.5 } as const
/** Directions from the fingertips in which the tuck tries the wrist. */
const WRIST_DIRECTIONS = 600
/** No joint of an arm form sits within this of its limit. */
const LIMIT_MARGIN = 2 * DEG
/** The corrector's capsule radius as a share of its segment: the hand is the extended forearm's capsule. */
const HAND_RADIUS = 0.15
/**
 * The clasp's wrists, hand lengths out from the hips' midline: from half a hand (the hands overlap whole) out to
 * `out` (the fingers still overlap by a fifth of a hand) in `outStep` steps. The right hand lies `layer` of the forearm
 * in front of the left one: a hand's thickness, the corrector's hand capsule radius less its margin (`HAND_RADIUS`).
 * Both hands point across the body, tilted down from level by as little as the wrists allow, up to `tilt`, the palms
 * rolled from facing the body by as little as the wrists allow, up to `roll`: with the palms held flat to the body the
 * wrists ran out of deviation on most rigs, which then clasped at the widest spacing, the hands meeting tip to tip in a
 * V.
 */
const CLASP = { out: 0.9, outStep: 0.1, layer: 0.12, tilt: 60 * DEG, tiltStep: 15 * DEG, roll: 30 * DEG } as const
/**
 * A rig without forearm twist bones holds pronation inside 60 degrees (the performer clamps it there); keys stay 5
 * degrees inside, the active forearm follower's overshoot (zeta 0.7, about 5 % of a 90 degree turn).
 */
const UNTWISTED_PRONATION = 55 * DEG
/** The step in which a contact hand rolls about its direction away from its preferred palm (`orientHand`). */
const HAND_ROLL_STEP = 10 * DEG
/** How far the thinking hand's palm may roll from facing the head: across, palm down to palm up. */
const FINGERTIP_ROLL = 90 * DEG

/**
 * Per-rig gesture keys (architecture 4a, 6.3). A key is solved by two-bone IK into the 3f arm angles. When the pose
 * or its sampled angle path penetrates the proxies, the hand moves outward in 0.02 A steps, at most eight. A key that
 * stays unreachable, outside the joint limits or inside the proxies is refused. Measured against the
 * rest trunk.
 */
export class GestureKeys {
  private readonly skeleton: BodySkeleton
  private readonly collision: BodyCollision
  private readonly lengths: Record<BodySide, { readonly upper: number, readonly forearm: number }>
  private readonly scratch: Float32Array
  /** Each arm's rest pose, where an arm form's path starts. */
  private readonly restArms: Record<BodySide, ArmPose>
  /** The corrector's proxies as the live body poses them, and its channels (`clearOfBody`). */
  private readonly live: BodyCollision
  private readonly liveChannels: Float32Array
  /**
   * Arm forms this rig cannot reach (`armForm` false). The answer depends only on the rig and its rest trunk, so a
   * refused form is not searched again while a layer keeps requesting it (the rest requests its clasp for minutes).
   */
  private readonly unreachable = new Set<`${BodySide}:${BodyArmForm}`>()
  /** The head proxies' top over the head bone and their widest span across it, measured at the first hair tuck. */
  private headSize: { readonly top: number, readonly breadth: number } | null | undefined
  /** The hair tuck's solved keys (arm joints flex to wrist deviation), which depend only on the rig and its rest trunk. */
  private readonly tucked = new Map<`${BodySide}:${BodyArmForm}`, Float64Array>()
  /** The clasp's and the thinking hand's solved keys (arm joints flex to wrist deviation), searched once per side. */
  private readonly solved = new Map<`${BodySide}:${BodyArmForm}`, Float64Array>()

  constructor(private readonly traits: BodyRigTraits, private readonly rest: Float32Array) {
    this.skeleton = new BodySkeleton(traits)
    this.collision = new BodyCollision(traits, rest)
    this.scratch = rest.slice()
    const lengths = (side: BodySide) => {
      const arm = traits.arms[side]
      return { upper: Math.hypot(arm.upperArm.x, arm.upperArm.y, arm.upperArm.z), forearm: Math.hypot(arm.forearm.x, arm.forearm.y, arm.forearm.z) }
    }
    this.lengths = { left: lengths('left'), right: lengths('right') }
    this.restArms = { left: Float64Array.from(rest.subarray(ARM_START.left, ARM_START.left + 26)), right: Float64Array.from(rest.subarray(ARM_START.right, ARM_START.right + 26)) }
    this.collision.prepare(rest)
    this.live = new BodyCollision(traits, rest.slice())
    this.liveChannels = rest.slice()
    this.skeleton.update(rest)
  }

  /**
   * 4a's ready key at `energy`, moved by `offset` (a phrase's place, a float within it). The wrist comes up in line
   * with the forearm, 10 degrees out of the rest's extension, so the preparation still moves the wrist after the elbow
   * and the hand hovers relaxed in front of the body; held 20 degrees extended, the relaxed fingers read as a claw on a
   * calibrated hand.
   */
  readyKey(energy: number, offset: ReadyOffset = NO_OFFSET): ArmKey {
    const lift = Math.max(0, Math.min(1, energy))
    return { hand: [-0.05 + offset.out, -0.6 + 0.22 * lift + offset.up, 0.42 + offset.forward], swivel: 20 * DEG + offset.swivel, pron: 20 * DEG, wflex: 0, wdev: 0 }
  }

  /**
   * The stroke key of `form` from `ready`, by size factor `size` (gain x scale x amplitude), yawed by `yaw` radians,
   * along `path` (the form's stroke unless given: a beat's from `BEAT_PATHS`).
   */
  strokeKey(ready: ArmKey, form: SpeechGestureForm, size: number, yaw = 0, path: readonly [number, number, number] = GESTURE_FORMS[form].stroke): ArmKey {
    const spec = GESTURE_FORMS[form]
    const [x, y, z] = path
    const out = x * Math.cos(yaw) + z * Math.sin(yaw)
    const forward = -x * Math.sin(yaw) + z * Math.cos(yaw)
    return { hand: [ready.hand[0] + size * out, ready.hand[1] + size * y, ready.hand[2] + size * forward], swivel: ready.swivel, pron: spec.pron, wflex: spec.wflex, wdev: spec.wdev }
  }

  /**
   * Solves an emotion arm form into `pose` the way a person reaches it (architecture 6.3, plan 3.1):
   *
   * - The anchor: a hand point marches from 1 A in front of the form's seed toward it until it is the hand capsule's
   *   radius plus 0.01 A from the nearest collider, so the hand stops at the body's surface (with no collider near,
   *   at the seed). Chest seed: between the shoulder joints, 0.15 A lower; chin seed: the head bone pushed forward and
   *   down by 0.6 of the neck-to-head length; front-low seed: the hips' midline and depth at `FRONT_LOW_HEIGHT` above
   *   the hip joints (none without leg joints); each moved by the form's `anchor` toward the
   *   arm's own side and up, and a two-hand form's wrist half a hand length further to its own side.
   * - The key: from the anchor (the thinking hand `short` of it) the hand backs off along the approach in 0.01 A
   *   steps, and at each step the elbow swings out from the form's swivel to 80 degrees. A key counts when every joint
   *   is 2 degrees inside its limit and the pose and the angle path from the rest arm clear the proxies' margin (a
   *   contact form touches the body, so it takes no settling headroom); the first step with one wins, with the swivel
   *   that leaves the most limit margin.
   * - The thinking hand first puts the index fingertip on the face (`fingertip`), and takes the wrist anchor above only
   *   where no such key exists; the clasp solves both hands together (`clasp`), and the hair tuck its two keys (`tuck`).
   *
   * False when no step within 0.2 A of the anchor has such a key. Solved and refused forms are kept per side.
   */
  armForm(side: BodySide, form: BodyArmForm, pose: ArmPose): boolean {
    if (this.unreachable.has(`${side}:${form}`))
      return false
    const spec = ARM_FORMS[form]
    const known = this.solved.get(`${side}:${form}`)
    if (known) {
      pose.set(known, 2)
      return true
    }
    if (form === 'thinking-hand' && this.fingertip(side, form, pose)) {
      this.solved.set(`${side}:${form}`, pose.slice(2, 9))
      return true
    }
    const special = spec.seed === 'tragion' ? this.tuck(side, form, pose) : form === 'clasp' ? this.clasp(side, pose) : null
    if (special !== null) {
      if (!special)
        this.unreachable.add(`${side}:${form}`)
      return special
    }
    const length = this.lengths[side].upper + this.lengths[side].forearm
    const shoulder = this.skeleton.arm(side, this.rest).shoulder
    const sigma = side === 'left' ? 1 : -1
    const { traits } = this
    const neckToHead = Math.hypot(traits.head.x - traits.neck.x, traits.head.y - traits.neck.y, traits.head.z - traits.neck.z)
    const legs = traits.legs
    const seed = spec.seed === 'chest'
      ? { x: 0, y: (traits.arms.left.shoulder.y + traits.arms.right.shoulder.y) / 2 - 0.15 * length, z: (traits.arms.left.shoulder.z + traits.arms.right.shoulder.z) / 2 }
      : spec.seed === 'chin'
        ? { x: 0, y: traits.head.y - 0.6 * neckToHead, z: traits.head.z + 0.6 * neckToHead }
        : legs ? { x: traits.hips.x, y: (legs.left.hip.y + legs.right.hip.y) / 2 + FRONT_LOW_HEIGHT * traits.legLength, z: traits.hips.z } : null
    if (!seed) {
      this.unreachable.add(`${side}:${form}`)
      return false
    }
    seed.x += sigma * (spec.anchor.side * length + (spec.hands === 'both' ? 0.5 * traits.arms[side].handLength : 0))
    seed.y += spec.anchor.up * length
    const reach = HAND_RADIUS * this.lengths[side].forearm + ANCHOR.clearance * length
    let surface = seed.z
    for (let z = seed.z + ANCHOR.start * length; z > seed.z; z -= ANCHOR.step * length) {
      if (this.collision.distance(seed.x, seed.y, z) <= reach) {
        surface = z
        break
      }
    }
    for (let back = spec.short; back <= spec.short + ANCHOR.backOff + 1e-9; back += ANCHOR.backOffStep) {
      const hand: [number, number, number] = [sigma * (seed.x - shoulder.x) / length, (seed.y - shoulder.y) / length, (surface + back * length - shoulder.z) / length]
      let margin = -1
      let swivel = spec.swivel
      for (let candidate = spec.swivel; candidate <= ANCHOR.swivel + 1e-9; candidate += ANCHOR.swivelStep) {
        if (!this.solveOnce(side, { hand, swivel: candidate, pron: spec.pron, wflex: spec.wflex, wdev: 0 }, pose))
          continue
        const inside = this.limitMargin(side, pose)
        if (inside >= LIMIT_MARGIN && inside > margin && this.deepest(side, pose, this.restArms[side]) === null) {
          margin = inside
          swivel = candidate
        }
      }
      if (margin >= 0)
        return this.solveOnce(side, { hand, swivel, pron: spec.pron, wflex: spec.wflex, wdev: 0 }, pose)
    }
    this.unreachable.add(`${side}:${form}`)
    return false
  }

  /**
   * The clasp (6.3's two-hand contact at the front-low anchor), solved for both arms together so the hands meet: each
   * wrist stands `out` hand lengths to its own side of the hips' midline, from half a hand length (the hands overlap
   * whole) out to `CLASP.out`, times the tilt's cosine, and each hand points across the body past the midline, palm
   * toward the body (rolled up to `CLASP.roll`), turned at the wrist and tilted down from level by the least of 0, 15,
   * 30, 45 and 60 degrees that both wrists reach. The left hand lies on a plane at the body's surface (the hand point
   * marched in at each wrist, the outer of the two) and the right one a hand's thickness (`CLASP.layer`) in front of it, so it lies
   * over the left; both planes back off together. The first spacing, then back-off step, at which both arms have a key
   * clear of the margin with its path from rest, inside the limits, wins, each by limit margin among swivels; both keys
   * are kept. False without leg joints or without such a pair.
   */
  private clasp(side: BodySide, pose: ArmPose): boolean {
    const { traits } = this
    const legs = traits.legs
    if (!legs)
      return false
    const y = (legs.left.hip.y + legs.right.hip.y) / 2 + FRONT_LOW_HEIGHT * traits.legLength
    const hand = (traits.arms.left.handLength + traits.arms.right.handLength) / 2
    const forearm = (this.lengths.left.forearm + this.lengths.right.forearm) / 2
    const length = (this.lengths.left.upper + this.lengths.right.upper) / 2 + forearm
    const reach = HAND_RADIUS * forearm + ANCHOR.clearance * length
    const surfaceAt = (x: number) => {
      for (let z = traits.hips.z + ANCHOR.start * length; z > traits.hips.z; z -= ANCHOR.step * length) {
        if (this.collision.distance(x, y, z) <= reach)
          return z
      }
      return traits.hips.z
    }
    const palm = { x: 0, y: 0, z: -1 }
    const keys = { left: pose.slice(), right: pose.slice() }
    for (const s of SIDES)
      keys[s].set(this.restArms[s].subarray(0, 2))
    const tilts = Array.from({ length: Math.round(CLASP.tilt / CLASP.tiltStep) + 1 }, (_, k) => k * CLASP.tiltStep)
    for (let out = 0.5; out <= CLASP.out + 1e-9; out += CLASP.outStep) {
      // A tilted pair stands its wrists closer by the tilt's cosine, so the hands overlap across the midline by the same
      // share of their length as level ones do, rather than meeting tip to tip in a V.
      const asides = tilts.map(tilt => out * hand * Math.cos(tilt))
      const planes = asides.map(aside => Math.max(surfaceAt(traits.hips.x + aside), surfaceAt(traits.hips.x - aside)))
      for (let back = 0; back <= ANCHOR.backOff + 1e-9; back += ANCHOR.backOffStep) {
        let solved = false
        for (let k = 0; k < tilts.length && !solved; k++) {
          const [tilt, aside, plane] = [tilts[k], asides[k], planes[k]]
          solved = SIDES.every((s) => {
            const sigma = s === 'left' ? 1 : -1
            const wrist = { x: traits.hips.x + sigma * aside, y, z: plane + back * length + (s === 'right' ? CLASP.layer * forearm : 0) }
            return this.claspKey(s, wrist, { x: -sigma * Math.cos(tilt), y: -Math.sin(tilt), z: 0 }, palm, keys[s])
          })
        }
        if (solved) {
          for (const s of SIDES)
            this.solved.set(`${s}:clasp`, keys[s].slice(2, 9))
          pose.set(keys[side].subarray(2, 9), 2)
          return true
        }
      }
    }
    this.unreachable.add(`${side === 'left' ? 'right' : 'left'}:clasp`)
    return false
  }

  /** One arm's clasp key at `wrist`, the hand along `direction` with the palm toward `palm`: the swivel with the most limit margin whose pose and path from rest clear the margin. */
  private claspKey(side: BodySide, wrist: Readonly<Vec3>, direction: Readonly<Vec3>, palm: Readonly<Vec3>, pose: ArmPose): boolean {
    const spec = ARM_FORMS.clasp
    const length = this.lengths[side].upper + this.lengths[side].forearm
    const shoulder = this.skeleton.arm(side, this.rest).shoulder
    const sigma = side === 'left' ? 1 : -1
    const key: ArmKey = { hand: [sigma * (wrist.x - shoulder.x) / length, (wrist.y - shoulder.y) / length, (wrist.z - shoulder.z) / length], swivel: spec.swivel, pron: 0, wflex: 0, wdev: 0 }
    let best: Float64Array | null = null
    let margin = LIMIT_MARGIN
    for (let swivel = spec.swivel; swivel <= ANCHOR.swivel + 1e-9; swivel += ANCHOR.swivelStep) {
      if (!this.solveOnce(side, { ...key, swivel }, pose) || !this.orientHand(side, pose, direction, palm, CLASP.roll))
        continue
      const inside = this.limitMargin(side, pose)
      if (inside >= margin && this.deepest(side, pose, this.restArms[side]) === null) {
        margin = inside
        best = pose.slice(2, 9)
      }
    }
    if (best)
      pose.set(best, 2)
    return best !== null
  }

  /**
   * The thinking hand's key with its fingertip on the face: the fingertip point marches in from 1 A in front of the
   * chin seed (moved by the form's `anchor`, and toward the midline in 0.01 A steps where the face is narrower) until
   * it is `ANCHOR.clearance` from the head proxies, so the extended index rests on the surface. The wrist then stands a
   * hand length from it, in each of `WRIST_DIRECTIONS` directions, and the hand turns at the wrist to point there, palm
   * toward the head bone or rolled from it by up to `FINGERTIP_ROLL`. A candidate's palm (to half the hand length)
   * clears the proxies by the hand capsule's radius, and its pose and path from rest clear the margin inside the
   * limits; the most upright hand wins. Each back-off step moves the fingertip 0.01 A off the surface, as far as 0.2 A.
   * False without such a key.
   */
  private fingertip(side: BodySide, form: BodyArmForm, pose: ArmPose): boolean {
    const spec = ARM_FORMS[form]
    const { traits } = this
    const length = this.lengths[side].upper + this.lengths[side].forearm
    const shoulder = this.skeleton.arm(side, this.rest).shoulder
    const sigma = side === 'left' ? 1 : -1
    const neckToHead = Math.hypot(traits.head.x - traits.neck.x, traits.head.y - traits.neck.y, traits.head.z - traits.neck.z)
    const seed = { x: 0, y: traits.head.y - 0.6 * neckToHead + spec.anchor.up * length, z: traits.head.z + 0.6 * neckToHead }
    const touch = ANCHOR.clearance * length
    let surface: number | null = null
    // A face narrower than the anchor's side offset at the chin is touched nearer the midline.
    for (let aside = spec.anchor.side; aside >= -1e-9 && surface === null; aside -= ANCHOR.backOffStep) {
      seed.x = traits.head.x + sigma * Math.max(0, aside) * length
      for (let z = seed.z + ANCHOR.start * length; z > seed.z - ANCHOR.start * length; z -= ANCHOR.step * length) {
        if (this.collision.distance(seed.x, seed.y, z) <= touch) {
          surface = z
          break
        }
      }
    }
    if (surface === null)
      return false
    const hand = traits.arms[side].handLength
    const radius = HAND_RADIUS * this.lengths[side].forearm
    for (let back = 0; back <= ANCHOR.backOff + 1e-9; back += ANCHOR.backOffStep) {
      const tip = { x: seed.x, y: seed.y, z: surface + back * length }
      const palm = { x: traits.head.x - tip.x, y: traits.head.y - tip.y, z: traits.head.z - tip.z }
      let best: Float64Array | null = null
      let upright = -Infinity
      for (let i = 0; i < WRIST_DIRECTIONS; i++) {
        // A Fibonacci sphere from its top down: the most upright hand comes first.
        const up = 1 - 2 * (i + 0.5) / WRIST_DIRECTIONS
        const around = Math.sqrt(1 - up * up)
        const turn = i * Math.PI * (3 - Math.sqrt(5))
        const direction = { x: around * Math.cos(turn), y: up, z: around * Math.sin(turn) }
        if (direction.y <= upright)
          continue
        const wrist = { x: tip.x - hand * direction.x, y: tip.y - hand * direction.y, z: tip.z - hand * direction.z }
        // The palm, to the knuckles half a hand from the wrist, clears the proxies by the hand capsule's radius; the
        // extended index beyond it is thin and ends at the fingertip.
        let clear = true
        for (let k = 0; k <= 2 && clear; k++)
          clear = this.collision.distance(wrist.x + hand * direction.x * k / 4, wrist.y + hand * direction.y * k / 4, wrist.z + hand * direction.z * k / 4) >= radius
        if (!clear)
          continue
        const key: ArmKey = { hand: [sigma * (wrist.x - shoulder.x) / length, (wrist.y - shoulder.y) / length, (wrist.z - shoulder.z) / length], swivel: spec.swivel, pron: 0, wflex: 0, wdev: 0 }
        for (let swivel = spec.swivel; swivel <= ANCHOR.swivel + 1e-9; swivel += ANCHOR.swivelStep) {
          if (!this.solveOnce(side, { ...key, swivel }, pose) || !this.orientHand(side, pose, direction, palm, FINGERTIP_ROLL))
            continue
          if (this.limitMargin(side, pose) >= LIMIT_MARGIN && this.deepest(side, pose, this.restArms[side]) === null) {
            upright = direction.y
            best = pose.slice(2, 9)
            break
          }
        }
      }
      if (best) {
        pose.set(best, 2)
        return true
      }
    }
    return false
  }

  /**
   * Turns the hand of `pose` at the wrist (pronation, palmar flexion and deviation) so that it points along the unit
   * `direction` with the palm toward `palm`, or rolled about the direction from it in 10 degree steps, nearest first, as
   * far as `roll`; the first roll whose three angles stand 2 degrees inside their limits wins. False without one. With F
   * the forearm's frame before pronation and H the hand's (it points along its -y and its palm faces its -sigma x),
   * `BodySkeleton.arm` poses F^T H = Ry(-sigma pron) Rz(-sigma wflex) Rx(wdev), whose Y-Z-X Euler angles are solved here.
   */
  private orientHand(side: BodySide, pose: ArmPose, direction: Readonly<Vec3>, palm: Readonly<Vec3>, roll = 0): boolean {
    const sigma = side === 'left' ? 1 : -1
    const along = palm.x * direction.x + palm.y * direction.y + palm.z * direction.z
    const px = palm.x - along * direction.x
    const py = palm.y - along * direction.y
    const pz = palm.z - along * direction.z
    const n = Math.hypot(px, py, pz)
    if (n < 1e-6)
      return false
    // The palm's normal and the axis across the hand, both perpendicular to the direction.
    const [nx, ny, nz] = [px / n, py / n, pz / n]
    const [bx, by, bz] = [direction.y * nz - direction.z * ny, direction.z * nx - direction.x * nz, direction.x * ny - direction.y * nx]
    pose[6] = pose[7] = pose[8] = 0
    this.load(side, pose, pose, 0)
    const f = this.skeleton.arm(side, this.scratch).forearm
    const start = ARM_START[side]
    const pronLimit = this.traits.arms[side].twist ? JOINT_LIMITS[start + 6] : [-UNTWISTED_PRONATION, UNTWISTED_PRONATION] as const
    const limits = [pronLimit, JOINT_LIMITS[start + 7], JOINT_LIMITS[start + 8]]
    for (let step = 0; step <= Math.round(roll / HAND_ROLL_STEP) * 2; step++) {
      const turn = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2) * HAND_ROLL_STEP
      const [cx, cy, cz] = [nx * Math.cos(turn) + bx * Math.sin(turn), ny * Math.cos(turn) + by * Math.sin(turn), nz * Math.cos(turn) + bz * Math.sin(turn)]
      // The hand frame's axes: x = -sigma palm, y = -direction, z = x cross y.
      const [xx, xy, xz] = [-sigma * cx, -sigma * cy, -sigma * cz]
      const [yx, yy, yz] = [-direction.x, -direction.y, -direction.z]
      const [zx, zy, zz] = [xy * yz - xz * yy, xz * yx - xx * yz, xx * yy - xy * yx]
      // M = F^T H, by rows of F's columns against H's columns.
      const m00 = f[0] * xx + f[3] * xy + f[6] * xz
      const m10 = f[1] * xx + f[4] * xy + f[7] * xz
      const m20 = f[2] * xx + f[5] * xy + f[8] * xz
      const m11 = f[1] * yx + f[4] * yy + f[7] * yz
      const m12 = f[1] * zx + f[4] * zy + f[7] * zz
      const angles = [-sigma * Math.atan2(-m20, m00), -sigma * Math.asin(Math.max(-1, Math.min(1, m10))), Math.atan2(-m12, m11)]
      if (angles.every((angle, k) => angle - limits[k][0] >= LIMIT_MARGIN && limits[k][1] - angle >= LIMIT_MARGIN)) {
        pose[6] = angles[0]
        pose[7] = angles[1]
        pose[8] = angles[2]
        return true
      }
    }
    return false
  }

  /**
   * The hair tuck's keys (`TUCK`), solved as a pair so that the sweep goes on from the touch. For each key, 6.3's march
   * turned to the side: the fingertip point starts 1 A out from the head bone at the tragion's height and the key's
   * depth and steps in until it is the hand capsule's radius plus 0.01 A from the nearest collider; from there it backs
   * off outward in 0.01 A steps, as far as 0.2 A, and the first step with candidates gives them (`tuckCandidates`). Of
   * all touch and sweep candidates, the pair whose largest joint change from touch to sweep is least, with the angle
   * path between them clear of the proxies, gives both keys. Pairs whose touch and sweep both have the palm facing the
   * side of the head (`TUCK_PALM_ROLL`) go first, so the hand slides back along the hair; a facing touch with a sweep
   * that cannot face would turn the palm out on the way back.
   */
  private tuck(side: BodySide, form: BodyArmForm, pose: ArmPose): boolean {
    const known = this.tucked.get(`${side}:${form}`)
    if (known) {
      pose.set(known, 2)
      return true
    }
    this.headSize ??= this.measureHead()
    if (!this.headSize)
      return false
    const touches = this.tuckCandidates(side, 'hair-touch', pose, this.headSize)
    const sweeps = touches.length ? this.tuckCandidates(side, 'hair-sweep', pose, this.headSize) : []
    const pairs: { readonly touch: ArmPose, readonly sweep: ArmPose, readonly change: number, readonly facing: boolean }[] = []
    for (const touch of touches) {
      for (const sweep of sweeps) {
        let change = 0
        for (let j = 2; j <= 8; j++)
          change = Math.max(change, Math.abs(sweep.pose[j] - touch.pose[j]))
        pairs.push({ touch: touch.pose, sweep: sweep.pose, change, facing: touch.facing && sweep.facing })
      }
    }
    pairs.sort((a, b) => a.change - b.change)
    // The arm reaches the sweep from the held touch and swings a little past it as it lands, so among the pairs of
    // one facing, a sweep that keeps twice the key's headroom goes first; a rig with none keeps the plain headroom.
    for (const facing of [true, false]) {
      for (const headroom of [2 * KEY_HEADROOM, KEY_HEADROOM]) {
        for (const pair of pairs) {
          if (pair.facing !== facing || this.deepest(side, pair.sweep, pair.touch, headroom) !== null)
            continue
          this.tucked.set(`${side}:hair-touch`, pair.touch.slice(2, 9))
          this.tucked.set(`${side}:hair-sweep`, pair.sweep.slice(2, 9))
          pose.set((form === 'hair-sweep' ? pair.sweep : pair.touch).subarray(2, 9), 2)
          return true
        }
      }
    }
    return false
  }

  /**
   * The candidate keys of one tuck key at the first back-off step that has any: at each step the wrist goes a hand
   * length from the fingertips in each of `WRIST_DIRECTIONS` directions, and the elbow swings out from the form's
   * swivel to 80 degrees (`bentHand`). A candidate has every joint 2 degrees inside its limit, the hand from wrist to
   * fingertips clear of the proxies by its capsule's radius, and the pose clear of them with the settling headroom, the
   * touch's angle path from the rest arm too; each wrist direction gives its swivel with the most limit margin.
   */
  private tuckCandidates(side: BodySide, form: BodyArmForm, pose: ArmPose, head: { readonly top: number, readonly breadth: number }): { readonly pose: ArmPose, readonly facing: boolean }[] {
    const spec = ARM_FORMS[form]
    const { traits } = this
    const length = this.lengths[side].upper + this.lengths[side].forearm
    const sigma = side === 'left' ? 1 : -1
    const scale = head.breadth / TUCK.headBreadth
    const y = head.top - TUCK.tragionTop * scale
    const z = traits.head.z - (spec.sweep ?? 0) * TUCK.earBreadth * scale
    const radius = HAND_RADIUS * this.lengths[side].forearm
    const reach = radius + ANCHOR.clearance * length
    let surface: number | null = null
    for (let x = traits.head.x + sigma * ANCHOR.start * length; sigma * (x - traits.head.x) > 0; x -= sigma * ANCHOR.step * length) {
      if (this.collision.distance(x, y, z) <= reach) {
        surface = x
        break
      }
    }
    if (surface === null)
      return []
    const from = spec.after ? null : this.restArms[side]
    const hand = traits.arms[side].handLength
    for (let out = 0; out <= ANCHOR.backOff + 1e-9; out += ANCHOR.backOffStep) {
      const tip = { x: surface + sigma * out * length, y, z }
      const candidates: { readonly pose: ArmPose, readonly facing: boolean }[] = []
      for (let i = 0; i < WRIST_DIRECTIONS; i++) {
        // A Fibonacci sphere: evenly spread directions from the fingertips to the wrist.
        const up = 1 - 2 * (i + 0.5) / WRIST_DIRECTIONS
        const around = Math.sqrt(1 - up * up)
        const turn = i * Math.PI * (3 - Math.sqrt(5))
        const wrist = { x: tip.x + sigma * hand * around * Math.cos(turn), y: tip.y + hand * up, z: tip.z + hand * around * Math.sin(turn) }
        let clear = true
        for (let k = 0; k < 4 && clear; k++)
          clear = this.collision.distance(wrist.x + (tip.x - wrist.x) * k / 4, wrist.y + (tip.y - wrist.y) * k / 4, wrist.z + (tip.z - wrist.z) * k / 4) >= radius
        if (!clear)
          continue
        let best: { pose: ArmPose, facing: boolean } | null = null
        let margin = LIMIT_MARGIN
        for (let swivel = spec.swivel; swivel <= ANCHOR.swivel + 1e-9; swivel += ANCHOR.swivelStep) {
          const turned = this.bentHand(side, { wrist, tip, swivel }, pose)
          if (!turned || (best?.facing && turned !== 'facing'))
            continue
          const inside = this.limitMargin(side, pose)
          const facing = turned === 'facing'
          if ((inside >= margin || (facing && !best?.facing)) && inside >= LIMIT_MARGIN && this.deepest(side, pose, from, KEY_HEADROOM) === null) {
            margin = inside
            best = { pose: pose.slice(), facing }
          }
        }
        if (best)
          candidates.push(best)
      }
      if (candidates.length)
        return candidates
    }
    return []
  }

  /**
   * Solves the arm to `wrist` with the elbow at `swivel`, and turns the hand at the wrist so that a hand length along it
   * ends at `tip` with the palm toward the head (Moore 1985: the palm runs along the hair). 'facing' when all three
   * wrist angles turn the palm to face the side of the head within `TUCK_PALM_ROLL` (`orientHand`); otherwise 'bent'
   * when pronation turns the wrist's flexion plane onto the fingertips and flexion (3f's positive `wflex` is palmar) bends
   * the hand into it, of the two ways the one whose palm faces the head bone's midline, with no deviation. False outside
   * the limits.
   */
  private bentHand(side: BodySide, target: { readonly wrist: Readonly<Vec3>, readonly tip: Readonly<Vec3>, readonly swivel: number }, pose: ArmPose): 'facing' | 'bent' | false {
    const { wrist, tip, swivel } = target
    const length = this.lengths[side].upper + this.lengths[side].forearm
    const sigma = side === 'left' ? 1 : -1
    const shoulder = this.skeleton.arm(side, this.rest).shoulder
    const key: ArmKey = { hand: [sigma * (wrist.x - shoulder.x) / length, (wrist.y - shoulder.y) / length, (wrist.z - shoulder.z) / length], swivel, pron: 0, wflex: 0, wdev: 0 }
    if (!this.solveOnce(side, key, pose))
      return false
    this.load(side, pose, pose, 0)
    // The hand's direction in the unpronated forearm frame (row-major rotation, so the frame's axes are its columns;
    // the forearm points along -y), then `Ry(-sigma pron) Rz(-sigma wflex)` of the skeleton's hand frame applied to -y
    // solved for the two angles.
    const f = this.skeleton.arm(side, this.scratch).forearm
    const span = Math.hypot(tip.x - wrist.x, tip.y - wrist.y, tip.z - wrist.z)
    const [hx, hy, hz] = [(tip.x - wrist.x) / span, (tip.y - wrist.y) / span, (tip.z - wrist.z) / span]
    const lx = f[0] * hx + f[3] * hy + f[6] * hz
    const ly = f[1] * hx + f[4] * hy + f[7] * hz
    const lz = f[2] * hx + f[5] * hy + f[8] * hz
    const bend = Math.acos(Math.max(-1, Math.min(1, -ly)))
    const turn = Math.atan2(-lz, lx)
    const reached = this.traits.arms[side].handLength
    // The palm faces the side of the head, so the sweep slides back along it instead of turning toward the head bone.
    const inward = { x: this.traits.head.x - tip.x, y: 0, z: 0 }
    if (this.orientHand(side, pose, { x: hx, y: hy, z: hz }, inward, TUCK_PALM_ROLL)) {
      this.load(side, pose, pose, 0)
      const h = this.skeleton.arm(side, this.scratch).hand
      if (Math.hypot(h[9] - reached * h[1] - tip.x, h[10] - reached * h[4] - tip.y, h[11] - reached * h[7] - tip.z) <= ANCHOR.clearance * length)
        return 'facing'
    }
    const start = ARM_START[side]
    const pronLimit = this.traits.arms[side].twist ? JOINT_LIMITS[start + 6] : [-UNTWISTED_PRONATION, UNTWISTED_PRONATION] as const
    for (const [a, b] of [[turn, bend], [turn > 0 ? turn - Math.PI : turn + Math.PI, -bend]] as const) {
      const pron = -sigma * a
      const wflex = -sigma * b
      if (pron < pronLimit[0] || pron > pronLimit[1] || wflex < JOINT_LIMITS[start + 7][0] || wflex > JOINT_LIMITS[start + 7][1])
        continue
      pose[6] = pron
      pose[7] = wflex
      pose[8] = 0
      this.load(side, pose, pose, 0)
      const h = this.skeleton.arm(side, this.scratch).hand
      // Palmar flexion turns the fingers toward the palm, which faces the hand frame's -sigma x.
      const palm = -sigma * h[0] * (this.traits.head.x - tip.x)
      const miss = Math.hypot(h[9] - reached * h[1] - tip.x, h[10] - reached * h[4] - tip.y, h[11] - reached * h[7] - tip.z)
      if (palm > 0 && miss <= ANCHOR.clearance * length)
        return 'bent'
    }
    return false
  }

  /** The head proxies' top over the head bone and their widest span across it at the head bone's depth; null without one. */
  private measureHead(): { readonly top: number, readonly breadth: number } | null {
    const { head } = this.traits
    const length = this.lengths.left.upper + this.lengths.left.forearm
    let top: number | null = null
    for (let y = head.y + length; y > head.y; y -= 0.002 * length) {
      if (this.collision.distance(head.x, y, head.z) <= 0) {
        top = y
        break
      }
    }
    if (top === null)
      return null
    let breadth = 0
    for (let y = head.y; y < top; y += 0.01 * length) {
      for (const sigma of [1, -1]) {
        for (let x = head.x + sigma * length; sigma * (x - head.x) > 0; x -= sigma * ANCHOR.step * length) {
          if (this.collision.distance(x, y, head.z) <= 0) {
            breadth = Math.max(breadth, 2 * Math.abs(x - head.x))
            break
          }
        }
      }
    }
    return breadth > 0 ? { top, breadth } : null
  }

  /**
   * Solves `key` into `pose`'s arm angles (clavicle and fingers untouched), resolving contacts until the pose and the
   * angle path from `from` clear the proxies, the pose by `headroom` more (`KEY_HEADROOM` for a key the arm settles
   * on): a forearm or hand contact pushes the hand outward along the proxy's normal; an upper-arm contact swings the
   * elbow out instead, as the arm forms reach past the body, because pushing the hand barely moves the upper arm off
   * the trunk (a downward chop's elbow hangs into the side). False when no clear, reachable, in-limit key exists.
   */
  solve(side: BodySide, key: ArmKey, pose: ArmPose, from: ArmPose | null = null, headroom = 0): boolean {
    const hand: [number, number, number] = [key.hand[0], key.hand[1], key.hand[2]]
    const sigma = side === 'left' ? 1 : -1
    let swivel = key.swivel
    for (let step = 0; step <= PUSH_STEPS; step++) {
      if (!this.solveOnce(side, { ...key, hand, swivel }, pose))
        return false
      const contact = this.deepest(side, pose, from, headroom)
      if (!contact)
        return true
      if (!contact.forearm && swivel + ANCHOR.swivelStep <= ANCHOR.swivel + 1e-9) {
        swivel += ANCHOR.swivelStep
        continue
      }
      // 6.3: push the hand along the proxy's outward normal at the deepest sample, in the key's [out, up, forward].
      hand[0] += PUSH_STEP * sigma * contact.nx
      hand[1] += PUSH_STEP * contact.ny
      hand[2] += PUSH_STEP * contact.nz
    }
    return false
  }

  /**
   * Moves `pose`'s arm (flex to elbow) out of the proxies of the body as `channels` pose it now, by the corrector's own
   * projection (architecture 6.2): where the corrector would hold that arm this tick. Keys are cleared against the rest
   * trunk; an arm coming home must clear the trunk it comes home to.
   */
  clearOfBody(side: BodySide, pose: ArmPose, channels: ArrayLike<number>): void {
    const start = ARM_START[side]
    for (let c = 0; c < this.liveChannels.length; c++)
      this.liveChannels[c] = channels[c]
    for (let j = 2; j < 26; j++)
      this.liveChannels[start + j] = pose[j]
    this.live.prepare(this.liveChannels)
    this.live.project(side, this.liveChannels)
    for (let j = 2; j <= 5; j++)
      pose[j] = this.liveChannels[start + j]
  }

  /**
   * Writes into `via` where the hair tuck's reach passes between `rest`, the rest arm, and `key`, a tuck key
   * (`TUCK_VIA`); false when either leg's angle path does not clear the proxies, so the reach goes straight.
   */
  tuckVia(side: BodySide, rest: ArmPose, key: ArmPose, via: ArmPose): boolean {
    const shares = [TUCK_VIA.flex, TUCK_VIA.abduct, TUCK_VIA.twist, TUCK_VIA.elbow]
    for (let j = 0; j < 26; j++)
      via[j] = rest[j] + (j >= 2 && j <= 5 ? shares[j - 2] : TUCK_VIA.hand) * (key[j] - rest[j])
    return this.pathDepth(side, rest, via) === 0 && this.pathDepth(side, via, key) === 0
  }

  /** Largest margin-inclusive proxy depth along the angle path from `from` to `to`, sampled at 11 points. */
  pathDepth(side: BodySide, from: ArmPose, to: ArmPose): number {
    let depth = 0
    for (let sample = 0; sample <= PATH_SAMPLES; sample++) {
      this.load(side, from, to, sample / PATH_SAMPLES)
      depth = Math.max(depth, this.collision.measure(side, this.scratch).depth)
    }
    return depth
  }

  /** Wrist of `pose` from the shoulder joint, arm lengths `[x, y, z]` in the chest frame, rest trunk. */
  wrist(side: BodySide, pose: ArmPose): [number, number, number] {
    this.load(side, pose, pose, 0)
    const arm = this.skeleton.arm(side, this.scratch)
    const length = this.lengths[side].upper + this.lengths[side].forearm
    return [(arm.wrist.x - arm.shoulder.x) / length, (arm.wrist.y - arm.shoulder.y) / length, (arm.wrist.z - arm.shoulder.z) / length]
  }

  private solveOnce(side: BodySide, key: ArmKey, pose: ArmPose): boolean {
    const solution = solveArmKey(key, { side, upperLength: this.lengths[side].upper, forearmLength: this.lengths[side].forearm })
    if (!solution)
      return false
    pose[2] = solution.flex
    pose[3] = solution.abduct
    pose[4] = solution.twist
    pose[5] = solution.elbow
    pose[6] = this.traits.arms[side].twist ? solution.pron : Math.max(-UNTWISTED_PRONATION, Math.min(UNTWISTED_PRONATION, solution.pron))
    pose[7] = solution.wflex
    pose[8] = solution.wdev
    const start = ARM_START[side]
    for (let j = 2; j <= 8; j++) {
      const [min, max] = JOINT_LIMITS[start + j]
      if (pose[j] < min || pose[j] > max)
        return false
    }
    return true
  }

  /** The smallest distance, radians, of the arm joints (flex to wrist deviation) of `pose` from their limits. */
  private limitMargin(side: BodySide, pose: ArmPose): number {
    let margin = Infinity
    for (let j = 2; j <= 8; j++) {
      const [min, max] = JOINT_LIMITS[ARM_START[side] + j]
      margin = Math.min(margin, pose[j] - min, max - pose[j])
    }
    return margin
  }

  /**
   * The outward normal at the deepest contact of `pose` or of the path to it from `from`, and whether that sample is on
   * the forearm and hand, or null when all is clear.
   */
  private deepest(side: BodySide, pose: ArmPose, from: ArmPose | null, headroom = 0): { nx: number, ny: number, nz: number, forearm: boolean } | null {
    let best: { depth: number, nx: number, ny: number, nz: number, forearm: boolean } | null = null
    for (let sample = from ? 0 : PATH_SAMPLES; sample <= PATH_SAMPLES; sample++) {
      this.load(side, from ?? pose, pose, sample / PATH_SAMPLES)
      const d = this.collision.measure(side, this.scratch, sample === PATH_SAMPLES ? headroom : 0)
      if (d.depth > 0 && (!best || d.depth > best.depth))
        best = { depth: d.depth, nx: d.nx, ny: d.ny, nz: d.nz, forearm: d.forearm }
    }
    return best
  }

  private load(side: BodySide, from: ArmPose, to: ArmPose, fraction: number): void {
    const start = ARM_START[side]
    this.scratch.set(this.rest)
    for (let j = 0; j < 26; j++)
      this.scratch[start + j] = from[j] + (to[j] - from[j]) * fraction
  }
}
