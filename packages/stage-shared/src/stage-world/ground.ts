import type { CameraCalibration, GroundLine, WorkAreaSize } from './types'

import { dipToPlane, worldToDip } from './camera'

/** Returns the reachable root x range in model units; a work area narrower than the character collapses to its center. */
export function groundLineOf(workArea: WorkAreaSize, calibration: CameraCalibration, halfWidthUnits: number): GroundLine {
  const width = calibration.unitsPerDip * workArea.width
  const minX = halfWidthUnits
  const maxX = width - halfWidthUnits

  if (minX > maxX)
    return { minX: width / 2, maxX: width / 2 }

  return { minX, maxX }
}

/** Returns the home column beside the chat panel, in DIP from the work area's left edge. */
export function defaultHomeDipX(
  workArea: WorkAreaSize,
  chatSide: 'left' | 'right',
  chatWidthDip: number,
  characterHalfWidthDip: number,
): number {
  return chatSide === 'left'
    ? chatWidthDip + characterHalfWidthDip
    : workArea.width - chatWidthDip - characterHalfWidthDip
}

export function homeDipToWorldX(calibration: CameraCalibration, xDip: number, floorRowDip: number): number {
  return dipToPlane(calibration, { x: xDip, y: floorRowDip }, 0).x
}

export function worldToHomeDipX(calibration: CameraCalibration, x: number): number {
  return worldToDip(calibration, { x, y: 0, z: 0 }).x
}
