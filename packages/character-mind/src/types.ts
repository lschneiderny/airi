import type { IdleBehaviourKind } from '@proj-airi/motion-driver-natural/idle-activities'
import type { IdleErrandKind } from '@proj-airi/motion-driver-natural/idle-errands'
import type { IdleReport, IdleScheduleState, IdleView } from '@proj-airi/motion-driver-natural/idle-schedule'
import type { Band, ExpressionPerformanceSettings, HoldCommand, MoodDose, PerformanceEmotion, ReactionEpisode, ReactionState, SlotCommand, TouchAffectMemory } from '@proj-airi/stage-shared/expression-performance'
import type { CharacterPacingMemory, GateLocalTime, GateOutcome, GateSettings, GateSignals, ReactionDecision, ReactionKind, ReactionMemory, ReasonCategory, ReasonKind, ReasonState, SituationState, TouchVoiceView, UrgeGateDecision, UrgeGateMemory, UserGateMemory } from '@proj-airi/stage-shared/situation'

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
  /** A widget or plugin turn the mind let through. */
    | { kind: 'widget', topicKey: string, topicText: string, supplement: string | null }

export interface VoiceRun {
  /** The store bumps it at each promotion and at "Delete all data". A new id makes the mind restore its gate memory. */
  id: number
  /** The user's slice: from the last memory a mind published in this run, else the slice saved at promotion; null when nothing was saved or the user deleted all data. */
  user: UserGateMemory | null
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
  /** An unprompted turn the mind did not start is pending in chat. */
  unpromptedPending: boolean
}

/** A widget or plugin asks her to speak. */
export interface VoiceRequest {
  /** `spark:<notify id>`, the streaming-control turn id that CALL handlers listen to. */
  turnId: string
  topicKey: string
  topicText: string
  supplement: string | null
  /** The caller's wait. The mind cancels a line not spoken this long after the request. */
  timeoutMs: number
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
  /** A widget or plugin asks her to speak; the mind holds it until she and the user are quiet. */
    | { kind: 'voice-request', request: VoiceRequest, view: VoiceView }
  /** `away` changed, or a desktop wake appeared. `wake` names the newer of a new unlock and resume time. */
    | { kind: 'presence', away: boolean, wake: { cause: WakeCause, atMs: number } | null }
  /** The screen changed sharply. The mind keeps the refractory. */
    | { kind: 'screen-change' }
  /** What the reporting Natural performer saw in one frame that had an edge, in order. */
    | { kind: 'idle', reports: readonly IdleReport[] }
  /** The host's idle wake timer fired at `nextIdleWakeAt`. */
    | { kind: 'idle-wake' }
  /** The user or the devtools lab asks her to play an idle act now. */
    | { kind: 'idle-play', act: IdleBehaviourKind }

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
  /** Stop the turn of a widget line not spoken before its caller's deadline. */
    | (IntentBase & { channel: 'voice', kind: 'cancel', turnId: string })
  /** Give up a widget request that found no moment to start. Its caller gets `cancelled`. */
    | (IntentBase & { channel: 'voice', kind: 'drop', turnId: string })
  /** The body around a reach-out or widget line: `about-to-speak` before its `speak`, `let-go` when she declines it. Never for a touch line. */
    | (IntentBase & { channel: 'posture', kind: 'cue', cue: 'about-to-speak' | 'let-go' })
  /** Tell the voice channel of a desktop wake. `wakeCause` names the wake (`cause` is the stimulus's sequence number). `awayMs` is the open span at the wake, or null when no span was open. */
    | (IntentBase & { channel: 'voice', kind: 'observe-wake', wakeCause: WakeCause, atMs: number, awayMs: number | null })
  /** Tell the voice channel of a return. The gate decides whether she says anything. */
    | (IntentBase & { channel: 'voice', kind: 'observe-return', atMs: number, awayMs: number })
  /** Start an idle act whose shape the performer draws from `seed`. `requested` marks an `idle-play`; the performer answers with `started` or `refused`. */
    | (IntentBase & { channel: 'posture', kind: 'idle-act', act: IdleBehaviourKind, seed: number, requested: boolean })
  /** Start an idle errand. `pick` chooses among the realiser's candidates; `holdSeconds` is the pastime hold, null for other errands. */
    | (IntentBase & { channel: 'posture', kind: 'idle-errand', errand: IdleErrandKind, pick: number, holdSeconds: number | null })

/** The posture intent a scene performs for a touch. */
export type TouchReactionIntent = Extract<MindIntent, { kind: 'touch-reaction' }>
/** The intents a performer carries out as idle orders. */
export type MindIdleIntent = Extract<MindIntent, { kind: 'idle-act' | 'idle-errand' }>

/** The part of the mind's state that the leader saves in the active card's character-state record. */
export interface MindSlowState {
  /** Her pacing memory; null for a card she never spoke as, or after "Delete all data". */
  pacing: CharacterPacingMemory | null
}

/** Plain JSON. Everything but `slow` is fast state: it resets on launch and at a card switch. */
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
  idle: MindIdleState
  /** Saved by the host. The core keeps `slow.pacing` equal to her pacing in the gate memory and replaces the object only when a field changed. */
  slow: MindSlowState
}

/** The line on its way, from its `speak` intent until its `voice-outcome`. */
export interface VoiceLineState {
  turnId: string
  kind: VoiceLine['kind']
  /** The gate fields a refused reach-out restores. Null for other lines. */
  before: Pick<UrgeGateMemory, 'lastFireAtMs' | 'fires' | 'pending' | 'urge' | 'urgeThreshold' | 'doubleText'> | null
  /** When a widget line must have spoken, on the mind's clock; null for other lines. */
  speakBy: number | null
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
  /** Widget requests waiting for a quiet moment, oldest first. */
  requests: Array<{ request: VoiceRequest, startBy: number, speakBy: number }>
  /** The last gate decision, for the inspector and QA. */
  lastGate: UrgeGateDecision | null
}

/** The idle policy's memory. Plain JSON. */
export interface MindIdleState {
  /** The reporting performer's latest view, or null while no Natural performer has reported. */
  view: IdleView | null
  /** The mind's clock counted only while `view.active`: the idle schedule's time base, in seconds. */
  activeSeconds: number
  /** When `activeSeconds` was last advanced, in epoch milliseconds of the mind's clock; null before the first step. */
  atMs: number | null
  schedule: IdleScheduleState
  /** The intent decided and not yet reported `started` or `refused`; no new decision while one waits. */
  pending: string | null
  /** The behavior the performer last reported started, with its intent and its start in active seconds. */
  started: { seq: number, intentId: string | null, at: number } | null
  /**
   * The checkpoint of the idle policy's own stream, seeded by one draw of `rng` at the first idle stimulus; null
   * before it. Its own stream keeps the idle draws apart from how often the other channels draw.
   */
  random: number | null
}
