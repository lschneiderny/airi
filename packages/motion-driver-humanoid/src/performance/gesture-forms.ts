import type { ArmKey } from './arm-key'
import type { BodySide } from './channels'
import type { BodyArmForm, BodyGestureForm, BodyRigTraits } from './contracts'
import type { HandShape } from './hand-shapes'

import { solveArmKey } from './arm-key'
import { DEFAULT_ARM_REST_POSE } from './arms'
import { ARM_START, DEG, JOINT_LIMITS } from './channels'
import { BodyCollision } from './collision'
import { HAND_SHAPES } from './hand-shapes'
import { BodySkeleton } from './skeleton'

export type SpeechGestureForm = Exclude<BodyGestureForm, BodyArmForm>

/** One form of architecture 4a's table with unit A's amplitude scale. Angles in radians, times in seconds. */
export interface GestureFormSpec {
  readonly shape: HandShape
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
  'beat': { shape: 'relaxed', stroke: [0, -0.06, 0.03], scale: 2, pron: 20 * DEG, wflex: 10 * DEG, wdev: 0, strokeSeconds: 0.11, hold: [0.1, 0.25], hands: 'one' },
  'palm-up': { shape: 'open', stroke: [0.1, -0.02, 0.08], scale: 2, pron: -70 * DEG, wflex: -12 * DEG, wdev: 0, strokeSeconds: 0.16, hold: [0.3, 0.8], hands: 'either' },
  'press': { shape: 'flat', stroke: [0, -0.1, 0.02], scale: 2, pron: 80 * DEG, wflex: -8 * DEG, wdev: 0, strokeSeconds: 0.15, hold: [0.25, 0.6], hands: 'either' },
  'point': { shape: 'point', stroke: [-0.02, 0.04, 0.16], scale: 1.46, pron: 60 * DEG, wflex: 0, wdev: 0, strokeSeconds: 0.14, hold: [0.3, 0.7], hands: 'one' },
  'chop': { shape: 'flat', stroke: [0, -0.14, 0.04], scale: 1.55, pron: 0, wflex: 0, wdev: 10 * DEG, strokeSeconds: 0.13, hold: [0.1, 0.2], hands: 'one' },
  'frame': { shape: 'open', stroke: [0.05, -0.03, 0], scale: 2, pron: 0, wflex: 0, wdev: 0, strokeSeconds: 0.15, hold: [0.3, 0.8], hands: 'two' },
}

/**
 * The held arm forms (4a, 4e): hand shape, palm orientation and the contact anchor they reach for; the thinking hand
 * stops 0.04 A short of its chin anchor. `anchor` moves the seed toward the arm's own side and up, in arm lengths: the
 * hand rests on the upper chest beside the sternum, and comes to the chin and jaw from the side. The yawn's hand covers
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
 */
