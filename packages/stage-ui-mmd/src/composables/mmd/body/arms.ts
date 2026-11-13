import type { HumanoidBoneName } from '@proj-airi/motion-driver-humanoid/types'

import type { MMDArmTestColliders, MMDTouchCollider } from '../touch/colliders'
import type { MMDBodyPose } from './pose'

import { DEFAULT_ARM_REST_POSE } from '@proj-airi/motion-driver-humanoid/performance'
import { Matrix4, Vector3 } from 'three'

import { mmdTouchColliderCenter } from '../touch/colliders'

type Side = 'left' | 'right'

/** The clip ownership of the arm bone groups, 0 to 1. */
export type MMDArmOwnership = Record<'leftArm' | 'rightArm' | 'leftFingers' | 'rightFingers', number>

export interface MMDArmLiftInput {
  readonly swingWeight: number
  readonly owned: MMDArmOwnership
  /** Debug override of the rest hang angle in degrees below horizontal; null keeps the default. */
  readonly hangDeg: number | null
}

export interface MMDArmsMeasurement {
  /** Share of the arm layer that is active: one minus the larger arm ownership. */
  weight: number
  owned: MMDArmOwnership
  /** Deepest arm capsule-radius overlap of a kinematic torso, hip, leg or skirt-root body per side, in model units. The gate: it must be 0. */
  penetration: Record<Side, number>
  /** Deepest arm centerline overlap of a dynamic (physics) cloth body per side, in model units. Information only: the simulation resolves it. */
  clothContact: Record<Side, number>
  /** The rest upper-arm hang in degrees below horizontal in effect: the default, a per-rig solved lift (a smaller hang), or the debug override. */
  hangDeg: number
  /** Both hand bones sit below the hips bone, so the arms hang. */
  handBelowHip: boolean
  /** Deepest arm capsule-radius overlap of a kinematic head or neck body per side, in model units. */
  headPenetration: Record<Side, number>
  /** The performer's arm collision correction in effect per side, in degrees. */
  correctionDeg: Record<Side, number>
}

const radiansPerDegree = Math.PI / 180
/** Arm capsule radius as a share of its segment length. */
const ARM_RADIUS_RATIO = 0.12
/** The hand reaches this share of the forearm length beyond the wrist bone. */
const HAND_EXTENSION = 0.65
const SAMPLES_PER_CAPSULE = 5
/** The upper-arm capsule starts this share of the way down the arm: the shoulder joint sits inside the chest bodies by construction. */
const SHOULDER_SKIP = 0.5
/**
 * The per-rig hang solver lifts the arm away from the body in steps of this many degrees, down to `MIN_HANG_DEG`.
 * The hang is measured below horizontal, so a smaller hang abducts the arm: a larger one swings it into the hips.
 */
const HANG_STEP_DEG = 2
const MIN_HANG_DEG = 60
/**
 * The solver reacts to a clearance, not to contact: an arm capsule grown by this share of its segment length that touches
 * a kinematic body lifts the arm before the exact capsule does, because the standing sway drives the arm into the hips
 * slowly (up to 0.1 model units over half a second). The reported `penetration` keeps the exact radius.
 */
const SOLVER_CLEARANCE_RATIO = 0.03
/** A step needs the clearance violated on this many consecutive solving frames, and solving starts after the warm-up, so load transients never move the hang. */
const SOLVE_PERSISTENCE_FRAMES = 5
const SOLVE_WARMUP_FRAMES = 60
/** The performer's rest abduction, restated as the hang below horizontal that diagnostics and the debug override use. */
const DEFAULT_HANG_DEG = 90 - DEFAULT_ARM_REST_POSE.abduct / radiansPerDegree

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
 * Measures whether the posed arms clear the body, and runs the per-rig hang solver whose lift the performer adds to its
 * rest abduction. The performer owns every arm bone write.
 */
export class MMDArms {
  /** Degrees the arm is lifted from the default hang for this rig; only grows, in `HANG_STEP_DEG` steps, while a standing arm keeps overlapping a kinematic body. */
  private liftDeg = 0
  private overlapFrames = 0
  private frames = 0
  /** The hang the last `lift` reported, which is the one `measure` reports. */
  private appliedHang = DEFAULT_HANG_DEG
  private solving = false
  private readonly lifted = { left: 0, right: 0 }

  constructor(private readonly pose: MMDBodyPose, private readonly colliders: MMDArmTestColliders, private readonly head: readonly MMDTouchCollider[]) {}

  /**
   * The extra abduction per side in radians for this frame; solving runs only while both arms are free and not swinging,
   * and `measure` also holds it while a gesture layer moves either arm.
   */
  lift(input: MMDArmLiftInput): Readonly<Record<Side, number>> {
    this.appliedHang = input.hangDeg ?? DEFAULT_HANG_DEG - this.liftDeg
    this.frames++
    this.solving = this.frames > SOLVE_WARMUP_FRAMES && input.hangDeg === null && input.swingWeight === 0 && input.owned.leftArm === 0 && input.owned.rightArm === 0
    this.lifted.left = this.lifted.right = (DEFAULT_HANG_DEG - this.appliedHang) * radiansPerDegree
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

  /**
   * `gestureActivation` and `actActivation` are the weights the performer's gesture layers and its act-order layers (an
   * idle behaviour's form, the clip-free rest) applied to each arm on the latest tick. The hang is frozen while any is
   * above 0 (architecture 3f): a lift step under a performed arm would move the pose the gesture retracts to, and an
   * arm an act brings to the body (a clasp, a stretch on its way down) is not a standing arm against the hips, so a
   * lift learnt from it would hold her arms out for the rest of the session.
   */
  measure(owned: MMDArmOwnership, correctionDeg: Readonly<Record<Side, number>>, gestureActivation: Readonly<Record<Side, number>>, actActivation: Readonly<Record<Side, number>>): MMDArmsMeasurement {
    const solving = this.solving && gestureActivation.left === 0 && gestureActivation.right === 0 && actActivation.left === 0 && actActivation.right === 0
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
    let tight = 0
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
        Array.from({ length: SAMPLES_PER_CAPSULE }, (_, index) => ({ point: from.clone().lerp(to, index / (SAMPLES_PER_CAPSULE - 1)), radius, clearance: SOLVER_CLEARANCE_RATIO * from.distanceTo(to) })))
      penetration[side] = this.deepest(samples, this.colliders.kinematic, toMesh)
      headPenetration[side] = this.deepest(samples, this.head, toMesh)
      if (solving)
        tight = Math.max(tight, this.deepest(samples.map(({ point, radius, clearance }) => ({ point, radius: radius + clearance })), this.colliders.kinematic, toMesh))
      clothContact[side] = this.deepest(samples.map(({ point }) => ({ point, radius: 0 })), this.colliders.dynamic, toMesh)
    }
    // The next frame poses with the lifted arm; the measurement above still reports this frame's overlap.
    if (solving && tight > 0)
      this.overlapFrames++
    else if (solving)
      this.overlapFrames = 0
    if (this.overlapFrames >= SOLVE_PERSISTENCE_FRAMES) {
      this.overlapFrames = 0
      this.liftDeg = Math.min(this.liftDeg + HANG_STEP_DEG, DEFAULT_HANG_DEG - MIN_HANG_DEG)
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
