import type { BodyActionKind } from '../director'

/** Shortest time in milliseconds before the same clip plays unasked again, by kind: a dance is an event, a gesture a habit. */
export const IDLE_CLIP_REPEAT_MS: Readonly<Record<BodyActionKind, number>> = Object.freeze({ gesture: 300_000, action: 900_000, dance: 2_700_000 })

/** Relative odds of a clip by kind. */
const KIND_WEIGHT: Readonly<Record<BodyActionKind, number>> = Object.freeze({ gesture: 1, action: 0.5, dance: 0.1 })

/** A clip the user allowed her to play on her own. */
export interface IdleClipCandidate {
  clipId: string
  kind: BodyActionKind
}

/** The clips she played unasked before, which keep her from repeating one. */
export interface IdleClipHistory {
  readonly lastClipId: string | null
  /** When each clip last played unasked, in milliseconds. */
  readonly playedAtMs: Readonly<Record<string, number>>
}

export const initialIdleClipHistory: IdleClipHistory = Object.freeze({ lastClipId: null, playedAtMs: Object.freeze({}) })

/**
 * Which allowed clip she plays when Natural's idle draw starts an unasked clip; `pick` is the draw's uniform in [0, 1).
 * A clip rests for its kind's repeat time, the clip played last is picked again only when it is the only one left,
 * and the kinds weigh gesture 1, action 0.5 and dance 0.1. Null when every clip still rests: the scene then refuses the
 * errand. Natural decides when; the caller sends the clip to the director as an `idle` request, which may still refuse it.
 */
export function pickIdleClip(clips: readonly IdleClipCandidate[], history: IdleClipHistory, draw: { nowMs: number, pick: number }): IdleClipCandidate | null {
  const rested = clips.filter((clip) => {
    const playedAt = history.playedAtMs[clip.clipId]
    return playedAt === undefined || draw.nowMs - playedAt >= IDLE_CLIP_REPEAT_MS[clip.kind]
  })
  const pool = rested.length > 1 ? rested.filter(clip => clip.clipId !== history.lastClipId) : rested
  const total = pool.reduce((sum, clip) => sum + KIND_WEIGHT[clip.kind], 0)
  if (total <= 0)
    return null
  let remaining = draw.pick * total
  for (const clip of pool) {
    remaining -= KIND_WEIGHT[clip.kind]
    if (remaining < 0)
      return clip
  }
  return pool[pool.length - 1]
}
