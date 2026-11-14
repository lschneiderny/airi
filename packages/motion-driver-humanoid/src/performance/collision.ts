import type { Vec3 } from '../types'
import type { BodySide } from './channels'
import type { BodyCapabilities, BodyCollider, BodyLegJoints, BodyPerformanceInput, BodyRigTraits } from './contracts'
import type { BodyTransform } from './skeleton'

import { solveArmKey } from './arm-key'
import { ARM_START, BODY_CHANNELS, BODY_TICK, DEG, JOINT_LIMITS, SIDES } from './channels'
import { colliderDistance, proxyColliders } from './colliders'
import { BodySkeleton, composeTransform, identityTransform, setRotation } from './skeleton'

export { colliderDistance, proxyColliders } from './colliders'

/** The guard weight's critically damped response, rad/s: the reaction layer's inertialisation rate (architecture 3g). */
const GUARD_OMEGA = 14
/**
 * The soft skin outside the margin of every proxy while the gait carries the body, as a share of the segment length at
 * a gait weight of 1: the margin's own thickness. An arm entering it is pushed back by a smooth function of its depth
 * there, so a thigh that swings into the arm, or a trunk the walk twists into it, slows it over several ticks instead of
 * stopping it dead at the margin, and the arm never passes the margin.
 */
const SKIN = 0.03

/** Writes the rotation by `angle` about the unit axis (x, y, z) into a transform's row-major 3x3, as `setRotation` does. */
function setAxisAngle(out: BodyTransform, x: number, y: number, z: number, angle: number): void {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  const t = 1 - c
  out[0] = c + x * x * t
  out[1] = x * y * t - z * s
  out[2] = x * z * t + y * s
  out[3] = y * x * t + z * s
  out[4] = c + y * y * t
  out[5] = y * z * t - x * s
  out[6] = z * x * t - y * s
  out[7] = z * y * t + x * s
  out[8] = c + z * z * t
}

/** Makes `out` the rotation `out`'s 3x3 holds about the point `p`: x -> R (x - p) + p. */
function pivotAbout(out: BodyTransform, p: Readonly<Vec3>): void {
  out[9] = p.x - (out[0] * p.x + out[1] * p.y + out[2] * p.z)
  out[10] = p.y - (out[3] * p.x + out[4] * p.y + out[5] * p.z)
  out[11] = p.z - (out[6] * p.x + out[7] * p.y + out[8] * p.z)
}

/** Owns scratch FK and persistent correction. The final sampled capsule test is authoritative. */
export class BodyCollision {
  /** The arm capabilities the proxies decide; the performer adds the clasp and the hair tuck, which need the gesture keys. */
  readonly capabilities: Omit<BodyCapabilities, 'clasp' | 'hairTouch'>
  readonly correction = { left: 0, right: 0 }
  readonly penetration = { left: 0, right: 0 }
  readonly headPenetration = { left: 0, right: 0 }
  /** Arms held at their last valid pose because no pose cleared the proxies: count, and the latest side, depth and tick. */
  readonly collisions: { count: number, last: { side: BodySide, depth: number, tick: number } | null } = { count: 0, last: null }
  /**
   * Arm ticks on which a fallback ran: the 6 degree cap bounded a projection step, or the projection left more than
   * the depth budget and the guard weight was searched. Counters only; they never change a channel.
   */
  readonly corrector = { capHits: 0, guardScans: 0 }
  /**
   * Each side's continuous guard weight and its rate: a critically damped follower of the smallest weight that clears
   * the arm, never below the smallest weight that keeps it inside the depth budget.
   */
  private readonly guardWeight = { left: { weight: 0, rate: 0 }, right: { weight: 0, rate: 0 } }
  private readonly blendBase = new Float64Array(4)
  /** Each side's last arm, hand and finger channels that cleared every proxy. */
  private readonly valid = new Float64Array(BODY_CHANNELS.length)
  private readonly skeleton: BodySkeleton
  private readonly colliders: readonly BodyCollider[]
  private readonly posed: ReturnType<typeof identityTransform>[]
  /** Each leg's thigh and shin motion in the hips frame (about the hips bone), set by `prepare` while the gait carries the feet. */
  private readonly legPose = {
    left: { thigh: identityTransform(), shin: identityTransform() },
    right: { thigh: identityTransform(), shin: identityTransform() },
  }

