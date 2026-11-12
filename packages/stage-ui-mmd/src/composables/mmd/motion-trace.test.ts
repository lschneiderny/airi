import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { decodeBlock } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { Quaternion, Vector3 } from 'three'
import { expect, it } from 'vitest'

import { bodyFixture } from './body/fixture'
import { MMDBodyPose } from './body/pose'
import { createMMDMotionTraceSampler, mmdBodyTraceEvent } from './motion-trace'

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
  sampler.bodyEvent({ kind: 'blink', source: 'body' })
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

const markerLabel = (event: MotionTraceEvent) => event.kind === 'marker' ? event.label : ''

it('records the registered layers\' cue, emotion, reaction and gesture markers on the frame that raised them', () => {
  const { mmd, rig, pipeline, body, input, setInput } = bodyFixture()
  const sampler = createMMDMotionTraceSampler(mmd, rig, new MMDBodyPose(mmd, rig))
  let frame = 0
  const raised: { label: string, t: number }[] = []
  body.onEvent((event) => {
    if (event.kind !== 'blink' && event.kind !== 'gaze-shift')
      raised.push({ label: markerLabel(mmdBodyTraceEvent(event, 0)), t: frame / 60 })
    sampler.bodyEvent(event)
  })
  pipeline.surfaceStages.push(sampler.stage)
  sampler.recorder.start({
    kind: 'motion-trace',
    version: 1,
    source: { level: 't2-3d', scenario: { id: 'test', class: 'talk', seed: 1 }, gitSha: null, dirty: null, stages: { pose: [], surface: ['motion-trace'] }, omitted: [], detail: {} },
    rig: { ...sampler.rig, id: 'fixture' },
    hz: 60,
    scoredFrom: 0,
  })
  const base = input.intent
  let onsetSeq = 0
  let slow = 0
  for (frame = 0; frame < 300; frame++) {
    const t = frame / 60
    // One utterance from 0.5 s to 4 s whose voice rises over 50 ms into an onset every 0.8 s, a nod at 1 s, a held
    // happy from 1.5 s and a body poke at 2 s.
    const phase = (t - 0.7) % 0.8
    const speaking = t >= 0.5 && t < 4
    const rising = speaking && t >= 0.7 && phase >= 0 && phase < 0.05
    if (speaking && t >= 0.7 && Math.abs(phase - 0.05) < 1 / 120)
      onsetSeq++
    const level = !speaking ? 0 : rising ? 0.1 + 0.35 * phase / 0.05 : phase < 0.15 ? 0.45 : 0.1
    slow = level + (slow - level) * Math.exp(-1 / 60 / 0.25)
    setInput({
      intent: {
        ...base,
        voice: { ...base.voice, speaking, level, slow, onsetSeq },
        cue: t < 1 ? null : { seq: 1, start: 1, end: 1.45, kind: 'nod', count: 1, side: 1 },
        held: t < 1.5 ? base.held : { emotion: 'happy', strength: 1, level: 1, side: 1 },
        touch: { ...base.touch, poke: t < 2 ? null : { seq: 1, at: 2, region: 'body', x: 0.3, y: 0 } },
      },
    })
    sampler.inputs.wall = t
    pipeline.step(1 / 60)
  }
  sampler.recorder.stop()
  const markers = (sampler.recorder.drain().events ?? []).filter(event => event.kind === 'marker' && !/^(?:blink|gaze-shift):/.test(event.label))
  const labels = markers.map(markerLabel)
  expect(labels).toEqual(expect.arrayContaining(['cue:nod:1', 'emotion-posture:happy:onset', 'reaction:body-poke', 'gesture-unit:start']))
  expect(labels.some(label => label.startsWith('gesture-stroke:'))).toBe(true)
  expect(labels).toEqual(raised.map(event => event.label))
  markers.forEach((event, index) => expect(event.t).toBeCloseTo(raised[index]?.t ?? Number.NaN, 9))
  mmd.dispose()
})
