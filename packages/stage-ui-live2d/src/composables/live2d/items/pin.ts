/** A point in model canvas units: the model's own pixels, origin top left, y down. */
export interface Live2DCanvasPoint {
  x: number
  y: number
}

/**
 * What pinning reads from a Cubism core model.
 *
 * The core model satisfies it structurally. `getDrawableVertexPositions` returns
 * the core's own buffer in Cubism units, so reading it allocates nothing, unlike
 * `internalModel.getDrawableVertices`, which copies and converts on every call.
 */
export interface Live2DMeshSource {
  getDrawableCount: () => number
  getDrawableId: (index: number) => string
  /** The drawable's index, or -1 when the model has no drawable with this id. */
  getDrawableIndex: (id: string) => number
  getDrawableVertexCount: (index: number) => number
  /** x, y pairs in Cubism units, y up. */
  getDrawableVertexPositions: (index: number) => ArrayLike<number>
  /** Three vertex indices per triangle. */
  getDrawableVertexIndices: (index: number) => ArrayLike<number>
  /** The draw position of each drawable, indexed by drawable. Higher draws later, on top. */
  getDrawableRenderOrders: () => ArrayLike<number>
  getDrawableOpacity: (index: number) => number
  getDrawableDynamicFlagIsVisible: (index: number) => boolean
}

/** The internal model's conversion from Cubism units to model canvas units. */
export interface Live2DCanvasScale {
  pixelsPerUnit: number
  originalWidth: number
  originalHeight: number
}

/**
 * Converts a Cubism x to model canvas units.
 *
 * Source: `Cubism4InternalModel.getDrawableVertices` in
 * node_modules/pixi-live2d-display/dist/cubism4.es.js.
 */
export function live2DUnitToCanvasX(x: number, scale: Live2DCanvasScale): number {
  return x * scale.pixelsPerUnit + scale.originalWidth / 2
}

/** Converts a Cubism y, which points up, to model canvas units, which point down. */
export function live2DUnitToCanvasY(y: number, scale: Live2DCanvasScale): number {
  return -y * scale.pixelsPerUnit + scale.originalHeight / 2
}

/**
 * An item's attachment to one triangle of a drawable, in the VTube Studio shape.
 *
 * The weights place the point inside the triangle, so it follows every
 * deformation of the mesh. `reference` is the triangle (a, b, c as x, y pairs in
 * model canvas units) when the pin was made; the pose solver compares the
 * current triangle with it to find the rotation and scale the mesh applied.
 * `vertexCount` detects a changed mesh, and `modelPoint` is where the pin was
 * made, for re-picking and as the fallback position.
 */
export interface Live2DItemPin {
  drawableId: string
  vertices: readonly [number, number, number]
  weights: readonly [number, number, number]
  reference: readonly [number, number, number, number, number, number]
  vertexCount: number
  modelPoint: Live2DCanvasPoint
}

/**
 * Where a stored pin attaches on the loaded model.
 *
 * `reattached` carries a new pin, re-picked at the stored pin's `modelPoint`,
 * which lives only in memory until the user pins again.
 */
export type Live2DItemPinResolution
  = | { state: 'attached', index: number, pin: Live2DItemPin }
    | { state: 'reattached', index: number, pin: Live2DItemPin }
    | { state: 'missing-drawable' }

/** Below this opacity a drawable reads as invisible, as the head tracker's bounds read it. */
const minimumOpacity = 0.01

/**
 * Triangles smaller than this share of their drawable's mean triangle area are skipped.
 *
 * A deformer can squeeze a triangle to a sliver. Its barycentric weights are
 * then dominated by rounding, and a pin on it would jump as soon as it unfolds.
 */
const degenerateTriangleShare = 1e-3

/** Rounding slack for a point on a triangle edge, as a barycentric weight. */
const edgeTolerance = 1e-9

const noExclusions: ReadonlySet<number> = new Set()

