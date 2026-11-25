import type { BodyMeshSource, BodyModel } from '@proj-airi/motion-driver-humanoid/body-model'
import type { BodyBone, BodyCollider } from '@proj-airi/motion-driver-humanoid/performance'
import type { BufferGeometry, Matrix4 as Matrix4Type } from 'three'

import type { MMDRigProfile } from '../rig'
import type { MMDTouchCollider } from '../touch/colliders'

import { PmxObject } from '@moeru/three-mmd'
import { buildBodyModel } from '@proj-airi/motion-driver-humanoid/body-model'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

type Side = 'left' | 'right'

/** The PMX fields the body model reads. `mmd.pmx` satisfies it; values are post-parse, as the rig profile reads them. */
export interface MMDBodyModelSource {
  readonly bones: readonly (Pick<PmxObject.Bone, 'name' | 'parentBoneIndex' | 'position'> & Partial<Pick<PmxObject.Bone, 'appendTransform' | 'flag'>>)[]
  readonly rigidBodies: readonly Pick<PmxObject.RigidBody, 'boneIndex' | 'physicsMode' | 'shapePosition' | 'collisionGroup' | 'collisionMask'>[]
  readonly joints: readonly Pick<PmxObject.Joint, 'rigidbodyIndexA' | 'rigidbodyIndexB' | 'position' | 'rotationMin' | 'rotationMax' | 'positionMin' | 'positionMax'>[]
}

/** The skinned mesh the body model reads: the bind-pose geometry and the bind data its bone offsets were built from. */
export interface MMDBodyModelMesh {
  readonly geometry: Pick<BufferGeometry, 'getAttribute' | 'index'>
  readonly bindMatrix: Matrix4Type
  readonly skeleton: { readonly boneInverses: readonly Matrix4Type[] }
}

/** PMX physics mode 0: the body follows its bone. Modes 1 and 2 are simulated. */
const PHYSICS_FOLLOW_BONE = 0

const SPINE_BONES = ['spine0', 'spine1', 'spine2', 'spine3'] as const

/** The largest magnitude each axis of a joint limit allows; an axis whose minimum exceeds its maximum is free. */
function limitNorm(min: readonly number[], max: readonly number[], free: number): number {
  let sum = 0
  for (let axis = 0; axis < 3; axis++) {
    const bound = min[axis] > max[axis] ? free : Math.min(free, Math.max(Math.abs(min[axis]), Math.abs(max[axis])))
    sum += bound * bound
  }
  return Math.sqrt(sum)
}

/**
 * How far the joint limits let the simulator carry each simulated bone, in model units, by PMX bone index.
 *
 * A simulated body hangs from the bone-following bodies through a graph of joints. Each joint on a path lets the body's
 * centre travel by its rotation limit times the centre's distance from the joint, plus its translation limit; the path
 * that allows the least bounds the bone. A body no path ties to a bone-following body is unbounded.
 *
 * The lever is the authored centre of the body (`shapePosition`), which stands in for the bone's tail: many PMX files
 * leave tails unset. It is the one authored place the body model depends on, and moving it can move a bone across the
 * flesh threshold. The centroid of the vertices the bone carries was measured as the lever on ten rigs (2026-11-25)
 * and not adopted: it takes the chest bones of two of them out of the flesh (body model ADR, decision 3).
 */
