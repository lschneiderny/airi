import type { RestRelativeRotation, RigTraits, Vec3 } from '../types'

export interface LookAtInput {
  /** Target angles in the stance frame. Positive pitch looks down, forward is +Z. */
  readonly targetYaw: number
  readonly targetPitch: number
  /** Actual facing in the same stance frame; feed back the previous command when unobstructed. */
  readonly facingYaw: number
}

export type LookAtOptions = Partial<Pick<RigTraits, 'eyeYawLimit' | 'eyePitchLimit'>>

export interface TurnStep {
  readonly foot: 'left' | 'right'
  /** Seconds since controller creation. Emitted once, at the start of the step. */
  readonly startTime: number
  readonly duration: number
  /** Signed facing change, in radians, for this step (not an absolute foot yaw). */
  readonly yaw: number
}

export interface LookAtFrame {
  readonly rotations: Readonly<Record<'spine' | 'chest' | 'neck' | 'head', RestRelativeRotation>>
  /** Residual eye aim after the distributed body rotations, in the head frame. */
  readonly eyes: RestRelativeRotation
  readonly facingYaw: number
  readonly turning: boolean
  readonly turnStarted: boolean
  readonly turnSteps: readonly TurnStep[]
}

const radians = Math.PI / 180
const distribution = {
  spine: { yawShare: 0.1, yawLimit: 10, pitchShare: 0.05, up: 5, down: 5, omega: 3 },
  chest: { yawShare: 0.15, yawLimit: 10, pitchShare: 0.1, up: 8, down: 8, omega: 3 },
  neck: { yawShare: 0.3, yawLimit: 25, pitchShare: 0.35, up: 20, down: 25, omega: 5 },
  head: { yawShare: 0.45, yawLimit: 35, pitchShare: 0.5, up: 25, down: 30, omega: 7 },
} as const
const boneNames = ['spine', 'chest', 'neck', 'head'] as const
const turnStart = 60 * radians
const turnImmediate = 90 * radians
const turnStop = 20 * radians
const turnRemainder = 15 * radians
const stepDuration = 0.4
const stepYawLimit = 22.5 * radians
const dwellDuration = 0.5
const refractoryDuration = 1.5

