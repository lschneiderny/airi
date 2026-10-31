import type { ArmRestInput, ArmRestSwing } from '@proj-airi/motion-driver-humanoid/rest-pose'
import type { ArmBoneName, HumanoidBoneName, HumanoidFingerBoneName } from '@proj-airi/motion-driver-humanoid/types'

import type { MMDCleanPose } from '../frame-pipeline'
import type { MMDTouchCollider } from '../touch/colliders'
import type { MMDBodyPose } from './pose'

import { createArmRest, DEFAULT_ARM_REST_POSE } from '@proj-airi/motion-driver-humanoid/rest-pose'
import { Matrix4, Vector3 } from 'three'

import { mmdTouchColliderCenter } from '../touch/colliders'

type Side = 'left' | 'right'

/** The clip ownership of the arm bone groups, 0 to 1. */
export type MMDArmOwnership = Record<'leftArm' | 'rightArm' | 'leftFingers' | 'rightFingers', number>

export interface MMDArmRestInput {
  readonly dt: number
  /** -1..1 */
  readonly breath: number
  readonly torsoRoll: number
  readonly swing: Readonly<Record<Side, ArmRestSwing>> | undefined
  readonly swingWeight: number
  readonly owned: MMDArmOwnership
  /** Debug override of the rest hang angle in degrees below horizontal; null keeps the default. */
  readonly hangDeg: number | null
}

export interface MMDArmsMeasurement {
  /** Share of the arm layer that is active: one minus the larger arm ownership. */
  weight: number
  owned: MMDArmOwnership
  /** Deepest arm capsule penetration of a torso, hip or skirt body per side, in model units. */
  penetration: Record<Side, number>
  /** Both hand bones sit below the hips bone, so the arms hang. */
  handBelowHip: boolean
}

const radiansPerDegree = Math.PI / 180
/** Arm capsule radius as a share of its segment length. */
const ARM_RADIUS_RATIO = 0.12
/** The hand reaches this share of the forearm length beyond the wrist bone. */
const HAND_EXTENSION = 0.4
const SAMPLES_PER_CAPSULE = 5

function mean(values: readonly (number | null)[]): number | undefined {
  const present = values.filter((value): value is number => value !== null)
  return present.length === 0 ? undefined : present.reduce((sum, value) => sum + value, 0) / present.length
}

function signedDistance(collider: MMDTouchCollider, point: Vector3): number {
  const [x, y, z] = collider.size
  switch (collider.shape) {
    case 'sphere':
      return point.length() - x
    case 'box': {
      const qx = Math.abs(point.x) - x
      const qy = Math.abs(point.y) - y
      const qz = Math.abs(point.z) - z
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0)
    }
    case 'capsule':
      return Math.hypot(point.x, point.y - Math.max(-y / 2, Math.min(y / 2, point.y)), point.z) - x
  }
}

function boundingRadius(collider: MMDTouchCollider): number {
  const [x, y, z] = collider.size
  return collider.shape === 'sphere' ? x : collider.shape === 'box' ? Math.hypot(x, y, z) : x + y / 2
}

/** Relaxes the arms, hands and fingers over the bind pose and measures whether they hang clear of the body. */
export class MMDArmRest {
  private readonly layer = createArmRest()
  private readonly names = new Map<ArmBoneName, string>()
  private readonly bindArmAngle: number | undefined
  private readonly bindForearmAngle: number | undefined
  private readonly thumbAxis: ArmRestInput['thumbAxis']