  private readonly legScratch = identityTransform()
  /**
   * The gait weight of the latest `prepare`, 0 without a gait. The skin grows with it, so it closes in on an arm that
   * already rests near a proxy over the gait's blend instead of pushing it out on the first walking tick.
   */
  private gaitWeight = 0
  /** Each side's skin thickness in model units: `SKIN` of the shorter arm segment, so it is never thicker than a sample's own. */
  private readonly skin: Record<BodySide, number>
  private readonly local = identityTransform()
  private readonly angles = new Float64Array(3)
  private readonly previous = new Float64Array(BODY_CHANNELS.length)
  private readonly guard = new Float64Array(BODY_CHANNELS.length)
  private readonly original = new Float64Array(BODY_CHANNELS.length)
  private readonly point = { x: 0, y: 0, z: 0 }
  private readonly normal = { x: 0, y: 0, z: 0 }
  /** `over` is the deepest sample's depth beyond the depth budget, half the margin: 0.015 of its segment length. */
  private readonly deepest = { depth: 0, head: 0, over: -Infinity, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, forearm: false }

  constructor(private readonly traits: BodyRigTraits, rest: Float32Array) {
    this.skeleton = new BodySkeleton(traits)
    const skin = (side: BodySide) => {
      const { upperArm, forearm } = traits.arms[side]
      return SKIN * Math.min(Math.hypot(upperArm.x, upperArm.y, upperArm.z), Math.hypot(forearm.x, forearm.y, forearm.z))
    }
    this.skin = { left: skin('left'), right: skin('right') }
    this.colliders = traits.colliders.length ? traits.colliders : proxyColliders(traits)
    this.posed = this.colliders.map(() => identityTransform())
    this.prepare(rest)
    const gestures = { left: false, right: false }
    const headClearance = { left: false, right: false }
    const guard = rest.slice()
    this.guard.set(rest)
    for (const side of SIDES) {
      const start = ARM_START[side]
      guard[start + 2] = 10 * DEG
      guard[start + 3] = 45 * DEG
      guard[start + 4] = 0
      guard[start + 5] = 20 * DEG
      gestures[side] = this.measure(side, guard).depth <= 0
      if (gestures[side]) {
        for (let j = 2; j <= 5; j++)
          this.guard[start + j] = guard[start + j]
      }
      headClearance[side] = gestures[side] && this.headProbe(side, guard)
    }
    this.capabilities = { gestures, headClearance }
    this.valid.set(rest)
    this.correct(rest, 0)
    this.previous.fill(0)
    this.collisions.count = 0
    this.collisions.last = null
    this.corrector.capHits = 0
    this.corrector.guardScans = 0
    for (const side of SIDES) {
      this.guardWeight[side].weight = 0
      this.guardWeight[side].rate = 0
    }
  }

  private headProbe(side: BodySide, channels: Float32Array): boolean {
    const arm = this.traits.arms[side]
    const upperLength = Math.hypot(arm.upperArm.x, arm.upperArm.y, arm.upperArm.z)
    const forearmLength = Math.hypot(arm.forearm.x, arm.forearm.y, arm.forearm.z)
    const length = upperLength + forearmLength
    let radius = 0
    for (let i = 0; i < this.colliders.length; i++) {
      const collider = this.colliders[i]
      if (collider.bone !== 'head')
        continue
      const extent = collider.shape === 'box' ? Math.hypot(collider.halfSize.x, collider.halfSize.y, collider.halfSize.z) : collider.radius + (collider.shape === 'capsule' ? collider.length / 2 : 0)
      radius = Math.max(radius, extent + Math.hypot(collider.centre.x, collider.centre.y, collider.centre.z))
    }
    if (radius === 0)
      return false
    const sigma = side === 'left' ? 1 : -1
    const shoulder = this.skeleton.arm(side, channels).shoulder
    // A conservative head-side anchor includes the gate's extended forearm radius and margin.
    const solution = solveArmKey({
      hand: [(sigma * (this.traits.head.x - shoulder.x) + radius + 0.15 * forearmLength) / length, (this.traits.head.y - shoulder.y) / length, (this.traits.head.z - shoulder.z) / length],
      swivel: 0,
      pron: 0,
      wflex: 0,
      wdev: 0,
    }, { side, upperLength, forearmLength })
    if (!solution)
      return false
    const start = ARM_START[side]
    channels[start + 2] = solution.flex
    channels[start + 3] = solution.abduct
    channels[start + 4] = solution.twist
    channels[start + 5] = solution.elbow
    for (let j = 2; j <= 5; j++) {
      if (channels[start + j] < JOINT_LIMITS[start + j][0] || channels[start + j] > JOINT_LIMITS[start + j][1])
        return false
    }
    return this.measure(side, channels).depth <= 0
  }

