import type { TurnFrame, TurnStep } from './index'

import { describe, expect, it } from 'vitest'

import { aimEyes, createTurnPlanner } from './index'

const rad = Math.PI / 180

function simulate(targetYaw: number, seconds: number, hz = 120) {
  const planner = createTurnPlanner()
  const frames: Array<TurnFrame & { turnSteps: readonly TurnStep[] }> = []
  let facingYaw = 0
  for (let i = 0; i < seconds * hz; i++) {
    const frame = planner.step({ targetYaw, facingYaw }, 1 / hz)
    frames.push({ ...frame, turnSteps: [...frame.turnSteps] })
    facingYaw = frame.facingYaw
  }
  return frames
}

describe('body turns', () => {
  it('never starts for 50-65 degree oscillation at 1 Hz and stops before post-turn oscillation', () => {
    const planner = createTurnPlanner()
    let facingYaw = 0
    for (let i = 0; i < 1200; i++) {
      const frame = planner.step({ targetYaw: (57.5 + 7.5 * Math.sin(2 * Math.PI * i / 120)) * rad, facingYaw }, 1 / 120)
      expect(frame.turnStarted).toBe(false)
      expect(frame.turnSteps).toHaveLength(0)
      expect(frame.facingYaw).toBe(0)
    }

    // Exercise the stop half of the hysteresis before oscillating inside its band.
    for (let i = 0; i < 480; i++)
      facingYaw = planner.step({ targetYaw: 120 * rad, facingYaw }, 1 / 120).facingYaw
    for (let i = 0; i < 480; i++) {
      const frame = planner.step({ targetYaw: facingYaw + (17.5 + 7.5 * Math.sin(2 * Math.PI * i / 120)) * rad, facingYaw }, 1 / 120)
      expect(frame.turning).toBe(false)
      expect(frame.turnSteps).toHaveLength(0)
      expect(frame.facingYaw).toBe(facingYaw)
    }
  })

  it.each([1, -1])('turns exactly once for a sustained 120 degree target with sign %i', (sign) => {
    const frames = simulate(sign * 120 * rad, 6)
    expect(frames.filter(frame => frame.turnStarted)).toHaveLength(1)
    expect(frames[0]?.turnStarted).toBe(true)
    expect(frames.at(-1)?.turning).toBe(false)
    expect(frames.at(-1)?.facingYaw).toBeCloseTo(sign * 105 * rad, 8)
    // Re-pinned for the square-up: the other foot's step onto the facing comes 0.3 s after the turning steps.
    const all: TurnStep[] = frames.flatMap(frame => frame.turnSteps)
    const square = all.at(-1)
    const steps = all.slice(0, -1)
    expect(square?.yaw).toBe(0)
    const last = steps[steps.length - 1]
    expect(square?.startTime).toBeCloseTo(last.startTime + last.duration + 0.3, 8)
    expect(steps.length).toBeGreaterThan(1)
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (!step)
        continue
      expect(step.duration).toBeGreaterThanOrEqual(0.35)
      expect(step.duration).toBeLessThanOrEqual(0.45)
      const previous = steps[i - 1]
      if (previous) {
        expect(step.foot).not.toBe(previous.foot)
        expect(step.startTime).toBeCloseTo(previous.startTime + previous.duration, 8)
        expect(Math.abs(step.yaw) + Math.abs(previous.yaw)).toBeLessThanOrEqual(45 * rad + 1e-12)
      }
    }
    expect(steps.reduce((sum, step) => sum + step.yaw, 0)).toBeCloseTo(sign * 105 * rad, 8)
  })

  it('passes facing through without turn steps while turning is not allowed', () => {
    const planner = createTurnPlanner()
    for (let i = 0; i < 720; i++) {
      const frame = planner.step({ targetYaw: 120 * rad, facingYaw: 0.3, allowTurn: false }, 1 / 120)
      expect(frame.turnStarted).toBe(false)
      expect(frame.turning).toBe(false)
      expect(frame.turnSteps).toHaveLength(0)
      expect(frame.facingYaw).toBe(0.3)
    }
    expect(planner.step({ targetYaw: 120 * rad, facingYaw: 0.3 }, 1 / 120).turnStarted).toBe(true)
  })

  it('requires a continuous half second beyond sixty degrees', () => {
    const planner = createTurnPlanner()
    expect(planner.step({ targetYaw: 70 * rad, facingYaw: 0 }, 0.49).turnStarted).toBe(false)
    expect(planner.step({ targetYaw: 70 * rad, facingYaw: 0 }, 0.01).turnStarted).toBe(true)
  })

  it('starts and ends every turn step at rest', () => {
    const facing = simulate(120 * rad, 3).map(frame => frame.facingYaw)
    // 120 degrees starts at once; each 0.4 s step covers 48 ticks at 120 Hz.
    for (let start = 0; start < 4 * 48; start += 48) {
      expect(Math.abs(facing[start] - (start === 0 ? 0 : facing[start - 1]))).toBeLessThan(0.01 * rad)
      expect(Math.abs(facing[start + 47] - facing[start + 46])).toBeLessThan(0.01 * rad)
    }
  })

  it('agrees across frame rates during a body turn after two seconds', () => {
    const frame = simulate(120 * rad, 2, 60).at(-1)
    const reference = simulate(120 * rad, 2, 144).at(-1)
    expect(frame).toBeDefined()
    expect(reference).toBeDefined()
    if (!frame || !reference)
      return
    expect(Math.abs(frame.facingYaw - reference.facingYaw)).toBeLessThan(1e-3)
  })

  // Re-pinned for the square-up: the three turning steps are followed by the other foot's step onto the facing.
  it('turns back to a home target beyond twenty degrees in equal steps that end on it', () => {
    const planner = createTurnPlanner()
    let facingYaw = -55 * rad
    const steps: TurnStep[] = []
    let started = 0
    for (let i = 0; i < 4 * 120; i++) {
      const frame = planner.step({ targetYaw: 0, facingYaw, home: true }, 1 / 120)
      steps.push(...frame.turnSteps)
      started += Number(frame.turnStarted)
      facingYaw = frame.facingYaw
    }
    expect(started).toBe(1)
    // Re-pinned from 0.5 s: a home target now dwells 0.15 s, so the closing step overlaps the chest's turn home.
    expect(steps[0]?.startTime).toBeCloseTo(0.15, 8)
    expect(steps).toHaveLength(4)
    for (const step of steps.slice(0, 3))
      expect(step.yaw).toBeCloseTo(55 / 3 * rad, 12)
    expect(steps[3]?.yaw).toBe(0)
    expect(facingYaw).toBeCloseTo(0, 12)
  })

  it('ends a turn with both feet on the facing: the weight settles on the foot that stepped last, then the other squares up', () => {
    const planner = createTurnPlanner()
    let facingYaw = -55 * rad
    const frames: { t: number, stance: TurnFrame['stance'], turning: boolean, steps: TurnStep[] }[] = []
    for (let i = 0; i < 5 * 120; i++) {
      const frame = planner.step({ targetYaw: 0, facingYaw, home: true }, 1 / 120)
      frames.push({ t: (i + 1) / 120, stance: frame.stance, turning: frame.turning, steps: [...frame.turnSteps] })
      facingYaw = frame.facingYaw
    }
    const steps = frames.flatMap(frame => frame.steps)
    const [last, square] = steps.slice(-2)
    // The left foot stepped first and last, so the right one is left behind by one step and squares up.
    expect(last.foot).toBe('left')
    expect(square.foot).toBe('right')
    expect(square.startTime - (last.startTime + last.duration)).toBeCloseTo(0.3, 8)
    const during = frames.filter(frame => frame.t > last.startTime + last.duration + 0.01 && frame.t < square.startTime + square.duration - 0.01)
    expect(during.every(frame => frame.stance === 'left' && frame.turning)).toBe(true)
    expect(frames.filter(frame => frame.t < last.startTime + last.duration - 0.01).every(frame => frame.stance === null)).toBe(true)
    expect(frames.at(-1)?.stance).toBeNull()
    expect(frames.at(-1)?.turning).toBe(false)
  })

  it('squares the other foot up after a turn toward a far look too', () => {
    const steps = simulate(78 * rad, 5).flatMap(frame => frame.turnSteps)
    // Three steps take the facing to 63 degrees (15 left to the head and eyes); the right foot stood at 45.
    expect(steps.map(step => step.foot)).toEqual(['left', 'right', 'left', 'right'])
    expect(steps.map(step => step.yaw / rad)).toEqual([expect.closeTo(22.5, 9), expect.closeTo(22.5, 9), expect.closeTo(18, 9), 0])
  })

  it('leaves a home target within twenty degrees to the head and eyes', () => {
    const planner = createTurnPlanner()
    for (let i = 0; i < 1200; i++) {
      const frame = planner.step({ targetYaw: (10 + 9.9 * Math.sin(2 * Math.PI * i / 240)) * rad, facingYaw: 0, home: true }, 1 / 120)
      expect(frame.turnStarted).toBe(false)
      expect(frame.facingYaw).toBe(0)
    }
  })

  it('honors the 1.5 second refractory period even for an immediate reverse target', () => {
    const planner = createTurnPlanner()
    let facingYaw = 0
    let turning = false
    for (let i = 0; i < 600; i++) {
      const frame = planner.step({ targetYaw: 120 * rad, facingYaw }, 0.01)
      facingYaw = frame.facingYaw
      if (turning && !frame.turning)
        break
      turning = frame.turning
    }
    expect(turning).toBe(true)
    for (let i = 0; i < 149; i++) {
      const frame = planner.step({ targetYaw: facingYaw - 120 * rad, facingYaw }, 0.01)
      expect(frame.turnStarted).toBe(false)
      expect(frame.facingYaw).toBe(facingYaw)
    }
    expect(planner.step({ targetYaw: facingYaw - 120 * rad, facingYaw }, 0.02).turnStarted).toBe(true)
  })
})

