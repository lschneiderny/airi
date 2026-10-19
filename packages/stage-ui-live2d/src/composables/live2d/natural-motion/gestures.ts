import type { Band } from '@proj-airi/stage-shared/expression-performance'

import type { GestureKind } from './emotions'
import type { Vec3 } from './posture'
import type { RandomStream } from './random'

import { impulseEnvelope } from './impulses'
import { minJerk } from './processes'

interface ClipShape {
  /** Seconds after `start` at which the clip contributes exactly 0 and is retired. */
  readonly lifetime: number
  /** Head offset at `age` seconds since `start`, in normalized head units. */
  readonly shape: (age: number) => Vec3
}

interface Clip extends ClipShape {
  readonly start: number
}

/** Head amplitude per band; the slight band never triggers a gesture. */
const bandAmplitude: Record<Band, number> = { slight: 0, clear: 0.6, strong: 1 }
/** Body follows the head on yaw and roll only, at half the head amplitude. */
const bodyGain = 0.5
/** Seconds before the same gesture can retrigger. Shake, drop, and shake-or-drop share the angry cooldown. */
const cooldowns = { 'laugh': 4, 'recoil': 3, 'angry': 5, 'sway': 4, 'tilt-in': 5, 'look-away': 4, 'nod-off': 8 } as const
// Retire exponential tails once they have become negligible.
const tailTaus = 15

function cooldownKey(kind: GestureKind): keyof typeof cooldowns {
  return kind === 'shake' || kind === 'drop' || kind === 'shake-or-drop' ? 'angry' : kind
}

function between(random: RandomStream, min: number, max: number) {
  return min + (max - min) * random()
}

/** Raised-cosine window over progress `u` in [0, 1]: 0 with zero slope at both ends. */
function raisedCosine(u: number) {
  return u <= 0 || u >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * u)
}

/** Fades the last fifth of a clip to 0 so oscillations never end on a step. */
function taper(age: number, lifetime: number) {
  const fadeStart = 0.8 * lifetime
  return age <= fadeStart ? 1 : 1 - minJerk((age - fadeStart) / (lifetime - fadeStart))
}

/**
 * Draw order: side; angry choice only for shake-or-drop; laugh cycles, frequency,
 * amplitude; shake cycles. All other clips need only the side. `scale` is strength x band amplitude.
 */
function createClip(request: GestureKind, scale: number, random: RandomStream): ClipShape {
  const side = random() < 0.5 ? -1 : 1
  const kind = request === 'shake-or-drop' ? (random() < 0.5 ? 'shake' : 'drop') : request
  switch (kind) {
    case 'laugh': {
      const cycles = 2 + Math.floor(random() * 3)
      const frequency = between(random, Math.max(3.5, cycles), 5)
      const amplitude = between(random, 0.04, 0.06) * scale
      const oscillationEnd = cycles / frequency
      // Two fast cycles finish before 0.6 s; retain the quiet remainder of the clip.
      const lifetime = Math.max(0.6, oscillationEnd)
      return { lifetime, shape: age => [0, age >= oscillationEnd ? 0 : amplitude * impulseEnvelope(age, 0.15) * Math.exp(-3 * age / lifetime) * Math.sin(2 * Math.PI * frequency * age) * taper(age, oscillationEnd), 0] }
    }
    case 'recoil': {
      // Settle (1 - j)(1 - k j) dips to -overshoot and returns to 0; its minimum is -(k - 1)^2 / 4k.
      const overshoot = 0.2
      const k = (2 + 4 * overshoot + Math.sqrt((2 + 4 * overshoot) ** 2 - 4)) / 2
      return {
        lifetime: 0.72,
        shape: age => [0, 0.1 * scale * (age < 0.12 ? minJerk(age / 0.12) : (1 - minJerk((age - 0.12) / 0.6)) * (1 - k * minJerk((age - 0.12) / 0.6))), 0],
      }
    }
    case 'shake': {
      const lifetime = (2 + Math.floor(random() * 2)) / 3
      return { lifetime, shape: age => [side * 0.06 * scale * raisedCosine(age / lifetime) * Math.sin(2 * Math.PI * 3 * age), 0, 0] }
    }
    case 'drop':
      return { lifetime: tailTaus * 0.15, shape: age => [0, -0.08 * scale * impulseEnvelope(age, 0.15), 0] }
    case 'sway':
      return {
        lifetime: 2,
        shape: age => [
          side * 0.08 * scale * (age < 1.5 ? minJerk(age / 0.4) : 1 - minJerk((age - 1.5) / 0.5)),
          0,
          side * 0.04 * scale * raisedCosine(age / 1.5) * Math.sin(2 * Math.PI * 0.8 * age),
        ],
      }
    case 'tilt-in':
      return { lifetime: tailTaus * 0.5, shape: age => [0, 0.03 * scale * impulseEnvelope(age, 0.5), side * 0.08 * scale * impulseEnvelope(age, 0.5)] }
    case 'look-away':
      return {
        lifetime: 1.65,
        shape: age => [
          side * 0.1 * scale * (age < 1.05 ? minJerk(age / 0.25) : 1 - minJerk((age - 1.05) / 0.6)),
          0,
          side * 0.02 * scale * raisedCosine(age / 0.4) * Math.sin(2 * Math.PI * 5 * age),
        ],
      }
    case 'nod-off':
      // Sinks over 1.2 s, then catches back past rest by 0.04 before settling.
      return {
        lifetime: 1.2 + tailTaus * 0.3,
        shape: age => [0, scale * (age < 1.2 ? -0.08 * minJerk(age / 1.2) : -0.08 * (1 - minJerk((age - 1.2) / 0.3)) + 0.04 * impulseEnvelope(age - 1.2, 0.3)), 0],
      }
  }
}