  /**
   * Poses the proxies for `channels`. While `gait` carries the feet (weight above 0, with ankle targets), each leg body
   * also turns with its thigh or shin as the leg IK places it, by the gait's weight; otherwise leg bodies stay with the
   * hips, as at bind.
   */
  prepare(channels: ArrayLike<number>, gait: BodyPerformanceInput['gait'] = null): void {
    this.skeleton.update(channels)
    const legs = this.traits.legs
    const ankles = gait && gait.weight > 0 ? gait.ankles : null
    this.gaitWeight = gait ? gait.weight : 0
    if (legs && ankles && gait) {
      for (const side of SIDES)
        this.poseLeg(side, legs[side], ankles[side], gait.weight)
    }
    for (let i = 0; i < this.colliders.length; i++) {
      const collider = this.colliders[i]
      this.angles[0] = collider.rotation.yaw
      this.angles[1] = collider.rotation.pitch
      this.angles[2] = collider.rotation.roll
      setRotation(this.local, this.angles)
      this.local[9] = collider.centre.x
      this.local[10] = collider.centre.y
      this.local[11] = collider.centre.z
      if (legs && ankles && collider.leg) {
        composeTransform(this.legScratch, this.legPose[collider.leg.side][collider.leg.segment], this.local)
        composeTransform(this.posed[i], this.skeleton.frames[collider.bone], this.legScratch)
      }
      else {
        composeTransform(this.posed[i], this.skeleton.frames[collider.bone], this.local)
      }
    }
  }

  /**
   * Solves one leg as the MMD foot stage seeds its IK (`stage-ui-mmd` `feet.ts`): the knee bends about the lateral axis
   * until hip to ankle spans the target's distance, then the smallest rotation about the hip points the leg at the
   * target. Both are scaled by `weight`. The result is in the hips frame, about the hips bone.
   */
  private poseLeg(side: BodySide, joints: BodyLegJoints, ankle: Readonly<Vec3>, weight: number): void {
    const hips = this.skeleton.frames.hips
    const origin = this.traits.hips
    const hip = { x: joints.hip.x - origin.x, y: joints.hip.y - origin.y, z: joints.hip.z - origin.z }
    const knee = { x: joints.knee.x - origin.x, y: joints.knee.y - origin.y, z: joints.knee.z - origin.z }
    const ux = joints.knee.x - joints.hip.x
    const uy = joints.knee.y - joints.hip.y
    const uz = joints.knee.z - joints.hip.z
    const vx = joints.ankle.x - joints.knee.x
    const vy = joints.ankle.y - joints.knee.y
    const vz = joints.ankle.z - joints.knee.z
    // The target in the hips frame, from the hip joint: the transpose of the hips rotation undoes it.
    const dx = ankle.x - hips[9]
    const dy = ankle.y - hips[10]
    const dz = ankle.z - hips[11]
    const tx = hips[0] * dx + hips[3] * dy + hips[6] * dz - hip.x
    const ty = hips[1] * dx + hips[4] * dy + hips[7] * dz - hip.y
    const tz = hips[2] * dx + hips[5] * dy + hips[8] * dz - hip.z
    // |u + Rx(b) v|^2 = |t|^2 with u . Rx(b) v = ux vx + a cos b - s sin b: the bend b that spans the target, less the
    // rest bend, never past straight. A positive turn about +X swings the shin back, as a knee bends.
    const a = uy * vy + uz * vz
    const s = uy * vz - uz * vy
    const span = ((tx * tx + ty * ty + tz * tz) - (ux * ux + uy * uy + uz * uz) - (vx * vx + vy * vy + vz * vz)) / 2 - ux * vx
    const rest = Math.atan2(s, a)
    const bend = Math.max(0, Math.acos(Math.max(-1, Math.min(1, span / Math.hypot(a, s)))) - rest)
    const cos = Math.cos(bend)
    const sin = Math.sin(bend)
    const fx = ux + vx
    const fy = uy + cos * vy - sin * vz
    const fz = uz + sin * vy + cos * vz
    const ax = fy * tz - fz * ty
    const ay = fz * tx - fx * tz
    const az = fx * ty - fy * tx
    const axis = Math.hypot(ax, ay, az)
    const pose = this.legPose[side]
    if (axis > 1e-12)
      setAxisAngle(pose.thigh, ax / axis, ay / axis, az / axis, weight * Math.atan2(axis, fx * tx + fy * ty + fz * tz))
    else
      setAxisAngle(pose.thigh, 1, 0, 0, 0)
    pivotAbout(pose.thigh, hip)
    setAxisAngle(this.legScratch, 1, 0, 0, weight * bend)
    pivotAbout(this.legScratch, knee)
    composeTransform(pose.shin, pose.thigh, this.legScratch)
  }

