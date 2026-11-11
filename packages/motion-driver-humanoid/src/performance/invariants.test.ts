import type { BodyPerformanceInput } from './contracts'

import { describe, expect, it } from 'vitest'

import { createRandomStream } from '../random'
import { BODY_CHANNELS, BODY_TICK, channelIndex, DEG, JOINT_LIMITS } from './channels'
import { BodyCollision } from './collision'
import { createBodyPerformer } from './index'
import { fixtureRigs, idleInput, quietInput } from './performance.test-fixtures'

const traits = fixtureRigs[0].traits
const c = channelIndex

describe('performer invariants', () => {
  it('keeps a neutral toe at zero when the rig has a deforming toe bone', () => {
    const rig = { ...traits, feet: { ...traits.feet, left: { ...traits.feet.left, toeBend: true } } }
    const performer = createBodyPerformer({ traits: rig, seed: 1 })
    const frame = performer.step(quietInput())
    expect(frame.channels[c('leftToeBend')]).toBe(0)
    expect(performer.restChannels()[c('leftToeBend')]).toBe(0)
  })

  it('replays bit-equal seeds and resets the complete state, while distinct seeds differ', () => {
    const first = createBodyPerformer({ traits, seed: 1 })
    const twin = createBodyPerformer({ traits, seed: 1 })
    const other = createBodyPerformer({ traits, seed: 2 })
    const saved: number[][] = []
    let different = false
    for (let i = 0; i < 720; i++) {
      const input = idleInput(i / 120)
      const a = first.step(input).channels.slice()
      expect(a).toEqual(twin.step(input).channels)
      const differentSeed = other.step(input).channels
      different ||= a.some((x, j) => x !== differentSeed[j])
      saved.push(Array.from(a))
    }
    expect(different).toBe(true)
    first.reset()
    for (let i = 0; i < saved.length; i++)
      expect(Array.from(first.step(idleInput(i / 120)).channels)).toEqual(saved[i])
  })

  it('agrees at common display times through a 30/60/120/144 Hz interpolating clock', () => {
    function run(hz: number) {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const samples: number[][] = []
      let tick = 0
      let frame: Float32Array = performer.restChannels()
      for (let display = 1; display <= hz * 6; display++) {
        const from = (display - 1) / hz
        const to = display / hz
        while ((tick + 1) * BODY_TICK <= to + 1e-10) {
          const time = (tick + 1) * BODY_TICK
          const fraction = (time - from) / (to - from)
          const yaw = from * 0.08 + (to * 0.08 - from * 0.08) * fraction
          const input = idleInput(time)
          frame = performer.step({ ...input, gaze: { ...input.gaze, yaw } }).channels
          tick++
        }
        if (display % hz === 0)
          samples.push(Array.from(frame))
      }
      return samples
    }
    const reference = run(120)
    expect(reference[0]).not.toEqual(reference[5])
    for (const hz of [30, 60, 144]) {
      const samples = run(hz)
      for (let t = 0; t < samples.length; t++) {
        for (let j = 0; j < BODY_CHANNELS.length; j++)
          expect(Math.abs(samples[t][j] - reference[t][j])).toBeLessThan(1e-6)
      }
    }
  })

  it('keeps all channels finite, within anatomical bounds, and continuous under random target cuts', () => {
    const performer = createBodyPerformer({ traits, seed: 11 })
    const random = createRandomStream(27)
    let previous = performer.restChannels()
    let maxChange = 0
    let finite = true
    let eyeYaw = 0
    let eyePitch = 0
    const minima = new Float64Array(BODY_CHANNELS.length).fill(Infinity)
    const maxima = new Float64Array(BODY_CHANNELS.length).fill(-Infinity)
    for (let tick = 0; tick < 3600; tick++) {
      const input = idleInput(tick / 120)
      const frame = performer.step({
        ...input,
        head: { ...input.head, attitude: { yaw: random() * 3 - 1.5, pitch: random() * 2 - 1, roll: random() - 0.5 } },
        gaze: { ...input.gaze, yaw: (random() * 2 - 1) * Math.PI, pitch: random() - 0.5, saccadeSeq: tick },
        posture: { amplitude: random() * 2, shiftRate: 1, support: random() * 2 - 1 },
      })
      for (let j = 0; j < frame.channels.length; j++) {
        finite &&= Number.isFinite(frame.channels[j])
        minima[j] = Math.min(minima[j], frame.channels[j])
        maxima[j] = Math.max(maxima[j], frame.channels[j])
        maxChange = Math.max(maxChange, Math.abs(frame.channels[j] - previous[j]))
      }
      eyeYaw = Math.max(eyeYaw, Math.abs(frame.eyes.yaw))
      eyePitch = Math.max(eyePitch, Math.abs(frame.eyes.pitch))
      previous = frame.channels.slice()
    }
    expect(finite).toBe(true)
    for (let j = 0; j < minima.length; j++) {
      expect(minima[j]).toBeGreaterThanOrEqual(JOINT_LIMITS[j][0] - 1e-7)
      expect(maxima[j]).toBeLessThanOrEqual(JOINT_LIMITS[j][1] + 1e-7)
    }
    expect(eyeYaw).toBeLessThanOrEqual(traits.eyeYawLimit)
    expect(eyePitch).toBeLessThanOrEqual(traits.eyePitchLimit)
    expect(maxChange).toBeGreaterThan(1e-5)
    expect(maxChange).toBeLessThan(12 * DEG)
  })

  it.each(fixtureRigs)('clears torso and head proxies for 60 seconds of extremes on $name', ({ traits }) => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const checker = new BodyCollision(traits, performer.restChannels())
    let maxDepth = 0
    let movement = 0
    for (let tick = 0; tick < 60 * 120; tick++) {
      const input = idleInput(tick / 120)
      const support = tick % 960 < 480 ? -1 : 1
      const frame = performer.step({
        ...input,
        posture: { ...input.posture, support },
        gaze: { ...input.gaze, yaw: support * 80 * DEG, pitch: Math.sin(tick / 240) * 20 * DEG, saccadeSeq: Math.floor(tick / 480) },
      })
      checker.prepare(frame.channels)
      maxDepth = Math.max(maxDepth, checker.measure('left', frame.channels).depth, checker.measure('right', frame.channels).depth)
      movement = Math.max(movement, Math.abs(frame.channels[c('hipsRoll')]))
    }
    expect(movement).toBeGreaterThan(DEG)
    expect(maxDepth).toBe(0)
  })

  it('keeps follower state warm under clip ownership without scaling it twice', () => {
    const visible = createBodyPerformer({ traits, seed: 9 })
    const owned = createBodyPerformer({ traits, seed: 9 })
    let travelled = 0
    for (let i = 0; i < 600; i++) {
      const input = idleInput(i / 120)
      const hidden: BodyPerformanceInput = { ...input, owned: { ...input.owned, leftArm: i < 500 ? 1 : 0 } }
      const a = visible.step(input).channels
      const b = owned.step(hidden).channels
      expect(b).toEqual(a)
      travelled += Math.abs(a[c('leftFlex')])
    }
    expect(travelled).toBeGreaterThan(1)
  })

  it('drops pelvis translation without leg IK while retaining weight rotation', () => {
    const performer = createBodyPerformer({ traits: { ...traits, legIk: false }, seed: 1 })
    let rotation = 0
    for (let i = 0; i < 600; i++) {
      const input = quietInput(i / 120)
      const frame = performer.step({ ...input, posture: { ...input.posture, support: 1 } })
      expect(frame.pelvis).toEqual({ x: 0, y: 0, z: 0 })
      rotation = frame.channels[c('hipsRoll')]
    }
    expect(rotation).toBeLessThan(-DEG)
  })
})
