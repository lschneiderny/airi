import type { HumanoidBoneName, HumanoidFingerBoneName } from '../types'

const degreesPerRadian = 180 / Math.PI
const rotationThresholdDegrees = 0.5
const positionThreshold = 0.01

export type ClipMaskGroup = 'root' | 'leftLegIk' | 'rightLegIk' | 'leftArm' | 'rightArm' | 'leftFingers' | 'rightFingers' | 'upperBody' | 'head'

/** One animated track of a clip, reduced to its bone name and flattened key values. */
export interface ClipTrackSummary {
  readonly boneName: string
  readonly property: 'quaternion' | 'position'
  /** Quaternion keys are `x, y, z, w` quadruples; position keys are `x, y, z` triples. */
  readonly values: ArrayLike<number>
}

export interface ClipBoneMask {
  /** Rig bone names with a non-rest key. */
  readonly animatedBones: readonly string[]
  readonly groups: Readonly<Record<ClipMaskGroup, boolean>>
}

/** Canonical bone to rig bone name map, plus extra rig bones (MMD twist and shoulder-P bones) per group. */
export type ClipMaskBones = Readonly<Partial<Record<HumanoidBoneName | HumanoidFingerBoneName, string>>> & {
  readonly helpers?: Readonly<Partial<Record<'leftArm' | 'rightArm' | 'leftFingers' | 'rightFingers', readonly string[]>>>
}

const rootNames = new Set(['センター', 'グルーブ', 'center', 'groove'])
const legIkPattern = /^([左右])(?:足|つま先)ik親?$/
const armBones = ['Shoulder', 'UpperArm', 'LowerArm', 'Hand'] as const
const fingerKinds = ['Thumb', 'Index', 'Middle', 'Ring', 'Little'] as const
const fingerJoints = ['Metacarpal', 'Proximal', 'Intermediate', 'Distal'] as const

function quaternionAngleDegrees(values: ArrayLike<number>, a: number, b: number | null) {
  const dot = b === null
    ? Math.abs(values[a + 3]!)
    : Math.abs(values[a]! * values[b]! + values[a + 1]! * values[b + 1]! + values[a + 2]! * values[b + 2]! + values[a + 3]! * values[b + 3]!)
  return 2 * Math.acos(Math.min(1, dot)) * degreesPerRadian
}

/** Keys differ from identity or from the first key by more than the threshold. */
function isAnimated(track: ClipTrackSummary) {
  const { values } = track
  if (track.property === 'quaternion') {
    for (let i = 0; i + 3 < values.length; i += 4) {
      if (quaternionAngleDegrees(values, i, null) > rotationThresholdDegrees)
        return true
      if (i > 0 && quaternionAngleDegrees(values, i, 0) > rotationThresholdDegrees)
        return true
    }
    return false
  }
  for (let i = 0; i + 2 < values.length; i += 3) {
    if (Math.hypot(values[i]!, values[i + 1]!, values[i + 2]!) > positionThreshold)
      return true
    if (i > 0 && Math.hypot(values[i]! - values[0]!, values[i + 1]! - values[1]!, values[i + 2]! - values[2]!) > positionThreshold)
      return true
  }
  return false
}

function groupNames(bones: ClipMaskBones) {
  const groups = new Map<ClipMaskGroup, Set<string>>()
  const add = (group: ClipMaskGroup, name: string | undefined) => {
    if (name === undefined)
      return
    let names = groups.get(group)
    if (!names) {
      names = new Set()
      groups.set(group, names)
    }
    names.add(name)
  }
  for (const side of ['left', 'right'] as const) {
    for (const bone of armBones)
      add(`${side}Arm`, bones[`${side}${bone}`])
    for (const kind of fingerKinds) {
      for (const joint of fingerJoints)
        add(`${side}Fingers`, bones[`${side}${kind}${joint}`])
    }
    for (const name of bones.helpers?.[`${side}Arm`] ?? [])
      add(`${side}Arm`, name)
    for (const name of bones.helpers?.[`${side}Fingers`] ?? [])
      add(`${side}Fingers`, name)
  }
  for (const bone of ['spine', 'chest', 'upperChest'] as const)
    add('upperBody', bones[bone])
  for (const bone of ['neck', 'head'] as const)
    add('head', bones[bone])
  return groups
}

/**
 * Builds the clip ownership mask once at clip load from per-track key values.
 * Many VMD files key every bone at frame 0 with identity; those tracks own nothing.
 */
export function buildClipBoneMask(tracks: readonly ClipTrackSummary[], bones: ClipMaskBones): ClipBoneMask {
  const names = groupNames(bones)
  const groups: Record<ClipMaskGroup, boolean> = {
    root: false,
    leftLegIk: false,
    rightLegIk: false,
    leftArm: false,
    rightArm: false,
    leftFingers: false,
    rightFingers: false,
    upperBody: false,
    head: false,
  }
  const animatedBones: string[] = []
  for (const track of tracks) {
    if (!isAnimated(track))
      continue
    if (!animatedBones.includes(track.boneName))
      animatedBones.push(track.boneName)
    for (const [group, set] of names) {
      if (set.has(track.boneName))
        groups[group] = true
    }
    const normalized = track.boneName.normalize('NFKC').toLowerCase()
    if (rootNames.has(normalized))
      groups.root = true
    const ik = legIkPattern.exec(normalized)
    if (ik)
      groups[ik[1] === '左' ? 'leftLegIk' : 'rightLegIk'] = true
  }
  return { animatedBones, groups }
}
