import type { ItemExpressionDocument, StageItemPin, StageItemPlacement } from '@proj-airi/stage-shared/expression-performance'
import type { InjectionKey } from 'vue'

import type { ExpressionPanelItem, ItemPatch } from './source'

import { MAX_SHOWN_ITEMS, MAX_SHOWN_LIVE2D_ITEMS } from '@proj-airi/stage-shared/expression-performance'

export interface PlanePoint {
  x: number
  y: number
}

/** Opens the placement editor for an item entry; the Live2D settings section provides it, so other panels offer no button. */
export const openStageItemPlacementKey: InjectionKey<(itemId: string) => void> = Symbol('open-stage-item-placement')

/**
 * The items the editor's preview draws: the stage's shown items with the edited item's draft in place of its stored
 * document. An edited item the stage does not show is added while the shown caps allow; past a cap the preview keeps
 * the stage's items and the editor shows the `item-limit` refusal, so the cap is never bypassed silently.
 */
export function previewItemsFor(
  items: readonly ExpressionPanelItem[],
  draft: ItemExpressionDocument | null,
  isLive2D: (assetId: string) => boolean,
): { documents: ItemExpressionDocument[], refusal: 'item-limit' | null } {
  const documents = items.filter(item => item.shown && item.available).map(item => item.document)
  if (!draft)
    return { documents, refusal: null }
  const at = documents.findIndex(document => document.id === draft.id)
  if (at >= 0) {
    documents[at] = draft
    return { documents, refusal: null }
  }
  const live2d = documents.filter(document => isLive2D(document.assetId)).length + (isLive2D(draft.assetId) ? 1 : 0)
  if (documents.length + 1 > MAX_SHOWN_ITEMS || live2d > MAX_SHOWN_LIVE2D_ITEMS)
    return { documents, refusal: 'item-limit' }
  return { documents: [...documents, draft], refusal: null }
}

/** The typed scale range; the schema only demands a positive number, and these keep an item visible and finite. */
const MIN_SCALE = 0.01
const MAX_SCALE = 100

export type PlacementField = 'x' | 'y' | 'scale' | 'rotationDegrees' | 'anchorX' | 'anchorY'

/** Wraps degrees into (-180, 180], so a typed 370 reads back as 10. */
export function normalizeDegrees(degrees: number): number {
  const wrapped = ((degrees + 180) % 360 + 360) % 360 - 180
  return wrapped === -180 ? 180 : wrapped
}

export function degreesOf(radians: number): number {
  return normalizeDegrees(radians * 180 / Math.PI)
}

/**
 * The placement change a typed field value means, or `undefined` when the text is no usable number: an empty field, NaN,
 * or a scale at or below zero leave the placement as it is. Anchors clamp to [0, 1], the scale to its range, and the
 * rotation wraps, so the schema never receives a value outside its bounds.
 */
export function placementFieldPatch(field: PlacementField, text: string): Partial<Pick<StageItemPlacement, 'x' | 'y' | 'scale' | 'rotation' | 'anchor'>> & { anchorX?: number, anchorY?: number } | undefined {
  const value = text.trim() === '' ? Number.NaN : Number(text)
  if (!Number.isFinite(value))
    return undefined
  switch (field) {
    case 'x':
      return { x: value }
    case 'y':
      return { y: value }
    case 'scale':
      return value > 0 ? { scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, value)) } : undefined
    case 'rotationDegrees':
      return { rotation: normalizeDegrees(value) * Math.PI / 180 }
    case 'anchorX':
      return { anchorX: Math.min(1, Math.max(0, value)) }
    case 'anchorY':
      return { anchorY: Math.min(1, Math.max(0, value)) }
  }
}

/** Applies a field patch, folding the anchor coordinates into the anchor object. */
export function withFieldPatch(placement: StageItemPlacement, patch: NonNullable<ReturnType<typeof placementFieldPatch>>): StageItemPlacement {
  const { anchorX, anchorY, ...rest } = patch
  const anchor = anchorX !== undefined || anchorY !== undefined
    ? { x: anchorX ?? placement.anchor.x, y: anchorY ?? placement.anchor.y }
    : placement.anchor
  return { ...placement, ...rest, anchor }
}

