import type { Vec3 } from '../types'
import type { BodySide } from './channels'
import type { BodyBone, BodyRigTraits } from './contracts'

import { ARM_START, TORSO_START } from './channels'

export { solveArmKey } from './arm-key'
export type { ArmAngles, ArmKey, ArmKeyRig } from './arm-key'

/** Row-major orthonormal 3x3 followed by XYZ translation. Scratch transforms are mutable. */
export type BodyTransform = Float64Array

export function identityTransform(): BodyTransform {
  return new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0])
}

/** Intrinsic YXZ, matching rotationToMatrix, written without temporary matrices. */
export function setRotation(out: BodyTransform, angles: ArrayLike<number>, offset = 0): void {
  const cy = Math.cos(angles[offset])
  const sy = Math.sin(angles[offset])
  const cx = Math.cos(angles[offset + 1])
  const sx = Math.sin(angles[offset + 1])
  const cz = Math.cos(angles[offset + 2])
  const sz = Math.sin(angles[offset + 2])
  out[0] = cy * cz + sy * sx * sz
  out[1] = -cy * sz + sy * sx * cz
  out[2] = sy * cx
  out[3] = cx * sz
  out[4] = cx * cz
  out[5] = -sx
  out[6] = -sy * cz + cy * sx * sz
  out[7] = sy * sz + cy * sx * cz
  out[8] = cy * cx
}

/** out must differ from both inputs. */
export function composeTransform(out: BodyTransform, parent: BodyTransform, local: BodyTransform): void {
  for (let row = 0; row < 3; row++) {
    const r = row * 3
    for (let col = 0; col < 3; col++)
      out[r + col] = parent[r] * local[col] + parent[r + 1] * local[3 + col] + parent[r + 2] * local[6 + col]
    out[9 + row] = parent[r] * local[9] + parent[r + 1] * local[10] + parent[r + 2] * local[11] + parent[9 + row]
  }
}

export function transformPoint(out: Vec3, frame: BodyTransform, point: Readonly<Vec3>): void {
  const { x, y, z } = point
  out.x = frame[0] * x + frame[1] * y + frame[2] * z + frame[9]
  out.y = frame[3] * x + frame[4] * y + frame[5] * z + frame[10]
  out.z = frame[6] * x + frame[7] * y + frame[8] * z + frame[11]
}

/** Control-major triples per bone. Each control sums to one even on a sparse chain. */
export function spineWeights(chain: readonly Readonly<Vec3>[]): Float64Array {
  const distances = new Float64Array(chain.length)
  for (let i = 1; i < chain.length; i++)
    distances[i] = distances[i - 1] + Math.hypot(chain[i].x - chain[i - 1].x, chain[i].y - chain[i - 1].y, chain[i].z - chain[i - 1].z)
  const length = distances[chain.length - 1]
  const out = new Float64Array(chain.length * 3)
  for (let k = 0; k < 3; k++) {
    const centre = [0.17, 0.5, 0.83][k]
    let total = 0
    let nearest = 0
    let distance = Infinity
    for (let i = 0; i < chain.length; i++) {
      const u = length > 0 ? distances[i] / length : 0.5
      const d = Math.abs(u - centre)
      if (d < distance) {
        nearest = i
        distance = d
      }
      out[i * 3 + k] = Math.max(0, 1 - d / 0.33)
      total += out[i * 3 + k]
    }
    if (total === 0) {
      out[nearest * 3 + k] = 1
    }
    else {
      for (let i = 0; i < chain.length; i++)
        out[i * 3 + k] /= total
    }
  }
  return out
}

const zero = { x: 0, y: 0, z: 0 } as const
const spineNames = ['spine0', 'spine1', 'spine2', 'spine3'] as const

/** Canonical FK also supplies the adapter's arm frames; no bone names or renderer objects. */
export class BodySkeleton {
  readonly frames: Record<BodyBone, BodyTransform> = {
    hips: identityTransform(),
    spine0: identityTransform(),
    spine1: identityTransform(),
    spine2: identityTransform(),
    spine3: identityTransform(),
    neck: identityTransform(),
    head: identityTransform(),
  }

  readonly armPose = {
    shoulder: { x: 0, y: 0, z: 0 },
    elbow: { x: 0, y: 0, z: 0 },
    wrist: { x: 0, y: 0, z: 0 },
    upper: identityTransform(),
    forearm: identityTransform(),
    hand: identityTransform(),
  }

  private readonly root = identityTransform()
  private readonly local = identityTransform()
  private readonly scratch = identityTransform()
  private readonly scratch2 = identityTransform()
  private readonly angles = new Float64Array(3)
  private readonly delta = { x: 0, y: 0, z: 0 }
  private readonly weights: Float64Array
  private readonly lengths: Record<BodySide, readonly [number, number]>

  constructor(readonly traits: BodyRigTraits) {
    this.weights = spineWeights(traits.spineChain)
    const lengths = (side: BodySide): readonly [number, number] => {
      const arm = traits.arms[side]
      return [Math.hypot(arm.upperArm.x, arm.upperArm.y, arm.upperArm.z), Math.hypot(arm.forearm.x, arm.forearm.y, arm.forearm.z)]
    }
    this.lengths = { left: lengths('left'), right: lengths('right') }
  }

