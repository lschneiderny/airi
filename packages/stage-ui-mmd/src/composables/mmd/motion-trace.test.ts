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
