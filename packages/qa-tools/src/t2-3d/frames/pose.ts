import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat, Vec3 } from '../metrics'
import type { DecodedMotionTrace } from '../read-trace'

import { add, conjugate, multiply, normalize, rotate, sub, yawQuat } from '../metrics/math'

/** One bone of a skinned mesh at bind, in mesh world space. */
export interface FrameRigBone {
  readonly name: string
  readonly parent: number
  /** The trace column this bone is recorded under, or null for a bone the trace does not name. */
  readonly slot: MotionTraceBone | null
  readonly bindRotation: Quat
  readonly bindPosition: Vec3
  /** Physics-owned bones (hair, cloth) keep their bind pose relative to their parent: frames show no physics. */
  readonly physics: boolean
}

/**
 * A skinned mesh in renderer-neutral form: bind positions in mesh world space, four bone influences per vertex, and
 * `basis`, the rotation from mesh world axes to the trace's axes (x right, y up, z forward), as the trace sampler uses.
 */
export interface FrameRig {
  readonly bones: readonly FrameRigBone[]
  readonly basis: Quat
  readonly positions: ArrayLike<number>
  readonly skinIndices: ArrayLike<number>
  readonly skinWeights: ArrayLike<number>
  readonly triangles: ArrayLike<number>
}

export interface LocalPose {
  readonly rotation: Quat
  readonly position: Vec3
}

export interface PosedBones {
  readonly rotations: readonly Quat[]
  readonly positions: readonly Vec3[]
}

export class FramePoseRefusal extends Error {
  override readonly name = 'FramePoseRefusal'
}

/** Parents before children, whatever order the model lists its bones in. */
export function boneOrder(bones: readonly FrameRigBone[]): number[] {
  const order: number[] = []
  const placed = new Set<number>()
  const visit = (index: number, path: Set<number>) => {
    if (placed.has(index))
      return
    if (path.has(index))
      throw new FramePoseRefusal(`bone hierarchy has a cycle at ${bones[index].name}`)
    const parent = bones[index].parent
    if (parent >= 0)
      visit(parent, new Set([...path, index]))
    placed.add(index)
    order.push(index)
  }
  bones.forEach((_, index) => visit(index, new Set()))
  return order
}

/** Bones that carry skin weight but neither the trace nor physics poses: the frame needs them from a re-run. */
export function neededBones(rig: FrameRig, traced: ReadonlySet<MotionTraceBone>): number[] {
  const weighted = new Set<number>()
  for (let i = 0; i < rig.skinWeights.length; i++) {
    if (rig.skinWeights[i] > 0)
      weighted.add(rig.skinIndices[i])
  }
  return [...weighted].filter(index => !rig.bones[index].physics && (!rig.bones[index].slot || !traced.has(rig.bones[index].slot))).sort((a, b) => a - b)
}

/** The trace's rest-normalised world rotation N of every traced bone on one frame: parent chain of the stored local rotations. */
function traceWorld(input: DecodedMotionTrace, frame: number): Map<MotionTraceBone, Quat> {
  const { bones, parents } = input.trace.rig
  const world: Quat[] = []
  for (let b = 0; b < bones.length; b++) {
    const o = (frame * bones.length + b) * 4
    const local: Quat = [input.rot[o], input.rot[o + 1], input.rot[o + 2], input.rot[o + 3]]
    // The recorder stores the hips relative to the accumulated root yaw, every other bone relative to its trace parent.
    const parent = bones[b] === 'hips' ? yawQuat(input.root[frame * 4 + 3]) : parents[b] >= 0 ? world[parents[b]] : [0, 0, 0, 1] as const
    world.push(normalize(multiply(parent, local)))
  }
  return new Map(bones.map((bone, b) => [bone, world[b]]))
}

/**
 * Poses every bone for one trace frame. Traced bones take the trace's rotation, mapped back to mesh world as
 * W = conj(basis) N basis W0 (the inverse of the sampler's N = basis W conj(W0) conj(basis)); the hips take the
 * trace's root position. Untraced bones take `rerun` (their transform relative to the parent in a re-run of the same
 * run), else their bind pose relative to the parent. A needed bone without `rerun` is refused.
 */
export function poseFrame(rig: FrameRig, input: DecodedMotionTrace, frame: number, rerun?: (bone: number) => LocalPose | null): PosedBones {
  const traced = new Set(input.trace.rig.bones)
  const needed = neededBones(rig, traced)
  if (needed.length && !rerun)
    throw new FramePoseRefusal(`the trace lacks ${needed.length} skinned bone(s) and no re-run poses them: ${needed.map(index => rig.bones[index].name).join(', ')}`)
  const n = traceWorld(input, frame)
  const basisInverse = conjugate(rig.basis)
  const rotations: Quat[] = Array.from({ length: rig.bones.length }, () => [0, 0, 0, 1])
  const positions: Vec3[] = Array.from({ length: rig.bones.length }, () => [0, 0, 0])
  for (const index of boneOrder(rig.bones)) {
    const bone = rig.bones[index]
    const parent = bone.parent >= 0 ? rig.bones[bone.parent] : null
    // How far the parent turned from its bind pose; a bone without its own source keeps its bind offset under it.
    const parentDelta: Quat = parent ? multiply(rotations[bone.parent], conjugate(parent.bindRotation)) : [0, 0, 0, 1]
    const bindFollow = (): LocalPose => ({
      rotation: multiply(parentDelta, bone.bindRotation),
      position: parent ? add(positions[bone.parent], rotate(parentDelta, sub(bone.bindPosition, parent.bindPosition))) : bone.bindPosition,
    })
    const traceN = bone.slot ? n.get(bone.slot) : undefined
    let pose: LocalPose
    if (traceN) {
      const follow = bindFollow()
      const rootPosition: Vec3 = [input.root[frame * 4], input.root[frame * 4 + 1], input.root[frame * 4 + 2]]
      pose = {
        rotation: normalize(multiply(multiply(multiply(basisInverse, traceN), rig.basis), bone.bindRotation)),
        position: bone.slot === 'hips' ? rotate(basisInverse, rootPosition) : follow.position,
      }
    }
    else {
      const local = bone.physics ? null : rerun?.(index) ?? null
      pose = local
        ? {
            rotation: parent ? normalize(multiply(rotations[bone.parent], local.rotation)) : local.rotation,
            position: parent ? add(positions[bone.parent], rotate(rotations[bone.parent], local.position)) : local.position,
          }
        : bindFollow()
    }
    rotations[index] = pose.rotation
    positions[index] = pose.position
  }
  return { rotations, positions }
}

export function skin(rig: FrameRig, posed: PosedBones): Float32Array {
  const count = rig.positions.length / 3
  const out = new Float32Array(count * 3)
  const deltas = rig.bones.map((bone, b) => multiply(posed.rotations[b], conjugate(bone.bindRotation)))
  for (let v = 0; v < count; v++) {
    const p: Vec3 = [rig.positions[v * 3], rig.positions[v * 3 + 1], rig.positions[v * 3 + 2]]
    let x = 0
    let y = 0
    let z = 0
    for (let k = 0; k < 4; k++) {
      const w = rig.skinWeights[v * 4 + k]
      if (!w)
        continue
      const b = rig.skinIndices[v * 4 + k]
      const moved = add(posed.positions[b], rotate(deltas[b], sub(p, rig.bones[b].bindPosition)))
      x += w * moved[0]
      y += w * moved[1]
      z += w * moved[2]
    }
    const t = rotate(rig.basis, [x, y, z])
    out.set(t, v * 3)
  }
  return out
}
