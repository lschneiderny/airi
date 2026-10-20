import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it, vi } from 'vitest'

import { Emotion } from '../../constants/emotions'
import { Live2DNaturalMotion } from './natural-motion'
import { NaturalBreathLayer } from './natural-motion/breath'
import { NaturalPerformanceEnergy } from './natural-motion/energy'
import { NaturalHoldLayer } from './natural-motion/hold'
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
    expect(react).toHaveBeenCalledWith(expect.any(Number), 1, true)
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
    // Eyes may saccade back; head and body must not snap.
    expect(maximumDelta(released, attended, ['headX', 'headY', 'headZ', 'bodyX', 'bodyY', 'bodyZ'])).toBeLessThan(0.02)
    expect(released.fixation.x).toBeGreaterThan(0.5)
    expect(motion.advance(3.5).fixation.x).toBeLessThan(0.1)
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
  })

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
      motion.setCursor(null, 2 + gap)
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
      motion.setCursor(null, 2.8)
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

    it('leaves a pause without a look cue unchanged: the gaze follows the cursor at once', () => {
      const motion = new Live2DNaturalMotion({ seed: 71 })
      motion.setPerformance({ ...idle, mode: 'talking' }, 0.5, 0)
      sample(motion, 0, 2)
      motion.setPerformance(pause, 0.5, 2)
      motion.setCursor(cursor, 2)
      const point = sample(motion, 2, 2.15).at(-1)!

      // Cursor attention looks 65% of the way toward the cursor.
      expect(point.x).toBeCloseTo(0.65 * cursor.x, 6)
      expect(point.y).toBeCloseTo(0.65 * cursor.y, 6)
    })
  })

  describe('screen attention with a moving cursor', () => {
    // The cursor stays up and left of every autonomous target, so cursor fixations (65% of the way) are unmistakable.
    const cursorAt = (time: number) => ({ x: -0.9 + 0.1 * Math.sin(5 * time), y: 0.8 })
    // Autonomous targets stay within 0.2 of the center; cursor fixations sit near x = -0.585.
    const offCursor = (point: { x: number, y: number }) => point.x > -0.3

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
    poked.poke('head', 1, 2)
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
    single.poke('head', 1, 2)
    repeated.poke('head', 1, 2)
    // Time only moves forward: each window starts one frame after the previous one ends.
    const browPeak = (motion: Live2DNaturalMotion, from: number, to: number) => {
      let brow = 0
      for (let frame = from * 60 + 1; frame <= to * 60; frame++)
        brow = Math.max(brow, motion.advance(frame / 60).face.browLY)
      return brow
    }
    browPeak(single, 2, 3)
    browPeak(repeated, 2, 3)
    repeated.poke('head', 1, 3)
    // The repeat adds no surprise of its own, so the brows match the single poke.
    expect(browPeak(repeated, 3, 4)).toBeCloseTo(browPeak(single, 3, 4), 6)
    browPeak(single, 4, 5)
    browPeak(repeated, 4, 5)
    repeated.poke('head', 1, 5)
    expect(browPeak(repeated, 5, 6)).toBeGreaterThan(browPeak(single, 5, 6) + 0.05)
  })

  it('settles into a pet with happy closed eyes, ignores the cursor, and lets go after', () => {
    const petted = new Live2DNaturalMotion({ seed: 67 })
    petted.advance(0)
    petted.setCursor({ x: 1, y: 1 }, 0)
    petted.setPet(0, 1)
    let nearestCursorGaze = Number.POSITIVE_INFINITY
    // The release saccade away from the cursor lasts at most 90 ms, so sampling starts after it.
    for (let frame = 90; frame <= 4 * 60; frame++) {
      const { fixation } = petted.advance(frame / 60)
      // Cursor attention would hold the gaze near 0.65 x the cursor.
      nearestCursorGaze = Math.min(nearestCursorGaze, Math.hypot(fixation.x - 0.65, fixation.y - 0.65))
    }
    expect(nearestCursorGaze).toBeGreaterThan(0.3)
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
    petted.setPet(0, 0)
    petOnly.setPet(0, 0)

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
    expect(fullAccent).toBeGreaterThan(0.3)
    expect(actual - base).toBeCloseTo(fullAccent * 0.5, 6)
    expect(actual).toBeLessThan(2)
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
