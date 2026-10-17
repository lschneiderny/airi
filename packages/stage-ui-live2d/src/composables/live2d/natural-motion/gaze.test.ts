import type { RandomStream } from './random'

import { describe, expect, it } from 'vitest'

import { NaturalAttentionShifts, NaturalGazeLayer } from './gaze'
import { NaturalPostureLayers } from './posture'
import { createRandomStream } from './random'

// Each Box-Muller draw from this stream is sqrt(-2 ln 0.75) cos(pi / 2), about 5e-17, so the drift,
// continuous, and energy processes stay at rest and head motion consists of shifts only.
const silent: RandomStream = () => 0.25
const dt = 1 / 120

/** First sample times at which speed rises above `threshold` after being at or below it. */
function onsets(path: number[][], threshold: number) {
  const times: number[] = []
  let moving = false
  for (let i = 1; i < path.length; i++) {
    const speed = Math.hypot(...path[i].map((value, axis) => value - path[i - 1][axis])) / dt
    if (speed > threshold && !moving)
      times.push(i * dt)
    moving = speed > threshold
  }
  return times
}

describe('natural gaze', () => {
  it('leads about 30% of posture shifts by 30-80 ms', () => {
    const posture = new NaturalPostureLayers([0, 0, 0], { drift: silent, continuous: silent, gain: silent, shift: createRandomStream(1) })
    const gaze = new NaturalGazeLayer(createRandomStream(2))
    const attention = new NaturalAttentionShifts(createRandomStream(3))
    const head: number[][] = [[0, 0, 0]]
    const eyes: number[][] = [[0, 0]]
    for (let i = 0; i < 10 * 60 * 120; i++) {
      attention.update(posture, gaze, i * dt, dt)
      head.push(posture.step(dt))
      const point = gaze.step(dt)
      eyes.push([point.x, point.y])
    }
    // Min-jerk paths start at zero velocity, so low thresholds place each onset
    // within a few milliseconds of the true start; one grid step covers sampling.
    const headOnsets = onsets(head, 1e-3)
    const gazeOnsets = onsets(eyes, 1e-2)
    const leads = headOnsets.map(time => time - Math.max(-1, ...gazeOnsets.filter(onset => onset <= time)))
    const led = leads.filter(lead => lead >= 0.03 - dt && lead <= 0.08 + 2 * dt).length
    const early = leads.filter(lead => lead >= 0 && lead < 0.03 - dt).length
    expect(headOnsets.length).toBeGreaterThan(200)
    expect(led / headOnsets.length).toBeGreaterThan(0.2)
    expect(led / headOnsets.length).toBeLessThan(0.45)
    // Head onsets just after an unrelated fixation saccade are coincidences, never the coordinated lead.
    expect(early / headOnsets.length).toBeLessThan(0.05)
  })
})
