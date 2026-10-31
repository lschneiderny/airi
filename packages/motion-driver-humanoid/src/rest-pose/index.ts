import type { Foot } from '../foot-contact'
import type { ArmBoneName, RestRelativeRotation, Vec3 } from '../types'

import { matrixToRotation } from '../types'

const radiansPerDegree = Math.PI / 180
const fingerNames = ['thumb', 'index', 'middle', 'ring', 'little'] as const
const fingerScale = { index: 1, middle: 1.15, ring: 1.3, little: 1.45 } as const
const breathShoulderRoll = 0.8 * radiansPerDegree
const breathUpperArmRoll = 0.6 * radiansPerDegree
const torsoRollCoupling = 0.8
const torsoSpringOmega = 6

type FingerName = typeof fingerNames[number]

/** Body-space angles in radians; identical for every rig. Thumb triples map to Metacarpal, Proximal, Distal; other fingers to Proximal, Intermediate, Distal. */
export interface ArmRestPose {
  readonly hangAngle: number
  readonly shoulderDrop: number
  readonly flexion: number
  readonly elbowFlex: number
  readonly wristFlex: number
  readonly fingerCurl: Readonly<Record<FingerName, readonly [number, number, number]>>
}

export interface ArmRestSwing {
  readonly flexion: number
  readonly elbowFlex: number
}

export interface ArmRestInput {
  /** `MMDRigProfile.restArmAngle`; 0 for VRM. */
  readonly bindArmAngle: number
  /** Forearm bind angle; defaults to `bindArmAngle`. */
  readonly bindForearmAngle?: number
  /** Thumb curl axis measured by the adapter, in model axes. */
  readonly thumbAxis?: Readonly<Record<Foot, Vec3>>
  readonly pose: ArmRestPose
  /** -1..1 */
  readonly breath: number
  /** `upperBodyRoll + chestCounterRoll`, in radians. */
  readonly torsoRoll: number
  readonly swing?: Readonly<Record<Foot, ArmRestSwing>>
  readonly swingWeight: number
  readonly owned: Readonly<Record<'leftArm' | 'rightArm' | 'leftFingers' | 'rightFingers', number>>
}

export interface ArmRestFrame {
  /** Already scaled by `(1 - owned)`; applied as intrinsic YXZ. */
  readonly rotations: Readonly<Partial<Record<ArmBoneName, RestRelativeRotation>>>
}

export const DEFAULT_ARM_REST_POSE: ArmRestPose = {
  hangAngle: 78 * radiansPerDegree,
  shoulderDrop: 5 * radiansPerDegree,
  flexion: 4 * radiansPerDegree,
  elbowFlex: 12 * radiansPerDegree,
  wristFlex: 8 * radiansPerDegree,
  fingerCurl: {
    thumb: [10 * radiansPerDegree, 0, 0],
    index: curl(fingerScale.index),
    middle: curl(fingerScale.middle),
    ring: curl(fingerScale.ring),
    little: curl(fingerScale.little),
  },
}

function curl(scale: number): readonly [number, number, number] {
  return [15 * radiansPerDegree * scale, 20 * radiansPerDegree * scale, 10 * radiansPerDegree * scale]
}

interface Quat { x: number, y: number, z: number, w: number }

const identity: Quat = { x: 0, y: 0, z: 0, w: 1 }

function axisAngle(axis: Vec3, angle: number): Quat {
  const length = Math.hypot(axis.x, axis.y, axis.z)
  if (length === 0)
    return identity
  const s = Math.sin(angle / 2) / length
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(angle / 2) }
}

const rotX = (angle: number) => axisAngle({ x: 1, y: 0, z: 0 }, angle)
const rotZ = (angle: number) => axisAngle({ x: 0, y: 0, z: 1 }, angle)

function multiply(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
}

function conjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w }
}

/** `slerp(identity, q, weight)`; the shortest arc is used. */
function scaleRotation(q: Quat, weight: number): Quat {
  const sign = q.w < 0 ? -1 : 1
  const vectorLength = Math.hypot(q.x, q.y, q.z)
  if (vectorLength < 1e-12)
    return identity
  const angle = 2 * Math.atan2(vectorLength, sign * q.w) * weight
  const s = Math.sin(angle / 2) / vectorLength * sign
  return { x: q.x * s, y: q.y * s, z: q.z * s, w: Math.cos(angle / 2) }
}

