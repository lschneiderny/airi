import type { GazePoint } from './gaze'
import type { RandomStream } from './random'

import { truncatedLognormal } from './random'

/** Head widths controlling radial soft saturation. */
export const softRadius = 1.2
/** Maximum cursor target magnitude in eye space. */
export const cursorGaze = 0.65
/** Head widths within which a moving cursor always engages. */
export const nearDistance = 2
/** Head widths separating medium and far engagement. */
export const farDistance = 6
/** Head widths at which head pull reaches its minimum gain. */
export const gainFarDistance = 10
/** Remaining head pull at and beyond the gain falloff distance. */
export const farGain = 0.35
/** Engagement probability for a medium-distance episode. */
export const engageMedium = 0.55
/** Engagement probability for a far-distance episode. */
export const engageFar = 0.2
/** Median interest spans in seconds for non-near episodes. */
export const interestMedian = { medium: 2.5, far: 1.5 }
/** Log-space standard deviation of interest spans. */
export const interestLogSd = 0.5
/** Allowed interest span range in seconds. */
export const interestSpan = { min: 0.8, max: 8 }
/** Weight of the initial notice glance. */
export const noticeLevel = 0.35
/** Seconds between noticing and full attention. */
export const noticeDwell = { min: 0.25, max: 0.5 }
/** Seconds a stationary cursor retains full interest. */
export const restHold = 0.6
/** Seconds of exponential interest decay after the rest hold. */
export const restTau = 0.8
/** Anchor travel in head widths that counts as movement. */
export const moveStep = 0.03
/** Seconds of rising attention smoothing. */
export const captureTau = 0.15
/** Seconds of ordinary falling attention smoothing. */
export const fadeTau = 0.5
/** Seconds of falling attention smoothing without a cursor. */
export const lostTau = 0.4
/** Seconds of falling attention smoothing after deliberate dismissal. */
export const dismissTau = 0.12
/** Falling weight at which pursuit is released. */
export const releaseAt = 0.3
/** Seconds after release or an ignored draw before another same-or-farther episode. */
export const cooldown = { min: 4, max: 10 }

/** Maps an eye-anchored offset (head widths, Y up) without per-axis saturation. */
export function mapCursor(offset: GazePoint) {
  const x = Math.max(-100, Math.min(100, offset.x))
  const y = Math.max(-100, Math.min(100, offset.y))
  const distance = Math.hypot(x, y)
  const ux = distance === 0 ? 0 : x / distance
  const uy = distance === 0 ? 0 : y / distance
  const magnitude = distance / Math.sqrt(distance * distance + softRadius * softRadius)
  const t = Math.max(0, Math.min(1, (Math.log(Math.max(distance, 1e-6)) - Math.log(nearDistance)) / (Math.log(gainFarDistance) - Math.log(nearDistance))))
  const gain = farGain + (1 - farGain) * (1 - t * t * (3 - 2 * t))
  return {
    distance,
    gain,
    eye: { x: cursorGaze * magnitude * ux, y: cursorGaze * magnitude * uy },
    head: { x: 0.25 * magnitude * gain * ux, y: 0.20 * magnitude * gain * uy },
  }
}

export interface CursorAttentionInput {
  cursor: GazePoint | null
  permission: 'full' | 'fade' | 'dismiss'
}

export interface CursorAttentionEvent {
  kind: 'notice' | 'engage' | 'release' | 'dismiss'
  at: number
  distance: number
}

export interface CursorAttentionResult {
  weight: number
  phase: 'idle' | 'notice' | 'full' | 'ignored'
  oriented: boolean
  events: CursorAttentionEvent[]
}

type Band = 'near' | 'medium' | 'far'

interface Episode {
  band: Band
  engaging: boolean
  span: number
  dwell: number
  cooldown: number
}

/** Seeded attention on monotonic active seconds; only a non-null episode start draws. */
export class NaturalCursorAttention {
  private weight = 0
  private phase: CursorAttentionResult['phase'] = 'idle'
  private permission: CursorAttentionInput['permission'] = 'full'
  private anchor: GazePoint | null = null
  private present = false
  private lastMovedAt = 0
  private distance = 0
  private episode: Episode | null = null
  private startedAt = 0
  private cooldownUntil = 0

  constructor(private readonly random: RandomStream) {}

