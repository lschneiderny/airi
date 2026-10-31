import { AnimationClip, Euler, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'

import { buildMMDClipMask, mmdClipTrackSummaries } from './clip-mask'
import { readMMDRigProfile } from './rig-profile'

const bone = (name: string, parent: number, position: [number, number, number] = [0, 0, 0]) => ({ name, position, parentBoneIndex: parent })
const rig = readMMDRigProfile({
  bones: [
    bone('センター', -1),
    bone('上半身', 0),
    bone('左肩', 1),
    bone('左腕', 2),
    bone('左腕捩', 3),
    bone('左ひじ', 3),
    bone('左手首', 5),
    bone('左人指１', 6),
    bone('右腕', 1),
    bone('左足ＩＫ', -1),
  ].map(entry => ({ ...entry, ik: undefined })),
  rigidBodies: [],
})
const bend = new Quaternion().setFromEuler(new Euler(0, 0, Math.PI / 3)).toArray()
const identity = [0, 0, 0, 1]
const rotationTrack = (name: string, keys: number[]) => new QuaternionKeyframeTrack(`.bones[${name}].quaternion`, keys.map((_, index) => index), keys.flatMap(angle => new Quaternion().setFromEuler(new Euler(0, 0, angle)).toArray()))

describe('mmd clip ownership masks', () => {
  it('reads bone tracks and ignores the rest', () => {
    const summaries = mmdClipTrackSummaries(new AnimationClip('c', 1, [rotationTrack('左腕', [0, 1]), new VectorKeyframeTrack('.bones[センター].position', [0], [0, 0, 0]), new VectorKeyframeTrack('.morphTargetInfluences[a]', [0], [0])]))
    expect(summaries.map(({ boneName, property }) => [boneName, property])).toEqual([['左腕', 'quaternion'], ['センター', 'position']])
  })

  it('gives a clip with identity keys no ownership', () => {
    const mask = buildMMDClipMask(new AnimationClip('still', 2, [rotationTrack('左腕', [0, 0, 0]), rotationTrack('右腕', [0, 0]), new VectorKeyframeTrack('.bones[センター].position', [0, 1], [0, 0, 0, 0, 0, 0])]), rig)
    expect(mask.animatedBones).toEqual([])
    expect(Object.values(mask.groups).some(Boolean)).toBe(false)
  })

  it('gives a 60 degree left-arm track the left arm and nothing else', () => {
    const mask = buildMMDClipMask(new AnimationClip('wave', 2, [new QuaternionKeyframeTrack('.bones[左腕].quaternion', [0, 1, 2], [...identity, ...bend, ...identity])]), rig)
    expect(mask.animatedBones).toEqual(['左腕'])
    expect(Object.entries(mask.groups).filter(([, owned]) => owned).map(([group]) => group)).toEqual(['leftArm'])
  })

  it('groups twist helpers and fingers, and keys on the root and leg IK bones', () => {
    const mask = buildMMDClipMask(new AnimationClip('mixed', 2, [
      rotationTrack('左腕捩', [0, 1]),
      rotationTrack('左人指１', [0, 1]),
      new VectorKeyframeTrack('.bones[センター].position', [0, 1], [0, 0, 0, 0, 2, 0]),
      new VectorKeyframeTrack('.bones[左足ＩＫ].position', [0, 1], [0, 0, 0, 0, 1, 0]),
    ]), rig)
    expect(Object.entries(mask.groups).filter(([, owned]) => owned).map(([group]) => group).sort())
      .toEqual(['leftArm', 'leftFingers', 'leftLegIk', 'root'])
  })
})
