import type { BodyCollider, BodyRigTraits, BodySide } from '../performance'
import type { BodyMeshSource, BodyModelAdjustment, BodyRestClearance } from './contracts'
import type { FittedGarment } from './fit'

import { BODY_CHANNELS, BodyCollision, DEFAULT_ARM_REST_POSE } from '../performance'
import { ARM_START, DEG, SIDES } from '../performance/channels'

/**
 * The rest solve never opens an arm beyond this abduction to clear a hard volume: 10 degrees beyond the default hang.
 * On the 32 library rigs (2026-11-24) the fit clears at 12 to 21 degrees on 26 and at 25 to 42 on the other six, whose
 * slices take in wide rigid geometry at the waist or hips. Bounded at 22, none of the six rests more than 8 degrees
 * wider than `main` holds it.
 */
const REST_ABDUCT_MAX = 22 * DEG
const REST_STEP = 1 * DEG
/**
 * The resting arm keeps this share of its segment length beyond the arm test's own margin, as the runtime solver did:
 * the standing sway carries the arm toward the hips by up to 0.1 model units.
 */
const REST_CLEARANCE = 0.03
/**
 * Rule 7: the most a garment adds to the rest abduction to bring the arm clear of its rest shape, radians. The style
 * system may later choose inside this range. Hard volumes already open the arms of the coat and skirt rigs by 1 to 7
 * degrees (2026-11-24), and the accepted cost is 8 degrees a rig.
 */
export const REST_GARMENT_CLEARANCE_MAX = 6 * DEG
/**
 * A free-swinging garment settles and sways outside its bind shape, so the arm clears its rest shape by this much
 * more. Measured with the arm at the abduction that just clears the bind shape and beyond it: Iuno's skirt is pierced
 * in 94 % of idle frames at 15 degrees, 12 % at 17 and none at 18; Carlotta's dress in 9 % at 16 and none at 17. A
 * locked garment stays where it was bound (Chisa and Denia clear at the bind shape).
 */
const GARMENT_SWAY = 3 * DEG
/**
 * When no abduction inside `REST_GARMENT_CLEARANCE_MAX` clears every garment, the arm opens at most this far, to where
 * it overlaps the rest shapes least. A wide dress is then left to the simulator instead of holding the arms out.
 */
const REST_GARMENT_SETTLE_MAX = 4 * DEG
/**
 * An arm whose centreline still lies inside a free-swinging garment opens further, to the smallest abduction that takes
 * it out, and never past this one. A garment that still holds it at the final rest is pinched. Measured with the
 * author's collision groups (2026-11-24): where the centreline leaves the rest shape the skirt is no longer pierced
 * (Sunna at 27 degrees, Vivian at 24), and 28 degrees is 8 degrees beyond where `main` holds those rigs.
 */
const REST_PINCH_ABDUCT_MAX = 28 * DEG
/**
 * The widest rest the solve opens an arm to, to clear a garment the simulator collides with the arm: 30 degrees, which
 * is as far as the runtime hang solver this model replaced lifted an arm (a hang of 60 degrees below horizontal).
 * Measured over 40 s of idle (2026-11-24): Sigrika's bag, which her author's groups collide with the arm, makes 6.2 %
 * of her cloth vertices reverse a sample with the left arm at 17 degrees, 2.2 % at 23, where the capsule just clears
 * its rest shape, and 0.1 % at 25, where it clears with `REST_CLEARANCE`. Aha's gown is pierced in 14 % of frames at
 * 23 and 22 degrees and in none at 30 and 29.
 */
const REST_COLLIDING_GARMENT_ABDUCT_MAX = 30 * DEG
/** A volume no rest abduction clears loses this share of its size a step, and is dropped below `VOLUME_SCALE_MIN`. */
const VOLUME_SHRINK = 0.9
const VOLUME_SCALE_MIN = 0.3
/** The arm test's capsule radius, as a share of the segment: taking it off leaves the arm's centreline. */
const ARM_TEST_RADIUS = 0.15
/**
 * A garment whose bones the joint limits let move this share of the shoulder span or less is locked: its cloth trails
 * only as far as the simulator's soft joints give, so it cannot swing back onto an arm that rests in it and is never
 * pinched. The garments of the library fall on either side of a gap from 0.02 to 0.055.
 */
const LOCKED_MOBILITY_MAX = 0.05

