import type { RestRelativeRotation } from './index'

/** A 3x3 rotation matrix in row-major order: `[m00, m01, m02, m10, m11, m12, m20, m21, m22]`. */
export type RotationMatrix = readonly [number, number, number, number, number, number, number, number, number]

function multiply(a: RotationMatrix, b: RotationMatrix): RotationMatrix {
  const out = Array.from({ length: 9 }).fill(0)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++)
      out[row * 3 + col] = a[row * 3]! * b[col]! + a[row * 3 + 1]! * b[3 + col]! + a[row * 3 + 2]! * b[6 + col]!
  }
  return out as unknown as RotationMatrix
}

/**
 * Converts a rest-relative rotation to a matrix.
 *
 * The Euler order is intrinsic YXZ: `R = Ry(yaw) * Rx(pitch) * Rz(roll)`, with
 * right-handed axes and radians. Roll is applied to a vector first.
 */
export function rotationToMatrix(r: RestRelativeRotation): RotationMatrix {
  const cy = Math.cos(r.yaw)
  const sy = Math.sin(r.yaw)
  const cx = Math.cos(r.pitch)
  const sx = Math.sin(r.pitch)
  const cz = Math.cos(r.roll)
  const sz = Math.sin(r.roll)
  const ry: RotationMatrix = [cy, 0, sy, 0, 1, 0, -sy, 0, cy]
  const rx: RotationMatrix = [1, 0, 0, 0, cx, -sx, 0, sx, cx]
  const rz: RotationMatrix = [cz, -sz, 0, sz, cz, 0, 0, 0, 1]
  return multiply(multiply(ry, rx), rz)
}

/** Inverse of {@link rotationToMatrix}; at gimbal lock (pitch of +-90 degrees) roll is zero. */
export function matrixToRotation(m: RotationMatrix): RestRelativeRotation {
  const sinPitch = -m[5]
  const pitch = Math.asin(Math.min(1, Math.max(-1, sinPitch)))
  if (Math.abs(m[5]) < 0.9999999)
    return { yaw: Math.atan2(m[2], m[8]), pitch, roll: Math.atan2(m[3], m[4]) }
  return { yaw: Math.atan2(-m[6], m[0]), pitch, roll: 0 }
}

/** Mirrors a left-side rotation to the right side: yaw and roll change sign, pitch is kept. */
export function mirrorRotation(r: RestRelativeRotation): RestRelativeRotation {
  return { yaw: -r.yaw, pitch: r.pitch, roll: -r.roll }
}
