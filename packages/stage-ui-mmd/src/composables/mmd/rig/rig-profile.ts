import type { PmxObject } from '@moeru/three-mmd'
import type { HumanoidBoneName, RigTraits } from '@proj-airi/motion-driver-humanoid/types'

import { EYE_PITCH_LIMIT, EYE_YAW_LIMIT } from '../gaze'
import { HUMANOID_BONE_CANDIDATES, MMD_CONTROL_BONE_CANDIDATES } from './bone-map'

/**
 * The PMX fields the rig profile reads. `mmd.pmx` satisfies it directly. Positions and IK
 * limits are post-parse values: three-mmd negates Z positions and X/Y rotations before it
 * builds the mesh, so knee limits read here have the opposite X sign from the PMX file.
 */
export interface MMDRigSource {
  bones: readonly Pick<PmxObject.Bone, 'name' | 'position' | 'parentBoneIndex' | 'ik'>[]
  rigidBodies: readonly Pick<PmxObject.RigidBody, 'name' | 'boneIndex' | 'physicsMode'>[]
}

export type MMDVec3 = [number, number, number]

/** Post-parse rotation limits of a knee IK link, in radians. */
export interface MMDKneeLimit {
  min: MMDVec3
  max: MMDVec3
}

export interface MMDLegIkChain {
  ikBone: string
  /** PMX bone index of the IK bone, which the IK solver uses to enable or disable the chain. */
  ikBoneIndex: number
  target: string
  knee: string | null
  upperLeg: string | null
  kneeLimit: MMDKneeLimit | null
}

/** Where eye gaze can be applied: separate 左目/右目 bones, the 両目 fallback, or nowhere. */
export type MMDEyeSource = 'eyes' | 'bothEyes' | 'none'

/**
 * Rig facts read once from a loaded PMX model. The profile is plain serializable data so
 * diagnostics can publish it.
 *
 * Pose stages must never write a bone listed in `physicsOwned`: those bones are driven by
 * mode 1 or 2 rigid bodies, and a pose write would fight the physics step. The humanoid
 * bone map already skips physics-owned candidates (`physicsOwnedHumanoid` lists the slots
 * skipped for that reason).
 */
export interface MMDRigProfile {
  bones: Partial<Record<HumanoidBoneName, string>>
  presentBones: HumanoidBoneName[]
  missingBones: HumanoidBoneName[]
  physicsOwnedHumanoid: HumanoidBoneName[]
  hipsTranslation: { center: string | null, groove: string | null }
  legIk: { left: MMDLegIkChain | null, right: MMDLegIkChain | null }
  toeIk: { left: string | null, right: string | null }
  kneeBendSign: 1 | -1
  /** `limit` when the sign came from a knee IK limit, `default` when no knee limit exists. */
  kneeBendSource: 'limit' | 'default'
  /** Mean hip-knee-ankle length over measurable legs in model units; null without legs. */
  legLength: number | null
  /** Mean ankle bind Y in model units; null without ankles. */
  footBaselineY: number | null
  /** Mean rest angle of the upper arms below horizontal, in radians; null without arms. */
  restArmAngle: number | null
  eyeSource: MMDEyeSource
  /** Bones bound by a mode 1 (physics) or mode 2 (physics with bone) rigid body, in PMX order. */
  physicsOwned: string[]
  /** The mode 2 subset of `physicsOwned`, such as Vivian's 左足2/左ひざ2 leg helpers. */
  physicsWithBoneOwned: string[]
  waistCancel: boolean
}

// PMX physicsMode 0 is FollowBone (kinematic); 1 is Physics and 2 is PhysicsWithBone.
// The enum is declared type-only in three-mmd, so the numeric values are compared here.
const PHYSICS_MODE_FOLLOW_BONE = 0
const PHYSICS_MODE_PHYSICS_WITH_BONE = 2

// Standard rigs bend the knee through positive post-parse X (limits +0.5..+180 deg).
const DEFAULT_KNEE_BEND_SIGN = 1

