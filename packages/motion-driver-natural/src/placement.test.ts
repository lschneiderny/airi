import { afterEach, describe, expect, it, vi } from 'vitest'

import { NaturalGazeLayer } from './gaze'
import { NaturalMotion } from './natural-motion'
import { NaturalPlacement, shapeInwardness } from './placement'

const dt = 1 / 120

describe('natural placement', () => {
  it.each([0, 0.15, 0.475, 0.8, 1])('shapes inwardness symmetrically at %s', (u) => {
    const expected = u <= 0.15 ? 0 : u === 0.475 ? 0.5 : 1
    expect(shapeInwardness(u)).toBeCloseTo(expected, 12)
    expect(shapeInwardness(-u)).toBeCloseTo(-expected, 12)
  })

  it.each([-0, 0.1, -0.1, -0.15, Number.NaN])('returns positive zero for dead-zone or malformed input %s', (u) => {
    expect(Object.is(shapeInwardness(u), 0)).toBe(true)
  })

  it('eases by exactly one time constant in two seconds without a grid-step snap', () => {
    const placement = new NaturalPlacement()
    expect(placement.enabled).toBe(false)
    placement.set(1)
    let previous = placement.value
    for (let i = 0; i < 240; i++) {
      placement.step(dt)
      expect(placement.value - previous).toBeLessThanOrEqual(1 - Math.exp(-dt / 2) + 1e-15)
      previous = placement.value
    }
    expect(placement.value).toBeCloseTo(1 - Math.exp(-1), 12)
    placement.set(0)
    placement.step(2)
    expect(placement.value).toBeCloseTo((1 - Math.exp(-1)) * Math.exp(-1), 12)
    expect(placement.enabled).toBe(true)
    placement.set(null)
    expect(placement.enabled).toBe(false)
    expect(placement.target).toBe(0)
    expect(Object.is(placement.value, 0)).toBe(true)
    placement.step(2)
    expect(Object.is(placement.value, 0)).toBe(true)
  })

  it('keeps a centered target exactly positive zero', () => {
    const placement = new NaturalPlacement()
    placement.set(0)
    for (let i = 0; i < 240; i++) {
      placement.step(dt)
      expect(Object.is(placement.value, 0)).toBe(true)
    }
  })
})

describe('natural placement controller', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([-1, 1])('biases only head yaw inward during a seeded 120 s run with placement %s', (inward) => {
    const motion = new NaturalMotion({ seed: 41, home: 'desk' })
    const reference = new NaturalMotion({ seed: 41, home: 'desk' })
    motion.setPlacement(inward, 0)
    reference.setPlacement(null, 0)
    let sum = 0
    let count = 0
    for (let frame = 1; frame <= 120 / dt; frame++) {
      const at = frame * dt
      const actual = motion.advance(at)
      const baseline = reference.advance(at)
      expect(actual.pose.headZ).toBe(baseline.pose.headZ)
      if (at >= 10) {
        expect(motion.placementYawBias * inward).toBeGreaterThan(0.099)
        expect(motion.placementYawBias * inward).toBeLessThanOrEqual(0.1)
        sum += inward * (actual.pose.headX - baseline.pose.headX)
        count++
      }
    }
    expect(sum / count).toBeGreaterThanOrEqual(0.05)
    expect(sum / count).toBeLessThanOrEqual(0.15)
  })

  it('fades placement yaw while a deterministic moving cursor is engaged', () => {
    const originalStep = NaturalGazeLayer.prototype.step
    let onCursor = 0
    // The controller smooths this flag just before gaze.step. Observe that same input
    // without replacing gaze behavior or adding a test-only controller export.
    vi.spyOn(NaturalGazeLayer.prototype, 'step').mockImplementation(function (this: NaturalGazeLayer, delta) {
      onCursor += (Number(this.onCursor) - onCursor) * (1 - Math.exp(-delta / 0.3))
      return originalStep.call(this, delta)
    })
    const motion = new NaturalMotion({ seed: 41, home: 'desk' })
    motion.setPlacement(1, 0)
    let engaged = 0
    let count = 0
    for (let frame = 1; frame <= 120 / dt; frame++) {
      const at = frame * dt
      motion.setCursor({ x: 1.5 + Math.cos(Math.PI * at), y: Math.sin(Math.PI * at) }, at - dt)
      motion.advance(at)
      if (at < 10)
        continue
      count++
      if (onCursor >= 0.95) {
        engaged++
        expect(Math.abs(motion.placementYawBias)).toBeLessThanOrEqual(0.005)
      }
    }
    expect(engaged / count).toBeGreaterThanOrEqual(0.2)
  })

  it('disables placement on the very next grid step without an easing tail', () => {
    const inward = vi.spyOn(NaturalGazeLayer.prototype, 'setInward')
    const motion = new NaturalMotion({ seed: 41, home: 'desk' })
    motion.setPlacement(1, 0)
    motion.advance(30)
    expect(motion.placementYawBias).toBeGreaterThan(0.099)
    motion.setPlacement(null, 30)
    motion.advance(30 + dt)
    expect(motion.placementYawBias).toBe(0)
    expect(inward).toHaveBeenLastCalledWith(0)
    expect(motion).toHaveProperty('gaze.inward', 0)
    const gaze = inward.mock.contexts.at(-1)
    if (!(gaze instanceof NaturalGazeLayer))
      throw new Error('The controller must pass placement to its gaze layer')
    expect(gaze.screenPoint().x).toBe(0)
  })

  it('activates the screen point only for watching or screen attention and uses it for screen changes', () => {
    const motion = new NaturalMotion({ seed: 41, home: 'desk' })
    const state = { mode: 'idle', attention: 'camera', away: false, reactSeq: 0, reactKind: 'none' } as const
    motion.setPlacement(1, 0)
    motion.setPerformance(state, 0.5, 0)
    motion.advance(30)
    expect(motion).toHaveProperty('gaze.screenPointActive', false)
    motion.setPerformance({ ...state, mode: 'watching' }, 0.5, 30)
    motion.advance(30 + dt)
    expect(motion).toHaveProperty('gaze.screenPointActive', true)
    motion.setPerformance({ ...state, mode: 'talking', attention: 'screen' }, 0.5, 30 + dt)
    motion.advance(30 + 2 * dt)
    expect(motion).toHaveProperty('gaze.screenPointActive', true)
    motion.setPerformance({ ...state, mode: 'listening', reactSeq: 1, reactKind: 'screen-change' }, 0.5, 30 + 2 * dt)
    const frame = motion.advance(30.2)
    expect(motion).toHaveProperty('gaze.screenPointActive', false)
    expect(frame.fixation.x).toBeCloseTo(0.3, 5)
    expect(frame.fixation.y).toBeCloseTo(-0.18, 12)
  })
})
