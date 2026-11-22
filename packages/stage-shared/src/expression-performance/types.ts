import type { CatalogEntry } from './catalog'
import type { EmotionBehaviorSettings, ExpressionRealisationSettings } from './settings'

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
 * What an asset decider reacts to. The character mind decides the emotion, its strength, and its hold first, so
 * no signal carries a raw emotion:
 * - A `reaction` carries the episode the mind decided. A turn's picks target the next matching timing event of
 *   that turn; a reaction without a turn never schedules.
 * - A `neutral` says that a neutral emotion reset the mind's reaction state. It clears only face and effect.
 * - An `expression` names an entry. Its `episode` is the one the mind derived from the entry's emotion mapping,
 *   or null when the request started none.
 * - A `clear` releases the named slot, or the face, effect, and prop slots when no slot is named.
 *
 * Intent answers carry their mind intent id. Picks are seeded from that id and their slot, independently of the
 * conductor's seed. Timing and performer lifecycle signals carry no intent and draw no new picks.
 * A touch is not a signal: the mind doses mood from it and no entry shows it.
 */
export type AffectSignal
  = | { kind: 'reaction', intentId: string, episode: ReactionEpisode, turnId?: string, at: number }
    | { kind: 'neutral', intentId: string, turnId?: string, at: number }
    | { kind: 'expression', intentId: string, source: 'act' | 'tool', expressionId: string, holdSeconds?: number, episode: ReactionEpisode | null, turnId?: string, at: number }
    | { kind: 'clear', intentId: string, source: 'act' | 'tool' | 'devtools', slot?: SlotCommand['slot'], turnId?: string, at: number }
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
  slots: SlotCommand[]
  /** A scheduled entry can disappear before its timing event; the conductor reports it without changing policy. */
  refusals?: ExpressionRefusal[]
}

/** One expression request that cannot be shown. Reports contain catalog ids, never labels or model paths. */
export interface ExpressionRefusal {
  entryId: string
  /** `item-limit`: showing the entry would put more stage items on screen than the renderer allows at once. */
  reason: 'masked-by-clip' | 'masked-by-manual' | 'masked-by-expression' | 'missing-asset' | 'item-limit'
}

/**
 * What the renderer reports for one shown stage item: drawn at its pin (`attached`), drawn at a pin re-picked in
 * memory because her mesh changed (`reattached`), drawn at its fallback point because the pinned drawable is gone
 * (`missing-drawable`), drawn in front because its layer drawable is gone (`missing-layer`), or not drawn because its
 * file could not be read or decoded (`failed`).
 */
export type ItemRenderState = 'attached' | 'reattached' | 'missing-drawable' | 'missing-layer' | 'failed'

export interface DeciderContext {
  catalog: readonly CatalogEntry[]
  /** Effective behavior for the speaking character alongside this performer's realisation settings. */
  settings: EmotionBehaviorSettings & ExpressionRealisationSettings
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
