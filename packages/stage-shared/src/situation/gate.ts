import type { BusyState, SituationEventKind, SituationState } from './types'

import { effectiveSalience } from './reducer'
import { isDenylisted } from './window-title'

const SECOND_MS = 1000
const MINUTE_MS = 60_000

// Every number below is a starting value from the design (A12) that has not
// been measured against real sessions. Tune them with the devtools gate trace.

/**
 * Effective salience a topic needs at Chattiness 0. The threshold falls by
 * {@link GATE_THRESHOLD_SLOPE} per unit of Chattiness: `0.65 - 0.5c`.
 *
 * Tuning: raise it if the character brings up minor topics; lower it if it
 * stays silent through things worth mentioning.
 */
export const GATE_THRESHOLD_BASE = 0.65
/** Threshold drop per unit of Chattiness. Tuning: raise to let Chattiness matter more. */
export const GATE_THRESHOLD_SLOPE = 0.5

/**
 * Minimum minutes between two fires: `max(3, 20 * (1 - c))`, so 20 min at
 * Chattiness 0, 10 min at 0.5, and the floor from 0.85 up.
 *
 * Tuning: raise the span if she speaks up too often at the default Chattiness;
 * keep the floor high enough that a reply can finish before the next one.
 */
export const MIN_GAP_SPAN_MINUTES = 20
/** Lower bound of the minimum gap. Tuning: see {@link MIN_GAP_SPAN_MINUTES}. */
export const MIN_GAP_FLOOR_MINUTES = 3

/**
 * Fires allowed per {@link HOURLY_WINDOW_MS}: `round(1 + 6c)`, so 1 at
 * Chattiness 0, 4 at 0.5, and 7 at 1.
 *
 * Tuning: lower the slope if bursts of topics still feel like too much talk.
 */
export const HOURLY_CAP_BASE = 1
/** Extra fires per hour per unit of Chattiness. Tuning: see {@link HOURLY_CAP_BASE}. */
export const HOURLY_CAP_SLOPE = 6
/** Window of the hourly cap. A fire exactly this old no longer counts. */
export const HOURLY_WINDOW_MS = 60 * MINUTE_MS

/**
 * A user turn within this time means the two are already talking, so the
 * character does not start a new topic. Tuning: raise if she interrupts pauses
 * in a conversation.
 */
export const IN_EXCHANGE_MS = 120 * SECOND_MS

/**
 * A spoken fire that gets no user turn within this time counts as ignored.
 * A user turn exactly at the end of the window still counts as engagement.
 *
 * Tuning: raise if users answer slowly and the character backs off anyway.
 */
export const IGNORE_WINDOW_MS = 120 * SECOND_MS
/** Ignored fires (declines count {@link DECLINE_STREAK_WEIGHT}) that raise the backoff level by one. Tuning: raise to back off later. */
export const IGNORE_STREAK_LIMIT = 2
/** Streak added when the model declines a fire with `<|SILENT|>`. Tuning: raise if repeated declines should slow the gate sooner. */
export const DECLINE_STREAK_WEIGHT = 0.5
/** Highest backoff level; the gap is multiplied by `2^level`. Tuning: lower to cap the longest silence. */
export const BACKOFF_LEVEL_MAX = 3

/** Gap multiplier while the foreground app is a game. Tuning: raise if players find remarks distracting. */
export const GAME_GAP_MULTIPLIER = 2

/**
 * Starting salience from which a notify is urgent: it bypasses the timing
 * guards and the game suppressor, never the other hard suppressors. Matches
 * `notify-immediate` and `notify-critical` in `BASE_SALIENCE`.
 */
export const URGENT_SALIENCE = 1

/**
 * Live inputs the gate cannot read from the situation. Every flag fails
 * closed: anything other than the explicit "clear" value suppresses.
 */
