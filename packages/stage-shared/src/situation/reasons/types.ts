import type { SituationEventKind } from '../types'

export type ReasonCategory = 'open' | 'continuation' | 'ritual' | 'due' | 'double-text' | 'urgent'

export type ThreadKind = 'question' | 'event' | 'later' | 'topic'

export type RitualKind = 'greeting' | 'sign-off' | 'welcome-back'

export type RitualState = 'open' | 'done' | 'expired'

export type ReasonKind
  = | `thread-${ThreadKind}`
    | `ritual-${RitualKind}`
    | 'own-day'
    | 'continuation'
    | 'double-text'
    | 'long-session'
    | 'returned'
    | 'notify'

export interface Thread {
  readonly id: string
  readonly topicKey: `thread:${string}`
  readonly sessionId: string
  readonly kind: ThreadKind
  readonly summary: string
  readonly cue: string
  readonly bornAtMs: number
  readonly dueAtMs: number | null
  readonly raisedCount: number
  readonly lastRaisedAtMs: number | null
  readonly expiresAtMs: number
}

export interface ThreadState {
  readonly threads: readonly Thread[]
}

export interface RitualDay {
  readonly dayKey: string
  readonly firstPresentAtMs: number | null
  readonly lastAwayEndedAtMs: number | null
  readonly states: Readonly<Record<RitualKind, RitualState>>
  readonly windowOpenedAtMs: Readonly<Record<RitualKind, number | null>>
}

export interface ReasonState {
  readonly threads: ThreadState
  readonly rituals: RitualDay | null
}

export interface GateLocalTime {
  readonly dayKey: string
  readonly minuteOfDay: number
}

export interface Reason {
  readonly key: string
  readonly kind: ReasonKind
  readonly category: ReasonCategory
  readonly text: string
  readonly sourceEventId: string | null
  readonly ripeness: number
  readonly weight: number
  readonly urgent: boolean
  readonly dueAtMs: number | null
  readonly dueNow: boolean
}

/** Tuning: conversion from minutes to the explicit millisecond durations used by the tables. */
const MINUTE_MS = 60_000
/** Tuning: conversion from hours to the explicit millisecond durations used by the tables. */
const HOUR_MS = 60 * MINUTE_MS

export type ThreadTuning = Readonly<{
  salience: number
  minAgeMs: number | Readonly<{ defaultMs: number, dueAtMsOffsetMs: number }> | 'dueAtMs'
  riseMs: number
  halfLifeMs: number
  selectionWeight: number
}>

/** Tuning: shape when a conversation thread becomes ripe and how often it is selected. */
export const THREAD_TUNING: Readonly<Record<ThreadKind, ThreadTuning>> = Object.freeze({
  question: Object.freeze({ salience: 0.7, minAgeMs: 45 * MINUTE_MS, riseMs: 30 * MINUTE_MS, halfLifeMs: 4 * HOUR_MS, selectionWeight: 1.0 }),
  event: Object.freeze({ salience: 0.85, minAgeMs: Object.freeze({ defaultMs: 90 * MINUTE_MS, dueAtMsOffsetMs: 15 * MINUTE_MS }), riseMs: 20 * MINUTE_MS, halfLifeMs: 6 * HOUR_MS, selectionWeight: 1.2 }),
  later: Object.freeze({ salience: 0.8, minAgeMs: 'dueAtMs', riseMs: 10 * MINUTE_MS, halfLifeMs: 6 * HOUR_MS, selectionWeight: 1.2 }),
  topic: Object.freeze({ salience: 0.5, minAgeMs: 2 * HOUR_MS, riseMs: 60 * MINUTE_MS, halfLifeMs: 12 * HOUR_MS, selectionWeight: 0.8 }),
})

/** Tuning: starting salience for a character-initiated topic about her own day. */
export const OWN_DAY_SALIENCE = 0.35
/** Tuning: maximum own-day selection weight after recovery. */
export const OWN_DAY_WEIGHT_MAX = 0.6
/** Tuning: recovery half-life for own-day selection weight. */
export const OWN_DAY_RECOVERY_HALF_LIFE_MS = 90 * MINUTE_MS

/** Tuning: relative selection weights for eligible screen-event reasons. */
export const SCREEN_SELECTION_WEIGHT = Object.freeze({
  'long-session': 0.15,
  'returned': 0.25,
  'notify': 0.4,
} as const)

/** Tuning: only settled, returned, and explicitly notified world events may start a turn. */
export const GATE_ELIGIBLE_EVENT_KINDS: ReadonlySet<SituationEventKind> = Object.freeze(new Set<SituationEventKind>([
  'long-session',
  'returned',
  'notify',
]))

/** Tuning: tier 1 sessions are too brief to start an unprompted turn. */
export const LONG_SESSION_MIN_TIER = 2

export type RitualTuning = Readonly<{
  ratePerHour: number
  windowMs: number
  startMinute: number
  endMinute: number
}>

/** Tuning: probability rate and local-time window for each daily ritual. */
export const RITUAL_TUNING: Readonly<Record<RitualKind, RitualTuning>> = Object.freeze({
  'greeting': Object.freeze({ ratePerHour: 12, windowMs: 45 * MINUTE_MS, startMinute: 5 * 60, endMinute: 15 * 60 }),
  'sign-off': Object.freeze({ ratePerHour: 1.5, windowMs: 3 * HOUR_MS, startMinute: 22 * 60 + 30, endMinute: 90 }),
  'welcome-back': Object.freeze({ ratePerHour: 6, windowMs: 20 * MINUTE_MS, startMinute: 0, endMinute: 24 * 60 }),
})

/** Tuning: local hours before this point belong to the prior logical day. */
export const LOGICAL_DAY_ROLLOVER_HOUR = 4
/** Tuning: bound the number of retained conversation threads. */
export const THREADS_MAX = 24
/** Tuning: maximum extracted thread summary length. */
export const THREAD_SUMMARY_MAX_CHARS = 160
/** Tuning: maximum extracted thread cue length. */
export const THREAD_CUE_MAX_CHARS = 200
/** Tuning: minimum ripeness for a thread to enter reason selection. */
export const THREAD_MIN_RIPENESS = 0.15
/** Tuning: exponent makes selection favor ripe reasons without eliminating weaker ones. */
export const SELECTION_BETA = 2
export type ReasonTextKey
  = | 'own-day'
    | 'continuation'
    | 'double-text'
    | `ritual-${RitualKind}`

/** Tuning: concise, model-facing descriptions of the optional reason for reaching out. */
export const REASON_TEXT: Readonly<Record<ReasonTextKey, string>> = Object.freeze({
  'own-day': 'something from your own day, small and plausible for who you are',
  'continuation': 'a short follow-up to what you said a little while ago',
  'double-text': 'one more line that follows what you just sent',
  'ritual-greeting': 'saying good morning now that they are here',
  'ritual-sign-off': 'saying good night',
  'ritual-welcome-back': 'welcoming them back after they were away for a while',
})
