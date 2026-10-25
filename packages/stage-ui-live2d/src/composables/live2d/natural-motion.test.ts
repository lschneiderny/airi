import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import type { NaturalAttentionEvent, NaturalMotionEvent } from './natural-motion'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it, vi } from 'vitest'

import { Emotion } from '../../constants/emotions'
import { Live2DNaturalMotion } from './natural-motion'
import { NaturalBreathLayer } from './natural-motion/breath'
import { lostTau, mapCursor, releaseAt } from './natural-motion/cursor-attention'
import { NaturalPerformanceEnergy } from './natural-motion/energy'
import { NaturalGazeLayer } from './natural-motion/gaze'
import { NaturalHoldLayer } from './natural-motion/hold'
import { NaturalPostureLayers } from './natural-motion/posture'
import { NaturalSpeechEmphasis } from './natural-motion/speech-emphasis'

import * as random from './natural-motion/random'

const idle: PerformanceState = { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }
const headAxes = ['headX', 'headY', 'headZ'] as const

it.each([
  { band: 'slight', intensity: 0.25 },
  { band: 'clear', intensity: 0.6 },
  { band: 'strong', intensity: 0.9 },
] as const)('isolates $band recruitment at the facade', ({ band, intensity }) => {
  const motion = new Live2DNaturalMotion({ seed: 41 })
  const control = new Live2DNaturalMotion({ seed: 41 })
  motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions: false, mood: false })
  motion.impulse({ id: band, emotion: Emotion.Happy, nominal: intensity, intensity, band, escalation: false }, 0)
  control.advance(0)
  let headPeak = 0
  let bodyPeak = 0
  let facePeak = 0
  for (let i = 0; i <= 8 * 120; i++) {
    const actual = motion.advance(i / 120)
    const baseline = control.advance(i / 120)
    headPeak = Math.max(headPeak, Math.hypot(...headAxes.map(axis => actual.pose[axis] - baseline.pose[axis])))
    bodyPeak = Math.max(bodyPeak, Math.hypot(...(['bodyX', 'bodyY', 'bodyZ'] as const).map(axis => actual.pose[axis]! - baseline.pose[axis]!)))
    facePeak = Math.max(facePeak, actual.face.eyeSmile - baseline.face.eyeSmile)
  }
  expect(facePeak).toBeGreaterThan(0)
  if (band === 'slight')
    expect(headPeak).toBe(0)
  if (band === 'clear')
    expect(headPeak).toBeGreaterThanOrEqual(0.05)
  if (band === 'strong')
    expect(bodyPeak).toBeGreaterThan(0)
  else
    expect(bodyPeak).toBe(0)
})

it.each([
  { band: 'slight', intensity: 0.25 },
  { band: 'clear', intensity: 0.6 },
  { band: 'strong', intensity: 0.9 },
] as const)('isolates $band recruitment from mood posture modulation', ({ band, intensity }) => {
  const episode = { id: band, emotion: Emotion.Happy, nominal: intensity, intensity, band, escalation: false } as const
  const motion = new Live2DNaturalMotion({ seed: 41 })
  const matched = new Live2DNaturalMotion({ seed: 41 })
  const rest = new Live2DNaturalMotion({ seed: 41 })
  // The matched control receives the same episode but its band gains are zero, so only mood and shared overlays remain.
  const withoutRecruitment = structuredClone(defaultExpressionPerformanceSettings)
  withoutRecruitment.heldEmotions = false
  withoutRecruitment.naturalBands.headGain = 0
  withoutRecruitment.naturalBands.bodyGain = 0
  motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions: false })
  matched.setPerformanceSettings(withoutRecruitment)
  rest.setPerformanceSettings({ ...withoutRecruitment, mood: false })
  for (const instance of [motion, matched, rest]) {
    instance.advance(0)
    instance.impulse(episode, 0)
  }
  let moodHeadPeak = 0
  let headPulsePeak = 0
  let moodBodyPeak = 0
  let bodyLeanPeak = 0
  for (let i = 0; i <= 8 * 120; i++) {
    const actual = motion.advance(i / 120)
    const control = matched.advance(i / 120)
    const baseline = rest.advance(i / 120)
    moodHeadPeak = Math.max(moodHeadPeak, Math.hypot(...headAxes.map(axis => control.pose[axis] - baseline.pose[axis])))
    headPulsePeak = Math.max(headPulsePeak, Math.hypot(...headAxes.map(axis => actual.pose[axis] - control.pose[axis])))
    moodBodyPeak = Math.max(moodBodyPeak, Math.hypot(...(['bodyX', 'bodyY', 'bodyZ'] as const).map(axis => control.pose[axis]! - baseline.pose[axis]!)))
    bodyLeanPeak = Math.max(bodyLeanPeak, Math.hypot(...(['bodyX', 'bodyY', 'bodyZ'] as const).map(axis => actual.pose[axis]! - control.pose[axis]!)))
  }
  // Mood alone legitimately shifts posture, so recruitment is measured against the matched-mood control.
  expect(moodHeadPeak).toBeGreaterThan(0)
  if (band === 'slight')
    expect(headPulsePeak).toBe(0)
  if (band === 'clear')
    expect(headPulsePeak).toBeGreaterThanOrEqual(0.05)
  if (band === 'strong')
    expect(bodyLeanPeak).toBeGreaterThan(0)
  else
    expect(bodyLeanPeak).toBe(0)
  expect(moodBodyPeak).toBeGreaterThan(0)
})

it.each(['wake', 'screen-change'] as const)('keeps desktop %s on the fixed full-strength overlay', (reactKind) => {
  const react = vi.spyOn(NaturalPerformanceEnergy.prototype, 'react')
  try {
    const motion = new Live2DNaturalMotion({ seed: 41 })
    motion.setPerformance(idle, 0.5, 0)
    motion.setPerformance({ ...idle, reactKind, reactSeq: 1 }, 0.5, 0)
    motion.advance(2 / 120)
    expect(react).toHaveBeenCalledWith(expect.any(Number), 1)
  }
  finally {
    react.mockRestore()
  }
})

it('recruits body lean without writing physics-owned body axes', () => {
  const motion = new Live2DNaturalMotion({ seed: 41 })
  motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions: false })
  const control = new Live2DNaturalMotion({ seed: 41 })
  motion.setRigProfile({ bodyFromHeadPhysics: { x: true, y: false, z: true } })
  motion.impulse({ id: 'strong', emotion: Emotion.Happy, nominal: 0.9, intensity: 0.9, band: 'strong', escalation: false }, 0)
  control.advance(0)
  let peak = 0
  for (let i = 0; i <= 120; i++) {
    const frame = motion.advance(i / 120)
    const baseline = control.advance(i / 120)
    expect(frame.pose.bodyX).toBeNull()
    expect(frame.pose.bodyZ).toBeNull()
    peak = Math.max(peak, Math.abs(frame.pose.bodyY! - baseline.pose.bodyY!))
  }
  expect(peak).toBeGreaterThan(0)
})

type Frame = ReturnType<Live2DNaturalMotion['advance']>

function maximumDelta(a: Frame, b: Frame, axes = Object.keys(a.pose) as (keyof Frame['pose'])[]) {
  // Without a rig profile no axis is null; a null on either side counts as a full-range jump.
  return Math.max(...axes.map((axis) => {
    const [from, to] = [a.pose[axis], b.pose[axis]]
    return from === null || to === null ? 2 : Math.abs(from - to)
  }))
}

function standardDeviation(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length)
}

