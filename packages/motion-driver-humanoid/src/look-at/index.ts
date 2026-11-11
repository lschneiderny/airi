import type { RestRelativeRotation, RigTraits, Vec3 } from '../types'

export { createTurnPlanner } from './turn-planner'
export type { TurnFrame, TurnInput, TurnStep } from './turn-planner'

export type LookAtOptions = Partial<Pick<RigTraits, 'eyeYawLimit' | 'eyePitchLimit'>>

function finite(value: number) {
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Absolute per-eye aim in world-aligned axes (+Z forward, +Y up).
 * Adapters transform the world target into each animated eye parent frame before
 * applying a rest-relative rotation. Coincident or non-finite targets aim forward.
 */
export function aimEyes(
  eyes: Readonly<Record<'leftEye' | 'rightEye', Vec3>>,
  target: Vec3,
  limits: LookAtOptions = {},
): Record<'leftEye' | 'rightEye', RestRelativeRotation> {
  const yawLimit = Math.abs(finite(limits.eyeYawLimit ?? 0.35))
  const pitchLimit = Math.abs(finite(limits.eyePitchLimit ?? 0.25))
  function aim(eye: Vec3): RestRelativeRotation {
    const x = target.x - eye.x
    const y = target.y - eye.y
    const z = target.z - eye.z
    if (![x, y, z].every(Number.isFinite))
      return { yaw: 0, pitch: 0, roll: 0 }
    return {
      yaw: clamp(Math.atan2(x, z), -yawLimit, yawLimit),
      pitch: clamp(Math.atan2(-y, Math.hypot(x, z)), -pitchLimit, pitchLimit),
      roll: 0,
    }
  }
  return { leftEye: aim(eyes.leftEye), rightEye: aim(eyes.rightEye) }
}
