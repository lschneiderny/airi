import type { Band, ExpressionPerformanceSettings, HoldCommand, PerformanceEmotion, ReactionEpisode, ReactionState, SlotCommand, TouchAffectMemory } from '@proj-airi/stage-shared/expression-performance'
import type { ReactionDecision, ReactionMemory } from '@proj-airi/stage-shared/situation'

/** Uniform draws in [0, 1). The shell owns the source; the core stores none. */
export type MindRandom = () => number

export type MindStimulus
  /** An ACT emotion, a tool call, or a devtools pulse. `nominal` is already scaled by the card's expressiveness. */
  = | { kind: 'emotion', source: 'act' | 'tool' | 'devtools', emotion: PerformanceEmotion, nominal: number, turnId?: string, settings: ExpressionPerformanceSettings }
  /** The model named an entry. The performer read the entry's lease and its primary emotion mapping from its catalog. */
    | { kind: 'expression-request', source: 'act' | 'tool', entryId: string, lease: { holdSeconds: number, until: 'speech' | 'hold' }, mapping: { emotion: PerformanceEmotion, minBand: Band } | null, turnId?: string, settings: ExpressionPerformanceSettings }
    | { kind: 'expression-clear', source: 'act' | 'tool' | 'devtools', slot?: SlotCommand['slot'], turnId?: string }

interface IntentBase {
  /** Unique among the intents of one mind since its initial state. */
  id: string
  /** Sequence number of the stimulus this intent answers; every intent of one response shares it. */
  cause: number
}

export type MindIntent
  /** A new or escalated episode of an emotion, with the hold that keeps it on the face. */
  = | (IntentBase & { channel: 'face', kind: 'emotion', episode: ReactionEpisode, hold: HoldCommand, reason: 'act' | 'tool' | 'devtools', turnId?: string })
  /** A named entry. `episode` is null when the request started no new episode; `hold` is null when the entry maps to no emotion or held emotions are off. */
    | (IntentBase & { channel: 'face', kind: 'entry', entryId: string, episode: ReactionEpisode | null, hold: HoldCommand | null, reason: 'act' | 'tool', turnId?: string })
  /** `neutral`: a neutral emotion reset the reaction state. `all`: a clear that names no slot. `hold` is null when a clear names a slot, which keeps the held emotion. */
    | (IntentBase & { channel: 'face', kind: 'release', scope: 'neutral' | 'all' | SlotCommand['slot'], hold: HoldCommand | null, reason: 'act' | 'tool' | 'devtools', turnId?: string })

/** Plain JSON. Everything here is fast state: it resets on launch. */
export interface MindState {
  /** Stimuli answered so far. */
  seq: number
  /** Emotion strength and habituation: the emotion half of the expression decider. */
  reaction: ReactionState
  touch: { affect: TouchAffectMemory }
  voice: { reaction: ReactionMemory, lastDecision: ReactionDecision | null }
}
