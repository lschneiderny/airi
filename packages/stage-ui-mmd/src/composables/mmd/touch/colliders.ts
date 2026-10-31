import type { PmxObject } from '@moeru/three-mmd'
import type { NaturalTouchRegion } from '@proj-airi/motion-driver-natural/frame-types'

import type { MMDRigProfile } from '../rig'

import { Box3, Euler, Matrix4, Quaternion, Ray, Sphere, Vector3 } from 'three'

/** The PMX fields touch reads. `mmd.pmx` satisfies it directly; values are post-parse, as Ammo reads them. */
export interface MMDTouchSource {
  bones: readonly Pick<PmxObject.Bone, 'name' | 'parentBoneIndex'>[]
  rigidBodies: readonly Pick<PmxObject.RigidBody, 'name' | 'boneIndex' | 'shapeType' | 'shapeSize' | 'shapePosition' | 'shapeRotation'>[]
}

/** Bone names whose subtrees belong to each region. The nearest listed ancestor decides. */
export interface MMDTouchRegionRoots {
  head: readonly string[]
  body: readonly string[]
}

export type MMDTouchShape = 'sphere' | 'box' | 'capsule'

/**
 * One rigid body as a touch target. `offset` is the body transform relative to its bone,
 * fixed at load, so the collider follows the posed bone without reading the physics world.
 */
export interface MMDTouchCollider {
  name: string
  boneIndex: number
  region: NaturalTouchRegion
  shape: MMDTouchShape
  /** PMX `shapeSize`: sphere [radius], box half-extents, capsule [radius, cylinder height] along local Y. */
  size: readonly [number, number, number]
  offset: Matrix4
}

export interface MMDTouchHit {
  collider: MMDTouchCollider
  region: NaturalTouchRegion
  point: Vector3
  distance: number
}

// PMX shape types; the enum is declared type-only in three-mmd, so the numeric values are compared here.
const SHAPE_SPHERE = 0
const SHAPE_BOX = 1
const SHAPE_CAPSULE = 2

/** Head is 頭/首 and their descendants; body is the 上半身/上半身2/上半身3/下半身 subtrees, from the rig's resolved names. */
export function mmdTouchRegionRoots(rig: Pick<MMDRigProfile, 'bones'>): MMDTouchRegionRoots {
  const names = (keys: readonly (keyof MMDRigProfile['bones'])[]) => keys.flatMap(key => rig.bones[key] ?? [])
  return { head: names(['head', 'neck']), body: names(['hips', 'spine', 'chest', 'upperChest']) }
}

/** Walks up from `boneIndex` to the nearest region root, so hair under 頭 is head and an arm under 上半身2 is body. */
export function mmdTouchRegionOf(boneIndex: number, bones: MMDTouchSource['bones'], roots: MMDTouchRegionRoots): NaturalTouchRegion | null {
  const visited = new Set<number>()
  for (let index = boneIndex; index >= 0 && index < bones.length && !visited.has(index); index = bones[index].parentBoneIndex) {
    visited.add(index)
    const name = bones[index].name
    if (roots.head.includes(name))
      return 'head'
    if (roots.body.includes(name))
      return 'body'
  }
  return null
}

/**
 * Builds touch colliders from the model's rigid bodies, mirroring how the Ammo physics
 * helper places them: the shape transform composes `shapePosition` with a YXZ Euler of
 * `shapeRotation`, and the bone offset is `boneInverse * bindMatrix * shape`. Bodies on
 * no bone, or outside the head and body subtrees, are not touch targets.
 */
export function buildMMDTouchColliders(
  source: MMDTouchSource,
  boneInverses: readonly Matrix4[],
  bindMatrix: Matrix4,
  roots: MMDTouchRegionRoots,
): MMDTouchCollider[] {
  const colliders: MMDTouchCollider[] = []
  const rotation = new Quaternion()
  for (const body of source.rigidBodies) {
    const shape = body.shapeType === SHAPE_SPHERE ? 'sphere' : body.shapeType === SHAPE_BOX ? 'box' : body.shapeType === SHAPE_CAPSULE ? 'capsule' : null
    const inverse = boneInverses[body.boneIndex]
    if (!shape || !inverse)
      continue
    const region = mmdTouchRegionOf(body.boneIndex, source.bones, roots)
    if (!region)
      continue
    rotation.setFromEuler(new Euler(body.shapeRotation[0], body.shapeRotation[1], body.shapeRotation[2], 'YXZ'))
    const transform = new Matrix4().compose(new Vector3().fromArray(body.shapePosition), rotation, new Vector3(1, 1, 1))
    colliders.push({
      name: body.name,
      boneIndex: body.boneIndex,
      region,
      shape,
      size: [body.shapeSize[0], body.shapeSize[1], body.shapeSize[2]],
      offset: new Matrix4().copy(inverse).multiply(bindMatrix).multiply(transform),
    })
  }
  return colliders
}

const world = new Matrix4()
const inverseWorld = new Matrix4()
const localRay = new Ray()
const localPoint = new Vector3()
const segmentStart = new Vector3()
const segmentEnd = new Vector3()
const box = new Box3()
const sphere = new Sphere()

