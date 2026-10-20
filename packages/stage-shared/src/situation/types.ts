/**
 * Coarse kind of the foreground application. The window-title helpers derive it
 * from the executable; other producers (plugins, Minecraft) may also use `work`.
 */
export type AppCategory = 'game' | 'browser' | 'editor' | 'media' | 'chat' | 'call' | 'work' | 'other'

/**
 * Whether the user is at the desk.
 *
 * - `here`: recent input.
 * - `idle`: no input for a while, but the session is open.
 * - `away`: locked, suspended, or idle for minutes.
 * - `unknown`: the host cannot tell, or its last sample is too old (`stale`).
 */
export type PresenceState = 'here' | 'idle' | 'away' | 'unknown'

/** Why the presence state was chosen. `stale` pairs with `unknown` when samples stopped arriving. */
export type PresenceReason = 'locked' | 'suspended' | 'idle' | 'stale'

/**
 * Whether the user accepts an unprompted remark right now, as reported by the host.
 * `unknown` means the host cannot measure it (web hosts, unsupported platforms).
 */
export type BusyState = 'accepts' | 'busy' | 'fullscreen' | 'presentation' | 'quiet' | 'unknown'

/** How soon a notify observation wants attention. */
export type NotifyUrgency = 'immediate' | 'soon' | 'later'

export interface PresenceObservation {
  readonly kind: 'presence'
  readonly state: PresenceState
  readonly reason?: PresenceReason
  readonly atMs: number
}

export interface WakeObservation {
  readonly kind: 'wake'
  readonly cause: 'unlock' | 'resume'
  readonly atMs: number
}

export interface ActivityObservation {
  readonly kind: 'activity'
  /** Stable id from {@link appIdFromExe}. */
  readonly appId: string
  /** Display name from {@link labelFromExe}. */
  readonly label: string
  readonly category: AppCategory
  /** Normalized window title, or `null` when it is empty or denylisted. */
  readonly title: string | null
  readonly atMs: number
}

export interface ConversationObservation {
  readonly kind: 'conversation'
  readonly who: 'user' | 'character'
  /** `unprompted` marks a character turn the character started on its own. */
  readonly origin: 'user' | 'unprompted'
  readonly atMs: number
}

/**
 * Free-form context from one source (vision, Minecraft, plugins). A newer
 * observation from the same `sourceKey` replaces the previous one.
 */
export interface ContextObservation {
  readonly kind: 'context'
  readonly sourceKey: string
  readonly text: string
  readonly atMs: number
  /** Overrides {@link BASE_SALIENCE} for this observation, 0..1. */
  readonly salience?: number
}

/**
 * A notification from a plugin or the scheduler. Its topic key is
 * {@link notifyTopicKey}(`sourceKey`, `eventId`); nothing else builds it.
 */
export interface NotifyObservation {
  readonly kind: 'notify'
  readonly sourceKey: string
  /** Protocol event id, stable across re-enqueued reminders. */
  readonly eventId: string
  readonly headline: string
  readonly note?: string
  readonly urgency: NotifyUrgency
  readonly reminder: boolean
  /** Set only for scheduler reminders whose priority is `critical`. */
  readonly critical: boolean
  readonly atMs: number
}

/** What the stage currently shows: exposed and active performance slots and the mood line. */
export interface StageObservation {
  readonly kind: 'stage'
  readonly exposed: string
  readonly active: string
  readonly mood: string
  readonly atMs: number
}

export interface BusyObservation {
  readonly kind: 'busy'
  readonly state: BusyState
  readonly atMs: number
}

/** One input to the situation reducer. Every variant is JSON-serializable. */
export type Observation
  = | PresenceObservation
    | WakeObservation
    | ActivityObservation
    | ConversationObservation
    | ContextObservation
    | NotifyObservation
    | StageObservation
    | BusyObservation

/** Kinds of events the reducer derives from observations. */
export type SituationEventKind
  = | 'app-switch'
    | 'long-session'
    | 'returned'
    | 'went-away'
    | 'wake'
    | 'switching-burst'
    | 'context'
    | 'notify'

/**
 * Something worth mentioning. Salience decays with `halfLifeMs` from `atMs`.
 * `origin: 'self'` marks events caused by AIRI's own windows or turns.
 */
