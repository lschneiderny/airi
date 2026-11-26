import { describe, expect, it } from 'vitest'

import { HungBodySmoothing, hungBodySmoothingSeconds } from './hung-body-smoothing'
import { NaturalMotion } from './natural-motion'

const hz = 120

/** Head yaw per grid step of an idle run; `shakeAt` plays a two-cycle shake cue at that second. */
function headYaw(hung: boolean, seconds: number, shakeAt?: number) {
  const motion = new NaturalMotion({ seed: 5 })
  motion.setPerformance({ mode: 'idle', attention: 'camera', away: false }, 0.5, 0)
  motion.setRigTraits({ bodyFromHeadPhysics: { x: hung, y: false, z: false } })
  return Array.from({ length: seconds * hz }, (_, index) => {
    if (index === (shakeAt ?? -1) * hz)
      motion.gesture('shake', 2, index / hz)
    return motion.advance((index + 1) / hz).pose.headX
  })
}

/** Root mean square of the second difference: how hard the command starts and reverses. */
function roughness(values: number[]) {
  let sum = 0
  for (let i = 2; i < values.length; i++)
    sum += (values[i] - 2 * values[i - 1] + values[i - 2]) ** 2
  return Math.sqrt(sum / (values.length - 2))
}

const swing = (values: number[]) => Math.max(...values) - Math.min(...values)

describe('hung body smoothing', () => {
  it('passes the first step through, then follows a step input within half a second', () => {
    const smoothing = new HungBodySmoothing()
    expect(smoothing.step([0.2, -0.1, 0], 1 / hz)).toEqual([0.2, -0.1, 0])
    let value = 0.2
    for (let i = 1; i <= hz / 2; i++) {
      value = smoothing.step([1, -0.1, 0], 1 / hz)[0]
      if (i === Math.round(hungBodySmoothingSeconds * hz))
        expect(value).toBeLessThan(0.5)
    }
    expect(value).toBeGreaterThan(0.9)
    smoothing.reset()
    expect(smoothing.step([-1, 0, 0], 1 / hz)).toEqual([-1, 0, 0])
  })

  it('softens the idle posture on a rig whose physics hangs the body from the head', () => {
    const plain = headYaw(false, 120)
    const hung = headYaw(true, 120)
    expect(roughness(hung)).toBeLessThan(0.5 * roughness(plain))
    // The same posture, late: on average the smoothed head stays close to the command.
    const stray = hung.reduce((sum, value, index) => sum + Math.abs(value - plain[index]), 0) / hung.length
    expect(stray).toBeLessThan(0.05)
  })

  it('leaves a gesture at its size', () => {
    const during = (values: number[]) => values.slice(10 * hz, 11 * hz)
    const plain = swing(during(headYaw(false, 12, 10)))
    expect(plain).toBeGreaterThan(swing(during(headYaw(false, 12))) + 0.1)
    expect(swing(during(headYaw(true, 12, 10)))).toBeGreaterThan(0.9 * plain)
  })
})
