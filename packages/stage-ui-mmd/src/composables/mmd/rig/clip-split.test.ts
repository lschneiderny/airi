import type { ClipMaskBones } from '@proj-airi/motion-driver-humanoid/clip-mask'

import { AnimationClip, NumberKeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'
import { describe, expect, it } from 'vitest'

import { partitionClipByBones, splitClipByLayer } from './clip-split'

const bones: ClipMaskBones = {
  hips: 'センター',
  spine: '上半身',
  head: '頭',
  leftUpperArm: '左腕',
  leftIndexProximal: '左人指１',
  leftUpperLeg: '左足',
  helpers: { lowerBody: ['下半身'] },
}

const quat = (bone: string) => new QuaternionKeyframeTrack(`.bones[${bone}].quaternion`, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1])
const pos = (bone: string) => new VectorKeyframeTrack(`.bones[${bone}].position`, [0, 1], [0, 0, 0, 0, 1, 0])
const names = (clip: AnimationClip) => clip.tracks.map(track => track.name)

describe('splitClipByLayer', () => {
  it('splits a two-track clip into one track per partition and preserves duration and names', () => {
    const clip = new AnimationClip('wave', 2, [quat('左腕'), pos('左足ＩＫ')])
    const { upper, lower } = splitClipByLayer(clip, bones)
    expect(names(upper)).toEqual(['.bones[左腕].quaternion'])
    expect(names(lower)).toEqual(['.bones[左足ＩＫ].position'])
    expect([upper.name, lower.name]).toEqual(['wave#upper', 'wave#lower'])
    expect([upper.duration, lower.duration]).toEqual([2, 2])
  })

  it('puts arm, finger, head and upper body bones in upper and root, lower body and legs in lower', () => {
    const clip = new AnimationClip('mix', 1, [quat('左腕'), quat('左人指１'), quat('頭'), quat('上半身'), quat('センター'), quat('下半身'), quat('左足')])
    const { upper, lower } = splitClipByLayer(clip, bones)
    expect(names(upper)).toEqual(['.bones[左腕].quaternion', '.bones[左人指１].quaternion', '.bones[頭].quaternion', '.bones[上半身].quaternion'])
    expect(names(lower)).toEqual(['.bones[センター].quaternion', '.bones[下半身].quaternion', '.bones[左足].quaternion'])
  })

  it('yields an empty lower partition for an upper-only clip', () => {
    const { upper, lower } = splitClipByLayer(new AnimationClip('arms', 1, [quat('左腕'), quat('頭')]), bones)
    expect(upper.tracks).toHaveLength(2)
    expect(lower.tracks).toHaveLength(0)
  })

  it('sends morph and other property tracks to lower', () => {
    const morph = new NumberKeyframeTrack('.morphTargetInfluences[smile]', [0, 1], [0, 1])
    const { upper, lower } = splitClipByLayer(new AnimationClip('face', 1, [morph, quat('左腕')]), bones)
    expect(names(upper)).toEqual(['.bones[左腕].quaternion'])
    expect(names(lower)).toEqual(['.morphTargetInfluences[smile]'])
  })

  it('prunes upper tracks that are not in the animated set when one is given', () => {
    const clip = new AnimationClip('wave', 1, [quat('左腕'), quat('頭')])
    const { upper, lower } = splitClipByLayer(clip, bones, new Set(['左腕']))
    expect(names(upper)).toEqual(['.bones[左腕].quaternion'])
    expect(lower.tracks).toHaveLength(0)
  })
})

describe('partitionClipByBones', () => {
  it('moves tracks of the named bones into the first clip and keeps the rest in the second', () => {
    const clip = new AnimationClip('base', 3, [quat('左腕'), quat('頭'), pos('センター')])
    const [taken, kept] = partitionClipByBones(clip, new Set(['左腕', '頭']), 'base#yield', 'base#keep')
    expect(names(taken)).toEqual(['.bones[左腕].quaternion', '.bones[頭].quaternion'])
    expect(names(kept)).toEqual(['.bones[センター].position'])
    expect([taken.name, kept.name, taken.duration, kept.duration]).toEqual(['base#yield', 'base#keep', 3, 3])
  })
})
