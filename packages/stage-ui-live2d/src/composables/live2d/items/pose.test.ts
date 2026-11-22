import type { FakeDrawable } from './mesh-source-fixture'
import type { Live2DItemPinResolution } from './pin'
import type { Live2DItemPlacement } from './pose'

import { describe, expect, it } from 'vitest'

import { canvasToUnits, fakeCanvasScale, fakeMeshSource } from './mesh-source-fixture'
import { pickLive2DItemPin, resolveLive2DItemPin } from './pin'
import { solveLive2DItemPose } from './pose'

/** The pinned triangle, in canvas units: a right triangle with its corner at (100, 100). */
const triangle = [100, 100, 200, 100, 100, 200]
const pinPoint = { x: 130, y: 120 }

/** Applies a canvas-space linear map about the triangle's first corner, then a translation. */
function transformed(map: { a: number, b: number, c: number, d: number }, shiftX = 0, shiftY = 0) {
  const result: number[] = []
  for (let at = 0; at < triangle.length; at += 2) {
    const x = triangle[at] - 100
    const y = triangle[at + 1] - 100
    result.push(100 + shiftX + map.a * x + map.b * y, 100 + shiftY + map.c * x + map.d * y)
  }
  return result
}

function rotation(radians: number, scale = 1) {
  return { a: scale * Math.cos(radians), b: -scale * Math.sin(radians), c: scale * Math.sin(radians), d: scale * Math.cos(radians) }
}

function pinnedSetup(placement: Partial<Live2DItemPlacement> = {}) {
  const drawable: FakeDrawable = { id: 'Head', positions: canvasToUnits(triangle), indices: [0, 1, 2], order: 0 }
  const source = fakeMeshSource([drawable])
  const pin = pickLive2DItemPin(pinPoint, source, fakeCanvasScale, new Set())!
  const resolved = resolveLive2DItemPin(pin, source, fakeCanvasScale)
  const fullPlacement: Live2DItemPlacement = { x: 0, y: 0, rotation: 0.1, scale: 1.5, pin, ...placement }
  /** Moves the drawable's vertices to a canvas-space triangle. */
  const deform = (canvas: number[]) => void (drawable.positions = canvasToUnits(canvas))
  const solve = (previous?: { rotation: number, scale: number }) => solveLive2DItemPose(fullPlacement, resolved, source, fakeCanvasScale, previous)
  return { drawable, source, pin, resolved, solve, deform }
}

