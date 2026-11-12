import type { ClipBoneMask, ClipMaskBones, ClipTrackSummary } from '@proj-airi/motion-driver-humanoid/clip-mask'
import type { AnimationClip } from 'three'

import type { MMDRigProfile } from './rig-profile'

import { buildClipBoneMask } from '@proj-airi/motion-driver-humanoid/clip-mask'

import { MMD_LOWER_BODY_CANDIDATES } from './bone-map'

const BONE_TRACK = /^\.bones\[(.+)\]\.(quaternion|position)$/

/**
 * The rig's bone names for the pure mask builder: humanoid and finger bones, the twist and shoulder helpers, and every
 * `spineChain` link as upper body, so a trunk link is grouped by its place on the chain rather than by its name.
 */
export function mmdClipMaskBones(rig: Pick<MMDRigProfile, 'bones' | 'fingerBones' | 'armHelpers' | 'spineChain'>): ClipMaskBones {
  return {
    ...rig.bones,
    ...rig.fingerBones,
    helpers: {
      leftArm: rig.armHelpers.left,
      rightArm: rig.armHelpers.right,
      lowerBody: MMD_LOWER_BODY_CANDIDATES,
      upperBody: rig.spineChain.map(link => link.name),
    },
  }
}

/** Reduces a VMD clip's `.bones[<name>].quaternion|position` tracks to their bone name and key values. */
export function mmdClipTrackSummaries(clip: Pick<AnimationClip, 'tracks'>): ClipTrackSummary[] {
  const summaries: ClipTrackSummary[] = []
  for (const track of clip.tracks) {
    const match = BONE_TRACK.exec(track.name)
    if (match)
      summaries.push({ boneName: match[1], property: match[2] as ClipTrackSummary['property'], values: track.values })
  }
  return summaries
}

/** Builds the clip ownership mask once at clip load. Tracks that key only identity own nothing. */
export function buildMMDClipMask(clip: Pick<AnimationClip, 'tracks'>, rig: Pick<MMDRigProfile, 'bones' | 'fingerBones' | 'armHelpers' | 'spineChain'>): ClipBoneMask {
  return buildClipBoneMask(mmdClipTrackSummaries(clip), mmdClipMaskBones(rig))
}
