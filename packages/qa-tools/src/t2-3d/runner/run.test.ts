import process from 'node:process'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { Quaternion, Vector3 } from 'three'
import { expect, it } from 'vitest'

import { parseTrace } from '../read-trace'
import { runMotion3dScenario } from './run'

it.runIf(process.env.AIRI_QA_MMD_MODEL)('turns toward six gaze targets with increasing settled head yaw on each side', async () => {
  const model = process.env.AIRI_QA_MMD_MODEL
  if (!model)
    throw new Error('AIRI_QA_MMD_MODEL is required')
  const yaw = (rotation: Quaternion) => {
    const forward = new Vector3(0, 0, 1).applyQuaternion(rotation)
    return Math.atan2(forward.x, forward.z)
  }
  const meanDegrees = (angles: number[]) => Math.atan2(
    angles.reduce((sum, angle) => sum + Math.sin(angle), 0),
    angles.reduce((sum, angle) => sum + Math.cos(angle), 0),
  ) * 180 / Math.PI
  for (const side of [-1, 1]) {
    let previous = 0
    for (const magnitude of [15, 40, 80]) {
      const targetDegrees = side * magnitude
      const { trace } = await runMotion3dScenario({
        model,
        seed: 1,
        seconds: 6,
        warmupSeconds: 0,
        git: { gitSha: 'test', dirty: false },
        signal: new AbortController().signal,
        scenario: {
          version: 1,
          id: `gaze-${targetDegrees}`,
          class: 'gaze',
          seconds: 6,
          warmupSeconds: 0,
          timeline: () => [{ at: 1, kind: 'gaze', cursor: { x: 3 * Math.sin(targetDegrees * Math.PI / 180), y: 0 } }],
        },
      })
      const decoded = parseTrace(trace)
      const head = trace.rig.bones.indexOf('head')
      const eyes = ['leftEye', 'rightEye'].map(name => trace.rig.bones.findIndex(bone => bone === name))
      expect(head).toBeGreaterThanOrEqual(0)
      expect(eyes.every(index => index >= 0)).toBe(true)
      const orientations = (frame: number) => {
        const world: Quaternion[] = []
        const local: Quaternion[] = []
        for (let bone = 0; bone < trace.rig.bones.length; bone++) {
          const rotation = new Quaternion().fromArray(decoded.rot, (frame * trace.rig.bones.length + bone) * 4)
          const parent = trace.rig.parents[bone]
          const ancestor = parent < 0
            ? new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), decoded.root[frame * 4 + 3])
            : world[parent].clone()
          local.push(rotation)
          world.push(ancestor.multiply(rotation))
        }
        return { world, local }
      }
      const before = yaw(orientations(59).world[head]) * 180 / Math.PI
      // Mean over the last second of the five-second hold, in trace world axes.
      const settled = Array.from({ length: 60 }, (_, frame) => orientations(trace.frames - 60 + frame))
      const headYawDegrees = meanDegrees(settled.map(frame => yaw(frame.world[head])))
      const eyeYawDegrees = meanDegrees(settled.flatMap(frame => eyes.map(eye => yaw(frame.local[eye]))))
      const eyeWorldYawDegrees = meanDegrees(settled.flatMap(frame => eyes.map(eye => yaw(frame.world[eye]))))
      process.stdout.write(`GAZE_BASELINE ${JSON.stringify({ targetDegrees, headYawDegrees, eyeYawDegrees, eyeWorldYawDegrees, headBeforeDegrees: before })}\n`)
      expect(side * (headYawDegrees - before)).toBeGreaterThanOrEqual(3)
      expect(side * headYawDegrees).toBeGreaterThan(previous)
      previous = side * headYawDegrees
      const wall = MOTION_TRACE_CHANNELS.indexOf('wall')
      expect(decoded.channels[wall]).toBe(0)
      for (let frame = 0; frame < trace.frames; frame++)
        expect(decoded.channels[frame * MOTION_TRACE_CHANNELS.length + wall]).toBe(decoded.channels[frame * MOTION_TRACE_CHANNELS.length])
    }
  }
}, 90_000)