/** Pins a point to the first usable triangle of one drawable that contains it. */
function pickInDrawable(point: Live2DCanvasPoint, source: Live2DMeshSource, scale: Live2DCanvasScale, index: number): Live2DItemPin | undefined {
  const positions = source.getDrawableVertexPositions(index)
  const indices = source.getDrawableVertexIndices(index)
  const vertexCount = source.getDrawableVertexCount(index)
  if (vertexCount < 3 || indices.length < 3)
    return undefined

  let left = Infinity
  let right = -Infinity
  let top = Infinity
  let bottom = -Infinity
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const x = live2DUnitToCanvasX(positions[vertex * 2], scale)
    const y = live2DUnitToCanvasY(positions[vertex * 2 + 1], scale)
    left = Math.min(left, x)
    right = Math.max(right, x)
    top = Math.min(top, y)
    bottom = Math.max(bottom, y)
  }
  if (!(point.x >= left) || !(point.x <= right) || !(point.y >= top) || !(point.y <= bottom))
    return undefined

  const triangleCount = Math.floor(indices.length / 3)
  const corner = (triangle: number, at: number) => indices[triangle * 3 + at]
  const cornerX = (triangle: number, at: number) => live2DUnitToCanvasX(positions[corner(triangle, at) * 2], scale)
  const cornerY = (triangle: number, at: number) => live2DUnitToCanvasY(positions[corner(triangle, at) * 2 + 1], scale)
  const valid = (triangle: number) => corner(triangle, 0) < vertexCount && corner(triangle, 1) < vertexCount && corner(triangle, 2) < vertexCount

  // Twice the signed area of each triangle: (b - a) x (c - a).
  const doubleArea = (triangle: number) => {
    const ax = cornerX(triangle, 0)
    const ay = cornerY(triangle, 0)
    return (cornerX(triangle, 1) - ax) * (cornerY(triangle, 2) - ay) - (cornerY(triangle, 1) - ay) * (cornerX(triangle, 2) - ax)
  }

  let totalArea = 0
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    if (valid(triangle))
      totalArea += Math.abs(doubleArea(triangle))
  }
  const minimumArea = totalArea / triangleCount * degenerateTriangleShare

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    if (!valid(triangle))
      continue
    const area = doubleArea(triangle)
    // Written as a negated comparison so a NaN area, from unreadable vertices, is skipped too.
    if (!(Math.abs(area) > minimumArea))
      continue

    const ax = cornerX(triangle, 0)
    const ay = cornerY(triangle, 0)
    const bx = cornerX(triangle, 1)
    const by = cornerY(triangle, 1)
    const cx = cornerX(triangle, 2)
    const cy = cornerY(triangle, 2)
    // Each weight is the area of the triangle the point forms with the opposite edge, over the whole.
    const wa = ((bx - point.x) * (cy - point.y) - (by - point.y) * (cx - point.x)) / area
    const wb = ((cx - point.x) * (ay - point.y) - (cy - point.y) * (ax - point.x)) / area
    const wc = 1 - wa - wb
    if (!(wa >= -edgeTolerance) || !(wb >= -edgeTolerance) || !(wc >= -edgeTolerance))
      continue

    // A point on an edge can come out a rounding error below zero. Stored weights must be non-negative and sum to 1.
    const clampedA = Math.max(0, wa)
    const clampedB = Math.max(0, wb)
    const clampedC = Math.max(0, wc)
    const sum = clampedA + clampedB + clampedC
    return {
      drawableId: source.getDrawableId(index),
      vertices: [corner(triangle, 0), corner(triangle, 1), corner(triangle, 2)],
      weights: [clampedA / sum, clampedB / sum, clampedC / sum],
      reference: [ax, ay, bx, by, cx, cy],
      vertexCount,
      modelPoint: { x: point.x, y: point.y },
    }
  }
  return undefined
}

function pickTopmost(point: Live2DCanvasPoint, source: Live2DMeshSource, scale: Live2DCanvasScale, excluded: ReadonlySet<number>) {
  const orders = source.getDrawableRenderOrders()
  const byOrderFromTop = Array.from({ length: source.getDrawableCount() }, (_, index) => index)
    .sort((left, right) => orders[right] - orders[left])

  for (const index of byOrderFromTop) {
    if (excluded.has(index) || !source.getDrawableDynamicFlagIsVisible(index) || source.getDrawableOpacity(index) < minimumOpacity)
      continue
    const pin = pickInDrawable(point, source, scale, index)
    if (pin)
      return { index, pin }
  }
  return undefined
}

/**
 * Pins a model canvas point to the topmost visible drawable under it.
 *
 * Drawables are walked from the top of the current render order down, so the
 * pin lands on what the user sees at the point. `excluded` holds drawable
 * indices to pass through, such as the model's invisible hit-area meshes.
 * Returns `undefined` when no visible triangle contains the point.
 */
export function pickLive2DItemPin(point: Live2DCanvasPoint, source: Live2DMeshSource, scale: Live2DCanvasScale, excluded: ReadonlySet<number>): Live2DItemPin | undefined {
  return pickTopmost(point, source, scale, excluded)?.pin
}

/**
 * Attaches a stored pin to the loaded model, once per model load.
 *
 * A drawable with the stored id and vertex count is the same mesh, so the pin
 * attaches as stored. Another vertex count means the model file changed: the
 * pin is re-picked at its `modelPoint` inside that drawable first, then across
 * the model. Nothing under the point reports `missing-drawable`. The stored pin
 * is never changed; persisting a re-picked pin is the user's choice.
 */
export function resolveLive2DItemPin(pin: Live2DItemPin, source: Live2DMeshSource, scale: Live2DCanvasScale): Live2DItemPinResolution {
  const index = source.getDrawableIndex(pin.drawableId)
  if (index >= 0 && index < source.getDrawableCount()) {
    const vertexCount = source.getDrawableVertexCount(index)
    // A stored pin is outside data: its indices must exist in the mesh it names.
    if (vertexCount === pin.vertexCount && pin.vertices.every(vertex => vertex < vertexCount))
      return { state: 'attached', index, pin }

    const repinned = pickInDrawable(pin.modelPoint, source, scale, index)
    if (repinned)
      return { state: 'reattached', index, pin: repinned }
  }

  const picked = pickTopmost(pin.modelPoint, source, scale, noExclusions)
  return picked ? { state: 'reattached', ...picked } : { state: 'missing-drawable' }
}