  private offset(to: Readonly<Vec3>, from: Readonly<Vec3>): void {
    this.local[9] = to.x - from.x
    this.local[10] = to.y - from.y
    this.local[11] = to.z - from.z
  }

  update(channels: ArrayLike<number>): void {
    for (let i = 0; i < 3; i++)
      this.root[9 + i] = channels[i] * this.traits.legLength
    setRotation(this.local, channels, 3)
    this.offset(this.traits.hips, zero)
    composeTransform(this.frames.hips, this.root, this.local)
    let parent = this.traits.spineParent === 'hips' ? this.frames.hips : this.root
    let previous: Readonly<Vec3> = this.traits.spineParent === 'hips' ? this.traits.hips : zero
    for (let i = 0; i < this.traits.spineChain.length; i++) {
      this.angles.fill(0)
      for (let k = 0; k < 3; k++) {
        for (let axis = 0; axis < 3; axis++)
          this.angles[axis] += this.weights[i * 3 + k] * channels[TORSO_START[k] + axis]
      }
      setRotation(this.local, this.angles)
      this.offset(this.traits.spineChain[i], previous)
      const frame = this.frames[spineNames[i]]
      composeTransform(frame, parent, this.local)
      previous = this.traits.spineChain[i]
      parent = frame
    }
    setRotation(this.local, channels, 15)
    this.offset(this.traits.neck, previous)
    composeTransform(this.frames.neck, parent, this.local)
    setRotation(this.local, channels, 18)
    this.offset(this.traits.head, this.traits.neck)
    composeTransform(this.frames.head, this.frames.neck, this.local)
  }

  /** Borrowed scratch; valid until the next arm call. U=Rx(-flex)Rz(side*abduct)Ry(-side*twist). */
  arm(side: BodySide, channels: ArrayLike<number>) {
    const arm = this.traits.arms[side]
    const start = ARM_START[side]
    const sigma = side === 'left' ? 1 : -1
    const last = this.traits.spineChain.length - 1
    const chest = this.frames[spineNames[last]]
    const restChest = this.traits.spineChain[last]
    this.angles[0] = arm.clavicle ? -sigma * channels[start + 1] : 0
    this.angles[1] = 0
    this.angles[2] = arm.clavicle ? sigma * channels[start] : 0
    setRotation(this.local, this.angles)
    this.offset(arm.clavicle ?? arm.shoulder, restChest)
    composeTransform(this.scratch, chest, this.local)
    this.delta.x = arm.clavicle ? arm.shoulder.x - arm.clavicle.x : 0
    this.delta.y = arm.clavicle ? arm.shoulder.y - arm.clavicle.y : 0
    this.delta.z = arm.clavicle ? arm.shoulder.z - arm.clavicle.z : 0
    transformPoint(this.armPose.shoulder, this.scratch, this.delta)
    this.angles[0] = 0
    this.angles[1] = -channels[start + 2]
    this.angles[2] = sigma * channels[start + 3]
    setRotation(this.local, this.angles)
    this.local[9] = this.local[10] = this.local[11] = 0
    composeTransform(this.scratch, chest, this.local)
    this.angles[0] = -sigma * channels[start + 4]
    this.angles[1] = this.angles[2] = 0
    setRotation(this.local, this.angles)
    composeTransform(this.armPose.upper, this.scratch, this.local)
    const upper = this.armPose.upper
    upper[9] = this.armPose.shoulder.x
    upper[10] = this.armPose.shoulder.y
    upper[11] = this.armPose.shoulder.z
    this.delta.x = this.delta.z = 0
    this.delta.y = -this.lengths[side][0]
    transformPoint(this.armPose.elbow, upper, this.delta)
    this.angles[0] = 0
    this.angles[1] = -channels[start + 5]
    setRotation(this.local, this.angles)
    composeTransform(this.scratch, upper, this.local)
    this.angles[0] = -sigma * channels[start + 6]
    this.angles[1] = 0
    setRotation(this.local, this.angles)
    composeTransform(this.armPose.forearm, this.scratch, this.local)
    const forearm = this.armPose.forearm
    forearm[9] = this.armPose.elbow.x
    forearm[10] = this.armPose.elbow.y
    forearm[11] = this.armPose.elbow.z
    this.delta.y = -this.lengths[side][1]
    transformPoint(this.armPose.wrist, forearm, this.delta)
    this.angles[0] = this.angles[1] = 0
    this.angles[2] = -sigma * channels[start + 7]
    setRotation(this.local, this.angles)
    composeTransform(this.scratch2, forearm, this.local)
    this.angles[1] = channels[start + 8]
    this.angles[2] = 0
    setRotation(this.local, this.angles)
    composeTransform(this.armPose.hand, this.scratch2, this.local)
    this.armPose.hand[9] = this.armPose.wrist.x
    this.armPose.hand[10] = this.armPose.wrist.y
    this.armPose.hand[11] = this.armPose.wrist.z
    return this.armPose
  }
}