export interface SituationEvent {
  readonly id: string
  readonly kind: SituationEventKind
  readonly topicKey: string
  readonly text: string
  readonly atMs: number
  /** Starting salience, 0..1. */
  readonly salience: number
  readonly halfLifeMs: number
  /** Long-session tier (1 for the first threshold); 0 for kinds without tiers. */
  readonly tier: number
  readonly origin: 'world' | 'self'
  /** When the event was first rendered into a prompt, or `null` if never. */
  readonly shownAtMs: number | null
  /** When the character spoke about the event's topic, or `null` if never. */
  readonly addressedAtMs: number | null
}

export interface SituationActivity {
  readonly appId: string
  readonly label: string
  readonly category: AppCategory
  readonly title: string | null
  /** When this app became the foreground app. */
  readonly sinceMs: number
}

/** A previous foreground app, newest first in {@link SituationState.recentActivities}. */
export interface SituationRecentActivity {
  readonly appId: string
  readonly label: string
  readonly category: AppCategory
  readonly sinceMs: number
  readonly endedAtMs: number
}

export interface SituationPresence {
  readonly state: PresenceState
  readonly reason: PresenceReason | null
  /** When `state` was entered, or `null` before the first presence observation. */
  readonly sinceMs: number | null
}

export interface SituationConversation {
  readonly lastUserAtMs: number | null
  readonly lastCharacterAtMs: number | null
  readonly lastUnpromptedAtMs: number | null
  /**
   * Text of the topic of the character's last spoken unprompted turn, or `null` if none or unknown. It changes only
   * when such a turn is spoken, so the prompt of a new unprompted turn still names the previous remark.
   */
  readonly lastUnpromptedTopic: string | null
}

export interface SituationContext {
  readonly text: string
  readonly atMs: number
}

export interface SituationStage {
  readonly exposed: string
  readonly active: string
  readonly mood: string
  readonly atMs: number
}

export interface SituationBusy {
  readonly state: BusyState
  /** When the host last reported it, or `null` before any report. */
  readonly atMs: number | null
}

/**
 * Bookkeeping the reducer needs between calls: settle, tier and burst progress,
 * and stale-observation guards. Plain JSON.
 */
export interface SituationTracking {
  readonly presenceAtMs: number | null
  readonly awaySinceMs: number | null
  /** `awaySinceMs` of the away span whose `went-away` event exists. */
  readonly awayNotedSinceMs: number | null
  /** Text of the topic last addressed by `markAddressed`; it becomes `lastUnpromptedTopic` when her unprompted turn is spoken. */
  readonly addressedTopic: string | null
  readonly activityAtMs: number | null
  /** `sinceMs` of the foreground span whose settle check is done. */
  readonly settledSinceMs: number | null
  readonly tierSinceMs: number | null
  readonly tierDone: number
  readonly switchTimes: readonly number[]
  readonly burstActive: boolean
}

/**
 * Everything the character knows about the user's situation. Plain data: the
 * reducer returns a new value per observation and the store can persist or
 * sync it as JSON.
 */
export interface SituationState {
  readonly presence: SituationPresence
  readonly activity: SituationActivity | null
  /** At most {@link RECENT_ACTIVITIES_MAX} entries, newest first. */
  readonly recentActivities: readonly SituationRecentActivity[]
  readonly conversation: SituationConversation
  /** Latest context per `sourceKey`. */
  readonly contexts: Readonly<Record<string, SituationContext>>
  readonly stage: SituationStage | null
  readonly busy: SituationBusy
  /** Ring of at most {@link SITUATION_EVENTS_MAX} events, oldest first. */
  readonly events: readonly SituationEvent[]
  /** The largest `nowMs` seen, or `null` before the first update. Time never runs backwards. */
  readonly nowMs: number | null
  /** Reducer bookkeeping; not for rendering. */
  readonly tracking: SituationTracking
}

/** Length cap of {@link SituationState.recentActivities}. */
export const RECENT_ACTIVITIES_MAX = 5
/** Length cap of {@link SituationState.events}. */
export const SITUATION_EVENTS_MAX = 32

export const initialSituationState: SituationState = Object.freeze({
  presence: Object.freeze({ state: 'unknown', reason: null, sinceMs: null }),
  activity: null,
  recentActivities: Object.freeze([]),
  conversation: Object.freeze({ lastUserAtMs: null, lastCharacterAtMs: null, lastUnpromptedAtMs: null, lastUnpromptedTopic: null }),
  contexts: Object.freeze({}),
  stage: null,
  busy: Object.freeze({ state: 'unknown', atMs: null }),
  events: Object.freeze([]),
  nowMs: null,
  tracking: Object.freeze({
    presenceAtMs: null,
    awaySinceMs: null,
    awayNotedSinceMs: null,
    addressedTopic: null,
    activityAtMs: null,
    settledSinceMs: null,
    tierSinceMs: null,
    tierDone: 0,
    switchTimes: Object.freeze([]),
    burstActive: false,
  }),
})

