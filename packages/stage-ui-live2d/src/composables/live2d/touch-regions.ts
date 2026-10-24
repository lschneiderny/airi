import type { Bounds } from 'pixi-live2d-display/cubism4'

import type { Live2DModelCanvasRect } from './head-anchor'
import type { Live2DTouchRegion } from './touch-gestures'

/**
 * What the visible-bounds measurement reads from a model.
 *
 * Narrower than the internal model, which satisfies it structurally, so the
 * measurement can be exercised without a Cubism runtime.
 */
export interface Live2DVisibleDrawableSource {
  coreModel: {
    getDrawableCount: () => number
    getDrawableDynamicFlagIsVisible: (index: number) => boolean
    getDrawableOpacity: (index: number) => number
  }
  getDrawableBounds: (index: number) => Bounds
}

/** Share of the head box height, from its top, where the eyes sit; the cursor offset is measured from there. */
export const eyeAnchorShare = 0.55

/** Drawables fainter than this are not drawn in any way a user could aim at. */
const minimumOpacity = 0.01

/**
 * The box around every drawable the renderer currently draws, in model canvas space,
 * or `undefined` when nothing is drawn.
 *
 * The model canvas is padded, so its own size says little about where the character
 * is. Hidden parts, such as an outfit an expression switched off, are skipped the same
 * way the renderer skips them.
 */
export function live2DVisibleBounds(source: Live2DVisibleDrawableSource): Live2DModelCanvasRect | undefined {
  const drawables = source.coreModel
  let left = Number.POSITIVE_INFINITY
  let top = Number.POSITIVE_INFINITY
  let right = Number.NEGATIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (let index = 0; index < drawables.getDrawableCount(); index++) {
    if (!drawables.getDrawableDynamicFlagIsVisible(index) || drawables.getDrawableOpacity(index) < minimumOpacity)
      continue
    const bounds = source.getDrawableBounds(index)
    if (bounds.width <= 0 || bounds.height <= 0)
      continue
    left = Math.min(left, bounds.x)
    top = Math.min(top, bounds.y)
    right = Math.max(right, bounds.x + bounds.width)
    bottom = Math.max(bottom, bounds.y + bounds.height)
  }
  return right > left ? { x: left, y: top, width: right - left, height: bottom - top } : undefined
}

/** Grows or shrinks `rect` by `scale` around its center; the user's per-model head area adjustment. */
export function scaleLive2DRect(rect: Live2DModelCanvasRect, scale: number): Live2DModelCanvasRect {
  const width = rect.width * scale
  const height = rect.height * scale
  return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height }
}

function contains(rect: Live2DModelCanvasRect | undefined, point: { x: number, y: number }) {
  return !!rect && point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

/** The head wins where the two boxes overlap; a point outside both is not on the model. */
export function live2DTouchRegionAt(
  point: { x: number, y: number },
  regions: { head: Live2DModelCanvasRect | undefined, body: Live2DModelCanvasRect | undefined },
): Live2DTouchRegion | null {
  if (contains(regions.head, point))
    return 'head'
  return contains(regions.body, point) ? 'body' : null
}
