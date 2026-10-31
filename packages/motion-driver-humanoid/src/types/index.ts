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

/** A position or direction in model units. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Rest-relative angles, in radians, in the bone's parent frame. */
export interface RestRelativeRotation {
  yaw: number
  pitch: number
  roll: number
}

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

/** A renderer-neutral intent for body stance, attention, and facing. */
export interface BodyIntent {
  stance: 'stand' | 'sit' | 'sleep'
  attention: {
    kind: 'camera' | 'cursor' | 'chat' | 'screen' | 'aside'
    point: Vec3 | null
  }
  /** Facing direction in radians. */
  facingYaw: number
}
