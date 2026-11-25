import { Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'

import { buildMMDClothColliders, buildMMDTouchColliders, fitMMDTouchColliders, mmdTouchRegionRoots } from './colliders'

const names = ['センター', '下半身', '上半身', '上半身2', '首', '頭', '左肩', '左腕', 'スカート', '髪', '袖', '右腕']
const parents = [-1, 0, 0, 2, 3, 4, 3, 6, 1, 5, 7, 3]
// The upper-arm bones are 3 units apart, so a body wider than 0.65 * 3 is a shell, not a garment part.
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

describe('cloth colliders', () => {
  it('are the simulated bodies of the torso and hips: bone-following bodies, sleeves and hair are left out', () => {
    const cloth = buildMMDClothColliders(source, inverses, new Matrix4(), rig)
    expect(cloth.map(collider => collider.name)).toEqual(['body-スカート'])
    const simulated = { ...source, rigidBodies: source.rigidBodies.map(body => ({ ...body, physicsMode: 1 })) }
    expect(buildMMDClothColliders(simulated, inverses, new Matrix4(), rig).map(collider => collider.name)).toEqual(['body-下半身', 'body-上半身', 'body-上半身2', 'body-スカート'])
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

  it('skip a cloth shell wider than the shoulder span and keep a body just inside it', () => {
    const resize = (radius: number) => ({ ...source, rigidBodies: source.rigidBodies.map(body => body.name === 'body-スカート' ? { ...body, shapeSize: [radius, 0, 0] as [number, number, number] } : body) })
    const names = (radius: number) => buildMMDClothColliders(resize(radius), inverses, new Matrix4(), rig).map(collider => collider.name)
    expect(names(2)).toEqual([])
    expect(names(1.9)).toEqual(['body-スカート'])
  })
})

describe('fitted colliders', () => {
  it('scale each collider about its own centre by the corrector\'s fit, and leave out one fitted to nothing', () => {
    const collider = (shape: 'sphere' | 'capsule' | 'box', size: [number, number, number]) => ({ name: shape, boneIndex: 2, region: 'body' as const, shape, size, offset: new Matrix4().makeTranslation(1, 2, 3) })
    const colliders = [collider('sphere', [2, 0, 0]), collider('capsule', [1, 4, 0]), collider('box', [1, 2, 3]), collider('sphere', [1, 0, 0])]
    const fitted = fitMMDTouchColliders(colliders, [1, 0.5, 0.25, 0])

    expect(fitted).toHaveLength(3)
    // A collider the rest hang clears stays the same object.
    expect(fitted[0]).toBe(colliders[0])
    // The capsule's radius and cylinder height, and the box's half extents; the centre stays.
    expect(fitted[1]).toEqual({ ...colliders[1], size: [0.5, 2, 0] })
    expect(fitted[2]).toEqual({ ...colliders[2], size: [0.25, 0.5, 0.75] })
    expect(fitted[1].offset).toBe(colliders[1].offset)
  })
})