function mean(values: number[]): number | null {
  if (values.length === 0)
    return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function distance(a: MMDVec3, b: MMDVec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/** Reads the rig profile from post-parse PMX data, usually `mmd.pmx`. */
export function readMMDRigProfile(pmx: MMDRigSource): MMDRigProfile {
  const indexByName = new Map<string, number>()
  pmx.bones.forEach((bone, index) => {
    if (!indexByName.has(bone.name))
      indexByName.set(bone.name, index)
  })

  const physicsOwnedIndices = new Set<number>()
  const physicsWithBoneIndices = new Set<number>()
  for (const body of pmx.rigidBodies) {
    if (body.boneIndex < 0 || body.boneIndex >= pmx.bones.length || body.physicsMode === PHYSICS_MODE_FOLLOW_BONE)
      continue
    physicsOwnedIndices.add(body.boneIndex)
    if (body.physicsMode === PHYSICS_MODE_PHYSICS_WITH_BONE)
      physicsWithBoneIndices.add(body.boneIndex)
  }
  const namesInPmxOrder = (indices: Set<number>) =>
    [...indices].sort((a, b) => a - b).map(index => pmx.bones[index].name)

  const findName = (candidates: readonly string[]): string | null =>
    candidates.find(name => indexByName.has(name)) ?? null

  const bones: Partial<Record<HumanoidBoneName, string>> = {}
  const presentBones: HumanoidBoneName[] = []
  const missingBones: HumanoidBoneName[] = []
  const physicsOwnedHumanoid: HumanoidBoneName[] = []
  for (const [humanoid, candidates] of Object.entries(HUMANOID_BONE_CANDIDATES) as [HumanoidBoneName, readonly string[]][]) {
    const existing = candidates.filter(name => indexByName.has(name))
    const writable = existing.find(name => !physicsOwnedIndices.has(indexByName.get(name)!))
    if (writable) {
      bones[humanoid] = writable
      presentBones.push(humanoid)
      continue
    }
    missingBones.push(humanoid)
    if (existing.length > 0)
      physicsOwnedHumanoid.push(humanoid)
  }

  const positionOf = (humanoid: HumanoidBoneName): MMDVec3 | null => {
    const name = bones[humanoid]
    if (!name)
      return null
    const [x, y, z] = pmx.bones[indexByName.get(name)!].position
    return [x, y, z]
  }

  const readLegIk = (
    candidates: readonly string[],
    lowerLeg: HumanoidBoneName,
    upperLeg: HumanoidBoneName,
  ): MMDLegIkChain | null => {
    const ikBone = candidates.find(name => pmx.bones[indexByName.get(name) ?? -1]?.ik)
    if (!ikBone)
      return null
    const ikBoneIndex = indexByName.get(ikBone)!
    const ik = pmx.bones[ikBoneIndex].ik!
    const links = ik.links.map(link => ({ name: pmx.bones[link.target]?.name, limitation: link.limitation }))
    const kneeLink = links.find(link => link.name !== undefined && HUMANOID_BONE_CANDIDATES[lowerLeg].includes(link.name))
    const upperLink = links.find(link => link.name !== undefined && HUMANOID_BONE_CANDIDATES[upperLeg].includes(link.name))
    const limit = kneeLink?.limitation
    return {
      ikBone,
      ikBoneIndex,
      target: pmx.bones[ik.target]?.name ?? '',
      knee: kneeLink?.name ?? null,
      upperLeg: upperLink?.name ?? null,
      kneeLimit: limit
        ? { min: [...limit.minimumAngle], max: [...limit.maximumAngle] }
        : null,
    }
  }

  const findIkBone = (candidates: readonly string[]): string | null =>
    candidates.find(name => pmx.bones[indexByName.get(name) ?? -1]?.ik) ?? null

  const legIk = {
    left: readLegIk(MMD_CONTROL_BONE_CANDIDATES.leftLegIk, 'leftLowerLeg', 'leftUpperLeg'),
    right: readLegIk(MMD_CONTROL_BONE_CANDIDATES.rightLegIk, 'rightLowerLeg', 'rightUpperLeg'),
  }

  // The bend sign is the side of zero the knee's X limit range lies on. The left chain wins;
  // the right chain is read only when the left one has no usable knee limit.
  let kneeBendSign: 1 | -1 = DEFAULT_KNEE_BEND_SIGN
  let kneeBendSource: MMDRigProfile['kneeBendSource'] = 'default'
  for (const chain of [legIk.left, legIk.right]) {
    if (!chain?.kneeLimit)
      continue
    const midX = (chain.kneeLimit.min[0] + chain.kneeLimit.max[0]) / 2
    if (midX === 0)
      continue
    kneeBendSign = midX > 0 ? 1 : -1
    kneeBendSource = 'limit'
    break
  }

  const legLengths: number[] = []
  const ankleHeights: number[] = []
  const armAngles: number[] = []
  for (const side of ['left', 'right'] as const) {
    const hip = positionOf(`${side}UpperLeg`)
    const knee = positionOf(`${side}LowerLeg`)
    const ankle = positionOf(`${side}Foot`)
    if (hip && knee && ankle)
      legLengths.push(distance(hip, knee) + distance(knee, ankle))
    if (ankle)
      ankleHeights.push(ankle[1])

    const shoulder = positionOf(`${side}UpperArm`)
    const elbow = positionOf(`${side}LowerArm`)
    if (shoulder && elbow)
      armAngles.push(Math.atan2(shoulder[1] - elbow[1], Math.hypot(elbow[0] - shoulder[0], elbow[2] - shoulder[2])))
  }

  let eyeSource: MMDEyeSource = 'none'
  if (bones.leftEye || bones.rightEye)
    eyeSource = 'eyes'
  else if (findName(MMD_CONTROL_BONE_CANDIDATES.bothEyes))
    eyeSource = 'bothEyes'

  return {
    bones,
    presentBones,
    missingBones,
    physicsOwnedHumanoid,
    hipsTranslation: {
      center: findName(MMD_CONTROL_BONE_CANDIDATES.center),
      groove: findName(MMD_CONTROL_BONE_CANDIDATES.groove),
    },
    legIk,
    toeIk: {
      left: findIkBone(MMD_CONTROL_BONE_CANDIDATES.leftToeIk),
      right: findIkBone(MMD_CONTROL_BONE_CANDIDATES.rightToeIk),
    },
    kneeBendSign,
    kneeBendSource,
    legLength: mean(legLengths),
    footBaselineY: mean(ankleHeights),
    restArmAngle: mean(armAngles),
    eyeSource,
    physicsOwned: namesInPmxOrder(physicsOwnedIndices),
    physicsWithBoneOwned: namesInPmxOrder(physicsWithBoneIndices),
    waistCancel: findName(MMD_CONTROL_BONE_CANDIDATES.leftWaistCancel) !== null
      && findName(MMD_CONTROL_BONE_CANDIDATES.rightWaistCancel) !== null,
  }
}

/**
 * Converts a rig profile to the renderer-neutral humanoid traits. A rig without legs reports
 * `legLength` 0 and `footBaselineY` 0 (the MMD ground plane); consumers skip foot contact
 * when the profile has no leg IK. A rig without eye bones reports zero eye limits.
 */
export function toRigTraits(profile: MMDRigProfile): RigTraits {
  const hasEyes = profile.eyeSource !== 'none'
  return {
    legLength: profile.legLength ?? 0,
    footBaselineY: profile.footBaselineY ?? 0,
    kneeBendSign: profile.kneeBendSign,
    eyeYawLimit: hasEyes ? EYE_YAW_LIMIT : 0,
    eyePitchLimit: hasEyes ? EYE_PITCH_LIMIT : 0,
    presentBones: [...profile.presentBones],
  }
}
