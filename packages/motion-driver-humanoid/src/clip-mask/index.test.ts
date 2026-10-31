import type { ClipTrackSummary } from './index'

import { describe, expect, it } from 'vitest'

import { buildClipBoneMask } from './index'

const rad = Math.PI / 180
const bones = {
  hips: '下半身',
  spine: '上半身',
  chest: '上半身2',
  neck: '首',
  head: '頭',
  leftShoulder: '左肩',
  leftUpperArm: '左腕',
  leftLowerArm: '左ひじ',
  leftHand: '左手首',
  rightUpperArm: '右腕',
  leftIndexProximal: '左人指１',
  rightIndexProximal: '右人指１',
  helpers: { leftArm: ['左腕捩', '左肩P'] },
}

function quat(boneName: string, degrees: number[]): ClipTrackSummary {
  const values = degrees.flatMap(d => [0, 0, Math.sin(d * rad / 2), Math.cos(d * rad / 2)])
  return { boneName, property: 'quaternion', values }
}

const identityKeys = (boneName: string) => quat(boneName, [0, 0, 0])

describe('buildClipBoneMask', () => {
  it('gives no ownership to identity-keyed tracks', () => {
    const mask = buildClipBoneMask(
      ['左腕', '左ひじ', '左人指１', '上半身', '頭', 'センター'].map(identityKeys),
      bones,
    )
    expect(mask.animatedBones).toEqual([])
    expect(Object.values(mask.groups).every(v => !v)).toBe(true)
  })

  it('lets a 60 deg left-arm track own leftArm only', () => {
    const mask = buildClipBoneMask([quat('左腕', [0, -60, 0])], bones)
    expect(mask.animatedBones).toEqual(['左腕'])
    expect(mask.groups.leftArm).toBe(true)
    expect(Object.entries(mask.groups).filter(([, v]) => v).map(([k]) => k)).toEqual(['leftArm'])
  })

  it('treats sub-threshold jitter as rest and a constant non-rest key as animated', () => {
    expect(buildClipBoneMask([quat('左腕', [0, 0.4, -0.4])], bones).groups.leftArm).toBe(false)
    expect(buildClipBoneMask([quat('左腕', [0, 0.6])], bones).groups.leftArm).toBe(true)
    expect(buildClipBoneMask([quat('左腕', [10, 10])], bones).groups.leftArm).toBe(true)
  })

  it('separates fingers from the arm chain and left from right', () => {
    const fingers = buildClipBoneMask([quat('左人指１', [0, 30])], bones)
    expect(fingers.groups.leftFingers).toBe(true)
    expect(fingers.groups.leftArm).toBe(false)
    expect(fingers.groups.rightFingers).toBe(false)
    const right = buildClipBoneMask([quat('右腕', [0, 30])], bones)
    expect(right.groups.rightArm).toBe(true)
    expect(right.groups.leftArm).toBe(false)
  })

  it('counts caller-listed helper bones toward that arm', () => {
    const twist = buildClipBoneMask([quat('左腕捩', [0, 45])], bones)
    expect(twist.groups.leftArm).toBe(true)
    expect(twist.groups.rightArm).toBe(false)
  })

  it('maps position tracks to root and ik names, with a 0.01 unit threshold', () => {
    const still: ClipTrackSummary = { boneName: 'センター', property: 'position', values: [0, 0.005, 0, 0, 0, 0.005] }
    const moving: ClipTrackSummary = { boneName: 'センター', property: 'position', values: [0, 0, 0, 0, 0.02, 0] }
    const ik: ClipTrackSummary = { boneName: '左足ＩＫ', property: 'position', values: [0, 0, 0, 1, 0, 0] }
    expect(buildClipBoneMask([still], bones).groups.root).toBe(false)
    expect(buildClipBoneMask([moving], bones).groups.root).toBe(true)
    const legs = buildClipBoneMask([ik], bones)
    expect(legs.groups.leftLegIk).toBe(true)
    expect(legs.groups.rightLegIk).toBe(false)
    expect(legs.groups.root).toBe(false)
  })

  it('maps the spine chain to upperBody and neck/head to head', () => {
    expect(buildClipBoneMask([quat('上半身2', [0, 20])], bones).groups.upperBody).toBe(true)
    const head = buildClipBoneMask([quat('頭', [0, 20])], bones)
    expect(head.groups.head).toBe(true)
    expect(head.groups.upperBody).toBe(false)
  })

  it('ignores tracks for bones outside the rig map', () => {
    const mask = buildClipBoneMask([quat('ボーン不明', [0, 90])], bones)
    expect(mask.groups.leftArm).toBe(false)
    expect(mask.animatedBones).toEqual(['ボーン不明'])
  })
})
