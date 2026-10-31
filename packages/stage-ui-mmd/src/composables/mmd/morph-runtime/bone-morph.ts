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

function multiply(a: MorphQuaternion, b: MorphQuaternion): MorphQuaternion {
  return {
    x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
    y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
    z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  }
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

/** Always starts from a caller-owned, pre-stage clean pose, never last frame. */
export function applyBoneMorphs(clean: readonly MorphBonePose[], morphs: readonly ConvertedBoneMorph[], weights: readonly number[]): MorphBonePose[] {
  const result = clean.map(pose => ({ position: { ...pose.position }, quaternion: { ...pose.quaternion } }))
  for (const morph of morphs) {
    const weight = weights[morph.morphIndex] ?? 0
    if (weight === 0)
      continue
    for (const element of morph.elements) {
      const pose = result[element.index]
      pose.position.x += weight * element.position.x
      pose.position.y += weight * element.position.y
      pose.position.z += weight * element.position.z
      pose.quaternion = multiply(pose.quaternion, weightedRotation(element.quaternion, weight))
    }
  }
  return result
}
