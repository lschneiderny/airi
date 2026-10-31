import type { CameraCalibration, CameraCalibrationInput, Vec3 } from './types'

const DEFAULT_DISTANCE_IN_MODEL_HEIGHTS = 5
const DEFAULT_EYE_HEIGHT_IN_MODEL_HEIGHTS = 0.5
const MAX_CHARACTER_FLOOR_FRACTION = 0.9

/**
 * Builds the off-axis camera whose z = 0 plane maps to the window by a pure scale.
 * Units are right-handed with +Y up; x = 0 is the work area's left edge and y = 0 is the floor.
 */
export function calibrateCamera(input: CameraCalibrationInput): CameraCalibration {
  const { workArea, modelHeight, characterHeightDip, floorRowDip } = input
  const topMarginDip = input.topMarginDip ?? 0
  const unitsPerDip = Math.max(
    modelHeight / characterHeightDip,
    modelHeight / (MAX_CHARACTER_FLOOR_FRACTION * (floorRowDip - topMarginDip)),
  )
  const distance = (input.distanceInModelHeights ?? DEFAULT_DISTANCE_IN_MODEL_HEIGHTS) * modelHeight
  const eyeHeight = input.eyeHeightInModelHeights === null
    ? unitsPerDip * (floorRowDip - workArea.height / 2)
    : (input.eyeHeightInModelHeights ?? DEFAULT_EYE_HEIGHT_IN_MODEL_HEIGHTS) * modelHeight
  const eyeX = unitsPerDip * workArea.width / 2
  const near = 0.1 * distance
  const scale = near / distance

  const left = (0 - eyeX) * scale
  const right = (unitsPerDip * workArea.width - eyeX) * scale
  const bottom = (-unitsPerDip * (workArea.height - floorRowDip) - eyeHeight) * scale
  const top = (unitsPerDip * floorRowDip - eyeHeight) * scale

  return {
    unitsPerDip,
    position: { x: eyeX, y: eyeHeight, z: distance },
    floorRowDip,
    frustum: { left, right, bottom, top, near, far: 2 * distance },
    aspect: workArea.width / workArea.height,
    verticalFov: Math.atan(top / near) - Math.atan(bottom / near),
  }
}

/** Projects a world point to window DIP. The point must be in front of the camera (z < position.z). */
export function worldToDip(calibration: CameraCalibration, point: Vec3): { x: number, y: number } {
  const { unitsPerDip: s, position, floorRowDip } = calibration
  const k = position.z / (position.z - point.z)

  return {
    x: (position.x + (point.x - position.x) * k) / s,
    y: floorRowDip - (position.y + (point.y - position.y) * k) / s,
  }
}

/** Unprojects window DIP onto the plane z = planeZ along the ray through the same pixel on z = 0. */
export function dipToPlane(calibration: CameraCalibration, point: { x: number, y: number }, planeZ: number): Vec3 {
  const { unitsPerDip: s, position, floorRowDip } = calibration
  const x0 = s * point.x
  const y0 = s * (floorRowDip - point.y)
  const t = (position.z - planeZ) / position.z

  return {
    x: position.x + (x0 - position.x) * t,
    y: position.y + (y0 - position.y) * t,
    z: planeZ,
  }
}