/** The skeleton the arm test needs, read from the mesh source. Only the fields the test reads carry meaning. */
export function restTraits(source: BodyMeshSource): Omit<BodyRigTraits, 'colliders'> {
  const { bones, canonical } = source
  const at = (bone: number) => bones[bone].position
  const hips = at(canonical.hips)
  const arm = (side: BodySide) => {
    const { clavicle, upper, lower, hand } = canonical.arms[side]
    const shoulder = at(upper)
    const elbow = at(lower)
    const wrist = at(hand)
    const forearm = { x: wrist.x - elbow.x, y: wrist.y - elbow.y, z: wrist.z - elbow.z }
    return {
      shoulder,
      clavicle: clavicle === null ? null : at(clavicle),
      upperArm: { x: elbow.x - shoulder.x, y: elbow.y - shoulder.y, z: elbow.z - shoulder.z },
      forearm,
      handLength: 0.65 * Math.hypot(forearm.x, forearm.y, forearm.z),
      fingers: 'none' as const,
      twist: false,
    }
  }
  let underHips = false
  for (let bone = bones[canonical.spine[0]].parent, steps = 0; bone >= 0 && steps < bones.length; bone = bones[bone].parent, steps++)
    underHips ||= bone === canonical.hips
  const legs = canonical.legs
  const foot = (side: BodySide) => ({ ankle: legs ? at(legs[side].foot) : hips, toe: null, heelBack: 0, toeBend: false, toeIk: false })
  const legLength = legs
    ? Math.hypot(at(legs.left.upper).x - at(legs.left.lower).x, at(legs.left.upper).y - at(legs.left.lower).y, at(legs.left.upper).z - at(legs.left.lower).z)
    + Math.hypot(at(legs.left.lower).x - at(legs.left.foot).x, at(legs.left.lower).y - at(legs.left.foot).y, at(legs.left.lower).z - at(legs.left.foot).z)
    : 0
  return {
    // The rest pose moves no pelvis channel, so a rig without legs takes any positive length.
    legLength: legLength > 0 ? legLength : 1,
    hips,
    spineChain: canonical.spine.map(at),
    spineParent: underHips ? 'hips' : 'root',
    neck: at(canonical.neck),
    head: at(canonical.head),
    arms: { left: arm('left'), right: arm('right') },
    feet: { left: foot('left'), right: foot('right') },
    legIk: false,
    legs: null,
    eyeYawLimit: 0,
    eyePitchLimit: 0,
  }
}

function restChannels(): Float32Array {
  const channels = new Float32Array(BODY_CHANNELS.length)
  const pose = DEFAULT_ARM_REST_POSE
  for (const side of SIDES)
    channels.set([pose.clavElev, pose.clavProt, pose.flex, pose.abduct, pose.twist, pose.elbow, pose.pron, pose.wflex, pose.wdev], ARM_START[side])
  return channels
}

function scaled(collider: BodyCollider, scale: number): BodyCollider {
  switch (collider.shape) {
    case 'sphere':
      return { ...collider, radius: collider.radius * scale }
    case 'capsule':
      return { ...collider, radius: collider.radius * scale, length: collider.length * scale }
    case 'box':
      return { ...collider, halfSize: { x: collider.halfSize.x * scale, y: collider.halfSize.y * scale, z: collider.halfSize.z * scale } }
  }
}

export interface RestSolution {
  readonly volumes: readonly BodyCollider[]
  readonly rest: Record<BodySide, BodyRestClearance>
  /** By garment index. */
  readonly pinched: readonly boolean[]
  /** `rest-clearance` adjustments; `volume` indexes the fitted list the solve was given. */
  readonly adjustments: readonly BodyModelAdjustment[]
  /** The fitted index of each returned volume. */
  readonly kept: readonly number[]
}

/**
 * README rules 6 to 8. The resting arm is the performer's default rest pose, tested by the performer's own arm test
 * (`BodyCollision.measure`), so what the solve clears is what the corrector clears.
 *
 * - Hard volumes: the smallest abduction from the default up to `REST_ABDUCT_MAX` that clears them all with
 *   `REST_CLEARANCE` to spare. When none does, the volume the least obstructed pose is deepest in shrinks, and the scan
 *   repeats.
 * - Garments: up to `REST_GARMENT_CLEARANCE_MAX` more, to the smallest abduction that clears every garment's rest shape
 *   (a free-swinging one by `GARMENT_SWAY` more), or else up to `REST_GARMENT_SETTLE_MAX` more, to the least overlap.
 * - Then an arm whose centreline still lies inside a free-swinging garment opens, up to `REST_PINCH_ABDUCT_MAX`, to the
 *   smallest abduction that takes it out of them all, or else leaves it inside the fewest. They are tested together:
 *   opened for one garment at a time, the arm could leave one and end inside another it had been clear of.
 * - Last, the garments the simulator collides with the arm: when the arm's capsule still overlaps the rest shape of one
 *   and its centreline is out of it, the arm opens to the smallest abduction that clears them all with `REST_CLEARANCE`
 *   to spare, as for a hard volume, up to `REST_COLLIDING_GARMENT_ABDUCT_MAX`. They are tested together, so the result
 *   does not depend on their order. The simulator pushes such a garment off the arm on every step, so an arm that
 *   leans on its edge keeps it moving. An arm whose centreline is inside is in the garment, and the simulator drapes
 *   the cloth around it; that garment is left out of the test.
 * - A free-swinging garment that holds the centreline of either arm at its final rest, after every pass, is pinched.
 */
