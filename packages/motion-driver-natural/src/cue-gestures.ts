import type { NaturalGazeLayer } from './gaze'
import type { Vec3 } from './posture'
import type { RandomStream } from './random'

import { minJerk } from './processes'

/** Explicit conversation cues, separate from the emotion recipe's GestureKind. */
export type CueGestureKind = 'nod' | 'shake' | 'shrug' | 'lean' | 'glance'

type Channel = 'head' | 'body' | 'eyes'

interface Clip {
  kind: CueGestureKind
  count: number
  start: number
  end: number
  side: -1 | 1
}

const channels: Record<CueGestureKind, readonly Channel[]> = {
  nod: ['head'],
  shake: ['head'],
  shrug: ['head', 'body'],
  lean: ['body'],
  glance: ['eyes'],
}
const duck = { depth: 0.45, attack: 0.15, release: 0.3 }
const queueLifetime = 1.5

function conflicts(a: CueGestureKind, b: CueGestureKind) {
  return channels[a].some(channel => channels[b].includes(channel))
}

function raisedCosine(u: number) {
  return u <= 0 || u >= 1 ? 0 : 0.5 - 0.5 * Math.cos(2 * Math.PI * u)
}

function envelope(age: number, attack: number, releaseAt: number, release: number) {
  return age < releaseAt ? minJerk(age / attack) : 1 - minJerk((age - releaseAt) / release)
}

/**
 * Independent cue clips on the Natural active-time clock. Call advance before sampling a grid
 * step. Only started clips draw a side; refusals, queue replacement, and expiry draw nothing.
 * Head/body cues duck continuous posture, but an eyes-only glance never changes head motion.
 */
export class NaturalCueGestures {
  private readonly clips: Clip[] = []
  private readonly ducks: { start: number, end: number }[] = []
  private queued: { kind: CueGestureKind, count: number, at: number } | null = null
  /** Raw inward placement (-1..1), before idle placement easing; sampled when a lean starts. */
  placement = 0

  constructor(private readonly random: RandomStream, private readonly gaze: NaturalGazeLayer) {}

  /** Returns true for an immediate start, false for an ignored or queued request. */
  trigger(kind: CueGestureKind, count: number, at: number): boolean {
    if (!Number.isFinite(at) || !Number.isInteger(count) || count < 1 || count > 3)
      return false
    // Queue advancement belongs to the grid step, not a rejected request: even if another
    // queued clip has become due, a refused trigger must not consume its random draw.
    if (this.clips.some(clip => clip.kind === kind && at < clip.end))
      return false
    if (this.clips.some(clip => at < clip.end && conflicts(kind, clip.kind))) {
      this.queued = { kind, count, at }
      return false
    }
    this.start(kind, count, at)
    return true
  }

  /** Retires clips and starts the one queued cue when its channels become free. */
  advance(at: number) {
    // Compute the actual channel release before retiring clips, even if a caller skips samples.
    const queued = this.queued
    const freeAt = queued && this.clips.reduce((end, clip) => conflicts(queued.kind, clip.kind) ? Math.max(end, clip.end) : end, queued.at)
    if (queued && freeAt !== null && freeAt <= at) {
      this.queued = null
      if (freeAt - queued.at <= queueLifetime)
        this.start(queued.kind, queued.count, freeAt)
    }
    else if (queued && at - queued.at > queueLifetime) {
      this.queued = null
    }
    for (let i = this.clips.length - 1; i >= 0; i--) {
      if (at >= this.clips[i].end)
        this.clips.splice(i, 1)
    }
    for (let i = this.ducks.length - 1; i >= 0; i--) {
      if (at >= this.ducks[i].end + duck.release)
        this.ducks.splice(i, 1)
    }
  }

  /** Emotion recipe clips must not start while a cue owns the head channel. */
  headActive(at: number): boolean {
    return this.clips.some(clip => clip.start <= at && at < clip.end && channels[clip.kind].includes('head'))
  }

  eyesActive(at: number): boolean {
    return this.clips.some(clip => clip.kind === 'glance' && clip.start <= at && at < clip.end)
  }

  headOffset(time: number): Vec3 {
    const result: Vec3 = [0, 0, 0]
    for (const clip of this.clips) {
      const age = time - clip.start
      if (age < 0 || time >= clip.end)
        continue
      const s = clip.side
      switch (clip.kind) {
        case 'nod': {
          const dip = Math.floor(age / 0.45)
          result[1] -= 0.22 * 0.8 ** dip * raisedCosine((age - dip * 0.45) / 0.45)
          break
        }
        case 'shake':
          result[0] += s * 0.25 * raisedCosine(age / (0.5 * clip.count)) * Math.sin(2 * Math.PI * 2 * age)
          break
        case 'shrug': {
          const env = envelope(age, 0.25, 0.65, 0.45)
          result[1] += 0.04 * env
          result[2] += s * 0.06 * env
          break
        }
        case 'lean':
          result[2] += s * 0.05 * envelope(age, 0.3, 2.3, 0.3)
          break
      }
    }
    return result
  }

  bodyOffset(time: number): Vec3 {
    const result: Vec3 = [0, 0, 0]
    for (const clip of this.clips) {
      const age = time - clip.start
      if (age < 0 || time >= clip.end)
        continue
      switch (clip.kind) {
        case 'shake':
          result[0] += clip.side * 0.25 * 0.25 * raisedCosine(age / (0.5 * clip.count)) * Math.sin(2 * Math.PI * 2 * age)
          break
        case 'shrug':
          result[1] += 0.15 * envelope(age, 0.25, 0.65, 0.45)
          break
        case 'lean': {
          const env = envelope(age, 0.3, 2.3, 0.3)
          result[0] += clip.side * 0.08 * env
          result[2] += clip.side * 0.12 * env
          break
        }
      }
    }
    return result
  }

  faceOffset(time: number): { browY: number, mouthForm: number } {
    const shrug = this.clips.find(clip => clip.kind === 'shrug' && clip.start <= time && time < clip.end)
    const env = shrug ? envelope(time - shrug.start, 0.25, 0.65, 0.45) : 0
    return { browY: 0.3 * env, mouthForm: -0.15 * env }
  }

  /** Disjoint clips use the deepest duck, not an accumulating attenuation. */
  continuousScale(time: number): number {
    let depth = 0
    for (const window of this.ducks)
      depth = Math.max(depth, duck.depth * Math.min(minJerk((time - window.start) / duck.attack), 1 - minJerk((time - window.end) / duck.release)))
    return 1 - depth
  }

  /** Last head/body cue end; eyes-only glances must not postpone posture shifts. */
  activeUntil(): number {
    return this.clips.reduce((end, clip) => clip.kind === 'glance' ? end : Math.max(end, clip.end), 0)
  }

  private start(kind: CueGestureKind, count: number, at: number) {
    const side = kind === 'lean' && Math.abs(this.placement) > 0.1 ? (this.placement > 0 ? 1 : -1) : this.random() < 0.5 ? -1 : 1
    const duration = kind === 'nod' ? 0.45 * count : kind === 'shake' ? 0.5 * count : kind === 'shrug' ? 1.1 : 2.6
    const end = kind === 'glance' ? this.gaze.glance({ x: side * 0.35, y: 0.05 }, 0.6, at) : at + duration
    this.clips.push({ kind, count, side, start: at, end })
    if (kind !== 'glance')
      this.ducks.push({ start: at, end })
  }
}
