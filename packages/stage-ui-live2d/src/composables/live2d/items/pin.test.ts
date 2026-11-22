import type { FakeDrawable } from './mesh-source-fixture'
import type { Live2DItemPin } from './pin'

import { describe, expect, it } from 'vitest'

import { canvasToUnits, fakeCanvasScale, fakeMeshSource } from './mesh-source-fixture'
import { live2DUnitToCanvasX, live2DUnitToCanvasY, pickLive2DItemPin, resolveLive2DItemPin } from './pin'

const none: ReadonlySet<number> = new Set()

/** A square from two triangles, in canvas units. */
function square(left: number, top: number, size: number) {
  return canvasToUnits([left, top, left + size, top, left + size, top + size, left, top + size])
}
const squareIndices = [0, 1, 2, 0, 2, 3]

/** The pin's point on the current mesh, in canvas units. */
function pinnedPoint(pin: Live2DItemPin, positions: readonly number[]) {
  let x = 0
  let y = 0
  for (let corner = 0; corner < 3; corner++) {
    x += pin.weights[corner] * live2DUnitToCanvasX(positions[pin.vertices[corner] * 2], fakeCanvasScale)
    y += pin.weights[corner] * live2DUnitToCanvasY(positions[pin.vertices[corner] * 2 + 1], fakeCanvasScale)
  }
  return { x, y }
}

describe('live2D canvas units', () => {
  it('converts Cubism units as Cubism4InternalModel.getDrawableVertices does', () => {
    expect(live2DUnitToCanvasX(0.5, fakeCanvasScale)).toBe(250)
    expect(live2DUnitToCanvasY(0.5, fakeCanvasScale)).toBe(150)
  })
})

describe('pickLive2DItemPin', () => {
  it('round-trips the picked point through its barycentric weights', () => {
    const positions = square(100, 100, 200)
    const source = fakeMeshSource([{ id: 'Body', positions, indices: squareIndices, order: 0 }])

    const pin = pickLive2DItemPin({ x: 150, y: 250 }, source, fakeCanvasScale, none)!

    expect(pin.drawableId).toBe('Body')
    expect(pin.vertexCount).toBe(4)
    expect(pin.modelPoint).toEqual({ x: 150, y: 250 })
    expect(pin.weights[0] + pin.weights[1] + pin.weights[2]).toBeCloseTo(1, 12)
    for (const weight of pin.weights)
      expect(weight).toBeGreaterThanOrEqual(0)
    const point = pinnedPoint(pin, positions)
    expect(point.x).toBeCloseTo(150, 9)
    expect(point.y).toBeCloseTo(250, 9)
    const fromReference = {
      x: pin.weights[0] * pin.reference[0] + pin.weights[1] * pin.reference[2] + pin.weights[2] * pin.reference[4],
      y: pin.weights[0] * pin.reference[1] + pin.weights[1] * pin.reference[3] + pin.weights[2] * pin.reference[5],
    }
    expect(fromReference.x).toBeCloseTo(150, 9)
    expect(fromReference.y).toBeCloseTo(250, 9)
  })

  it('takes the drawable on top of the render order, whatever its index', () => {
    const drawables = [
      { id: 'Front', positions: square(100, 100, 200), indices: squareIndices, order: 1 },
      { id: 'Back', positions: square(100, 100, 200), indices: squareIndices, order: 0 },
    ]
    const source = fakeMeshSource(drawables)

    expect(pickLive2DItemPin({ x: 200, y: 200 }, source, fakeCanvasScale, none)?.drawableId).toBe('Front')
    drawables[0].order = 0
    drawables[1].order = 1
    expect(pickLive2DItemPin({ x: 200, y: 200 }, source, fakeCanvasScale, none)?.drawableId).toBe('Back')
  })

  it('skips hidden, transparent, and excluded drawables', () => {
    const drawables = [
      { id: 'Hidden', positions: square(100, 100, 200), indices: squareIndices, order: 4, visible: false },
      { id: 'Faint', positions: square(100, 100, 200), indices: squareIndices, order: 3, opacity: 0.009 },
      { id: 'HitArea', positions: square(100, 100, 200), indices: squareIndices, order: 2 },
      { id: 'Body', positions: square(100, 100, 200), indices: squareIndices, order: 1 },
    ]
    const source = fakeMeshSource(drawables)

    expect(pickLive2DItemPin({ x: 200, y: 200 }, source, fakeCanvasScale, new Set([2]))?.drawableId).toBe('Body')
    expect(pickLive2DItemPin({ x: 200, y: 200 }, source, fakeCanvasScale, new Set([2, 3]))).toBeUndefined()
    drawables[1].opacity = 0.01
    expect(pickLive2DItemPin({ x: 200, y: 200 }, source, fakeCanvasScale, new Set([2]))?.drawableId).toBe('Faint')
  })

  it('misses a point inside the bounds but outside every triangle', () => {
    // The lower-left half of the square only.
    const source = fakeMeshSource([{ id: 'Half', positions: square(100, 100, 200), indices: [0, 2, 3], order: 0 }])

    expect(pickLive2DItemPin({ x: 280, y: 120 }, source, fakeCanvasScale, none)).toBeUndefined()
    expect(pickLive2DItemPin({ x: 500, y: 500 }, source, fakeCanvasScale, none)).toBeUndefined()
  })

  it('skips collapsed and sliver triangles and falls through to the drawable below', () => {
    const sliverAndBody = canvasToUnits([
      // A large triangle away from the point.
      0,
      0,
      100,
      0,
      0,
      100,
      // A sliver around (200, 200): 1e-4 of the large triangle's area.
      190,
      199.9995,
      210,
      199.9995,
      200,
      200.0015,
    ])
    const source = fakeMeshSource([
      { id: 'Collapsed', positions: canvasToUnits([200, 200, 200, 200, 200, 200]), indices: [0, 1, 2], order: 3 },
      { id: 'Collinear', positions: canvasToUnits([150, 150, 250, 250, 300, 300]), indices: [0, 1, 2], order: 2 },
      { id: 'Sliver', positions: sliverAndBody, indices: [0, 1, 2, 3, 4, 5], order: 1 },
      { id: 'Body', positions: square(100, 100, 200), indices: squareIndices, order: 0 },
    ])

    const pin = pickLive2DItemPin({ x: 200, y: 200 }, source, fakeCanvasScale, none)

    expect(pin?.drawableId).toBe('Body')
    for (const weight of pin!.weights)
      expect(Number.isFinite(weight)).toBe(true)
  })

  it('returns nothing for a drawable with no area or with unreadable vertices', () => {
    const source = fakeMeshSource([
      { id: 'Point', positions: canvasToUnits([200, 200, 200, 200, 200, 200]), indices: [0, 1, 2], order: 2 },
      { id: 'Broken', positions: [Number.NaN, 0, 1, 0, 0, 1], indices: [0, 1, 2], order: 1 },
      { id: 'OutOfRange', positions: square(100, 100, 200), indices: [0, 1, 9], order: 0 },
    ])

    expect(pickLive2DItemPin({ x: 200, y: 200 }, source, fakeCanvasScale, none)).toBeUndefined()
  })
})

