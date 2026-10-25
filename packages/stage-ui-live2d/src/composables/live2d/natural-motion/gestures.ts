import type { Band } from '@proj-airi/stage-shared/expression-performance'

import type { GestureKind } from './emotions'
import type { Vec3 } from './posture'
import type { RandomStream } from './random'

import { impulseEnvelope } from './impulses'
import { minJerk } from './processes'

interface ClipShape {
  /**
   * Seconds after `start` at which the head offset has stayed below 10% of its peak (capped at 2 s).
   * The idle-motion duck holds until then; unlike `lifetime` it ignores quiet exponential tails.
   */
  readonly activeSpan: number
  /** Seconds after `start` at which the clip contributes exactly 0 and is retired. */
  readonly lifetime: number
  /** Head offset at `age` seconds since `start`, in normalized head units. */
  readonly shape: (age: number) => Vec3
  /** Face offset at `age` seconds since `start`; only the laugh has one. */
  readonly face?: (age: number) => FaceTerm
}

/** Smile and mouth opening a clip adds to the face, in the face layer's units. */
export interface FaceTerm {
  readonly eyeSmile: number
  readonly mouthOpen: number
}

interface Clip extends ClipShape {
  readonly start: number
}

interface FaceClip {
  readonly start: number
  readonly lifetime: number
  readonly face: (age: number) => FaceTerm
}

/** A gesture that plays as one clip; `shake-or-drop` resolves to `shake` or `drop` when it triggers. */
type PlayedGesture = Exclude<GestureKind, 'shake-or-drop'>

/** Head amplitude per band; the slight band never triggers a gesture. */
const bandAmplitude: Record<Band, number> = { slight: 0, clear: 0.6, strong: 1 }
/** Body follows the head on yaw and roll only, at half the head amplitude. */
const bodyGain = 0.5
/** Seconds before the same gesture can retrigger. Shake, drop, and shake-or-drop share the angry cooldown. */
const cooldowns = { 'laugh': 4, 'recoil': 3, 'angry': 5, 'sway': 4, 'tilt-in': 5, 'look-away': 4, 'nod-off': 8 } as const
/** Idle continuous motion dips by `depth` x strength x band amplitude over `attack`, and returns over `release`. */
const duck = { depth: 0.45, attack: 0.15, release: 0.3 }
/** Seconds the duck takes to release after a clip's active span; QA waits this long after a clip. */
export const gestureDuckRelease = duck.release
/** Longest active span, in seconds. */
const activeSpanCap = 2
// Retire exponential tails once they have become negligible.
const tailTaus = 15

/**
 * The longest lifetime `createClip` can draw per clip, in seconds after the start. Laugh ends after its
 * third cycle at 2.6 Hz (0.15 s attack + 3 / 2.6 s + 0.35 s release); shake plays at most 3 cycles at 3 Hz (1 s).
 * QA reads these bounds to keep scored windows clear of clip residue.
 */
export const gestureLifetimes: Readonly<Record<PlayedGesture, number>> = {
  'laugh': 0.15 + 3 / 2.6 + 0.35,
  'recoil': 0.72,
  'shake': 1,
  'drop': tailTaus * 0.15,
  'sway': 2,
  'tilt-in': tailTaus * 0.5,
  'look-away': 1.65,
  'nod-off': 1.2 + tailTaus * 0.3,
}

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

/**
 * Draw order, after the side and angry choice that `trigger` draws: laugh cycles, frequency,
 * amplitude; shake cycles. All other clips need only the side. `scale` is strength x band amplitude.
 */
function createClip(kind: PlayedGesture, side: -1 | 1, scale: number, random: RandomStream): ClipShape {
  const clip = createClipShape(kind, side, scale, random)
  return { ...clip, activeSpan: activeSpanOf(clip) }
}

type ClipBody = Pick<ClipShape, 'lifetime' | 'shape' | 'face'>

/** First age after the peak from which the head-offset norm stays below 10% of the peak, sampled at 1/120 s. */
function activeSpanOf(clip: ClipBody) {
  const samples = Math.floor(clip.lifetime * 120)
  const norms = Array.from({ length: samples + 1 }, (_, i) => Math.hypot(...clip.shape(i / 120)))
  const peak = Math.max(...norms)
  const threshold = 0.1 * peak
  let lastAbove = norms.indexOf(peak)
  for (let i = norms.length - 1; i > lastAbove; i--) {
    if (norms[i] > threshold) {
      lastAbove = i
      break
    }
  }
  return Math.min(activeSpanCap, (lastAbove + 1) / 120)
}

