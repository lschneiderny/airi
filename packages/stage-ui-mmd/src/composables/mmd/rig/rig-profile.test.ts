import type { HumanoidBoneName } from '@proj-airi/motion-driver-humanoid/types'

import type { RigFixture } from './rig-profile.fixtures'

import { describe, expect, it } from 'vitest'

import { EYE_PITCH_LIMIT, EYE_YAW_LIMIT } from '../gaze'
import { HUMANOID_BONE_CANDIDATES } from './bone-map'
import { readMMDRigProfile, toRigTraits } from './rig-profile'
import { carlottaRig, ellenRig, toPmxRigSource, vivianRig } from './rig-profile.fixtures'

const ALL_HUMANOID_BONES = Object.keys(HUMANOID_BONE_CANDIDATES) as HumanoidBoneName[]
const ALL_BUT_UPPER_CHEST = ALL_HUMANOID_BONES.filter(bone => bone !== 'upperChest')

function profileOf(fixture: RigFixture) {
  return readMMDRigProfile(toPmxRigSource(fixture))
}

function withoutBone(fixture: RigFixture, name: string): RigFixture {
  const removed = fixture.bones.find(bone => bone.name === name)
  if (!removed)
    throw new Error(`fixture has no bone ${name}`)
  return {
    // Children of the removed bone re-parent to its parent, as an editor deleting the bone would.
    bones: fixture.bones
      .filter(bone => bone.name !== name)
      .map(bone => bone.parent === name ? { ...bone, parent: removed.parent } : bone),
    rigidBodies: fixture.rigidBodies.filter(body => body.bone !== name),
  }
}

