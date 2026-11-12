import type { GenericSchema } from 'valibot'

import { array, finite, integer, literal, maxLength, maxValue, minLength, minValue, nullable, number, picklist, pipe, strictObject, string, variant } from 'valibot'

import { CHARACTER_STATE_SETTINGS } from './settings'

const time = pipe(number(), finite())
const count = pipe(number(), integer(), minValue(0))
const id = pipe(string(), minLength(1))
const reason = pipe(string(), maxLength(CHARACTER_STATE_SETTINGS.rendering.reasons.maxChars))
const signedUnit = pipe(number(), finite(), minValue(-1), maxValue(1))
const unit = pipe(number(), finite(), minValue(0), maxValue(1))
const rawDelta = pipe(number(), finite(), minValue(-CHARACTER_STATE_SETTINGS.mood.headroom), maxValue(CHARACTER_STATE_SETTINGS.mood.headroom))
const points = pipe(number(), finite(), minValue(0))
const finiteSum = pipe(number(), finite())

/** A mood value. Valence and energy lie in [-1, 1], tension in [0, 1]. */
export interface MoodAxes {
  readonly valence: number
  readonly energy: number
  readonly tension: number
}

export const MoodAxesSchema = strictObject({ valence: signedUnit, energy: signedUnit, tension: unit }) satisfies GenericSchema<unknown, MoodAxes>

/** A step on the raw (pre-squash) mood scale; each axis stays within the headroom rail. */
const MoodDeltaSchema = strictObject({ valence: rawDelta, energy: rawDelta, tension: rawDelta }) satisfies GenericSchema<unknown, MoodAxes>

export type MoodSource = 'model-cue' | 'touch' | 'reach-out-unanswered' | 'reply' | 'return' | 'significant' | 'ritual'

export const MOOD_SOURCES = ['model-cue', 'touch', 'reach-out-unanswered', 'reply', 'return', 'significant', 'ritual'] as const satisfies readonly MoodSource[]

/**
 * One decaying push on the mood. Its remaining weight is `2^(-(t - atMs) / halfLifeMs)` for `atMs <= t < expiresAtMs`
 * and 0 otherwise; `expiresAtMs` is where the largest remaining delta falls below the mood epsilon.
 */
export interface MoodContribution {
  /** The id of the event that produced it; inserting the same id twice is a no-op. */
  readonly id: string
  readonly source: MoodSource
  /** Short English reason the prompt may show, at most 60 characters. */
  readonly reason: string
  readonly atMs: number
  readonly halfLifeMs: number
  /** The step actually applied, after budgets and headroom. */
  readonly delta: MoodAxes
  readonly expiresAtMs: number
}

export const MoodContributionSchema = strictObject({
  id,
  source: picklist(MOOD_SOURCES),
  reason,
  atMs: time,
  halfLifeMs: pipe(number(), finite(), minValue(1)),
  delta: MoodDeltaSchema,
  expiresAtMs: time,
}) satisfies GenericSchema<unknown, MoodContribution>

export type ClosenessStage = 'stranger' | 'friendly' | 'close' | 'intimate'
export type TrustStage = 'guarded' | 'open' | 'confiding'
export type FamiliarityStage = 'new' | 'knows-you'
export type StartingStage = 'stranger' | 'friendly' | 'close'

export const CLOSENESS_STAGES = ['stranger', 'friendly', 'close', 'intimate'] as const satisfies readonly ClosenessStage[]
export const TRUST_STAGES = ['guarded', 'open', 'confiding'] as const satisfies readonly TrustStage[]
export const FAMILIARITY_STAGES = ['new', 'knows-you'] as const satisfies readonly FamiliarityStage[]

/** The resting disposition and starting relationship a character card sets. */
export interface CharacterProfile {
  /** The mood temperament is anchored to. */
  readonly resting: MoodAxes
  readonly startingStage: StartingStage
}

export const CharacterProfileSchema = strictObject({
  resting: MoodAxesSchema,
  startingStage: picklist(['stranger', 'friendly', 'close']),
}) satisfies GenericSchema<unknown, CharacterProfile>

