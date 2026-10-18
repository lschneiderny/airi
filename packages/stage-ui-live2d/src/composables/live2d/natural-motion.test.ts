import type { PerformanceState } from '@proj-airi/stage-shared/performance-state'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it, vi } from 'vitest'

import { Emotion } from '../../constants/emotions'
import { Live2DNaturalMotion } from './natural-motion'
import { NaturalPerformanceEnergy } from './natural-motion/energy'

const idle: PerformanceState = { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' }
const headAxes = ['headX', 'headY', 'headZ'] as const

it.each([
  { band: 'slight', intensity: 0.25 },
  { band: 'clear', intensity: 0.6 },
  { band: 'strong', intensity: 0.9 },
] as const)('isolates $band recruitment at the facade', ({ band, intensity }) => {
  const motion = new Live2DNaturalMotion({ seed: 41 })
  const control = new Live2DNaturalMotion({ seed: 41 })
  motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, mood: false })
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
  withoutRecruitment.naturalBands.headGain = 0
  withoutRecruitment.naturalBands.bodyGain = 0
  motion.setPerformanceSettings({ ...defaultExpressionPerformanceSettings })
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
