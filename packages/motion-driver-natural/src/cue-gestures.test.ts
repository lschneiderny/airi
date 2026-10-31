import type { CueGestureKind } from './cue-gestures'

import { defaultExpressionPerformanceSettings as defaults } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it, vi } from 'vitest'

import { NaturalCueGestures } from './cue-gestures'
import { NaturalGazeLayer } from './gaze'
import { NaturalGestures } from './gestures'
import { NaturalMotion } from './natural-motion'
import { NaturalPostureLayers } from './posture'
import { createRandomStream } from './random'

const dt = 1 / 120
const kinds: CueGestureKind[] = ['nod', 'shake', 'shrug', 'lean', 'glance']
const axes = ['headX', 'headY', 'headZ', 'bodyX', 'bodyY', 'bodyZ'] as const

function layer(seed = 41) {
  const random = vi.fn(createRandomStream(seed))
  const gaze = new NaturalGazeLayer(createRandomStream(4))
  const cues = new NaturalCueGestures(random, gaze)
  return { cues, gaze, random }
}

/**
 * Same-seed, idle-subtracted facade capture. Remove only continuous posture wobble from both
 * runs to measure the clip rather than its idle duck; the duck has separate coverage below.
 */
function capture(kind: CueGestureKind, count: number, seconds: number, placement = 0) {
  const step = NaturalPostureLayers.prototype.step
  const quiet = vi.spyOn(NaturalPostureLayers.prototype, 'step').mockImplementation(function (this: NaturalPostureLayers, ...args) {
    this.continuousScale = 0
    return step.apply(this, args)
  })
  try {
    const motion = new NaturalMotion({ seed: 41 })
    const idle = new NaturalMotion({ seed: 41 })
    for (const controller of [motion, idle]) {
      controller.setPerformanceSettings({ ...defaults, heldEmotions: false })
      controller.setPlacement(placement, 0)
      controller.advance(2)
    }
    const before = motion.advance(2)
    motion.gesture(kind, count, 2)
    expect(motion.advance(2)).toEqual(before)
    return Array.from({ length: Math.round(seconds / dt) + 1 }, (_, i) => {
      // Requests start at the next grid step (2 + dt), not at the call timestamp.
      const time = 2 + dt + i * dt
      const a = motion.advance(time)
      const b = idle.advance(time)
      return {
        at: i * dt,
        head: [a.pose.headX - b.pose.headX, a.pose.headY - b.pose.headY, a.pose.headZ - b.pose.headZ],
        body: [a.pose.bodyX! - b.pose.bodyX!, a.pose.bodyY! - b.pose.bodyY!, a.pose.bodyZ! - b.pose.bodyZ!],
        brow: a.face.browLY - b.face.browLY,
        mouth: a.face.mouthForm - b.face.mouthForm,
        eyeX: a.pose.eyeX - b.pose.eyeX,
        fixation: a.fixation.x,
      }
    })
  }
  finally {
    quiet.mockRestore()
  }
}