describe('natural motion', () => {
  it('establishes its time origin and home posture on first advance', () => {
    const late = new Live2DNaturalMotion({ seed: 7 })
    const early = new Live2DNaturalMotion({ seed: 7 })
    const initial = late.advance(100)
    expect(initial.pose.headX).toBe(0)
    expect(initial.pose.headY).toBeCloseTo(-0.1, 12)
    expect(initial.fixation).toEqual({ x: 0, y: 0 })
    early.advance(0)
    expect(late.advance(102.5)).toEqual(early.advance(2.5))
  })

  it('keeps zero-duration advances idempotent', () => {
    const motion = new Live2DNaturalMotion({ seed: 3 })
    motion.advance(0)
    const frame = motion.advance(4.2)
    expect(motion.advance(4.2)).toEqual(frame)
    motion.setCursor(null, 4.2)
    expect(motion.advance(4.2)).toEqual(frame)
  })

  it('keeps every output finite and within normalized bounds', () => {
    const motion = new Live2DNaturalMotion({ seed: 11 })
    let finite = true
    let maximum = 0
    for (let frame = 0; frame <= 10 * 60 * 60; frame++) {
      const time = frame / 60
      // Alternate extreme cursor attention with autonomous motion.
      if (frame % 600 === 0)
        motion.setCursor(frame % 1200 === 0 ? { x: 1, y: -1 } : null, time)
      for (const value of Object.values(motion.advance(time).pose)) {
        finite &&= value !== null && Number.isFinite(value)
        maximum = Math.max(maximum, Math.abs(value ?? 0))
      }
    }
    expect(finite).toBe(true)
    expect(maximum).toBeLessThanOrEqual(1)
  })

  it('freezes during suspension and resumes without a jump or reset', () => {
    const suspended = new Live2DNaturalMotion({ seed: 5 })
    const continuous = new Live2DNaturalMotion({ seed: 5 })
    suspended.advance(0)
    continuous.advance(0)
    suspended.advance(30)
    suspended.setSuspended(true, 30)
    const frozen = suspended.advance(30)
    expect(suspended.advance(100)).toEqual(frozen)
    suspended.setSuspended(false, 100)
    expect(suspended.advance(100)).toEqual(frozen)
    const resumed = suspended.advance(100 + 1 / 60)
    expect(maximumDelta(resumed, frozen)).toBeLessThan(0.02)
    // Active time continues where it stopped, so the path matches an uninterrupted run.
    expect(maximumDelta(resumed, continuous.advance(30 + 1 / 60))).toBeLessThan(1e-9)
  })

  it('returns from cursor expiry gradually without resetting followers', () => {
    const motion = new Live2DNaturalMotion({ seed: 9 })
    motion.advance(0)
    motion.setCursor({ x: 1, y: 1 }, 2)
    const attended = motion.advance(2.5)
    motion.setCursor(null, 2.5)
    expect(motion.advance(2.5)).toEqual(attended)
    const released = motion.advance(2.5 + 1 / 60)
    // Loss fades attention before releasing pursuit; head and body must not snap.
    expect(maximumDelta(released, attended, ['headX', 'headY', 'headZ', 'bodyX', 'bodyY', 'bodyZ'])).toBeLessThan(0.02)
    expect(Math.hypot(released.fixation.x - attended.fixation.x, released.fixation.y - attended.fixation.y)).toBeLessThan(1.5 / 60)
    expect(released.fixation.x).toBeGreaterThan(mapCursor({ x: 1, y: 1 }).eye.x - 0.05)
    // From weight <= 1, loss crosses releaseAt by lostTau * ln(1/releaseAt).
    // Disengagement then allows a 0.3 s hold and a saccade of at most 0.09 s.
    const autonomousAt = 2.5 + lostTau * Math.log(1 / releaseAt) + 0.3 + 0.09 + 2 / 120
    expect(motion.advance(autonomousAt).fixation.x).toBeLessThan(0.2)
  })

  it('keeps disabled cursor input equivalent to autonomous output', () => {
    const motion = new Live2DNaturalMotion({ seed: 13 })
    const reference = new Live2DNaturalMotion({ seed: 13 })
    motion.advance(0)
    reference.advance(0)
    for (const time of [0.1, 1.4, 1.8, 5, 10]) {
      motion.setCursor(null, time)
      expect(motion.advance(time)).toEqual(reference.advance(time))
    }
  })

  it('reports physics-derived body axes as null without changing other channels', () => {
    const motion = new Live2DNaturalMotion({ seed: 17 })
    const reference = new Live2DNaturalMotion({ seed: 17 })
    motion.setRigProfile({ bodyFromHeadPhysics: { x: true, y: false, z: false } })
    motion.advance(0)
    reference.advance(0)
    const { pose } = motion.advance(4)
    const expected = reference.advance(4).pose
    expect(pose.bodyX).toBeNull()
    expect(pose.bodyY).toBe(expected.bodyY)
    expect(pose.bodyZ).toBe(expected.bodyZ)
    expect(pose.headX).toBe(expected.headX)
    expect(pose.eyeX).toBe(expected.eyeX)
  })

  it('drives face, blink, and breath on every advance', () => {
    const motion = new Live2DNaturalMotion({ seed: 23 })
    const frames = Array.from({ length: 5 * 60 * 60 + 1 }, (_, frame) => motion.advance(frame / 60))
    expect(Math.min(...frames.map(frame => frame.blink.blinkFactor))).toBeLessThan(0.1)
    expect(standardDeviation(frames.map(frame => frame.face.browLY))).toBeGreaterThan(0.01)
    expect(standardDeviation(frames.map(frame => frame.face.mouthForm))).toBeGreaterThan(0.01)
    expect(Math.max(...frames.map(frame => frame.face.silentMouthOpen))).toBeGreaterThan(0)
    const breath = frames.map(frame => frame.breath.value)
    expect(Math.max(...breath) - Math.min(...breath)).toBeGreaterThan(0.2)
  })

  it('applies voice activity to mouth, breath, and head pitch only', () => {
    const voiced = new Live2DNaturalMotion({ seed: 29 })
    const quiet = new Live2DNaturalMotion({ seed: 29 })
    voiced.setVoice({ speaking: true, speechActiveOrRecent: true, level: 0 })
    const pairs = Array.from({ length: 5 * 60 * 60 + 1 }, (_, frame) => [voiced.advance(frame / 60), quiet.advance(frame / 60)])
    expect(Math.max(...pairs.map(([v]) => v.face.silentMouthOpen))).toBe(0)
    expect(Math.max(...pairs.map(([, q]) => q.face.silentMouthOpen))).toBeGreaterThan(0)
    const depth = (index: number) => Math.max(...pairs.map(pair => Math.abs(pair[index].breath.value - 0.45)))
    expect(depth(0)).toBeLessThan(0.8 * depth(1))
    // Breath couples into head pitch only, and by at most 0.001 normalized.
    expect(pairs.every(([v, q]) => v.pose.headX === q.pose.headX)).toBe(true)
    const pitch = pairs.map(([v, q]) => Math.abs(v.pose.headY - q.pose.headY))
    expect(Math.max(...pitch)).toBeGreaterThan(0)
    expect(Math.max(...pitch)).toBeLessThanOrEqual(0.001)
  })

  it('cross-fades a state switch without a frame jump', () => {
    const switched = new Live2DNaturalMotion({ seed: 31 })
    const control = new Live2DNaturalMotion({ seed: 31 })
    for (let frame = 0; frame <= 20 * 60; frame++) {
      switched.advance(frame / 60)
      control.advance(frame / 60)
    }
    switched.setPerformance({ ...idle, mode: 'talking' }, 1, 20)
    let largestStep = 0
    let largestGap = 0
    let previousGap = [0, 0, 0]
    for (let frame = 20 * 60 + 1; frame <= 40 * 60; frame++) {
      const [a, b] = [switched.advance(frame / 60), control.advance(frame / 60)]
      const gap = headAxes.map(axis => a.pose[axis] - b.pose[axis])
      // Around the switch the paths share shift timing; later, rescaled holds desynchronize
      // shifts, so gap steps there measure different shifts rather than a jump.
      if (frame <= 20 * 60 + 30)
        largestStep = Math.max(largestStep, ...gap.map((value, axis) => Math.abs(value - previousGap[axis])))
      largestGap = Math.max(largestGap, ...gap.map(Math.abs))
      previousGap = gap
    }
    // The switch never jumps a frame, yet the state visibly changes the motion.
    expect(largestStep).toBeLessThan(0.02)
    expect(largestGap).toBeGreaterThan(0.05)
  })

  it('scales head variability with user energy', () => {
    const deviation = (energy: number) => {
      const motion = new Live2DNaturalMotion({ seed: 37 })
      motion.setPerformance(idle, energy, 0)
      const axes: number[][] = [[], [], []]
      for (let frame = 0; frame <= 30 * 60 * 30; frame++) {
        const { pose } = motion.advance(frame / 30)
        headAxes.forEach((axis, index) => axes[index].push(pose[axis]))
      }
      return Math.hypot(...axes.map(standardDeviation))
    }
    const ratio = deviation(0) / deviation(1)
    expect(ratio).toBeGreaterThanOrEqual(0.45)
    expect(ratio).toBeLessThanOrEqual(0.65)
  }, 20_000)

  it('adds emotion impulses on top of the pose without resetting it', () => {
    const excited = new Live2DNaturalMotion({ seed: 41 })
    excited.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions: false })
    const control = new Live2DNaturalMotion({ seed: 41 })
    for (let frame = 0; frame <= 10 * 60; frame++) {
      excited.advance(frame / 60)
      control.advance(frame / 60)
    }
    excited.impulse({ id: 'happy', emotion: Emotion.Happy, nominal: 1, intensity: 1, band: 'clear', escalation: false }, 10)
    const start = excited.advance(10 + 1 / 60)
    // The frame the impulse starts in stays continuous with the control path.
    for (const axis of headAxes)
      expect(Math.abs(start.pose[axis] - control.advance(10 + 1 / 60).pose[axis])).toBeLessThan(0.02)
    let peakSmile = 0
    let peakLift = 0
    for (let frame = 10 * 60 + 2; frame <= 13 * 60; frame++) {
      const [a, b] = [excited.advance(frame / 60), control.advance(frame / 60)]
      peakSmile = Math.max(peakSmile, a.face.eyeSmile - b.face.eyeSmile)
      peakLift = Math.max(peakLift, Math.abs(a.pose.headY - b.pose.headY))
      if (frame === 13 * 60) {
        // Three seconds later the impulse has decayed onto the unreset control posture.
        for (const axis of headAxes)
          expect(Math.abs(a.pose[axis] - b.pose[axis])).toBeLessThanOrEqual(0.03)
      }
    }
    expect(peakSmile).toBeGreaterThan(0.3)
    expect(peakLift).toBeGreaterThan(0.03)
  })

  it('treats a neutral impulse as a no-op', () => {
    const neutral = new Live2DNaturalMotion({ seed: 43 })
    const control = new Live2DNaturalMotion({ seed: 43 })
    neutral.advance(0)
    control.advance(0)
    neutral.impulse({ id: 'neutral', emotion: Emotion.Neutral, nominal: 1, intensity: 1, band: 'clear', escalation: false }, 5)
    for (const time of [5, 5.5, 8, 12])
      expect(neutral.advance(time)).toEqual(control.advance(time))
  })

  it('nods on speech onsets from the voice level', () => {
    const voiced = new Live2DNaturalMotion({ seed: 47 })
    const control = new Live2DNaturalMotion({ seed: 47 })
    let largest = 0
    for (let frame = 0; frame <= 60 * 60; frame++) {
      const time = frame / 60
      // Syllable bursts every 0.3 s; `speaking` stays false so only the level differs.
      voiced.setVoice({ speaking: false, speechActiveOrRecent: false, level: time % 0.3 < 0.12 ? 0.8 : 0 })
      const [a, b] = [voiced.advance(time), control.advance(time)]
      largest = Math.max(largest, ...headAxes.map(axis => Math.abs(a.pose[axis] - b.pose[axis])))
    }
    expect(largest).toBeGreaterThan(0.015)
    expect(largest).toBeLessThan(0.1)
  })

  it('reacts once per reactSeq change after the first state', () => {
    const woken = new Live2DNaturalMotion({ seed: 53 })
    const control = new Live2DNaturalMotion({ seed: 53 })
    // A reaction that predates the controller is stale, so the first state only records the sequence.
    woken.setPerformance({ ...idle, reactSeq: 4, reactKind: 'wake' }, 0.5, 0)
    control.setPerformance({ ...idle, reactSeq: 4, reactKind: 'wake' }, 0.5, 0)
    expect(woken.advance(3)).toEqual(control.advance(3))
    woken.setPerformance({ ...idle, reactSeq: 5, reactKind: 'wake' }, 0.5, 3)
    woken.setPerformance({ ...idle, reactSeq: 5, reactKind: 'wake' }, 0.5, 3.1)
    let lift = 0
    for (let frame = 3 * 60 + 1; frame <= 4 * 60; frame++)
      lift = Math.max(lift, woken.advance(frame / 60).pose.headY - control.advance(frame / 60).pose.headY)
    expect(lift).toBeGreaterThan(0.03)
    // The camera glance moves the gaze toward (0, 0).
    expect(Math.hypot(woken.advance(4).fixation.x, woken.advance(4).fixation.y)).toBeLessThan(0.05)
  })

  it('keeps ACT aside attention through a held emotion and returns to it after an emotion glance', () => {
    const motion = new Live2DNaturalMotion({ seed: 71 })
    // Love raises camera fixation by 0.25 while it is held.
    motion.setHeldEmotion({ emotion: 'love', strength: 1 }, 0)
    motion.setPerformance({ ...idle, mode: 'talking', attention: 'aside' }, 0.5, 0)
    const held = []
    for (let frame = 30; frame <= 4 * 60; frame++)
      held.push(motion.advance(frame / 60).fixation)
    const side = Math.sign(held[0].x)
    // Think glances aside and up at (+-0.3, 0.25) for the clear band's 1.2 s hold.
    motion.impulse({ id: 'think', emotion: Emotion.Think, nominal: 0.6, intensity: 0.6, band: 'clear', escalation: false }, 4)
    const glancing = motion.advance(4.6).fixation
    const returned = motion.advance(6.5).fixation
    motion.setPerformance({ ...idle, mode: 'talking', attention: 'camera' }, 0.5, 6.5)
    const released = motion.advance(6.7).fixation

    expect(held.every(point => Math.abs(point.x - side * 0.55) < 0.1 && Math.abs(point.y + 0.15) < 0.1)).toBe(true)
    expect(glancing.y).toBeGreaterThan(0.2)
    expect(Math.abs(returned.x - side * 0.55)).toBeLessThan(0.1)
    expect(Math.abs(returned.y + 0.15)).toBeLessThan(0.1)
    expect(Math.hypot(released.x, released.y)).toBeLessThan(0.1)
  })

  describe('the ACT look cue across a pause between speech clips', () => {
    const talkingAside: PerformanceState = { ...idle, mode: 'talking', attention: 'aside' }
    // During the pause the mode leaves talking, and Model.vue reports the cursor again because attention is no longer aside.
    const pause: PerformanceState = { ...idle, mode: 'watching', attention: 'cursor' }
    const cursor = { x: 0.5, y: 0.5 }

    /** Fixations from `from` to `to` seconds at 120 Hz. */
    function sample(motion: Live2DNaturalMotion, from: number, to: number) {
      const points = []
      for (let frame = Math.round(from * 120); frame < Math.round(to * 120); frame++)
        points.push(motion.advance(frame / 120).fixation)
      return points
    }

    function isAside(point: { x: number, y: number }, side: number) {
      return Math.abs(point.x - side * 0.55) < 0.1 && Math.abs(point.y + 0.15) < 0.1
    }

    /** Talks with the aside cue until 2 s and pauses from 2 s; returns the controller and the side it drew. */
    function pausedAside() {
      const motion = new Live2DNaturalMotion({ seed: 71 })
      motion.setPerformance(talkingAside, 0.5, 0)
      const side = Math.sign(sample(motion, 0, 2).at(-1)!.x)
      motion.setPerformance(pause, 0.5, 2)
      motion.setCursor(cursor, 2)
      return { motion, side }
    }

    it.each([0.3, 0.55])('keeps the aside target through a %s s pause between two talking spans', (gap) => {
      const { motion, side } = pausedAside()
      const paused = sample(motion, 2, 2 + gap)
      motion.setCursor(null, 2 + gap, 'dismissed')
      motion.setPerformance(talkingAside, 0.5, 2 + gap)
      const resumed = sample(motion, 2 + gap, 3.5)

      expect(paused.every(point => isAside(point, side))).toBe(true)
      expect(resumed.every(point => isAside(point, side))).toBe(true)
    })

    it('releases the cue when the pause outlasts 0.6 s, as at the end of the turn, and keeps the side if speech resumes', () => {
      const { motion, side } = pausedAside()
      const held = sample(motion, 2, 2.58)
      // The release saccade lasts at most 90 ms after the step that ends the hold.
      const released = sample(motion, 2.58, 2.75).at(-1)!
      motion.setCursor(null, 2.8, 'dismissed')
      motion.setPerformance(talkingAside, 0.5, 2.8)
      // The first aside saccade lasts at most 90 ms; the 2 s side memory keeps the side.
      const resumed = sample(motion, 2.9, 3.5)

      expect(held.every(point => isAside(point, side))).toBe(true)
      expect(isAside(released, side)).toBe(false)
      expect(Math.abs(released.x - side * 0.55)).toBeGreaterThan(0.3)
      expect(resumed.every(point => isAside(point, side))).toBe(true)
    })

    it.each([
      { name: 'a new ACT without the cue', next: { ...idle, mode: 'talking', attention: 'camera' } },
      { name: 'the user speaking', next: { ...idle, mode: 'listening', attention: 'camera' } },
    ] satisfies { name: string, next: PerformanceState }[])('ends the cue at once for $name during the pause', ({ next }) => {
      const { motion } = pausedAside()
      sample(motion, 2, 2.1)
      motion.setPerformance(next, 0.5, 2.1)
      const point = sample(motion, 2.1, 2.25).at(-1)!

      expect(Math.hypot(point.x, point.y)).toBeLessThan(0.1)
    })

    it('follows the cursor within 0.6 s after notice during a pause without a look cue', () => {
      const motion = new Live2DNaturalMotion({ seed: 71 })
      const events: NaturalMotionEvent[] = []
      motion.setObserver(event => events.push(event))
      motion.setPerformance({ ...idle, mode: 'talking' }, 0.5, 0)
      sample(motion, 0, 2)
      motion.setPerformance(pause, 0.5, 2)
      motion.setCursor(cursor, 2)
      const points = sample(motion, 2, 2.6)

      const target = mapCursor(cursor).eye
      // Notice reaches the hand within this window; subsequent autonomous
      // fixations may legitimately look elsewhere before the window ends.
      expect(events.filter(event => event.kind === 'attention').map(event => event.phase)).toEqual(['notice', 'engage'])
      expect(points.some(point => Math.hypot(point.x - target.x, point.y - target.y) < 0.01)).toBe(true)
    })
  })

  describe('screen attention with a moving cursor', () => {
    // The radial cursor target stays up and left of every autonomous target.
    const cursorAt = (time: number) => ({ x: -0.9 + 0.1 * Math.sin(5 * time), y: 0.8 })
    // mapCursor gives x between -0.38 and -0.31; autonomous targets stay within 0.2.
    const offCursor = (point: { x: number, y: number }) => point.x > -0.25

    /** Moves the cursor every frame from `from` to `to` seconds at 120 Hz, as Model.vue reports it, and returns the fixations. */
    function track(motion: Live2DNaturalMotion, from: number, to: number) {
      const points = []
      for (let frame = Math.round(from * 120); frame < Math.round(to * 120); frame++) {
        motion.setCursor(cursorAt(frame / 120), frame / 120)
        points.push(motion.advance(frame / 120).fixation)
      }
      return points
    }

    it.each([
      { name: 'a game in front while watching', state: { ...idle, mode: 'watching', attention: 'screen' } },
      { name: 'the ACT look:"screen" cue while talking', state: { ...idle, mode: 'talking', attention: 'screen' } },
    ] satisfies { name: string, state: PerformanceState }[])('never fixates the cursor for $name', ({ state }) => {
      const motion = new Live2DNaturalMotion({ seed: 83 })
      motion.setPerformance(state, 0.5, 0)

      expect(track(motion, 0, 20).every(offCursor)).toBe(true)
    })

    it('still follows the cursor under cursor attention', () => {
      const motion = new Live2DNaturalMotion({ seed: 83 })
      motion.setPerformance({ ...idle, mode: 'watching', attention: 'cursor' }, 0.5, 0)
      const points = track(motion, 0, 20)

      expect(points.filter(point => !offCursor(point)).length / points.length).toBeGreaterThan(0.5)
    })

    it('keeps the look:"screen" cue off the cursor through a pause between speech clips', () => {
      const motion = new Live2DNaturalMotion({ seed: 83 })
      motion.setPerformance({ ...idle, mode: 'talking', attention: 'screen' }, 0.5, 0)
      track(motion, 0, 2)
      // During the pause Model.vue reports cursor attention, and the held cue must still win.
      motion.setPerformance({ ...idle, mode: 'watching', attention: 'cursor' }, 0.5, 2)

      expect(track(motion, 2, 2.3).every(offCursor)).toBe(true)
    })

    it('leaves the cursor with one eased saccade when screen attention begins', () => {
      const motion = new Live2DNaturalMotion({ seed: 83 })
      motion.setPerformance({ ...idle, mode: 'watching', attention: 'cursor' }, 0.5, 0)
      motion.advance(2)
      // A newly active cursor draws the gaze at once.
      const onCursor = track(motion, 2, 2.2).at(-1)!
      motion.setPerformance({ ...idle, mode: 'watching', attention: 'screen' }, 0.5, 2.2)
      const after = track(motion, 2.2, 6)
      // A saccade lasts at most 90 ms, so 150 ms after the switch the gaze has landed.
      const saccade = [onCursor, ...after.slice(0, 18)]
      const landed = saccade.at(-1)!
      const distance = Math.hypot(landed.x - onCursor.x, landed.y - onCursor.y)
      const steps = saccade.slice(1).map((point, i) => Math.hypot(point.x - saccade[i].x, point.y - saccade[i].y))
      const between = saccade.filter((point) => {
        const travelled = Math.hypot(point.x - onCursor.x, point.y - onCursor.y)
        return travelled > 0.05 * distance && travelled < 0.95 * distance
      })

      expect(offCursor(onCursor)).toBe(false)
      expect(distance).toBeGreaterThan(0.3)
      // Eased: the move passes through several intermediate frames, and no frame jumps a large share of it.
      expect(between.length).toBeGreaterThanOrEqual(3)
      expect(Math.max(...steps)).toBeLessThan(0.35 * distance)
      expect(after.slice(18).every(offCursor)).toBe(true)
    })
  })

  it('flinches away from a poke, shows surprise, and meets the camera', () => {
    const poked = new Live2DNaturalMotion({ seed: 61 })
    const control = new Live2DNaturalMotion({ seed: 61 })
    poked.advance(0)
    control.advance(0)
    poked.poke('head', 1, 0, 2)
    let flinch = 0
    let brow = 0
    let glanceDistance = Number.NaN
    for (let frame = 2 * 60 + 1; frame <= 3 * 60; frame++) {
      const [a, b] = [poked.advance(frame / 60), control.advance(frame / 60)]
      // Half a second in, the 0.9 s camera glance still holds.
      if (frame === 2.5 * 60)
        glanceDistance = Math.hypot(a.fixation.x, a.fixation.y)
      // A poke right of center turns the head left (negative yaw).
      flinch = Math.min(flinch, a.pose.headX - b.pose.headX)
      brow = Math.max(brow, a.face.browLY - b.face.browLY)
    }
    expect(flinch).toBeLessThan(-0.03)
    expect(brow).toBeGreaterThan(0.1)
    expect(glanceDistance).toBeLessThan(0.05)
  })

  it('only flinches at a repeat poke within 2 s, then surprises again after', () => {
    const single = new Live2DNaturalMotion({ seed: 61 })
    const repeated = new Live2DNaturalMotion({ seed: 61 })
    single.advance(0)
    repeated.advance(0)
    single.poke('head', 1, 0, 2)
    repeated.poke('head', 1, 0, 2)
    // Time only moves forward: each window starts one frame after the previous one ends.
    const browPeak = (motion: Live2DNaturalMotion, from: number, to: number) => {
      let brow = 0
      for (let frame = from * 60 + 1; frame <= to * 60; frame++)
        brow = Math.max(brow, motion.advance(frame / 60).face.browLY)
      return brow
    }
    browPeak(single, 2, 3)
    browPeak(repeated, 2, 3)
    repeated.poke('head', 1, 0, 3)
    // The repeat adds no surprise of its own, so the brows match the single poke.
    expect(browPeak(repeated, 3, 4)).toBeCloseTo(browPeak(single, 3, 4), 6)
    browPeak(single, 4, 5)
    browPeak(repeated, 4, 5)
    repeated.poke('head', 1, 0, 5)
    expect(browPeak(repeated, 5, 6)).toBeGreaterThan(browPeak(single, 5, 6) + 0.05)
  })

  it('lets the pet own gaze and head with happy closed eyes, then lets go', () => {
    const petted = new Live2DNaturalMotion({ seed: 67 })
    petted.advance(0)
    petted.setCursor({ x: 1, y: 1 }, 0)
    petted.setPet({ x: 0, y: 0 }, 1)
    // The level crosses 0.5 in 0.35 * ln(2) seconds, then the override saccade lands.
    for (let frame = 90; frame <= 4 * 60; frame++) {
      const { fixation, pose } = petted.advance(frame / 60)
      expect(fixation.y).toBeLessThan(-0.05)
      expect(pose.headY).toBeLessThan(0)
    }
    const held = petted.advance(4)
    expect(held.face.eyeOpenMultiplier).toBeLessThan(0.3)
    expect(held.face.eyeSmile).toBeGreaterThan(0.6)
    expect(held.face.cheek).toBeGreaterThan(0.5)

    petted.setPet(null, 4)
    // The release fades with a 0.7 s time constant and snaps to rest once negligible.
    const released = petted.advance(12)
    expect(released.face.eyeSmile).toBe(0)
    expect(released.face.cheek).toBe(0)
  })

  it('moves exactly as before while nobody pets it', () => {
    const untouched = new Live2DNaturalMotion({ seed: 71 })
    const control = new Live2DNaturalMotion({ seed: 71 })
    for (let frame = 0; frame <= 10 * 60; frame++) {
      const time = frame / 60
      // The adapter reports the absent pet on every composition.
      untouched.setPet(null, time)
      expect(untouched.advance(time)).toEqual(control.advance(time))
    }
  })

  it('keeps head variability independent of frame partition', () => {
    const deviations = [1 / 30, 1 / 60, 1 / 144].map((frameStep) => {
      const motion = new Live2DNaturalMotion({ seed: 21 })
      const axes: number[][] = [[], [], []]
      for (let frame = 0; frame * frameStep <= 10 * 60; frame++) {
        const { pose } = motion.advance(frame * frameStep)
        axes[0].push(pose.headX)
        axes[1].push(pose.headY)
        axes[2].push(pose.headZ)
      }
      return axes.map(standardDeviation)
    })
    for (const axis of [0, 1, 2]) {
      const values = deviations.map(deviation => deviation[axis])
      expect(Math.max(...values) / Math.min(...values)).toBeLessThan(1.05)
    }
  }, 20_000)
})

