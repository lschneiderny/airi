import type { BodyIntent } from '@proj-airi/motion-driver-humanoid/types'
import type { CameraCalibration } from '@proj-airi/stage-shared/stage-world'
import type { Camera, SkinnedMesh } from 'three'

import type { MMDNaturalAdapter } from '../natural/adapter'

import { dipToPlane } from '@proj-airi/stage-shared/stage-world'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'

import { projectMMDHead } from '../natural/adapter'

/** Fraction of the camera distance, toward the camera, where stage-mode cursor and chat gaze converges. */
export const STAGE_GAZE_PLANE_FRACTION = 0.6

export interface BodyView {
  mesh: SkinnedMesh
  camera: Camera
  viewport: DOMRect
  gazeMode: 'none' | 'mouse' | 'camera'
  calibration?: CameraCalibration
}

/**
 * Converts Natural's screen-DIP attention into world-space targets for the body director.
 * With `calibration` (stage mode) points unproject onto the plane `0.6 * D` in front of her and the camera point is
 * the calibration eye; without it the legacy raycast onto her head plane applies. Returns null when the frame has no
 * input or the gaze mode is `none`.
 */
export function resolveBodyPoints(
  view: BodyView,
  natural: MMDNaturalAdapter['bodyFrame'],
): { cursor: Vector3 | null, chat: Vector3 | null, camera: Vector3 } | null {
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
 * The body's look-at target: the camera in camera mode, the chat while Natural glances at it, otherwise the point of
 * the director's latest intent.
 */
export function resolveBodyTarget(
  points: ReturnType<typeof resolveBodyPoints>,
  natural: Pick<MMDNaturalAdapter['bodyFrame'], 'onChat'>,
  gazeMode: BodyView['gazeMode'],
  intent: BodyIntent | null,
): Vector3 | null {
  if (!points || gazeMode === 'none')
    return null
  if (gazeMode === 'camera')
    return points.camera
  if (natural.onChat && points.chat)
    return points.chat
  return intent?.attention.point ? new Vector3().copy(intent.attention.point) : null
}
