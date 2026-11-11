import type { MMD } from '@moeru/three-mmd'
import type { MotionTraceBone, MotionTraceChannels, MotionTraceEvent, MotionTraceRig } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { MMDBodyEvent } from './body/performer'
import type { MMDBodyPose } from './body/pose'
import type { MMDFrameStage } from './frame-pipeline'
import type { MMDRigProfile } from './rig'

import { MOTION_TRACE_BONES, motionTraceParents, MotionTraceRecorder } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { Matrix4, Quaternion, Vector3 } from 'three'

import { HUMANOID_FINGER_CANDIDATES, MMD_CONTROL_BONE_CANDIDATES } from './rig/bone-map'

/**
 * The trace event of a body `blink` or `gaze-shift` at motion time `t`. Both are `marker` events: `blink:<body|natural>`
 * for the source that closes the lids the face shows, and
 * `gaze-shift:<amplitude>:<signed yaw change>:<goal kind>`, angles in degrees with two decimals and the yaw signed
 * explicitly (positive toward the character's left), so a reader of the first field still reads the amplitude.
 */
export function mmdBodyTraceEvent(event: MMDBodyEvent, t: number): MotionTraceEvent {
  // NOTICE:
  // Body blinks and gaze shifts are `marker` events with a fixed label grammar, not kinds of their own.
  // Root cause: the trace v1 reader validates a closed set of event kinds and refuses any other.
  // Source: packages/qa-tools/src/t2-3d/read-trace.ts, `eventSchema`.
  // Removal condition: the reader accepts `blink` and `gaze-shift` kinds.
  return event.kind === 'blink'
    ? { t, kind: 'marker', label: `blink:${event.source}` }
    : { t, kind: 'marker', label: `gaze-shift:${event.amplitudeDeg.toFixed(2)}:${event.yawDeg >= 0 ? '+' : ''}${event.yawDeg.toFixed(2)}:${event.goal}` }
}

/**
 * Read-only, post-physics sampler. The caller starts the recorder with `rig` and
 * supplies channels/wall through `inputs` before stepping. No scene registers it here.
 * `bodyEvent` holds a body event until this frame's sample and stamps it with that sample's time, so every host
 * records an event on the frame in which the performer raised it.
 */
export function createMMDMotionTraceSampler(mmd: MMD, profile: MMDRigProfile, pose: MMDBodyPose) {
  const recorder = new MotionTraceRecorder()
  const inputs: { wall: number | null, channels: MotionTraceChannels } = { wall: null, channels: {} }
  const mesh = mmd.mesh
  const basis = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(pose.right, pose.up, pose.forward)).invert()
  const basisInverse = basis.clone().invert()
  const names: Partial<Record<MotionTraceBone, string>> = { ...profile.bones, ...profile.fingerBones }
  if (profile.eyeSource === 'bothEyes') {
    const both = MMD_CONTROL_BONE_CANDIDATES.bothEyes.find(name => pose.bone(name))
    if (both) {
      names.leftEye = both
      names.rightEye = both
    }
  }
  if (profile.eyeSource === 'none') {
    delete names.leftEye
    delete names.rightEye
  }
  const bones = MOTION_TRACE_BONES.filter(bone => pose.bone(names[bone]))
  const parents = motionTraceParents(bones)
  const bindToMesh = mesh.bindMatrix.clone().invert()
  const entries = bones.map((slot) => {
    const name = names[slot]
    const index = name === undefined ? undefined : pose.indices.get(name)
    const bone = pose.bone(name)
    if (index === undefined || !bone)
      throw new TypeError(`Missing mapped motion trace bone: ${slot}`)
    const rest = bindToMesh.clone().multiply(mesh.skeleton.boneInverses[index].clone().invert())
    const position = new Vector3()
    const rotation = new Quaternion()
    rest.decompose(position, rotation, new Vector3())
    return { bone, position, inverseRest: rotation.invert(), n: new Quaternion() }
  })
  const physicsOwned: MotionTraceBone[] = [...profile.physicsOwnedHumanoid]
  for (const slot of MOTION_TRACE_BONES) {
    if (!(slot in HUMANOID_FINGER_CANDIDATES))
      continue
    const candidates = Object.entries(HUMANOID_FINGER_CANDIDATES).find(([name]) => name === slot)?.[1]
    if (!names[slot] && candidates?.some(name => profile.physicsOwned.includes(name)))
      physicsOwned.push(slot)
  }
  const rig: MotionTraceRig = {
    id: '',
    assetSha256: null,
    legLength: profile.legLength ?? 0,
    bones,
    parents,
    restOffsets: entries.map((entry, index) => {
      const parent = entries[parents[index]]
      const offset = entry.position.clone()
      if (parent)
        offset.sub(parent.position)
      offset.applyQuaternion(basis)
      return [offset.x, offset.y, offset.z]
    }),
    physicsOwned,
    eyeSource: profile.eyeSource,
    hasFingers: bones.some(bone => bone in HUMANOID_FINGER_CANDIDATES),
  }
  const bySlot = new Map(bones.map((slot, index) => [slot, entries[index]]))
  const position = new Vector3()
  const scale = new Vector3()
  const worldScale = new Vector3()
  let elapsed = 0
  const pending: MMDBodyEvent[] = []
  const stage: MMDFrameStage = {
    id: 'motion-trace',
    run(context) {
      if (recorder.state() !== 'recording') {
        pending.length = 0
        return
      }
      elapsed = recorder.frames === 0 ? 0 : elapsed + context.dt
      mesh.updateWorldMatrix(true, true)
      for (const entry of entries) {
        entry.bone.matrixWorld.decompose(position, entry.n, scale)
        // N = W * conj(W0), then conjugate into the fixed trace basis.
        entry.n.multiply(entry.inverseRest).premultiply(basis).multiply(basisInverse).normalize()
      }
      const hips = bySlot.get('hips')
      if (hips)
        position.setFromMatrixPosition(hips.bone.matrixWorld).applyQuaternion(basis)
      else
        position.setFromMatrixPosition(mesh.matrixWorld).applyQuaternion(basis)
      // Bind offsets and leg length use model units, independent of the user's mesh scale.
      worldScale.setFromMatrixScale(mesh.matrixWorld)
      position.divideScalar(worldScale.x)
      recorder.sample(elapsed, inputs.wall ?? performance.now() / 1000, (slot) => {
        const entry = bySlot.get(slot)
        if (!entry)
          throw new TypeError(`Motion trace header differs from sampler rig: ${slot}`)
        return entry.n
      }, position, inputs.channels)
      for (const event of pending)
        recorder.event(mmdBodyTraceEvent(event, elapsed))
      pending.length = 0
    },
  }
  const bodyEvent = (event: MMDBodyEvent) => {
    if (recorder.state() === 'recording')
      pending.push(event)
  }
  return { recorder, stage, rig, inputs, bodyEvent }
}