describe('continuous cursor attention and touch', () => {
  function observed(seed: number) {
    const motion = new Live2DNaturalMotion({ seed })
    const events: NaturalMotionEvent[] = []
    motion.setObserver(event => events.push(event))
    motion.advance(0)
    return { motion, events }
  }

  function attentionEvents(events: NaturalMotionEvent[]): NaturalAttentionEvent[] {
    return events.filter((event): event is NaturalAttentionEvent => event.kind === 'attention')
  }

  it('(a) notices a moving near cursor before engaging it', () => {
    const { motion, events } = observed(41)
    for (let frame = 0; frame <= 120; frame++)
      motion.setCursor({ x: 1, y: 0.1 * Math.sin(frame / 12) }, frame / 120)

    const attention = attentionEvents(events)
    expect(attention.map(event => event.phase)).toEqual(['notice', 'engage'])
    expect(attention[1].at - attention[0].at).toBeGreaterThanOrEqual(0.25)
    expect(attention[1].at - attention[0].at).toBeLessThanOrEqual(0.5 + 1 / 120)
  })

  it('(b) engages a far cursor for some seeds and ignores it for others', () => {
    let engaged = 0
    for (let seed = 0; seed < 50; seed++) {
      const { motion, events } = observed(seed)
      for (let frame = 0; frame <= 120; frame++)
        motion.setCursor({ x: 9, y: 0.2 * Math.sin(frame / 12) }, frame / 120)
      engaged += Number(attentionEvents(events).some(event => event.phase === 'engage'))
    }
    expect(engaged).toBeGreaterThan(0)
    expect(engaged).toBeLessThan(50)
  })

  it('(c) melts into and out of a pet without a head jump or a camera fixation at onset', () => {
    const { motion, events } = observed(67)
    let previous = motion.advance(0)
    let largestStep = 0
    let nearestCamera = Number.POSITIVE_INFINITY
    for (let frame = 0; frame <= 6 * 120; frame++) {
      const time = frame / 120
      motion.setCursor({ x: 1, y: 0.4 + 0.1 * Math.sin(time * 5) }, time)
      if (frame === 120)
        motion.setPet({ x: 0.3, y: 0.2 }, time)
      if (frame === 3 * 120)
        motion.setPet(null, time)
      const current = motion.advance(time)
      largestStep = Math.max(largestStep, maximumDelta(previous, current, [...headAxes]))
      if (time >= 1 && time <= 1.5)
        nearestCamera = Math.min(nearestCamera, Math.hypot(current.fixation.x, current.fixation.y))
      previous = current
    }
    expect(largestStep).toBeLessThan(0.02)
    expect(nearestCamera).toBeGreaterThan(0.05)
    expect(events.filter(event => event.kind === 'touch').map(event => event.touch)).toEqual(['pet-start', 'pet-end'])
  })

  it('(d) tucks monotonically as a hand descends from above and rests near the head', () => {
    const { motion } = observed(41)
    const baseline = new Live2DNaturalMotion({ seed: 41 })
    baseline.advance(0)
    let previousDifference = Number.POSITIVE_INFINITY
    let largestRise = Number.NEGATIVE_INFINITY
    let nearMaximum = Number.NEGATIVE_INFINITY
    for (let frame = 0; frame <= 4.6 * 120; frame++) {
      const time = frame / 120
      const y = Math.max(0.5, 1.6 - Math.max(0, time - 2))
      motion.setCursor({ x: 0, y }, time)
      const difference = motion.advance(time).pose.headY - baseline.advance(time).pose.headY
      if (time >= 2) {
        largestRise = Math.max(largestRise, difference - previousDifference)
        previousDifference = difference
      }
      // The hand reaches r = 0.9 at 2.7 s; allow another 0.6 s for the head follower.
      if (time >= 3.3)
        nearMaximum = Math.max(nearMaximum, difference)
    }
    expect(largestRise).toBeLessThanOrEqual(1e-3)
    expect(nearMaximum).toBeLessThanOrEqual(0)
  })

  it('(d2) pulls the head less at nine head widths than at three after engagement', () => {
    // The same attention stream decides engagement in both runs; the seed also keeps
    // both non-near interest spans alive until the comparison.
    const seed = 26
    const medium = observed(seed)
    const far = observed(seed)
    const baseline = new Live2DNaturalMotion({ seed })
    baseline.advance(0)
    for (let frame = 0; frame <= 240; frame++) {
      const time = frame / 120
      const y = 0.1 * Math.sin(time * 10)
      medium.motion.setCursor({ x: 3, y }, time)
      far.motion.setCursor({ x: 9, y }, time)
    }
    expect(attentionEvents(medium.events).map(event => event.phase)).toEqual(['notice', 'engage'])
    expect(attentionEvents(far.events).map(event => event.phase)).toEqual(['notice', 'engage'])
    const base = baseline.advance(2).pose.headX
    const mediumPull = medium.motion.advance(2).pose.headX - base
    const farPull = far.motion.advance(2).pose.headX - base
    expect(mediumPull).toBeGreaterThan(0)
    expect(farPull).toBeGreaterThan(0)
    expect(farPull).toBeLessThan(mediumPull)
  })

  it('(e) gives mirrored paths identical attention and opposite directional pull', () => {
    const right = observed(41)
    const left = observed(41)
    let rightSum = 0
    let leftSum = 0
    let count = 0
    let smallestHeadDifference = Number.POSITIVE_INFINITY
    for (let frame = 0; frame <= 4 * 120; frame++) {
      const time = frame / 120
      const x = 1 + 0.2 * Math.sin(time * 4)
      right.motion.setCursor({ x, y: -0.1 }, time)
      left.motion.setCursor({ x: -x, y: -0.1 }, time)
      const a = right.motion.advance(time)
      const b = left.motion.advance(time)
      const engagedAt = attentionEvents(right.events).find(event => event.phase === 'engage')?.at
      if (engagedAt !== undefined && time >= engagedAt + 0.3) {
        smallestHeadDifference = Math.min(smallestHeadDifference, a.pose.headX - b.pose.headX)
        rightSum += a.fixation.x
        leftSum += b.fixation.x
        count++
      }
    }
    expect(attentionEvents(right.events)).toEqual(attentionEvents(left.events))
    expect(count).toBeGreaterThan(0)
    expect(smallestHeadDifference).toBeGreaterThan(0)
    expect(rightSum / count).toBeGreaterThan(0)
    expect(leftSum / count).toBeLessThan(0)
  })

  it('(f) replays the same cursor input independently of rendering frame partition', () => {
    const samples = [30, 60, 144].map((rate) => {
      const { motion, events } = observed(41)
      // Input is a fixed 30 Hz path. Rendering may sample more often but must never
      // change the input event times or the fixed-grid motion they produce.
      const inputTimes = new Set(Array.from({ length: 121 }, (_, i) => i / 30))
      const times = [...new Set([...inputTimes, ...Array.from({ length: 4 * rate + 1 }, (_, i) => i / rate)])].sort((a, b) => a - b)
      const frames: Frame[] = []
      for (const time of times) {
        if (inputTimes.has(time))
          motion.setCursor({ x: 1 + 0.3 * Math.sin(time * 4), y: 0.1 }, time)
        const frame = motion.advance(time)
        if (Number.isInteger(time))
          frames.push(frame)
      }
      return { frames, events }
    })
    for (const actual of samples.slice(1)) {
      expect(actual.events).toEqual(samples[0].events)
      for (const [index, frame] of actual.frames.entries()) {
        const expected = samples[0].frames[index]
        expect(maximumDelta(frame, expected)).toBeLessThan(1e-9)
        expect(Math.hypot(frame.fixation.x - expected.fixation.x, frame.fixation.y - expected.fixation.y)).toBeLessThan(1e-9)
        for (const key of Object.keys(frame.face) as (keyof Frame['face'])[])
          expect(Math.abs(frame.face[key] - expected.face[key])).toBeLessThan(1e-9)
        expect(Math.abs(frame.blink.blinkFactor - expected.blink.blinkFactor)).toBeLessThan(1e-9)
        for (const key of Object.keys(frame.breath) as (keyof Frame['breath'])[])
          expect(Math.abs(frame.breath[key] - expected.breath[key])).toBeLessThan(1e-9)
      }
    }
  })

  it('(g) silently switches to screen attention after a resting cursor releases', () => {
    const { motion, events } = observed(41)
    motion.setCursor({ x: 1, y: 0 }, 0)
    motion.advance(4)
    expect(attentionEvents(events).map(event => event.phase)).toEqual(['notice', 'engage', 'release'])
    motion.setPerformance({ ...idle, mode: 'watching', attention: 'screen' }, 0.5, 4)
    motion.advance(5)
    expect(attentionEvents(events).some(event => event.phase === 'dismiss')).toBe(false)
  })

  it('(h) dismisses cursor attention and looks aside within 0.4 s', () => {
    const { motion, events } = observed(41)
    motion.setCursor({ x: 1, y: 1 }, 0)
    motion.setPerformance({ ...idle, mode: 'talking', attention: 'aside' }, 0.5, 0.6)
    const point = motion.advance(1).fixation
    const dismissal = attentionEvents(events).find(event => event.phase === 'dismiss')
    expect(dismissal).toBeDefined()
    expect(dismissal!.at).toBeLessThan(1)
    expect(Math.abs(point.x)).toBeGreaterThan(0.4)
    expect(point.y).toBeLessThan(-0.05)
  })

  it('(i) lowers head pitch when poked at the top of the head', () => {
    const { motion, events } = observed(61)
    const baseline = new Live2DNaturalMotion({ seed: 61 })
    baseline.advance(0)
    motion.poke('head', 0, -1, 2)
    let lowest = 0
    for (let frame = 241; frame <= 300; frame++) {
      const time = frame / 120
      lowest = Math.min(lowest, motion.advance(time).pose.headY - baseline.advance(time).pose.headY)
    }
    expect(lowest).toBeLessThan(-0.03)
    expect(events.filter(event => event.kind === 'touch')).toEqual([{ kind: 'touch', at: 2, touch: 'poke', region: 'head' }])
  })

  it('(j) keeps sixty seconds of dismissed null cursor identical with no attention draws', () => {
    const create = random.createRandomStream
    let attentionDraws = 0
    const instrument = vi.spyOn(random, 'createRandomStream').mockImplementation((seed) => {
      const next = create(seed)
      return () => {
        if (seed === random.deriveSeed(41, 13))
          attentionDraws++
        return next()
      }
    })
    try {
      const { motion, events } = observed(41)
      const reference = new Live2DNaturalMotion({ seed: 41 })
      reference.advance(0)
      for (let frame = 0; frame <= 60 * 120; frame++) {
        const time = frame / 120
        motion.setCursor(null, time, 'dismissed')
        expect(motion.advance(time)).toEqual(reference.advance(time))
      }
      expect(events).toEqual([])
      expect(attentionDraws).toBe(0)
    }
    finally {
      instrument.mockRestore()
    }
  })

  it('(k) notices and engages a moving near cursor within 0.6 s of leaving screen attention', () => {
    const { motion, events } = observed(41)
    motion.setPerformance({ ...idle, mode: 'watching', attention: 'screen' }, 0.5, 0)
    for (let frame = 0; frame <= 312; frame++) {
      const time = frame / 120
      if (frame === 240)
        motion.setPerformance({ ...idle, mode: 'watching', attention: 'cursor' }, 0.5, time)
      motion.setCursor({ x: 1, y: 0.2 * Math.sin(time * 6) }, time)
    }
    const attention = attentionEvents(events)
    expect(attention.map(event => event.phase)).toEqual(['notice', 'engage'])
    expect(attention[0].at).toBeGreaterThanOrEqual(2)
    expect(attention[1].at).toBeLessThanOrEqual(2.6)
  })

  it('(l) releases before the real resolver switches a resting cursor to screen at three seconds', () => {
    const { motion, events } = observed(41)
    motion.setPerformance({ ...idle, mode: 'watching', attention: 'cursor' }, 0.5, 0)
    for (let frame = 0; frame <= 120; frame++)
      motion.setCursor({ x: 1, y: frame / 600 }, frame / 120)
    motion.setPerformance({ ...idle, mode: 'watching', attention: 'screen' }, 0.5, 4)
    motion.advance(5)
    const attention = attentionEvents(events)
    expect(attention.map(event => event.phase)).toEqual(['notice', 'engage', 'release'])
    expect(attention[2].at).toBeLessThan(1 + 2.4)
  })

  it('(m) dismisses an in-flight notice and leaves its target within 150 ms', () => {
    const { motion, events } = observed(83)
    motion.setCursor({ x: 1.5, y: 0 }, 0)
    motion.advance(0.1)
    const notice = attentionEvents(events)[0]
    expect(notice.phase).toBe('notice')
    const switchAt = notice.at + 0.2
    motion.setPerformance({ ...idle, mode: 'watching', attention: 'screen' }, 0.5, switchAt)
    const point = motion.advance(switchAt + 0.15).fixation
    expect(attentionEvents(events).map(event => event.phase)).toEqual(['notice', 'dismiss'])
    expect(Math.hypot(point.x - mapCursor({ x: 1.5, y: 0 }).eye.x, point.y)).toBeGreaterThan(0.3)
  })

  it.each(['release', 'dismiss'] as const)('(n) never renews pursuit on residual weight after %s over fifty seeds', (phase) => {
    const target = mapCursor({ x: 3, y: 0 }).eye
    let engagedSeeds = 0
    let checkedSteps = 0
    let nearest = Number.POSITIVE_INFINITY
    for (let seed = 0; seed < 50; seed++) {
      const { motion, events } = observed(seed)
      motion.setCursor({ x: 3, y: 0 }, 0)
      motion.advance(0.6)
      if (!attentionEvents(events).some(event => event.phase === 'engage'))
        continue
      engagedSeeds++
      if (phase === 'dismiss')
        motion.setPerformance({ ...idle, mode: 'watching', attention: 'screen' }, 0.5, 0.6)
      // Eight seconds includes the entire residual-weight decay to exact zero.
      for (let frame = 73; frame <= 8 * 120; frame++) {
        const time = frame / 120
        const { fixation } = motion.advance(time)
        const ended = attentionEvents(events).find(event => event.phase === phase)
        if (ended !== undefined && time >= ended.at + (phase === 'release' ? 0.39 : 0.15)) {
          nearest = Math.min(nearest, Math.hypot(fixation.x - target.x, fixation.y - target.y))
          checkedSteps++
        }
      }
      expect(attentionEvents(events).map(event => event.phase)).toEqual(['notice', 'engage', phase])
    }
    expect(engagedSeeds).toBeGreaterThanOrEqual(10)
    expect(checkedSteps).toBeGreaterThan(0)
    expect(nearest).toBeGreaterThan(0.3)
  }, 20_000)

  it('reports one grateful camera glance only after a pet longer than three active seconds', () => {
    const glance = vi.spyOn(NaturalGazeLayer.prototype, 'glance')
    try {
      for (const duration of [2, 4]) {
        const { motion, events } = observed(67)
        motion.setPet({ x: 0.4, y: 0 }, 0)
        motion.setPet(null, duration)
        motion.advance(duration + 0.1)
        expect(events.filter(event => event.kind === 'touch').map(event => event.touch)).toEqual(['pet-start', 'pet-end'])
      }
      expect(glance).toHaveBeenCalledExactlyOnceWith({ x: 0, y: 0 }, 1.2, expect.any(Number))
    }
    finally {
      glance.mockRestore()
    }
  })

  it.each([67, 41, 83].flatMap(seed => ['absent', 'moving', 'arriving'].map(cursor => ({ seed, cursor }))))('(T6-LONGPET) holds the camera for the full release glance with seed $seed and $cursor cursor', ({ seed, cursor }) => {
    const { motion, events } = observed(seed)
    motion.setPet({ x: 0.4, y: 0 }, 0)
    let cameraSamples = 0
    let resumedCursor = false
    for (let frame = 0; frame <= 6 * 120; frame++) {
      const time = frame / 120
      const offset = { x: 1.5, y: -0.1 + 0.1 * Math.sin(time * 6) }
      // The arriving case notices a cursor after the pet's release crosses 0.5,
      // while the grateful camera glance must still own gaze.
      if (cursor === 'moving' || (cursor === 'arriving' && time >= 4.7))
        motion.setCursor(offset, time)
      if (frame === 4 * 120)
        motion.setPet(null, time)
      const { fixation } = motion.advance(time)
      // Sample every grid step through end + 1.2 s, allowing the maximum
      // 90 ms saccade and one grid step before requiring camera fixation.
      if (frame >= 4 * 120 + 12 && frame <= 4 * 120 + 144) {
        expect(Math.hypot(fixation.x, fixation.y), `camera at ${time}s`).toBeLessThan(0.05)
        cameraSamples++
      }
      if (time >= 5.3) {
        const target = mapCursor(offset).eye
        resumedCursor ||= Math.hypot(fixation.x - target.x, fixation.y - target.y) < 0.05
      }
    }
    expect(cameraSamples).toBe(133)
    expect(events.filter(event => event.kind === 'touch').map(event => event.touch)).toEqual(['pet-start', 'pet-end'])
    if (cursor !== 'absent')
      expect(resumedCursor).toBe(true)
  })

  it.each([41, 67, 83].flatMap(seed => (['aside', 'screen', 'dismissed'] as const).map(dismiss => ({ seed, dismiss }))))('(T6-DISMISS) keeps $dismiss authoritative over the released pet with seed $seed', ({ seed, dismiss }) => {
    const { motion } = observed(seed)
    motion.setPet({ x: 1, y: 0 }, 0)
    let side = 0
    let checked = 0
    for (let frame = 0; frame <= 7 * 120; frame++) {
      const time = frame / 120
      motion.setCursor({ x: 1.5, y: -0.1 + 0.1 * Math.sin(time * 6) }, time, dismiss === 'dismissed' && frame >= 516 ? 'dismissed' : 'live')
      if (frame === 480)
        motion.setPet(null, time)
      if (frame === 516 && dismiss !== 'dismissed')
        motion.setPerformance({ ...idle, mode: 'talking', attention: dismiss }, 0.5, time)
      const { fixation } = motion.advance(time)
      // Dismiss at 4.3 s; by 4.45 s its eased saccade must have landed.
      if (frame >= 534) {
        if (dismiss === 'aside') {
          side ||= Math.sign(fixation.x)
          expect(side * fixation.x, `aside at ${time}s`).toBeGreaterThan(0.35)
        }
        else {
          // The released pet's fixed target is (0.1, -0.12). Screen and
          // disabled cursor attention must leave it for autonomous fixations.
          expect(Math.hypot(fixation.x - 0.1, fixation.y + 0.12), `pet target at ${time}s`).toBeGreaterThan(0.05)
          expect(fixation.x, `cursor at ${time}s`).toBeLessThan(0.35)
        }
        checked++
      }
    }
    expect(checked).toBe(307)
  })

  it.each([41, 67, 83].flatMap(seed => (['screen', 'dismissed'] as const).map(dismiss => ({ seed, dismiss }))))('(T6-DISMISS) never restores a cancelled pet tail after $dismiss with seed $seed', ({ seed, dismiss }) => {
    const { motion } = observed(seed)
    motion.setPet({ x: 1, y: 0 }, 0)
    for (let frame = 0; frame <= 534; frame++) {
      const time = frame / 120
      const offset = { x: 1.5, y: -0.1 + 0.1 * Math.sin(time * 6) }
      // Dismiss from 4.1 to 4.2 s, while the decaying pet level is still > 0.5.
      motion.setCursor(offset, time, dismiss === 'dismissed' && frame >= 492 && frame < 504 ? 'dismissed' : 'live')
      if (frame === 480)
        motion.setPet(null, time)
      if (dismiss === 'screen' && (frame === 492 || frame === 504))
        motion.setPerformance({ ...idle, attention: frame === 492 ? 'screen' : 'cursor' }, 0.5, time)
      const { fixation } = motion.advance(time)
      if (frame >= 522) {
        const target = mapCursor(offset).eye
        expect(Math.hypot(fixation.x - target.x, fixation.y - target.y), `resumed cursor at ${time}s`).toBeLessThan(0.05)
      }
    }
  })

  it('keeps observer attachment and detachment neutral for cursor and touch motion', () => {
    const { motion, events } = observed(41)
    const quiet = new Live2DNaturalMotion({ seed: 41 })
    quiet.advance(0)
    for (let frame = 0; frame <= 600; frame++) {
      const time = frame / 120
      for (const instance of [motion, quiet]) {
        instance.setCursor({ x: 1, y: 0.2 * Math.sin(time * 5) }, time)
        instance.setPet(time >= 1 && time < 3 ? { x: Math.sin(time), y: 0.5 } : null, time)
        if (frame === 480)
          instance.poke('body', 0.5, -1, time)
      }
      expect(motion.advance(time)).toEqual(quiet.advance(time))
    }
    expect(events.some(event => event.kind === 'attention')).toBe(true)
    expect(events.filter(event => event.kind === 'touch').map(event => event.touch)).toEqual(['pet-start', 'pet-end', 'poke'])
    const reported = events.length
    motion.setObserver(null)
    motion.poke('head', 0, 0, 6)
    motion.setPet({ x: 0, y: 0 }, 6)
    motion.advance(7)
    expect(events).toHaveLength(reported)
  })
})

