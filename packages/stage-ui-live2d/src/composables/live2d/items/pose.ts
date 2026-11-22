import type { Live2DCanvasScale, Live2DItemPin, Live2DItemPinResolution, Live2DMeshSource } from './pin'

import { live2DUnitToCanvasX, live2DUnitToCanvasY } from './pin'

/** The part of an item placement the pose reads. Positions are model canvas units, rotation is radians. */
export interface Live2DItemPlacement {
  x: number
  y: number
  rotation: number
  scale: number
  pin?: Live2DItemPin
  /** Multiplies the item's alpha by the pinned drawable's opacity, and hides it with the drawable. */
  fadeWithMesh?: boolean
}

/** Where an item draws this frame, in model canvas units. */
export interface Live2DItemPose {
  x: number
  y: number
  rotation: number
  scale: number
  alpha: number
  visible: boolean
  /** True when the pinned triangle folded or collapsed, so rotation and scale kept their previous values. */
  held: boolean
}

export type Live2DItemPoseSource = Pick<Live2DMeshSource, 'getDrawableVertexPositions' | 'getDrawableOpacity' | 'getDrawableDynamicFlagIsVisible'>

/** Bounds of the scale the mesh may apply, so a stretched or squeezed triangle cannot blow an item up or make it vanish. */
const minimumMeshScale = 0.25
const maximumMeshScale = 4

/**
 * Below this share of its reference area a triangle counts as collapsed.
 *
 * Rotation from a nearly flat triangle is mostly rounding, so the pose holds
 * instead of spinning while a deformer squeezes the mesh.
 */
const collapsedAreaShare = 0.05

/**
 * Solves where an item draws this frame, from its placement and the current mesh.
 *
 * An unpinned item draws at its placement. A pinned item sits at its pin's
 * barycentric point on the current vertices, so it follows the mesh in the
 * same frame. The mesh's rotation and scale come from the linear map `A` that
 * takes the reference triangle's edges onto the current ones:
 * `A = E_now * inverse(E_ref)` with `E = [b - a, c - a]`. The rotation of its
 * polar decomposition is `atan2(A10 - A01, A00 + A11)`, which a squash along
 * one axis leaves unchanged, and its scale is `sqrt(det A)`.
 *
 * A folded triangle (`det A <= 0`) or one under 5 % of its reference area keeps
 * `previous` rotation and scale, or the placement's without one, and reports
 * `held`. A pin whose drawable is missing draws at its stored model point.
 *
 * Runs every frame: it reads the core's vertex buffer in place and allocates
 * nothing but the returned pose.
 */
export function solveLive2DItemPose(
  placement: Live2DItemPlacement,
  resolved: Live2DItemPinResolution | undefined,
  source: Live2DItemPoseSource,
  scale: Live2DCanvasScale,
  previous?: Pick<Live2DItemPose, 'rotation' | 'scale'>,
): Live2DItemPose {
  if (!placement.pin || !resolved)
    return { x: placement.x, y: placement.y, rotation: placement.rotation, scale: placement.scale, alpha: 1, visible: true, held: false }

  if (resolved.state === 'missing-drawable') {
    const { modelPoint } = placement.pin
    return { x: modelPoint.x, y: modelPoint.y, rotation: placement.rotation, scale: placement.scale, alpha: 1, visible: true, held: false }
  }

  const { index, pin } = resolved
  const positions = source.getDrawableVertexPositions(index)
  const ax = live2DUnitToCanvasX(positions[pin.vertices[0] * 2], scale)
  const ay = live2DUnitToCanvasY(positions[pin.vertices[0] * 2 + 1], scale)
  const bx = live2DUnitToCanvasX(positions[pin.vertices[1] * 2], scale)
  const by = live2DUnitToCanvasY(positions[pin.vertices[1] * 2 + 1], scale)
  const cx = live2DUnitToCanvasX(positions[pin.vertices[2] * 2], scale)
  const cy = live2DUnitToCanvasY(positions[pin.vertices[2] * 2 + 1], scale)
  const x = pin.weights[0] * ax + pin.weights[1] * bx + pin.weights[2] * cx
  const y = pin.weights[0] * ay + pin.weights[1] * by + pin.weights[2] * cy

  const fade = placement.fadeWithMesh === true
  const alpha = fade ? source.getDrawableOpacity(index) : 1
  const visible = !fade || source.getDrawableDynamicFlagIsVisible(index)

  // Edge matrices with the edges as columns: E = [[e00, e01], [e10, e11]].
  const reference = pin.reference
  const r00 = reference[2] - reference[0]
  const r10 = reference[3] - reference[1]
  const r01 = reference[4] - reference[0]
  const r11 = reference[5] - reference[1]
  const n00 = bx - ax
  const n10 = by - ay
  const n01 = cx - ax
  const n11 = cy - ay
  const referenceDeterminant = r00 * r11 - r01 * r10
  const currentDeterminant = n00 * n11 - n01 * n10
  const determinant = currentDeterminant / referenceDeterminant

  // Negated so a degenerate reference (NaN or infinite ratio) holds as well.
  if (!(determinant > 0) || !(determinant >= collapsedAreaShare) || !Number.isFinite(determinant)) {
    return {
      x,
      y,
      rotation: previous?.rotation ?? placement.rotation,
      scale: previous?.scale ?? placement.scale,
      alpha,
      visible,
      held: true,
    }
  }

  const inverse = 1 / referenceDeterminant
  const i00 = r11 * inverse
  const i01 = -r01 * inverse
  const i10 = -r10 * inverse
  const i11 = r00 * inverse
  const a00 = n00 * i00 + n01 * i10
  const a01 = n00 * i01 + n01 * i11
  const a10 = n10 * i00 + n11 * i10
  const a11 = n10 * i01 + n11 * i11
  const meshRotation = Math.atan2(a10 - a01, a00 + a11)
  const meshScale = Math.min(maximumMeshScale, Math.max(minimumMeshScale, Math.sqrt(determinant)))

  return { x, y, rotation: placement.rotation + meshRotation, scale: placement.scale * meshScale, alpha, visible, held: false }
}
