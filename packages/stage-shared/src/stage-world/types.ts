import type { PlacementRect } from '../stage-placement'

/** A position or direction in model units, structurally equal to the humanoid `Vec3`. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Display work area in DIP, as reported by the main process. */
export interface WorkAreaSize {
  readonly width: number
  readonly height: number
}

export interface CameraCalibrationInput {
  readonly workArea: WorkAreaSize
  /** Measured model height from the sole plane (y = 0) to the crown, in world units. */
  readonly modelHeight: number
  /** On-screen character height in DIP. */
  readonly characterHeightDip: number
  /** Floor edge row in DIP from the top; the work-area height minus the toe margin. */
  readonly floorRowDip: number
  /** Space kept above the character when clamping an over-tall character, in DIP. Default 0. */
  readonly topMarginDip?: number
  /** Camera distance in model heights. Default 5. */
  readonly distanceInModelHeights?: number
  /** Eye height in model heights; null selects the symmetric frustum. Default 0.5. */
  readonly eyeHeightInModelHeights?: number | null
}

export interface CameraCalibration {
  /** World units per DIP on the z = 0 plane. */
  readonly unitsPerDip: number
  readonly position: Vec3
  /** The floor edge row in DIP that the z = 0, y = 0 line projects to. */
  readonly floorRowDip: number
  /** Look direction is -Z and up is +Y; there is no pitch. */
  readonly frustum: {
    readonly left: number
    readonly right: number
    readonly bottom: number
    readonly top: number
    readonly near: number
    readonly far: number
  }
  /** Width over height, in DIP. */
  readonly aspect: number
  /** Vertical field of view in radians, from the bottom to the top frustum edge. */
  readonly verticalFov: number
}

/** Reachable root x range on the ground line, inset by the model's half width, in model units. */
export interface GroundLine {
  readonly minX: number
  readonly maxX: number
}

export interface WorldFrame {
  readonly workArea: WorkAreaSize
  readonly calibration: CameraCalibration
  readonly ground: GroundLine
}

/** Where the character rests, as a DIP column in the work area. */
export interface StageHome {
  readonly xDip: number
  readonly chatSide: 'left' | 'right'
}

export interface StageDisplay {
  readonly id: number
  readonly bounds: PlacementRect
  readonly workArea: PlacementRect
  readonly scaleFactor: number
}
