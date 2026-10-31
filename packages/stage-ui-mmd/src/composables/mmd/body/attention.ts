import type { CameraCalibration } from '@proj-airi/stage-shared/stage-world'
import type { Camera, SkinnedMesh } from 'three'

import type { MMDNaturalAdapter } from '../natural/adapter'

import { decideBody, initialBodyDirectorMemory, NO_WORLD_BODY_INPUT } from '@proj-airi/motion-driver-humanoid/director'
import { dipToPlane } from '@proj-airi/stage-shared/stage-world'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'

import { projectMMDHead } from '../natural/adapter'

/** Fraction of the camera distance, toward the camera, where stage-mode cursor and chat gaze converges. */
export const STAGE_GAZE_PLANE_FRACTION = 0.6

/**
 * Converts Natural's screen-DIP attention into a world-space stage-plane target.
 * With `calibration` (stage mode) points unproject onto the plane `0.6 * D` in front of her and the camera point is
 * the calibration eye; without it the legacy raycast onto her head plane applies.
 */
export function resolveBodyTarget(
  view: { mesh: SkinnedMesh, camera: Camera, viewport: DOMRect, gazeMode: 'none' | 'mouse' | 'camera', calibration?: CameraCalibration },
  natural: MMDNaturalAdapter['bodyFrame'],
): Vector3 | null {
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
  if (view.gazeMode === 'camera')
    return cameraPoint
  const chatPoint = point(input.chat?.target ?? null)
  if (natural.onChat && chatPoint)
    return chatPoint
  const { intent } = decideBody({
    nowMs: 0,
    performance: input.performance,
    cursorPoint: point(input.cursor),
    chatPoint,
    cameraPoint,
    slots: { sit: false, sleep: false },
    ...NO_WORLD_BODY_INPUT,
    interactionSeq: 0,
    chatSendSeq: 0,
    interactionAtMs: null,
    actionRequest: null,
    actionFeedback: null,
    dragging: false,
  }, initialBodyDirectorMemory)
  return intent.attention.point ? new Vector3().copy(intent.attention.point) : null
}
