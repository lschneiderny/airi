import type { DecodedMotionTrace } from '@proj-airi/qa-tools/t2-3d/read-trace'

import { MOTION_TRACE_CHANNELS } from '@proj-airi/motion-driver-humanoid/motion-trace'
import { frameGapFigures } from '@proj-airi/qa-tools/stage/frame-gap'
import { analyticTrace } from '@proj-airi/qa-tools/t2-3d/metrics/test-trace'
import { describe, expect, it } from 'vitest'

import { CORE } from '../metrics/bones'
import { checkKinematics, GateRefusal } from './refusals'

const stride = MOTION_TRACE_CHANNELS.length

/** Delays every frame from `frame` on by `seconds`, in motion and wall time alike, as a stalled renderer does. */
function stall(input: DecodedMotionTrace, frame: number, seconds: number): DecodedMotionTrace {
  for (let index = frame; index < input.trace.frames; index++) {
    input.channels[index * stride] += seconds
    input.channels[index * stride + 1] += seconds
  }
  return input
}

function gateRefusesFrameGap(input: DecodedMotionTrace): boolean {
  try {
    checkKinematics(input)
    return false
  }
  catch (error) {
    if (!(error instanceof GateRefusal))
      throw error
    return error.name === 'frame-gap'
  }
}

describe('qa:stage frame-gap figures and the motion3d gate', () => {
  // 12 s at 60 Hz: 720 intervals, so four 45 ms intervals exceed the 0.5 % allowance and three do not.
  const cases: { name: string, input: () => DecodedMotionTrace, exceeded: string[] }[] = [
    { name: 'a clean trace', input: () => analyticTrace({ seconds: 12, bones: CORE }), exceeded: [] },
    { name: 'one 48 ms interval', input: () => stall(analyticTrace({ seconds: 12, bones: CORE }), 100, 0.048 - 1 / 60), exceeded: [] },
    { name: 'one 50 ms interval', input: () => stall(analyticTrace({ seconds: 12, bones: CORE }), 100, 0.05 - 1 / 60), exceeded: ['max-interval'] },
    { name: 'three 45 ms intervals', input: () => [100, 200, 300].reduce((trace, frame) => stall(trace, frame, 0.045 - 1 / 60), analyticTrace({ seconds: 12, bones: CORE })), exceeded: [] },
    { name: 'four 45 ms intervals', input: () => [100, 200, 300, 400].reduce((trace, frame) => stall(trace, frame, 0.045 - 1 / 60), analyticTrace({ seconds: 12, bones: CORE })), exceeded: ['long-intervals'] },
    { name: 'wall time drifting 110 ms', input: () => {
      const input = analyticTrace({ seconds: 12, bones: CORE })
      input.channels[500 * stride + 1] += 0.11
      return input
    }, exceeded: ['wall-drift'] },
  ]

  it.each(cases)('agrees with the motion3d gate on $name', ({ input, exceeded }) => {
    const trace = input()
    const figures = frameGapFigures(trace.channels, trace.trace.frames)

    expect(figures.exceeded).toEqual(exceeded)
    expect(gateRefusesFrameGap(trace)).toBe(exceeded.length > 0)
  })
})