  constructor(private readonly pose: MMDBodyPose, private readonly colliders: readonly MMDTouchCollider[]) {
    const { rig } = pose
    for (const side of ['left', 'right'] as const) {
      for (const bone of ['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const) {
        const humanoid = `${side}${bone}` as HumanoidBoneName & ArmBoneName
        const name = rig.bones[humanoid]
        if (name)
          this.names.set(humanoid, name)
      }
    }
    for (const [finger, name] of Object.entries(rig.fingerBones) as [HumanoidFingerBoneName, string][])
      this.names.set(finger, name)
    this.bindArmAngle = mean([rig.restArmAngles.left, rig.restArmAngles.right])
    this.bindForearmAngle = mean([rig.restForearmAngles.left, rig.restForearmAngles.right])
    const { left, right } = rig.thumbAxis
    this.thumbAxis = left && right
      ? { left: { x: left[0], y: left[1], z: left[2] }, right: { x: right[0], y: right[1], z: right[2] } }
      : undefined
  }

  apply(clean: MMDCleanPose, input: MMDArmRestInput): void {
    if (this.bindArmAngle === undefined)
      return
    const pose = input.hangDeg === null ? DEFAULT_ARM_REST_POSE : { ...DEFAULT_ARM_REST_POSE, hangAngle: input.hangDeg * radiansPerDegree }
    const frame = this.layer.step({
      bindArmAngle: this.bindArmAngle,
      bindForearmAngle: this.bindForearmAngle,
      thumbAxis: this.thumbAxis,
      pose,
      breath: input.breath,
      torsoRoll: input.torsoRoll,
      swing: input.swing,
      swingWeight: input.swingWeight,
      owned: input.owned,
    }, input.dt)
    // NOTICE:
    // q_final = q_mixer * slerp(I, rest, 1 - owned) only approximates slerp(rest, clip, w) between 0 and 1.
    // Layers do not blend in delta space.
    // Source: design notes B.3, clip ownership mask.
    // Remove when animation layers blend in delta space.
    for (const [bone, rotation] of Object.entries(frame.rotations) as [ArmBoneName, NonNullable<typeof frame.rotations[ArmBoneName]>][])
      this.pose.rotate(this.names.get(bone), clean, rotation)
  }

  measure(owned: MMDArmOwnership): MMDArmsMeasurement {
    const { mesh } = this.pose.mmd
    mesh.updateWorldMatrix(true, true)
    const toMesh = new Matrix4().copy(mesh.matrixWorld).invert()
    const position = (humanoid: HumanoidBoneName): Vector3 | null => {
      const bone = this.pose.bone(this.pose.rig.bones[humanoid])
      return bone ? bone.getWorldPosition(new Vector3()).applyMatrix4(toMesh) : null
    }
    const hips = position('hips')
    const penetration = { left: 0, right: 0 }
    let handsBelow = hips !== null
    for (const side of ['left', 'right'] as const) {
      const upper = position(`${side}UpperArm`)
      const elbow = position(`${side}LowerArm`)
      const wrist = position(`${side}Hand`)
      if (!wrist || !hips || wrist.y >= hips.y)
        handsBelow = false
      if (!upper || !elbow || !wrist)
        continue
      const fingertip = wrist.clone().addScaledVector(wrist.clone().sub(elbow), HAND_EXTENSION)
      const capsules = [
        { from: upper, to: elbow, radius: ARM_RADIUS_RATIO * upper.distanceTo(elbow) },
        { from: elbow, to: fingertip, radius: ARM_RADIUS_RATIO * elbow.distanceTo(wrist) },
      ]
      const samples = capsules.flatMap(({ from, to, radius }) =>
        Array.from({ length: SAMPLES_PER_CAPSULE }, (_, index) => ({ point: from.clone().lerp(to, index / (SAMPLES_PER_CAPSULE - 1)), radius })))
      penetration[side] = this.deepest(samples, toMesh)
    }
    return { weight: 1 - Math.max(owned.leftArm, owned.rightArm), owned: { leftArm: owned.leftArm, rightArm: owned.rightArm, leftFingers: owned.leftFingers, rightFingers: owned.rightFingers }, penetration, handBelowHip: handsBelow }
  }

  private deepest(samples: readonly { point: Vector3, radius: number }[], toMesh: Matrix4): number {
    const { skeleton } = this.pose.mmd.mesh
    const world = new Matrix4()
    const inverse = new Matrix4()
    const center = new Vector3()
    const local = new Vector3()
    let depth = 0
    for (const collider of this.colliders) {
      const bone = skeleton.bones[collider.boneIndex]
      if (!bone)
        continue
      world.copy(toMesh).multiply(bone.matrixWorld)
      mmdTouchColliderCenter(collider, world, center)
      const reach = boundingRadius(collider)
      let prepared = false
      for (const { point, radius } of samples) {
        if (point.distanceTo(center) > reach + radius)
          continue
        if (!prepared) {
          inverse.copy(world).multiply(collider.offset).invert()
          prepared = true
        }
        depth = Math.max(depth, radius - signedDistance(collider, local.copy(point).applyMatrix4(inverse)))
      }
    }
    return depth
  }
}
