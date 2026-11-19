import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Vec3 } from './types'

/** The bone on the other side of the body; a midline bone is its own mirror. */
export function mirrorBone(bone: MotionTraceBone): MotionTraceBone {
  if (bone.startsWith('left'))
    return `right${bone.slice(4)}` as MotionTraceBone
  if (bone.startsWith('right'))
    return `left${bone.slice(5)}` as MotionTraceBone
  return bone
}

/** A rotation vector in trace axes (X lateral) under the left-right mirror: an axial vector keeps x and flips y and z. */
export const mirrorRotation = (v: Vec3): Vec3 => [v[0], -v[1], -v[2]]

/** Row-major rotation matrix of a rotation vector (radians). */
function rotationMatrix(x: number, y: number, z: number): number[] {
  const angle = Math.hypot(x, y, z)
  if (angle < 1e-12)
    return [1, 0, 0, 0, 1, 0, 0, 0, 1]
  const [a, b, c] = [x / angle, y / angle, z / angle]
  const s = Math.sin(angle)
  const k = 1 - Math.cos(angle)
  return [
    1 - k * (b * b + c * c),
    -s * c + k * a * b,
    s * b + k * a * c,
    s * c + k * a * b,
    1 - k * (a * a + c * c),
    -s * a + k * b * c,
    -s * b + k * a * c,
    s * a + k * b * c,
    1 - k * (a * a + b * b),
  ]
}

/** M R M with M = diag(-1, 1, 1): the entries with exactly one lateral index change sign. */
const MIRROR_SIGNS = [1, -1, -1, -1, 1, 1, -1, 1, 1]

/**
 * Gate version 5 posture features (E/g3/s/rules.md 12.5, map m) of bone-major rotation vectors over `bones`. Each bone
 * becomes (R - I) / sqrt(2), nine numbers continuous through 180 degrees (a turn of 179 and one of 181 degrees lie 2
 * degrees apart; the length is 2 sin(angle / 2), the angle for small turns). The features are the mirror-symmetric part
 * of those numbers, then per bone the length of the antisymmetric part, so a pose and its mirror image (left and right
 * bones swapped, R -> M R M) have the same features. A bone whose mirror bone is absent mirrors onto itself.
 */
export function postureFeatures(v: readonly number[], bones: readonly MotionTraceBone[]): number[] {
  const own = bones.map((_, i) => rotationMatrix(v[3 * i], v[3 * i + 1], v[3 * i + 2]).map((e, j) => (e - (j % 4 === 0 ? 1 : 0)) / Math.SQRT2))
  const mirrored = bones.map((bone, i) => {
    const j = bones.indexOf(mirrorBone(bone))
    return own[j < 0 ? i : j].map((e, k) => e * MIRROR_SIGNS[k])
  })
  return [
    ...own.flatMap((f, i) => f.map((e, k) => (e + mirrored[i][k]) / 2)),
    ...own.map((f, i) => Math.hypot(...f.map((e, k) => (e - mirrored[i][k]) / 2))),
  ]
}