export const ARM_FORMS: Readonly<Record<BodyArmForm, { readonly shape: HandShape, readonly pron: number, readonly wflex: number, readonly swivel: number, readonly short: number, readonly seed: 'chest' | 'chin' | 'front-low', readonly anchor: { readonly side: number, readonly up: number }, readonly hands: 'one' | 'both' }>> = {
  'hand-to-chest': { shape: 'relaxed', pron: 75 * DEG, wflex: -10 * DEG, swivel: 25 * DEG, short: 0, seed: 'chest', anchor: { side: 0.05, up: 0.05 }, hands: 'one' },
  'thinking-hand': { shape: 'point', pron: 20 * DEG, wflex: -20 * DEG, swivel: 10 * DEG, short: 0.04, seed: 'chin', anchor: { side: 0.1, up: 0 }, hands: 'one' },
  'cover-mouth': { shape: 'relaxed', pron: 20 * DEG, wflex: -20 * DEG, swivel: 10 * DEG, short: 0.06, seed: 'chin', anchor: { side: 0.08, up: 0 }, hands: 'one' },
  // 4e act 8's temple anchor: 0.25 A above the chin seed (eye height on an adult head, an estimate), 0.14 A to the
  // side, the narrowest offset in 0.04 A steps at which Chisa's and Ellen's arms solve it (E/g4/a/scratch/probe-hair.ts).
  'hair-touch': { shape: 'relaxed', pron: 20 * DEG, wflex: -20 * DEG, swivel: 10 * DEG, short: 0.04, seed: 'chin', anchor: { side: 0.14, up: 0.25 }, hands: 'one' },
  'clasp': { shape: 'relaxed', pron: 45 * DEG, wflex: 0, swivel: 15 * DEG, short: 0, seed: 'front-low', anchor: { side: 0, up: 0 }, hands: 'both' },
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

/** The rest pose's thumb opposition, degrees (`BodyArms` rest). */
const REST_OPPOSITION = 10
const OPPOSED_THUMB = 40
/**
 * Room a key the arm settles on (the ready key it returns to between strokes) leaves around itself beyond the
 * corrector's margin, as a share of each segment's length: 3.5 degrees of elbow at the middle of the forearm, the
 * measured settle past a fed-forward preparation's key (1.9 degrees, Chisa) plus the elbow's moving-hold noise (1.2
 * degrees, `ARM_NOISE_DEGREES`). Such a key clears it, so the arm does not touch the margin while it arrives and holds;
 * paths and brief stroke keys clear the margin itself.
 */
export const KEY_HEADROOM = 0.05
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
/** No joint of an arm form sits within this of its limit. */
const LIMIT_MARGIN = 2 * DEG
/** The corrector's capsule radius as a share of its segment: the hand is the extended forearm's capsule. */
const HAND_RADIUS = 0.15
/**
 * A rig without forearm twist bones holds pronation inside 60 degrees (the performer clamps it there); keys stay 5
 * degrees inside, the active forearm follower's overshoot (zeta 0.7, about 5 % of a 90 degree turn).
 */
const UNTWISTED_PRONATION = 55 * DEG

/** Writes a 4a hand shape's finger curls, spread and thumb opposition into a side's pose. */
export function writeHandShape(shape: HandShape, pose: ArmPose): void {
  const spec = HAND_SHAPES[shape]
  const curls = DEFAULT_ARM_REST_POSE.fingerCurl
  pose[9] = spec.thumb * DEG
  pose[10] = pose[11] = 0
  for (let finger = 0; finger < 4; finger++) {
    // `scaled` keeps the rest pose's proportions between the index and the other fingers.
    const ratio = curls[finger + 1][0] / curls[1][0]
    for (let joint = 0; joint < 3; joint++) {
      const curl = finger === 0 || spec.others === 'same'
        ? spec.index[joint]
        : spec.others === 'scaled' ? spec.index[joint] * ratio : spec.others[joint]
      pose[12 + finger * 3 + joint] = curl * DEG
    }
  }
  pose[24] = spec.spread * DEG
  pose[25] = (spec.thumbAcross ? OPPOSED_THUMB : REST_OPPOSITION) * DEG
}

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

  /** 4a's ready key at `energy`; `outward` moves the hand out in arm lengths, `swivel` adds degrees. */
  readyKey(energy: number, outward = 0, swivel = 0): ArmKey {
    const lift = Math.max(0, Math.min(1, energy))
    return { hand: [-0.05 + outward, -0.6 + 0.22 * lift, 0.42], swivel: (20 + swivel) * DEG, pron: 20 * DEG, wflex: -5 * DEG, wdev: 0 }
  }

  /** The stroke key of `form` from `ready`, by size factor `size` (gain x scale x amplitude), yawed by `yaw` radians. */
  strokeKey(ready: ArmKey, form: SpeechGestureForm, size: number, yaw = 0): ArmKey {
    const spec = GESTURE_FORMS[form]
    const [x, y, z] = spec.stroke
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
   *   is 2 degrees inside its limit and the pose and the angle path from the rest arm clear the proxies; the first
   *   step with one wins, with the swivel that leaves the most limit margin.
   *
   * False when no step within 0.2 A of the anchor has such a key.
   */
  armForm(side: BodySide, form: BodyArmForm, pose: ArmPose): boolean {
    if (this.unreachable.has(`${side}:${form}`))
      return false
    const spec = ARM_FORMS[form]
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
        if (inside >= LIMIT_MARGIN && inside > margin && this.deepest(side, pose, this.restArms[side], KEY_HEADROOM) === null) {
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
