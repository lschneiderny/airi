import type { LookAtFrame, TurnStep } from './index'

import { describe, expect, it } from 'vitest'

import { aimEyes, createLookAt } from './index'

const rad = Math.PI / 180
const bones = ['spine', 'chest', 'neck', 'head'] as const
const limits = {
  spine: [10, 5, 5],
  chest: [10, 8, 8],
  neck: [25, 20, 25],
  head: [35, 25, 30],
} as const

function expectJointLimits(frame: LookAtFrame) {
  for (const bone of bones) {
    const rotation = frame.rotations[bone]
    expect(Math.abs(rotation.yaw)).toBeLessThanOrEqual(limits[bone][0] * rad + 1e-12)
    expect(rotation.pitch).toBeGreaterThanOrEqual(-limits[bone][1] * rad - 1e-12)
    expect(rotation.pitch).toBeLessThanOrEqual(limits[bone][2] * rad + 1e-12)
    expect(rotation.roll).toBe(0)
  }
}

function simulate(targetYaw: number, seconds: number, hz = 120) {
  const lookAt = createLookAt()
  const frames: LookAtFrame[] = []
  let facingYaw = 0
  for (let i = 0; i < seconds * hz; i++) {
    const frame = lookAt.step({ targetYaw, targetPitch: 0.3, facingYaw }, 1 / hz)
    frames.push(frame)
    facingYaw = frame.facingYaw
  }
  return frames
}

describe('look-at distribution', () => {
  it('never exceeds joint or eye limits for seeded random targets', () => {
    const lookAt = createLookAt()
    let seed = 42
    function random() {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
      return seed / 4294967296
    }
    let facingYaw = 0

    for (let i = 0; i < 3000; i++) {
      const frame = lookAt.step({
        targetYaw: (random() * 2 - 1) * Math.PI,
        targetPitch: (random() * 2 - 1) * Math.PI / 2,
        facingYaw,
      }, 1 / 60)
      facingYaw = frame.facingYaw
      expectJointLimits(frame)
      expect(Math.abs(frame.eyes.yaw)).toBeLessThanOrEqual(0.35)
      expect(Math.abs(frame.eyes.pitch)).toBeLessThanOrEqual(0.25)
    }
  })

  it.each([
    { name: 'positive yaw', targetYaw: 179 * rad, targetPitch: 0, yawSign: 1, pitchSign: 0 },
    { name: 'negative yaw', targetYaw: -179 * rad, targetPitch: 0, yawSign: -1, pitchSign: 0 },
    { name: 'positive pitch', targetYaw: 0, targetPitch: Math.PI, yawSign: 0, pitchSign: 1 },
    { name: 'negative pitch', targetYaw: 0, targetPitch: -Math.PI, yawSign: 0, pitchSign: -1 },
  ])('bounds every frame and settles under held saturation: $name', ({ targetYaw, targetPitch, yawSign, pitchSign }) => {
    const lookAt = createLookAt()
    let settled: LookAtFrame | undefined

    // Hold actual stance facing fixed: a facing command must not remove the
    // sustained yaw error before the joints can reach saturation.
    for (let i = 0; i < 12 * 60; i++) {
      settled = lookAt.step({ targetYaw, targetPitch, facingYaw: 0 }, 1 / 60)
      expectJointLimits(settled)
    }

    expect(settled).toBeDefined()
    if (!settled)
      return
    for (const bone of bones) {
      expect(settled.rotations[bone].yaw).toBeCloseTo(yawSign * limits[bone][0] * rad, 6)
      // Input pitch is bounded to +/-90 degrees. Spine's 5% share reaches
      // only 4.5 degrees; the other three joints must saturate at their limits.
      const pitchLimit = bone === 'spine' ? 4.5 : limits[bone][pitchSign < 0 ? 1 : 2]
      expect(settled.rotations[bone].pitch).toBeCloseTo(pitchSign * pitchLimit * rad, 6)
    }
  })

  it('converges to the specified per-bone shares with distinct spring rates', () => {
    const frames = simulate(30 * rad, 6)
    const early = frames[11]
    const settled = frames.at(-1)
    expect(early).toBeDefined()
    expect(settled).toBeDefined()
    if (!early || !settled)
      return
    for (const [bone, yawShare, pitchShare, omega] of [
      ['spine', 0.1, 0.05, 3],
      ['chest', 0.15, 0.1, 3],
      ['neck', 0.3, 0.35, 5],
      ['head', 0.45, 0.5, 7],
    ] as const) {
      expect(early.rotations[bone].yaw).toBeCloseTo(30 * rad * yawShare * (1 - (1 + omega * 0.1) * Math.exp(-omega * 0.1)), 10)
      expect(settled.rotations[bone].yaw).toBeCloseTo(30 * rad * yawShare, 6)
      expect(settled.rotations[bone].pitch).toBeCloseTo(0.3 * pitchShare, 6)
    }
  })

  it.each([60, 120])('agrees with 144 Hz within 1e-3 radians after two seconds at %i Hz', (hz) => {
    const frame = simulate(45 * rad, 2, hz).at(-1)
    const reference = simulate(45 * rad, 2, 144).at(-1)
    expect(frame).toBeDefined()
    expect(reference).toBeDefined()
    if (!frame || !reference)
      return
    for (const bone of bones) {
      expect(Math.abs(frame.rotations[bone].yaw - reference.rotations[bone].yaw)).toBeLessThan(1e-3)
      expect(Math.abs(frame.rotations[bone].pitch - reference.rotations[bone].pitch)).toBeLessThan(1e-3)
    }
  })

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])('keeps malformed target %s finite and recovers', (invalid) => {
    const lookAt = createLookAt()
    const frame = lookAt.step({ targetYaw: invalid, targetPitch: invalid, facingYaw: 0 }, 1 / 60)
    for (const rotation of [...Object.values(frame.rotations), frame.eyes])
      expect(Object.values(rotation).every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(frame.facingYaw)).toBe(true)
    expect(frame.turnStarted).toBe(false)
    const recovered = lookAt.step({ targetYaw: 0.2, targetPitch: 0.1, facingYaw: 0 }, 1)
    expect(recovered.rotations.head.yaw).toBeGreaterThan(0)
  })
})

