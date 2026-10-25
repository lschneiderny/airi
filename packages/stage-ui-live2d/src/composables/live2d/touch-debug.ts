import type { Matrix } from '@pixi/math'

import type { Live2DModelCanvasRect } from './head-anchor'
import type { Live2DTouchGestureInspection, Live2DTouchRegion } from './touch-gestures'

import { live2DCanvasRectToViewport } from './head-anchor'
import { live2DPetThresholds, live2DPetZoneRect } from './touch-gestures'
import { live2DTouchRegionAt } from './touch-regions'

interface Live2DTouchDebugPoint {
  x: number
  y: number
}

/** The touch regions in one space: model canvas units or viewport CSS pixels. */
export interface Live2DTouchDebugRegions {
  /** The touch head box after the per-model head scale; pets and head pokes use it. */
  touch: Live2DModelCanvasRect | null
  /** The margin zone around `touch` where pet strokes may overshoot. */
  zone: Live2DModelCanvasRect | null
  /** The unscaled interaction head box; its width is the cursor-attention unit. */
  cursorUnit: Live2DModelCanvasRect | null
  /** The box around every drawn drawable; body pokes use it. */
  body: Live2DModelCanvasRect | null
  eyeAnchor: Live2DTouchDebugPoint | null
}

/** Where the interaction head box came from; `null` while the model states no head. */
export type Live2DTouchDebugSource = 'hit-area' | 'face' | 'physics' | null

/**
 * Everything the touch-region readout shows, as plain JSON. The devtools lab receives it about ten
 * times a second and copies it for bug reports, so it carries both spaces and the transforms
 * between them.
 */
export interface Live2DTouchDebugSnapshot {
  modelId: string | null
  capturedAt: string
  source: Live2DTouchDebugSource
  /** Drawables each head measurement selected; a measure that has not run is absent. */
  drawables: Partial<Record<'physics' | 'face' | 'eyes', number>>
  headScale: number
  model: Live2DTouchDebugRegions
  viewport: Live2DTouchDebugRegions
  /** The latest canvas pointer sample, mapped into model space and back to the viewport. */
  pointer: { model: Live2DTouchDebugPoint, viewport: Live2DTouchDebugPoint, region: Live2DTouchRegion | null, ageMs: number } | null
  /** The host cursor position that drives gaze when no fresh pointer sample exists. */
  hostCursor: { viewport: Live2DTouchDebugPoint } | null
  gesture: Live2DTouchGestureInspection
  thresholds: typeof live2DPetThresholds
  transforms: {
    /** `[a, b, c, d, tx, ty]` of the internal model's layout transform. */
    internalModelLocal: number[]
    /** `[a, b, c, d, tx, ty]` of the model's world transform, including the stage render scale. */
    modelWorld: number[]
    canvasClient: { left: number, top: number, width: number, height: number }
    canvasBacking: { width: number, height: number }
  }
}

/** What the stage overlay draws, all in viewport CSS pixels. */
export interface Live2DTouchDebugOverlay {
  regions: Live2DTouchDebugRegions
  trail: (Live2DTouchDebugPoint & { inHead: boolean })[]
  pointer: Live2DTouchDebugPoint | null
  hostCursor: Live2DTouchDebugPoint | null
  /** The region under the pointer, filled in the overlay. */
  hovered: Live2DTouchRegion | null
  petting: boolean
}

export interface Live2DTouchDebugInput {
  modelId: string | null
  capturedAt: Date
  nowMs: number
  source: Live2DTouchDebugSource
  drawables: Live2DTouchDebugSnapshot['drawables']
  headScale: number
  /** Model canvas units; `touch` already has the head scale applied. */
  touch: Live2DModelCanvasRect | undefined
  cursorUnit: Live2DModelCanvasRect | undefined
  body: Live2DModelCanvasRect | undefined
  eyeAnchor: Live2DTouchDebugPoint | undefined
  /** The latest canvas pointer sample in model canvas units, stamped on the `nowMs` clock. */
  pointer: (Live2DTouchDebugPoint & { atMs: number }) | undefined
  /** The host cursor in the renderer's global (backing-store) pixels, or `null` when none drives gaze. */
  hostCursorGlobal: Live2DTouchDebugPoint | null
  gesture: Live2DTouchGestureInspection
  internalModelLocalTransform: Matrix
  modelWorldTransform: Matrix
  canvasClient: { left: number, top: number, width: number, height: number }
  canvasBacking: { width: number, height: number }
}