export interface GateSignals {
  /** Whether the user is talking into voice capture; `null` (cannot tell) counts as speaking. */
  readonly userSpeaking: boolean | null
  /** Non-empty chat draft, or composer input within the last 10 s, in any window. */
  readonly userTyping: boolean
  readonly characterSpeaking: boolean
  /** A chat turn is generating (raw `sending`, unprompted turns included). */
  readonly generating: boolean
  /** Sends waiting in the chat queue. Anything but `0` suppresses. */
  readonly queued: number
  /** The desktop-activity sample is recent enough to trust. */
  readonly desktopFresh: boolean
  /** The foreground-window sample is recent enough to trust. */
  readonly foregroundFresh: boolean
  /** The stage window is shown and not minimized. Hosts that never report it count as hidden. */
  readonly stageVisible: boolean
}

export interface GateSettings {
  readonly enabled: boolean
  /** 0..1. Out-of-range values are clamped; a non-finite value counts as 0 (least chatty). */
  readonly chattiness: number
  readonly dontDisturb: boolean
  /** App id globs (`*` wildcard, case-insensitive) during which the character stays quiet. */
  readonly quietApps: readonly string[]
  /** When false, a game in the foreground suppresses everything but urgent notifies. */
  readonly speakDuringGames: boolean
}

export interface GateInput {
  /** Epoch milliseconds of this evaluation, from the caller's clock. */
  readonly nowMs: number
  readonly situation: SituationState
  readonly signals: GateSignals
  readonly settings: GateSettings
  /** Skips the timing guards only (devtools "Evaluate now"); hard suppressors still apply. */
  readonly forceTiming?: boolean
}

/** The last fire, until its outcome and the user's reaction are known. */
export interface GatePending {
  readonly topicKey: string
  readonly firedAtMs: number
  /** When the turn was spoken, or `null` while its outcome is unknown. */
  readonly spokenAtMs: number | null
}

/**
 * State the gate carries between evaluations. Plain JSON. Times later than the
 * next evaluation's `nowMs` (the clock moved backwards) are pulled back to that
 * `nowMs`, so a backward clock jump costs at most one gap instead of the jump.
 */
export interface GateMemory {
  readonly lastFireAtMs: number | null
  /** Fire times within the last {@link HOURLY_WINDOW_MS}, oldest first. */
  readonly fires: readonly number[]
  readonly pending: GatePending | null
  /** Ignored fires since the last backoff change; declines add {@link DECLINE_STREAK_WEIGHT}. */
  readonly ignoreStreak: number
  /** 0..{@link BACKOFF_LEVEL_MAX}; the gap is multiplied by `2^backoffLevel`. */
  readonly backoffLevel: number
}

export type GateOutcome = 'spoken' | 'declined' | 'cancelled' | 'failed'

/** Hard suppressors, in the order they are checked. */
export type GateHardReason
  = | 'invalid-time'
    | 'disabled'
    | 'dont-disturb'
    | 'stage-hidden'
    | 'presence-away'
    | 'presence-unknown'
    | 'stale-signal'
    | 'user-speaking'
    | 'user-typing'
    | 'character-speaking'
    | 'generating'
    | 'queued'
    | `busy-${Exclude<BusyState, 'accepts'>}`
    | 'quiet-app'
    | 'busy-game'

export type GateTimingReason = 'in-exchange' | 'gap' | 'hourly-cap'

/** Why the gate held. `no-topic` means no event cleared the salience threshold. */
export type GateHoldReason = GateHardReason | 'no-topic' | GateTimingReason

/**
 * Why the gate fired: `ready` when every guard passed, `urgent` for an urgent
 * notify (timing bypassed), `forced` when `forceTiming` skipped a timing guard
 * that would have held.
 */
export type GateFireReason = 'ready' | 'urgent' | 'forced'

export interface GateCandidate {
  readonly eventId: string
  readonly topicKey: string
  readonly text: string
  readonly kind: SituationEventKind
  /** Effective salience at `nowMs`. */
  readonly salience: number
  readonly urgent: boolean
}