  /**
   * Margin-inclusive depth against torso AND head; borrowed result. Call prepare after trunk changes. `extra` grows
   * each capsule's radius by that share of its segment length, for poses that need room beyond the margin.
   */
  measure(side: BodySide, channels: ArrayLike<number>, extra = 0) {
    const pose = this.skeleton.arm(side, channels)
    const d = this.deepest
    d.depth = d.head = 0
    d.over = -Infinity
    for (let segment = 0; segment < 2; segment++) {
      const from = segment === 0 ? pose.shoulder : pose.elbow
      const to = segment === 0 ? pose.elbow : pose.wrist
      const dx = to.x - from.x
      const dy = to.y - from.y
      const dz = to.z - from.z
      const span = Math.hypot(dx, dy, dz)
      const radius = 0.15 * span
      const reach = radius + extra * span
      for (let sample = 0; sample < 5; sample++) {
        const fraction = segment === 0 ? 0.5 + sample / 8 : 1.65 * sample / 4
        const x = from.x + dx * fraction
        const y = from.y + dy * fraction
        const z = from.z + dz * fraction
        for (let i = 0; i < this.colliders.length; i++) {
          const frame = this.posed[i]
          const px = x - frame[9]
          const py = y - frame[10]
          const pz = z - frame[11]
          this.point.x = frame[0] * px + frame[3] * py + frame[6] * pz
          this.point.y = frame[1] * px + frame[4] * py + frame[7] * pz
          this.point.z = frame[2] * px + frame[5] * py + frame[8] * pz
          const depth = reach - colliderDistance(this.colliders[i], this.point, this.normal)
          if (this.colliders[i].bone === 'head' || this.colliders[i].bone === 'neck')
            d.head = Math.max(d.head, depth)
          // The margin is 0.03 of the segment and the radius 0.15 of it, so half the margin is a tenth of the radius.
          d.over = Math.max(d.over, depth - radius / 10)
          if (depth <= d.depth)
            continue
          d.depth = depth
          d.x = x - pose.shoulder.x
          d.y = y - pose.shoulder.y
          d.z = z - pose.shoulder.z
          d.nx = frame[0] * this.normal.x + frame[1] * this.normal.y + frame[2] * this.normal.z
          d.ny = frame[3] * this.normal.x + frame[4] * this.normal.y + frame[5] * this.normal.z
          d.nz = frame[6] * this.normal.x + frame[7] * this.normal.y + frame[8] * this.normal.z
          d.forearm = segment === 1
        }
      }
    }
    return d
  }