export const DEFAULT_CHARACTER_PROFILE: CharacterProfile = Object.freeze({
  resting: Object.freeze({ valence: 0.1, energy: 0, tension: 0.15 }),
  startingStage: 'stranger',
})

/** Relationship levels, each in [0, 1]. */
export interface RelationshipLevels {
  readonly closeness: number
  readonly trust: number
  readonly familiarity: number
}

export const RelationshipLevelsSchema = strictObject({ closeness: unit, trust: unit, familiarity: unit }) satisfies GenericSchema<unknown, RelationshipLevels>

/** Points gathered per dimension during one logical day; non-negative and unbounded, fed through `E(S)`. */
export type RelationshipPoints = RelationshipLevels

const RelationshipPointsSchema = strictObject({ closeness: points, trust: points, familiarity: points }) satisfies GenericSchema<unknown, RelationshipPoints>

export interface RelationshipStages {
  readonly closeness: ClosenessStage
  readonly trust: TrustStage
  readonly familiarity: FamiliarityStage
}

export const RelationshipStagesSchema = strictObject({
  closeness: picklist(CLOSENESS_STAGES),
  trust: picklist(TRUST_STAGES),
  familiarity: picklist(FAMILIARITY_STAGES),
}) satisfies GenericSchema<unknown, RelationshipStages>

/** The highest stage a level qualified for since the last rollover, or `null`; the rollover moves one step toward it. */
export interface PendingStageUps {
  readonly closeness: ClosenessStage | null
  readonly trust: TrustStage | null
  readonly familiarity: FamiliarityStage | null
}

/** Per logical day bookkeeping of the relationship layer. */
export interface RelationshipDay {
  readonly key: string
  readonly sums: RelationshipPoints
  /** Negative events applied today; more than the daily cap are ignored. */
  readonly negatives: number
  readonly milestones: number
  /** Unwelcome touch bursts today; the persistent one costs trust. */
  readonly unwelcomeTouches: number
  /** Epoch-hour starts whose pleasant touch already earned points. */
  readonly countedTouchHours: readonly number[]
}

export interface RelationshipState {
  readonly levels: RelationshipLevels
  readonly stages: RelationshipStages
  /** Damps trust gains by `(1 - wound)`; decays with its own half-life from `woundAtMs`. */
  readonly wound: number
  readonly woundAtMs: number
  readonly day: RelationshipDay
  /** Logical days with at least one first real exchange. */
  readonly activeDays: number
  /** Long-term memory ids of shared milestones, oldest first, newest 64 kept. */
  readonly milestoneIds: readonly string[]
  readonly lastSeenAtMs: number | null
  /** The logical day the last rollover processed. */
  readonly lastDayKey: string
  readonly pendingStageUps: PendingStageUps
}

const RelationshipStateSchema = strictObject({
  levels: RelationshipLevelsSchema,
  stages: RelationshipStagesSchema,
  wound: unit,
  woundAtMs: time,
  day: strictObject({
    key: string(),
    sums: RelationshipPointsSchema,
    negatives: count,
    milestones: count,
    unwelcomeTouches: count,
    // A logical day has at most 25 hours (a daylight saving change).
    countedTouchHours: pipe(array(time), maxLength(25)),
  }),
  activeDays: count,
  milestoneIds: pipe(array(id), maxLength(CHARACTER_STATE_SETTINGS.relationship.maxMilestoneIds)),
  lastSeenAtMs: nullable(time),
  lastDayKey: string(),
  pendingStageUps: strictObject({
    closeness: nullable(picklist(CLOSENESS_STAGES)),
    trust: nullable(picklist(TRUST_STAGES)),
    familiarity: nullable(picklist(FAMILIARITY_STAGES)),
  }),
}) satisfies GenericSchema<unknown, RelationshipState>

/** One completed logical day, appended at its rollover. */
export interface DailySummary {
  readonly dayKey: string
  /** Mean mood over the day. */
  readonly mood: MoodAxes
  readonly temperament: MoodAxes
  readonly levels: RelationshipLevels
  readonly stages: RelationshipStages
}

