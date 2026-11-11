import type { PerformanceLayer } from './stack'

import { describe, expect, it } from 'vitest'

import { BODY_CHANNELS, channelIndex } from './channels'
import { createBodyPerformer } from './index'
import { fixtureRigs, quietInput } from './performance.test-fixtures'

const traits = fixtureRigs[0].traits
const index = channelIndex('lowerYaw')

describe('performance layer stack', () => {
  it('orders later mixed layers above early overrides and ignores unmasked channels', () => {
    const mask = new Float64Array(BODY_CHANNELS.length)
    mask[index] = 1
    const early = new Float64Array(BODY_CHANNELS.length).fill(1)
    early[index] = 0.12
    const late = new Float64Array(BODY_CHANNELS.length)
    late[index] = -0.04
    const additive = new Float64Array(BODY_CHANNELS.length)
    additive[channelIndex('upperYaw')] = 0.03
    const layers: PerformanceLayer[] = [
      { id: 'cue', order: 'cue', mode: 'override', mask, enterSeconds: 0, step: () => ({ channels: late, additive, weight: 1, sequence: 0 }), reset() {} },
      { id: 'emotion', order: 'emotion', mode: 'override', mask, enterSeconds: 0, step: () => ({ channels: early, weight: 1, sequence: 0 }), reset() {} },
    ]
    const frame = createBodyPerformer({ traits, seed: 1, layers }).step(quietInput())
    expect(frame.channels[index]).toBeCloseTo(-0.04)
    expect(frame.channels[channelIndex('upperYaw')]).toBeCloseTo(0.03)
    expect(frame.channels[channelIndex('midYaw')]).toBe(0)
  })

  it('preserves position across repeated cuts and settles to the final target', () => {
    const mask = new Float64Array(BODY_CHANNELS.length)
    mask[index] = 1
    const channels = new Float64Array(BODY_CHANNELS.length)
    channels[index] = 0.1
    let sequence = 0
    const layer: PerformanceLayer = {
      id: 'act',
      order: 'act',
      mode: 'override',
      mask,
      enterSeconds: 0,
      step: () => ({ channels, weight: 1, sequence }),
      reset() {},
    }
    const performer = createBodyPerformer({ traits, seed: 1, layers: [layer] })
    let previous = performer.step(quietInput()).channels[index]
    for (const target of [-0.1, 0.15, -0.05]) {
      channels[index] = target
      sequence++
      const atCut = performer.step(quietInput()).channels[index]
      expect(atCut).toBe(previous)
      for (let tick = 0; tick < 10; tick++)
        previous = performer.step(quietInput()).channels[index]
    }
    for (let i = 0; i < 600; i++)
      previous = performer.step(quietInput()).channels[index]
    expect(previous).toBeCloseTo(-0.05, 5)
  })

  it('lets an act plan support and gaze before generators on the same tick', () => {
    const mask = new Float64Array(BODY_CHANNELS.length)
    const channels = new Float64Array(BODY_CHANNELS.length)
    const layer: PerformanceLayer = {
      id: 'planned-act',
      order: 'act',
      mode: 'override',
      mask,
      plan: () => ({ support: 1, gaze: { yaw: 0.6, pitch: 0, kind: 'sustained' } }),
      step: () => ({ channels, weight: 1, sequence: 0 }),
      reset() {},
    }
    const performer = createBodyPerformer({ traits, seed: 1, layers: [layer] })
    const input = quietInput()
    const frame = performer.step(input)
    expect(frame.diagnostics.shiftTarget).toBe(1)
    expect(frame.gaze.yaw).toBeGreaterThan(0)
    expect(input.posture.support).toBe(0)
    expect(input.gaze.yaw).toBe(0)
  })
})