describe('body turns', () => {
  it('never starts for 50-65 degree oscillation at 1 Hz and stops before post-turn oscillation', () => {
    const lookAt = createLookAt()
    let facingYaw = 0
    for (let i = 0; i < 1200; i++) {
      const frame = lookAt.step({
        targetYaw: (57.5 + 7.5 * Math.sin(2 * Math.PI * i / 120)) * rad,
        targetPitch: 0,
        facingYaw,
      }, 1 / 120)
      expect(frame.turnStarted).toBe(false)
      expect(frame.turnSteps).toHaveLength(0)
      expect(frame.facingYaw).toBe(0)
    }

    // Exercise the stop half of the hysteresis before oscillating inside its band.
    for (let i = 0; i < 480; i++) {
      const frame = lookAt.step({ targetYaw: 120 * rad, targetPitch: 0, facingYaw }, 1 / 120)
      facingYaw = frame.facingYaw
    }
    for (let i = 0; i < 480; i++) {
      const frame = lookAt.step({
        targetYaw: facingYaw + (17.5 + 7.5 * Math.sin(2 * Math.PI * i / 120)) * rad,
        targetPitch: 0,
        facingYaw,
      }, 1 / 120)
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
    const steps: TurnStep[] = frames.flatMap(frame => frame.turnSteps)
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

  it('requires a continuous half second beyond sixty degrees', () => {
    const lookAt = createLookAt()
    const before = lookAt.step({ targetYaw: 70 * rad, targetPitch: 0, facingYaw: 0 }, 0.49)
    expect(before.turnStarted).toBe(false)
    const atThreshold = lookAt.step({ targetYaw: 70 * rad, targetPitch: 0, facingYaw: 0 }, 0.01)
    expect(atThreshold.turnStarted).toBe(true)
  })

  it('agrees across frame rates during a body turn after two seconds', () => {
    const frame = simulate(120 * rad, 2, 60).at(-1)
    const reference = simulate(120 * rad, 2, 144).at(-1)
    expect(frame).toBeDefined()
    expect(reference).toBeDefined()
    if (!frame || !reference)
      return
    expect(Math.abs(frame.facingYaw - reference.facingYaw)).toBeLessThan(1e-3)
    for (const bone of bones) {
      expect(Math.abs(frame.rotations[bone].yaw - reference.rotations[bone].yaw)).toBeLessThan(1e-3)
      expect(Math.abs(frame.rotations[bone].pitch - reference.rotations[bone].pitch)).toBeLessThan(1e-3)
    }
  })

  it('honors the 1.5 second refractory period even for an immediate reverse target', () => {
    const lookAt = createLookAt()
    let facingYaw = 0
    let turning = false
    for (let i = 0; i < 600; i++) {
      const frame = lookAt.step({ targetYaw: 120 * rad, targetPitch: 0, facingYaw }, 0.01)
      facingYaw = frame.facingYaw
      if (turning && !frame.turning)
        break
      turning = frame.turning
    }
    expect(turning).toBe(true)
    for (let i = 0; i < 149; i++) {
      const frame = lookAt.step({ targetYaw: facingYaw - 120 * rad, targetPitch: 0, facingYaw }, 0.01)
      expect(frame.turnStarted).toBe(false)
      expect(frame.facingYaw).toBe(facingYaw)
    }
    const after = lookAt.step({ targetYaw: facingYaw - 120 * rad, targetPitch: 0, facingYaw }, 0.02)
    expect(after.turnStarted).toBe(true)
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