export function solveRest(traits: Omit<BodyRigTraits, 'colliders'>, fitted: readonly BodyCollider[], garments: readonly FittedGarment[]): RestSolution {
  const channels = restChannels()
  const abductOf = (side: BodySide) => ARM_START[side] + 3
  const pose = (side: BodySide, abduct: number) => {
    channels[abductOf(side)] = abduct
    return channels
  }
  // Unfitted: the corrector would shrink whatever the default rest touches, which is what this solve opens the arm for.
  const tester = (colliders: readonly BodyCollider[]) => new BodyCollision({ ...traits, colliders }, restChannels(), false)
  const scales = fitted.map(() => 1)
  const blockedBy: Record<BodySide, number | null> = { left: null, right: null }
  const abduct = { left: DEFAULT_ARM_REST_POSE.abduct, right: DEFAULT_ARM_REST_POSE.abduct }
  let volumes: BodyCollider[] = []
  let kept: number[] = []
  let hard: BodyCollision | null = null
  // Every pass either clears both arms or shrinks one volume, and a volume is dropped after `shrinkSteps` steps.
  const shrinkSteps = Math.ceil(Math.log(VOLUME_SCALE_MIN) / Math.log(VOLUME_SHRINK)) + 1
  for (let pass = 0; pass <= fitted.length * shrinkSteps; pass++) {
    kept = fitted.map((_, index) => index).filter(index => scales[index] > 0)
    volumes = kept.map(index => scaled(fitted[index], scales[index]))
    hard = volumes.length ? tester(volumes) : null
    let blocked: { side: BodySide, abduct: number } | null = null
    for (const side of SIDES) {
      let least = Infinity
      let leastAt = DEFAULT_ARM_REST_POSE.abduct
      let clear = false
      for (let value = DEFAULT_ARM_REST_POSE.abduct; value <= REST_ABDUCT_MAX + 1e-9; value += REST_STEP) {
        const depth = hard ? hard.measure(side, pose(side, value), REST_CLEARANCE).depth : 0
        if (depth <= 0) {
          abduct[side] = value
          clear = true
          break
        }
        if (depth < least) {
          least = depth
          leastAt = value
        }
      }
      pose(side, DEFAULT_ARM_REST_POSE.abduct)
      if (!clear) {
        blocked = { side, abduct: leastAt }
        break
      }
    }
    if (!blocked)
      break
    let deepest = -1
    let depth = 0
    volumes.forEach((volume, index) => {
      const own = tester([volume]).measure(blocked.side, pose(blocked.side, blocked.abduct), REST_CLEARANCE).depth
      if (own > depth) {
        depth = own
        deepest = index
      }
    })
    pose(blocked.side, DEFAULT_ARM_REST_POSE.abduct)
    if (deepest < 0)
      break
    const index = kept[deepest]
    scales[index] *= VOLUME_SHRINK
    if (scales[index] < VOLUME_SCALE_MIN)
      scales[index] = 0
    blockedBy[blocked.side] = index
  }

  const span = Math.hypot(traits.arms.left.shoulder.x - traits.arms.right.shoulder.x, traits.arms.left.shoulder.y - traits.arms.right.shoulder.y, traits.arms.left.shoulder.z - traits.arms.right.shoulder.z)
  const shapes = garments.map(garment => garment.silhouette.length ? tester(garment.silhouette) : null)
  const swings = garments.map(garment => garment.mobility > LOCKED_MOBILITY_MAX * span)
  /** The deepest overlap of the arm with a garment's rest shape, and that garment; `swinging` asks about the free ones alone. */
  const overlap = (side: BodySide, value: number, extra: number, swinging = false) => {
    let deepest = 0
    let garment = -1
    shapes.forEach((shape, index) => {
      const depth = shape && (!swinging || swings[index]) ? shape.measure(side, pose(side, value), extra).depth : 0
      if (depth > deepest) {
        deepest = depth
        garment = index
      }
    })
    pose(side, DEFAULT_ARM_REST_POSE.abduct)
    return { depth: deepest, garment }
  }
  const hardClear = (side: BodySide, value: number) => {
    const clear = !hard || hard.measure(side, pose(side, value), REST_CLEARANCE).depth <= 0
    pose(side, DEFAULT_ARM_REST_POSE.abduct)
    return clear
  }
  const centreline = -ARM_TEST_RADIUS
  /** The free-swinging garments whose rest shape holds the arm's centreline at this abduction. */
  const holding = (side: BodySide, value: number) => {
    const held = shapes.flatMap((shape, index) =>
      shape && swings[index] && shape.measure(side, pose(side, value), centreline).depth > 0 ? [index] : [])
    pose(side, DEFAULT_ARM_REST_POSE.abduct)
    return held
  }
  const pinched = garments.map(() => false)
  const limit: Record<BodySide, BodyRestClearance['limit']> = { left: null, right: null }
  for (const side of SIDES) {
    const from = abduct[side]
    // Clear of every garment: the capsule out of each rest shape, and a free-swinging one by `GARMENT_SWAY` more.
    const clearOfGarments = (value: number) => shapes.every((shape, index) =>
      !shape || shape.measure(side, pose(side, swings[index] ? value - GARMENT_SWAY : value), 0).depth <= 0)
    let cleared: number | null = null
    for (let value = from; cleared === null && value <= from + REST_GARMENT_CLEARANCE_MAX + 1e-9; value += REST_STEP) {
      if (hardClear(side, value) && clearOfGarments(value))
        cleared = value
    }
    pose(side, DEFAULT_ARM_REST_POSE.abduct)
    let best = cleared ?? from
    if (cleared === null) {
      // Out of reach: as near to capsule-clear as the settle range gets.
      let least = overlap(side, best, 0).depth
      for (let value = from + REST_STEP; least > 0 && value <= from + REST_GARMENT_SETTLE_MAX + 1e-9; value += REST_STEP) {
        if (!hardClear(side, value))
          continue
        const depth = overlap(side, value, 0).depth
        if (depth < least) {
          least = depth
          best = value
        }
      }
    }
    // The centreline out of the free-swinging garments, tested together: the smallest abduction up to
    // `REST_PINCH_ABDUCT_MAX` that leaves it inside the fewest of them. Opened for one garment at a time, the arm could
    // leave one and end inside another.
    let fewest = holding(side, best).length
    for (let value = best + REST_STEP; fewest > 0 && value <= REST_PINCH_ABDUCT_MAX + 1e-9; value += REST_STEP) {
      const count = hardClear(side, value) ? holding(side, value).length : fewest
      if (count < fewest) {
        fewest = count
        best = value
      }
    }
    // Clear of the garments the simulator collides with the arm, when the arm leans on the edge of one. They are tested
    // together, so the arm never opens past one of them into another. A garment that holds the arm's centreline is not
    // among them: the arm is in it.
    const pushed = shapes.flatMap((shape, index) =>
      shape && garments[index].collidesWithArm && shape.measure(side, pose(side, best), centreline).depth <= 0 ? [shape] : [])
    if (pushed.some(shape => shape.measure(side, pose(side, best), 0).depth > 0)) {
      for (let value = best + REST_STEP; value <= REST_COLLIDING_GARMENT_ABDUCT_MAX + 1e-9; value += REST_STEP) {
        if (hardClear(side, value) && pushed.every(shape => shape.measure(side, pose(side, value), REST_CLEARANCE).depth <= 0)) {
          best = value
          break
        }
      }
    }
    pose(side, DEFAULT_ARM_REST_POSE.abduct)
    abduct[side] = best
    // Pinched is read from the final rest, after both garment passes: the last pass can open the arm into a garment.
    for (const index of holding(side, best))
      pinched[index] = true
    const remaining = overlap(side, best, 0)
    const blockedIndex = blockedBy[side]
    if (blockedIndex !== null)
      limit[side] = { kind: 'volume', index: kept.includes(blockedIndex) ? kept.indexOf(blockedIndex) : null }
    else if (remaining.garment >= 0)
      limit[side] = { kind: 'garment', index: remaining.garment }
  }
  const adjustments: BodyModelAdjustment[] = []
  scales.forEach((scale, index) => {
    if (scale < 1)
      adjustments.push({ volume: index, bone: fitted[index].bone, scale, reason: 'rest-clearance' })
  })
  return {
    volumes,
    rest: { left: { abduct: abduct.left, limit: limit.left }, right: { abduct: abduct.right, limit: limit.right } },
    pinched,
    adjustments,
    kept,
  }
}