/** Everything the decision was based on, for the devtools gate panel (todo 25). */
export interface GateTrace {
  readonly nowMs: number
  /** Chattiness after clamping. */
  readonly chattiness: number
  readonly threshold: number
  /** The best eligible topic, also reported when a suppressor held. */
  readonly candidate: GateCandidate | null
  /** Current gap including backoff and the game multiplier. */
  readonly gapMs: number
  readonly hourlyCap: number
  /** Fires counted by the hourly cap before this decision; `null` when `nowMs` is not a valid time. */
  readonly firesLastHour: number | null
  readonly backoffLevel: number
  readonly ignoreStreak: number
  readonly pendingTopicKey: string | null
  /**
   * Earliest time the timing guards let a non-urgent topic through (hard
   * suppressors and topic availability aside); `null` when `nowMs` is not a valid time.
   */
  readonly nextEligibleAtMs: number | null
  readonly forceTiming: boolean
}

export type GateDecision
  = | { readonly fire: true, readonly reason: GateFireReason, readonly topicKey: string, readonly topicText: string, readonly trace: GateTrace }
    | { readonly fire: false, readonly reason: GateHoldReason, readonly trace: GateTrace }

export interface GateEvaluation {
  readonly decision: GateDecision
  readonly memory: GateMemory
}

export const initialGateMemory: GateMemory = Object.freeze({
  lastFireAtMs: null,
  fires: Object.freeze([]),
  pending: null,
  ignoreStreak: 0,
  backoffLevel: 0,
})

const BUSY_HOLD_STATES: ReadonlySet<string> = new Set<BusyState>(['busy', 'fullscreen', 'presentation', 'quiet', 'unknown'])

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clampChattiness(chattiness: number): number {
  return Number.isFinite(chattiness) ? Math.min(1, Math.max(0, chattiness)) : 0
}

/** Effective salience a topic needs at `chattiness` (clamped to 0..1). */
export function gateThreshold(chattiness: number): number {
  return GATE_THRESHOLD_BASE - GATE_THRESHOLD_SLOPE * clampChattiness(chattiness)
}

/** Minimum gap between fires at `chattiness`, before backoff and the game multiplier, in whole milliseconds. */
export function minGapMs(chattiness: number): number {
  const minutes = Math.max(MIN_GAP_FLOOR_MINUTES, MIN_GAP_SPAN_MINUTES * (1 - clampChattiness(chattiness)))
  return Math.round(minutes * MINUTE_MS)
}

/** Fires allowed per hour at `chattiness`. */
export function hourlyFireCap(chattiness: number): number {
  return Math.round(HOURLY_CAP_BASE + HOURLY_CAP_SLOPE * clampChattiness(chattiness))
}

/**
 * Brings stored memory into a usable shape at `nowMs`: drops non-finite
 * times, pulls future times back to `nowMs`, prunes fires older than the
 * hourly window, and clamps the streak and backoff level.
 */
function normalizeMemory(memory: GateMemory, nowMs: number): GateMemory {
  const atMost = (time: number): number => Math.min(time, nowMs)
  const fires = (Array.isArray(memory.fires) ? memory.fires : [])
    .filter(isTime)
    .map(atMost)
    .filter(time => nowMs - time < HOURLY_WINDOW_MS)
    .sort((a, b) => a - b)

  const raw = memory.pending
  const pending: GatePending | null = raw !== null && typeof raw === 'object' && typeof raw.topicKey === 'string' && isTime(raw.firedAtMs)
    ? { topicKey: raw.topicKey, firedAtMs: atMost(raw.firedAtMs), spokenAtMs: isTime(raw.spokenAtMs) ? atMost(raw.spokenAtMs) : null }
    : null

  return {
    lastFireAtMs: isTime(memory.lastFireAtMs) ? atMost(memory.lastFireAtMs) : null,
    fires,
    pending,
    ignoreStreak: isTime(memory.ignoreStreak) && memory.ignoreStreak > 0 ? memory.ignoreStreak : 0,
    backoffLevel: isTime(memory.backoffLevel) ? Math.min(BACKOFF_LEVEL_MAX, Math.max(0, Math.floor(memory.backoffLevel))) : 0,
  }
}

function addToStreak(memory: GateMemory, amount: number): GateMemory {
  const streak = memory.ignoreStreak + amount
  if (streak >= IGNORE_STREAK_LIMIT)
    return { ...memory, ignoreStreak: 0, backoffLevel: Math.min(BACKOFF_LEVEL_MAX, memory.backoffLevel + 1) }
  return { ...memory, ignoreStreak: streak }
}

