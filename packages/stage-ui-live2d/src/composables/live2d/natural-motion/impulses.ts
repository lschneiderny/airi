import type { ExpressionPerformanceSettings, ReactionEpisode } from '@proj-airi/stage-shared/expression-performance'

import type { GazePoint } from './gaze'
import type { Vec3 } from './posture'
import type { RandomStream } from './random'

import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'

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
  overshoot?: number
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
 * Directions retain the existing emotion vocabulary. Their lengths bound the head
 * displacement; body lean uses the corresponding unit direction.
 */
const emotions: Partial<Record<ReactionEpisode['emotion'], EmotionSpec>> = {
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
// Retire after the overshoot tail has become negligible.
const pulseLifetime = 15

/** Head envelope `(t/tau)^2 e^{2(1 - t/tau)}`: 0 with zero slope at the start, 1 at `t = tau`. */
export function impulseEnvelope(time: number, tau: number) {
  if (time <= 0)
    return 0
  if (tau === 0)
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
    const age = time - pulse.start
    const value = impulseEnvelope(age, pulse.tau) - (pulse.overshoot ?? 0) * impulseEnvelope(age - 3 * pulse.tau, pulse.tau)
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
  settings: ExpressionPerformanceSettings['naturalBands']['clear']
  from: FaceHints
  transition: number | null
  head: number
  body: number
  direction: Vec3
  side: number
}

/**
 * Emotion impulses: short head gestures and decaying face hints that add on top of every
 * other layer. They never touch posture, gaze, or face state, so an impulse cannot reset
 * the pose; it only adds an offset that returns to zero.
 *
 * Episodes own recruitment and timing. Escalations keep the sampled direction and add
 * only missing amplitude, while face targets interpolate from their current contribution.
 * Settings changes affect new reactions only, never pulses already in flight.
 *
 * Time is seconds of active motion; the facade triggers on its fixed grid.
 */
export class NaturalImpulses {
  private readonly pulses: HeadPulse[] = []
  private readonly nudges: HeadPulse[] = []
  private readonly bodies: HeadPulse[] = []
  private readonly episodes = new Map<string, HintPulse>()
  private settings = defaultExpressionPerformanceSettings.naturalBands
  private bands = true

  constructor(private readonly random: RandomStream) {}

  setPerformanceSettings(settings: ExpressionPerformanceSettings['naturalBands'], bands = true) {
    this.settings = structuredClone(settings)
    this.bands = bands
  }

  /** Unknown or expired escalation ids are ignored; they cannot resurrect a stale reaction. */
  trigger(episode: ReactionEpisode, at: number): { glance: Glance | null, energy: boolean } | null {
    const spec = emotions[episode.emotion]
    const strength = Math.max(0, Math.min(1, Number.isFinite(episode.intensity) ? episode.intensity : 0))
    if (!spec || strength === 0)
      return null
    this.hints(at)
    const previous = this.episodes.get(episode.id)
    if (episode.escalation && !previous)
      return null
    if (previous && !episode.escalation)
      return null
    const band = this.bands ? episode.band : 'clear'
    const settings = { ...this.settings[band] }
    const side = previous?.side ?? (this.random() < 0.5 ? -1 : 1)
    const head = spec.head.map((value, axis) => spec.sided.includes(axis as 0 | 1 | 2) ? side * value : value) as Vec3
    const direction = previous?.direction ?? perturbDirection(this.random, head)
    const headAmplitude = band !== 'slight' && settings.headTau !== null ? this.settings.headGain * strength ** 0.7 : 0
    const bodyAmplitude = band === 'strong' ? this.settings.bodyGain * strength : 0
    const tau = settings.headTau ?? 0
    if (headAmplitude > (previous?.head ?? 0))
      this.pulses.push({ start: at, tau, overshoot: settings.overshoot, peak: direction.map(value => value * (headAmplitude - (previous?.head ?? 0))) as Vec3 })
    const length = Math.hypot(...head)
    if (bodyAmplitude > (previous?.body ?? 0))
      this.bodies.push({ start: at, tau: 1.5 * tau, peak: head.map(value => value / length * (bodyAmplitude - (previous?.body ?? 0))) as Vec3 })

    const hints = emptyHints()
    for (const [key, value] of Object.entries(spec.hints) as [keyof FaceHints, number][])
      hints[key] = strength * value
    if (spec.oneSidedBrow !== undefined)
      hints[side < 0 ? 'browLY' : 'browRY'] = strength * spec.oneSidedBrow
    const from = previous ? this.hintValue(previous, at) : emptyHints()
    this.episodes.set(episode.id, {
      start: at,
      hints,
      settings,
      from,
      transition: previous ? at : null,
      head: Math.max(headAmplitude, previous?.head ?? 0),
      body: Math.max(bodyAmplitude, previous?.body ?? 0),
      direction,
      side,
    })
    const point = spec.glance ?? { x: 0, y: 0 }
    return { glance: band === 'slight' ? null : { point: { x: side * point.x, y: point.y }, hold: settings.faceHold }, energy: band === 'strong' }
  }

  /** Starts a head-only gesture along `direction` (length at most 1), used by desktop reactions. */
  nudge(direction: Vec3, intensity: number, at: number) {
    this.push(direction, intensity, at)
  }

  /** Head offset at `time`; the body follower excludes emotion pulses but retains desktop nudges. */
  headOffset(time: number, includeEmotions = true): Vec3 {
    const nudge = headPulseOffset(this.nudges, time)
    const emotion = includeEmotions ? headPulseOffset(this.pulses, time) : [0, 0, 0]
    return nudge.map((value, axis) => value + emotion[axis]) as Vec3
  }

  bodyOffset(time: number): Vec3 {
    return headPulseOffset(this.bodies, time)
  }

  private hintValue(pulse: HintPulse, time: number): FaceHints {
    const age = time - pulse.start
    const settings = pulse.settings
    const onset = settings.faceOnsetTau === 0 ? 1 : 1 - Math.exp(-Math.max(0, age) / settings.faceOnsetTau)
    const releaseAge = Math.max(0, age - settings.faceHold)
    const release = settings.faceReleaseTau === 0 ? Number(releaseAge === 0) : Math.exp(-releaseAge / settings.faceReleaseTau)
    const blend = pulse.transition === null ? 1 : Math.min(1, Math.max(0, (time - pulse.transition) / 0.08))
    const targetWeight = pulse.transition === null ? onset * release : release
    const result = emptyHints()
    for (const key of Object.keys(result) as (keyof FaceHints)[])
      result[key] = pulse.from[key] * (1 - blend) + pulse.hints[key] * targetWeight * blend
    return result
  }

  /** Face hint offsets at `time`; expired hints are dropped. */
  hints(time: number): FaceHints {
    const total = emptyHints()
    for (const [id, pulse] of this.episodes) {
      const age = time - pulse.start
      const lifetime = Math.max(15 * 1.5 * (pulse.settings.headTau ?? 0), pulse.settings.faceHold + 15 * pulse.settings.faceReleaseTau)
      if (age > lifetime) {
        this.episodes.delete(id)
        continue
      }
      if (age < 0)
        continue
      const hints = this.hintValue(pulse, time)
      for (const key of Object.keys(total) as (keyof FaceHints)[])
        total[key] += hints[key]
    }
    return total
  }

  private push(direction: Vec3, intensity: number, at: number) {
    const tau = tauRange.min + (tauRange.max - tauRange.min) * this.random()
    const magnitude = headGain * intensity ** 0.7 * (1 + perturbation * (2 * this.random() - 1))
    const perturbed = perturbDirection(this.random, direction)
    this.nudges.push({ start: at, tau, peak: perturbed.map(value => magnitude * value) as Vec3 })
  }
}
