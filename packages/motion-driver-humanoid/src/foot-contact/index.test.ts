import type { Vec3 } from '../types'

import { describe, expect, it } from 'vitest'

import { createFootContact, planFootSteps } from './index'

// Ellen post-parse bind positions from the regenerated PMX audit (2026-10-31).
const legs = {
  left: {
    hip: { x: 0.946545, y: 10.459811, z: 0.092205 },
    knee: { x: 1.183816, y: 5.959278, z: 0.223915 },
    ankle: { x: 1.433686, y: 1.117993, z: 0.095487 },
  },
  right: {
    hip: { x: -0.946545, y: 10.459814, z: 0.092208 },
    knee: { x: -1.212762, y: 5.958975, z: 0.097012 },
    ankle: { x: -1.433686, y: 1.117993, z: 0.095487 },
  },
}
const traits = { footBaselineY: 1.117993, kneeBendSign: 1 as const }
const feet = {
  left: { position: legs.left.ankle, yaw: 0.2, clipFootTrackWeight: 0, kneeAnimated: false },
  right: { position: legs.right.ankle, yaw: -0.2, clipFootTrackWeight: 0, kneeAnimated: false },
}
const standing = { pelvisOffset: { x: 0, y: 0, z: 0 }, feet, enabled: true, duck: 1 }
const sides = ['left', 'right'] as const

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

describe('foot contact', () => {
  it('holds mesh-local anchors without creep throughout a 600-frame lateral sweep', () => {
    const planner = createFootContact({ legs, traits })
    const initial = planner.step(standing, 0.3)
    let maxError = 0
    let maxJump = 0
    let previous = initial
    for (let frame = 0; frame < 600; frame++) {
      const phase = frame * 2 * Math.PI / 599
      const x = 0.6 * Math.sin(phase)
      // Incoming ankles follow the unsolved sway, not the planted targets.
      const incoming = (side: typeof sides[number]) => ({
        ...feet[side],
        position: {
          x: feet[side].position.x + x,
          y: feet[side].position.y + 0.1 * Math.cos(phase),
          z: feet[side].position.z + 0.2 * Math.sin(2 * phase),
        },
      })
      const result = planner.step({
        ...standing,
        pelvisOffset: { x, y: 0, z: 0 },
        feet: { left: incoming('left'), right: incoming('right') },
      }, 1 / 60)
      for (const side of sides) {
        maxError = Math.max(maxError, distance(result.feet[side].target.position, initial.feet[side].anchor.position))
        maxJump = Math.max(maxJump, distance(result.feet[side].anchor.position, previous.feet[side].anchor.position))
        expect(result.feet[side].anchor.yaw).toBe(feet[side].yaw)
      }
      previous = result
    }
    expect(maxError).toBeLessThan(0.01)
    expect(maxJump).toBe(0)
  })

  it('caps drop and keeps both legs reachable even beyond the lateral reach radius', () => {
    const planner = createFootContact({ legs, traits })
    planner.step(standing, 0.3)
    for (const x of [-20, -0.6, 0, 0.6, 20, 0]) {
      const result = planner.step({ ...standing, pelvisOffset: { x, y: 0, z: x / 3 } }, 1 / 60)
      expect(result.drop).toBeGreaterThanOrEqual(0)
      for (const side of sides) {
        const leg = legs[side]
        const length = distance(leg.hip, leg.knee) + distance(leg.knee, leg.ankle)
        expect(result.drop).toBeLessThanOrEqual(0.06 * length)
        const hip = {
          x: leg.hip.x + result.pelvisOffset.x,
          y: leg.hip.y + result.pelvisOffset.y,
          z: leg.hip.z + result.pelvisOffset.z,
        }
        expect(distance(hip, result.feet[side].anchor.position)).toBeLessThanOrEqual(0.985 * length + 1e-4)
      }
      if (Math.abs(x) === 20)
        expect(result.lateralScale).toBeLessThan(1)
    }
  })

  it('eases contact over 0.3 seconds and releases for a full foot clip', () => {
    const planner = createFootContact({ legs, traits })
    expect(planner.step(standing, 0).feet.left.c).toBe(0)
    expect(planner.step(standing, 0.15).feet.left.c).toBeCloseTo(0.5)
    expect(planner.step(standing, 0.15).feet.left.c).toBe(1)
    const clipped = { ...standing, feet: { ...feet, left: { ...feet.left, clipFootTrackWeight: 1 } } }
    expect(planner.step(clipped, 0.3).feet.left.c).toBe(0)
    expect(planner.step({ ...standing, duck: 0.4 }, 0.3).feet.left.c).toBeCloseTo(0.4)
    expect(planner.step({ ...standing, enabled: false }, 0.3).feet.left.c).toBe(0)
  })

  it('reanchors only after release at the last solved ankle and baseline height', () => {
    const planner = createFootContact({ legs, traits })
    planner.step(standing, 0.3)
    const moved = { ...standing, feet: { ...feet, left: { ...feet.left, position: { x: 2, y: 4, z: 1 }, yaw: 0.8 } } }
    expect(planner.step(moved, 0.3).feet.left.anchor.position).toEqual(legs.left.ankle)
    planner.step({ ...moved, enabled: false }, 0.3)
    const result = planner.step(moved, 0)
    expect(result.feet.left.anchor).toEqual({ position: { x: 2, y: traits.footBaselineY, z: 1 }, yaw: 0.8 })
  })

  it.each([1, -1] as const)('pre-bends unanimated knees in direction %s', (kneeBendSign) => {
    const planner = createFootContact({ legs, traits: { ...traits, kneeBendSign } })
    const result = planner.step({
      ...standing,
      feet: { ...feet, right: { ...feet.right, kneeAnimated: true } },
    }, 0.3)
    expect(result.feet.left.kneePreBend).toBeCloseTo(kneeBendSign * 4 * Math.PI / 180)
    expect(result.feet.right.kneePreBend).toBe(0)
  })

  it('keeps a degenerate zero-length leg finite', () => {
    const zero = { x: 0, y: 0, z: 0 }
    const leg = { hip: zero, knee: zero, ankle: zero }
    const foot = { ...feet.left, position: zero }
    const planner = createFootContact({ legs: { left: leg, right: leg }, traits: { ...traits, footBaselineY: 0 } })
    const result = planner.step({ ...standing, feet: { left: foot, right: foot } }, 1 / 60)
    expect(result.drop).toBe(0)
    expect(Object.values(result.pelvisOffset).every(Number.isFinite)).toBe(true)
    expect(Object.values(result.feet.left.target.position).every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(result.lateralScale)).toBe(true)
  })
})

