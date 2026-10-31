import { describe, expect, it } from 'vitest'

import { NaturalBodyLayer } from './body'
import { createRandomStream } from './random'

describe('natural body', () => {
  it('trails a head step by 150-300 ms and settles on the coupling gain', () => {
    const dt = 1 / 120
    const body = new NaturalBodyLayer(createRandomStream(1), [0, 0, 0])
    body.beginShift()
    // Mean delay of a step response: the integral of the remaining fraction.
    const delay = [0, 0, 0]
    let pose = body.pose
    for (let i = 0; i < 3 * 120; i++) {
      pose = body.step(dt, [1, 1, 1])
      pose.forEach((value, axis) => {
        delay[axis] += (1 - value / (axis === 2 ? 0.6 : 0.99)) * dt
      })
    }
    // The residual (SD 0.015) perturbs the integral by a few tens of milliseconds.
    for (const axis of [0, 1, 2]) {
      expect(delay[axis]).toBeGreaterThan(0.1)
      expect(delay[axis]).toBeLessThan(0.35)
    }
    expect(pose[0]).toBeCloseTo(0.99, 1)
    expect(pose[1]).toBeCloseTo(0.99, 1)
    expect(pose[2]).toBeCloseTo(0.6, 1)
  })
})
