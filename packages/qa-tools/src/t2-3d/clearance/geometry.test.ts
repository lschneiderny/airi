import { describe, expect, it } from 'vitest'

import { segmentCrossing, segmentDistance, skinVertices } from './geometry'

describe('segmentCrossing', () => {
  const triangle = Float64Array.from([0, 0, 0, 2, 0, 0, 0, 0, 2])

  it('returns the share of the segment before it crosses the triangle', () => {
    expect(segmentCrossing([0.5, 1, 0.5], [0.5, -3, 0.5], triangle, 0, 3, 6)).toBeCloseTo(0.25, 12)
  })

  it('rejects a crossing behind the start of the segment', () => {
    expect(segmentCrossing([0.5, 1, 0.5], [0.5, 3, 0.5], triangle, 0, 3, 6)).toBeNull()
  })

  it('misses beside the triangle, short of it, and along its plane', () => {
    expect(segmentCrossing([1.5, 1, 1.5], [1.5, -1, 1.5], triangle, 0, 3, 6)).toBeNull()
    expect(segmentCrossing([0.5, 3, 0.5], [0.5, 1, 0.5], triangle, 0, 3, 6)).toBeNull()
    expect(segmentCrossing([0.1, 0, 0.1], [1, 0, 0.5], triangle, 0, 3, 6)).toBeNull()
  })
})

describe('segmentDistance', () => {
  it('measures to the nearest point of the segment, ends included', () => {
    expect(segmentDistance([1, 2, 0], [0, 0, 0], [2, 0, 0])).toBe(2)
    expect(segmentDistance([5, 0, 0], [0, 0, 0], [2, 0, 0])).toBe(3)
    expect(segmentDistance([3, 4, 0], [0, 0, 0], [0, 0, 0])).toBe(5)
  })
})

describe('skinVertices', () => {
  it('applies column-major rotation and includes the fourth bone weight', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const quarterTurn = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const out = new Float64Array(3)
    skinVertices(Float64Array.of(2, 4, 0), Uint16Array.of(0, 0, 0, 1), Float32Array.of(0.25, 0.25, 0.25, 0.25), Float64Array.from([...identity, ...quarterTurn]), out)
    expect([...out]).toEqual([0.5, 3.5, 0])
  })

  it('blends each vertex through its bones\' matrices by weight', () => {
    const translate = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]
    const matrices = Float64Array.from([...translate(0, 0, 0), ...translate(2, 0, 0), ...translate(0, 4, 0)])
    const out = new Float64Array(6)
    skinVertices(Float64Array.from([1, 1, 1, 0, 0, 0]), Uint16Array.from([1, 0, 0, 0, 1, 2, 0, 0]), Float32Array.from([1, 0, 0, 0, 0.5, 0.5, 0, 0]), matrices, out)
    expect([...out]).toEqual([3, 1, 1, 1, 2, 0])
  })
})