describe('held Natural composition', () => {
  it('feeds held posture into the body follower without an impulse, mood dose, or gesture', () => {
    const motion = new Live2DNaturalMotion({ seed: 41 })
    const control = new Live2DNaturalMotion({ seed: 41 })
    const hold = new NaturalHoldLayer()
    control.advance(0)
    hold.set({ emotion: 'question', strength: 0.6 })

    motion.setHeldEmotion({ emotion: 'question', strength: 0.6 }, 0)
    for (let frame = 1; frame < 480; frame++)
      hold.step(1 / 120)
    const actual = motion.advance(4)
    const baseline = control.advance(4)

    const roll = actual.pose.headZ - baseline.pose.headZ
    const body = (actual.pose.bodyZ ?? 0) - (baseline.pose.bodyZ ?? 0)
    expect(roll).toBeCloseTo(hold.posture()[2], 10)
    expect(Math.abs(body)).toBeGreaterThan(0.005)
    expect(Math.sign(body)).toBe(Math.sign(roll))
    expect(motion.moodState).toEqual({ valence: 0, arousal: 0, tension: 0 })
  })

  it.each(['clear', 'strong'] as const)('replaces impulse head and body with the %s gesture instead of doubling them', (band) => {
    const motion = new Live2DNaturalMotion({ seed: 41 })
    const control = new Live2DNaturalMotion({ seed: 41 })
    const settings = structuredClone(defaultExpressionPerformanceSettings)
    settings.naturalBands.headGain = 0
    settings.naturalBands.bodyGain = 0
    control.setPerformanceSettings(settings)
    const episode = { id: 'gesture', emotion: 'happy', band, nominal: 0.9, intensity: 0.9, escalation: false } as const

    motion.impulse(episode, 0)
    control.impulse(episode, 0)

    for (let frame = 0; frame <= 1200; frame++)
      expect(motion.advance(frame / 120)).toEqual(control.advance(frame / 120))
  })

  it('adds the laugh face only with held emotions on, and opens the mouth only in silence', () => {
    const episode = { id: 'laugh', emotion: 'happy', band: 'strong', nominal: 0.9, intensity: 0.9, escalation: false } as const
    const facePeaks = (heldEmotions: boolean, speaking: boolean, withEpisode: boolean) => {
      const motion = new Live2DNaturalMotion({ seed: 41 })
      motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions })
      motion.setVoice({ speaking, speechActiveOrRecent: speaking, level: 0 })
      motion.advance(0)
      if (withEpisode)
        motion.impulse(episode, 0)
      const frames = Array.from({ length: 6 * 120 }, (_, i) => motion.advance((i + 1) / 120).face)
      return { smile: frames.map(face => face.eyeSmile), mouth: frames.map(face => face.silentMouthOpen) }
    }
    const peakDifference = (a: number[], b: number[]) => Math.max(...a.map((value, i) => value - b[i]))
    const scale = 0.9

    const silentOn = facePeaks(true, false, true)
    const silentOff = facePeaks(false, false, true)
    const control = facePeaks(true, false, false)
    // The impulse hints are the same either way; the gesture adds its own smile on top, bounded by 0.35 x scale.
    const smile = peakDifference(silentOn.smile, silentOff.smile)
    expect(smile).toBeGreaterThan(0.25)
    expect(smile).toBeLessThanOrEqual(0.35 * scale + 1e-9)
    const mouth = peakDifference(silentOn.mouth, control.mouth)
    expect(mouth).toBeGreaterThan(0.05)
    expect(mouth).toBeLessThanOrEqual(0.12 * scale + 1e-9)
    expect(peakDifference(silentOff.mouth, control.mouth)).toBeLessThanOrEqual(0)

    // While speech is active or recent, the gesture mouth term is exactly 0.
    const speech = facePeaks(true, true, true)
    expect(Math.max(...speech.mouth)).toBe(0)
    expect(peakDifference(speech.smile, facePeaks(false, true, true).smile)).toBeGreaterThan(0.25)
  })

  it.each([true, false])('ducks posture continuous motion under gesture clips only with held emotions on (%s)', (heldEmotions) => {
    const motion = new Live2DNaturalMotion({ seed: 41 })
    motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions })
    const scales: number[] = []
    const original = NaturalPostureLayers.prototype.step
    const spy = vi.spyOn(NaturalPostureLayers.prototype, 'step').mockImplementation(function (this: NaturalPostureLayers, ...args) {
      scales.push(this.continuousScale)
      return original.apply(this, args)
    })
    try {
      motion.advance(0)
      motion.impulse({ id: 'duck', emotion: 'happy', band: 'strong', nominal: 0.9, intensity: 0.9, escalation: false }, 0)
      for (let frame = 1; frame <= 600; frame++)
        motion.advance(frame / 120)
    }
    finally {
      spy.mockRestore()
    }
    expect(scales.length).toBeGreaterThan(0)
    if (heldEmotions)
      expect(Math.min(...scales)).toBeLessThan(1)
    else
      expect(Math.min(...scales)).toBe(1)
    expect(Math.max(...scales)).toBe(1)
  })

  it('applies the held breathing period to the actual controller waveform', () => {
    const motion = new Live2DNaturalMotion({ seed: 41 })
    const hold = new NaturalHoldLayer()
    const breath = new NaturalBreathLayer(random.createRandomStream(random.deriveSeed(41, 9)))
    breath.step(1 / 120)
    motion.setHeldEmotion({ emotion: 'sleepy', strength: 1 }, 0)
    hold.set({ emotion: 'sleepy', strength: 1 })

    for (let frame = 1; frame <= 1200; frame++) {
      if (frame > 1) {
        hold.step(1 / 120)
        breath.periodScale = hold.modulation().breathPeriod
        breath.step(1 / 120)
      }
      const actual = motion.advance(frame / 120)

      expect(actual.breath.value).toBeCloseTo(breath.output.value, 10)
    }
  })

  it('applies held acceptance and size to speech nods observed in the composed head', () => {
    const voiced = new Live2DNaturalMotion({ seed: 41 })
    const quiet = new Live2DNaturalMotion({ seed: 41 })
    const hold = new NaturalHoldLayer()
    const emphasis = new NaturalSpeechEmphasis(random.createRandomStream(random.deriveSeed(41, 10)))
    emphasis.step(1 / 120, 0, 0.25)
    for (const motion of [voiced, quiet])
      motion.setHeldEmotion({ emotion: 'happy', strength: 1 }, 0)
    hold.set({ emotion: 'happy', strength: 1 })
    let peak = 0

    for (let frame = 1; frame <= 3600; frame++) {
      const level = frame % 180 < 18 ? 0.8 : 0
      voiced.setVoice({ speaking: false, speechActiveOrRecent: false, level })
      let expected = [0, 0, 0]
      if (frame > 1) {
        hold.step(1 / 120)
        const mod = hold.modulation()
        emphasis.sizeScale = mod.nodSize
        expected = emphasis.step(1 / 120, level, 0.25 + mod.nodAcceptance)
      }
      const actual = voiced.advance(frame / 120)
      const baseline = quiet.advance(frame / 120)

      for (const [index, axis] of headAxes.entries()) {
        const delta = actual.pose[axis] - baseline.pose[axis]
        expect(delta).toBeCloseTo(expected[index], 10)
        peak = Math.max(peak, Math.abs(delta))
      }
    }
    expect(peak).toBeGreaterThan(0.02)
  })

  it('changes blink timing and gaze destinations while sleepy', () => {
    const motion = new Live2DNaturalMotion({ seed: 19092026 })
    const control = new Live2DNaturalMotion({ seed: 19092026 })
    motion.setHeldEmotion({ emotion: 'sleepy', strength: 1 }, 0)
    let actualBlinks = 0
    let controlBlinks = 0
    let actualCamera = 0
    let controlCamera = 0
    let actualDesk = 0
    let controlDesk = 0
    let previousActual = 1
    let previousControl = 1

    for (let frame = 0; frame <= 14400; frame++) {
      const actual = motion.advance(frame / 120)
      const baseline = control.advance(frame / 120)
      if (actual.blink.blinkFactor < 0.5 && previousActual >= 0.5)
        actualBlinks++
      if (baseline.blink.blinkFactor < 0.5 && previousControl >= 0.5)
        controlBlinks++
      actualCamera += Number(Math.hypot(actual.fixation.x, actual.fixation.y) < 0.06)
      controlCamera += Number(Math.hypot(baseline.fixation.x, baseline.fixation.y) < 0.06)
      actualDesk += Number(actual.fixation.y < -0.1)
      controlDesk += Number(baseline.fixation.y < -0.1)
      previousActual = actual.blink.blinkFactor
      previousControl = baseline.blink.blinkFactor
    }

    expect(actualBlinks).toBeLessThan(controlBlinks)
    expect(actualCamera).toBeLessThan(controlCamera)
    expect(actualDesk).toBeGreaterThan(controlDesk)
  })

  it('keeps sixty seconds of untouched output identical with no gesture draws', () => {
    const create = random.createRandomStream
    const draws = new Map<number, number>()
    const instrument = vi.spyOn(random, 'createRandomStream').mockImplementation((seed) => {
      const next = create(seed)
      return () => {
        draws.set(seed, (draws.get(seed) ?? 0) + 1)
        return next()
      }
    })
    try {
      const motion = new Live2DNaturalMotion({ seed: 19092026 })
      const legacy = new Live2DNaturalMotion({ seed: 19092026 })
      legacy.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions: false })

      for (let frame = 0; frame <= 3600; frame++) {
        motion.setHeldEmotion(null, frame / 60)
        expect(motion.advance(frame / 60)).toEqual(legacy.advance(frame / 60))
      }

      expect(draws.get(random.deriveSeed(19092026, 12)) ?? 0).toBe(0)
    }
    finally {
      instrument.mockRestore()
    }
  })

  it('holds a readable clear happy face and recruits less body than strong', () => {
    const peaks: number[] = []
    for (const intensity of [0.6, 0.9]) {
      const motion = new Live2DNaturalMotion({ seed: 41 })
      const control = new Live2DNaturalMotion({ seed: 41 })
      motion.setHeldEmotion({ emotion: 'happy', strength: intensity }, 0)
      motion.impulse({ id: 'happy', emotion: 'happy', intensity, nominal: intensity, band: intensity === 0.6 ? 'clear' : 'strong', escalation: false }, 0)
      let bodyPeak = 0
      const means = { browY: 0, eyeSmile: 0, mouthForm: 0 }
      let count = 0

      for (let frame = 0; frame <= 420; frame++) {
        const actual = motion.advance(frame / 120)
        const baseline = control.advance(frame / 120)
        bodyPeak = Math.max(bodyPeak, Math.hypot(...(['bodyX', 'bodyY', 'bodyZ'] as const).map(axis => (actual.pose[axis] ?? 0) - (baseline.pose[axis] ?? 0))))
        if (frame >= 60) {
          for (const key of ['browY', 'eyeSmile', 'mouthForm'] as const)
            means[key] += actual.face[key] - baseline.face[key]
          count++
        }
      }

      expect(means.browY / count).toBeGreaterThan(0.5 * 0.5 * intensity)
      expect(means.eyeSmile / count).toBeGreaterThan(0.5 * 1.6 * intensity)
      expect(means.mouthForm / count).toBeGreaterThan(0.5 * intensity)
      peaks.push(bodyPeak)
    }
    expect(peaks[0]).toBeGreaterThan(0)
    expect(peaks[0]).toBeLessThan(peaks[1])
  })

  it('releases with the exact 0.6 second decay without snapping the visible tail', () => {
    const motion = new Live2DNaturalMotion({ seed: 41 })
    motion.setHeldEmotion({ emotion: 'happy', strength: 0.6 }, 0)
    const peak = motion.advance(4).face.eyeSmile

    motion.setHeldEmotion(null, 4)

    const fourTaus = motion.advance(6.4).face.eyeSmile / peak
    const fiveTaus = motion.advance(7).face.eyeSmile / peak
    expect(fourTaus).toBeCloseTo(Math.exp(-4), 3)
    expect(fiveTaus).toBeCloseTo(Math.exp(-5), 3)
    expect(fiveTaus).toBeGreaterThan(0)
    expect(fiveTaus).toBeLessThan(0.01)
  })

  it('glides from happy to sad within the face step bound', () => {
    const motion = new Live2DNaturalMotion({ seed: 41 })
    const control = new Live2DNaturalMotion({ seed: 41 })
    motion.setHeldEmotion({ emotion: 'happy', strength: 1 }, 0)
    control.setHeldEmotion({ emotion: 'happy', strength: 1 }, 0)
    const before = motion.advance(4)

    motion.setHeldEmotion({ emotion: 'sad', strength: 1 }, 4)

    expect(motion.advance(4)).toEqual(before)
    const next = motion.advance(4 + 2 / 120)
    const unchanged = control.advance(4 + 2 / 120)
    // Subtract the unchanged held path so independent face micro-motion does not masquerade as a switch jump.
    for (const key of ['browY', 'browAngle', 'browLY', 'browRY', 'browLAngle', 'browRAngle', 'eyeSmile', 'mouthForm', 'cheek'] as const)
      expect(Math.abs(next.face[key] - unchanged.face[key])).toBeLessThan(2 / 120 / 0.25 * 1.8)
    expect(motion.advance(7).face.mouthForm).toBeLessThan(-0.7)
  })

  it.each(['happy', 'question', 'surprised'] as const)('gives pet priority over actual overlapping %s channels', (emotion) => {
    const held = new Live2DNaturalMotion({ seed: 41 })
    const petted = new Live2DNaturalMotion({ seed: 41 })
    const petOnly = new Live2DNaturalMotion({ seed: 41 })
    held.setHeldEmotion({ emotion, strength: 1 }, 0)
    petted.setHeldEmotion({ emotion, strength: 1 }, 0)
    petted.setPet({ x: 0, y: 0 }, 0)
    petOnly.setPet({ x: 0, y: 0 }, 0)

    const a = held.advance(4).face
    const b = petted.advance(4).face
    const target = petOnly.advance(4).face

    // Eye openness is a multiplier plus a hint, not two unrelated priority channels.
    expect(Math.abs(b.eyeOpenMultiplier + b.eyeOpenHint - target.eyeOpenMultiplier)).toBeLessThan(0.02)
    expect(Math.abs(b.eyeSmile - target.eyeSmile)).toBeLessThan(0.001)
    expect(Math.abs(b.browLY - target.browLY)).toBeLessThan(0.02)
    expect(Math.abs(b.browRY - target.browRY)).toBeLessThan(0.02)
    if (emotion === 'happy')
      expect(Math.abs(b.eyeSmile - target.eyeSmile)).toBeLessThan(Math.abs(a.eyeSmile - target.eyeSmile))
  })

  it('attenuates same-emotion accents in the composed held smile without saturating it', () => {
    const accented = new Live2DNaturalMotion({ seed: 41 })
    const held = new Live2DNaturalMotion({ seed: 41 })
    const accentOnly = new Live2DNaturalMotion({ seed: 41 })
    for (const motion of [accented, held, accentOnly]) {
      motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, mood: false })
      motion.advance(0)
    }
    accented.setHeldEmotion({ emotion: 'happy', strength: 1 }, 0)
    held.setHeldEmotion({ emotion: 'happy', strength: 1 }, 0)
    const episode = { id: 'accent', emotion: 'happy', intensity: 0.9, nominal: 0.9, band: 'clear', escalation: false } as const

    accented.impulse(episode, 4)
    accentOnly.impulse(episode, 4)

    const actual = accented.advance(4.5).face.eyeSmile
    const base = held.advance(4.5).face.eyeSmile
    const fullAccent = accentOnly.advance(4.5).face.eyeSmile
    // The laugh smile is a gesture term, not an accent hint, so the attenuation does not touch it.
    const hintsOnly = new Live2DNaturalMotion({ seed: 41 })
    hintsOnly.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, mood: false, heldEmotions: false })
    hintsOnly.advance(0)
    hintsOnly.impulse(episode, 4)
    const laughSmile = fullAccent - hintsOnly.advance(4.5).face.eyeSmile
    expect(laughSmile).toBeGreaterThan(0.1)
    expect(fullAccent - laughSmile).toBeGreaterThan(0.3)
    expect(actual - base).toBeCloseTo((fullAccent - laughSmile) * 0.5 + laughSmile, 6)
    expect(actual - laughSmile).toBeLessThan(2)
  })

  it('leaves a different-emotion accent unattenuated', () => {
    const accented = new Live2DNaturalMotion({ seed: 41 })
    const held = new Live2DNaturalMotion({ seed: 41 })
    const accentOnly = new Live2DNaturalMotion({ seed: 41 })
    accentOnly.advance(0)
    accented.setHeldEmotion({ emotion: 'sad', strength: 1 }, 0)
    held.setHeldEmotion({ emotion: 'sad', strength: 1 }, 0)
    const episode = { id: 'accent', emotion: 'happy', intensity: 0.9, nominal: 0.9, band: 'clear', escalation: false } as const

    accented.impulse(episode, 4)
    accentOnly.impulse(episode, 4)

    expect(accented.advance(4.5).face.eyeSmile - held.advance(4.5).face.eyeSmile).toBe(accentOnly.advance(4.5).face.eyeSmile)
  })

  it('makes a strength-zero hold and episode identical to no emotion', () => {
    const motion = new Live2DNaturalMotion({ seed: 41 })
    const control = new Live2DNaturalMotion({ seed: 41 })
    motion.setEmotionStrengths({ happy: 0 })
    motion.setHeldEmotion({ emotion: 'happy', strength: 0.9 }, 0)

    motion.impulse({ id: 'zero', emotion: 'happy', intensity: 0.9, nominal: 0.9, band: 'strong', escalation: false }, 0)

    for (let frame = 0; frame <= 1200; frame++)
      expect(motion.advance(frame / 120)).toEqual(control.advance(frame / 120))
    expect(motion.moodState).toEqual({ valence: 0, arousal: 0, tension: 0 })
  })

  it('ignores held targets and zero-strength policy when held emotions are disabled', () => {
    const motion = new Live2DNaturalMotion({ seed: 41 })
    const control = new Live2DNaturalMotion({ seed: 41 })
    for (const instance of [motion, control])
      instance.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, heldEmotions: false })
    motion.setEmotionStrengths({ happy: 0 })
    motion.setHeldEmotion({ emotion: 'happy', strength: 1 }, 0)
    const episode = { id: 'old', emotion: 'happy', intensity: 0.9, nominal: 0.9, band: 'strong', escalation: false } as const

    motion.impulse(episode, 0)
    control.impulse(episode, 0)

    for (let frame = 0; frame <= 1200; frame++)
      expect(motion.advance(frame / 120)).toEqual(control.advance(frame / 120))
  })

  it('keeps repeated held setters and repeated suspension continuous in active time', () => {
    const repeated = new Live2DNaturalMotion({ seed: 41 })
    const control = new Live2DNaturalMotion({ seed: 41 })
    control.setHeldEmotion({ emotion: 'think', strength: 0.7 }, 0)
    let pause = 0

    for (let frame = 0; frame <= 600; frame++) {
      const time = frame / 120
      repeated.setHeldEmotion({ emotion: 'think', strength: 0.7 }, time + pause)
      repeated.setEmotionStrengths({ think: 1 })
      repeated.setPerformanceSettings(defaultExpressionPerformanceSettings)
      if (frame > 0 && frame % 120 === 0) {
        const frozen = repeated.advance(time + pause)
        repeated.setSuspended(true, time + pause)
        pause += 10
        expect(repeated.advance(time + pause)).toEqual(frozen)
        repeated.setSuspended(false, time + pause)
      }
      const actual = repeated.advance(time + pause)
      const expected = control.advance(time)
      for (const [index, value] of Object.values(actual.face).entries())
        expect(value).toBeCloseTo(Object.values(expected.face)[index], 10)
      expect(maximumDelta(actual, expected)).toBeLessThan(1e-10)
    }
  })
})