describe('turn step planner', () => {
  it('plans sequential alternating arcs that lift 0.3 units and land at the rotated anchors', () => {
    const anchors = {
      left: { position: { x: 1, y: 1, z: 0 }, yaw: 0 },
      right: { position: { x: -1, y: 1, z: 0 }, yaw: 0 },
    }
    const steps = planFootSteps([
      { foot: 'left', yawDelta: Math.PI / 4, duration: 0.4 },
      { foot: 'right', yawDelta: Math.PI / 4, duration: 0.4 },
      { foot: 'left', yawDelta: Math.PI / 4, duration: 0.4 },
    ], anchors, { x: 0, y: 0, z: 0 })
    expect(steps).toHaveLength(3)
    const [first, second, third] = steps
    if (!first || !second || !third)
      throw new Error('Missing planned steps')
    expect(first.sample(0)).toEqual(anchors.left)
    expect(first.sample(0.2).position.y).toBeCloseTo(1.3)
    expect(second.sample(0.2).position.y).toBeCloseTo(1.3)
    expect(distance(first.sample(0.4).position, { x: Math.SQRT1_2, y: 1, z: -Math.SQRT1_2 })).toBeLessThan(1e-12)
    expect(first.sample(0.4).yaw).toBeCloseTo(Math.PI / 4)
    expect(third.sample(0)).toEqual(first.sample(0.4))
    expect(third.sample(0.4).yaw).toBeCloseTo(Math.PI / 2)
    expect(first.sample(1)).toEqual(first.sample(0.4))
  })
})
