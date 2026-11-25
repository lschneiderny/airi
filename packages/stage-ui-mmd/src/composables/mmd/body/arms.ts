import type { HumanoidBoneName } from '@proj-airi/motion-driver-humanoid/types'

import type { MMDTouchCollider } from '../touch/colliders'
import type { MMDBodyPose } from './pose'
import type { MMDArmCollisionReport } from './secondary-motion'

import { DEFAULT_ARM_REST_POSE } from '@proj-airi/motion-driver-humanoid/performance'
import { Matrix4, Vector3 } from 'three'

import { mmdTouchColliderCenter } from '../touch/colliders'

type Side = 'left' | 'right'

/** What the arm measurement tests: `kinematic` gate the arms and `dynamic` (simulated cloth) are only reported. */
export interface MMDArmTestColliders {
  readonly kinematic: readonly MMDTouchCollider[]
  readonly dynamic: readonly MMDTouchCollider[]
}

/** The clip ownership of the arm bone groups, 0 to 1. */
export type MMDArmOwnership = Record<'leftArm' | 'rightArm' | 'leftFingers' | 'rightFingers', number>

/** The body model the arms clear, as the diagnostics snapshot publishes it. */
export interface MMDBodyModelSummary {
  /** Hard volumes: her body, her rigid clothing and flesh on simulated bones. */
  volumes: number
  garments: number
  /** Garments the resting arm sits inside (`BodyGarment.pinched`), which never collide with the arms. */
  pinchedGarments: number
  /** The rest abduction the model solved per side, in degrees from a straight-down arm. */
  restAbductDeg: Record<Side, number>
  /** What kept each side's rest from clearing everything: a volume that had to shrink, a garment it still overlaps, or nothing. */
  restLimit: Record<Side, 'volume' | 'garment' | null>
  /** Volumes the rest solve shrank or dropped. */
  shrunkVolumes: number
  /**
   * The status of the arm collision setup (`prepareMMDSecondaryMotion`); null until the model gets its physics, which
   * the scene installs after it builds the body. Never `no-body-model`: this summary exists only for a built model.
   */
  armCollisions: Exclude<MMDArmCollisionReport['status'], 'no-body-model'> | null
}

export interface MMDArmsMeasurement {
  /** Share of the arm layer that is active: one minus the larger arm ownership. */
  weight: number
  owned: MMDArmOwnership
  /** Deepest arm capsule-radius overlap of a hard volume of the body model (hips to chest and the thighs) per side, in model units. The gate: it must be 0. */
  penetration: Record<Side, number>
  /** Deepest arm centerline overlap of a dynamic (physics) cloth body per side, in model units. Information only: the simulation resolves it. */
  clothContact: Record<Side, number>
  /** The rest upper-arm hang in degrees below horizontal in effect: the mean of the body model's two rest hangs, or the debug override. */
  hangDeg: number
  /** Both hand bones sit below the hips bone, so the arms hang. */
  handBelowHip: boolean
  /** Deepest arm capsule-radius overlap of a kinematic head or neck body of the author's rig per side, in model units. */
  headPenetration: Record<Side, number>
  /** The performer's arm collision correction in effect per side, in degrees. */
  correctionDeg: Record<Side, number>
  /** The body model whose volumes gate the arms; null when the rig lacks a bone the model needs. */
  bodyModel: MMDBodyModelSummary | null
}

const radiansPerDegree = Math.PI / 180
/** Arm capsule radius as a share of its segment length. */
const ARM_RADIUS_RATIO = 0.12
/** The hand reaches this share of the forearm length beyond the wrist bone. */
const HAND_EXTENSION = 0.65
const SAMPLES_PER_CAPSULE = 5
/** The upper-arm capsule starts this share of the way down the arm: the shoulder joint sits beside the chest volumes by construction. */
const SHOULDER_SKIP = 0.5

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

/** One test capsule of an arm: a segment with a radius, in the space of the bone positions it was built from. */
export interface MMDArmCapsule {
  from: Vector3
  to: Vector3
  radius: number
}

/**
 * The two capsules the penetration test uses for one arm: the lower half of the upper arm (the shoulder joint sits
 * inside the chest bodies) and the forearm extended through the hand. The overlay draws exactly these.
 */
export function mmdArmCapsules(upper: Vector3, elbow: Vector3, wrist: Vector3): [MMDArmCapsule, MMDArmCapsule] {
  const fingertip = wrist.clone().addScaledVector(wrist.clone().sub(elbow), HAND_EXTENSION)
  return [
    { from: upper.clone().lerp(elbow, SHOULDER_SKIP), to: elbow, radius: ARM_RADIUS_RATIO * upper.distanceTo(elbow) },
    { from: elbow, to: fingertip, radius: ARM_RADIUS_RATIO * elbow.distanceTo(wrist) },
  ]
}

function boundingRadius(collider: MMDTouchCollider): number {
  const [x, y, z] = collider.size
  return collider.shape === 'sphere' ? x : collider.shape === 'box' ? Math.hypot(x, y, z) : x + y / 2
}

/**
 * Measures whether the posed arms clear the body model's volumes and the author's head and neck bodies, as the
 * performer's corrector fitted them, and turns the debug hang override into the abduction the performer adds to the
 * rig's rest. The performer owns every arm bone write, and rests the arms at the model's rest abduction itself
 * (`BodyArmTraits.restAbduct`).
 */
export class MMDArms {
  /** The hang the last `lift` reported, which is the one `measure` reports. */
  private appliedHang: number
  private readonly lifted = { left: 0, right: 0 }