describe('reacting overlay', () => {
  const energyOf = (motion: Live2DNaturalMotion): NaturalPerformanceEnergy => Reflect.get(motion, 'energy')

  /** Peak posture scales over 4 s after `act`, sampled on the 60 Hz grid. */
  function peaks(act: (motion: Live2DNaturalMotion) => void) {
    const motion = new Live2DNaturalMotion({ seed: 77 })
    motion.setPerformance(idle, 0.5, 0)
    act(motion)
    let amplitude = 0
    let shiftRate = 0
    for (let frame = 1; frame <= 4 * 60; frame++) {
      motion.advance(frame / 60)
      amplitude = Math.max(amplitude, energyOf(motion).amplitudeScale)
      shiftRate = Math.max(shiftRate, energyOf(motion).shiftRateScale)
    }
    return { amplitude, shiftRate }
  }

  const rest = peaks(() => {})

  it('leaves the preset scales alone for a strong emotion episode', () => {
    const strong = peaks(motion => motion.impulse({ id: 'strong', emotion: Emotion.Happy, nominal: 0.9, intensity: 0.9, band: 'strong', escalation: false }, 0))
    expect(strong).toEqual(rest)
  })

  it('still applies the fixed x1.3 / x1.5 overlay for a poke', () => {
    const poked = peaks(motion => motion.poke('head', 0, 0, 0))
    expect(poked.amplitude).toBeGreaterThan(rest.amplitude + 0.2)
    expect(poked.amplitude).toBeLessThanOrEqual(rest.amplitude * 1.3)
    expect(poked.shiftRate).toBeGreaterThan(rest.shiftRate + 0.3)
    expect(poked.shiftRate).toBeLessThanOrEqual(rest.shiftRate * 1.5)
  })

  it('still applies the fixed overlay for a desktop reaction', () => {
    const woke = peaks(motion => motion.setPerformance({ ...idle, reactSeq: 1, reactKind: 'wake' }, 0.5, 0))
    expect(woke.amplitude).toBeGreaterThan(rest.amplitude + 0.2)
    expect(woke.shiftRate).toBeGreaterThan(rest.shiftRate + 0.3)
  })
})
