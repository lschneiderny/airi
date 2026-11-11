import type { PmxObject } from '@moeru/three-mmd'

export interface MorphVector { readonly x: number, readonly y: number, readonly z: number }
export interface MorphQuaternion extends MorphVector { readonly w: number }
export interface MorphBonePose {
  readonly position: MorphVector
  readonly quaternion: MorphQuaternion
}

interface ConvertedBoneMorph {
  readonly morphIndex: number
  readonly elements: readonly (MorphBonePose & { readonly index: number })[]
}

export function convertBoneMorphs(morphs: readonly PmxObject.Morph[]): ConvertedBoneMorph[] {
  return morphs.flatMap((morph, morphIndex) => {
    if (morph.type !== 2)
      return []
    return [{
      morphIndex,
      elements: Array.from(morph.indices, (index, i) => ({
        index,
        position: { x: morph.positions[i * 3], y: morph.positions[i * 3 + 1], z: -morph.positions[i * 3 + 2] },
        quaternion: { x: -morph.rotations[i * 4], y: -morph.rotations[i * 4 + 1], z: morph.rotations[i * 4 + 2], w: morph.rotations[i * 4 + 3] },
      })),
    }]
  })
}

/** Shortest-arc identity-to-offset slerp, including negative group weights. */
function weightedRotation(q: MorphQuaternion, weight: number): MorphQuaternion {
  const sign = q.w < 0 ? -1 : 1
  if (weight === 1)
    return { x: q.x * sign, y: q.y * sign, z: q.z * sign, w: q.w * sign }
  const w = Math.min(1, Math.max(-1, q.w * sign))
  const angle = Math.acos(w)
  if (angle < 1e-8)
    return { x: 0, y: 0, z: 0, w: 1 }
  const factor = sign * Math.sin(angle * weight) / Math.sin(angle)
  return { x: q.x * factor, y: q.y * factor, z: q.z * factor, w: Math.cos(angle * weight) }
}

/** Numbers per bone in a {@link composeBoneMorphs} buffer: position x, y, z, then quaternion x, y, z, w. */
export const BONE_MORPH_STRIDE = 7

/**
 * Writes the clean pose with the weighted bone morphs into `out`, {@link BONE_MORPH_STRIDE} numbers per bone. It runs
 * every frame, so it allocates nothing unless a morph weight is non-zero. Always starts from a caller-owned, pre-stage
 * clean pose, never last frame.
 */
export function composeBoneMorphs(clean: readonly MorphBonePose[], morphs: readonly ConvertedBoneMorph[], weights: readonly number[], out: Float64Array): void {
  for (let i = 0; i < clean.length; i++) {
    const { position, quaternion } = clean[i]
    const o = i * BONE_MORPH_STRIDE
    out[o] = position.x
    out[o + 1] = position.y
    out[o + 2] = position.z
    out[o + 3] = quaternion.x
    out[o + 4] = quaternion.y
    out[o + 5] = quaternion.z
    out[o + 6] = quaternion.w
  }
  for (let m = 0; m < morphs.length; m++) {
    const morph = morphs[m]
    const weight = weights[morph.morphIndex] ?? 0
    if (weight === 0)
      continue
    for (let e = 0; e < morph.elements.length; e++) {
      const element = morph.elements[e]
      const o = element.index * BONE_MORPH_STRIDE
      out[o] += weight * element.position.x
      out[o + 1] += weight * element.position.y
      out[o + 2] += weight * element.position.z
      const b = weightedRotation(element.quaternion, weight)
      const ax = out[o + 3]
      const ay = out[o + 4]
      const az = out[o + 5]
      const aw = out[o + 6]
      out[o + 3] = ax * b.w + aw * b.x + ay * b.z - az * b.y
      out[o + 4] = ay * b.w + aw * b.y + az * b.x - ax * b.z
      out[o + 5] = az * b.w + aw * b.z + ax * b.y - ay * b.x
      out[o + 6] = aw * b.w - ax * b.x - ay * b.y - az * b.z
    }
  }
}

/** {@link composeBoneMorphs} as new pose objects. */
export function applyBoneMorphs(clean: readonly MorphBonePose[], morphs: readonly ConvertedBoneMorph[], weights: readonly number[]): MorphBonePose[] {
  const out = new Float64Array(clean.length * BONE_MORPH_STRIDE)
  composeBoneMorphs(clean, morphs, weights, out)
  return clean.map((_, i) => {
    const o = i * BONE_MORPH_STRIDE
    return {
      position: { x: out[o], y: out[o + 1], z: out[o + 2] },
      quaternion: { x: out[o + 3], y: out[o + 4], z: out[o + 5], w: out[o + 6] },
    }
  })
}