export const DailySummarySchema = strictObject({
  dayKey: string(),
  mood: MoodAxesSchema,
  temperament: MoodAxesSchema,
  levels: RelationshipLevelsSchema,
  stages: RelationshipStagesSchema,
}) satisfies GenericSchema<unknown, DailySummary>

export interface ModelCueLogEntry {
  readonly atMs: number
  /** The step accepted for this cue, used by the rolling budget. */
  readonly delta: MoodAxes
}

export interface MoodState {
  readonly contributions: readonly MoodContribution[]
  readonly modelCueLog: readonly ModelCueLogEntry[]
}

/**
 * Hourly mood samples (taken at `h + 30 min` of each completed epoch hour) of the logical day `key`, so the day's
 * mean mood survives pruning. Initial value: `{ key: logicalDayKeyOf(throughHourMs + 30 min), sum: 0 on every axis,
 * samples: 0 }`.
 */
export interface TemperamentDay {
  readonly key: string
  /** Per-axis sum of the samples; not a mood value, so not range-limited. */
  readonly sum: MoodAxes
  readonly samples: number
}

export const TemperamentDaySchema = strictObject({
  key: string(),
  sum: strictObject({ valence: finiteSum, energy: finiteSum, tension: finiteSum }),
  samples: count,
}) satisfies GenericSchema<unknown, TemperamentDay>

export interface TemperamentState {
  readonly axes: MoodAxes
  /** Start of the first epoch hour not yet processed. */
  readonly throughHourMs: number
  readonly day: TemperamentDay
}

/** Upper bound of {@link AppliedEvents.recent}. */
export const MAX_APPLIED_EVENT_IDS = 256

export interface AppliedEventRef {
  readonly id: string
  readonly atMs: number
}

/**
 * Ids of recently applied events, so replaying an event is a no-op even after the mood refused or pruned its
 * contribution. Events at or before `evictedThroughMs`, the newest `atMs` that left the bounded ring, are rejected,
 * because their id may no longer be listed.
 */
export interface AppliedEvents {
  /** Oldest first, newest {@link MAX_APPLIED_EVENT_IDS} kept. */
  readonly recent: readonly AppliedEventRef[]
  readonly evictedThroughMs: number | null
}

/**
 * The stored state of one character card. Plain JSON; tuning constants live in {@link CHARACTER_STATE_SETTINGS} and
 * are never copied here.
 */
export interface CharacterStateRecordV1 {
  readonly version: 1
  readonly cardId: string
  readonly createdAtMs: number
  readonly updatedAtMs: number
  /** The last user turn, touch, or character speech; `null` before any. Damps the face baseline. */
  readonly lastInteractionAtMs: number | null
  readonly mood: MoodState
  readonly temperament: TemperamentState
  readonly relationship: RelationshipState
  /** Newest 400 kept, oldest first. */
  readonly history: readonly DailySummary[]
  readonly appliedEvents: AppliedEvents
}

/**
 * Strict schema of a stored record. Its `entries` hold one schema per top-level field, so a reader can validate each
 * field on its own and reset only the invalid ones.
 */
export const CharacterStateRecordSchema = strictObject({
  version: literal(1),
  cardId: id,
  createdAtMs: time,
  updatedAtMs: time,
  lastInteractionAtMs: nullable(time),
  mood: strictObject({
    contributions: pipe(array(MoodContributionSchema), maxLength(CHARACTER_STATE_SETTINGS.mood.maxContributions)),
    modelCueLog: pipe(array(strictObject({ atMs: time, delta: MoodDeltaSchema })), maxLength(CHARACTER_STATE_SETTINGS.mood.modelCue.maxLogEntries)),
  }),
  temperament: strictObject({ axes: MoodAxesSchema, throughHourMs: time, day: TemperamentDaySchema }),
  relationship: RelationshipStateSchema,
  history: pipe(array(DailySummarySchema), maxLength(CHARACTER_STATE_SETTINGS.history.maxRows)),
  appliedEvents: strictObject({
    recent: pipe(array(strictObject({ id, atMs: time })), maxLength(MAX_APPLIED_EVENT_IDS)),
    evictedThroughMs: nullable(time),
  }),
}) satisfies GenericSchema<unknown, CharacterStateRecordV1>

