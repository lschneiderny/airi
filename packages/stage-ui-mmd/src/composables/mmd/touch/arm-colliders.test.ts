import { Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'

import { buildMMDArmTestColliders, buildMMDTouchColliders, mmdTouchRegionRoots } from './colliders'

const names = ['センター', '下半身', '上半身', '上半身2', '首', '頭', '左肩', '左腕', 'スカート', '髪', '袖', '右腕']
const parents = [-1, 0, 0, 2, 3, 4, 3, 6, 1, 5, 7, 3]
// The upper-arm bones are 3 units apart, so a body wider than 0.65 * 3 is a shell, not a body part.
const positions: [number, number, number][] = names.map(name => name === '左腕' ? [1.5, 0, 0] : name === '右腕' ? [-1.5, 0, 0] : [0, 0, 0])
const source = {
  bones: names.map((name, index) => ({ name, parentBoneIndex: parents[index], position: positions[index] })),
  rigidBodies: names.slice(1).map((name, offset) => ({
    name: `body-${name}`,
    boneIndex: offset + 1,
    shapeType: 0,
    shapeSize: [1, 0, 0] as [number, number, number],
    shapePosition: [0, 0, 0] as [number, number, number],
    shapeRotation: [0, 0, 0] as [number, number, number],
    // The skirt is simulated cloth; every other body follows its bone.
    physicsMode: name === 'スカート' ? 1 : 0,
  })),
}
const rig = {
  bones: { hips: '下半身', spine: '上半身', chest: '上半身2', head: '頭', neck: '首', leftShoulder: '左肩', leftUpperArm: '左腕', rightUpperArm: '右腕' },
  hipsTranslation: { center: 'センター', groove: null },
}
const inverses = names.map(() => new Matrix4())

describe('arm test colliders', () => {
  it('include torso, hip and skirt bodies and exclude arm, sleeve, head and hair bodies, split by physics mode', () => {
    const { kinematic, dynamic } = buildMMDArmTestColliders(source, inverses, new Matrix4(), rig)
    expect(kinematic.map(collider => collider.name)).toEqual(['body-下半身', 'body-上半身', 'body-上半身2'])
    expect(dynamic.map(collider => collider.name)).toEqual(['body-スカート'])
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
      ['body-右腕', 'body'],
    ])
  })

  it('keep a torso body that turns off collision with group 0, as real rigs do for their own body parts', () => {
    const selfPassing = { ...source, rigidBodies: source.rigidBodies.map(body => body.name === 'body-上半身2' ? { ...body, collisionMask: 0xFF02 } : body) }
    const { kinematic, dynamic } = buildMMDArmTestColliders(selfPassing, inverses, new Matrix4(), rig)
    expect([...kinematic, ...dynamic].map(collider => collider.name)).toEqual(['body-下半身', 'body-上半身', 'body-上半身2', 'body-スカート'])
  })

  it('skip a coat shell wider than the shoulder span and keep a body just inside it', () => {
    const resize = (radius: number) => ({ ...source, rigidBodies: source.rigidBodies.map(body => body.name === 'body-上半身2' ? { ...body, shapeSize: [radius, 0, 0] as [number, number, number] } : body) })
    const names = (radius: number) => buildMMDArmTestColliders(resize(radius), inverses, new Matrix4(), rig).kinematic.map(collider => collider.name)
    expect(names(2)).toEqual(['body-下半身', 'body-上半身'])
    expect(names(1.9)).toContain('body-上半身2')
  })
})