/** Counts a spoken fire whose ignore window has passed without a user turn as ignored. */
function settleEngagement(memory: GateMemory, nowMs: number): GateMemory {
  const pending = memory.pending
  if (pending === null || pending.spokenAtMs === null || nowMs - pending.spokenAtMs <= IGNORE_WINDOW_MS)
    return memory
  return addToStreak({ ...memory, pending: null }, 1)
}

function compareCandidates(a: GateCandidate & { atMs: number }, b: GateCandidate & { atMs: number }): number {
  if (a.urgent !== b.urgent)
    return a.urgent ? -1 : 1
  return b.salience - a.salience || b.atMs - a.atMs || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
}

/**
 * The best unaddressed world event at or above `threshold`. Urgent notifies
 * rank first, then higher effective salience, then newer events, then the
 * smaller id, so the pick is deterministic.
 *
 * Self-origin events never qualify: the character's own turns and windows must
 * not give her something to talk about. A `long-session` event that matured
 * before the latest `returned` event is skipped: the reducer keeps counting
 * tiers while the user is away (task-8 review N7), so such a tier describes
 * time the user did not spend in the app.
 */
function pickCandidate(situation: SituationState, nowMs: number, threshold: number): GateCandidate | null {
  let returnedAtMs: number | null = null
  for (const event of situation.events) {
    if (event.kind === 'returned' && event.origin === 'world' && isTime(event.atMs))
      returnedAtMs = returnedAtMs === null ? event.atMs : Math.max(returnedAtMs, event.atMs)
  }

  let best: (GateCandidate & { atMs: number }) | null = null
  for (const event of situation.events) {
    if (event.origin !== 'world' || event.addressedAtMs !== null)
      continue
    const text = typeof event.text === 'string' ? event.text.trim() : ''
    if (typeof event.topicKey !== 'string' || event.topicKey === '' || text === '')
      continue
    if (event.kind === 'long-session' && returnedAtMs !== null && event.atMs < returnedAtMs)
      continue
    const salience = effectiveSalience(event, nowMs)
    if (!(salience >= threshold))
      continue
    const candidate = {
      eventId: event.id,
      topicKey: event.topicKey,
      text,
      kind: event.kind,
      salience,
      urgent: event.kind === 'notify' && event.salience >= URGENT_SALIENCE,
      atMs: event.atMs,
    }
    if (best === null || compareCandidates(candidate, best) < 0)
      best = candidate
  }

  if (best === null)
    return null
  const { atMs: _atMs, ...candidate } = best
  return candidate
}

export function hardReason(input: GateInput, candidate: GateCandidate | null): GateHardReason | null {
  const { signals, settings, situation } = input
  if (settings.enabled !== true)
    return 'disabled'
  if (settings.dontDisturb !== false)
    return 'dont-disturb'
  if (signals.stageVisible !== true)
    return 'stage-hidden'
  const presence = situation.presence.state
  if (presence === 'away')
    return 'presence-away'
  if (presence !== 'here' && presence !== 'idle')
    return 'presence-unknown'
  if (signals.desktopFresh !== true || signals.foregroundFresh !== true)
    return 'stale-signal'
  if (signals.userSpeaking !== false)
    return 'user-speaking'
  if (signals.userTyping !== false)
    return 'user-typing'
  if (signals.characterSpeaking !== false)
    return 'character-speaking'
  if (signals.generating !== false)
    return 'generating'
  if (signals.queued !== 0)
    return 'queued'
  const busy = situation.busy.state
  if (busy !== 'accepts')
    return BUSY_HOLD_STATES.has(busy) ? `busy-${busy}` : 'busy-unknown'

  const activity = situation.activity
  if (activity !== null) {
    const quietApps = Array.isArray(settings.quietApps) ? settings.quietApps.filter((glob): glob is string => typeof glob === 'string') : []
    if (activity.category === 'call' || (activity.appId !== '' && isDenylisted(activity.appId, quietApps)))
      return 'quiet-app'
    if (activity.category === 'game' && settings.speakDuringGames !== true && candidate?.urgent !== true)
      return 'busy-game'
  }
  return null
}