/** Overlay colors, shared with the devtools legend. */
export const live2DTouchDebugColors = {
  touch: '#22c55e',
  zone: '#22c55e',
  cursorUnit: '#3b82f6',
  body: '#f97316',
  eyeAnchor: '#3b82f6',
  pointer: '#d946ef',
  hostCursor: '#06b6d4',
  trailInHead: '#22c55e',
  trailInZone: '#f59e0b',
} as const

function matrixValues(matrix: Matrix) {
  return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.tx, matrix.ty]
}

/**
 * Builds the readout snapshot and the overlay drawing from one stage frame.
 *
 * Model-space boxes reach the viewport through the same forward transform pair that the QA
 * bridge uses, and the pointer dot goes through it after the inverse mapping that touch uses.
 * A dot that does not sit under the real cursor therefore shows a mapping fault.
 */
export function buildLive2DTouchDebug(input: Live2DTouchDebugInput): { snapshot: Live2DTouchDebugSnapshot, overlay: Live2DTouchDebugOverlay } {
  const toViewport = (rect: Live2DModelCanvasRect) => live2DCanvasRectToViewport(rect, input.internalModelLocalTransform, input.modelWorldTransform, input.canvasClient, input.canvasBacking)
  const pointToViewport = (point: Live2DTouchDebugPoint) => {
    const mapped = toViewport({ x: point.x, y: point.y, width: 0, height: 0 })
    return { x: mapped.x, y: mapped.y }
  }

  const model: Live2DTouchDebugRegions = {
    touch: input.touch ?? null,
    zone: input.touch ? live2DPetZoneRect(input.touch) : null,
    cursorUnit: input.cursorUnit ?? null,
    body: input.body ?? null,
    eyeAnchor: input.eyeAnchor ?? null,
  }
  const viewport: Live2DTouchDebugRegions = {
    touch: model.touch && toViewport(model.touch),
    zone: model.zone && toViewport(model.zone),
    cursorUnit: model.cursorUnit && toViewport(model.cursorUnit),
    body: model.body && toViewport(model.body),
    eyeAnchor: model.eyeAnchor && pointToViewport(model.eyeAnchor),
  }

  const pointer = input.pointer
    ? {
        model: { x: input.pointer.x, y: input.pointer.y },
        viewport: pointToViewport(input.pointer),
        region: live2DTouchRegionAt(input.pointer, { head: input.touch, body: input.body }),
        ageMs: input.nowMs - input.pointer.atMs,
      }
    : null
  const hostCursor = input.hostCursorGlobal
    ? {
        viewport: {
          x: input.canvasClient.left + input.hostCursorGlobal.x * input.canvasClient.width / input.canvasBacking.width,
          y: input.canvasClient.top + input.hostCursorGlobal.y * input.canvasClient.height / input.canvasBacking.height,
        },
      }
    : null

  return {
    snapshot: {
      modelId: input.modelId,
      capturedAt: input.capturedAt.toISOString(),
      source: input.source,
      drawables: input.drawables,
      headScale: input.headScale,
      model,
      viewport,
      pointer,
      hostCursor,
      gesture: input.gesture,
      thresholds: live2DPetThresholds,
      transforms: {
        internalModelLocal: matrixValues(input.internalModelLocalTransform),
        modelWorld: matrixValues(input.modelWorldTransform),
        canvasClient: { left: input.canvasClient.left, top: input.canvasClient.top, width: input.canvasClient.width, height: input.canvasClient.height },
        canvasBacking: { width: input.canvasBacking.width, height: input.canvasBacking.height },
      },
    },
    overlay: {
      regions: viewport,
      trail: input.gesture.trail.map(point => ({ ...pointToViewport(point), inHead: point.inHead })),
      pointer: pointer?.viewport ?? null,
      hostCursor: hostCursor?.viewport ?? null,
      hovered: pointer?.region ?? null,
      petting: input.gesture.petting,
    },
  }
}