function createClipShape(kind: PlayedGesture, side: -1 | 1, scale: number, random: RandomStream): ClipBody {
  switch (kind) {
    case 'laugh': {
      // A chuckle: the head lifts over 0.15 s, bounces on its pitch once per cycle (never below the lifted pose),
      // then settles over 0.35 s. The smile follows the lift and the mouth opens with each bounce.
      const cycles = 2 + Math.floor(random() * 2)
      const frequency = between(random, 2.6, 3.2)
      const amplitude = between(random, 0.05, 0.07) * scale
      const bounceEnd = 0.15 + cycles / frequency
      const lifetime = bounceEnd + 0.35
      const lift = (age: number) => age < bounceEnd ? minJerk(age / 0.15) : 1 - minJerk((age - bounceEnd) / 0.35)
      const bounce = (age: number) => age <= 0.15 || age >= bounceEnd ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * frequency * (age - 0.15))
      return {
        lifetime,
        shape: age => [0, amplitude * (lift(age) - 0.8 * bounce(age)), side * 0.5 * amplitude * lift(age)],
        face: age => ({ eyeSmile: 0.35 * scale * lift(age), mouthOpen: 0.12 * scale * bounce(age) }),
      }
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

/** One idle-motion duck window: `depth` over `attack` from `start`, held to `end`, released over `duck.release`. */
interface DuckWindow {
  readonly start: number
  readonly end: number
  readonly depth: number
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

/** Sums the face terms of active face clips at `time`; clips that reached their lifetime are dropped in place. */
function faceTerm(clips: FaceClip[], time: number): FaceTerm {
  let eyeSmile = 0
  let mouthOpen = 0
  for (let i = clips.length - 1; i >= 0; i--) {
    const age = time - clips[i].start
    if (age >= clips[i].lifetime) {
      clips.splice(i, 1)
      continue
    }
    if (age < 0)
      continue
    const value = clips[i].face(age)
    eyeSmile += value.eyeSmile
    mouthOpen += value.mouthOpen
  }
  return { eyeSmile, mouthOpen }
}

/**
 * Short emotion-triggered clips (laugh, recoil, shake, ...). Clips add to the head and body offsets and
 * always return to exactly 0. The head and body offsets never touch posture; only the laugh also adds a face
 * term (`faceOffset`), in both the clear and strong bands.
 *
 * All clip parameters are drawn from the given stream once, at trigger time (side first),
 * so two instances with equal seeds and triggers stay bit-identical. A refused trigger
 * (cooldown, slight band, no strength) draws nothing, so it cannot shift later clips.
 * Time is seconds of active motion.
 */
export class NaturalGestures {
  private readonly heads: Clip[] = []
  private readonly bodies: Clip[] = []
  private readonly faces: FaceClip[] = []
  private readonly ducks: DuckWindow[] = []
  private readonly lastTrigger = new Map<string, number>()

  constructor(private readonly random: RandomStream) {}

  /**
   * Returns whether a clip started. `shake-or-drop` plays one of the two with equal chance.
   * `started` receives the played gesture and its side, synchronously, only when a clip starts.
   */
  trigger(kind: GestureKind, strength: number, band: Band, at: number, started?: (gesture: PlayedGesture, side: -1 | 1) => void): boolean {
    const amplitude = bandAmplitude[band]
    if (!(strength > 0) || !Number.isFinite(strength) || amplitude === 0 || !Number.isFinite(at))
      return false
    const key = cooldownKey(kind)
    const last = this.lastTrigger.get(key)
    if (last !== undefined && at - last < cooldowns[key])
      return false
    this.lastTrigger.set(key, at)
    // Draw order: side, then the angry choice only for shake-or-drop, then the clip's own draws.
    const side = this.random() < 0.5 ? -1 : 1
    const played = kind === 'shake-or-drop' ? (this.random() < 0.5 ? 'shake' : 'drop') : kind
    const clip: Clip = { ...createClip(played, side, Math.min(1, strength) * amplitude, this.random), start: at }
    this.heads.push(clip)
    if (clip.face)
      this.faces.push({ start: at, lifetime: clip.lifetime, face: clip.face })
    this.ducks.push({ start: at, end: at + clip.activeSpan, depth: duck.depth * Math.min(1, strength) * amplitude })
    started?.(played, side)
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

  /**
   * Smile and mouth opening of the live laughs at `time`, exactly 0 once they end and for every other clip.
   * The facade adds the smile with held emotions on and the mouth only while no speech is active or recent.
   */
  faceOffset(time: number): FaceTerm {
    return faceTerm(this.faces, time)
  }

  /**
   * Multiplier for idle continuous posture motion at `time`: 1 outside clips, `1 - depth` while the deepest live
   * clip is active, with min-jerk edges. Overlapping clips take the deepest window, not the sum. It draws nothing.
   */
  continuousScale(time: number): number {
    let depth = 0
    for (let i = this.ducks.length - 1; i >= 0; i--) {
      const window = this.ducks[i]
      if (time >= window.end + duck.release) {
        this.ducks.splice(i, 1)
        continue
      }
      depth = Math.max(depth, window.depth * Math.min(minJerk((time - window.start) / duck.attack), 1 - minJerk((time - window.end) / duck.release)))
    }
    return 1 - depth
  }

  /** Time at which the last started clip ends, or 0 when none has started; the facade postpones posture shifts until then. */
  activeUntil(): number {
    return this.heads.reduce((end, clip) => Math.max(end, clip.start + clip.lifetime), 0)
  }
}
