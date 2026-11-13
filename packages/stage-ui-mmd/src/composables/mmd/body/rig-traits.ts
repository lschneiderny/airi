import type { BodyArmTraits, BodyBone, BodyCollider, BodyLegFollow, BodyLegJoints, BodyRigTraits } from '@proj-airi/motion-driver-humanoid/performance'
import type { HumanoidBoneName, HumanoidFingerBoneName, Vec3 } from '@proj-airi/motion-driver-humanoid/types'

import type { MMDRigProfile, MMDRigSource } from '../rig'
import type { MMDTouchCollider } from '../touch/colliders'

import { PmxObject } from '@moeru/three-mmd'
import { Euler, Matrix4, Quaternion, Vector3 } from 'three'

import { toRigTraits } from '../rig'

type Side = 'left' | 'right'

/** The PMX bone fields the traits read: the rig source's, plus the append (grant) data that ties a D-bone to its leg bone. */
type BodyRigBones = Pick<MMDRigSource, 'bones'> & {
  readonly bones: readonly Partial<Pick<PmxObject.Bone, 'appendTransform' | 'flag'>>[]
}

const spineBones = ['spine0', 'spine1', 'spine2', 'spine3'] as const
const fingerJoints = {
  Thumb: ['Metacarpal', 'Proximal', 'Distal'],
  Index: ['Proximal', 'Intermediate', 'Distal'],
  Middle: ['Proximal', 'Intermediate', 'Distal'],
  Ring: ['Proximal', 'Intermediate', 'Distal'],
  Little: ['Proximal', 'Intermediate', 'Distal'],
} as const

/** The skeleton bind data a collider's bone offset was built from (`mesh.skeleton.boneInverses`, `mesh.bindMatrix`). */
export interface MMDBodyBind {
  readonly boneInverses: readonly Matrix4[]
  readonly bindMatrix: Matrix4
}

interface CanonicalAnchor {
  readonly bone: BodyBone
  readonly at: Vec3
}

const vec = ([x, y, z]: readonly [number, number, number]): Vec3 => ({ x, y, z })
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })

/**
 * Copies the rig's immutable geometry into the performer's renderer-neutral traits, or returns null when the rig lacks
 * a bone the performer needs (hips, a spine, neck, head, both arms with elbows and wrists, or a measurable leg).
 *
 * Positions are post-parse PMX bind positions, which are already mesh-local with +X the character's left, +Y up and +Z
 * forward. MMD bind frames are world-aligned, so a collider's canonical frame is its ancestor's bind pivot with mesh axes.
 * `colliders` are the kinematic bodies the arms must clear: the arm-test torso bodies plus the head and neck bodies.
 */
export function buildBodyRigTraits(
  pmx: BodyRigBones,
  rig: MMDRigProfile,
  colliders: readonly MMDTouchCollider[],
  bind: MMDBodyBind,
): BodyRigTraits | null {
  const indexByName = new Map<string, number>()
  pmx.bones.forEach((bone, index) => {
    if (!indexByName.has(bone.name))
      indexByName.set(bone.name, index)
  })
  const position = (name: string | null | undefined): Vec3 | null => {
    const index = name ? indexByName.get(name) : undefined
    return index === undefined ? null : vec(pmx.bones[index].position)
  }
  const bone = (humanoid: HumanoidBoneName) => position(rig.bones[humanoid])
  const hips = bone('hips')
  const neck = bone('neck')
  const head = bone('head')
  const legLength = rig.legLength
  if (!hips || !neck || !head || legLength === null || !(legLength > 0) || rig.spineChain.length < 1 || rig.spineChain.length > 4)
    return null
  const spineChain = rig.spineChain.map(link => vec(link.position))
  const arm = (side: Side): BodyArmTraits | null => {
    const shoulder = bone(`${side}UpperArm`)
    const elbow = bone(`${side}LowerArm`)
    const wrist = bone(`${side}Hand`)
    if (!shoulder || !elbow || !wrist)
      return null
    const forearm = sub(wrist, elbow)
    const fingerNames = Object.entries(fingerJoints).flatMap(([finger, joints]) => joints.map(joint => `${side}${finger}${joint}` as HumanoidFingerBoneName))
    const present = fingerNames.filter(name => rig.fingerBones[name] !== undefined)
    // The farthest present finger joint from the wrist; without fingers, the gate's hand reach of 0.65 forearm lengths.
    const reach = present.reduce((longest, name) => {
      const at = position(rig.fingerBones[name])
      return at ? Math.max(longest, Math.hypot(at.x - wrist.x, at.y - wrist.y, at.z - wrist.z)) : longest
    }, 0)
    return {
      shoulder,
      clavicle: bone(`${side}Shoulder`),
      upperArm: sub(elbow, shoulder),
      forearm,
      handLength: reach > 0 ? reach : 0.65 * Math.hypot(forearm.x, forearm.y, forearm.z),
      fingers: present.length === fingerNames.length ? 'full' : present.length > 0 ? 'partial' : 'none',
      twist: rig.twist[side].arm !== null && rig.twist[side].wrist !== null,
    }
  }
  const left = arm('left')
  const right = arm('right')
  if (!left || !right)
    return null
  const legIk = rig.legIk.left !== null && rig.legIk.right !== null
  // The leg IK chains' joints, and which leg segment each chain bone carries: the knee and ankle ride on the shin.
  const legBones = new Map<number, BodyLegFollow>()
  const legJoints = (side: Side): BodyLegJoints | null => {
    const chain = rig.legIk[side]
    const hip = position(chain?.upperLeg)
    const knee = position(chain?.knee)
    const ankle = position(chain?.target)
    if (!chain || !hip || !knee || !ankle)
      return null
    for (const [name, segment] of [[chain.upperLeg, 'thigh'], [chain.knee, 'shin'], [chain.target, 'shin']] as const) {
      const index = name ? indexByName.get(name) : undefined
      if (index !== undefined)
        legBones.set(index, { side, segment })
    }
    return { hip, knee, ankle }
  }
  const leftLeg = legJoints('left')
  const rightLeg = legJoints('right')
  const legs = leftLeg && rightLeg ? { left: leftLeg, right: rightLeg } : null
  const foot = (side: Side) => {
    const ankle = bone(`${side}Foot`)
    return {
      ankle: ankle ?? { x: 0, y: rig.footBaselineY ?? 0, z: 0 },
      toe: bone(`${side}Toes`),
      // NOTICE:
      // PMX skeletons carry no heel point, so the heel distance is 0.
      // Root cause: only the later foot-roll layer reads it.
      // Source: unit D contract, `traits.feet[side].heelBack`.
      // Removal condition: foot roll derives the heel from the foot mesh.
      heelBack: 0,
      toeBend: rig.toeBend[side] !== null,
      toeIk: rig.toeIk[side] !== null,
    }
  }
  const neutral = toRigTraits(rig)
  const spineParentIndex = pmx.bones[indexByName.get(rig.spineChain[0].name) ?? -1]?.parentBoneIndex
  const hipsAnchor = { bone: 'hips' as const, at: hips }
  const anchors = new Map<string, CanonicalAnchor>()
  for (const [name, anchor] of [[rig.bones.hips, hipsAnchor], [rig.bones.neck, { bone: 'neck', at: neck }], [rig.bones.head, { bone: 'head', at: head }]] as const) {
    if (name)
      anchors.set(name, anchor)
  }
  rig.spineChain.forEach((link, index) => anchors.set(link.name, { bone: spineBones[index], at: spineChain[index] }))
  return {
    legLength,
    hips,
    spineChain,
    spineParent: spineParentIndex !== undefined && pmx.bones[spineParentIndex]?.name === rig.bones.hips ? 'hips' : 'root',
    neck,
    head,
    arms: { left, right },
    feet: { left: foot('left'), right: foot('right') },
    legIk,
    legs,
    eyeYawLimit: neutral.eyeYawLimit,
    eyePitchLimit: neutral.eyePitchLimit,
    colliders: colliders.map(collider => toBodyCollider(collider, pmx, { anchors, fallback: hipsAnchor, legBones: legs ? legBones : new Map() }, bind)),
  }
}

