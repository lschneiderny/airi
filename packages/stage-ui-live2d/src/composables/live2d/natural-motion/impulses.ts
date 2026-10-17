import type { GazePoint } from './gaze'
import type { Vec3 } from './posture'
import type { RandomStream } from './random'

import { Emotion } from '../../../constants/emotions'

/** Additive face offsets of emotion impulses, in the units of `NaturalFaceOutput`. */
export interface FaceHints {
  /** Both brows. */
  browY: number
  browAngle: number
  /** One-sided brow raise, added on top of `browY`. */
  browLY: number
  browRY: number
  eyeSmile: number
  mouthForm: number
  /** Additive eye openness; the adapter skips it on expression-closed eyes. */
  eyeOpen: number
}

/** A head displacement `peak * d * (t/tau)^2 e^{2(1 - t/tau)}` that starts at `start`. */
export interface HeadPulse {
  start: number
  tau: number
  /** Peak displacement per head axis (normalized units). */
  peak: Vec3
}

/** A gaze glance that an impulse requests; the facade hands it to the gaze layer. */
export interface Glance {
  point: GazePoint
  hold: number
}

interface EmotionSpec {
  /** Head direction `(X yaw, Y pitch, Z roll)`; `sided` axes take a random sign shared with the glance and brow side. */
  head: Vec3
  sided: (0 | 1 | 2)[]
  hints: Partial<Omit<FaceHints, 'browLY' | 'browRY'>>
  /** Raise of one brow, on the random side. */
  oneSidedBrow?: number
  /** Glance target; X takes the random side. */
  glance?: GazePoint
}

/**
 * Per-emotion directions and hints. Neutral has no entry: it does nothing.
 *
 * Happy nods with a 0.9 pitch so that, after the ±20% direction and magnitude perturbation,
 * the head still rises at least 0.073 normalized (2.2 ParamAngleY units on a ±30 rig; the old
 * 0.6 pitch fell to 1.4), and its 0.65 eye smile peaks at 0.81 x 0.65 = 0.53 against the hint
 * rise and decay (0.26 on a [0, 1] smile).
 * Its length 0.95 keeps the peak within `headGain * 1.2`.
 */
const emotions: Partial<Record<Emotion, EmotionSpec>> = {
  [Emotion.Happy]: { head: [0, 0.9, 0.3], sided: [2], hints: { browY: 0.3, eyeSmile: 0.65, mouthForm: 0.5 } },
  [Emotion.Sad]: { head: [0, -0.8, 0.2], sided: [2], hints: { browAngle: 0.3, mouthForm: -0.4, eyeOpen: -0.15 } },
  [Emotion.Angry]: { head: [0, -0.4, 0], sided: [], hints: { browY: -0.4, browAngle: -0.4, mouthForm: -0.3 } },
  [Emotion.Surprise]: { head: [0, 0.8, 0], sided: [], hints: { browY: 0.6, eyeOpen: 0.15 } },
  [Emotion.Think]: { head: [0, 0, 0.4], sided: [2], hints: {}, oneSidedBrow: 0.2, glance: { x: 0.3, y: 0.25 } },
  [Emotion.Awkward]: { head: [0, 0, 0.5], sided: [2], hints: { browY: 0.15, mouthForm: -0.1 }, glance: { x: 0.3, y: -0.2 } },
  [Emotion.Question]: { head: [0, 0, 0.8], sided: [2], hints: {}, oneSidedBrow: 0.25 },
  [Emotion.Curious]: { head: [0, 0, 0.8], sided: [2], hints: {}, oneSidedBrow: 0.25 },
}

/** Peak head displacement at intensity 1 (normalized units). */
const headGain = 0.12
/** Direction and magnitude perturbation, so repeated impulses never look identical. */
const perturbation = 0.2
const tauRange = { min: 0.25, max: 0.5 }
/** Face hints decay with this time constant (seconds). */
const hintDecay = 1.5
// Face hints rise over ~80 ms instead of stepping, so a smile never pops in one frame.
// The rise keeps the hint below its nominal value; `hintDecay` alone sets how long it lasts.
const hintRise = 0.08
const glanceHold = { min: 1.2, max: 2.5 }
/** The same emotion within this window is ignored, so a repeated tag does not stack. */
const dedupeSeconds = 2
// Pulses and hints are dropped once negligible: 12 tau leaves 4e-8 of the peak, 15 s leaves 5e-5 of a hint.
const pulseLifetime = 12
const hintLifetime = 15

/** Head envelope `(t/tau)^2 e^{2(1 - t/tau)}`: 0 with zero slope at the start, 1 at `t = tau`. */
export function impulseEnvelope(time: number, tau: number) {
  if (time <= 0)
    return 0
  const u = time / tau
  return u * u * Math.exp(2 * (1 - u))
}