describe('cue gesture shapes at the facade', () => {
  it('nods twice with decaying pitch dips and returns without yaw or roll', () => {
    const frames = capture('nod', 2, 1.3)
    const first = Math.min(...frames.filter(f => f.at >= 0.2 && f.at <= 0.25).map(f => f.head[1]))
    const second = Math.min(...frames.filter(f => f.at >= 0.65 && f.at <= 0.7).map(f => f.head[1]))
    expect(first).toBeLessThanOrEqual(-0.95 * 0.22)
    expect(Math.abs(second + 0.176)).toBeLessThanOrEqual(0.05 * 0.176)
    for (const frame of frames) {
      expect(Math.abs(frame.head[0])).toBeLessThan(0.01)
      expect(Math.abs(frame.head[2])).toBeLessThan(0.01)
      if (frame.at >= 0.9)
        expect(Math.abs(frame.head[1])).toBeLessThan(1e-3)
    }
  })

  it('shakes at 2 Hz with four alternating lobes and a quarter-strength body yaw', () => {
    const frames = capture('shake', 2, 1.3)
    const moving = frames.filter(f => f.at > 0 && f.at < 1 && Math.abs(f.head[0]) > 1e-8)
    const signs = moving.map(f => Math.sign(f.head[0]))
    // Two sine cycles have four lobes and three interior sign changes, not four crossings.
    expect(signs.filter((sign, i) => i === 0 || sign !== signs[i - 1])).toHaveLength(4)
    const peak = Math.max(...moving.map(f => Math.abs(f.head[0])))
    expect(peak).toBeGreaterThanOrEqual(0.18)
    expect(peak).toBeLessThanOrEqual(0.25)
    for (const frame of frames) {
      expect(frame.body[0]).toBeCloseTo(0.25 * frame.head[0], 10)
      if (frame.at >= 1)
        expect(Math.abs(frame.head[0])).toBeLessThan(1e-10)
    }
  })

  it('shrugs with a held body lift, raised brows, and negative mouth form', () => {
    const frames = capture('shrug', 1, 1.4)
    const held = frames.filter(f => f.at >= 0.25 && f.at <= 0.65)
    expect(Math.max(...held.map(f => f.body[1]))).toBeGreaterThanOrEqual(0.1425)
    expect(Math.max(...held.map(f => f.brow))).toBeGreaterThanOrEqual(0.28)
    expect(Math.min(...held.map(f => f.mouth))).toBeCloseTo(-0.15, 10)
    for (const frame of frames.filter(f => f.at >= 1.1))
      expect(Math.max(...[...frame.head, ...frame.body, frame.brow, frame.mouth].map(Math.abs))).toBeLessThan(1e-10)
  })

  it.each([-1, -0.2, 0.2, 1])('leans inward with placement %s and releases by 2.6 seconds', (placement) => {
    const frames = capture('lean', 1, 2.8, placement)
    const side = Math.sign(placement)
    for (const frame of frames.filter(f => f.at >= 0.3 && f.at <= 2.3))
      expect(Math.abs(frame.body[2] - side * 0.12)).toBeLessThanOrEqual(0.02 * 0.12)
    for (const frame of frames.filter(f => f.at >= 2.6))
      expect(Math.max(...[...frame.head, ...frame.body].map(Math.abs))).toBeLessThan(1e-10)
  })

  it('glances with eyes only and returns to autonomous gaze after the hold', () => {
    const frames = capture('glance', 1, 1.1)
    const landed = frames.filter(f => f.at >= 0.1 && f.at <= 0.2)
    const side = Math.sign(landed[0].fixation)
    expect(Math.max(...landed.map(f => side * f.eyeX))).toBeGreaterThanOrEqual(0.28)
    for (const frame of frames)
      expect(Math.hypot(...frame.head)).toBeLessThan(0.005)
    expect(frames.at(-1)!.fixation).not.toBeCloseTo(side * 0.35, 3)
  })
})

