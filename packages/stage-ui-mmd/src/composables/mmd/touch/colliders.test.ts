import type { MMDTouchSource } from './colliders'

import { Matrix4, Quaternion, Ray, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { buildMMDTouchColliders, mmdTouchRegionOf, raycastMMDTouchColliders } from './colliders'
import { MMDTouchGestures } from './gestures'

const SPHERE = 0
const BOX = 1
const CAPSULE = 2

const bonePositions: Array<{ name: string, parentBoneIndex: number, position: [number, number, number] }> = [
  { name: 'センター', parentBoneIndex: -1, position: [0, 0, 0] },
  { name: '下半身', parentBoneIndex: 0, position: [0, 8, 0] },
  { name: '上半身', parentBoneIndex: 0, position: [0, 9, 0] },
  { name: '上半身2', parentBoneIndex: 2, position: [0, 11, 0] },
  { name: '首', parentBoneIndex: 3, position: [0, 13, 0] },
  { name: '頭', parentBoneIndex: 4, position: [0, 14, 0] },
  { name: 'Hair_01', parentBoneIndex: 5, position: [3, 15, 0] },
  { name: 'Hair_02', parentBoneIndex: 6, position: [3, 14, 0] },
  { name: '左腕', parentBoneIndex: 3, position: [2, 12, 0] },
]

const roots = { head: ['頭', '首'], body: ['下半身', '上半身', '上半身2'] }

function body(name: string, boneIndex: number, shapeType: number, shapeSize: [number, number, number], shapePosition: [number, number, number], shapeRotation: [number, number, number] = [0, 0, 0]) {
  return { name, boneIndex, shapeType, shapeSize, shapePosition, shapeRotation }
}

const source: MMDTouchSource = {
  bones: bonePositions.map(({ name, parentBoneIndex }) => ({ name, parentBoneIndex })),
  rigidBodies: [
    body('head', 5, SPHERE, [1, 0, 0], [0, 15, 0]),
    body('chest', 3, BOX, [1, 2, 0.5], [0, 10, 0]),
    // Hair two links below 頭: only the parent chain makes it head.
    body('hair', 7, CAPSULE, [0.5, 2, 0], [3, 14, 0]),
    // A forearm box rotated 90 degrees about Z, so its long axis lies along X.
    body('arm', 8, BOX, [0.3, 1.5, 0.3], [3.5, 12, 0], [0, 0, Math.PI / 2]),
    body('root', 0, SPHERE, [3, 0, 0], [0, -5, 0]),
  ],
}

const restWorld = bonePositions.map(({ position }) => new Matrix4().makeTranslation(...position))
const boneInverses = restWorld.map(matrix => matrix.clone().invert())
const colliders = buildMMDTouchColliders(source, boneInverses, new Matrix4(), roots)

function forward(x: number, y: number) {
  return new Ray(new Vector3(x, y, 10), new Vector3(0, 0, -1))
}

function cast(ray: Ray, world: Matrix4[] = restWorld) {
  return raycastMMDTouchColliders(ray, colliders, index => world[index])
}

describe('mmd touch colliders', () => {
  it('drops bodies outside the head and body chains', () => {
    expect(colliders.map(collider => [collider.name, collider.region])).toEqual([
      ['head', 'head'],
      ['chest', 'body'],
      ['hair', 'head'],
      ['arm', 'body'],
    ])
  })

  it('resolves regions through the parent chain, nearest root first', () => {
    expect(mmdTouchRegionOf(7, source.bones, roots)).toBe('head')
    expect(mmdTouchRegionOf(5, source.bones, roots)).toBe('head')
    expect(mmdTouchRegionOf(8, source.bones, roots)).toBe('body')
    expect(mmdTouchRegionOf(0, source.bones, roots)).toBeNull()
  })

  it('hits a sphere as head, at its front surface', () => {
    const hit = cast(forward(0.6, 15))
    expect(hit?.collider.name).toBe('head')
    expect(hit?.region).toBe('head')
    expect(hit?.point.z).toBeCloseTo(0.8, 5)
    expect(cast(forward(1.05, 15))).toBeNull()
  })

  it('reads box sizes as half-extents', () => {
    // 0.8 is inside the 1.0 half-width but outside a 0.5 half-width (size taken as full extent).
    const inside = cast(forward(0.8, 11.5))
    expect(inside?.collider.name).toBe('chest')
    expect(inside?.region).toBe('body')
    expect(inside?.point.z).toBeCloseTo(0.5, 5)
    // 1.5 is outside the 1.0 half-width but inside a 2.0 half-width (size doubled).
    expect(cast(forward(1.5, 10))).toBeNull()
  })

  it('applies the shape rotation to a box', () => {
    // Rotated 90 degrees about Z, the 1.5 half-length lies along X: x = 4.7 hits, y = 13 misses.
    expect(cast(forward(4.7, 12))?.collider.name).toBe('arm')
    expect(cast(forward(4.5, 13))).toBeNull()
  })

  it('hits a capsule on its caps and reads its height as the full cylinder length', () => {
    // Cylinder spans y 13..15 around the 14 centre; caps reach 12.5..15.5.
    expect(cast(forward(3, 15.3))?.collider.name).toBe('hair')
    expect(cast(forward(3, 15.3))?.region).toBe('head')
    expect(cast(forward(3.45, 14))?.region).toBe('head')
    // Beyond the cap. A capsule built with the height as a half-height would reach 16.5 and hit.
    expect(cast(forward(3, 15.7))).toBeNull()
    expect(cast(forward(3.55, 14))).toBeNull()
  })

  it('returns null for a ray that misses every collider', () => {
    expect(cast(forward(-6, 15))).toBeNull()
    expect(cast(new Ray(new Vector3(0, 15, 10), new Vector3(0, 0, 1)))).toBeNull()
  })

  it('returns the nearest hit when colliders overlap along the ray', () => {
    const down = new Ray(new Vector3(0.2, 30, 0), new Vector3(0, -1, 0))
    expect(cast(down)?.collider.name).toBe('head')
  })

  it('follows the posed bone with the offset stored at load', () => {
    const posed = restWorld.map(matrix => matrix.clone())
    // Head turns 90 degrees about Y and moves 4 to the left; its sphere sat 1 above the bone.
    posed[5] = new Matrix4().compose(new Vector3(-4, 14, 0), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2), new Vector3(1, 1, 1))
    expect(cast(forward(-4, 15), posed)?.collider.name).toBe('head')
    expect(cast(forward(0, 15), posed)).toBeNull()
  })
})

