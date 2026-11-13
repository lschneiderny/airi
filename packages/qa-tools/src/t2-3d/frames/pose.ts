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
  /** A PMX append (grant) of rotation: this bone also turns by `ratio` times the local rotation of bone `parent`. */
  readonly append?: { readonly parent: number, readonly ratio: number } | null
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
    // An append child reads its append parent's pose, so that parent is placed first too.
    for (const before of [bones[index].parent, bones[index].append?.parent ?? -1]) {
      if (before >= 0)
        visit(before, new Set([...path, index]))
    }
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

/**
 * Needed bones that `trace` posing cannot pose: neither traced nor an append child of a bone it poses. They keep their
 * bind pose relative to their parent in a trace-posed frame.
 */
export function unposedBones(rig: FrameRig, traced: ReadonlySet<MotionTraceBone>): number[] {
  const posed = (index: number, seen: ReadonlySet<number>): boolean => {
    const bone = rig.bones[index]
    if (bone.slot && traced.has(bone.slot))
      return true
    const parent = bone.append?.parent
    return parent !== undefined && parent >= 0 && !seen.has(parent) && posed(parent, new Set([...seen, index]))
  }
  return neededBones(rig, traced).filter(index => !posed(index, new Set()))
}

/** q raised to `ratio` (the turn scaled about the same axis): MMD's append of rotation, slerp(identity, q, ratio). */
function scaleTurn(q: Quat, ratio: number): Quat {
  const [x, y, z, w] = q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q
  const half = Math.acos(Math.min(1, w))
  const sine = Math.sin(half)
  if (sine < 1e-12)
    return [0, 0, 0, 1]
  const k = Math.sin(half * ratio) / sine
  return [x * k, y * k, z * k, Math.cos(half * ratio)]
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
 * run), else their bind pose relative to the parent. A needed bone without `rerun` is refused, unless `rerun` is
 * `'trace'`: then an untraced append child turns by its ratio of its append parent's local rotation, every other
 * untraced bone keeps its bind pose relative to its parent (see `unposedBones`), and an untraced root-level bone (MMD's
 * 全ての親 or センター) moves by the translation the hips took from their bind position to the trace's root position, so the
 * bones that hang from it, the upper body among them, follow her root.
 */
export function poseFrame(rig: FrameRig, input: DecodedMotionTrace, frame: number, rerun?: ((bone: number) => LocalPose | null) | 'trace'): PosedBones {
  const traced = new Set(input.trace.rig.bones)
  const needed = neededBones(rig, traced)
  if (needed.length && rerun === undefined)
    throw new FramePoseRefusal(`the trace lacks ${needed.length} skinned bone(s) and no re-run poses them: ${needed.map(index => rig.bones[index].name).join(', ')}`)
  const n = traceWorld(input, frame)
  const basisInverse = conjugate(rig.basis)
  const rootPosition: Vec3 = rotate(basisInverse, [input.root[frame * 4], input.root[frame * 4 + 1], input.root[frame * 4 + 2]])
  const hips = rig.bones.find(bone => bone.slot === 'hips' && traced.has('hips'))
  const carried: Vec3 = rerun === 'trace' && hips ? sub(rootPosition, hips.bindPosition) : [0, 0, 0]
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
      pose = {
        rotation: normalize(multiply(multiply(multiply(basisInverse, traceN), rig.basis), bone.bindRotation)),
        position: bone.slot === 'hips' ? rootPosition : follow.position,
      }
    }
    else if (rerun === 'trace') {
      const bound = bindFollow()
      const follow = parent ? bound : { ...bound, position: add(bound.position, carried) }
      const source = bone.append && !bone.physics ? rig.bones[bone.append.parent] : null
      if (bone.append && source) {
        // The append parent's local rotation relative to its own bind local rotation, as the PMX grant solver reads it.
        const above = source.parent >= 0 ? rig.bones[source.parent] : null
        const local = multiply(conjugate(above ? rotations[source.parent] : [0, 0, 0, 1]), rotations[bone.append.parent])
        const bindLocal = multiply(conjugate(above ? above.bindRotation : [0, 0, 0, 1]), source.bindRotation)
        pose = { rotation: normalize(multiply(follow.rotation, scaleTurn(normalize(multiply(conjugate(bindLocal), local)), bone.append.ratio))), position: follow.position }
      }
      else {
        pose = follow
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