export function mmdJointMobility(pmx: Pick<MMDBodyModelSource, 'bones' | 'joints'> & { readonly rigidBodies: readonly Pick<PmxObject.RigidBody, 'boneIndex' | 'physicsMode' | 'shapePosition'>[] }): Map<number, number> {
  const bodies = pmx.rigidBodies
  const valid = (index: number) => index >= 0 && index < bodies.length
  const links: { other: number, joint: MMDBodyModelSource['joints'][number] }[][] = bodies.map(() => [])
  for (const joint of pmx.joints) {
    const a = joint.rigidbodyIndexA
    const b = joint.rigidbodyIndexB
    if (!valid(a) || !valid(b) || a === b)
      continue
    links[a].push({ other: b, joint })
    links[b].push({ other: a, joint })
  }
  const mobility = new Map<number, number>()
  const reached = new Float64Array(bodies.length)
  const queue: number[] = []
  bodies.forEach((body, start) => {
    if (body.physicsMode === PHYSICS_FOLLOW_BONE || body.boneIndex < 0 || body.boneIndex >= pmx.bones.length)
      return
    const [cx, cy, cz] = body.shapePosition
    reached.fill(Infinity)
    reached[start] = 0
    queue.length = 0
    queue.push(start)
    let least = Infinity
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head]
      const travelled = reached[current]
      if (travelled >= least)
        continue
      for (const { other, joint } of links[current]) {
        const lever = Math.hypot(joint.position[0] - cx, joint.position[1] - cy, joint.position[2] - cz)
        const next = travelled + limitNorm(joint.rotationMin, joint.rotationMax, Math.PI) * lever + limitNorm(joint.positionMin, joint.positionMax, Infinity)
        if (bodies[other].physicsMode === PHYSICS_FOLLOW_BONE) {
          least = Math.min(least, next)
        }
        else if (next < reached[other]) {
          reached[other] = next
          queue.push(other)
        }
      }
    }
    mobility.set(body.boneIndex, Math.min(mobility.get(body.boneIndex) ?? Infinity, least))
  })
  return mobility
}

/** The rigid bodies that follow an arm: the bone-following bodies on the upper-arm bones `arms` and on the bones under them. */
export function mmdArmBodies<Body extends Pick<PmxObject.RigidBody, 'boneIndex' | 'physicsMode'>>(bodies: readonly Body[], bones: readonly Pick<PmxObject.Bone, 'parentBoneIndex'>[], arms: readonly number[]): Body[] {
  const onArm = (boneIndex: number): boolean => {
    const visited = new Set<number>()
    for (let index = boneIndex; index >= 0 && index < bones.length && !visited.has(index); index = bones[index].parentBoneIndex) {
      visited.add(index)
      if (arms.includes(index))
        return true
    }
    return false
  }
  return bodies.filter(body => body.physicsMode === PHYSICS_FOLLOW_BONE && onArm(body.boneIndex))
}

/** Ammo collides a pair only when each body's mask holds the other's group. */
export function mmdBodiesCollide(a: Pick<PmxObject.RigidBody, 'collisionGroup' | 'collisionMask'>, b: Pick<PmxObject.RigidBody, 'collisionGroup' | 'collisionMask'>): boolean {
  return (a.collisionMask & (1 << b.collisionGroup)) !== 0 && (b.collisionMask & (1 << a.collisionGroup)) !== 0
}

/**
 * Reads the mesh, the rig profile and the PMX joints into the renderer-neutral source of the body model, or returns null
 * when the rig lacks a bone the model needs (hips, a spine, neck, head, or an arm with an elbow and a wrist).
 *
 * A deform bone that copies a leg bone's rotation in full through an append (grant) transform moves with that leg bone,
 * so the mesh skinned to `左足D` belongs to the thigh.
 *
 * What it reads from the author's physics rig, and nothing else: which bones are simulated (the bodies' physics modes);
 * each joint's limits and position and each simulated body's centre, which give the mobility of the simulated bones
 * (`mmdJointMobility`); and the bodies' collision groups and masks, which say which simulated bones the simulator
 * collides with a body that follows an arm. It reads no rigid body's shape, size or rotation.
 */