  /** The rig's rest abduction per side, radians: the body model's, or the default hang without a model. */
  private readonly rest: Readonly<Record<Side, number>>

  /** `armCollisions` reads the status of the arm collision setup, or null while the setup has not run. */
  constructor(private readonly pose: MMDBodyPose, private readonly colliders: MMDArmTestColliders, private readonly head: readonly MMDTouchCollider[], private model: MMDBodyModelSummary | null = null, private readonly armCollisions: () => MMDArmCollisionReport['status'] | null = () => null) {
    const abduct = (side: Side) => model ? model.restAbductDeg[side] * radiansPerDegree : DEFAULT_ARM_REST_POSE.abduct
    this.rest = { left: abduct('left'), right: abduct('right') }
    this.appliedHang = this.hang()
  }

  /** The mean hang of the two arms below horizontal, degrees, with the latest lift. */
  private hang(): number {
    return 90 - (this.rest.left + this.lifted.left + this.rest.right + this.lifted.right) / 2 / radiansPerDegree
  }

  /**
   * The abduction each side adds to the rig's rest, radians: nothing, or, under the debug override, what brings both
   * sides to the hang `hangDeg` below horizontal.
   */
  lift(hangDeg: number | null): Readonly<Record<Side, number>> {
    for (const side of ['left', 'right'] as const)
      this.lifted[side] = hangDeg === null ? 0 : (90 - hangDeg) * radiansPerDegree - this.rest[side]
    this.appliedHang = this.hang()
    return this.lifted
  }

  /**
   * World positions of the named bones with the arms and fingers posed by `pose` (the standing rest pose), so the stage
   * placement rect is measured from the pose she stands in rather than the bind pose. Every bone is restored.
   */
  restPositions(names: readonly string[], pose: () => void): Map<string, [number, number, number]> {
    const { mesh } = this.pose.mmd
    const bones = mesh.skeleton.bones
    const saved = bones.map(bone => bone.quaternion.clone())
    pose()
    mesh.updateWorldMatrix(true, true)
    const positions = new Map<string, [number, number, number]>()
    for (const name of names) {
      const bone = this.pose.bone(name)
      if (bone) {
        const { x, y, z } = bone.getWorldPosition(new Vector3())
        positions.set(name, [x, y, z])
      }
    }
    bones.forEach((bone, index) => bone.quaternion.copy(saved[index]))
    mesh.updateWorldMatrix(true, true)
    return positions
  }

  measure(owned: MMDArmOwnership, correctionDeg: Readonly<Record<Side, number>>): MMDArmsMeasurement {
    const { mesh } = this.pose.mmd
    mesh.updateWorldMatrix(true, true)
    const toMesh = new Matrix4().copy(mesh.matrixWorld).invert()
    const position = (humanoid: HumanoidBoneName): Vector3 | null => {
      const bone = this.pose.bone(this.pose.rig.bones[humanoid])
      return bone ? bone.getWorldPosition(new Vector3()).applyMatrix4(toMesh) : null
    }
    const hips = position('hips')
    const penetration = { left: 0, right: 0 }
    const headPenetration = { left: 0, right: 0 }
    const clothContact = { left: 0, right: 0 }
    let handsBelow = hips !== null
    for (const side of ['left', 'right'] as const) {
      const upper = position(`${side}UpperArm`)
      const elbow = position(`${side}LowerArm`)
      const wrist = position(`${side}Hand`)
      if (!wrist || !hips || wrist.y >= hips.y)
        handsBelow = false
      if (!upper || !elbow || !wrist)
        continue
      const capsules = mmdArmCapsules(upper, elbow, wrist)
      const samples = capsules.flatMap(({ from, to, radius }) =>
        Array.from({ length: SAMPLES_PER_CAPSULE }, (_, index) => ({ point: from.clone().lerp(to, index / (SAMPLES_PER_CAPSULE - 1)), radius })))
      penetration[side] = this.deepest(samples, this.colliders.kinematic, toMesh)
      headPenetration[side] = this.deepest(samples, this.head, toMesh)
      clothContact[side] = this.deepest(samples.map(({ point }) => ({ point, radius: 0 })), this.colliders.dynamic, toMesh)
    }
    // The setup runs when the model gets its physics, after this was built, so its status is read with each
    // measurement until it is known.
    // A new summary on that change, so a snapshot taken before the setup keeps the null it showed.
    if (this.model && this.model.armCollisions === null) {
      const armCollisions = this.armCollisions()
      if (armCollisions !== null && armCollisions !== 'no-body-model')
        this.model = { ...this.model, armCollisions }
    }
    return {
      weight: 1 - Math.max(owned.leftArm, owned.rightArm),
      owned: { leftArm: owned.leftArm, rightArm: owned.rightArm, leftFingers: owned.leftFingers, rightFingers: owned.rightFingers },
      penetration,
      clothContact,
      hangDeg: this.appliedHang,
      handBelowHip: handsBelow,
      headPenetration,
      correctionDeg: { left: correctionDeg.left, right: correctionDeg.right },
      bodyModel: this.model,
    }
  }

  private deepest(samples: readonly { point: Vector3, radius: number }[], colliders: readonly MMDTouchCollider[], toMesh: Matrix4): number {
    const { skeleton } = this.pose.mmd.mesh
    const world = new Matrix4()
    const inverse = new Matrix4()
    const center = new Vector3()
    const local = new Vector3()
    let depth = 0
    for (const collider of colliders) {
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