/**
 * The leg segment a bone moves with: its own, or, for a deform (D) bone, the one of the leg bone whose rotation it copies
 * in full through an append (grant) transform.
 */
function legSegmentOf(index: number, pmx: BodyRigBones, legBones: ReadonlyMap<number, BodyLegFollow>): BodyLegFollow | undefined {
  const own = legBones.get(index)
  if (own)
    return own
  const bone = pmx.bones[index]
  const append = bone.appendTransform
  const copiesRotation = ((bone.flag ?? 0) & PmxObject.Bone.Flag.HasAppendRotate) !== 0
  return append && copiesRotation && append.ratio === 1 ? legBones.get(append.parentIndex) : undefined
}

/**
 * The collider's bind transform in mesh space is `bindMatrix^-1 * boneInverse^-1 * offset`; it is re-expressed against
 * the nearest canonical ancestor. A body under no canonical bone (the centre or groove) rides on the hips frame, the
 * closest frame that follows the pelvis.
 */
function toBodyCollider(
  collider: MMDTouchCollider,
  pmx: BodyRigBones,
  frames: { anchors: ReadonlyMap<string, CanonicalAnchor>, fallback: CanonicalAnchor, legBones: ReadonlyMap<number, BodyLegFollow> },
  bind: MMDBodyBind,
): BodyCollider {
  let ancestor = frames.fallback
  let leg: BodyLegFollow | undefined
  const visited = new Set<number>()
  for (let index = collider.boneIndex; index >= 0 && index < pmx.bones.length && !visited.has(index); index = pmx.bones[index].parentBoneIndex) {
    visited.add(index)
    leg ??= legSegmentOf(index, pmx, frames.legBones)
    const found = frames.anchors.get(pmx.bones[index].name)
    if (found) {
      ancestor = found
      break
    }
  }
  const transform = new Matrix4().copy(bind.bindMatrix).invert().multiply(new Matrix4().copy(bind.boneInverses[collider.boneIndex]).invert()).multiply(collider.offset)
  const centre = new Vector3()
  const rotation = new Quaternion()
  transform.decompose(centre, rotation, new Vector3())
  const euler = new Euler().setFromQuaternion(rotation, 'YXZ')
  // A leg body keeps the hips as its anchor, where it sits at bind; the corrector turns it with its leg while she walks.
  const base = {
    bone: ancestor.bone,
    centre: { x: centre.x - ancestor.at.x, y: centre.y - ancestor.at.y, z: centre.z - ancestor.at.z },
    rotation: { yaw: euler.y, pitch: euler.x, roll: euler.z },
    ...leg && ancestor.bone === 'hips' ? { leg } : {},
  }
  const [x, y, z] = collider.size
  switch (collider.shape) {
    case 'sphere':
      return { ...base, shape: 'sphere', radius: x }
    case 'capsule':
      return { ...base, shape: 'capsule', radius: x, length: y }
    case 'box':
      return { ...base, shape: 'box', halfSize: { x, y, z } }
  }
}