function finite(value: number) {
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function wrap(value: number) {
  return Math.atan2(Math.sin(value), Math.cos(value))
}

// Mutable position/velocity belong to one controller, never to a rig or renderer.
interface Spring {
  value: number
  velocity: number
}

function advanceSpring(spring: Spring, start: number, end: number, omega: number, dt: number, min: number, max: number) {
  if (dt <= 0)
    return
  const slope = (end - start) / dt
  const boundaries = [0, dt]
  if (slope !== 0) {
    for (const limit of [min, max]) {
      const crossing = (limit - start) / slope
      if (crossing > 0 && crossing < dt)
        boundaries.push(crossing)
    }
  }
  boundaries.sort((a, b) => a - b)
  for (let i = 1; i < boundaries.length; i++) {
    const from = boundaries[i - 1]
    const to = boundaries[i]
    if (from === undefined || to === undefined)
      continue
    const elapsed = to - from
    const target = clamp(start + slope * from, min, max)
    const targetEnd = clamp(start + slope * to, min, max)
    const velocity = (targetEnd - target) / elapsed
    // Exact critically damped response to linear forcing. A turn's changing facing
    // must not become a different stair-step target at each display refresh rate.
    const offset = spring.value - target + 2 * velocity / omega
    const impulse = spring.velocity - velocity + omega * offset
    const decay = Math.exp(-omega * elapsed)
    const value = targetEnd - 2 * velocity / omega + (offset + impulse * elapsed) * decay
    spring.velocity = velocity + (spring.velocity - velocity - omega * impulse * elapsed) * decay
    spring.value = clamp(value, min, max)
    if (spring.value !== value)
      spring.velocity = 0
  }
}

function jointSprings() {
  return { yaw: { value: 0, velocity: 0 }, pitch: { value: 0, velocity: 0 } }
}

/** Owns only deterministic motion state. All time comes from step's elapsed seconds. */
class LookAtController {
  private readonly springs = {
    spine: jointSprings(),
    chest: jointSprings(),
    neck: jointSprings(),
    head: jointSprings(),
  }

  private time = 0
  private dwell = 0
  private dwellDirection = 0
  private refractoryUntil = 0
  private turning = false
  private nextFoot: TurnStep['foot'] = 'left'
  private activeStep: { start: number, yaw: number, elapsed: number } | null = null
  private readonly eyeYawLimit: number
  private readonly eyePitchLimit: number

  constructor(options: LookAtOptions) {
    this.eyeYawLimit = Math.abs(finite(options.eyeYawLimit ?? 0.35))
    this.eyePitchLimit = Math.abs(finite(options.eyePitchLimit ?? 0.25))
  }

  step(input: LookAtInput, dt: number): LookAtFrame {
    dt = Math.max(0, finite(dt))
    const targetYaw = wrap(finite(input.targetYaw))
    const targetPitch = clamp(finite(input.targetPitch), -Math.PI / 2, Math.PI / 2)
    let facingYaw = finite(input.facingYaw)
    let remaining = dt
    let turnStarted = false
    const turnSteps: TurnStep[] = []
    const advance = (elapsed: number, nextFacing = facingYaw) => {
      const yaw = wrap(targetYaw - facingYaw)
      // Unwrap the end relative to the start, so crossing +/-pi does not spin joints.
      const nextYaw = yaw - (nextFacing - facingYaw)
      for (const bone of boneNames) {
        const tuning = distribution[bone]
        const yawLimit = tuning.yawLimit * radians
        const up = -tuning.up * radians
        const down = tuning.down * radians
        advanceSpring(this.springs[bone].yaw, yaw * tuning.yawShare, nextYaw * tuning.yawShare, tuning.omega, elapsed, -yawLimit, yawLimit)
        advanceSpring(this.springs[bone].pitch, targetPitch * tuning.pitchShare, targetPitch * tuning.pitchShare, tuning.omega, elapsed, up, down)
      }
      facingYaw = nextFacing
      this.time += elapsed
    }

    // Split at dwell, step, and refractory boundaries rather than quantizing them to frames.
    while (remaining > 1e-12) {
      const error = wrap(targetYaw - facingYaw)
      const magnitude = Math.abs(error)
      if (!this.turning) {
        if (this.time < this.refractoryUntil) {
          const elapsed = Math.min(remaining, this.refractoryUntil - this.time)
          advance(elapsed)
          remaining -= elapsed
          continue
        }
        if (magnitude <= turnStart) {
          this.dwell = 0
          this.dwellDirection = 0
          advance(remaining)
          remaining = 0
          continue
        }
        if (this.dwellDirection !== Math.sign(error))
          this.dwell = 0
        this.dwellDirection = Math.sign(error)
        if (magnitude <= turnImmediate && this.dwell < dwellDuration - 1e-12) {
          const elapsed = Math.min(remaining, dwellDuration - this.dwell)
          this.dwell += elapsed
          advance(elapsed)
          remaining -= elapsed
          if (this.dwell < dwellDuration - 1e-12)
            continue
        }
        this.turning = true
        turnStarted = true
        this.dwell = 0
      }

      // Finish planted steps before stopping; the lower threshold prevents chatter.
      if (!this.activeStep && magnitude < turnStop) {
        this.turning = false
        this.refractoryUntil = this.time + refractoryDuration
        continue
      }
      if (!this.activeStep) {
        const yaw = Math.sign(error) * Math.min(stepYawLimit, Math.max(0, magnitude - turnRemainder))
        this.activeStep = { start: facingYaw, yaw, elapsed: 0 }
        turnSteps.push({ foot: this.nextFoot, startTime: this.time, duration: stepDuration, yaw })
        this.nextFoot = this.nextFoot === 'left' ? 'right' : 'left'
      }
      const elapsed = Math.min(remaining, stepDuration - this.activeStep.elapsed)
      this.activeStep.elapsed += elapsed
      advance(elapsed, this.activeStep.start + this.activeStep.yaw * this.activeStep.elapsed / stepDuration)
      remaining -= elapsed
      if (this.activeStep.elapsed >= stepDuration - 1e-12) {
        this.activeStep = null
        if (Math.abs(wrap(targetYaw - facingYaw)) < turnStop) {
          this.turning = false
          this.refractoryUntil = this.time + refractoryDuration
        }
      }
    }

    const yaw = wrap(targetYaw - facingYaw)
    const rotations = {
      spine: { yaw: 0, pitch: 0, roll: 0 },
      chest: { yaw: 0, pitch: 0, roll: 0 },
      neck: { yaw: 0, pitch: 0, roll: 0 },
      head: { yaw: 0, pitch: 0, roll: 0 },
    }
    let bodyYaw = 0
    let bodyPitch = 0
    for (const bone of boneNames) {
      rotations[bone].yaw = this.springs[bone].yaw.value
      rotations[bone].pitch = this.springs[bone].pitch.value
      bodyYaw += rotations[bone].yaw
      bodyPitch += rotations[bone].pitch
    }
    return {
      rotations,
      eyes: {
        yaw: clamp(yaw - bodyYaw, -this.eyeYawLimit, this.eyeYawLimit),
        pitch: clamp(targetPitch - bodyPitch, -this.eyePitchLimit, this.eyePitchLimit),
        roll: 0,
      },
      facingYaw,
      turning: this.turning,
      turnStarted,
      turnSteps,
    }
  }
}

export function createLookAt(options: LookAtOptions = {}) {
  return new LookAtController(options)
}

/**
 * Absolute per-eye aim in world-aligned axes (+Z forward, +Y up).
 * Adapters transform the world target into each animated eye parent frame before
 * applying a rest-relative rotation. Coincident or non-finite targets aim forward.
 */
export function aimEyes(
  eyes: Readonly<Record<'leftEye' | 'rightEye', Vec3>>,
  target: Vec3,
  limits: LookAtOptions = {},
): Record<'leftEye' | 'rightEye', RestRelativeRotation> {
  const yawLimit = Math.abs(finite(limits.eyeYawLimit ?? 0.35))
  const pitchLimit = Math.abs(finite(limits.eyePitchLimit ?? 0.25))
  function aim(eye: Vec3): RestRelativeRotation {
    const x = target.x - eye.x
    const y = target.y - eye.y
    const z = target.z - eye.z
    if (![x, y, z].every(Number.isFinite))
      return { yaw: 0, pitch: 0, roll: 0 }
    return {
      yaw: clamp(Math.atan2(x, z), -yawLimit, yawLimit),
      pitch: clamp(Math.atan2(-y, Math.hypot(x, z)), -pitchLimit, pitchLimit),
      roll: 0,
    }
  }
  return { leftEye: aim(eyes.leftEye), rightEye: aim(eyes.rightEye) }
}
