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

  it('limits pursuit speed during a 4 eye-units/s cursor sweep outside saccades', () => {
    const gaze = new NaturalGazeLayer(silent)
    gaze.setCursorTarget({ x: 0, y: 0 }, 1)
    gaze.orient(0)
    let previous = { x: 0, y: 0 }
    let count = gaze.saccadeCount
    let lastSaccadeAt = 0
    let measured = 0
    let maxSpeed = 0
    for (let i = 1; i <= 2 / dt; i++) {
      const at = i * dt
      gaze.setCursorTarget({ x: 4 * at, y: 0 }, 1)
      const point = gaze.step(dt)
      if (gaze.saccadeCount !== count) {
        lastSaccadeAt = at
        count = gaze.saccadeCount
      }
      // Every saccade lasts <= 90 ms. Exclude the landing interval too.
      if (at - lastSaccadeAt > 0.090 + dt) {
        maxSpeed = Math.max(maxSpeed, Math.hypot(point.x - previous.x, point.y - previous.y) / dt)
        measured++
      }
      previous = point
    }
    expect(measured).toBeGreaterThan(10)
    expect(gaze.saccadeCount).toBeGreaterThan(5)
    expect(maxSpeed).toBeLessThanOrEqual(1.5 + 1e-9)
  })

  it('makes exactly one catch-up saccade for a 0.5-unit target step', () => {
    const gaze = new NaturalGazeLayer(silent)
    gaze.setCursorTarget({ x: 0, y: 0 }, 1)
    gaze.orient(0)
    sample(gaze, 0, 0.1)
    const count = gaze.saccadeCount
    gaze.setCursorTarget({ x: 0.5, y: 0 }, 1)
    const point = sample(gaze, 0.1, 0.9).at(-1)!

    expect(gaze.saccadeCount).toBe(count + 1)
    expect(gaze.saccadeSize).toBeGreaterThan(0.1)
    expect(Math.hypot(point.x - 0.5, point.y)).toBeLessThan(0.01)
  })

  it('absorbs a 0.05-unit target step by pursuit within one second without a saccade', () => {
    // This stream draws holds > 3 s, isolating pursuit from autonomous fixation timing.
    const gaze = new NaturalGazeLayer(() => 0.9)
    gaze.setCursorTarget({ x: 0, y: 0 }, 1)
    gaze.orient(0)
    sample(gaze, 0, 0.1)
    const count = gaze.saccadeCount
    gaze.setCursorTarget({ x: 0.05, y: 0 }, 1)
    const point = sample(gaze, 0.1, 1.1).at(-1)!

    expect(gaze.saccadeCount).toBe(count)
    expect(Math.hypot(point.x - 0.05, point.y)).toBeLessThan(0.01)
  })

  it.each([{ weight: 1, share: 0.8 }, { weight: 0.3, share: 0.24 }])('scales cursor fixation draws by weight $weight', ({ weight, share }) => {
    const gaze = new NaturalGazeLayer(createRandomStream(42))
    gaze.setCursorTarget({ x: 0.6, y: 0.4 }, weight)
    let cursorDraws = 0
    for (let i = 0; i < 4000; i++) {
      gaze.beginAttentionShift(i * 0.1)
      cursorDraws += Number(gaze.onCursor)
      gaze.step(0.1)
    }
    expect(cursorDraws / 4000).toBeGreaterThan(share - 0.04)
    expect(cursorDraws / 4000).toBeLessThan(share + 0.04)
  })

  it('disengages in place without a camera saccade over the next 250 ms', () => {
    const gaze = new NaturalGazeLayer(silent)
    gaze.setCursorTarget({ x: 0.6, y: 0.3 }, 1)
    gaze.orient(0)
    const frozen = sample(gaze, 0, 0.1).at(-1)!
    const count = gaze.saccadeCount
    gaze.setCursorTarget({ x: 0.6, y: 0.3 }, 0)
    gaze.disengage(0.1)

    expect(gaze.onCursor).toBe(false)
    gaze.setCursorTarget({ x: -0.6, y: -0.3 }, 0)
    const held = sample(gaze, 0.1, 0.35)
    expect(held.every(point => point.x === frozen.x && point.y === frozen.y)).toBe(true)
    expect(held.every(point => Math.hypot(point.x, point.y) > 0.05)).toBe(true)
    expect(gaze.saccadeCount).toBe(count)
    sample(gaze, 0.35, 0.4 + dt)
    expect(gaze.saccadeCount).toBe(count + 1)
    expect(gaze.onCursor).toBe(false)
  })

  it.each([0.025, 0.1])('dismisses the cursor during a saccade or pursuit at %s seconds', (at) => {
    const gaze = new NaturalGazeLayer(silent)
    const cursor = { x: 0.6, y: 0.3 }
    gaze.setCursorTarget(cursor, 1)
    gaze.orient(0)
    sample(gaze, 0, at)
    const count = gaze.saccadeCount
    gaze.dismiss(at)
    expect(gaze.onCursor).toBe(false)
    expect(gaze.saccadeCount).toBe(count + 1)
    const point = sample(gaze, at, at + 0.15).at(-1)!
    expect(Math.hypot(point.x - cursor.x, point.y - cursor.y)).toBeGreaterThan(0.1)
    gaze.dismiss(at + 0.15)
    expect(gaze.saccadeCount).toBe(count + 1)
  })

  it('never draws the cursor in 2000 fixations after its weight becomes zero', () => {
    const gaze = new NaturalGazeLayer(createRandomStream(42))
    gaze.setCursorTarget({ x: 0.6, y: 0.3 }, 1)
    gaze.orient(0)
    sample(gaze, 0, 0.1)
    gaze.setCursorTarget({ x: 0.6, y: 0.3 }, 0)
    for (let i = 0; i < 2000; i++) {
      // Five seconds exceeds every hold plus the longest saccade.
      gaze.step(5.1)
      expect(gaze.onCursor).toBe(false)
    }
  })

  it.each([null, { x: 0.6, y: 0.3 }])('keeps no-cursor outputs and random draws unchanged at zero weight with target %j', (target) => {
    let draws = 0
    const random = createRandomStream(91)
    const gaze = new NaturalGazeLayer(() => {
      draws++
      return random()
    })
    let referenceDraws = 0
    const referenceRandom = createRandomStream(91)
    const reference = new NaturalGazeLayer(() => {
      referenceDraws++
      return referenceRandom()
    })
    gaze.setCursorTarget(target, 0)
    for (let i = 0; i < 60 / dt; i++) {
      expect(gaze.step(dt)).toEqual(reference.step(dt))
      expect(gaze.saccadeCount).toBe(reference.saccadeCount)
    }
    expect(draws).toBe(referenceDraws)
  })

  it('holds fixed saccade endpoints even when the cursor moves mid-flight', () => {
    const gaze = new NaturalGazeLayer(silent)
    gaze.setCursorTarget({ x: 0.6, y: 0 }, 1)
    gaze.orient(0)
    const reference = new NaturalGazeLayer(silent)
    reference.setCursorTarget({ x: 0.6, y: 0 }, 1)
    reference.orient(0)
    gaze.step(dt)
    reference.step(dt)
    gaze.setCursorTarget({ x: -0.6, y: 0.5 }, 1)
    for (let i = 0; i < 4; i++)
      expect(gaze.step(dt)).toEqual(reference.step(dt))
  })

  it('overrides cursor pursuit until cleared and saccades once per override change', () => {
    const gaze = new NaturalGazeLayer(silent)
    gaze.setCursorTarget({ x: 0.6, y: 0.3 }, 1)
    gaze.orient(0)
    sample(gaze, 0, 0.1)
    const count = gaze.saccadeCount
    const override = { x: -0.4, y: -0.3 }
    gaze.setOverride(override, 0.1)
    gaze.setOverride({ ...override }, 0.1)
    expect(gaze.saccadeCount).toBe(count + 1)
    expect(gaze.onCursor).toBe(false)
    expect(sample(gaze, 0.1, 0.25).at(-1)!).toEqual(override)
    for (let i = 0; i < 20; i++) {
      gaze.beginAttentionShift(0.25 + i * 0.1)
      expect(gaze.onCursor).toBe(false)
      const point = gaze.step(0.1)
      expect(point.x).toBeCloseTo(override.x, 12)
      expect(point.y).toBeCloseTo(override.y, 12)
    }
    const beforeClear = gaze.saccadeCount
    gaze.setOverride(null, 2.25)
    expect(gaze.saccadeCount).toBe(beforeClear + 1)
    expect(gaze.onCursor).toBe(true)
  })
})
