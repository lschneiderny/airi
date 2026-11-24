import type { NaturalMotionFrame } from './frame-types'

import { describe, expect, it } from 'vitest'

import { NaturalMotion } from './natural-motion'

const dt = 1 / 120
const idle = { mode: 'idle', attention: 'camera', away: false } as const
const talking = { ...idle, mode: 'talking' } as const

/** Speaking from 10 to 40 s and 70 to 100 s with a syllable-like level, idle between, with emotions, a cue and a mood dose. */
function script(motion: NaturalMotion, time: number) {
  const speaking = (time >= 10 && time < 40) || (time >= 70 && time < 100)
  if (time === 0 || time === 10 || time === 40 || time === 70 || time === 100)
    motion.setPerformance(speaking ? talking : idle, 0.5, time)
  motion.setVoice({ speaking, speechActiveOrRecent: speaking, level: speaking && time % 0.31 < 0.12 ? 0.8 : 0 })
  if (time === 20)
    motion.impulse({ id: 'happy', emotion: 'happy', nominal: 0.9, intensity: 0.9, band: 'strong', escalation: false, gesture: 'laugh' }, time)
  if (time === 30)
    motion.addMood({ id: 'dose', valence: 0.6, arousal: 0.3, tension: 0 }, time)
  if (time === 50)
    motion.gesture('nod', 2, time)
  if (time === 80)
    motion.impulse({ id: 'surprised', emotion: 'surprised', nominal: 0.8, intensity: 0.8, band: 'clear', escalation: false }, time)
}

function sd(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
}

/** Runs 120 s of talking at 60 Hz and returns the frames. */
function talk(pep: number) {
  const motion = new NaturalMotion({ seed: 41 })
  motion.setPep(pep, 0)
  motion.setPerformance(talking, 0.5, 0)
  const frames: NaturalMotionFrame[] = []
  for (let i = 0; i <= 120 * 60; i++) {
    const time = i / 60
    motion.setVoice({ speaking: true, speechActiveOrRecent: true, level: time % 0.31 < 0.12 ? 0.8 : 0 })
    frames.push(motion.advance(time))
  }
  return frames
}

function blinksPerMinute(pep: number) {
  const motion = new NaturalMotion({ seed: 7 })
  motion.setPep(pep, 0)
  motion.setPerformance(idle, 0.5, 0)
  let blinks = 0
  let previous = 1
  for (let i = 0; i <= 600 * 120; i++) {
    const factor = motion.advance(i * dt).blink.blinkFactor
    if (previous === 1 && factor < 1)
      blinks++
    previous = factor
  }
  return blinks / 10
}

describe('natural pep', () => {
  it('leaves every frame and intent unchanged at pep 0', () => {
    const control = new NaturalMotion({ seed: 41 })
    const pep0 = new NaturalMotion({ seed: 41 })
    for (let i = 0; i <= 110 * 60; i++) {
      const time = i / 60
      script(control, time)
      script(pep0, time)
      if (i % 600 === 0)
        pep0.setPep(0, time)
      expect(pep0.advance(time)).toStrictEqual(control.advance(time))
      expect(pep0.bodyIntent()).toStrictEqual(control.bodyIntent())
    }
  }, 30_000)

  it('at pep 1 at least doubles the head roll SD while talking, inside the pose range and without a jump', () => {
    const calm = talk(0)
    const peppy = talk(1)
    const roll = (frames: NaturalMotionFrame[]) => sd(frames.map(frame => frame.pose.headZ))
    expect(roll(peppy)).toBeGreaterThan(2 * roll(calm))
    const maxChange = (frames: NaturalMotionFrame[]) => {
      let max = 0
      for (let i = 1; i < frames.length; i++) {
        for (const channel of ['headX', 'headY', 'headZ'] as const)
          max = Math.max(max, Math.abs(frames[i].pose[channel] - frames[i - 1].pose[channel]))
      }
      return max
    }
    for (const frame of peppy) {
      for (const value of Object.values(frame.pose)) {
        if (value !== null) {
          expect(value).toBeGreaterThanOrEqual(-1)
          expect(value).toBeLessThanOrEqual(1)
        }
      }
    }
    // The sway moves the head at most 0.035 per grid step at amplitude 1.4 (sway.test.ts), so at most 0.07 per 60 Hz frame.
    expect(maxChange(peppy)).toBeLessThan(maxChange(calm) + 0.07)
  }, 30_000)

  it('keeps the posture plus seven head terms equal to the reported head at grid endpoints', () => {
    const motion = new NaturalMotion({ seed: 41 })
    motion.setPep(1, 0)
    let error = 0
    let swayed = 0
    for (let i = 0; i <= 110 * 120; i++) {
      const time = i * dt
      script(motion, time)
      const frame = motion.advance(time)
      if (i === 0)
        continue
      const { head } = motion.bodyIntent()
      swayed = Math.max(swayed, Math.abs(head.sway[2]))
      for (const [axis, reported] of [frame.pose.headX, frame.pose.headY, frame.pose.headZ].entries()) {
        const sum = head.posture[axis] + head.emphasis[axis] + head.impulse[axis] + head.pet[axis] + head.held[axis] + head.gesture[axis] + head.cue[axis] + head.sway[axis]
        const composed = Math.max(-1, Math.min(1, sum))
        const expected = axis === 1 ? Math.max(-1, Math.min(1, composed + frame.breath.headY)) : composed
        error = Math.max(error, Math.abs(expected - reported))
      }
    }
    expect(swayed).toBeGreaterThan(0.1)
    expect(error).toBeLessThan(1e-10)
  }, 30_000)

  it('raises the blink rate at pep 1', () => {
    const calm = blinksPerMinute(0)
    const peppy = blinksPerMinute(1)
    // Pep 1 divides each drawn open interval by 2.25.
    expect(peppy).toBeGreaterThan(1.7 * calm)
  }, 30_000)
})
