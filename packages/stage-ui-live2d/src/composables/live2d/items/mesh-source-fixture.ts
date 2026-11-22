import type { Live2DCanvasScale, Live2DMeshSource } from './pin'

/** One drawable of a fake model: vertex positions in Cubism units, triangle indices, and its render order. */
export interface FakeDrawable {
  id: string
  positions: number[]
  indices: number[]
  order: number
  opacity?: number
  visible?: boolean
}

/** 100 canvas pixels per Cubism unit on a 400 x 400 canvas: unit (0, 0) is canvas (200, 200), and y flips. */
export const fakeCanvasScale: Live2DCanvasScale = Object.freeze({ pixelsPerUnit: 100, originalWidth: 400, originalHeight: 400 })

/** Converts canvas x, y pairs to Cubism units, so a test states a mesh in the space the item math answers in. */
export function canvasToUnits(points: readonly number[], scale: Live2DCanvasScale = fakeCanvasScale): number[] {
  return points.map((value, at) => at % 2 === 0
    ? (value - scale.originalWidth / 2) / scale.pixelsPerUnit
    : -(value - scale.originalHeight / 2) / scale.pixelsPerUnit)
}

/**
 * A mesh source over plain arrays. Tests replace `positions` to deform a drawable between reads.
 *
 * @example
 * fakeMeshSource([{ id: 'Head', positions: canvasToUnits([0, 0, 10, 0, 0, 10]), indices: [0, 1, 2], order: 0 }])
 */
export function fakeMeshSource(drawables: FakeDrawable[]): Live2DMeshSource {
  return {
    getDrawableCount: () => drawables.length,
    getDrawableId: index => drawables[index].id,
    getDrawableIndex: id => drawables.findIndex(drawable => drawable.id === id),
    getDrawableVertexCount: index => drawables[index].positions.length / 2,
    getDrawableVertexPositions: index => drawables[index].positions,
    getDrawableVertexIndices: index => drawables[index].indices,
    getDrawableRenderOrders: () => drawables.map(drawable => drawable.order),
    getDrawableOpacity: index => drawables[index].opacity ?? 1,
    getDrawableDynamicFlagIsVisible: index => drawables[index].visible ?? true,
  }
}