/** The first timing guard that holds at `nowMs`, and when all of them clear. */
function timingGuard(
  situation: SituationState,
  memory: GateMemory,
  nowMs: number,
  gapMs: number,
  hourlyCap: number,
): { reason: GateTimingReason | null, nextEligibleAtMs: number } {
  let reason: GateTimingReason | null = null
  let nextEligibleAtMs = nowMs

  const lastUserAtMs = situation.conversation.lastUserAtMs
  if (isTime(lastUserAtMs)) {
    const clearsAt = lastUserAtMs + IN_EXCHANGE_MS
    if (nowMs < clearsAt)
      reason ??= 'in-exchange'
    nextEligibleAtMs = Math.max(nextEligibleAtMs, clearsAt)
  }

  if (memory.lastFireAtMs !== null) {
    const clearsAt = memory.lastFireAtMs + gapMs
    if (nowMs < clearsAt)
      reason ??= 'gap'
    nextEligibleAtMs = Math.max(nextEligibleAtMs, clearsAt)
  }

  if (memory.fires.length >= hourlyCap) {
    // The cap clears when enough of the oldest fires leave the window to drop below it.
    reason ??= 'hourly-cap'
    nextEligibleAtMs = Math.max(nextEligibleAtMs, memory.fires[memory.fires.length - hourlyCap] + HOURLY_WINDOW_MS)
  }

  return { reason, nextEligibleAtMs }
}

/**
 * Decides whether the character should start a turn on her own now. Pure: time
 * comes only from `input.nowMs`, and neither argument is mutated.
 *
 * Order: hard suppressors (see {@link GateHardReason}; `busy-game` lets urgent
 * notifies through) -> the best topic (`no-topic` if none) -> urgent notifies
 * fire -> timing guards `in-exchange`, `gap` (`minGap * 2^backoff`, doubled
 * during games), `hourly-cap`; `forceTiming` skips only the timing guards.
 *
 * A fire records `lastFireAtMs`, the hourly fire list, and a pending entry
 * whose outcome the caller reports with {@link recordFireOutcome}. Every call
 * also settles engagement: a spoken fire with no {@link recordUserTurn}
 * within {@link IGNORE_WINDOW_MS} counts as ignored. A non-finite `nowMs`
 * holds with `invalid-time` and returns `memory` unchanged.
 */
export function evaluateGate(input: GateInput, memory: GateMemory): GateEvaluation {
  const nowMs = input.nowMs
  const chattiness = clampChattiness(input.settings.chattiness)
  const threshold = gateThreshold(chattiness)
  const hourlyCap = hourlyFireCap(chattiness)
  const forceTiming = input.forceTiming === true

  if (!isTime(nowMs)) {
    const backoffLevel = isTime(memory.backoffLevel) ? Math.min(BACKOFF_LEVEL_MAX, Math.max(0, Math.floor(memory.backoffLevel))) : 0
    const trace: GateTrace = {
      nowMs,
      chattiness,
      threshold,
      candidate: null,
      gapMs: minGapMs(chattiness) * 2 ** backoffLevel,
      hourlyCap,
      firesLastHour: null,
      backoffLevel,
      ignoreStreak: isTime(memory.ignoreStreak) ? memory.ignoreStreak : 0,
      pendingTopicKey: null,
      nextEligibleAtMs: null,
      forceTiming,
    }
    return { decision: { fire: false, reason: 'invalid-time', trace }, memory }
  }

  const settled = settleEngagement(normalizeMemory(memory, nowMs), nowMs)
  const { situation } = input
  const candidate = pickCandidate(situation, nowMs, threshold)
  const gameMultiplier = situation.activity?.category === 'game' ? GAME_GAP_MULTIPLIER : 1
  const gapMs = minGapMs(chattiness) * 2 ** settled.backoffLevel * gameMultiplier
  const timing = timingGuard(situation, settled, nowMs, gapMs, hourlyCap)
  const trace: GateTrace = {
    nowMs,
    chattiness,
    threshold,
    candidate,
    gapMs,
    hourlyCap,
    firesLastHour: settled.fires.length,
    backoffLevel: settled.backoffLevel,
    ignoreStreak: settled.ignoreStreak,
    pendingTopicKey: settled.pending?.topicKey ?? null,
    nextEligibleAtMs: timing.nextEligibleAtMs,
    forceTiming,
  }

  const hard = hardReason(input, candidate)
  if (hard !== null)
    return { decision: { fire: false, reason: hard, trace }, memory: settled }
  if (candidate === null)
    return { decision: { fire: false, reason: 'no-topic', trace }, memory: settled }
  if (!candidate.urgent && !forceTiming && timing.reason !== null)
    return { decision: { fire: false, reason: timing.reason, trace }, memory: settled }

  const reason: GateFireReason = candidate.urgent ? 'urgent' : timing.reason !== null ? 'forced' : 'ready'
  return {
    decision: { fire: true, reason, topicKey: candidate.topicKey, topicText: candidate.text, trace },
    memory: {
      ...settled,
      lastFireAtMs: nowMs,
      fires: [...settled.fires, nowMs],
      // A newer fire replaces an unresolved one; the older fire's engagement is not counted.
      pending: { topicKey: candidate.topicKey, firedAtMs: nowMs, spokenAtMs: null },
    },
  }
}