/** Direction of one axis in a model cue. */
export type CueDirection = -1 | 0 | 1

export interface CueDirections {
  readonly valence: CueDirection
  readonly energy: CueDirection
  readonly tension: CueDirection
}

const direction = picklist([-1, 0, 1])

const base = { id, atMs: time }

/**
 * One input to the character state. `id` is derived from the source (turn id, touch event id, extraction ledger id)
 * so replaying an event is a no-op.
 */
export type CharacterEvent
  /** A `<|MOOD ...|>` cue the model wrote; one per turn. */
  = | { readonly kind: 'model-cue', readonly id: string, readonly atMs: number, readonly turnId: string, readonly directions: CueDirections, readonly reason: string }
    | { readonly kind: 'touch-pleasant', readonly id: string, readonly atMs: number }
    /** One unwelcome poke burst; the third of a logical day also costs trust. */
    | { readonly kind: 'touch-unwelcome', readonly id: string, readonly atMs: number }
    /** A reach-out that got no reply in time; `consecutive` counts unanswered reach-outs in a row. */
    | { readonly kind: 'reach-out-unanswered', readonly id: string, readonly atMs: number, readonly consecutive: 1 | 2 }
    /** A user reply after an unanswered reach-out; the unanswered contribution stays. */
    | { readonly kind: 'late-reply', readonly id: string, readonly atMs: number }
    /** A user reply within the reply window of a reach-out. */
    | { readonly kind: 'reach-out-reply', readonly id: string, readonly atMs: number }
    | { readonly kind: 'return', readonly id: string, readonly atMs: number, readonly gapMs: number }
    | { readonly kind: 'ritual-reciprocated', readonly id: string, readonly atMs: number }
    /** A user turn; `first-real` is the third user turn of the logical day, `early` the two before it. */
    | { readonly kind: 'user-turn', readonly id: string, readonly atMs: number, readonly exchange: 'early' | 'first-real' | 'later' }
    | { readonly kind: 'character-spoke', readonly id: string, readonly atMs: number }
    | { readonly kind: 'disclosure', readonly id: string, readonly atMs: number, readonly reason: string }
    | { readonly kind: 'kept-promise', readonly id: string, readonly atMs: number, readonly reason: string }
    /** A shared milestone stored as the long-term memory entry `memoryId`. */
    | { readonly kind: 'milestone', readonly id: string, readonly atMs: number, readonly reason: string, readonly memoryId: string }
    | { readonly kind: 'significant-positive', readonly id: string, readonly atMs: number, readonly reason: string }
    | { readonly kind: 'significant-negative', readonly id: string, readonly atMs: number, readonly reason: string }
    | { readonly kind: 'unkind', readonly id: string, readonly atMs: number, readonly reason: string }
    /** Hurts both trust and, as a significant negative, mood. */
    | { readonly kind: 'hurtful', readonly id: string, readonly atMs: number, readonly reason: string }

export type CharacterEventKind = CharacterEvent['kind']