/** Sums active pulses at `time` and drops expired ones from `pulses` in place. */
export function headPulseOffset(pulses: HeadPulse[], time: number): Vec3 {
  const offset: Vec3 = [0, 0, 0]
  for (let i = pulses.length - 1; i >= 0; i--) {
    const pulse = pulses[i]
    if (time - pulse.start > pulseLifetime * pulse.tau) {
      pulses.splice(i, 1)
      continue
    }
    const value = impulseEnvelope(time - pulse.start, pulse.tau)
    for (const axis of [0, 1, 2])
      offset[axis] += pulse.peak[axis] * value
  }
  return offset
}

/** Perturbs `direction` by up to 20% per component while keeping its length. */
function perturbDirection(random: RandomStream, direction: Vec3): Vec3 {
  const length = Math.hypot(...direction)
  const noisy = direction.map(value => value + perturbation * length * (2 * random() - 1)) as Vec3
  const noisyLength = Math.hypot(...noisy)
  return noisy.map(value => value * length / noisyLength) as Vec3
}

function emptyHints(): FaceHints {
  return { browY: 0, browAngle: 0, browLY: 0, browRY: 0, eyeSmile: 0, mouthForm: 0, eyeOpen: 0 }
}

interface HintPulse {
  start: number
  hints: FaceHints
}

/**
 * Emotion impulses: short head gestures and decaying face hints that add on top of every
 * other layer. They never touch posture, gaze, or face state, so an impulse cannot reset
 * the pose; it only adds an offset that returns to zero.
 *
 * The head follows `0.12 I^0.7 d (t/tau)^2 e^{2(1-t/tau)}` with `tau` uniform in 0.25-0.5 s
 * and the direction and magnitude perturbed by ±20%. Face hints scale with `I` and decay
 * with `tau` 1.5 s. The same emotion within 2 s is ignored. Neutral does nothing.
 *
 * Time is seconds of active motion; the facade triggers on its fixed grid.
 */
export class NaturalImpulses {
  private readonly pulses: HeadPulse[] = []
  private readonly hintPulses: HintPulse[] = []
  private readonly lastStart = new Map<Emotion, number>()

  constructor(private readonly random: RandomStream) {}

  /**
   * Starts emotion `name` at `at` with intensity in [0, 1].
   * Returns `null` when nothing starts (neutral, zero intensity, or a duplicate within 2 s);
   * otherwise returns the glance the gaze layer should perform, if any.
   */
  trigger(name: Emotion, intensity: number, at: number): { glance: Glance | null } | null {
    const spec = emotions[name]
    const strength = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0))
    if (!spec || strength === 0)
      return null
    const last = this.lastStart.get(name)
    if (last !== undefined && at - last < dedupeSeconds)
      return null
    this.lastStart.set(name, at)

    const side = this.random() < 0.5 ? -1 : 1
    const head = spec.head.map((value, axis) => spec.sided.includes(axis as 0 | 1 | 2) ? side * value : value) as Vec3
    this.push(head, strength, at)

    const hints = emptyHints()
    for (const [key, value] of Object.entries(spec.hints) as [keyof FaceHints, number][])
      hints[key] = strength * value
    if (spec.oneSidedBrow !== undefined)
      hints[side < 0 ? 'browLY' : 'browRY'] = strength * spec.oneSidedBrow
    this.hintPulses.push({ start: at, hints })

    if (!spec.glance)
      return { glance: null }
    const hold = glanceHold.min + (glanceHold.max - glanceHold.min) * this.random()
    return { glance: { point: { x: side * spec.glance.x, y: spec.glance.y }, hold } }
  }

  /** Starts a head-only gesture along `direction` (length at most 1), used by desktop reactions. */
  nudge(direction: Vec3, intensity: number, at: number) {
    this.push(direction, intensity, at)
  }

  /** Head offset at `time`; expired pulses are dropped. */
  headOffset(time: number): Vec3 {
    return headPulseOffset(this.pulses, time)
  }

  /** Face hint offsets at `time`; expired hints are dropped. */
  hints(time: number): FaceHints {
    const total = emptyHints()
    for (let i = this.hintPulses.length - 1; i >= 0; i--) {
      const { start, hints } = this.hintPulses[i]
      const age = time - start
      if (age > hintLifetime) {
        this.hintPulses.splice(i, 1)
        continue
      }
      if (age <= 0)
        continue
      const weight = (1 - Math.exp(-age / hintRise)) * Math.exp(-age / hintDecay)
      for (const key of Object.keys(total) as (keyof FaceHints)[])
        total[key] += weight * hints[key]
    }
    return total
  }

  private push(direction: Vec3, intensity: number, at: number) {
    const tau = tauRange.min + (tauRange.max - tauRange.min) * this.random()
    const magnitude = headGain * intensity ** 0.7 * (1 + perturbation * (2 * this.random() - 1))
    const perturbed = perturbDirection(this.random, direction)
    this.pulses.push({ start: at, tau, peak: perturbed.map(value => magnitude * value) as Vec3 })
  }
}