describe('cue gesture arbitration', () => {
  it('starts a conflicting queued shake when a two-dip nod ends at 0.9', () => {
    const { cues } = layer()
    expect(cues.trigger('nod', 2, 0)).toBe(true)
    expect(cues.trigger('shake', 2, 0.3)).toBe(false)
    cues.advance(0.89)
    expect(cues.headOffset(0.89)[0]).toBe(0)
    cues.advance(0.9)
    expect(cues.activeUntil()).toBeCloseTo(1.9, 12)
    expect(Math.abs(cues.headOffset(1.025)[0])).toBeGreaterThan(0)
  })

  it('replaces the one-slot queue with the newer conflicting shrug', () => {
    const { cues } = layer()
    cues.trigger('nod', 2, 0)
    cues.trigger('shake', 2, 0.3)
    cues.trigger('shrug', 1, 0.5)
    cues.advance(0.9)
    expect(cues.activeUntil()).toBe(2)
    expect(cues.headOffset(1.15)[0]).toBe(0)
    expect(cues.bodyOffset(1.15)[1]).toBeCloseTo(0.15, 12)
  })

  it('drops a cue that waits longer than 1.5 seconds without drawing for it', () => {
    const { cues, random } = layer()
    cues.trigger('lean', 1, 0)
    cues.trigger('shrug', 1, 0.2)
    cues.advance(2.6)
    expect(cues.activeUntil()).toBe(0)
    expect(random).toHaveBeenCalledTimes(1)
    expect(cues.bodyOffset(2.8)).toEqual([0, 0, 0])
  })

  it('allows disjoint channels together and ignores active duplicates without a draw', () => {
    const { cues, random } = layer()
    cues.trigger('nod', 2, 0)
    cues.trigger('lean', 1, 0)
    cues.trigger('glance', 1, 0)
    expect(cues.trigger('nod', 3, 0.1)).toBe(false)
    expect(random).toHaveBeenCalledTimes(3)
    expect(cues.headOffset(0.225)[1]).toBeCloseTo(-0.22, 12)
    expect(Math.abs(cues.bodyOffset(0.3)[2])).toBeCloseTo(0.12, 12)
    expect(cues.eyesActive(0.3)).toBe(true)
  })

  it('keeps refused and idle streams untouched and rejects invalid numeric input', () => {
    const a = layer(7)
    const b = layer(7)
    for (const count of [0, -1, 1.5, 4, Number.NaN, Number.POSITIVE_INFINITY])
      expect(a.cues.trigger('nod', count, 0)).toBe(false)
    expect(a.cues.trigger('nod', 1, Number.NaN)).toBe(false)
    a.cues.advance(1)
    expect(a.random).not.toHaveBeenCalled()
    for (const item of [a, b])
      item.cues.trigger('shake', 2, 2)
    expect(a.cues.trigger('shake', 1, 2.2)).toBe(false)
    for (const item of [a, b])
      item.cues.trigger('shrug', 1, 4)
    expect(a.cues.headOffset(4.3)).toEqual(b.cues.headOffset(4.3))
    expect(a.random()).toBe(b.random())
  })

  it('does not advance a due queued clip as a side effect of a refused trigger', () => {
    const { cues, random } = layer()
    cues.trigger('nod', 2, 0)
    cues.trigger('lean', 1, 0)
    cues.trigger('shake', 2, 0.3)
    expect(random).toHaveBeenCalledTimes(2)
    expect(cues.trigger('lean', 1, 1)).toBe(false)
    expect(random).toHaveBeenCalledTimes(2)
    cues.advance(1)
    expect(random).toHaveBeenCalledTimes(3)
    expect(Math.abs(cues.headOffset(1)[0])).toBeGreaterThan(0)
  })

  it('ducks by 0.45 over 0.15 seconds, releases over 0.3, and leaves glances unducked', () => {
    const { cues } = layer()
    expect(cues.continuousScale(0)).toBe(1)
    cues.trigger('nod', 2, 0)
    expect(cues.continuousScale(0)).toBe(1)
    expect(cues.continuousScale(0.075)).toBeCloseTo(0.775, 12)
    expect(cues.continuousScale(0.15)).toBeCloseTo(0.55, 12)
    cues.trigger('lean', 1, 0.2)
    expect(cues.continuousScale(0.5)).toBeCloseTo(0.55, 12)
    expect(cues.continuousScale(2.95)).toBeCloseTo(0.775, 12)
    expect(cues.continuousScale(3.1)).toBe(1)
    const eyes = layer()
    eyes.cues.trigger('glance', 1, 0)
    expect(eyes.cues.continuousScale(0.2)).toBe(1)
  })

  it('does not draw a lean side when placement supplies it', () => {
    for (const side of [-1, 1]) {
      const { cues, random } = layer()
      cues.placement = side
      cues.trigger('lean', 1, 0)
      expect(cues.bodyOffset(0.3)[2]).toBeCloseTo(side * 0.12, 12)
      expect(random).not.toHaveBeenCalled()
    }
  })

  it('compensates the eyes for a cue head while ignoring continuous wobble', () => {
    const motion = new NaturalMotion({ seed: 41 })
    const idle = new NaturalMotion({ seed: 41 })
    const cue = layer()
    cue.cues.trigger('nod', 2, dt)
    motion.gesture('nod', 2, 0)
    idle.advance(0)
    for (let i = 1; i <= 100; i++) {
      const time = i * dt
      const a = motion.advance(time)
      const b = idle.advance(time)
      // Reconstruct the expected eye command through the public compensation transformation.
      // The varying idle wobble is deliberately excluded from eye compensation.
      const headY = cue.cues.headOffset(time)[1]
      const delta = NaturalGazeLayer.eye({ x: 0, y: 0 }, { x: 0, y: headY })
      expect(a.pose.eyeY - b.pose.eyeY).toBeCloseTo(delta.y, 8)
    }
  })

  it('refuses emotion recipe clips during a cue head clip, without changing the recipe stream', () => {
    const recipe = vi.spyOn(NaturalGestures.prototype, 'trigger')
    try {
      const motion = new NaturalMotion({ seed: 41 })
      motion.setPerformanceSettings({ ...defaults, heldEmotions: true })
      motion.gesture('nod', 2, 0)
      motion.advance(0.1)
      motion.impulse({ id: 'cue-active', emotion: 'happy', band: 'strong', nominal: 1, intensity: 1, escalation: false }, 0.1)
      motion.advance(0.2)
      expect(recipe).not.toHaveBeenCalled()
      motion.impulse({ id: 'cue-ended', emotion: 'happy', band: 'strong', nominal: 1, intensity: 1, escalation: false }, 1)
      motion.advance(1.1)
      expect(recipe).toHaveBeenCalledOnce()
    }
    finally {
      recipe.mockRestore()
    }
  })

  it.each(kinds)('bounds %s with a strong emotion clip and the pet layer', (kind) => {
    for (const seed of [1, 7, 41]) {
      const motion = new NaturalMotion({ seed })
      motion.setPerformanceSettings({ ...defaults, heldEmotions: true })
      motion.setPet({ x: 1, y: -1 }, 0)
      motion.setHeldEmotion({ emotion: 'angry', strength: 1 }, 0)
      motion.impulse({ id: 'strong', emotion: 'angry', nominal: 1, intensity: 1, band: 'strong', escalation: false }, 0)
      motion.advance(0.1)
      motion.gesture(kind, 3, 0.1)
      for (let i = 12; i <= 5 * 120; i++) {
        const frame = motion.advance(i * dt)
        for (const axis of axes) {
          expect(Number.isFinite(frame.pose[axis])).toBe(true)
          expect(Math.abs(frame.pose[axis]!)).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})
