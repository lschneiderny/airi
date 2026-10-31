import type { PlacementRect } from '@proj-airi/stage-shared/stage-placement'
import type { CameraCalibration, WorldFrame } from '@proj-airi/stage-shared/stage-world'
import type { Group, PerspectiveCamera } from 'three'

import { worldToDip } from '@proj-airi/stage-shared/stage-world'

/** The desktop stage's world for one scene: the work area, its camera calibration, the reachable ground and the resting root x. */
export interface MMDStageWorld extends WorldFrame {
  /** Resting root x in model units; the scene places the root here when the model loads. */
  readonly homeX: number
}

/** Root-relative extent of the character, measured once per load with the root at the origin. */
export interface MMDStageExtent {
  readonly minX: number
  readonly maxX: number
  readonly minZ: number
  readonly maxZ: number
  /** Crown height above the sole plane in model units. */
  readonly height: number
}

export interface CalibratedCamera {
  readonly position: { x: number, y: number, z: number }
  readonly aspect: number
  readonly near: number
  readonly far: number
  /** Column-major projection matrix elements, exactly what `Matrix4.makePerspective` writes. */
  readonly projection: readonly number[]
}

/** Closed-form camera for a calibration: eye position and the off-axis projection matrix elements. */
export function applyCalibrationToCamera(calibration: CameraCalibration): CalibratedCamera {
  const { left, right, top, bottom, near, far } = calibration.frustum
  return {
    position: { ...calibration.position },
    aspect: calibration.aspect,
    near,
    far,
    projection: [
      2 * near / (right - left),
      0,
      0,
      0,
      0,
      2 * near / (top - bottom),
      0,
      0,
      (right + left) / (right - left),
      (top + bottom) / (top - bottom),
      -(far + near) / (far - near),
      -1,
      0,
      0,
      -2 * far * near / (far - near),
      0,
    ],
  }
}

/**
 * Points a three camera along -Z with the calibration's off-axis frustum.
 * `updateProjectionMatrix` would rebuild a symmetric frustum from `fov`, so callers must not invoke it afterwards.
 */
export function applyStageCamera(camera: PerspectiveCamera, calibration: CameraCalibration): void {
  const { position, aspect, near, far } = applyCalibrationToCamera(calibration)
  camera.position.set(position.x, position.y, position.z)
  camera.aspect = aspect
  camera.near = near
  camera.far = far
  camera.fov = calibration.verticalFov * 180 / Math.PI
  camera.lookAt(position.x, position.y, 0)
  const { left, right, top, bottom } = calibration.frustum
  camera.projectionMatrix.makePerspective(left, right, top, bottom, near, far)
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
  camera.updateMatrixWorld(true)
}

/**
 * Puts the model root on the floor line: unit scale, no yaw, feet at `y = 0`. The classic scale, rotation and position
 * settings never apply in stage mode, so every stage write of the root goes through here.
 */
export function applyStageRoot(group: Group, rootX: number, footBaselineY: number): void {
  group.scale.setScalar(1)
  group.rotation.y = 0
  group.position.set(rootX, -footBaselineY, 0)
}

/** Splits skeleton frame bounds, measured with the root at the origin, into the root-relative extent and the foot baseline. */
export function measureStageExtent(bounds: { center: readonly number[], size: readonly number[] }): { extent: MMDStageExtent, footBaselineY: number } {
  const [centerX, centerY, centerZ] = bounds.center
  const [sizeX, sizeY, sizeZ] = bounds.size
  return {
    footBaselineY: centerY - sizeY / 2,
    extent: { minX: centerX - sizeX / 2, maxX: centerX + sizeX / 2, minZ: centerZ - sizeZ / 2, maxZ: centerZ + sizeZ / 2, height: sizeY },
  }
}

/** Window DIP bounds of the character's extent with the root at `rootX`, feet on the floor line. */
export function projectCharacterPlacement(calibration: CameraCalibration, extent: MMDStageExtent, rootX: number): PlacementRect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const x of [extent.minX, extent.maxX]) {
    for (const y of [0, extent.height]) {
      for (const z of [extent.minZ, extent.maxZ]) {
        const dip = worldToDip(calibration, { x: rootX + x, y, z })
        minX = Math.min(minX, dip.x)
        maxX = Math.max(maxX, dip.x)
        minY = Math.min(minY, dip.y)
        maxY = Math.max(maxY, dip.y)
      }
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** Caps the stage drawing buffer at one pixel per DIP, so a full-screen work area at a 2x backing scale is not rendered at 4x the pixels. */
export function stagePixelRatio(devicePixelRatio: number, renderScale: number): number {
  return Math.min(devicePixelRatio * renderScale, 1)
}