function toRotation(q: Quat): RestRelativeRotation {
  const { x, y, z, w } = q
  return matrixToRotation([
    1 - 2 * (y * y + z * z),
    2 * (x * y - z * w),
    2 * (x * z + y * w),
    2 * (x * y + z * w),
    1 - 2 * (x * x + z * z),
    2 * (y * z - x * w),
    2 * (x * z - y * w),
    2 * (y * z + x * w),
    1 - 2 * (x * x + y * y),
  ])
}

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

/**
 * Creates the stateful arm rest-pose layer. It holds only the torso-roll spring.
 */
export function createArmRest() {
  let torso: { value: number, velocity: number } | null = null

  function advanceTorso(target: number, dt: number) {
    if (!torso) {
      torso = { value: target, velocity: 0 }
      return torso.value
    }
    if (!(dt > 0) || !Number.isFinite(dt))
      return torso.value
    const offset = torso.value - target
    const impulse = torso.velocity + torsoSpringOmega * offset
    const decay = Math.exp(-torsoSpringOmega * dt)
    torso = {
      value: target + (offset + impulse * dt) * decay,
      velocity: (torso.velocity - torsoSpringOmega * impulse * dt) * decay,
    }
    return torso.value
  }

  return {
    step(input: ArmRestInput, dt: number): ArmRestFrame {
      const torsoRoll = advanceTorso(input.torsoRoll, dt)
      const rotations: Partial<Record<ArmBoneName, RestRelativeRotation>> = {}
      for (const side of ['left', 'right'] as const) {
        writeSide(rotations, side, input, torsoRoll)
      }
      return { rotations }
    },
  }
}

function writeSide(
  out: Partial<Record<ArmBoneName, RestRelativeRotation>>,
  side: Foot,
  input: ArmRestInput,
  torsoRoll: number,
) {
  const { pose } = input
  const sigma = side === 'left' ? 1 : -1
  const armWeight = 1 - clamp01(input.owned[`${side}Arm`])
  const fingerWeight = 1 - clamp01(input.owned[`${side}Fingers`])
  const swingWeight = clamp01(input.swingWeight)
  const swing = input.swing?.[side]
  const swingFlexion = swing ? swing.flexion * swingWeight : 0
  const swingElbow = swing ? swing.elbowFlex * swingWeight : 0
  const rho = input.bindArmAngle
  const forearmRho = input.bindForearmAngle ?? rho
  const prefix = side

  const write = (name: ArmBoneName, q: Quat, weight: number) => {
    out[name] = toRotation(scaleRotation(q, weight))
  }

  const shoulderRest = rotZ(-sigma * pose.shoulderDrop)
  const desired = multiply(rotX(-(pose.flexion + swingFlexion)), rotZ(sigma * (rho - pose.hangAngle)))
  const upperRest = multiply(conjugate(shoulderRest), desired)
  const upperRoll = -sigma * breathUpperArmRoll * input.breath - torsoRollCoupling * torsoRoll

  write(`${prefix}Shoulder` as ArmBoneName, multiply(shoulderRest, rotZ(sigma * breathShoulderRoll * input.breath)), armWeight)
  write(`${prefix}UpperArm` as ArmBoneName, multiply(upperRest, rotZ(upperRoll)), armWeight)
  write(
    `${prefix}LowerArm` as ArmBoneName,
    axisAngle({ x: Math.sin(forearmRho), y: sigma * Math.cos(forearmRho), z: 0 }, -(pose.elbowFlex + swingElbow)),
    armWeight,
  )
  write(`${prefix}Hand` as ArmBoneName, rotZ(-sigma * pose.wristFlex), armWeight)

  for (const finger of fingerNames) {
    const joints = finger === 'thumb'
      ? ['Metacarpal', 'Proximal', 'Distal'] as const
      : ['Proximal', 'Intermediate', 'Distal'] as const
    const name = finger[0]!.toUpperCase() + finger.slice(1)
    const thumbAxis = finger === 'thumb' ? input.thumbAxis?.[side] : undefined
    joints.forEach((joint, index) => {
      const angle = pose.fingerCurl[finger][index]!
      const q = thumbAxis ? axisAngle(thumbAxis, angle) : rotZ(-sigma * angle)
      write(`${prefix}${name}${joint}` as ArmBoneName, q, fingerWeight)
    })
  }
}
