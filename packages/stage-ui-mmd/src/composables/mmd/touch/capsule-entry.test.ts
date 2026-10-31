import type { MMDTouchCollider } from './colliders'

import { Euler, Matrix4, Quaternion, Ray, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { buildMMDTouchColliders, raycastMMDTouchColliders } from './colliders'

const SPHERE = 0
const BOX = 1
const CAPSULE = 2

const identity = () => new Matrix4()
const roots = { head: ['head'], body: ['body'] }

type Vec = [number, number, number]

function colliders(shapes: Array<{ name: string, region: 'head' | 'body', type: number, size: Vec, position?: Vec, rotation?: Vec }>): MMDTouchCollider[] {
  return buildMMDTouchColliders({
    bones: [{ name: 'body', parentBoneIndex: -1 }, { name: 'head', parentBoneIndex: 0 }],
    rigidBodies: shapes.map(shape => ({
      name: shape.name,
      boneIndex: shape.region === 'body' ? 0 : 1,
      shapeType: shape.type,
      shapeSize: shape.size,
      shapePosition: shape.position ?? [0, 0, 0],
      shapeRotation: shape.rotation ?? [0, 0, 0],
    })),
  }, [identity(), identity()], identity(), roots)
}

function cast(shapes: MMDTouchCollider[], origin: Vec, direction: Vec) {
  return raycastMMDTouchColliders(new Ray(new Vector3(...origin), new Vector3(...direction).normalize()), shapes, identity)
}

describe('mmd touch capsule entry: reviewer reproducers', () => {
  it('zero-height-overlap: a height-0 capsule is a sphere, entered at its top, so body wins', () => {
    const shapes = colliders([
      { name: 'bodyCapsule', region: 'body', type: CAPSULE, size: [1, 0, 0] },
      { name: 'headSphere', region: 'head', type: SPHERE, size: [0.01, 0, 0], position: [0, 0.5, 0] },
    ])
    const capsule = cast([shapes[0]], [0, 3, 0], [0, -1, 0])
    expect(capsule?.point.toArray()).toEqual([0, 1, 0])
    expect(capsule?.distance).toBeCloseTo(2, 12)
    const nearest = cast(shapes, [0, 3, 0], [0, -1, 0])
    expect(nearest?.collider.name).toBe('bodyCapsule')
    expect(nearest?.region).toBe('body')
  })

  it('zero-height-inside: a ray from the centre of a height-0 capsule leaves through its top', () => {
    const [capsule] = colliders([{ name: 'bodyCapsule', region: 'body', type: CAPSULE, size: [1, 0, 0] }])
    const hit = cast([capsule], [0, 0, 0], [0, 1, 0])
    expect(hit?.point.toArray()).toEqual([0, 1, 0])
    expect(hit?.distance).toBeCloseTo(1, 12)
  })

  it('near-axis-overlap: a nearly axis-parallel ray enters the side before the cap, so body wins', () => {
    const shapes = colliders([
      { name: 'bodyCapsule', region: 'body', type: CAPSULE, size: [1, 2, 0] },
      { name: 'headSphere', region: 'head', type: SPHERE, size: [0.001, 0, 0], position: [0.99999991, 0.2, 0] },
    ])
    const origin: Vec = [1.00000001, 0, 0]
    const direction: Vec = [-0.0000005, 1, 0]
    // Solved from x = 1 alone: t = 1e-8 / |dx| on the normalized direction.
    const unit = new Vector3(...direction).normalize()
    const expected = (origin[0] - 1) / -unit.x
    const capsule = cast([shapes[0]], origin, direction)
    expect(capsule?.distance).toBeCloseTo(expected, 9)
    expect(capsule?.point.x).toBeCloseTo(1, 12)
    expect(capsule?.point.y).toBeCloseTo(unit.y * expected, 9)
    const nearest = cast(shapes, origin, direction)
    expect(nearest?.collider.name).toBe('bodyCapsule')
    expect(nearest?.region).toBe('body')
  })

  it('a ray that starts on the side surface and runs along it is on the surface at t = 0', () => {
    const [capsule] = colliders([{ name: 'bodyCapsule', region: 'body', type: CAPSULE, size: [1, 2, 0] }])
    const hit = cast([capsule], [1, 0, 0], [0, 1, 0])
    expect(hit?.distance).toBe(0)
    expect(hit?.point.toArray()).toEqual([1, 0, 0])
  })
})

describe('mmd touch inside starts', () => {
  // Contract shared by every shape: the first surface point at t >= 0, so a ray that starts
  // strictly inside reports where it leaves, and one that starts on the surface reports t = 0.
  it('reports the exit point for sphere, box and capsule alike', () => {
    const shapes = colliders([
      { name: 'sphere', region: 'body', type: SPHERE, size: [1, 0, 0] },
      { name: 'box', region: 'body', type: BOX, size: [1, 1, 1] },
      { name: 'capsule', region: 'body', type: CAPSULE, size: [1, 2, 0] },
    ])
    for (const shape of shapes) {
      const hit = cast([shape], [0, 0, 0], [1, 0, 0])
      expect(hit?.point.x, shape.name).toBeCloseTo(1, 12)
      expect(hit?.distance, shape.name).toBeCloseTo(1, 12)
    }
  })

  it('reports t = 0 for sphere and capsule rays that start on the surface and head outward', () => {
    const shapes = colliders([
      { name: 'sphere', region: 'body', type: SPHERE, size: [1, 0, 0] },
      { name: 'capsule', region: 'body', type: CAPSULE, size: [1, 2, 0] },
    ])
    for (const shape of shapes)
      expect(cast([shape], [1, 0, 0], [1, 0, 0])?.distance, shape.name).toBe(0)
  })
})

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Capsule { radius: number, height: number, position: Vec, rotation: Vec }

/**
 * Brute-force reference, independent of the closed form: the signed distance to the capsule,
 * f(t) = |p(t) - nearest point on the axis segment| - radius, is convex along a ray. A dense
 * sample brackets its minimum, golden-section search refines it, and bisection finds the
 * first surface crossing at t >= 0 (the exit when the ray starts strictly inside).
 */
function referenceDistance(capsule: Capsule, origin: Vector3, direction: Vector3): number | null {
  const rotation = new Quaternion().setFromEuler(new Euler(...capsule.rotation, 'YXZ'))
  const centre = new Vector3(...capsule.position)
  const axis = new Vector3(0, 1, 0).applyQuaternion(rotation)
  const half = capsule.height / 2
  const point = new Vector3()
  const f = (t: number) => {
    point.copy(direction).multiplyScalar(t).add(origin).sub(centre)
    const along = Math.max(-half, Math.min(half, point.dot(axis)))
    return point.sub(axis.clone().multiplyScalar(along)).length() - capsule.radius
  }
  const span = 60
  const samples = 6000
  let best = 0
  let bestValue = f(0)
  for (let index = 1; index <= samples; index++) {
    const value = f(index * span / samples)
    if (value < bestValue) {
      best = index
      bestValue = value
    }
  }
  let low = Math.max(0, (best - 1) * span / samples)
  let high = Math.min(span, (best + 1) * span / samples)
  const golden = (Math.sqrt(5) - 1) / 2
  for (let step = 0; step < 200; step++) {
    const a = high - golden * (high - low)
    const b = low + golden * (high - low)
    if (f(a) < f(b))
      high = b
    else
      low = a
  }
  const tMin = (low + high) / 2
  const fMin = Math.min(f(tMin), bestValue)
  const start = f(0)
  const bisect = (inside: number, outside: number) => {
    for (let step = 0; step < 200; step++) {
      const mid = (inside + outside) / 2
      if (f(mid) <= 0)
        inside = mid
      else
        outside = mid
    }
    return (inside + outside) / 2
  }
  if (start < 0)
    return bisect(0, span)
  if (start === 0)
    return 0
  if (fMin > 1e-9)
    return null
  if (fMin > 0)
    return tMin
  return bisect(tMin, 0)
}

describe('mmd touch capsule entry: brute-force property', () => {
  const random = mulberry32(0x17C4B5)
  const range = (min: number, max: number) => min + (max - min) * random()
  const logRange = (min: number, max: number) => Math.exp(range(Math.log(min), Math.log(max)))
  const unitVector = () => {
    const z = range(-1, 1)
    const angle = range(0, 2 * Math.PI)
    const s = Math.sqrt(1 - z * z)
    return new Vector3(s * Math.cos(angle), s * Math.sin(angle), z)
  }
  const randomCapsule = (height = random() < 0.2 ? 0 : range(0.1, 3)): Capsule => ({
    radius: range(0.2, 2),
    height,
    position: [range(-2, 2), range(-2, 2), range(-2, 2)],
    rotation: [range(-Math.PI, Math.PI), range(-Math.PI, Math.PI), range(-Math.PI, Math.PI)],
  })
  const frame = (capsule: Capsule) => {
    const rotation = new Quaternion().setFromEuler(new Euler(...capsule.rotation, 'YXZ'))
    const axis = new Vector3(0, 1, 0).applyQuaternion(rotation)
    const perpendicular = new Vector3(1, 0, 0).applyQuaternion(rotation)
    const centre = new Vector3(...capsule.position)
    return { axis, perpendicular, binormal: axis.clone().cross(perpendicular), centre }
  }
  const tilt = (axis: Vector3, perpendicular: Vector3, angle: number) =>
    axis.clone().multiplyScalar(Math.cos(angle)).add(perpendicular.clone().multiplyScalar(Math.sin(angle))).normalize()

  interface Case { kind: string, capsule: Capsule, origin: Vector3, direction: Vector3 }
  const cases: Case[] = []
  // General rays aimed near the capsule, so hits and misses both occur.
  for (let index = 0; index < 220; index++) {
    const capsule = randomCapsule()
    const { axis, centre } = frame(capsule)
    const target = centre.clone().add(axis.clone().multiplyScalar(range(-0.5, 0.5) * capsule.height)).add(unitVector().multiplyScalar(range(0, 1.6) * capsule.radius))
    const origin = centre.clone().add(unitVector().multiplyScalar(range(4, 9)))
    cases.push({ kind: 'general', capsule, origin, direction: target.sub(origin).normalize() })
  }
  // Height 0: the capsule is a sphere.
  for (let index = 0; index < 80; index++) {
    const capsule = randomCapsule(0)
    const { centre } = frame(capsule)
    const target = centre.clone().add(unitVector().multiplyScalar(range(0, 1.5) * capsule.radius))
    const origin = centre.clone().add(unitVector().multiplyScalar(range(3, 8)))
    cases.push({ kind: 'height-0', capsule, origin, direction: target.sub(origin).normalize() })
  }
  // Near-axis directions entering through a cap: angle to the axis below 1e-3.
  for (let index = 0; index < 50; index++) {
    const capsule = randomCapsule(random() < 0.2 ? 0 : range(0.1, 3))
    const { axis, perpendicular, binormal, centre } = frame(capsule)
    const side = random() < 0.5 ? 1 : -1
    const radial = perpendicular.clone().multiplyScalar(range(-1.2, 1.2) * capsule.radius).add(binormal.clone().multiplyScalar(range(-1.2, 1.2) * capsule.radius))
    const origin = centre.clone().add(axis.clone().multiplyScalar(side * (capsule.height / 2 + capsule.radius + range(0.5, 3)))).add(radial)
    cases.push({ kind: 'near-axis-cap', capsule, origin, direction: tilt(axis.clone().multiplyScalar(-side), perpendicular, logRange(1e-9, 1e-3) * (random() < 0.5 ? 1 : -1)) })
  }
  // Near-axis directions just outside the side, drifting inward: the reviewer's side-entry class.
  for (let index = 0; index < 80; index++) {
    const capsule = randomCapsule(range(0.5, 3))
    const { axis, perpendicular, centre } = frame(capsule)
    const gap = logRange(1e-10, 1e-4)
    const origin = centre.clone().add(perpendicular.clone().multiplyScalar(capsule.radius + gap)).add(axis.clone().multiplyScalar(range(-0.45, 0.2) * capsule.height))
    cases.push({ kind: 'near-axis-side', capsule, origin, direction: tilt(axis, perpendicular, -logRange(Math.max(1e-9, gap / capsule.height * 4), 1e-3)) })
  }
  // Exactly axis-parallel rays, inside and outside the radius.
  for (let index = 0; index < 20; index++) {
    const capsule = randomCapsule()
    const { axis, perpendicular, centre } = frame(capsule)
    const origin = centre.clone().add(perpendicular.clone().multiplyScalar(range(0, 1.5) * capsule.radius)).add(axis.clone().multiplyScalar(capsule.height / 2 + capsule.radius + 2))
    cases.push({ kind: 'axis-parallel', capsule, origin, direction: axis.clone().negate() })
  }
  // Starts strictly inside.
  for (let index = 0; index < 60; index++) {
    const capsule = randomCapsule()
    const { axis, centre } = frame(capsule)
    const origin = centre.clone().add(axis.clone().multiplyScalar(range(-0.5, 0.5) * capsule.height)).add(unitVector().multiplyScalar(range(0, 0.95) * capsule.radius))
    cases.push({ kind: 'inside', capsule, origin, direction: unitVector() })
  }

  it('agrees with the reference on hit or miss and on distance for 510 seeded rays', () => {
    const mismatches: string[] = []
    const kinds = new Map<string, { total: number, hits: number }>()
    for (const { kind, capsule, origin, direction } of cases) {
      const [collider] = colliders([{ name: 'capsule', region: 'body', type: CAPSULE, size: [capsule.radius, capsule.height, 0], position: capsule.position, rotation: capsule.rotation }])
      const actual = raycastMMDTouchColliders(new Ray(origin.clone(), direction.clone()), [collider], identity)?.distance ?? null
      const expected = referenceDistance(capsule, origin, direction)
      const tally = kinds.get(kind) ?? { total: 0, hits: 0 }
      tally.total++
      if (expected !== null)
        tally.hits++
      kinds.set(kind, tally)
      if ((actual === null) !== (expected === null) || (actual !== null && expected !== null && Math.abs(actual - expected) > 1e-4))
        mismatches.push(`${kind}: expected ${expected}, got ${actual} (r ${capsule.radius.toFixed(3)}, h ${capsule.height.toFixed(3)})`)
    }
    expect(cases.length).toBeGreaterThanOrEqual(500)
    // Every class must exercise both outcomes it can produce, or the comparison proves little.
    expect(kinds.get('general')!.hits).toBeGreaterThan(50)
    expect(kinds.get('general')!.hits).toBeLessThan(kinds.get('general')!.total)
    expect(kinds.get('near-axis-side')!.hits).toBeGreaterThan(40)
    expect(mismatches).toEqual([])
  })

  it('hits rays tangent to the side and to a cap at the tangent point', () => {
    for (const radius of [0.25, 0.5, 1, 1.5, 2]) {
      for (const height of [0, 1, 2, 3]) {
        const [collider] = colliders([{ name: 'capsule', region: 'body', type: CAPSULE, size: [radius, height, 0] }])
        const capTangent = raycastMMDTouchColliders(new Ray(new Vector3(-10, height / 2 + radius, 0), new Vector3(1, 0, 0)), [collider], identity)
        expect(capTangent?.distance).toBe(10)
        expect(referenceDistance({ radius, height, position: [0, 0, 0], rotation: [0, 0, 0] }, new Vector3(-10, height / 2 + radius, 0), new Vector3(1, 0, 0))).toBeCloseTo(10, 4)
        if (height === 0)
          continue
        const sideTangent = raycastMMDTouchColliders(new Ray(new Vector3(radius, height / 4, -10), new Vector3(0, 0, 1)), [collider], identity)
        expect(sideTangent?.distance).toBe(10)
        expect(referenceDistance({ radius, height, position: [0, 0, 0], rotation: [0, 0, 0] }, new Vector3(radius, height / 4, -10), new Vector3(0, 0, 1))).toBeCloseTo(10, 4)
      }
    }
  })
})
