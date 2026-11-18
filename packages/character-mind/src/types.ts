import type { Band, ExpressionPerformanceSettings, HoldCommand, MoodDose, PerformanceEmotion, ReactionEpisode, ReactionState, SlotCommand, TouchAffectMemory } from '@proj-airi/stage-shared/expression-performance'
import type { GateOutcome, ReactionDecision, ReactionKind, ReactionMemory, TouchVoiceView } from '@proj-airi/stage-shared/situation'

/** Uniform draws in [0, 1). The shell owns the source; the core stores none. */
export type MindRandom = () => number

/**
 * A classified touch, as a scene reports it. A poke's point is relative to the touched region: x from -1 (left) to
 * 1, y from -1 (top) to 1. Only the head is petted.
 */
export type TouchReport
  = | { gesture: 'poke', region: 'head' | 'body', point: { x: number, y: number } }
    | { gesture: 'pet-start', region: 'head' }
    | { gesture: 'pet-end', region: 'head', durationMs: number }

export type MindStimulus
  /** `voice` is null for a pet start and when no leader gate runs; the mind then decides no line. */
  = | (TouchReport & { kind: 'touch', settings: ExpressionPerformanceSettings, voice: TouchVoiceView | null })
  /** An ACT emotion, a tool call, or a devtools pulse. `nominal` is already scaled by the card's expressiveness. */
    | { kind: 'emotion', source: 'act' | 'tool' | 'devtools', emotion: PerformanceEmotion, nominal: number, turnId?: string, settings: ExpressionPerformanceSettings }
  /** The model named an entry. The performer read the entry's lease and its primary emotion mapping from its catalog. */
    | { kind: 'expression-request', source: 'act' | 'tool', entryId: string, lease: { holdSeconds: number, until: 'speech' | 'hold' }, mapping: { emotion: PerformanceEmotion, minBand: Band } | null, turnId?: string, settings: ExpressionPerformanceSettings }
    | { kind: 'expression-clear', source: 'act' | 'tool' | 'devtools', slot?: SlotCommand['slot'], turnId?: string }
  /** What became of a `speak` intent, named by its `eventId`. `refused` means another unprompted turn was pending. */
    | { kind: 'voice-outcome', eventId: string, outcome: GateOutcome | 'refused' }

interface IntentBase {
  /** Unique among the intents of one mind since its initial state. */
  id: string
  /** Sequence number of the stimulus this intent answers; every intent of one response shares it. */
  cause: number
}

export type MindIntent
  /** The body's answer to a poke, at the point the scene reported. */
  = | (IntentBase & { channel: 'posture', kind: 'touch-reaction', gesture: 'poke', region: 'head' | 'body', point: { x: number, y: number } })
  /** The mind's pet runs from `start` to `end`; the performer follows the hand only between them. */
    | (IntentBase & { channel: 'posture', kind: 'touch-reaction', gesture: 'pet', phase: 'start' | 'end' })
  /** A mood dose for the Natural performer. */
    | (IntentBase & { channel: 'posture', kind: 'mood', dose: MoodDose })
  /** A new or escalated episode of an emotion, with the hold that keeps it on the face. */
    | (IntentBase & { channel: 'face', kind: 'emotion', episode: ReactionEpisode, hold: HoldCommand, reason: 'act' | 'tool' | 'devtools', turnId?: string })
  /** A named entry. `episode` is null when the request started no new episode; `hold` is null when the entry maps to no emotion or held emotions are off. */
    | (IntentBase & { channel: 'face', kind: 'entry', entryId: string, episode: ReactionEpisode | null, hold: HoldCommand | null, reason: 'act' | 'tool', turnId?: string })
  /** `neutral`: a neutral emotion reset the reaction state. `all`: a clear that names no slot. `hold` is null when a clear names a slot, which keeps the held emotion. */
    | (IntentBase & { channel: 'face', kind: 'release', scope: 'neutral' | 'all' | SlotCommand['slot'], hold: HoldCommand | null, reason: 'act' | 'tool' | 'devtools', turnId?: string })
  /** A moment the performer may mark with one of the model's own expressions; the performer keeps the chance and the pick. */
    | (IntentBase & { channel: 'face', kind: 'moment', moment: 'poked' | 'petted' })
  /** One short line about the touch whose situation event is `eventId`. Its outcome returns as a `voice-outcome` stimulus. */
    | (IntentBase & { channel: 'voice', kind: 'speak', line: ReactionKind, eventId: string })

/** The posture intent a scene performs for a touch. */
export type TouchReactionIntent = Extract<MindIntent, { kind: 'touch-reaction' }>

/** Plain JSON. Everything here is fast state: it resets on launch. */
export interface MindState {
  /** Stimuli answered so far. */
  seq: number
  /** Emotion strength and habituation: the emotion half of the expression decider. */
  reaction: ReactionState
  /** Pacing and habituation of the mood doses of touches, in seconds of the mind's clock. */
  touch: { affect: TouchAffectMemory }
  /** Pacing of spoken touch reactions, and the last decision about one; null until a touch with a voice view arrives. */
  voice: { reaction: ReactionMemory, lastDecision: ReactionDecision | null }
}