/**
 * Memory for a window that just became the leader: as if a turn fired at
 * `nowMs`, so the gap holds before the first fire. It does not count toward
 * the hourly cap and leaves nothing pending.
 */
export function promotionGateMemory(nowMs: number): GateMemory {
  if (!isTime(nowMs))
    return initialGateMemory
  return { ...initialGateMemory, fires: [], lastFireAtMs: nowMs }
}

/**
 * Memory for a stage that became visible again after being hidden: the same
 * gap as {@link promotionGateMemory}, keeping backoff, streak, and the fire history.
 */
export function visibilityRegainGateMemory(memory: GateMemory, nowMs: number): GateMemory {
  if (!isTime(nowMs))
    return memory
  return { ...normalizeMemory(memory, nowMs), lastFireAtMs: nowMs }
}

/**
 * Records how the pending fire ended. `spoken` starts the ignore window at
 * `nowMs`; `declined` (the model answered `<|SILENT|>`) adds
 * {@link DECLINE_STREAK_WEIGHT} to the streak; `cancelled` and `failed` only
 * clear the pending entry. The fire still counts toward the gap and the cap.
 * Ignored when nothing is pending, the outcome was already recorded, or `nowMs`
 * is not a valid time.
 */
export function recordFireOutcome(memory: GateMemory, outcome: GateOutcome, nowMs: number): GateMemory {
  if (!isTime(nowMs))
    return memory
  const normalized = normalizeMemory(memory, nowMs)
  const pending = normalized.pending
  if (pending === null || pending.spokenAtMs !== null)
    return normalized
  switch (outcome) {
    case 'spoken':
      return { ...normalized, pending: { ...pending, spokenAtMs: nowMs } }
    case 'declined':
      return addToStreak({ ...normalized, pending: null }, DECLINE_STREAK_WEIGHT)
    case 'cancelled':
    case 'failed':
      return { ...normalized, pending: null }
    default:
      return normalized
  }
}

/**
 * Records a user-origin turn. Within {@link IGNORE_WINDOW_MS} of a spoken fire
 * it counts as engagement: the pending entry clears, the streak resets, and
 * the backoff level drops by one. Callers must not report the character's own
 * unprompted turns here.
 */
export function recordUserTurn(memory: GateMemory, nowMs: number): GateMemory {
  if (!isTime(nowMs))
    return memory
  const settled = settleEngagement(normalizeMemory(memory, nowMs), nowMs)
  if (settled.pending === null || settled.pending.spokenAtMs === null)
    return settled
  return { ...settled, pending: null, ignoreStreak: 0, backoffLevel: Math.max(0, settled.backoffLevel - 1) }
}