describe('resolveLive2DItemPin', () => {
  function pinnedSource() {
    const drawables: FakeDrawable[] = [
      { id: 'Hat', positions: square(150, 50, 100), indices: squareIndices, order: 1 },
      { id: 'Body', positions: square(100, 100, 200), indices: squareIndices, order: 0 },
    ]
    const source = fakeMeshSource(drawables)
    const pin = pickLive2DItemPin({ x: 200, y: 120 }, source, fakeCanvasScale, none)!
    return { drawables, source, pin }
  }

  it('attaches a pin whose drawable and vertex count are unchanged', () => {
    const { source, pin } = pinnedSource()

    expect(resolveLive2DItemPin(pin, source, fakeCanvasScale)).toEqual({ state: 'attached', index: 0, pin })
  })

  it('re-picks inside the same drawable when its vertex count changed, leaving the stored pin as it was', () => {
    const { drawables, source, pin } = pinnedSource()
    const stored = structuredClone(pin)
    // The hat gains a center vertex and becomes four triangles.
    drawables[0].positions = [...square(150, 50, 100), ...canvasToUnits([200, 100])]
    drawables[0].indices = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4]

    const resolved = resolveLive2DItemPin(pin, source, fakeCanvasScale)

    expect(resolved.state).toBe('reattached')
    if (resolved.state !== 'reattached')
      return
    expect(resolved.index).toBe(0)
    expect(resolved.pin.drawableId).toBe('Hat')
    expect(resolved.pin.vertexCount).toBe(5)
    expect(resolved.pin.modelPoint).toEqual({ x: 200, y: 120 })
    const point = pinnedPoint(resolved.pin, drawables[0].positions)
    expect(point.x).toBeCloseTo(200, 9)
    expect(point.y).toBeCloseTo(120, 9)
    expect(pin).toEqual(stored)
  })

  it('re-picks a stored pin whose vertex indices exceed the drawable', () => {
    const { source, pin } = pinnedSource()

    const resolved = resolveLive2DItemPin({ ...pin, vertices: [0, 1, 7] }, source, fakeCanvasScale)

    expect(resolved.state).toBe('reattached')
  })

  it('re-picks across the model when the drawable id is gone', () => {
    const { drawables, source, pin } = pinnedSource()
    drawables[0].id = 'RenamedHat'

    const resolved = resolveLive2DItemPin(pin, source, fakeCanvasScale)

    expect(resolved).toMatchObject({ state: 'reattached', index: 0, pin: { drawableId: 'RenamedHat' } })
  })

  it('reports a missing drawable when nothing covers the pinned point', () => {
    const { drawables, source, pin } = pinnedSource()
    drawables[0].id = 'RenamedHat'
    drawables[0].visible = false
    drawables[1].positions = square(300, 300, 50)

    expect(resolveLive2DItemPin(pin, source, fakeCanvasScale)).toEqual({ state: 'missing-drawable' })
  })
})
