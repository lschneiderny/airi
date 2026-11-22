import type { BodyIntent } from '@proj-airi/motion-driver-humanoid/types'
import type { PerformanceAttention } from '@proj-airi/stage-shared/performance-state'
import type { CameraCalibration } from '@proj-airi/stage-shared/stage-world'
import type { Camera, SkinnedMesh } from 'three'

import type { MMDNaturalAdapter } from '../natural/adapter'

import { dipToPlane } from '@proj-airi/stage-shared/stage-world'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'

import { projectMMDHead } from '../natural/adapter'

/** Fraction of the camera distance, toward the camera, where stage-mode cursor and chat gaze converges. */
export const STAGE_GAZE_PLANE_FRACTION = 0.6

/** World-space points the body can look at this frame. The camera always exists; cursor and chat may not. */
export interface MMDBodyPoints {
  readonly cursor: Vector3 | null
  readonly chat: Vector3 | null
  readonly camera: Vector3
}

export interface BodyView {
  mesh: SkinnedMesh
  camera: Camera
  viewport: DOMRect
  gazeMode: 'none' | 'mouse' | 'camera'
  calibration?: CameraCalibration
}

/**
 * Converts Natural's screen-DIP attention into world-space targets for the body.
 * With `calibration` (stage mode) points unproject onto the plane `0.6 * D` in front of her and the camera point is
 * the calibration eye; without it the legacy raycast onto her head plane applies. Returns null when the frame has no
 * input or the gaze mode is `none`.
 */
export function resolveBodyPoints(
  view: BodyView,
  natural: MMDNaturalAdapter['bodyFrame'],
): MMDBodyPoints | null {
  const { input } = natural
  if (!input || view.gazeMode === 'none')
    return null
  const head = projectMMDHead(view.mesh, view.camera, view.viewport)
  const bone = view.mesh.skeleton.bones.find(bone => ['頭', 'head', 'Head'].includes(bone.name))
  const point = (offset: { x: number, y: number } | null) => {
    if (!head || !bone || !offset)
      return null
    const x = head.x + offset.x * head.width
    const y = head.y - offset.y * head.width
    if (view.calibration) {
      const plane = dipToPlane(view.calibration, { x: x - view.viewport.x, y: y - view.viewport.y }, STAGE_GAZE_PLANE_FRACTION * view.calibration.position.z)
      return new Vector3(plane.x, plane.y, plane.z)
    }
    const ray = new Raycaster()
    ray.setFromCamera(new Vector2((x - view.viewport.x) / view.viewport.width * 2 - 1, 1 - (y - view.viewport.y) / view.viewport.height * 2), view.camera)
    const z = bone.getWorldPosition(new Vector3()).z
    return ray.ray.intersectPlane(new Plane(new Vector3(0, 0, 1), -z), new Vector3())
  }
  const cameraPoint = view.calibration
    ? new Vector3(view.calibration.position.x, view.calibration.position.y, view.calibration.position.z)
    : view.camera.getWorldPosition(new Vector3())
  return { cursor: point(input.cursor), chat: point(input.chat?.target ?? null), camera: cameraPoint }
}

/**
 * The points the body's gaze goal chooses from by Natural's gaze target. In camera mode the cursor Natural fixates is
 * the camera itself, so the camera stands in for the cursor point.
 */
export function bodyGazePoints(points: MMDBodyPoints | null, gazeMode: BodyView['gazeMode']): MMDBodyPoints | null {
  if (!points || gazeMode === 'none')
    return null
  return gazeMode === 'camera' ? { ...points, cursor: points.camera } : points
}

/**
 * Diagnostic and trace target: camera mode first, then Natural's chat read, then a tool look or resolver attention.
 * The body's actual gaze is still realised exclusively from Natural's frame.
 */
export function resolveBodyTarget(
  points: ReturnType<typeof resolveBodyPoints>,
  natural: Pick<MMDNaturalAdapter['bodyFrame'], 'onChat'>,
  gazeMode: BodyView['gazeMode'],
  intent: BodyIntent | null,
  attention: PerformanceAttention,
): Vector3 | null {
  if (!points || gazeMode === 'none')
    return null
  if (gazeMode === 'camera')
    return points.camera
  if (natural.onChat && points.chat)
    return points.chat
  if (!intent)
    return null
  const target = intent.look?.target ?? attention
  if (target === 'camera' || target === 'cursor' || target === 'chat') {
    const point = points[target]
    return point ? new Vector3().copy(point) : null
  }
  return null
}
