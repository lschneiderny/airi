import { readFile } from 'node:fs/promises'

import { Quaternion, Vector3 } from 'three'

export type Vec3 = [number, number, number]
export type Quat = [number, number, number, number]
export type BvhChannel = 'Xposition' | 'Yposition' | 'Zposition' | 'Xrotation' | 'Yrotation' | 'Zrotation'

/** Source joint order, unrounded header time, and local rotations in listed channel order. */
export interface BvhClip {
  readonly names: readonly string[]
  readonly parents: readonly number[]
  readonly offsets: readonly Vec3[]
  readonly channels: readonly (readonly BvhChannel[])[]
  readonly frameTime: number
  readonly rotations: readonly (readonly Quat[])[]
  readonly rootPositions: readonly Vec3[]
}

export type ReferenceRefusalName = 'reference-bvh' | 'reference-missing-bone' | 'reference-hierarchy' | 'reference-rest-pose' | 'reference-rate' | 'reference-range' | 'reference-manifest'

export class ReferenceRefusal extends Error {
  constructor(override readonly name: ReferenceRefusalName, readonly detail: string) {
    super(`${name}: ${detail}`)
  }
}

const axes = {
  Xrotation: new Vector3(1, 0, 0),
  Yrotation: new Vector3(0, 1, 0),
  Zrotation: new Vector3(0, 0, 1),
} as const

/**
 * BVHLoader discards channel metadata and writes float32 key times. This parser
 * retains both exactly, including format-specific Euler order. End sites are
 * terminal offsets, not rotating joints, and therefore have no trace column.
 */
export function parseBvh(text: string): BvhClip {
  const tokens = text.match(/[{}]|[^\s{}]+/g) ?? []
  let cursor = 0
  const take = () => {
    if (cursor === tokens.length)
      throw new ReferenceRefusal('reference-bvh', 'Unexpected end of BVH')
    return tokens[cursor++]
  }
  const expect = (expected: string) => {
    const token = take()
    if (token !== expected)
      throw new ReferenceRefusal('reference-bvh', `Expected ${expected}, found ${token}`)
  }
  const number = () => {
    const value = Number(take())
    if (!Number.isFinite(value))
      throw new ReferenceRefusal('reference-bvh', 'Expected a finite number')
    return value
  }
  const integer = () => {
    const value = number()
    if (!Number.isInteger(value) || value < 0)
      throw new ReferenceRefusal('reference-bvh', 'Expected a nonnegative integer')
    return value
  }
  const vector = (): Vec3 => [number(), number(), number()]
  const names: string[] = []
  const parents: number[] = []
  const offsets: Vec3[] = []
  const channels: BvhChannel[][] = []
  const joint = (parent: number) => {
    const index = names.length
    const name = take()
    if (names.includes(name))
      throw new ReferenceRefusal('reference-bvh', `Duplicate joint ${name}`)
    names.push(name)
    parents.push(parent)
    expect('{')
    expect('OFFSET')
    offsets.push(vector())
    expect('CHANNELS')
    const count = integer()
    const order: BvhChannel[] = []
    for (let i = 0; i < count; i++) {
      const channel = take()
      if (channel !== 'Xposition' && channel !== 'Yposition' && channel !== 'Zposition'
        && channel !== 'Xrotation' && channel !== 'Yrotation' && channel !== 'Zrotation') {
        throw new ReferenceRefusal('reference-bvh', `Unknown channel ${channel} on ${name}`)
      }
      if (order.includes(channel) || (parent >= 0 && channel.endsWith('position')))
        throw new ReferenceRefusal('reference-bvh', `Unsupported channel ${channel} on ${name}`)
      order.push(channel)
    }
    channels.push(order)
    for (let token = take(); token !== '}'; token = take()) {
      if (token === 'JOINT') {
        joint(index)
      }
      else if (token === 'End') {
        expect('Site')
        expect('{')
        expect('OFFSET')
        vector()
        expect('}')
      }
      else {
        throw new ReferenceRefusal('reference-bvh', `Unexpected hierarchy token ${token}`)
      }
    }
  }
  expect('HIERARCHY')
  expect('ROOT')
  joint(-1)
  expect('MOTION')
  expect('Frames:')
  const frames = integer()
  expect('Frame')
  expect('Time:')
  const frameTime = number()
  if (frameTime <= 0 || frames === 0)
    throw new ReferenceRefusal('reference-bvh', 'Frame count and time must be positive')
  const rotations: Quat[][] = []
  const rootPositions: Vec3[] = []
  for (let f = 0; f < frames; f++) {
    const local: Quat[] = []
    const root: Vec3 = [...offsets[0]]
    for (const order of channels) {
      const q = new Quaternion()
      for (const channel of order) {
        const value = number()
        switch (channel) {
          case 'Xposition':
            root[0] += value
            break
          case 'Yposition':
            root[1] += value
            break
          case 'Zposition':
            root[2] += value
            break
          case 'Xrotation':
          case 'Yrotation':
          case 'Zrotation':
            q.multiply(new Quaternion().setFromAxisAngle(axes[channel], value * Math.PI / 180))
            break
        }
      }
      local.push(q.normalize().toArray())
    }
    rotations.push(local)
    rootPositions.push(root)
  }
  if (cursor !== tokens.length)
    throw new ReferenceRefusal('reference-bvh', 'Extra data after the declared frames')
  return { names, parents, offsets, channels, frameTime, rotations, rootPositions }
}

export async function readBvh(path: string): Promise<BvhClip> {
  return parseBvh(await readFile(path, 'utf8'))
}
