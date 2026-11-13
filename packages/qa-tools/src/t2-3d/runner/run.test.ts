import process from 'node:process'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { Quaternion, Vector3 } from 'three'
import { expect, it } from 'vitest'

import { QA_IDLE_DRIVE } from '../idle-drive'
import { parseTrace } from '../read-trace'
import { runMotion3dScenario } from './run'

it.runIf(process.env.AIRI_QA_MMD_MODEL)('records the stance reason on each change only in a scenario that asks for it', async () => {
  const model = process.env.AIRI_QA_MMD_MODEL
  if (!model)
    throw new Error('AIRI_QA_MMD_MODEL is required')
  const stanceMarkers = async (recordStance: boolean) => {
    const { trace } = await runMotion3dScenario({
      model,
      seed: 1,
      seconds: 1,
      warmupSeconds: 0,
      acts: 'on',
      git: { gitSha: 'test', dirty: false },
      signal: new AbortController().signal,
      scenario: { version: 1, id: 'stance', class: 'idle', seconds: 1, warmupSeconds: 0, recordStance, timeline: () => [{ at: 0.5, kind: 'activity', mode: 'idle', away: true }] },
    })
    return trace.events.flatMap(event => event.kind === 'marker' && event.label.startsWith('stance:') ? [[Math.round(event.t * 60), event.label]] : [])
  }
  expect(await stanceMarkers(true)).toEqual([[0, 'stance:no-sit-slot'], [30, 'stance:no-sleep-slot']])
  expect(await stanceMarkers(false)).toEqual([])
}, 60_000)

it.runIf(process.env.AIRI_QA_MMD_MODEL)('sets a scenario\'s idle drive, names it in the provenance and records the scheduler\'s reports, and sets none with acts off', async () => {
  const model = process.env.AIRI_QA_MMD_MODEL
  if (!model)
    throw new Error('AIRI_QA_MMD_MODEL is required')
  const run = async (acts: 'on' | 'off') => {
    const { trace } = await runMotion3dScenario({
      model,
      seed: 1,
      seconds: 31,
      warmupSeconds: 0,
      acts,
      git: { gitSha: 'test', dirty: false },
      signal: new AbortController().signal,
      scenario: { version: 1, id: 'drive', class: 'idle', seconds: 31, warmupSeconds: 0, idleDrive: { name: 'test-drive', drive: QA_IDLE_DRIVE }, timeline: () => [{ at: 0.5, kind: 'activity', mode: 'idle', away: true }] },
    })
    return { detail: trace.source.detail, idle: trace.events.flatMap(event => event.kind === 'marker' && event.label.startsWith('idle:') ? [[event.t, event.label] as const] : []) }
  }
  const on = await run('on')
  expect(on.detail.idleDrive).toBe('test-drive')
  expect(JSON.parse(String(on.detail.idleDriveValues))).toEqual(QA_IDLE_DRIVE)
  // Away from 0.5 s, she falls asleep 12 to 30 s later (the scheduler's sleep delay) and is still asleep at the end.
  expect(on.idle.map(([, label]) => label)).toEqual(['idle:sleep:start'])
  expect(on.idle[0][0] - 0.5).toBeGreaterThanOrEqual(12 - 1 / 60)
  expect(on.idle[0][0] - 0.5).toBeLessThanOrEqual(30 + 1 / 30)
  const off = await run('off')
  expect(off.idle).toEqual([])
  expect(['idleDrive', 'idleDriveValues'].filter(key => key in off.detail)).toEqual([])
  expect(off.detail.acts).toBe('off')
}, 90_000)

it.runIf(process.env.AIRI_QA_MMD_MODEL)('turns toward six gaze targets with increasing head yaw on each side and looks back at the camera after each look', async () => {
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
        acts: 'on',
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
      // The look runs from the first sustained gaze-shift marker after the cue to the next marker of another kind. The body
      // aims at the cursor only while Natural fixates it, so the run's last second can fall after Natural released the cursor.
      const shifts = trace.events.flatMap(event => event.kind === 'marker' && event.label.startsWith('gaze-shift:')
        ? [{ t: event.t, kind: event.label.split(':')[3] }]
        : [])
      // Seed 1 engages Natural at all six targets, including the medium-distance 80-degree cursor it may also ignore.
      const start = shifts.find(shift => shift.t >= 1 && shift.kind === 'sustained')
      if (!start)
        throw new Error(`no sustained look toward ${targetDegrees} degrees after the cue`)
      // A look that never ends is the body staring at the cursor while Natural looks away.
      const end = shifts.find(shift => shift.t > start.t && shift.kind !== 'sustained')
      if (!end)
        throw new Error(`the look toward ${targetDegrees} degrees never ends`)
      const endFrame = Math.round(end.t * trace.hz)
      const look = Array.from({ length: trace.hz / 4 }, (_, frame) => orientations(endFrame - trace.hz / 4 + frame))
      const headYawDegrees = meanDegrees(look.map(frame => yaw(frame.world[head])))
      const eyeYawDegrees = meanDegrees(look.flatMap(frame => eyes.map(eye => yaw(frame.local[eye]))))
      const eyeWorldYawDegrees = meanDegrees(look.flatMap(frame => eyes.map(eye => yaw(frame.world[eye]))))
      const gazeYawDegrees = (frame: number) => meanDegrees(eyes.map(eye => yaw(orientations(frame).world[eye])))
      const backFrame = Array.from({ length: trace.hz }, (_, frame) => endFrame + 1 + frame)
        .find(frame => frame < trace.frames && Math.abs(gazeYawDegrees(frame)) < 5)
      process.stdout.write(`GAZE_BASELINE ${JSON.stringify({ targetDegrees, lookStart: start.t, lookEnd: end.t, headYawDegrees, eyeYawDegrees, eyeWorldYawDegrees, headBeforeDegrees: before, backSeconds: backFrame === undefined ? null : (backFrame - endFrame) / trace.hz })}\n`)
      expect(side * (headYawDegrees - before)).toBeGreaterThanOrEqual(3)
      expect(side * headYawDegrees).toBeGreaterThan(previous)
      expect(Math.abs(eyeWorldYawDegrees - targetDegrees)).toBeLessThanOrEqual(5)
      expect(backFrame, `gaze back within 5 degrees of the camera within 1 s after the look toward ${targetDegrees} degrees`).toBeDefined()
      previous = side * headYawDegrees
      const wall = MOTION_TRACE_CHANNELS.indexOf('wall')
      expect(decoded.channels[wall]).toBe(0)
      for (let frame = 0; frame < trace.frames; frame++)
        expect(decoded.channels[frame * MOTION_TRACE_CHANNELS.length + wall]).toBe(decoded.channels[frame * MOTION_TRACE_CHANNELS.length])
    }
  }
}, 90_000)
