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

  /** Steps `gaze` from `from` to `to` seconds and returns the samples. */
  function sample(gaze: NaturalGazeLayer, from: number, to: number) {
    const points = []
    for (let i = Math.round(from / dt); i < Math.round(to / dt); i++)
      points.push(gaze.step(dt))
    return points
  }

  /** Whether `point` lies at the aside fixation on `side`, within the target jitter. */
  function isAside(point: { x: number, y: number }, side: number) {
    return Math.abs(point.x - side * 0.55) < 0.1 && Math.abs(point.y + 0.15) < 0.1
  }

  it('holds aside attention off camera even when a hold makes camera fixation certain', () => {
    const gaze = new NaturalGazeLayer(createRandomStream(5))
    // The largest camera fixation a held emotion can produce.
    gaze.cameraFixationProbability = 1
    gaze.setAside(true, 0)
    const before = gaze.saccadeCount
    // The first saccade lasts at most 90 ms.
    const settled = sample(gaze, 0, 60).slice(12)
    const side = Math.sign(settled[0].x)

    expect(settled.every(point => isAside(point, side))).toBe(true)
    // Autonomous fixations keep moving around the aside point instead of freezing.
    expect(gaze.saccadeCount - before).toBeGreaterThan(20)
  })

  it('draws the aside side from the gaze stream, so both sides occur', () => {
    const sides = new Set<number>()
    for (let seed = 1; seed <= 20; seed++) {
      const gaze = new NaturalGazeLayer(createRandomStream(seed))
      gaze.setAside(true, 0)
      sides.add(Math.sign(sample(gaze, 0, 0.5).at(-1)!.x))
    }

    expect([...sides].sort()).toEqual([-1, 1])
  })

  it('plays an emotion glance during aside attention and then returns to the aside fixation', () => {
    const gaze = new NaturalGazeLayer(createRandomStream(5))
    gaze.setAside(true, 0)
    const side = Math.sign(sample(gaze, 0, 1).at(-1)!.x)
    // The thinking glance of the Natural recipes, held for the clear band's 1.2 s.
    gaze.glance({ x: 0.3, y: 0.25 }, 1.2, 1)
    const glancing = sample(gaze, 1, 1.6).at(-1)!
    // The glance ends at 1 + saccade + 1.2 s; the next fixation is drawn there.
    const returned = sample(gaze, 1.6, 2.6).at(-1)!

    expect(glancing.x).toBeCloseTo(0.3, 6)
    expect(glancing.y).toBeCloseTo(0.25, 6)
    expect(isAside(returned, side)).toBe(true)
  })

  it('keeps the aside side when attention lapses briefly, as between speech clips of one cue', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const gaze = new NaturalGazeLayer(createRandomStream(seed))
      gaze.setAside(true, 0)
      const side = Math.sign(sample(gaze, 0, 1).at(-1)!.x)
      gaze.setAside(false, 1)
      sample(gaze, 1, 2.5)
      gaze.setAside(true, 2.5)

      expect(Math.sign(sample(gaze, 2.5, 3).at(-1)!.x)).toBe(side)
    }
  })

  it('returns to the camera when aside attention ends', () => {
    const gaze = new NaturalGazeLayer(createRandomStream(5))
    gaze.setAside(true, 0)
    sample(gaze, 0, 2)
    gaze.setAside(false, 2)
    // The camera saccade takes at most 90 ms and the next fixation is drawn at least 180 ms later.
    const released = sample(gaze, 2, 2.2).at(-1)!

    expect(Math.hypot(released.x, released.y)).toBeLessThan(0.1)
  })
})