/** The scale a corner handle sets: the start scale times how much farther from the item's center the pointer is. */
export function scaleFromHandle(startScale: number, center: PlanePoint, startPointer: PlanePoint, pointer: PlanePoint): number {
  const startDistance = Math.hypot(startPointer.x - center.x, startPointer.y - center.y)
  if (startDistance === 0)
    return startScale
  const distance = Math.hypot(pointer.x - center.x, pointer.y - center.y)
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, startScale * distance / startDistance))
}

/** The rotation a rotation handle sets: the start rotation plus the angle the pointer swept around the item's center. */
export function rotationFromHandle(startRotation: number, center: PlanePoint, startPointer: PlanePoint, pointer: PlanePoint): number {
  const startAngle = Math.atan2(startPointer.y - center.y, startPointer.x - center.x)
  const angle = Math.atan2(pointer.y - center.y, pointer.x - center.x)
  return startRotation + angle - startAngle
}

/**
 * The item's four corners in model canvas units, top-left first and clockwise before the flip, from where it draws,
 * its file's size, and how the placement scales, flips, and anchors it.
 */
export function itemFrame(
  pose: { x: number, y: number, rotation: number, scale: number },
  size: { width: number, height: number },
  anchor: PlanePoint,
  flipX: boolean,
): PlanePoint[] {
  const scaleX = flipX ? -pose.scale : pose.scale
  const cos = Math.cos(pose.rotation)
  const sin = Math.sin(pose.rotation)
  const left = -anchor.x * size.width
  const top = -anchor.y * size.height
  return [[left, top], [left + size.width, top], [left + size.width, top + size.height], [left, top + size.height]].map(([localX, localY]) => {
    const x = localX * scaleX
    const y = localY * pose.scale
    return { x: pose.x + x * cos - y * sin, y: pose.y + x * sin + y * cos }
  })
}

/** Below this distance in view pixels a frame corner counts as unmoved, so a still item does not re-render the editor. */
const frameMoveEpsilonPx = 0.01

/** Whether the editor's frame moved: a point count changed, or a point moved more than {@link frameMoveEpsilonPx}. */
export function viewFrameMoved(previous: readonly PlanePoint[], next: readonly PlanePoint[]): boolean {
  if (previous.length !== next.length)
    return true
  return next.some((point, index) => Math.abs(point.x - previous[index].x) > frameMoveEpsilonPx || Math.abs(point.y - previous[index].y) > frameMoveEpsilonPx)
}

/** Pins the item where the user clicked; the item's anchor then follows that point of the mesh. */
export function pinnedPlacement(placement: StageItemPlacement, pin: StageItemPin): StageItemPlacement {
  return { ...placement, pin, x: pin.modelPoint.x, y: pin.modelPoint.y }
}

/** Releases the pin and keeps the item where it draws now, so it does not jump back to where it was pinned. */
export function unpinnedPlacement(placement: StageItemPlacement, pose: { x: number, y: number, rotation: number, scale: number } | undefined): StageItemPlacement {
  const { pin: _pin, ...rest } = placement
  return pose ? { ...rest, x: pose.x, y: pose.y, rotation: pose.rotation, scale: pose.scale } : rest
}

/**
 * Sends at most one `update-item` per animation frame and per item, with the last value of a frame winning. Patches
 * are keyed by item id, so a switch to another item mid-drag never writes the old item's placement onto the new one.
 */
export function createFramePatchQueue(
  emit: (id: string, patch: ItemPatch) => void,
  schedule: (callback: () => void) => number = callback => requestAnimationFrame(callback),
  cancel: (handle: number) => void = handle => cancelAnimationFrame(handle),
) {
  const pending = new Map<string, ItemPatch>()
  let handle: number | undefined

  function flush() {
    handle = undefined
    const patches = [...pending]
    pending.clear()
    for (const [id, patch] of patches)
      emit(id, patch)
  }

  return {
    push(id: string, patch: ItemPatch) {
      pending.set(id, { ...pending.get(id), ...patch })
      handle ??= schedule(flush)
    },
    /** Sends what is pending now, for a drag end or the editor closing. */
    flush() {
      if (handle !== undefined) {
        cancel(handle)
        flush()
      }
    },
    /** Drops what is pending without sending it. */
    cancel() {
      if (handle !== undefined)
        cancel(handle)
      handle = undefined
      pending.clear()
    },
  }
}
