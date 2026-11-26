import { describe, expect, it } from 'vitest'

import { NaturalGazeLayer } from './gaze'
import { NaturalMotion } from './natural-motion'
import { NaturalPostureLayers, postureHomes } from './posture'
import { createRandomStream } from './random'

const dt = 1 / 120

/** Ten idle minutes at 60 Hz: how often the head moves, how far, and whether it ends where the eyes look. */
function idleHead(pep: number, seed: number) {
  const motion = new NaturalMotion({ seed })
  motion.setPerformance({ mode: 'idle', attention: 'camera', away: false }, 0.5, 0)
  motion.setPep(pep, 0)
  const sizes: number[] = []
  let agreement = 0
  let judged = 0
  let wasMoving = false
  for (let i = 1; i <= 600 * 60; i++) {
    const { fixation } = motion.advance(i / 60)
    const { moving, size } = motion.reviewState().head
    // A shift that stays is not a move.
    if (wasMoving && !moving && size > 0.05) {
      sizes.push(size)
      const head = motion.bodyIntent().head.slow
      const offset = [head[0] - postureHomes.product[0], head[1] - postureHomes.product[1]]
      const lengths = Math.hypot(...offset) * Math.hypot(fixation.x, fixation.y)
      // A look at the camera has no direction to agree with.
      if (Math.hypot(fixation.x, fixation.y) >= 0.08 && lengths > 0) {
        agreement += (offset[0] * fixation.x + offset[1] * fixation.y) / lengths
        judged++
      }
    }
    wasMoving = moving
  }
  sizes.sort((a, b) => a - b)
  return { perMinute: sizes.length / 10, median: sizes[sizes.length >> 1], agreement: agreement / judged }
}

describe('attention-led head motion', () => {
  it.each([41, 7])('with pep moves the head less often, further, and to where the eyes look (seed %i)', (seed) => {
    const calm = idleHead(0, seed)
    const led = idleHead(0.25, seed)

    // Without pep a shift goes in a random direction about once a second.
    expect(calm.perMinute).toBeGreaterThan(35)
    expect(Math.abs(calm.agreement)).toBeLessThan(0.3)
    expect(led.perMinute).toBeLessThan(calm.perMinute / 3)
    expect(led.perMinute).toBeGreaterThan(5)
    expect(led.median).toBeGreaterThan(1.5 * calm.median)
    expect(led.agreement).toBeGreaterThan(0.8)
  }, 30_000)

  it('is complete from pep 0.25: more pep adds sway, not head shifts', () => {
    const quarter = idleHead(0.25, 41)
    const full = idleHead(1, 41)

    expect(Math.abs(full.perMinute - quarter.perMinute)).toBeLessThan(2)
    expect(full.agreement).toBeGreaterThan(0.8)
  }, 30_000)
})

describe('aimed posture shifts', () => {
  const silent = () => 0.25
  function aimed() {
    const posture = new NaturalPostureLayers([0, 0, 0], { drift: silent, continuous: silent, gain: silent, shift: createRandomStream(4), regime: silent })
    posture.aimShare = 1
    return posture
  }
  /** Steps until the next shift has begun and returns its target. */
  function nextTarget(posture: NaturalPostureLayers) {
    const count = posture.shiftCount
    while (posture.shiftCount === count)
      posture.step(dt)
    return [...posture.shiftTarget]
  }

  it('lands near a new aim and stays while the aim does', () => {
    const posture = aimed()
    posture.aim = [0.3, -0.2]
    const first = nextTarget(posture)
    expect(Math.hypot(first[0] - 0.3, first[1] + 0.2)).toBeLessThan(0.25)

    // The eyes come back to the same place, a little off: the head does not answer.
    posture.aim = [0.32, -0.21]
    expect(nextTarget(posture)).toEqual(first)

    posture.aim = [-0.3, 0]
    const turned = nextTarget(posture)
    expect(turned[0]).toBeLessThan(-0.1)
  })

  it('stays while another layer owns the eyes', () => {
    const posture = aimed()
    posture.aim = [0.3, 0]
    const first = nextTarget(posture)
    posture.aim = null
    expect(nextTarget(posture)).toEqual(first)
    expect(nextTarget(posture)).toEqual(first)
  })

  it('holds no longer than the hold limit', () => {
    const posture = aimed()
    posture.shiftRateScale = 1 / 60
    posture.holdLimit = 2
    for (let i = 0; i < 20; i++) {
      nextTarget(posture)
      // A shift lasts at most 0.35 + 0.25 sqrt(1.5 / 0.35) s.
      expect(posture.secondsUntilShift).toBeLessThanOrEqual(2 + 0.87)
    }
  })
})

describe('wide attention shifts', () => {
  /** The furthest side fixation and the mean hold of 2000 attention shifts. */
  function shifts(wide: number) {
    const gaze = new NaturalGazeLayer(createRandomStream(2))
    let furthest = 0
    let held = 0
    for (let i = 0; i < 2000; i++) {
      gaze.beginAttentionShift(i * 10, wide)
      if (gaze.targetKind === 'side')
        furthest = Math.max(furthest, Math.abs(gaze.fixationPoint.x))
      // The next autonomous fixation is due when the hold ends.
      let seconds = 0
      const count = gaze.saccadeCount
      while (gaze.saccadeCount === count && seconds < 10) {
        gaze.step(dt)
        seconds += dt
      }
      held += seconds
      gaze.step(10 - seconds)
    }
    return { furthest, held: held / 2000 }
  }

  it('reach further from the camera and hold longer', () => {
    const narrow = shifts(0)
    const wide = shifts(1)

    // Side fixations lie 0.12 from the camera, and 2.5 times as far when wide; jitter has an SD of 0.02.
    expect(narrow.furthest).toBeLessThan(0.22)
    expect(wide.furthest).toBeGreaterThan(0.3)
    expect(wide.held - narrow.held).toBeCloseTo(0.8, 1)
  })
})