describe('solveLive2DItemPose', () => {
  it('returns the placement itself for an unpinned item', () => {
    const source = fakeMeshSource([])

    expect(solveLive2DItemPose({ x: 40, y: 50, rotation: 0.3, scale: 2 }, undefined, source, fakeCanvasScale))
      .toEqual({ x: 40, y: 50, rotation: 0.3, scale: 2, alpha: 1, visible: true, held: false })
  })

  it('places a pinned item at its pin point on the unchanged mesh', () => {
    const { solve } = pinnedSetup()

    const pose = solve()

    expect(pose.x).toBeCloseTo(130, 9)
    expect(pose.y).toBeCloseTo(120, 9)
    expect(pose.rotation).toBeCloseTo(0.1, 12)
    expect(pose.scale).toBeCloseTo(1.5, 12)
    expect(pose.held).toBe(false)
  })

  it('recovers a 30 degree rotation and a 2x scale, and follows the barycentric point', () => {
    const { solve, deform } = pinnedSetup()
    const map = rotation(Math.PI / 6, 2)
    deform(transformed(map, 15, -40))

    const pose = solve()

    expect(pose.rotation - 0.1).toBeCloseTo(Math.PI / 6, 6)
    expect(Math.abs(pose.rotation - 0.1 - Math.PI / 6)).toBeLessThan(1e-6)
    expect(Math.abs(pose.scale - 3)).toBeLessThan(1e-6)
    expect(pose.x).toBeCloseTo(100 + 15 + map.a * 30 + map.b * 20, 9)
    expect(pose.y).toBeCloseTo(100 - 40 + map.c * 30 + map.d * 20, 9)
  })

  it('keeps the polar rotation under an anisotropic squash', () => {
    const { solve, deform } = pinnedSetup({ rotation: 0, scale: 1 })
    // R(30 degrees) applied after a squash to half length along the 45 degree diagonal:
    // Q(45) * diag(1, 0.5) * Q(45)^T = [[0.75, 0.25], [0.25, 0.75]]. An off-axis squash
    // tilts the edge columns, so only the polar rotation, not a column angle, reads 30 degrees.
    const turn = rotation(Math.PI / 6)
    deform(transformed({
      a: turn.a * 0.75 + turn.b * 0.25,
      b: turn.a * 0.25 + turn.b * 0.75,
      c: turn.c * 0.75 + turn.d * 0.25,
      d: turn.c * 0.25 + turn.d * 0.75,
    }))

    const pose = solve()

    expect(Math.abs(pose.rotation - Math.PI / 6)).toBeLessThan(1e-6)
    expect(Math.abs(pose.scale - Math.SQRT1_2)).toBeLessThan(1e-6)
  })

  it('holds the previous rotation and scale when the triangle folds over', () => {
    const { solve, deform } = pinnedSetup()
    // A mirror across the vertical axis reverses the winding.
    deform(transformed({ a: -1, b: 0, c: 0, d: 1 }))

    const held = solve({ rotation: 0.7, scale: 1.2 })

    expect(held).toMatchObject({ rotation: 0.7, scale: 1.2, held: true })
    expect(held.x).toBeCloseTo(70, 9)
    expect(held.y).toBeCloseTo(120, 9)
    expect(solve()).toMatchObject({ rotation: 0.1, scale: 1.5, held: true })
  })

  it('holds when the triangle collapses below 5 % of its reference area', () => {
    const { solve, deform } = pinnedSetup()

    deform(transformed({ a: 1, b: 0, c: 0, d: 0.049 }))
    expect(solve({ rotation: 0.4, scale: 2 })).toMatchObject({ rotation: 0.4, scale: 2, held: true })

    deform(transformed({ a: 1, b: 0, c: 0, d: 0.051 }))
    expect(solve({ rotation: 0.4, scale: 2 }).held).toBe(false)

    deform([150, 150, 150, 150, 150, 150])
    const collapsed = solve({ rotation: 0.4, scale: 2 })
    expect(collapsed).toMatchObject({ rotation: 0.4, scale: 2, held: true })
    expect(collapsed.x).toBeCloseTo(150, 9)
  })

  it('clamps the mesh scale factor to between 0.25 and 4', () => {
    const { solve, deform } = pinnedSetup({ scale: 1 })

    deform(transformed(rotation(0, 10)))
    expect(solve().scale).toBeCloseTo(4, 12)

    deform(transformed(rotation(0, 0.1)))
    expect(solve().held).toBe(true)
    deform(transformed(rotation(0, 0.23)))
    expect(solve().scale).toBeCloseTo(0.25, 12)
  })

  it('fades with the drawable only when asked to', () => {
    const faded = pinnedSetup({ fadeWithMesh: true })
    faded.drawable.opacity = 0.4
    expect(faded.solve()).toMatchObject({ alpha: 0.4, visible: true })
    faded.drawable.visible = false
    expect(faded.solve().visible).toBe(false)

    const solid = pinnedSetup()
    solid.drawable.opacity = 0.4
    solid.drawable.visible = false
    expect(solid.solve()).toMatchObject({ alpha: 1, visible: true })
  })

  it('stays at the stored model point when the drawable is missing', () => {
    const { pin } = pinnedSetup()
    const missing: Live2DItemPinResolution = { state: 'missing-drawable' }

    expect(solveLive2DItemPose({ x: 0, y: 0, rotation: 0.2, scale: 3, pin }, missing, fakeMeshSource([]), fakeCanvasScale))
      .toEqual({ x: 130, y: 120, rotation: 0.2, scale: 3, alpha: 1, visible: true, held: false })
  })
})