/** Sums active clips at `time`; clips that reached their lifetime are dropped in place. */
function clipOffset(clips: Clip[], time: number): Vec3 {
  const offset: Vec3 = [0, 0, 0]
  for (let i = clips.length - 1; i >= 0; i--) {
    const age = time - clips[i].start
    if (age >= clips[i].lifetime) {
      clips.splice(i, 1)
      continue
    }
    if (age < 0)
      continue
    const value = clips[i].shape(age)
    for (const axis of [0, 1, 2])
      offset[axis] += value[axis]
  }
  return offset
}

/**
 * Short emotion-triggered head clips (laugh, recoil, shake, ...). Clips add to the head
 * and body offsets and always return to exactly 0; they never touch posture or face.
 *
 * All clip parameters are drawn from the given stream once, at trigger time (side first),
 * so two instances with equal seeds and triggers stay bit-identical. A refused trigger
 * (cooldown, slight band, no strength) draws nothing, so it cannot shift later clips.
 * Time is seconds of active motion.
 */
export class NaturalGestures {
  private readonly heads: Clip[] = []
  private readonly bodies: Clip[] = []
  private readonly lastTrigger = new Map<string, number>()

  constructor(private readonly random: RandomStream) {}

  /** Returns whether a clip started. `shake-or-drop` plays one of the two with equal chance. */
  trigger(kind: GestureKind, strength: number, band: Band, at: number): boolean {
    const amplitude = bandAmplitude[band]
    if (!(strength > 0) || !Number.isFinite(strength) || amplitude === 0 || !Number.isFinite(at))
      return false
    const key = cooldownKey(kind)
    const last = this.lastTrigger.get(key)
    if (last !== undefined && at - last < cooldowns[key])
      return false
    this.lastTrigger.set(key, at)
    const clip: Clip = { ...createClip(kind, Math.min(1, strength) * amplitude, this.random), start: at }
    this.heads.push(clip)
    if (band === 'strong') {
      this.bodies.push({
        ...clip,
        shape: (age) => {
          const head = clip.shape(age)
          return [bodyGain * head[0], 0, bodyGain * head[2]]
        },
      })
    }
    return true
  }

  headOffset(time: number): Vec3 {
    return clipOffset(this.heads, time)
  }

  bodyOffset(time: number): Vec3 {
    return clipOffset(this.bodies, time)
  }

  /** Time at which the last started clip ends, or 0 when none has started; the facade postpones posture shifts until then. */
  activeUntil(): number {
    return this.heads.reduce((end, clip) => Math.max(end, clip.start + clip.lifetime), 0)
  }
}