describe('readMMDRigProfile on audited models', () => {
  it('maps every core humanoid bone on Ellen and reports her missing waist cancel', () => {
    const profile = profileOf(ellenRig)

    expect(profile.presentBones).toEqual(ALL_BUT_UPPER_CHEST)
    expect(profile.presentBones).toHaveLength(23)
    expect(profile.missingBones).toEqual(['upperChest'])
    expect(profile.bones.hips).toBe('下半身')
    expect(profile.bones.chest).toBe('上半身2')
    expect(profile.bones.leftFoot).toBe('左足首')
    expect(profile.hipsTranslation).toEqual({ center: 'センター', groove: 'グルーブ' })
    expect(profile.waistCancel).toBe(false)
    expect(profile.eyeSource).toBe('eyes')
  })

  it('reports waist cancel present on Vivian and Carlotta', () => {
    expect(profileOf(vivianRig).waistCancel).toBe(true)
    expect(profileOf(carlottaRig).waistCancel).toBe(true)
  })

  it('maps 上半身3 to upperChest on Carlotta so all 24 humanoid bones are present', () => {
    const profile = profileOf(carlottaRig)

    expect(profile.presentBones).toEqual(ALL_HUMANOID_BONES)
    expect(profile.presentBones).toHaveLength(24)
    expect(profile.missingBones).toEqual([])
    expect(profile.bones.upperChest).toBe('上半身3')
  })

  it('reads both leg IK chains with their knee links and post-parse limits', () => {
    const profile = profileOf(ellenRig)

    expect(profile.legIk.left).toEqual({
      ikBone: '左足ＩＫ',
      ikBoneIndex: ellenRig.bones.findIndex(bone => bone.name === '左足ＩＫ'),
      target: '左足首',
      knee: '左ひざ',
      upperLeg: '左足',
      kneeLimit: { min: [0.008727, 0, 0], max: [3.141593, 0, 0] },
    })
    expect(profile.legIk.right?.ikBone).toBe('右足ＩＫ')
    expect(profile.legIk.right?.knee).toBe('右ひざ')
    expect(profile.toeIk).toEqual({ left: '左つま先ＩＫ', right: '右つま先ＩＫ' })
  })

  it('lists the physics-owned bones and the mode-2 subset exactly, including Vivian leg helpers', () => {
    const profile = profileOf(vivianRig)

    expect(profile.physicsOwned).toEqual([
      'Ctr_F_HairA_02',
      'Ctr_F_HairA_04',
      '左胸上',
      '左胸上2',
      '左足2',
      '左ひざ2',
      '右足2',
      '右ひざ2',
    ])
    expect(profile.physicsWithBoneOwned).toEqual([
      'Ctr_F_HairA_02',
      'Ctr_F_HairA_04',
      '左足2',
      '左ひざ2',
      '右足2',
      '右ひざ2',
    ])

    const chainBones = [profile.legIk.left, profile.legIk.right].flatMap(chain =>
      chain ? [chain.ikBone, chain.target, chain.knee, chain.upperLeg] : [],
    )
    for (const helper of ['左足2', '右足2', '左ひざ2', '右ひざ2'])
      expect(chainBones).not.toContain(helper)
  })

  it('counts physics ownership on Ellen and Carlotta from mode 1 and 2 bodies only', () => {
    expect(profileOf(ellenRig).physicsOwned).toEqual(['Ctr_R_HairB_01', 'Ctr_R_HairB_02', '左胸上', '左胸上2'])
    expect(profileOf(ellenRig).physicsWithBoneOwned).toEqual(['Ctr_R_HairB_01', 'Ctr_R_HairB_02'])
    expect(profileOf(carlottaRig).physicsOwned).toEqual(['Bone_Hair001_L', 'Bone_Hair002_L', '左侧发1', '左侧发2'])
    expect(profileOf(carlottaRig).physicsWithBoneOwned).toEqual(['Bone_Hair001_L', 'Bone_Hair002_L'])
  })

  it('never maps a humanoid bone to a physics-owned bone on any audited model', () => {
    for (const fixture of [ellenRig, vivianRig, carlottaRig]) {
      const profile = profileOf(fixture)
      expect(profile.physicsOwnedHumanoid).toEqual([])
      for (const name of Object.values(profile.bones))
        expect(profile.physicsOwned).not.toContain(name)
    }
  })

  it('derives a positive knee bend sign from the post-parse knee limits of every audited model', () => {
    // The plan expected Carlotta to carry the opposite knee limit sign. The regenerated
    // audit shows raw knee X -180..-0.5 deg (post-parse +0.5..+180) on all five audited models,
    // Carlotta included, so the fixtures follow the data and the negative branch is covered by
    // the synthetic fixture below.
    for (const fixture of [ellenRig, vivianRig, carlottaRig]) {
      const profile = profileOf(fixture)
      expect(profile.kneeBendSign).toBe(1)
      expect(profile.kneeBendSource).toBe('limit')
    }
  })

  it('measures leg length, foot baseline and rest arm angle from bind positions', () => {
    const ellen = profileOf(ellenRig)
    expect(ellen.legLength).toBeCloseTo(9.356433, 5)
    expect(ellen.footBaselineY).toBeCloseTo(1.117993, 6)
    expect(ellen.restArmAngle).toBeCloseTo(0.690537, 5)

    const vivian = profileOf(vivianRig)
    expect(vivian.legLength).toBeCloseTo(9.455684, 5)
    expect(vivian.footBaselineY).toBeCloseTo(2.119492, 6)

    const carlotta = profileOf(carlottaRig)
    expect(carlotta.legLength).toBeCloseTo(9.949700, 5)
    expect(carlotta.footBaselineY).toBeCloseTo(1.398647, 6)
    expect(carlotta.restArmAngle).toBeCloseTo(0.612105, 5)
  })
})

