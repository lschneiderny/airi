/** Canonical VRM humanoid bone names supported by these motion algorithms. */
export type HumanoidBoneName
  = | 'hips'
    | 'spine'
    | 'chest'
    | 'upperChest'
    | 'neck'
    | 'head'
    | 'leftEye'
    | 'rightEye'
    | 'leftUpperLeg'
    | 'leftLowerLeg'
    | 'leftFoot'
    | 'leftToes'
    | 'rightUpperLeg'
    | 'rightLowerLeg'
    | 'rightFoot'
    | 'rightToes'
    | 'leftShoulder'
    | 'leftUpperArm'
    | 'leftLowerArm'
    | 'leftHand'
    | 'rightShoulder'
    | 'rightUpperArm'
    | 'rightLowerArm'
    | 'rightHand'

/** Canonical finger bone names; Metacarpal is absent on rigs without it. */
export type HumanoidFingerBoneName = `${'left' | 'right'}${'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Little'}${'Metacarpal' | 'Proximal' | 'Intermediate' | 'Distal'}`

/** Bones driven by the arm rest pose: shoulder, upper arm, lower arm, hand and fingers. */
export type ArmBoneName = Extract<HumanoidBoneName, `${string}${'Shoulder' | 'UpperArm' | 'LowerArm' | 'Hand'}`> | HumanoidFingerBoneName

/** A position or direction in model units. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/**
 * Rest-relative angles, in radians, in the bone's parent frame.
 * Applied as intrinsic YXZ Euler angles: `R = Ry(yaw) * Rx(pitch) * Rz(roll)`.
 */
export interface RestRelativeRotation {
  yaw: number
  pitch: number
  roll: number
}

export { matrixToRotation, mirrorRotation, rotationToMatrix } from './rotation'
export type { RotationMatrix } from './rotation'

/** Measurements and capabilities derived from a humanoid rig. */
export interface RigTraits {
  /** Leg length in model units. */
  legLength: number
  /** Ground-level foot height in model units. */
  footBaselineY: number
  /** Direction of knee pre-bend. */
  kneeBendSign: 1 | -1
  /** Maximum eye yaw in radians. */
  eyeYawLimit: number
  /** Maximum eye pitch in radians. */
  eyePitchLimit: number
  /** Canonical bones present in this rig. */
  presentBones: HumanoidBoneName[]
}

/** Locomotion pace; 0.6 and 1.0 times the reference speed. */
export type LocomotionPace = 'stroll' | 'walk'

/** Why the director issued the current locomotion goal. */
export type BodyLocomotionReason = 'stay' | 'return-home' | 'wander' | 'approach-chat' | 'approach-cursor' | 'tool' | 'debug'

/** Where the body should walk, in stage-world x coordinates. */
export interface BodyLocomotionIntent {
  homeX: number
  goalX: number | null
  pace: LocomotionPace
  /** Facing yaw in radians to settle into on arrival; 0 faces the camera. */
  arriveFacing: number
  reason: BodyLocomotionReason
}

/** A renderer-neutral intent for body stance, attention, and facing. */
export interface BodyIntent {
  stance: 'stand' | 'sit' | 'sleep'
  attention: {
    kind: 'camera' | 'cursor' | 'chat' | 'screen' | 'aside'
    point: Vec3 | null
  }
  /** Facing direction in radians. */
  facingYaw: number
  locomotion: BodyLocomotionIntent
}
