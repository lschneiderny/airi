import type { Renderer } from '@pixi/core'
import type { InternalModel } from 'pixi-live2d-display/cubism4'

/** Draws the drawables at sorted render-order positions `[from, to)` of the model. */
export interface Live2DModelRangeSegment {
  kind: 'model'
  from: number
  to: number
}

/**
 * Renders Pixi objects between two model ranges, inside the model's render pass, so
 * they share the model's filters and the frame of its update.
 *
 * The vendored renderer flushes the Pixi batch and resets Pixi's cached GL state on
 * both sides of `render`, then restores the Cubism render target and fixed state
 * before the next range. `render` must leave the render target bound as it found
 * it, as Pixi's own filter and mask push and pop do.
 */
export interface Live2DItemInsertSegment {
  kind: 'insert'
  render: (renderer: Renderer) => void
}

export type Live2DItemDrawSegment = Live2DModelRangeSegment | Live2DItemInsertSegment

/**
 * The fork hook that `patches/pixi-live2d-display.patch` adds to `Live2DModel`.
 *
 * While it is set, `Live2DModel._render` asks it for the frame's segments after the
 * model update and transform, and draws them in order. The clipping-mask pass runs
 * once, before the first segment, and every range reads those masks. The model
 * segments must cover every render-order position once, in order; a position that
 * no segment covers is not drawn. While it is unset, the model draws in one pass, as
 * upstream does.
 *
 * `segments` takes the base `InternalModel`: a parameter typed by the model's own
 * internal model would make `Live2DModel` invariant in it.
 */
export interface Live2DItemInsertions {
  segments: (internalModel: InternalModel, renderer: Renderer) => readonly Live2DItemDrawSegment[]
}

declare module 'pixi-live2d-display/cubism4' {
  interface Live2DModel<IM extends InternalModel = InternalModel> {
    itemInsertions?: Live2DItemInsertions
  }
}