/**
 * Keys of {@link BASE_SALIENCE} and {@link HALF_LIFE_MS}. Kinds whose weight
 * depends on the observation have variants: `context-vision` for the `vision`
 * source, `notify-<urgency>`, and `notify-critical` for critical reminders.
 */
export type SalienceKey
  = | Exclude<SituationEventKind, 'notify'>
    | 'context-vision'
    | `notify-${NotifyUrgency}`
    | 'notify-critical'

// Every salience and half-life below is a starting value that has not been
// measured against real sessions. Tune them with the devtools situation panel.

/**
 * Starting salience per event key, 0..1.
 *
 * Tuning: raise a value to make the character bring the topic up sooner; lower
 * it if the character comments on that kind of event too often. `long-session`
 * is the first tier; later tiers add {@link LONG_SESSION_SALIENCE_STEP}.
 */
export const BASE_SALIENCE: Readonly<Record<SalienceKey, number>> = Object.freeze({
  'app-switch': 0.5,
  'long-session': 0.6,
  'returned': 0.6,
  'went-away': 0.2,
  'wake': 0.5,
  'switching-burst': 0.35,
  'context': 0.3,
  'context-vision': 0.4,
  'notify-immediate': 1.0,
  'notify-soon': 0.7,
  'notify-later': 0.4,
  'notify-critical': 1.0,
})

const MINUTE_MS = 60_000

/**
 * Half-life of salience per event key.
 *
 * Tuning: lengthen a value if the character forgets a topic before it gets a
 * chance to speak; shorten it if it brings up stale news.
 */
export const HALF_LIFE_MS: Readonly<Record<SalienceKey, number>> = Object.freeze({
  'app-switch': 20 * MINUTE_MS,
  'long-session': 30 * MINUTE_MS,
  'returned': 15 * MINUTE_MS,
  'went-away': 10 * MINUTE_MS,
  'wake': 10 * MINUTE_MS,
  'switching-burst': 10 * MINUTE_MS,
  'context': 30 * MINUTE_MS,
  'context-vision': 30 * MINUTE_MS,
  'notify-immediate': 10 * MINUTE_MS,
  'notify-soon': 30 * MINUTE_MS,
  'notify-later': 60 * MINUTE_MS,
  'notify-critical': 30 * MINUTE_MS,
})

/** Salience added per long-session tier above the first. Tuning: raise if late tiers go unmentioned. */
export const LONG_SESSION_SALIENCE_STEP = 0.05
/** Ceiling for long-session salience. Tuning: keep below notify salience so reminders win. */
export const LONG_SESSION_SALIENCE_MAX = 0.75

/** Treats NaN and infinities as an unknown value instead of a number. */
function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null
}

/**
 * Starting salience of a long-session event at `tier` (1 for the first
 * threshold). Tiers below 1 or non-finite tiers count as the first tier.
 */
export function longSessionSalience(tier: number): number {
  const steps = Math.max(0, Math.floor(finiteOrNull(tier) ?? 1) - 1)
  return Math.min(LONG_SESSION_SALIENCE_MAX, BASE_SALIENCE['long-session'] + steps * LONG_SESSION_SALIENCE_STEP)
}

/** Topic key of the foreground app `appId`, shared by its app-switch events. */
export function activityTopicKey(appId: string): string {
  return `activity:${appId}`
}

/** Topic key of the long-session event at `tier` for `appId`. */
export function activityTierTopicKey(appId: string, tier: number): string {
  return `activity:${appId}:tier:${tier}`
}

/** Topic key of the context from `sourceKey`. */
export function contextTopicKey(sourceKey: string): string {
  return `context:${sourceKey}`
}

/**
 * Topic key of a notify observation. This is the only builder of notify keys:
 * the reducer, the ingest path, and `markAddressed` callers all use it.
 */
export function notifyTopicKey(sourceKey: string, eventId: string): string {
  return `notify:${sourceKey}:${eventId}`
}

/** Topic key of the event emitted when the user returns after being away. */
export const PRESENCE_RETURN_TOPIC_KEY = 'presence:return'
/** Topic key of wake (unlock or resume) events. */
export const WAKE_TOPIC_KEY = 'wake'
