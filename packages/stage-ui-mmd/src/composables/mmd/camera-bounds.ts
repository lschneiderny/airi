import type { HumanoidBoneName } from '@proj-airi/motion-driver-humanoid/types'

export type BoundsVec3 = readonly [number, number, number]

export interface FrameBounds {
  center: [number, number, number]
  size: [number, number, number]
  /** `skeleton` when read from bones, `mesh` when the skeleton lacked 頭, 首 or ankles. */
  source: 'skeleton' | 'mesh'
}

export interface MeshBounds {
  min: BoundsVec3
  max: BoundsVec3
}

/** Head top sits this many neck-to-head lengths above the 頭 bone. */
export const HEAD_TOP_NECK_FACTOR = 1.5
/** Framed width is the shoulder span times this factor, to leave room for the arms. */
export const SHOULDER_WIDTH_FACTOR = 2.2

/**
 * The gait swings an arm by at most 2 + 12 * 1.3 = 17.6 degrees of shoulder flexion plus 12 to 20 degrees of elbow flexion,
 * so a hand strays at most sin(25 degrees) = 0.42 of its distance from the shoulder; the rest is margin.
 * While she walks she faces along the stage, so that forward swing is lateral on screen.
 */
export const ARM_SWING_REACH = 0.45

const distance = (a: BoundsVec3, b: BoundsVec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

type FrameBone = Extract<HumanoidBoneName, 'head' | 'neck' | 'leftFoot' | 'rightFoot' | 'leftToes' | 'rightToes' | 'leftUpperArm' | 'rightUpperArm'>

/**
 * Frames a model from its skeleton, so a skirt or hair mesh hanging far below the feet
 * (long-skirt Elysia's mesh reaches Y -17.8 against feet at 0.23) does not shrink it.
 *
 * Bottom is the lowest of the ankle and toe bones, and width is the span between the upper
 * arms times {@link SHOULDER_WIDTH_FACTOR}. Top is the larger of the 頭 bone plus
 * {@link HEAD_TOP_NECK_FACTOR} times the neck-to-head length and the mesh top: only the mesh
 * bottom is unreliable (skirts and hair hang below the feet), while the mesh top is the real
 * crown, which the bone estimate undershoots (Ellen: 17.46 against 19.23). The whole mesh is
 * used only when 頭, 首 or both ankles are missing. A missing or zero arm span gives width 0,
 * so the fit is by height alone.
 *
 * `reachBones` names bones (hands and fingertips) whose lateral distance from the shoulder centre, plus `swingReach` times
 * the bone's distance from the nearer upper arm, widens the frame to twice the farthest one when that exceeds the shoulder
 * width. The desktop stage passes them, with positions from the rest pose, so its placement rect holds the hands while she
 * stands and swings her arms in a walk; the classic window passes none and keeps its framing.
 *
 * `positionOf` returns a world position for a mapped bone name, or null when it is absent.
 */
export function resolveFrameBounds(
  bones: Partial<Record<HumanoidBoneName, string>>,
  positionOf: (boneName: string) => BoundsVec3 | null,
  mesh: MeshBounds | null,
  reachBones: readonly string[] = [],
  swingReach = 0,
): FrameBounds | null {
  const at = (humanoid: FrameBone): BoundsVec3 | null => {
    const name = bones[humanoid]
    return name ? positionOf(name) : null
  }
  const head = at('head')
  const neck = at('neck')
  const ankles = [at('leftFoot'), at('rightFoot')].filter((p): p is BoundsVec3 => p !== null)

  if (head && neck && ankles.length > 0) {
    const lowest = [...ankles, at('leftToes'), at('rightToes')]
      .reduce((min, p) => (p ? Math.min(min, p[1]) : min), Number.POSITIVE_INFINITY)
    const skeletonTop = head[1] + HEAD_TOP_NECK_FACTOR * Math.hypot(head[0] - neck[0], head[1] - neck[1], head[2] - neck[2])
    const top = mesh ? Math.max(skeletonTop, mesh.max[1]) : skeletonTop
    const armL = at('leftUpperArm')
    const armR = at('rightUpperArm')
    const span = armL && armR ? Math.hypot(armL[0] - armR[0], armL[1] - armR[1], armL[2] - armR[2]) : 0
    const centerX = armL && armR ? (armL[0] + armR[0]) / 2 : head[0]
    const reach = reachBones.reduce((max, name) => {
      const position = positionOf(name)
      if (!position)
        return max
      const arm = [armL, armR].reduce((nearest, candidate) => candidate && (!nearest || distance(candidate, position) < distance(nearest, position)) ? candidate : nearest, null as BoundsVec3 | null)
      return Math.max(max, Math.abs(position[0] - centerX) + (arm ? swingReach * distance(arm, position) : 0))
    }, 0)
    const width = Math.max(span * SHOULDER_WIDTH_FACTOR, 2 * reach)
    if (top > lowest) {
      return {
        center: [centerX, (lowest + top) / 2, head[2]],
        size: [width, top - lowest, 0],
        source: 'skeleton',
      }
    }
  }

  if (!mesh)
    return null
  return {
    center: [
      (mesh.min[0] + mesh.max[0]) / 2,
      (mesh.min[1] + mesh.max[1]) / 2,
      (mesh.min[2] + mesh.max[2]) / 2,
    ],
    size: [mesh.max[0] - mesh.min[0], mesh.max[1] - mesh.min[1], mesh.max[2] - mesh.min[2]],
    source: 'mesh',
  }
}