describe('eye aim', () => {
  it('aims both rays within half a degree of reachable world targets', () => {
    const eyes = { leftEye: { x: -0.03, y: 1.6, z: 0 }, rightEye: { x: 0.03, y: 1.6, z: 0 } }
    for (const target of [{ x: 0.2, y: 1.7, z: 2 }, { x: -0.3, y: 1.4, z: 3 }]) {
      const aimed = aimEyes(eyes, target)
      for (const eye of ['leftEye', 'rightEye'] as const) {
        const { yaw, pitch } = aimed[eye]
        const ray = { x: Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) }
        const direction = { x: target.x - eyes[eye].x, y: target.y - eyes[eye].y, z: target.z - eyes[eye].z }
        const cosine = (ray.x * direction.x + ray.y * direction.y + ray.z * direction.z) / Math.hypot(direction.x, direction.y, direction.z)
        expect(Math.acos(Math.min(1, cosine))).toBeLessThan(0.5 * rad)
      }
    }
  })

  it('clamps to rig eye limits and handles coincident or non-finite targets', () => {
    const eyes = { leftEye: { x: 0, y: 0, z: 0 }, rightEye: { x: 0, y: 0, z: 0 } }
    const aimed = aimEyes(eyes, { x: 5, y: 5, z: 1 }, { eyeYawLimit: 0.1, eyePitchLimit: 0.12 })
    expect(aimed.leftEye.yaw).toBe(0.1)
    expect(aimed.rightEye.pitch).toBe(-0.12)
    for (const target of [{ x: 0, y: 0, z: 0 }, { x: Number.NaN, y: 0, z: Number.POSITIVE_INFINITY }]) {
      const result = aimEyes(eyes, target)
      expect(Object.values(result).every(rotation => Object.values(rotation).every(Number.isFinite))).toBe(true)
    }
  })
})