export const CharacterEventSchema = variant('kind', [
  strictObject({ kind: literal('model-cue'), ...base, turnId: id, directions: strictObject({ valence: direction, energy: direction, tension: direction }), reason }),
  strictObject({ kind: literal('touch-pleasant'), ...base }),
  strictObject({ kind: literal('touch-unwelcome'), ...base }),
  strictObject({ kind: literal('reach-out-unanswered'), ...base, consecutive: picklist([1, 2]) }),
  strictObject({ kind: literal('late-reply'), ...base }),
  strictObject({ kind: literal('reach-out-reply'), ...base }),
  strictObject({ kind: literal('return'), ...base, gapMs: pipe(number(), finite(), minValue(0)) }),
  strictObject({ kind: literal('ritual-reciprocated'), ...base }),
  strictObject({ kind: literal('user-turn'), ...base, exchange: picklist(['early', 'first-real', 'later']) }),
  strictObject({ kind: literal('character-spoke'), ...base }),
  strictObject({ kind: literal('disclosure'), ...base, reason }),
  strictObject({ kind: literal('kept-promise'), ...base, reason }),
  strictObject({ kind: literal('milestone'), ...base, reason, memoryId: id }),
  strictObject({ kind: literal('significant-positive'), ...base, reason }),
  strictObject({ kind: literal('significant-negative'), ...base, reason }),
  strictObject({ kind: literal('unkind'), ...base, reason }),
  strictObject({ kind: literal('hurtful'), ...base, reason }),
]) satisfies GenericSchema<unknown, CharacterEvent>

export type ValenceBucket = 'upset' | 'low' | 'even' | 'good' | 'bright'
export type EnergyBucket = 'drained' | 'tired' | 'steady' | 'lively' | 'buzzing'
export type TensionBucket = 'relaxed' | 'a little on edge' | 'tense'

export interface MoodBuckets {
  readonly valence: ValenceBucket
  readonly energy: EnergyBucket
  readonly tension: TensionBucket
}

export type Unlock = 'teasing' | 'nicknames' | 'initiative' | 'vulnerability' | 'callbacks'

export interface CharacterReason {
  /** The contribution id. */
  readonly id: string
  readonly text: string
  readonly atMs: number
}

/**
 * What the rest of the app reads: the prompt text, the face baseline, and the reach-out factor derive from it. It is
 * replicated across windows, so it is plain JSON.
 */
export interface CharacterReading {
  readonly mood: MoodAxes
  readonly resting: MoodAxes
  readonly temperament: MoodAxes
  readonly buckets: MoodBuckets
  /** At most two, ordered by `atMs`. */
  readonly reasons: readonly CharacterReason[]
  readonly levels: RelationshipLevels
  readonly stages: RelationshipStages
  readonly unlocks: readonly Unlock[]
  /** Multiplier of the reach-out open hazard, in [0.67, 1.35]. */
  readonly urgeFactor: number
  /** Whether an unprompted turn should say one plain thing about how she feels. */
  readonly pointed: boolean
  readonly lastInteractionAtMs: number | null
  /** Changes exactly when the rendered character text changes. */
  readonly renderKey: string
}

/**
 * Resting-face offsets for the Natural driver; every field is neutral at 0. Mirrors the driver's face baseline input
 * structurally, because this package does not depend on the driver.
 */
export interface FaceBaseline {
  readonly mouthForm: number
  /** Eye openness multiplier offset; the driver applies `1 + eyeOpen`. */
  readonly eyeOpen: number
  /** The driver scales the blink interval by `1 / (1 + blinkRateOffset)`. */
  readonly blinkRateOffset: number
  readonly browAngle: number
}

/**
 * What shapes self-directed idle behaviour, derived from the slower state. Mirrors the first five fields of the Natural
 * driver's idle drive structurally, because this package does not depend on the driver; the host adds the desktop
 * fields (music, sleep ownership, pace).
 */
export interface IdleDrive {
  /** Mood energy relative to the resting disposition, in [-1, 1]. */
  readonly energy: number
  /** Mood valence relative to the resting disposition, in [-1, 1]. */
  readonly valence: number
  /** Mood tension relative to the resting disposition, in [-1, 1]. */
  readonly tension: number
  /** 0 during her day, 1 deep in her night. */
  readonly sleepiness: number
  /** 0 right after an interaction, toward 1 after a long time without one. */
  readonly solitude: number
}

/**
 * Time inputs of every pure call, so the core never reads a clock or a time zone. The logical day rolls over at
 * 04:00 in the host's chosen zone.
 */
export interface AdvanceContext {
  readonly nowMs: number
  logicalDayKeyOf: (ms: number) => string
  /** Epoch ms of the start (rollover instant) of the logical day containing `ms`. */
  logicalDayStartOf: (ms: number) => number
}
