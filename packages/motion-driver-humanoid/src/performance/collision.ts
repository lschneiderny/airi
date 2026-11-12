import type { BodySide } from './channels'
import type { BodyCapabilities, BodyCollider, BodyRigTraits } from './contracts'

import { solveArmKey } from './arm-key'
import { ARM_START, BODY_CHANNELS, BODY_TICK, DEG, JOINT_LIMITS, SIDES } from './channels'
import { colliderDistance, proxyColliders } from './colliders'
import { BodySkeleton, composeTransform, identityTransform, setRotation } from './skeleton'

export { colliderDistance, proxyColliders } from './colliders'

/** The guard weight's critically damped response, rad/s: the reaction layer's inertialisation rate (architecture 3g). */
const GUARD_OMEGA = 14

/** Owns scratch FK and persistent correction. The final sampled capsule test is authoritative. */
export class BodyCollision {
  readonly capabilities: BodyCapabilities
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

  prepare(channels: ArrayLike<number>): void {
    this.skeleton.update(channels)
    for (let i = 0; i < this.colliders.length; i++) {
      const collider = this.colliders[i]
      this.angles[0] = collider.rotation.yaw
      this.angles[1] = collider.rotation.pitch
      this.angles[2] = collider.rotation.roll
      setRotation(this.local, this.angles)
      this.local[9] = collider.centre.x
      this.local[10] = collider.centre.y
      this.local[11] = collider.centre.z
      composeTransform(this.posed[i], this.skeleton.frames[collider.bone], this.local)
    }
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
  correct(channels: Float32Array, tick: number): void {
    this.prepare(channels)
    this.original.set(channels)
    for (const side of SIDES) {
      const start = ARM_START[side]
      for (let j = 2; j <= 5; j++) {
        const index = start + j
        channels[index] += this.previous[index] * Math.exp(-BODY_TICK / 0.3)
        channels[index] = Math.max(JOINT_LIMITS[index][0], Math.min(JOINT_LIMITS[index][1], channels[index]))
      }
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
   * forearm contact) that clear one arm of the proxies as last prepared. It keeps no state. True when the 6 degree cap
   * bounded a step.
   */
  project(side: BodySide, channels: Float32Array): boolean {
    const start = ARM_START[side]
    let capped = false
    for (let attempt = 0; attempt < 3; attempt++) {
      const d = this.measure(side, channels)
      if (d.depth <= 0)
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
      const clearing = (d.depth + 1e-6 * Math.hypot(d.x, d.y, d.z)) / norm
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