export function buildMMDBodyMeshSource(pmx: MMDBodyModelSource, mesh: Pick<MMDBodyModelMesh, 'geometry' | 'bindMatrix'>, rig: MMDRigProfile): BodyMeshSource | null {
  const indexByName = new Map<string, number>()
  pmx.bones.forEach((bone, index) => {
    if (!indexByName.has(bone.name))
      indexByName.set(bone.name, index)
  })
  const index = (name: string | null | undefined): number | null => (name ? indexByName.get(name) ?? null : null)
  const hips = index(rig.bones.hips)
  const neck = index(rig.bones.neck)
  const head = index(rig.bones.head)
  const spine = rig.spineChain.map(link => index(link.name))
  const arm = (side: Side) => {
    const upper = index(rig.bones[`${side}UpperArm`])
    const lower = index(rig.bones[`${side}LowerArm`])
    const hand = index(rig.bones[`${side}Hand`])
    return upper === null || lower === null || hand === null ? null : { clavicle: index(rig.bones[`${side}Shoulder`]), upper, lower, hand }
  }
  const leg = (side: Side) => {
    const upper = index(rig.bones[`${side}UpperLeg`])
    const lower = index(rig.bones[`${side}LowerLeg`])
    const foot = index(rig.bones[`${side}Foot`])
    return upper === null || lower === null || foot === null ? null : { upper, lower, foot }
  }
  const left = arm('left')
  const right = arm('right')
  if (hips === null || neck === null || head === null || !left || !right || spine.length < 1 || spine.length > 4 || spine.includes(null))
    return null
  const leftLeg = leg('left')
  const rightLeg = leg('right')

  const position = mesh.geometry.getAttribute('position')
  const skinIndex = mesh.geometry.getAttribute('skinIndex')
  const skinWeight = mesh.geometry.getAttribute('skinWeight')
  // A mesh without skinned vertices gives a model without volumes: the arms then clear the author's head and neck
  // bodies only.
  const count = position && skinIndex && skinWeight ? position.count : 0
  const positions = new Float32Array(count * 3)
  const skinIndices = new Uint32Array(count * 4)
  const skinWeights = new Float32Array(count * 4)
  const point = new Vector3()
  for (let vertex = 0; vertex < count; vertex++) {
    point.fromBufferAttribute(position, vertex).applyMatrix4(mesh.bindMatrix)
    positions[vertex * 3] = point.x
    positions[vertex * 3 + 1] = point.y
    positions[vertex * 3 + 2] = point.z
    for (let k = 0; k < 4; k++) {
      skinIndices[vertex * 4 + k] = skinIndex.getComponent(vertex, k)
      skinWeights[vertex * 4 + k] = skinWeight.getComponent(vertex, k)
    }
  }
  // A geometry without an index holds one triangle for every three vertices.
  const triangles = mesh.geometry.index?.array ?? Uint32Array.from({ length: count - count % 3 }, (_, corner) => corner)
  const mobility = mmdJointMobility(pmx)
  const armBodies = mmdArmBodies(pmx.rigidBodies, pmx.bones, [left.upper, right.upper])
  const collidesWithArm = new Set<number>()
  for (const body of pmx.rigidBodies) {
    if (body.physicsMode !== PHYSICS_FOLLOW_BONE && armBodies.some(arm => mmdBodiesCollide(body, arm)))
      collidesWithArm.add(body.boneIndex)
  }
  return {
    positions,
    skinIndices,
    skinWeights,
    triangles,
    bones: pmx.bones.map((bone) => {
      const append = bone.appendTransform
      const copies = append !== undefined && ((bone.flag ?? 0) & PmxObject.Bone.Flag.HasAppendRotate) !== 0 && append.ratio === 1
      return { parent: copies ? append.parentIndex : bone.parentBoneIndex, position: { x: bone.position[0], y: bone.position[1], z: bone.position[2] } }
    }),
    canonical: {
      hips,
      spine: spine.flatMap(bone => bone ?? []),
      neck,
      head,
      arms: { left, right },
      legs: leftLeg && rightLeg ? { left: leftLeg, right: rightLeg } : null,
    },
    simulated: [...mobility.entries()].sort((a, b) => a[0] - b[0]).map(([bone, value]) => ({ bone, mobility: value, collidesWithArm: collidesWithArm.has(bone) })),
  }
}

