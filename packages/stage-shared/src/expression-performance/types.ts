import type { CatalogEntry } from './catalog'
import type { ExpressionPerformanceSettings } from './settings'

export const PERFORMANCE_EMOTIONS = ['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral', 'love', 'flustered', 'sleepy'] as const
export type PerformanceEmotion = typeof PERFORMANCE_EMOTIONS[number]
export type Band = 'slight' | 'clear' | 'strong'
export const bandRank = { slight: 1, clear: 2, strong: 3 } as const

export interface ReactionEpisode {
  id: string
  emotion: PerformanceEmotion
  nominal: number
  intensity: number
  band: Band
  escalation: boolean
}

/** Seconds use the signal producer's monotonic clock. */
export interface TimingEvent {
  id: string
  kind: 'sentence_start' | 'pause' | 'utterance_end' | 'emphasis'
  turnId: string
  at: number
}

/**
 * ACT markers target the next matching timing event of their turn; devtools pulses never schedule.
 *
 * A `clear` releases the named slot, or the face, effect, and prop slots when no slot is named.
 * It differs from a `neutral` emotion, which clears only face and effect and also resets the
 * reaction history.
 */
export type AffectSignal
  = | { kind: 'emotion', source: 'act' | 'tool' | 'devtools', emotion: PerformanceEmotion, nominal: number, turnId?: string, at: number }
    | { kind: 'expression', source: 'act' | 'tool', expressionId: string, holdSeconds?: number, turnId?: string, at: number }
    | { kind: 'clear', source: 'act' | 'tool' | 'devtools', slot?: SlotCommand['slot'], turnId?: string, at: number }
    | { kind: 'speech', event: 'clip-start' | 'clip-end' | 'clip-stopped' | 'turn-end', turnId: string, clipId?: string, at: number }
    | { kind: 'muted', muted: boolean, at: number }
    | { kind: 'timing', event: TimingEvent, at: number }
    | { kind: 'deadline', at: number }

export interface SlotCommand {
  slot: 'face' | 'effect' | 'prop'
  expressionId: string | null
  holdSeconds: number
  until: 'speech' | 'hold'
  /** Copied from the triggering signal so speech leases remain isolated by turn. */
  turnId?: string
}

export interface HoldCommand {
  /** `null` releases the hold. */
  emotion: PerformanceEmotion | null
  strength: number
  holdSeconds: number
  until: 'speech' | 'hold'
  /** Copied from the triggering signal so speech holds remain isolated by turn. */
  turnId?: string
}

export interface PerformanceDecision {
  episodes: ReactionEpisode[]
  slots: SlotCommand[]
  holds: HoldCommand[]
}

export interface DeciderContext {
  catalog: readonly CatalogEntry[]
  settings: ExpressionPerformanceSettings
}

/**
 * State must be a plain JSON-serializable object, with PRNG state stored as a uint32.
 * Implementations never read clocks, global randomness, stores, or parameter ids.
 */
export interface Decider<S> {
  initial: (seed: number) => S
  decide: (signal: AffectSignal, ctx: DeciderContext, state: S) => { decision: PerformanceDecision, state: S }
  /** Earliest monotonic second requiring a deadline signal, or null when none is pending. */
  nextDeadline: (state: S) => number | null
}
