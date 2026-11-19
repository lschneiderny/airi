import type { DecodedMotionTrace } from '../t2-3d/read-trace'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { describe, expect, it } from 'vitest'

import { analyticTrace, TEST_BONES } from '../t2-3d/metrics/test-trace'
import { frameGapFigures } from './frame-gap'

const stride = MOTION_TRACE_CHANNELS.length

/** Delays every frame from `frame` on by `seconds`, in motion and wall time alike, as a stalled renderer does. */
function stall(input: DecodedMotionTrace, frame: number, seconds: number): DecodedMotionTrace {
  for (let index = frame; index < input.trace.frames; index++) {
    input.channels[index * stride] += seconds
    input.channels[index * stride + 1] += seconds
  }
  return input
}

describe('frameGapFigures', () => {
  // 12 s at 60 Hz: 720 intervals, so four 45 ms intervals exceed the 0.5 % allowance and three do not.
  const cases: { name: string, input: () => DecodedMotionTrace, exceeded: string[] }[] = [
    { name: 'a clean trace', input: () => analyticTrace({ seconds: 12, bones: TEST_BONES }), exceeded: [] },
    { name: 'one 48 ms interval', input: () => stall(analyticTrace({ seconds: 12, bones: TEST_BONES }), 100, 0.048 - 1 / 60), exceeded: [] },
    { name: 'one 50 ms interval', input: () => stall(analyticTrace({ seconds: 12, bones: TEST_BONES }), 100, 0.05 - 1 / 60), exceeded: ['max-interval'] },
    { name: 'three 45 ms intervals', input: () => [100, 200, 300].reduce((trace, frame) => stall(trace, frame, 0.045 - 1 / 60), analyticTrace({ seconds: 12, bones: TEST_BONES })), exceeded: [] },
    { name: 'four 45 ms intervals', input: () => [100, 200, 300, 400].reduce((trace, frame) => stall(trace, frame, 0.045 - 1 / 60), analyticTrace({ seconds: 12, bones: TEST_BONES })), exceeded: ['long-intervals'] },
    { name: 'wall time drifting 110 ms', input: () => {
      const input = analyticTrace({ seconds: 12, bones: TEST_BONES })
      input.channels[500 * stride + 1] += 0.11
      return input
    }, exceeded: ['wall-drift'] },
  ]

  it.each(cases)('flags $name', ({ input, exceeded }) => {
    const trace = input()
    const figures = frameGapFigures(trace.channels, trace.trace.frames)

    expect(figures.exceeded).toEqual(exceeded)
  })

  it('states the worst interval, the long fraction and the drift in milliseconds', () => {
    const trace = stall(analyticTrace({ seconds: 12, bones: TEST_BONES }), 100, 0.05 - 1 / 60)
    const figures = frameGapFigures(trace.channels, trace.trace.frames)

    expect(figures.maxIntervalMs).toBeCloseTo(50, 1)
    expect(figures.longIntervals).toBe(1)
    expect(figures.longFraction).toBeCloseTo(1 / 720, 6)
    expect(figures.wallDriftMs).toBeCloseTo(0, 3)
  })
})
