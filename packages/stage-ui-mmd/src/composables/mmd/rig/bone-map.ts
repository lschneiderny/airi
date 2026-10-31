import type { HumanoidBoneName } from '@proj-airi/motion-driver-humanoid/types'

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
