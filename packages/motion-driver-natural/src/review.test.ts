import type { NaturalIdleDrive } from './idle-activities'
import type { NaturalReviewGains } from './review'

import { describe, expect, it } from 'vitest'

import { NaturalMotion } from './natural-motion'
import { postureHomes } from './posture'
import { neutralReviewGains } from './review'

const idleState = { mode: 'idle', attention: 'camera', away: false } as const
const neutralDrive: NaturalIdleDrive = { energy: 0, valence: 0, tension: 0, sleepiness: 0, solitude: 0, music: false, allowSleep: true, rate: 0 }

function controller(seed = 41) {
  const motion = new NaturalMotion({ seed })
  motion.setPerformance(idleState, 0.5, 0)
  return motion
}

/** Advances at 60 fps from `from` to `to` seconds and returns the last frame. */
function run(motion: NaturalMotion, from: number, to: number) {
  let frame = motion.advance(from)
  for (let i = 1; i <= Math.round((to - from) * 60); i++)
    frame = motion.advance(from + i / 60)
  return frame
}

describe('review gains', () => {
  it('leave every frame bit-identical at the neutral gains', () => {
    const plain = controller()
    const reviewed = controller()
    reviewed.setReviewGains({ ...neutralReviewGains })
    for (let i = 1; i <= 120 * 60; i++)
      expect(reviewed.advance(i / 60)).toEqual(plain.advance(i / 60))
  })

  it('mute a layer without moving its process, so the same motion returns when the gain does', () => {
    const plain = controller()
    const reviewed = controller()
    reviewed.setReviewGains({ ...neutralReviewGains, shifts: 0, drift: 0, wobble: 0 })
    run(plain, 0, 30)
    run(reviewed, 0, 30)
    // Nothing is left of the posture but its home.
    const head = reviewed.bodyIntent().head.posture
    for (const axis of [0, 1, 2])
      expect(head[axis]).toBeCloseTo(postureHomes.product[axis], 4)
    expect(reviewed.bodyIntent().posture.shiftSeq).toBe(plain.bodyIntent().posture.shiftSeq)

    reviewed.setReviewGains({ ...neutralReviewGains })
    const expected = run(plain, 30, 36)
    const actual = run(reviewed, 30, 36)
    for (const key of ['headX', 'headY', 'headZ', 'eyeX', 'eyeY', 'bodyX', 'bodyY', 'bodyZ'] as const)
      expect(actual.pose[key]).toBeCloseTo(expected.pose[key]!, 6)
  })

  it('keeps the eyes on the camera at an eyes gain of 0', () => {
    const motion = controller()
    motion.setReviewGains({ ...neutralReviewGains, eyes: 0 })
    run(motion, 0, 5)
    for (let i = 1; i <= 600; i++) {
      const { fixation } = motion.advance(5 + i / 60)
      expect(Math.hypot(fixation.x, fixation.y)).toBeLessThan(1e-4)
    }
  })

  it('starts shifts more often at a higher shift rate, and never stops them at 0', () => {
    const shifts = (gains: NaturalReviewGains) => {
      const motion = controller()
      motion.setReviewGains(gains)
      run(motion, 0, 300)
      return motion.bodyIntent().posture.shiftSeq
    }
    const base = shifts(neutralReviewGains)
    expect(shifts({ ...neutralReviewGains, shiftRate: 2 })).toBeGreaterThan(1.3 * base)
    const slowest = shifts({ ...neutralReviewGains, shiftRate: 0 })
    expect(slowest).toBeGreaterThan(10)
    expect(slowest).toBeLessThan(0.5 * base)
  })

  it('counts a gain that is not finite as 1', () => {
    const plain = controller()
    const reviewed = controller()
    reviewed.setReviewGains({ ...neutralReviewGains, shifts: Number.NaN, eyes: Number.POSITIVE_INFINITY })
    expect(run(reviewed, 0, 20)).toEqual(run(plain, 0, 20))
  })
})

describe('review state', () => {
  it('follows the posture shifts and names the size of the one in progress', () => {
    const motion = controller()
    let seen = 0
    let moving = 0
    for (let i = 1; i <= 60 * 60; i++) {
      motion.advance(i / 60)
      const { head } = motion.reviewState()
      expect(head.seq).toBe(motion.bodyIntent().posture.shiftSeq)
      if (head.seq !== seen) {
        seen = head.seq
        expect(head.size).toBeGreaterThan(0)
      }
      moving += Number(head.moving)
    }
    expect(seen).toBeGreaterThan(20)
    // She is neither always in transit nor always still.
    expect(moving).toBeGreaterThan(600)
    expect(moving).toBeLessThan(3000)
  })

  it('names the act in progress and the glance it asked for', () => {
    const motion = controller()
    motion.setIdleDrive(neutralDrive, 0)
    run(motion, 0, 2)
    expect(motion.reviewState().act).toBeNull()
    motion.idlePlay('check-in', 2)
    run(motion, 2, 3)
    const state = motion.reviewState()
    expect(state.act).toBe('check-in')
    expect(state.eyes.target).toBe('glance')
    expect(state.owner).toBeNull()
  })

  it('names only the autonomous fixation points while nothing else owns the eyes', () => {
    const motion = controller()
    const targets = new Set<string>()
    for (let i = 1; i <= 120 * 60; i++) {
      motion.advance(i / 60)
      targets.add(motion.reviewState().eyes.target)
    }
    expect([...targets].sort()).toEqual(['camera', 'desk', 'side'])
  })
})

describe('follow candidate', () => {
  /** Mean cosine between the held head pose and an off-camera eye fixation, both relative to their rest. */
  function agreement(follow: number) {
    const motion = controller()
    motion.setReviewGains({ ...neutralReviewGains, follow, drift: 0, wobble: 0 })
    let sum = 0
    let count = 0
    for (let i = 1; i <= 600 * 60; i++) {
      const { fixation } = motion.advance(i / 60)
      const head = motion.bodyIntent().head.slow
      const offset = [head[0] - postureHomes.product[0], head[1] - postureHomes.product[1]]
      const sizes = Math.hypot(...offset) * Math.hypot(fixation.x, fixation.y)
      // A look at the camera has no direction to agree with.
      if (motion.reviewState().head.moving || Math.hypot(fixation.x, fixation.y) < 0.08 || sizes === 0)
        continue
      sum += (offset[0] * fixation.x + offset[1] * fixation.y) / sizes
      count++
    }
    return sum / count
  }

  it('turns the head toward what the eyes look at, where the shipped shifts are unrelated to it', () => {
    expect(Math.abs(agreement(0))).toBeLessThan(0.2)
    expect(agreement(1)).toBeGreaterThan(0.5)
  })
})
