import { decodeBlock } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { Quaternion, Vector3 } from 'three'
import { expect, it } from 'vitest'

import { bodyFixture } from './body/fixture'
import { MMDBodyPose } from './body/pose'
import { createMMDMotionTraceSampler } from './motion-trace'

it('records bind rotations as identity and a world-axis rotation independently of the bind axes', () => {
  const { mmd, rig, bone, pipeline, mixer } = bodyFixture(0.7)
  const sampler = createMMDMotionTraceSampler(mmd, rig, new MMDBodyPose(mmd, rig))
  sampler.recorder.start({
    kind: 'motion-trace',
    version: 1,
    source: { level: 't2-3d', scenario: { id: 'test', class: 'idle', seed: 1 }, gitSha: null, dirty: null, stages: { pose: [], surface: ['motion-trace'] }, omitted: [], detail: {} },
    rig: { ...sampler.rig, id: 'fixture' },
    hz: 60,
    scoredFrom: 0,
  })
  const context = { dt: 1 / 60, mmd, mixer, clean: pipeline.clean }
  sampler.inputs.wall = 0
  sampler.stage.run(context)
  const angle = 0.4
  const rotation = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), angle)
  bone('左目').quaternion.premultiply(rotation)
  sampler.inputs.wall = 1 / 60
  sampler.stage.run(context)
  sampler.recorder.stop()
  const n = sampler.rig.bones.length
  const data = decodeBlock(sampler.recorder.drain().rot, 2 * n * 4)
  for (let i = 0; i < n; i++)
    expect([...data.subarray(i * 4, i * 4 + 4)]).toEqual([0, 0, 0, 1])
  const offset = (n + sampler.rig.bones.indexOf('leftEye')) * 4
  const actual = new Quaternion().fromArray(data, offset)
  expect(actual.angleTo(rotation)).toBeLessThan(0.0005)
  mmd.dispose()
})

it('keeps root translations in model units and rotations unchanged under uniform world scale', () => {
  const { mmd, rig, bone, pipeline, mixer, mesh } = bodyFixture()
  const sampler = createMMDMotionTraceSampler(mmd, rig, new MMDBodyPose(mmd, rig))
  sampler.recorder.start({
    kind: 'motion-trace',
    version: 1,
    source: { level: 't2-3d', scenario: { id: 'test', class: 'idle', seed: 1 }, gitSha: null, dirty: null, stages: { pose: [], surface: ['motion-trace'] }, omitted: [], detail: {} },
    rig: { ...sampler.rig, id: 'fixture' },
    hz: 60,
    scoredFrom: 0,
  })
  const context = { dt: 1 / 60, mmd, mixer, clean: pipeline.clean }
  bone('頭').quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.4)
  sampler.inputs.wall = 0
  sampler.stage.run(context)
  mesh.scale.setScalar(2)
  bone('下半身').position.x += 3
  sampler.inputs.wall = 1 / 60
  sampler.stage.run(context)
  sampler.recorder.stop()
  const data = sampler.recorder.drain()
  const root = decodeBlock(data.root, 8)
  expect(root[4] - root[0]).toBeCloseTo(3, 6)
  expect(root[5]).toBeCloseTo(root[1], 6)
  const stride = sampler.rig.bones.length * 4
  const rot = decodeBlock(data.rot, stride * 2)
  for (let i = 0; i < stride; i++)
    expect(rot[stride + i]).toBeCloseTo(rot[i], 6)
  mmd.dispose()
})

it('stamps a body event with the time of the frame that raised it and drops one raised while idle', () => {
  const { mmd, rig, pipeline, mixer } = bodyFixture()
  const sampler = createMMDMotionTraceSampler(mmd, rig, new MMDBodyPose(mmd, rig))
  const context = { dt: 1 / 60, mmd, mixer, clean: pipeline.clean }
  sampler.bodyEvent({ kind: 'blink' })
  sampler.recorder.start({
    kind: 'motion-trace',
    version: 1,
    source: { level: 't2-3d', scenario: { id: 'test', class: 'gaze', seed: 1 }, gitSha: null, dirty: null, stages: { pose: [], surface: ['motion-trace'] }, omitted: [], detail: {} },
    rig: { ...sampler.rig, id: 'fixture' },
    hz: 60,
    scoredFrom: 0,
  })
  sampler.inputs.wall = 0
  sampler.stage.run(context)
  // Body events fire in the `locomotion` pose stage, before this frame's `motion-trace` sample.
  sampler.bodyEvent({ kind: 'gaze-shift', amplitudeDeg: 40, yawDeg: -38.5, goal: 'sustained' })
  sampler.inputs.wall = 1 / 60
  sampler.stage.run(context)
  sampler.recorder.stop()
  expect(sampler.recorder.drain().events).toEqual([{ t: 1 / 60, kind: 'marker', label: 'gaze-shift:40.00:-38.50:sustained' }])
  mmd.dispose()
})