function intersectLocal(ray: Ray, collider: MMDTouchCollider, target: Vector3): Vector3 | null {
  const [x, y, z] = collider.size
  switch (collider.shape) {
    case 'sphere':
      return ray.intersectSphere(sphere.set(segmentStart.set(0, 0, 0), x), target)
    case 'box':
      // PMX box sizes are half-extents; the physics helper draws them at twice the size.
      return ray.intersectBox(box.set(segmentStart.set(-x, -y, -z), segmentEnd.set(x, y, z)), target)
    case 'capsule': {
      // Ammo's btCapsuleShape(radius, height): a cylinder of `height` along Y with hemispherical caps.
      const t = mmdCapsuleRayDistance(ray, x, y / 2)
      return t === null ? null : ray.at(t, target)
    }
  }
}

type Interval = readonly [number, number] | null

const everywhere: Interval = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]

function overlap(first: Interval, second: Interval): Interval {
  if (!first || !second)
    return null
  const low = Math.max(first[0], second[0])
  const high = Math.min(first[1], second[1])
  return low <= high ? [low, high] : null
}

/**
 * Where `a t^2 + 2 b t + c <= 0` for `a > 0`. The roots use the cancellation-free form
 * `q = -(b + sign(b) sqrt(b^2 - a c))`, `t = q / a` and `t = c / q`, so a nearly vanishing `a`
 * (a ray almost parallel to the capsule axis) still yields an accurate near root.
 */
function quadraticInterval(a: number, b: number, c: number): Interval {
  const discriminant = b * b - a * c
  if (discriminant < 0)
    return null
  const q = -(b + (b < 0 ? -1 : 1) * Math.sqrt(discriminant))
  if (q === 0)
    return [0, 0]
  const first = q / a
  const second = c / q
  return first <= second ? [first, second] : [second, first]
}

/**
 * First `t >= 0` at which `ray` is on the surface of a capsule around the local Y axis: a
 * cylinder of `radius` between `-halfHeight` and `halfHeight` closed by two hemispherical caps.
 *
 * The capsule is the union of that finite cylinder and the two balls at its ends, and it is
 * convex, so the ray's parameter interval through it is the union of the intervals through
 * those three pieces. A ray that starts outside returns where it enters; one that starts
 * strictly inside returns where it leaves; one that starts on the surface returns 0. That is
 * the same contract three's `Ray.intersectSphere` and `Ray.intersectBox` follow. A height of 0
 * makes both balls coincide, which is a sphere.
 */
export function mmdCapsuleRayDistance(ray: Ray, radius: number, halfHeight: number): number | null {
  const { origin: o, direction: d } = ray
  const radial = d.x * d.x + d.z * d.z
  const outsideRadius = o.x * o.x + o.z * o.z - radius * radius
  // Exact degeneracies of the closed form, not tolerances: a line parallel to the axis keeps
  // its distance from it, and a line perpendicular to the axis keeps its height.
  const side = radial === 0
    ? (outsideRadius <= 0 ? everywhere : null)
    : quadraticInterval(radial, o.x * d.x + o.z * d.z, outsideRadius)
  const slab: Interval = d.y === 0
    ? (Math.abs(o.y) <= halfHeight ? everywhere : null)
    : [Math.min((-halfHeight - o.y) / d.y, (halfHeight - o.y) / d.y), Math.max((-halfHeight - o.y) / d.y, (halfHeight - o.y) / d.y)]
  const lengthSq = d.x * d.x + d.y * d.y + d.z * d.z
  const ball = (centerY: number) => {
    const y = o.y - centerY
    return quadraticInterval(lengthSq, o.x * d.x + y * d.y + o.z * d.z, o.x * o.x + y * y + o.z * o.z - radius * radius)
  }
  let enter = Number.POSITIVE_INFINITY
  let exit = Number.NEGATIVE_INFINITY
  for (const piece of [overlap(side, slab), ball(halfHeight), ball(-halfHeight)]) {
    if (!piece)
      continue
    enter = Math.min(enter, piece[0])
    exit = Math.max(exit, piece[1])
  }
  if (exit < 0)
    return null
  if (enter >= 0)
    return enter
  const axisY = Math.max(-halfHeight, Math.min(halfHeight, o.y))
  const insideDepth = Math.hypot(o.x, o.y - axisY, o.z) - radius
  return insideDepth < 0 ? exit : 0
}

/**
 * Casts a world-space ray against the colliders posed by `boneWorld` (each bone's world
 * matrix, as three updates it after the frame's physics step) and returns the nearest hit,
 * or `null` when the ray misses every collider.
 */
export function raycastMMDTouchColliders(
  ray: Ray,
  colliders: readonly MMDTouchCollider[],
  boneWorld: (boneIndex: number) => Matrix4 | undefined,
): MMDTouchHit | null {
  let nearest: MMDTouchHit | null = null
  for (const collider of colliders) {
    const bone = boneWorld(collider.boneIndex)
    if (!bone)
      continue
    world.multiplyMatrices(bone, collider.offset)
    localRay.copy(ray).applyMatrix4(inverseWorld.copy(world).invert())
    if (!intersectLocal(localRay, collider, localPoint))
      continue
    const point = localPoint.clone().applyMatrix4(world)
    const distance = point.distanceTo(ray.origin)
    if (!nearest || distance < nearest.distance)
      nearest = { collider, region: collider.region, point, distance }
  }
  return nearest
}

export function mmdTouchColliderCenter(collider: MMDTouchCollider, bone: Matrix4, target: Vector3): Vector3 {
  return target.setFromMatrixPosition(world.multiplyMatrices(bone, collider.offset))
}