  step(dt: number, at: number, input: CursorAttentionInput): CursorAttentionResult {
    const events: CursorAttentionEvent[] = []
    const { cursor, permission } = input
    const wasOriented = this.phase === 'notice' || this.phase === 'full'
    const appeared = cursor !== null && !this.present
    const restBeforeMove = at - this.lastMovedAt
    const moved = cursor !== null && (this.anchor === null || Math.hypot(cursor.x - this.anchor.x, cursor.y - this.anchor.y) >= moveStep)
    if (cursor !== null) {
      this.distance = mapCursor(cursor).distance
      if (appeared || moved) {
        this.anchor = { ...cursor }
        this.lastMovedAt = at
      }
    }

    const band: Band = this.distance <= nearDistance ? 'near' : this.distance <= farDistance ? 'medium' : 'far'
    const rank = { near: 0, medium: 1, far: 2 }
    const nearer = cursor !== null && this.episode !== null && rank[band] < rank[this.episode.band]
    const reopened = permission === 'full' && this.permission !== 'full' && cursor !== null && at - this.lastMovedAt < restHold
    const restarted = moved && restBeforeMove >= restHold
    const ready = at >= this.cooldownUntil

    if (permission === 'dismiss' && this.permission !== 'dismiss' && wasOriented) {
      events.push({ kind: 'dismiss', at, distance: this.distance })
      this.phase = 'idle'
      this.cooldownUntil = at + (this.episode?.cooldown ?? 0)
    }

    if (permission === 'full' && cursor !== null) {
      if (nearer || ((appeared || restarted || ((this.phase === 'idle' || this.phase === 'ignored') && moved)) && ready && !reopened)) {
        this.episode = this.drawEpisode(band)
        // An ignored episode has no interest to release, so its cooldown starts now.
        if (!this.episode.engaging)
          this.cooldownUntil = at + this.episode.cooldown
        this.start(at, events)
      }
      else if (reopened) {
        // Permission loss does not reroll whether this cursor was worth noticing.
        if (this.episode === null) {
          this.episode = this.drawEpisode(band)
          if (!this.episode.engaging)
            this.cooldownUntil = at + this.episode.cooldown
        }
        this.start(at, events)
      }
    }

    const rest = Math.exp(-Math.max(0, at - this.lastMovedAt - restHold) / restTau)
    const interested = this.episode !== null && at - this.startedAt < this.episode.span && rest >= 1e-4
    if (permission === 'full' && cursor !== null && interested && this.phase === 'notice' && this.episode !== null && at - this.startedAt >= this.episode.dwell) {
      this.phase = 'full'
      events.push({ kind: 'engage', at, distance: this.distance })
    }

    let goal = 0
    if (permission === 'full' && cursor !== null && interested)
      goal = (this.phase === 'notice' ? noticeLevel : this.phase === 'full' ? 1 : 0) * rest
    const tau = goal > this.weight ? captureTau : permission === 'dismiss' ? dismissTau : cursor === null ? lostTau : fadeTau
    this.weight += (goal - this.weight) * (1 - Math.exp(-dt / tau))
    if (goal === 0 && this.weight < 1e-4)
      this.weight = 0

    const oriented = this.phase === 'notice' || this.phase === 'full'
    if (oriented && goal < this.weight && this.weight <= releaseAt) {
      if (permission === 'full')
        events.push({ kind: 'release', at, distance: this.distance })
      this.phase = 'idle'
      this.cooldownUntil = at + (this.episode?.cooldown ?? 0)
    }

    this.present = cursor !== null
    this.permission = permission
    return { weight: this.weight, phase: this.phase, oriented: this.phase === 'notice' || this.phase === 'full', events }
  }

  private start(at: number, events: CursorAttentionEvent[]) {
    this.startedAt = at
    this.phase = this.episode?.engaging ? 'notice' : 'ignored'
    if (this.phase === 'notice')
      events.push({ kind: 'notice', at, distance: this.distance })
  }

  private drawEpisode(band: Band): Episode {
    return {
      band,
      engaging: band === 'near' || this.random() < (band === 'medium' ? engageMedium : engageFar),
      span: band === 'near' ? Number.POSITIVE_INFINITY : truncatedLognormal(this.random, interestMedian[band], interestLogSd, interestSpan.min, interestSpan.max),
      dwell: noticeDwell.min + this.random() * (noticeDwell.max - noticeDwell.min),
      cooldown: cooldown.min + this.random() * (cooldown.max - cooldown.min),
    }
  }
}
