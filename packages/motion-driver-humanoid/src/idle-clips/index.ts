import type { BodyActionKind } from '../director'

import { createRandomStream } from '../random'

/** Mean time in milliseconds between two unasked clips while her body is quiet, at a pace of 1. */
export const IDLE_CLIP_MEAN_GAP_MS = 240_000

/** Shortest time in milliseconds between two unasked clips, whatever the draw. */
export const IDLE_CLIP_REST_MS = 60_000

/** Shortest time in milliseconds before the same clip plays unasked again, by kind: a dance is an event, a gesture a habit. */
export const IDLE_CLIP_REPEAT_MS: Readonly<Record<BodyActionKind, number>> = Object.freeze({ gesture: 300_000, action: 900_000, dance: 2_700_000 })

/** Relative odds of a clip by kind. */
const KIND_WEIGHT: Readonly<Record<BodyActionKind, number>> = Object.freeze({ gesture: 1, action: 0.5, dance: 0.1 })

/** Longest step in milliseconds that counts toward the urge, so a paused stage does not start a clip the moment it resumes. */
const MAX_STEP_MS = 1_000

/** A clip the user allowed her to play on her own. */
export interface IdleClipCandidate {
  clipId: string
  kind: BodyActionKind
}

export interface IdleClipInput {
  /** Epoch or director-clock milliseconds supplied by the caller; this module never reads a clock. */
  nowMs: number
  clips: readonly IdleClipCandidate[]
  /** Her body is free: idle or watching, standing, not walking, not performing, not speaking, not asleep. */
  quiet: boolean
  /** Multiplies how often clips start; 0 starts none. */
  pace: number
  seed: number
}

/** State supplied to the next call. */
export interface IdleClipMemory {
  readonly nowMs: number | null
  /** Hazard accumulated over quiet time since the last clip. */
  readonly urge: number
  /** The `Exp(1)` draw the urge must cross, or null until the next quiet frame draws it. */
  readonly threshold: number | null
  readonly restUntilMs: number
  readonly lastClipId: string | null
  /** When each clip last played unasked. */
  readonly playedAtMs: Readonly<Record<string, number>>
  /** Mulberry32 seed advanced after every draw; null until seeded from the input. */
  readonly rngState: number | null
}

export const initialIdleClipMemory: IdleClipMemory = Object.freeze({
  nowMs: null,
  urge: 0,
  threshold: null,
  restUntilMs: 0,
  lastClipId: null,
  playedAtMs: Object.freeze({}),
  rngState: null,
})

/** Draws one uniform value and returns the advanced seed; no hidden state. */
function drawRandom(state: number): { value: number, state: number } {
  const stream = createRandomStream(state)
  const value = stream()
  return { value, state: Math.floor(stream() * 2 ** 32) >>> 0 }
}

/**
 * Decides whether she plays one of her allowed clips unasked in this frame, and which.
 *
 * The urge grows only over quiet time and a clip starts when it crosses an `Exp(1)` draw, so clips arrive at
 * irregular intervals around {@link IDLE_CLIP_MEAN_GAP_MS} and never while she is busy. A clip rests for its kind's
 * repeat time, and the clip played last is drawn again only when it is the only one left. The caller sends the
 * returned clip to the director as an `idle` request; the director may still refuse it.
 *
 * Pure: time is supplied and clamped so that it never runs backwards, and randomness comes from the checkpointed seed.
 */
export function decideIdleClip(input: IdleClipInput, previous: IdleClipMemory): { clipId: string | null, memory: IdleClipMemory } {
  const finiteNowMs = Number.isFinite(input.nowMs) ? input.nowMs : previous.nowMs ?? 0
  const nowMs = previous.nowMs === null ? finiteNowMs : Math.max(previous.nowMs, finiteNowMs)
  const stepMs = previous.nowMs === null ? 0 : Math.min(MAX_STEP_MS, nowMs - previous.nowMs)
  const pace = Number.isFinite(input.pace) ? Math.max(0, input.pace) : 0
  let rngState = previous.rngState ?? input.seed >>> 0
  let { urge, threshold } = previous

  const hold = (): { clipId: null, memory: IdleClipMemory } => ({ clipId: null, memory: { ...previous, nowMs, urge, threshold, rngState } })
  if (!input.quiet || pace === 0 || input.clips.length === 0 || nowMs < previous.restUntilMs)
    return hold()

  if (threshold === null) {
    const draw = drawRandom(rngState)
    rngState = draw.state
    threshold = -Math.log(1 - draw.value)
  }
  urge += pace * stepMs / IDLE_CLIP_MEAN_GAP_MS
  if (urge < threshold)
    return hold()

  // The urge is spent whether or not a clip is free to play, so a library on cooldown does not fire the moment it frees up.
  urge = 0
  threshold = null
  const rested = input.clips.filter((clip) => {
    const playedAt = previous.playedAtMs[clip.clipId]
    return playedAt === undefined || nowMs - playedAt >= IDLE_CLIP_REPEAT_MS[clip.kind]
  })
  const pool = rested.length > 1 ? rested.filter(clip => clip.clipId !== previous.lastClipId) : rested
  const total = pool.reduce((sum, clip) => sum + KIND_WEIGHT[clip.kind], 0)
  if (total <= 0)
    return hold()

  const draw = drawRandom(rngState)
  rngState = draw.state
  let remaining = draw.value * total
  let picked = pool[pool.length - 1]
  for (const clip of pool) {
    remaining -= KIND_WEIGHT[clip.kind]
    if (remaining < 0) {
      picked = clip
      break
    }
  }
  return {
    clipId: picked.clipId,
    memory: {
      nowMs,
      urge,
      threshold,
      restUntilMs: nowMs + IDLE_CLIP_REST_MS,
      lastClipId: picked.clipId,
      playedAtMs: { ...previous.playedAtMs, [picked.clipId]: nowMs },
      rngState,
    },
  }
}
