import type { InferOutput } from 'valibot'

import { boolean, check, finite, gtValue, integer, literal, maxValue, minValue, number, optional, pipe, strictObject, strictTuple, string, variant } from 'valibot'

const finiteNumber = pipe(number(), finite())
const vertexIndex = pipe(number(), integer(), minValue(0))
const pinWeight = pipe(number(), finite(), minValue(0))
/** Rounding slack for barycentric weights that a picker computed in floating point. */
const PIN_WEIGHT_SUM_TOLERANCE = 1e-6

/**
 * Where an item sits on a Live2D mesh, in the VTube Studio pin shape. `weights` are barycentric weights over the three
 * vertices of one triangle of `drawableId`. `reference` is that triangle (a, b, c as x, y pairs) in model canvas units
 * when the pin was made, so a renderer can recover the rotation and scale the mesh applied since. `vertexCount`
 * fingerprints the drawable: a model whose drawable has another vertex count needs the pin re-attached at `modelPoint`.
 */
export const StageItemPinSchema = strictObject({
  drawableId: string(),
  vertices: strictTuple([vertexIndex, vertexIndex, vertexIndex]),
  weights: pipe(
    strictTuple([pinWeight, pinWeight, pinWeight]),
    check(weights => Math.abs(weights[0] + weights[1] + weights[2] - 1) <= PIN_WEIGHT_SUM_TOLERANCE, 'Pin weights must sum to 1'),
  ),
  reference: strictTuple([finiteNumber, finiteNumber, finiteNumber, finiteNumber, finiteNumber, finiteNumber]),
  vertexCount: pipe(number(), integer(), minValue(3)),
  modelPoint: strictObject({ x: finiteNumber, y: finiteNumber }),
})
export type StageItemPin = InferOutput<typeof StageItemPinSchema>

/** Where an item draws in her draw order: before her first drawable, right after a named drawable, or after her last. */
export const StageItemLayerSchema = variant('kind', [
  strictObject({ kind: literal('behind') }),
  strictObject({ kind: literal('front') }),
  strictObject({ kind: literal('above'), drawableId: string() }),
])
export type StageItemLayer = InferOutput<typeof StageItemLayerSchema>

const anchorCoordinate = pipe(number(), minValue(0), maxValue(1))

/**
 * How an item is placed on one character model. Position is in model canvas units, so it holds when the stage scale
 * changes; `rotation` is in radians; `anchor` is the point of the item, as a fraction of its size, that sits at the
 * position. A pin, when present, moves the item with her mesh; `fadeWithMesh` multiplies the pinned drawable's opacity
 * into the item.
 */
export const StageItemPlacementSchema = strictObject({
  x: finiteNumber,
  y: finiteNumber,
  rotation: finiteNumber,
  scale: pipe(number(), finite(), gtValue(0)),
  flipX: boolean(),
  anchor: strictObject({ x: anchorCoordinate, y: anchorCoordinate }),
  layer: StageItemLayerSchema,
  pin: optional(StageItemPinSchema),
  fadeWithMesh: optional(boolean()),
})
export type StageItemPlacement = InferOutput<typeof StageItemPlacementSchema>

/** At most this many stage items show at once, so frame cost stays bounded; a further show is refused `item-limit`. */
export const MAX_SHOWN_ITEMS = 16
/** Of the shown items, at most this many are Live2D models, the costly kind. The Live2D renderer never loads more. */
export const MAX_SHOWN_LIVE2D_ITEMS = 4
