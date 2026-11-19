import type { Band, ExpressionPerformanceSettings, HoldCommand, MoodDose, PerformanceEmotion, ReactionEpisode, ReactionState, SlotCommand, TouchAffectMemory } from '@proj-airi/stage-shared/expression-performance'
import type { GateLocalTime, GateOutcome, GateSettings, GateSignals, ReactionDecision, ReactionKind, ReactionMemory, ReasonCategory, ReasonKind, ReasonState, SavedGateMemory, SituationState, TouchVoiceView, UrgeGateDecision, UrgeGateMemory } from '@proj-airi/stage-shared/situation'

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

/** What woke the desktop: a screen unlock or a resume from suspend. */
export type WakeCause = 'unlock' | 'resume'

export type VoiceLine
  /** A spoken touch reaction (CM1). `eventId` names the touch's situation event. */
  = | { kind: 'reaction', reaction: ReactionKind, eventId: string }
  /** A reach-out the gate decided. */
    | { kind: 'reach-out', topicKey: string, topicText: string, reason: { kind: ReasonKind, category: ReasonCategory } }

export interface VoiceRun {
  /** The store bumps it at each promotion and at "Delete all data". A new id makes the mind restore its gate memory. */
  id: number
  /** The store's mirror of the last memory a mind published in this run, or null before the first. */
  memory: UrgeGateMemory | null
  /** The social slice read at the promotion; null when nothing was saved or the user deleted all data. */
  saved: SavedGateMemory | null
}

/** What the voice policy sees of the situation at one tick. Built by the store, never kept by the mind. */
export interface VoiceView {
  run: VoiceRun
  situation: SituationState
  threads: Pick<ReasonState, 'threads'>
  local: GateLocalTime
  sessionId: string
  signals: GateSignals
  settings: GateSettings
  moodFactor: number
  /** Topics a widget or plugin turn holds (`holdTopic`); the gate never picks them. */
  heldTopics: string[]
  /** An unprompted turn the mind did not start is pending in chat. */
  unpromptedPending: boolean
}

export type MindStimulus
  /** `voice` is null for a pet start and when no leader gate runs; the mind then decides no line. */
  = | (TouchReport & { kind: 'touch', settings: ExpressionPerformanceSettings, voice: TouchVoiceView | null })
  /** An ACT emotion, a tool call, or a devtools pulse. `nominal` is already scaled by the card's expressiveness. */
    | { kind: 'emotion', source: 'act' | 'tool' | 'devtools', emotion: PerformanceEmotion, nominal: number, turnId?: string, settings: ExpressionPerformanceSettings }
  /** The model named an entry. The performer read the entry's lease and its primary emotion mapping from its catalog. */
    | { kind: 'expression-request', source: 'act' | 'tool', entryId: string, lease: { holdSeconds: number, until: 'speech' | 'hold' }, mapping: { emotion: PerformanceEmotion, minBand: Band } | null, turnId?: string, settings: ExpressionPerformanceSettings }
    | { kind: 'expression-clear', source: 'act' | 'tool' | 'devtools', slot?: SlotCommand['slot'], turnId?: string }
  /** What became of a `speak` intent, named by its `turnId`. `refused` means another unprompted turn was pending. */
    | { kind: 'voice-outcome', turnId: string, outcome: GateOutcome | 'refused' }
  /** Every gate interval in the leader, and from devtools "Evaluate now" (`forceTiming`). */
    | { kind: 'voice-tick', view: VoiceView, forceTiming: boolean }
  /** The user sent a turn of their own. */
    | { kind: 'user-turn', atMs: number }
  /** A forced widget or plugin turn spoke outside the mind. */
    | { kind: 'external-speech', atMs: number }
  /** `away` changed, or a desktop wake appeared. `wake` names the newer of a new unlock and resume time. */
    | { kind: 'presence', away: boolean, wake: { cause: WakeCause, atMs: number } | null }
  /** The screen changed sharply. The mind keeps the refractory. */
    | { kind: 'screen-change' }

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
    | (IntentBase & { channel: 'face', kind: 'moment', moment: 'poked' | 'petted' | 'welcome-back' })
  /** End idle sleep gently. The performer does nothing when she is not asleep. */
    | (IntentBase & { channel: 'posture', kind: 'wake' })
  /** A brief reaction to the desktop: a `wake` also rouses her from idle sleep with a startle. */
    | (IntentBase & { channel: 'posture', kind: 'desktop-reaction', reaction: 'wake' | 'screen-change' })
  /** Speak one line. Its outcome returns as a `voice-outcome` stimulus with the same `turnId`. */
    | (IntentBase & { channel: 'voice', kind: 'speak', turnId: string, line: VoiceLine })
  /** Tell the voice channel of a desktop wake. `wakeCause` names the wake (`cause` is the stimulus's sequence number). `awayMs` is the open span at the wake, or null when no span was open. */
    | (IntentBase & { channel: 'voice', kind: 'observe-wake', wakeCause: WakeCause, atMs: number, awayMs: number | null })
  /** Tell the voice channel of a return. The gate decides whether she says anything. */
    | (IntentBase & { channel: 'voice', kind: 'observe-return', atMs: number, awayMs: number })

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
  voice: MindVoiceState
  /** The away span the mind is in, or the last presence it saw; `awaySinceMs` is null while she is not away. */
  presence: { away: boolean, awaySinceMs: number | null }
  /** When the last screen-change reaction was stamped, in epoch milliseconds. */
  desktop: { screenReactAtMs: number | null }
}

/** The line on its way, from its `speak` intent until its `voice-outcome`. */
export interface VoiceLineState {
  turnId: string
  kind: VoiceLine['kind']
  /** The gate fields a refused reach-out restores. Null for a touch line. */
  before: Pick<UrgeGateMemory, 'lastFireAtMs' | 'fires' | 'pending' | 'urge' | 'urgeThreshold' | 'doubleText'> | null
}

export interface MindVoiceState {
  /** Pacing of spoken touch reactions (CM1). */
  reaction: ReactionMemory
  /** The last decision about a touch line; null until a touch with a voice view arrives. */
  lastDecision: ReactionDecision | null
  /** The gate's memory; null until the first tick. */
  gate: UrgeGateMemory | null
  /** The run the gate memory belongs to; null until the first tick. */
  runId: number | null
  /** Whether the stage was shown at the last evaluated tick; a shown edge eases her in again. */
  stageShown: boolean
  /** The line on its way. One at a time, as chat runs one unprompted turn at a time. */
  line: VoiceLineState | null
  /** The last gate decision, for the inspector and QA. */
  lastGate: UrgeGateDecision | null
}
