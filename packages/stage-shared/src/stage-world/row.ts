import type { PlacementRect } from '../stage-placement'
import type { CameraCalibration, GroundLine } from './types'

import { calibrateCamera } from './camera'
import { groundLineOf } from './ground'

/**
 * The stretch of a wing in which no display shows her, in model heights. A leg is about half the model height, so
 * this is about 0.6 leg lengths: under a second at a walk, which is the time the stage window has to change display.
 */
export const STAGE_ROW_OFFSTAGE_MODEL_HEIGHTS = 0.3

/** One display the character can stand on. */
export interface StageRowDisplay {
  readonly id: string
  /** The work area in screen DIP. */
  readonly workArea: PlacementRect
}

export interface StageRowInput {
  readonly displays: readonly StageRowDisplay[]
  /** Measured model height from the sole plane to the crown, in world units. */
  readonly modelHeight: number
  /** On-screen character height in DIP. */
  readonly characterHeightDip: number
  /** The floor row sits this far above the bottom of each work area, in DIP. */
  readonly toeMarginDip: number
  /** Half the width kept clear for her on each side of the root, in DIP. */
  readonly halfWidthDip: number
}

/** One display's place on the row's world x axis. */
export interface StageRowSlot {
  readonly id: string
  /** The work area in screen DIP. */
  readonly workArea: PlacementRect
  /** The camera of this display; its `originX` is the world x of the work area's left edge. */
  readonly calibration: CameraCalibration
  /** The reachable root x range on this display. */
  readonly ground: GroundLine
  /** The root x range in which this display shows some of her: the work area grown by her half width on each side. */
  readonly visible: GroundLine
}

/**
 * Every display on one continuous world x axis, left to right. Neighbours are separated by a wing no display shows:
 * she walks off one display's edge, crosses the wing, and walks in from the next display's edge.
 */
export interface StageRow {
  readonly slots: readonly StageRowSlot[]
}

/**
 * Lays the displays out left to right on one world x axis.
 *
 * Use when:
 * - The displays, the model height, or the character height changed
 *
 * Expects:
 * - Work areas in screen DIP. Their positions decide the order only: the centre x, then the centre y, so stacked
 *   displays and displays with a gap between them become side-by-side neighbours too
 *
 * Returns:
 * - One slot per display. The first slot's origin is 0, so a row of one is the calibration and the ground line a
 *   single display always had. Each wing is both neighbours' half widths plus the unseen stretch
 *   ({@link STAGE_ROW_OFFSTAGE_MODEL_HEIGHTS}), so she is never drawn on two displays at once.
 */
export function layoutStageRow(input: StageRowInput): StageRow {
  const ordered = [...input.displays].sort((a, b) =>
    (a.workArea.x + a.workArea.width / 2) - (b.workArea.x + b.workArea.width / 2)
    || (a.workArea.y + a.workArea.height / 2) - (b.workArea.y + b.workArea.height / 2))
  const offstage = STAGE_ROW_OFFSTAGE_MODEL_HEIGHTS * input.modelHeight

  const slots: StageRowSlot[] = []
  let previous: StageRowSlot | undefined
  for (const display of ordered) {
    const calibrate = (originX: number) => calibrateCamera({
      workArea: display.workArea,
      modelHeight: input.modelHeight,
      characterHeightDip: input.characterHeightDip,
      floorRowDip: display.workArea.height - input.toeMarginDip,
      originX,
    })
    // The scale does not depend on the origin, and the half width in world units depends on the scale.
    const halfWidth = input.halfWidthDip * calibrate(0).unitsPerDip
    const calibration = calibrate(previous ? previous.visible.maxX + offstage + halfWidth : 0)
    const maxX = calibration.originX + calibration.unitsPerDip * display.workArea.width
    previous = {
      id: display.id,
      workArea: { ...display.workArea },
      calibration,
      ground: groundLineOf(display.workArea, calibration, halfWidth),
      visible: { minX: calibration.originX - halfWidth, maxX: maxX + halfWidth },
    }
    slots.push(previous)
  }
  return { slots }
}

/**
 * The display the stage window should cover for a root at `rootX`.
 *
 * Use when:
 * - Deciding each frame whether the stage window must move to another display
 *
 * Expects:
 * - `currentId` is the display the window is confirmed to cover
 * - `heading` is the sign of her last movement along x: 1 to the right, -1 to the left, 0 before she has moved
 *
 * Returns:
 * - `currentId` while the current display shows any of her, so the window never leaves while she is seen
 * - Another display's id once that display shows some of her
 * - In the unseen stretch of a wing, the display she is heading for. The heading keeps the answer stable there: with
 *   the root alone, each neighbour would hand her to the other. Without a heading, the current display if it borders
 *   the wing, otherwise the nearer one
 * - `null` only for an empty row
 */
export function stageDisplayFor(row: StageRow, currentId: string | null, rootX: number, heading: number): string | null {
  const { slots } = row
  if (slots.length === 0)
    return null

  const current = slots.find(slot => slot.id === currentId)
  if (current && rootX >= current.visible.minX && rootX <= current.visible.maxX)
    return current.id

  const right = slots.findIndex(slot => rootX <= slot.visible.maxX)
  if (right === -1)
    return slots.at(-1)!.id
  const rightSlot = slots[right]!
  if (right === 0 || rootX >= rightSlot.visible.minX)
    return rightSlot.id

  // The unseen stretch between two neighbours.
  const leftSlot = slots[right - 1]!
  if (heading > 0)
    return rightSlot.id
  if (heading < 0)
    return leftSlot.id
  if (current === leftSlot || current === rightSlot)
    return current.id
  return rootX - leftSlot.visible.maxX <= rightSlot.visible.minX - rootX ? leftSlot.id : rightSlot.id
}

/**
 * The world x under a screen point, on the display whose work area holds it.
 *
 * Returns `null` for a point in dead space: off every work area, as in a gap between displays, under a taskbar, or
 * beside a smaller display. Such a point has no place on the row.
 */
export function screenToRowX(row: StageRow, point: { x: number, y: number }): number | null {
  const slot = row.slots.find(({ workArea }) =>
    point.x >= workArea.x && point.x <= workArea.x + workArea.width
    && point.y >= workArea.y && point.y <= workArea.y + workArea.height)
  return slot ? slotScreenToWorldX(slot, point.x) : null
}

/** The world x of screen column `screenX` on `slot`'s floor line; columns beside the work area extrapolate. */
export function slotScreenToWorldX(slot: StageRowSlot, screenX: number): number {
  return slot.calibration.originX + slot.calibration.unitsPerDip * (screenX - slot.workArea.x)
}
