import { Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'

import { buildMMDArmTestColliders, buildMMDTouchColliders, mmdTouchRegionRoots } from './colliders'

const names = ['センター', '下半身', '上半身', '上半身2', '首', '頭', '左肩', '左腕', 'スカート', '髪', '袖']
const parents = [-1, 0, 0, 2, 3, 4, 3, 6, 1, 5, 7]
const source = {
  bones: names.map((name, index) => ({ name, parentBoneIndex: parents[index] })),
  rigidBodies: names.slice(1).map((name, offset) => ({
    name: `body-${name}`,
    boneIndex: offset + 1,
    shapeType: 0,
    shapeSize: [1, 0, 0] as [number, number, number],
    shapePosition: [0, 0, 0] as [number, number, number],
    shapeRotation: [0, 0, 0] as [number, number, number],
  })),
}
const rig = {
  bones: { hips: '下半身', spine: '上半身', chest: '上半身2', head: '頭', neck: '首', leftShoulder: '左肩', leftUpperArm: '左腕' },
  hipsTranslation: { center: 'センター', groove: null },
}
const inverses = names.map(() => new Matrix4())

describe('arm test colliders', () => {
  it('include torso, hip and skirt bodies and exclude arm, sleeve, head and hair bodies', () => {
    const colliders = buildMMDArmTestColliders(source, inverses, new Matrix4(), rig)
    expect(colliders.map(collider => collider.name)).toEqual(['body-下半身', 'body-上半身', 'body-上半身2', 'body-スカート'])
  })

  it('leave the touch regions unchanged: the skirt below the centre bone is not a touch target', () => {
    const touch = buildMMDTouchColliders(source, inverses, new Matrix4(), mmdTouchRegionRoots(rig))
    expect(touch.map(collider => [collider.name, collider.region])).toEqual([
      ['body-下半身', 'body'],
      ['body-上半身', 'body'],
      ['body-上半身2', 'body'],
      ['body-首', 'head'],
      ['body-頭', 'head'],
      ['body-左肩', 'body'],
      ['body-左腕', 'body'],
      ['body-スカート', 'body'],
      ['body-髪', 'head'],
      ['body-袖', 'body'],
    ])
  })
})
