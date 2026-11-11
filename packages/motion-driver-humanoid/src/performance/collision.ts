import type { BodySide } from './channels'
import type { BodyCapabilities, BodyCollider, BodyRigTraits } from './contracts'

import { solveArmKey } from './arm-key'
import { ARM_START, BODY_CHANNELS, BODY_TICK, DEG, JOINT_LIMITS, SIDES } from './channels'
import { colliderDistance, proxyColliders } from './colliders'
import { BodySkeleton, composeTransform, identityTransform, setRotation } from './skeleton'

export { colliderDistance, proxyColliders } from './colliders'

export class BodyCollisionError extends Error {
  constructor(readonly side: BodySide, readonly depth: number) {
    super(`No clear arm pose for ${side}; proxy penetration ${depth} model units`)
    this.name = 'BodyCollisionError'
  }
}

/** Owns scratch FK and persistent correction. The final sampled capsule test is authoritative. */
export class BodyCollision {
  readonly capabilities: BodyCapabilities
  readonly correction = { left: 0, right: 0 }
  readonly penetration = { left: 0, right: 0 }
  readonly headPenetration = { left: 0, right: 0 }
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
  private readonly deepest = { depth: 0, head: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, forearm: false }

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
    this.correct(rest)
    this.previous.fill(0)
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

  /** Margin-inclusive depth against torso AND head; borrowed result. Call prepare after trunk changes. */
  measure(side: BodySide, channels: ArrayLike<number>) {
    const pose = this.skeleton.arm(side, channels)
    const d = this.deepest
    d.depth = d.head = 0
    for (let segment = 0; segment < 2; segment++) {
      const from = segment === 0 ? pose.shoulder : pose.elbow
      const to = segment === 0 ? pose.elbow : pose.wrist
      const dx = to.x - from.x
      const dy = to.y - from.y
      const dz = to.z - from.z
      const radius = 0.15 * Math.hypot(dx, dy, dz)
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
          const depth = radius - colliderDistance(this.colliders[i], this.point, this.normal)
          if (this.colliders[i].bone === 'head' || this.colliders[i].bone === 'neck')
            d.head = Math.max(d.head, depth)
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

  correct(channels: Float32Array): void {
    this.prepare(channels)
    this.original.set(channels)
    for (const side of SIDES) {
      const start = ARM_START[side]
      for (let j = 2; j <= 5; j++) {
        const index = start + j
        channels[index] += this.previous[index] * Math.exp(-BODY_TICK / 0.3)
        channels[index] = Math.max(JOINT_LIMITS[index][0], Math.min(JOINT_LIMITS[index][1], channels[index]))
      }
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
        const angle = Math.min(6 * DEG, d.depth / Math.hypot(d.x, d.y, d.z))
        channels[start + 2] += angle * gx / norm
        channels[start + 3] += angle * gz / norm
        if (d.forearm)
          channels[start + 5] += 0.3 * angle * Math.sign(gx)
        for (let j = 2; j <= 5; j++)
          channels[start + j] = Math.max(JOINT_LIMITS[start + j][0], Math.min(JOINT_LIMITS[start + j][1], channels[start + j]))
      }
      if (this.measure(side, channels).depth > 0) {
        const flex = channels[start + 2]
        const abduct = channels[start + 3]
        const twist = channels[start + 4]
        const elbow = channels[start + 5]
        // Scan the discrete weights: clearance is not monotone for multiple obstacles.
        for (let k = 1; k <= 16; k++) {
          channels[start + 2] = flex + (this.guard[start + 2] - flex) * k / 16
          channels[start + 3] = abduct + (this.guard[start + 3] - abduct) * k / 16
          channels[start + 4] = twist + (this.guard[start + 4] - twist) * k / 16
          channels[start + 5] = elbow + (this.guard[start + 5] - elbow) * k / 16
          if (this.measure(side, channels).depth <= 0)
            break
        }
      }
      const final = this.measure(side, channels)
      if (final.depth > 0)
        throw new BodyCollisionError(side, final.depth)
      this.penetration[side] = final.depth
      this.headPenetration[side] = final.head
      let correction = 0
      for (let j = 2; j <= 5; j++) {
        const index = start + j
        this.previous[index] = channels[index] - this.original[index]
        correction += this.previous[index] ** 2
      }
      this.correction[side] = Math.sqrt(correction)
    }
  }
}