describe('readMMDRigProfile on synthetic and malformed rigs', () => {
  it('derives a negative knee bend sign from a synthetic rig with opposite knee limits', () => {
    // Synthetic: Ellen's skeleton with the knee X limits mirrored to the negative range.
    const syntheticNegativeKneeRig: RigFixture = {
      ...ellenRig,
      bones: ellenRig.bones.map(bone => bone.ik
        ? {
            ...bone,
            ik: {
              ...bone.ik,
              links: bone.ik.links.map(link => link.min && link.max
                ? { bone: link.bone, min: [-link.max[0], link.min[1], link.min[2]], max: [-link.min[0], link.max[1], link.max[2]] }
                : link),
            },
          }
        : bone),
    }
    const profile = profileOf(syntheticNegativeKneeRig)

    expect(profile.legIk.left?.kneeLimit).toEqual({ min: [-3.141593, 0, 0], max: [-0.008727, 0, 0] })
    expect(profile.kneeBendSign).toBe(-1)
    expect(profile.kneeBendSource).toBe('limit')
  })

  it('reports legIk.left as null when 左足ＩＫ is missing and keeps the right chain', () => {
    const profile = profileOf(withoutBone(ellenRig, '左足ＩＫ'))

    expect(profile.legIk.left).toBeNull()
    expect(profile.legIk.right?.ikBone).toBe('右足ＩＫ')
    expect(profile.kneeBendSign).toBe(1)
    expect(profile.kneeBendSource).toBe('limit')
  })

  it('accepts the half-width 左足IK spelling as a leg IK fallback', () => {
    const fixture: RigFixture = {
      ...ellenRig,
      bones: ellenRig.bones.map(bone => ({
        ...bone,
        name: bone.name === '左足ＩＫ' ? '左足IK' : bone.name,
        parent: bone.parent === '左足ＩＫ' ? '左足IK' : bone.parent,
      })),
    }

    expect(profileOf(fixture).legIk.left?.ikBone).toBe('左足IK')
  })

  it('falls back to the default knee sign when neither leg has IK', () => {
    const profile = profileOf(withoutBone(withoutBone(ellenRig, '左足ＩＫ'), '右足ＩＫ'))

    expect(profile.legIk).toEqual({ left: null, right: null })
    expect(profile.kneeBendSign).toBe(1)
    expect(profile.kneeBendSource).toBe('default')
  })

  it('reports no physics ownership for a rig without rigid bodies', () => {
    const profile = profileOf({ ...vivianRig, rigidBodies: [] })

    expect(profile.physicsOwned).toEqual([])
    expect(profile.physicsWithBoneOwned).toEqual([])
    expect(profile.presentBones).toEqual(ALL_BUT_UPPER_CHEST)
  })

  it('reports missing bones and unmeasured lengths for a skeleton with only a head', () => {
    const profile = profileOf({
      bones: [
        { name: '全ての親', parent: null, position: [0, 0, 0] },
        { name: '頭', parent: '全ての親', position: [0, 16, 0] },
      ],
      rigidBodies: [],
    })

    expect(profile.presentBones).toEqual(['head'])
    expect(profile.missingBones).toEqual(ALL_HUMANOID_BONES.filter(bone => bone !== 'head'))
    expect(profile.legIk).toEqual({ left: null, right: null })
    expect(profile.toeIk).toEqual({ left: null, right: null })
    expect(profile.hipsTranslation).toEqual({ center: null, groove: null })
    expect(profile.legLength).toBeNull()
    expect(profile.footBaselineY).toBeNull()
    expect(profile.restArmAngle).toBeNull()
    expect(profile.eyeSource).toBe('none')
    expect(profile.waistCancel).toBe(false)
  })

  it('falls back to the 両目 bone when separate eye bones are missing', () => {
    const profile = profileOf(withoutBone(withoutBone(ellenRig, '左目'), '右目'))

    expect(profile.eyeSource).toBe('bothEyes')
    expect(profile.bones.leftEye).toBeUndefined()
    expect(profile.missingBones).toEqual(['upperChest', 'leftEye', 'rightEye'])
  })

  it('skips a physics-owned candidate instead of mapping a pose bone onto it', () => {
    const profile = profileOf({
      ...ellenRig,
      rigidBodies: [...ellenRig.rigidBodies, { name: 'synthetic chest', bone: '上半身2', physicsMode: 1 }],
    })

    expect(profile.bones.chest).toBeUndefined()
    expect(profile.physicsOwnedHumanoid).toEqual(['chest'])
    expect(profile.missingBones).toEqual(['chest', 'upperChest'])
  })
})

describe('toRigTraits', () => {
  it('converts an audited profile to humanoid rig traits', () => {
    const profile = profileOf(ellenRig)

    expect(toRigTraits(profile)).toEqual({
      legLength: profile.legLength,
      footBaselineY: profile.footBaselineY,
      kneeBendSign: 1,
      eyeYawLimit: EYE_YAW_LIMIT,
      eyePitchLimit: EYE_PITCH_LIMIT,
      presentBones: ALL_BUT_UPPER_CHEST,
    })
  })

  it('uses zero measurements and eye limits when the rig cannot provide them', () => {
    const traits = toRigTraits(profileOf({
      bones: [{ name: '頭', parent: null, position: [0, 16, 0] }],
      rigidBodies: [],
    }))

    expect(traits).toEqual({
      legLength: 0,
      footBaselineY: 0,
      kneeBendSign: 1,
      eyeYawLimit: 0,
      eyePitchLimit: 0,
      presentBones: ['head'],
    })
  })
})