describe('mmd touch capsule entry', () => {
  // A radius-1 capsule with a height-2 cylinder (axis y -1..1) on a body bone at the origin,
  // and a tiny head sphere just inside the capsule's surface along x = y.
  const overlap = buildMMDTouchColliders({
    bones: [{ name: '上半身', parentBoneIndex: -1 }, { name: '頭', parentBoneIndex: 0 }],
    rigidBodies: [
      body('bodyCapsule', 0, CAPSULE, [1, 2, 0], [0, 0, 0]),
      body('headSphere', 1, SPHERE, [0.01, 0, 0], [0.9, 0.9, 0]),
    ],
  }, [new Matrix4(), new Matrix4()], new Matrix4(), { head: ['頭'], body: ['上半身'] })
  const identity = () => new Matrix4()

  it('enters an oblique capsule at its surface, so the nearer body wins the overlap', () => {
    const ray = new Ray(new Vector3(3, 3, 0), new Vector3(-1, -1, 0).normalize())
    const capsule = raycastMMDTouchColliders(ray, [overlap[0]], identity)
    expect(capsule?.point.x).toBeCloseTo(1, 6)
    expect(capsule?.point.y).toBeCloseTo(1, 6)
    expect(capsule?.distance).toBeCloseTo(2 * Math.SQRT2, 6)
    const nearest = raycastMMDTouchColliders(ray, overlap, identity)
    expect(nearest?.collider.name).toBe('bodyCapsule')
    expect(nearest?.region).toBe('body')
  })

  it('enters an oblique ray through the hemispherical cap above the cylinder', () => {
    // Solved from the cap sphere alone: centre (0, 1, 0), radius 1.
    const ray = new Ray(new Vector3(0, 5, 1.3), new Vector3(0, -1, -0.2).normalize())
    const hit = raycastMMDTouchColliders(ray, [overlap[0]], identity)
    expect(hit?.point.x).toBeCloseTo(0, 6)
    expect(hit?.point.y).toBeCloseTo(1.7584802324, 6)
    expect(hit?.point.z).toBeCloseTo(0.6516960465, 6)
    expect(hit?.distance).toBeCloseTo(3.3057145097, 6)
  })
})

describe('mmd touch gestures', () => {
  const sample = (timeMs: number, x: number, region: 'head' | 'body' | null = 'head') => ({ timeMs, x, y: 100, region, scale: 100, head: { x: (x - 100) / 100, y: 0, halfHeight: 0.5 } })

  it('turns a short still click on the head into a poke', () => {
    const gestures = new MMDTouchGestures()
    gestures.pressed(sample(0, 100))
    expect(gestures.released(sample(50, 100))).toEqual([{ kind: 'poke', region: 'head', x: 100, y: 100 }])
  })

  it('emits nothing for a click on empty canvas', () => {
    const gestures = new MMDTouchGestures()
    const empty = { timeMs: 0, x: 900, y: 900, region: null, scale: 100 }
    expect(gestures.pressed(empty)).toEqual([])
    expect(gestures.update(200)).toEqual([])
    expect(gestures.released({ ...empty, timeMs: 250 })).toEqual([])
  })

  it('starts a hover pet after stroking back and forth over the head', () => {
    const gestures = new MMDTouchGestures()
    const events = []
    for (let step = 0; step <= 40; step++) {
      const phase = step % 20
      const x = 80 + (phase < 10 ? phase : 20 - phase) * 4
      events.push(...gestures.moved(sample(step * 50, x)))
    }
    expect(events).toContainEqual({ kind: 'pet-start' })
    expect(gestures.petting).toBe(true)
  })
})