  /** Signed distance, model units, from a point to the nearest collider as last prepared; Infinity with none. */
  distance(x: number, y: number, z: number): number {
    let nearest = Infinity
    for (let i = 0; i < this.colliders.length; i++) {
      const frame = this.posed[i]
      const px = x - frame[9]
      const py = y - frame[10]
      const pz = z - frame[11]
      this.point.x = frame[0] * px + frame[3] * py + frame[6] * pz
      this.point.y = frame[1] * px + frame[4] * py + frame[7] * pz
      this.point.z = frame[2] * px + frame[5] * py + frame[8] * pz
      nearest = Math.min(nearest, colliderDistance(this.colliders[i], this.point, this.normal))
    }
    return nearest
  }

  /** Clears each arm; an arm that no pose clears keeps its last valid pose while every other channel moves on. */
  correct(channels: Float32Array, tick: number, gait: BodyPerformanceInput['gait'] = null): void {
    this.prepare(channels, gait)
    this.original.set(channels)
    for (const side of SIDES) {
      const start = ARM_START[side]
      for (let j = 2; j <= 5; j++) {
        const index = start + j
        channels[index] += this.previous[index] * Math.exp(-BODY_TICK / 0.3)
        channels[index] = Math.max(JOINT_LIMITS[index][0], Math.min(JOINT_LIMITS[index][1], channels[index]))
      }
      if (this.gaitWeight > 0 && this.project(side, channels, this.gaitWeight))
        this.corrector.capHits++
      if (this.project(side, channels))
        this.corrector.capHits++
      for (let j = 2; j <= 5; j++)
        this.previous[start + j] = channels[start + j] - this.original[start + j]
      this.guardBlend(side, channels)
      let final = this.measure(side, channels)
      if (final.over > 0) {
        this.collisions.count++
        this.collisions.last = { side, depth: final.depth, tick }
        for (let j = 0; j < 26; j++)
          channels[start + j] = this.valid[start + j]
        final = this.measure(side, channels)
      }
      else {
        for (let j = 0; j < 26; j++)
          this.valid[start + j] = channels[start + j]
      }
      this.penetration[side] = final.depth
      this.headPenetration[side] = final.head
      let correction = 0
      for (let j = 2; j <= 5; j++)
        correction += (channels[start + j] - this.original[start + j]) ** 2
      this.correction[side] = Math.sqrt(correction)
    }
  }