/** The body model of one MMD model with the mesh source it was built from and its volumes as posable colliders. */
export interface MMDBodyModel {
  readonly source: BodyMeshSource
  readonly model: BodyModel
  /**
   * The model's hard volumes in the form the rendered arm test and the collider overlay pose, one per volume and in
   * their order: each follows the PMX bone of its canonical bone, or its own leg bone, by a fixed offset.
   */
  readonly colliders: readonly MMDTouchCollider[]
}

/** The PMX bone a volume follows when posed: its canonical bone, or the leg bone a leg volume turns with. */
function volumeBone(volume: BodyCollider, canonical: BodyMeshSource['canonical']): number {
  if (volume.leg && canonical.legs)
    return canonical.legs[volume.leg.side][volume.leg.segment === 'thigh' ? 'upper' : 'lower']
  return canonicalBone(volume.bone, canonical)
}

function canonicalBone(bone: BodyBone, canonical: BodyMeshSource['canonical']): number {
  if (bone === 'hips' || bone === 'neck' || bone === 'head')
    return canonical[bone]
  return canonical.spine[Math.min(SPINE_BONES.indexOf(bone), canonical.spine.length - 1)]
}

/**
 * The volumes as touch-style colliders. MMD bind frames are world-aligned, so a volume's bind transform in mesh space is
 * its canonical bone's bind position plus its centre, with its rotation; the offset re-expresses that against the bone
 * it follows, as `buildMMDTouchColliders` does for a rigid body.
 */
function mmdBodyVolumeColliders(volumes: readonly BodyCollider[], source: BodyMeshSource, mesh: Pick<MMDBodyModelMesh, 'bindMatrix' | 'skeleton'>): MMDTouchCollider[] {
  const rotation = new Quaternion()
  // One collider a volume, so a scale per volume (`BodyCollision.fit`) finds its collider by index. A canonical bone is
  // a bone of the skeleton the source was read from, so it has a bind inverse.
  return volumes.map((volume, index) => {
    const boneIndex = volumeBone(volume, source.canonical)
    const anchor = source.bones[canonicalBone(volume.bone, source.canonical)].position
    rotation.setFromEuler(new Euler(volume.rotation.pitch, volume.rotation.yaw, volume.rotation.roll, 'YXZ'))
    const transform = new Matrix4().compose(new Vector3(anchor.x + volume.centre.x, anchor.y + volume.centre.y, anchor.z + volume.centre.z), rotation, new Vector3(1, 1, 1))
    return {
      name: `body-volume-${index}`,
      boneIndex,
      region: volume.bone === 'head' || volume.bone === 'neck' ? 'head' : 'body',
      shape: volume.shape,
      size: volume.shape === 'box' ? [volume.halfSize.x, volume.halfSize.y, volume.halfSize.z] : [volume.radius, volume.shape === 'capsule' ? volume.length : 0, 0],
      offset: new Matrix4().copy(mesh.skeleton.boneInverses[boneIndex]).multiply(mesh.bindMatrix).multiply(transform),
    }
  })
}

const models = new WeakMap<object, MMDBodyModel | null>()

/**
 * The body model of a loaded MMD model, built on the first call and kept for the model's life: the secondary-motion
 * setup before `mmd.setPhysics` and `MMDBody` read the same one. Null when the rig lacks a bone the model needs.
 */
export function readMMDBodyModel(mmd: { readonly pmx: MMDBodyModelSource, readonly mesh: MMDBodyModelMesh }, rig: MMDRigProfile): MMDBodyModel | null {
  const known = models.get(mmd)
  if (known !== undefined)
    return known
  const source = buildMMDBodyMeshSource(mmd.pmx, mmd.mesh, rig)
  const model = source ? buildBodyModel(source) : null
  const built = source && model ? { source, model, colliders: mmdBodyVolumeColliders(model.volumes, source, mmd.mesh) } : null
  models.set(mmd, built)
  return built
}
