import type { CatalogEntry } from './catalog'
import type { ExpressionPerformanceSettings } from './settings'

export type PerformanceEmotion = 'happy' | 'sad' | 'angry' | 'think' | 'surprised' | 'awkward' | 'question' | 'curious' | 'neutral'
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

/** ACT markers target the next matching timing event of their turn; devtools pulses never schedule. */
export type AffectSignal
  = | { kind: 'emotion', source: 'act' | 'tool' | 'devtools', emotion: PerformanceEmotion, nominal: number, turnId?: string, at: number }
    | { kind: 'expression', source: 'act' | 'tool', expressionId: string, holdSeconds?: number, turnId?: string, at: number }
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

export interface PerformanceDecision {
  episodes: ReactionEpisode[]
  slots: SlotCommand[]
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