  /**
   * Architecture 6.2's projection: up to three smallest rotations of the upper arm (and 0.3 of each on the elbow, for a
   * forearm contact) that move one arm out of the proxies as last prepared. It keeps no state. True when the 6 degree cap
   * bounded a step.
   *
   * With a `skinWeight` above 0, the arm is measured with that share of the skin added to its radius. With `x` its
   * depth into the skin of thickness `s`, it is pushed back by `x^2 / 4s` until `x = 2s` and by `x - s` beyond: the push
   * and its slope are 0 at the skin's edge and the arm keeps at most the skin's depth, so it ends clear of the margin. A
   * body that moves into the arm slows it while it crosses the skin instead of stopping it in one tick.
   */
  project(side: BodySide, channels: Float32Array, skinWeight = 0): boolean {
    const start = ARM_START[side]
    const skin = this.skin[side] * skinWeight
    let capped = false
    let keep = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      const d = this.measure(side, channels, SKIN * skinWeight)
      if (skinWeight > 0 && attempt === 0)
        keep = d.depth < 2 * skin ? d.depth - d.depth * d.depth / (4 * skin) : skin
      if (d.depth <= keep)
        break
      const crossX = d.y * d.nz - d.z * d.ny
      const crossY = d.z * d.nx - d.x * d.nz
      const crossZ = d.x * d.ny - d.y * d.nx
      const chest = this.skeleton.frames[(['spine0', 'spine1', 'spine2', 'spine3'] as const)[this.traits.spineChain.length - 1]]
      const gx = -(chest[0] * crossX + chest[3] * crossY + chest[6] * crossZ)
      const gz = (side === 'left' ? 1 : -1) * (chest[2] * crossX + chest[5] * crossY + chest[8] * crossZ)
      const norm = Math.hypot(gx, gz)
      if (norm < 1e-9)
        break
      // Turning by `angle` about the controllable axis moves the contact along its normal by `angle * norm`, and
      // norm (d x n on the chest X and Z axes) is at most |d|, so this is the smallest rotation that clears it. The
      // 1e-6 lever skin lands the linear step just outside the margin, so a grazing contact clears continuously
      // instead of falling through to the guard scan's one-sixteenth step.
      const clearing = (d.depth - keep + 1e-6 * Math.hypot(d.x, d.y, d.z)) / norm
      capped ||= clearing > 6 * DEG
      const angle = Math.min(6 * DEG, clearing)
      channels[start + 2] += angle * gx / norm
      channels[start + 3] += angle * gz / norm
      if (d.forearm)
        channels[start + 5] += 0.3 * angle * Math.sign(gx)
      for (let j = 2; j <= 5; j++)
        channels[start + j] = Math.max(JOINT_LIMITS[start + j][0], Math.min(JOINT_LIMITS[start + j][1], channels[start + j]))
    }
    return capped
  }

  /**
   * Moves an arm the projection could not clear toward the guard pose by a continuous weight (plan 3.1).
   *
   * - The smallest clearing weight w* (16 samples, then 10 bisection steps; clearance need not be monotone among
   *   several obstacles, so the scan comes first) is followed by a critically damped response at 14 rad/s, the
   *   reaction layer's inertialisation rate (3g).
   * - While the weight lags w*, proxy depth up to half the corrector margin is allowed. The weight never falls below the
   *   smallest weight that keeps that budget, so the arm rides the budget's edge instead of freezing.
   * - The blend is not part of the persistent correction: the projected pose stays the base, and the weight alone
   *   carries the guard across ticks.
   */
  private guardBlend(side: BodySide, channels: Float32Array): void {
    const start = ARM_START[side]
    const guard = this.guardWeight[side]
    const projected = this.measure(side, channels)
    if (projected.over <= 0 && guard.weight === 0 && guard.rate === 0)
      return
    for (let k = 0; k < 4; k++)
      this.blendBase[k] = channels[start + 2 + k]
    let target = 0
    let floor = 0
    if (projected.depth > 0) {
      const beyondBudget = projected.over > 0
      this.corrector.guardScans++
      target = this.smallestGuardWeight(side, channels, 'depth')
      floor = beyondBudget ? this.smallestGuardWeight(side, channels, 'over') : 0
    }
    const previous = guard.weight
    const decay = Math.exp(-GUARD_OMEGA * BODY_TICK)
    const error = guard.weight - target
    const impulse = guard.rate + GUARD_OMEGA * error
    guard.weight = target + decay * (error + impulse * BODY_TICK)
    guard.rate = decay * (guard.rate - GUARD_OMEGA * impulse * BODY_TICK)
    if (guard.weight < floor) {
      guard.rate = (floor - previous) / BODY_TICK
      guard.weight = floor
    }
    if (target === 0 && Math.abs(guard.weight) < 1e-7 && Math.abs(guard.rate) < 1e-5)
      guard.weight = guard.rate = 0
    this.blendGuard(side, channels, Math.max(0, Math.min(1, guard.weight)))
  }

  private blendGuard(side: BodySide, channels: Float32Array, weight: number): void {
    const start = ARM_START[side]
    for (let k = 0; k < 4; k++)
      channels[start + 2 + k] = this.blendBase[k] + (this.guard[start + 2 + k] - this.blendBase[k]) * weight
  }

  /** Smallest guard weight in (0, 1] at which the arm clears (`depth`) or stays inside the budget (`over`); 1 if none. */
  private smallestGuardWeight(side: BodySide, channels: Float32Array, key: 'depth' | 'over'): number {
    let low = 0
    let high = -1
    for (let k = 1; k <= 16; k++) {
      this.blendGuard(side, channels, k / 16)
      if (this.measure(side, channels)[key] <= 0) {
        high = k / 16
        low = (k - 1) / 16
        break
      }
    }
    if (high < 0)
      return 1
    for (let step = 0; step < 10; step++) {
      const middle = (low + high) / 2
      this.blendGuard(side, channels, middle)
      if (this.measure(side, channels)[key] <= 0)
        high = middle
      else
        low = middle
    }
    return high
  }
}
