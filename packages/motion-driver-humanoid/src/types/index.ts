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

/**
 * How urgently she walks to a goal, in [0, 1]; the locomotion turns it into a share of the reference speed. The former
 * stroll and walk paces are 0.3 and 0.6.
 */
export const STROLL_URGENCY = 0.3
export const WALK_URGENCY = 0.6

/** Why the director issued the current locomotion goal. */
export type BodyLocomotionReason = 'stay' | 'return-home' | 'wander' | 'visit' | 'approach-chat' | 'approach-cursor' | 'tool' | 'debug' | 'enter-stage'

/** Where the body should walk, in stage-world x coordinates. */
export interface BodyLocomotionIntent {
  homeX: number
  goalX: number | null
  /** In [0, 1]: `STROLL_URGENCY` strolls, `WALK_URGENCY` walks, above it she hurries. */
  urgency: number
  /** Request a short lateral step that keeps the current yaw; longer goals still walk. */
  step?: 'sidestep'
  /** Facing yaw in radians to settle into on arrival; 0 faces the camera. */
  arriveFacing: number
  reason: BodyLocomotionReason
}

/** A clip the director has accepted; the adapter plays it and reports back. */
export interface BodyActionIntent {
  seq: number
  clipId: string
  layer: 'full' | 'upper'
  loop: boolean
  /** `settling` while the body clears the way (stand up, stop, finish speaking); `playing` once the clip may start. */
  phase: 'settling' | 'playing'
}

/** Target of a model's look-at request, realised by the performer's gaze arbiter. */
export type BodyLookTarget = 'camera' | 'cursor' | 'chat' | 'away'

/** A renderer-neutral intent for body stance, look requests, and facing. */
export interface BodyIntent {
  stance: 'stand' | 'sit' | 'sleep'
  /**
   * The procedural long state that stands in for a missing stance clip (architecture 4f): `rest` where she would sit,
   * `doze` where she would sleep; `none` otherwise, also while a clip realises the stance.
   */
  rest: 'none' | 'rest' | 'doze'
  /** The accepted look tool while its override holds. Perform each new seq once; holdMs is a duration. */
  look: { seq: number, target: BodyLookTarget, holdMs: number } | null
  /** Facing direction in radians. */
  facingYaw: number
  locomotion: BodyLocomotionIntent
  /** The accepted clip performance, or null when none runs. */
  action: BodyActionIntent | null
}
