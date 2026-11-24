import type { MotionTraceBone } from '@proj-airi/motion-driver-humanoid/motion-trace'
import type { DecodedMotionTrace } from '@proj-airi/qa-tools/t2-3d/read-trace'

import type { Vec3 } from '../metrics'
import type { FrameRig, PosedBones } from './pose'
import type { FrameView, Framing, ViewCamera } from './render'

import { MOTION_TRACE_BONES } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { rotate, unwrap, yawQuat } from '@proj-airi/qa-tools/t2-3d/metrics/math'

import { cameraToward, dot } from './render'

/** A drawing centred on one traced bone, `span` model units across, in a square image. */
export interface CloseUp {
  readonly bone: MotionTraceBone
  readonly span: number
}

/** Pixels across a close-up image: a hand of a 20-unit rig at `--span 3` is about 250 pixels long. */
export const CLOSE_UP_SIZE = 400
/** Model units a close-up spans when `--focus` names no `--span`: a hand and the wrist around it on a 20-unit rig. */
export const DEFAULT_CLOSE_UP_SPAN = 3
/**
 * Seconds of root yaw a close-up's facing averages, centred on the frame. The root yaw is the hips' yaw and carries the
 * pelvis twist of every step; one stride of a walk (about 1.1 s) cancels it, so the views do not swing with each step.
 */
export const FACING_WINDOW_SECONDS = 1

const BONES: ReadonlySet<string> = new Set(MOTION_TRACE_BONES)

/** Reads `--focus` and `--span`; null without `--focus`. A string is the usage error the caller reports. */
export function parseCloseUp(focus: string | undefined, span: string | undefined): CloseUp | null | string {
  if (focus === undefined)
    return span === undefined ? null : '--span goes with --focus'
  if (!BONES.has(focus))
    return `--focus takes a traced bone, for example leftHand or rightIndexProximal; got ${focus}`
  const units = span === undefined ? DEFAULT_CLOSE_UP_SPAN : Number(span)
  if (!Number.isFinite(units) || units <= 0)
    return '--span takes model units above 0'
  return { bone: focus as MotionTraceBone, span: units }
}

/** The rig bone the close-up follows, refused (as a string) when the trace or the rig lacks it. */
export function closeUpBone(closeUp: CloseUp, rig: FrameRig, input: DecodedMotionTrace): number | string {
  if (!input.trace.rig.bones.includes(closeUp.bone))
    return `the trace does not record ${closeUp.bone}`
  const index = rig.bones.findIndex(bone => bone.slot === closeUp.bone)
  return index >= 0 ? index : `the model has no bone mapped to ${closeUp.bone}`
}

/** Her facing on every frame: the trace's root yaw averaged over `FACING_WINDOW_SECONDS` centred on the frame. */
export function facingSeries(input: DecodedMotionTrace): Float64Array {
  const frames = input.trace.frames
  const yaw = unwrap(Array.from({ length: frames }, (_, f) => input.root[f * 4 + 3]))
  const half = Math.max(0, Math.round(FACING_WINDOW_SECONDS * input.trace.hz / 2))
  const sums = new Float64Array(frames + 1)
  for (let f = 0; f < frames; f++)
    sums[f + 1] = sums[f] + yaw[f]
  return Float64Array.from({ length: frames }, (_, f) => {
    const from = Math.max(0, f - half)
    const to = Math.min(frames, f + half + 1)
    return (sums[to] - sums[from]) / (to - from)
  })
}

/**
 * A close-up's camera for `view`, turned with her facing so front is always her front. Side looks from the focus
 * bone's own side (her right for a right-side bone), so her body does not hide a right hand.
 */
export function closeUpCamera(view: FrameView, bone: MotionTraceBone, facingYaw: number): ViewCamera {
  const side: Vec3 = bone.startsWith('right') ? [-1, 0, 0] : [1, 0, 0]
  return cameraToward(rotate(yawQuat(facingYaw), view === 'front' ? [0, 0, 1] : side))
}

/** The square framing of a close-up whose centre is `focus` (trace axes), and the centre's position along the camera. */
export function closeUpFraming(camera: ViewCamera, focus: Vec3, span: number, size: number): { framing: Framing, centre: number } {
  return { framing: { width: size, height: size, scale: size / span, top: focus[1] + span / 2 }, centre: dot(camera.across, focus) }
}

/** The focus bone's posed position in the trace's axes, as `skin` places the mesh. */
export function focusPoint(rig: FrameRig, posed: PosedBones, bone: number): Vec3 {
  return rotate(rig.basis, posed.positions[bone])
}
