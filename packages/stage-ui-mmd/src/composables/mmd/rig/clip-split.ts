import type { ClipMaskBones } from '@proj-airi/motion-driver-humanoid/clip-mask'
import type { AnimationClip, KeyframeTrack } from 'three'

import { clipMaskGroupNames } from '@proj-airi/motion-driver-humanoid/clip-mask'
import { AnimationClip as ThreeAnimationClip } from 'three'

const BONE_TRACK = /^\.bones\[(.+)\]\.(?:quaternion|position)$/
const UPPER_GROUPS = ['leftArm', 'rightArm', 'leftFingers', 'rightFingers', 'head', 'upperBody'] as const

/** The rig bone a `.bones[<name>].quaternion|position` track drives, or `undefined` for any other track. */
export function trackBoneName(track: Pick<KeyframeTrack, 'name'>): string | undefined {
  return BONE_TRACK.exec(track.name)?.[1]
}

/**
 * Splits a clip's tracks into two clips by bone name. Tracks of bones in `bones` go to the first
 * clip, every other track (including morph tracks) to the second. Durations are preserved.
 */
export function partitionClipByBones(clip: AnimationClip, bones: ReadonlySet<string>, takenName: string, keptName: string): [taken: AnimationClip, kept: AnimationClip] {
  const taken: KeyframeTrack[] = []
  const kept: KeyframeTrack[] = []
  for (const track of clip.tracks) {
    const bone = trackBoneName(track)
    ;(bone !== undefined && bones.has(bone) ? taken : kept).push(track)
  }
  return [new ThreeAnimationClip(takenName, clip.duration, taken), new ThreeAnimationClip(keptName, clip.duration, kept)]
}

/**
 * Partitions a clip into an `upper` clip (arm, finger, head and upper body bones) and a `lower`
 * clip (root, leg IK, lower body and every non-bone track), named `<clip>#upper` and `<clip>#lower`.
 *
 * When `animatedBones` is given, upper tracks of bones outside it are dropped from `upper`, so a
 * layer that yields exactly those bones never writes an identity-keyed bone.
 */
export function splitClipByLayer(clip: AnimationClip, bones: ClipMaskBones, animatedBones?: ReadonlySet<string>): { upper: AnimationClip, lower: AnimationClip } {
  const groups = clipMaskGroupNames(bones)
  const upperNames = new Set<string>()
  for (const group of UPPER_GROUPS) {
    for (const name of groups.get(group) ?? [])
      upperNames.add(name)
  }
  const upper: KeyframeTrack[] = []
  const lower: KeyframeTrack[] = []
  for (const track of clip.tracks) {
    const bone = trackBoneName(track)
    if (bone === undefined || !upperNames.has(bone))
      lower.push(track)
    else if (!animatedBones || animatedBones.has(bone))
      upper.push(track)
  }
  return {
    upper: new ThreeAnimationClip(`${clip.name}#upper`, clip.duration, upper),
    lower: new ThreeAnimationClip(`${clip.name}#lower`, clip.duration, lower),
  }
}
