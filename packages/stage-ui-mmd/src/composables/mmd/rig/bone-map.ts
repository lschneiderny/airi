import type { HumanoidBoneName, HumanoidFingerBoneName } from '@proj-airi/motion-driver-humanoid/types'

/**
 * Ordered MMD bone-name candidates for each canonical humanoid bone. The rig profile maps
 * a humanoid bone to the first candidate that exists and is not physics-owned. Key order
 * follows `HumanoidBoneName`, so profile bone lists keep that order.
 *
 * `hips` is the 下半身 rotation bone only; hips translation is driven through the
 * センター and グルーブ control bones (see {@link MMD_CONTROL_BONE_CANDIDATES}).
 */
export const HUMANOID_BONE_CANDIDATES: Readonly<Record<HumanoidBoneName, readonly string[]>> = {
  hips: ['下半身'],
  spine: ['上半身'],
  chest: ['上半身2'],
  upperChest: ['上半身3'],
  neck: ['首'],
  head: ['頭', 'head', 'Head'],
  leftEye: ['左目', 'eye_L', 'EyeLeft', 'LeftEye'],
  rightEye: ['右目', 'eye_R', 'EyeRight', 'RightEye'],
  leftUpperLeg: ['左足'],
  leftLowerLeg: ['左ひざ'],
  leftFoot: ['左足首'],
  leftToes: ['左つま先'],
  rightUpperLeg: ['右足'],
  rightLowerLeg: ['右ひざ'],
  rightFoot: ['右足首'],
  rightToes: ['右つま先'],
  leftShoulder: ['左肩'],
  leftUpperArm: ['左腕'],
  leftLowerArm: ['左ひじ'],
  leftHand: ['左手首'],
  rightShoulder: ['右肩'],
  rightUpperArm: ['右腕'],
  rightLowerArm: ['右ひじ'],
  rightHand: ['右手首'],
}

const FINGER_STEMS = { Thumb: '親指', Index: '人指', Middle: '中指', Ring: '薬指', Little: '小指' } as const

// Thumbs: 親指０/１/２ are Metacarpal/Proximal/Distal. Other fingers: １/２/３ are Proximal/Intermediate/Distal, and a
// leading ０ (such as Carlotta's 人指０) is their metacarpal when the model has one.
const FINGER_JOINT_DIGITS = {
  Thumb: { Metacarpal: '０', Proximal: '１', Intermediate: null, Distal: '２' },
  other: { Metacarpal: '０', Proximal: '１', Intermediate: '２', Distal: '３' },
} as const

function fingerCandidates(): Record<HumanoidFingerBoneName, readonly string[]> {
  const candidates: Partial<Record<HumanoidFingerBoneName, readonly string[]>> = {}
  for (const [side, prefix] of [['left', '左'], ['right', '右']] as const) {
    for (const [kind, stem] of Object.entries(FINGER_STEMS) as [keyof typeof FINGER_STEMS, string][]) {
      const digits = FINGER_JOINT_DIGITS[kind === 'Thumb' ? 'Thumb' : 'other']
      for (const joint of ['Metacarpal', 'Proximal', 'Intermediate', 'Distal'] as const) {
        const digit = digits[joint]
        if (digit !== null)
          candidates[`${side}${kind}${joint}`] = [`${prefix}${stem}${digit}`]
      }
    }
  }
  return candidates as Record<HumanoidFingerBoneName, readonly string[]>
}

/**
 * Ordered MMD bone-name candidates for each finger bone. A finger bone the model lacks is simply absent: thumbs have no
 * intermediate joint, and most models have no metacarpal on the other four fingers.
 */
export const HUMANOID_FINGER_CANDIDATES: Readonly<Partial<Record<HumanoidFingerBoneName, readonly string[]>>> = fingerCandidates()

/**
 * Twist and shoulder-helper bones that move with an arm. They are used only to group clip tracks into the arm mask,
 * never to pose.
 */
export const MMD_ARM_HELPER_CANDIDATES = {
  left: ['左腕捩', '左手捩', '左肩P', '左肩C'],
  right: ['右腕捩', '右手捩', '右肩P', '右肩C'],
} as const satisfies Record<'left' | 'right', readonly string[]>

/** Toe deform controls, distinct from the つま先 position/IK target bones. */
export const MMD_TOE_BEND_CANDIDATES = {
  left: ['左足先EX'],
  right: ['右足先EX'],
} as const satisfies Record<'left' | 'right', readonly string[]>

/** Main twist controls only; numbered grant helpers remain in the skeleton. */
export const MMD_TWIST_BONE_CANDIDATES = {
  left: { arm: ['左腕捩'], wrist: ['左手捩'] },
  right: { arm: ['右腕捩'], wrist: ['右手捩'] },
} as const

/**
 * FK leg bones, including the D (deform) variants some models animate instead. They are used only to group clip tracks
 * into the lower-body mask, never to pose.
 */
export const MMD_LOWER_BODY_CANDIDATES = [
  '下半身',
  '左足',
  '右足',
  '左ひざ',
  '右ひざ',
  '左足首',
  '右足首',
  '左足D',
  '右足D',
  '左ひざD',
  '右ひざD',
  '左足首D',
  '右足首D',
] as const satisfies readonly string[]

/**
 * MMD control bones without a humanoid counterpart. IK names list the full-width ＩＫ
 * spelling first and the half-width IK spelling some exporters write as a fallback.
 * 両目 is the both-eyes fallback used only when a model lacks separate eye bones.
 */
export const MMD_CONTROL_BONE_CANDIDATES = {
  center: ['センター'],
  groove: ['グルーブ'],
  bothEyes: ['両目', 'Eyes'],
  leftLegIk: ['左足ＩＫ', '左足IK'],
  rightLegIk: ['右足ＩＫ', '右足IK'],
  leftToeIk: ['左つま先ＩＫ', '左つま先IK'],
  rightToeIk: ['右つま先ＩＫ', '右つま先IK'],
  leftWaistCancel: ['腰キャンセル左'],
  rightWaistCancel: ['腰キャンセル右'],
} as const satisfies Record<string, readonly string[]>
