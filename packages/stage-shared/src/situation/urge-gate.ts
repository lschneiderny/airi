import type { GateHardReason, GateOutcome, GateSettings, GateSignals } from './gate'
import type { HazardCategory } from './reasons/collect'
import type { GateLocalTime, Reason, ReasonCategory, ReasonKind, ReasonState, RitualDay, RitualKind } from './reasons/types'
import type { SituationState } from './types'

import { hardReason } from './gate'
import { collectReasons, pickCategory, pickReason } from './reasons/collect'
import { advanceRituals, markRitualDone, ritualHazardPerHour } from './reasons/rituals'
import { LOGICAL_DAY_ROLLOVER_HOUR, REASON_TEXT } from './reasons/types'
import { effectiveSalience } from './reducer'
import { nextRandom, seedRng } from './rng'
import {
  ACCRUAL_DT_MAX_MS,
  accrue,
  baseRatePerHour,
  clearFactor,
  continuationHazardPerHour,
  DOUBLE_TEXT_EXPIRY_MS,
  DOUBLE_TEXT_OFFSET_MAX_MS,
  DOUBLE_TEXT_OFFSET_MIN_MS,
  DOUBLE_TEXT_PROBABILITY,
  drawThreshold,
  DUE_BUMP_RATE_PER_HOUR,
  exchangeFactor,
  expectedWaitMs,
  FLOOR_MS,
  GAME_FACTOR,
  HOUR_MS,
  pressure,
  recoveryFactor,
  SAFETY_CAP_PER_HOUR,
  UNANSWERED_PHASES,
  unansweredPhase,
} from './urge'

export type { GateHardReason, GateOutcome, GateSettings, GateSignals } from './gate'
export { URGENT_SALIENCE } from './gate'

const MINUTE_MS = 60_000
const DAY_MINUTES = 24 * 60

export interface UrgeGateInput {
  /** Epoch milliseconds of this evaluation, from the caller's clock. */
  readonly nowMs: number
  readonly situation: SituationState
  /**
   * Open threads. The ritual day is not read from here: the gate owns it in
   * {@link UrgeGateMemory.day} and advances it on every evaluation.
   */
  readonly reasons: Pick<ReasonState, 'threads'>
  /** Local calendar position of `nowMs`; the host owns the time zone. */
  readonly local: GateLocalTime
  /** Chat session whose threads may surface; threads of other sessions never do. */
  readonly sessionId: string
  readonly signals: GateSignals
  readonly settings: GateSettings
  /** Topic keys a widget or plugin holds (`holdTopic`); held reasons are never picked, urgent ones included. */
  readonly heldTopics: ReadonlySet<string>
  /** Skips the timing holds only (devtools "Evaluate now"); hard suppressors still apply and the fire still draws and picks. */
  readonly forceTiming?: boolean
}

/** The last fire, until its outcome is known. Never persisted. */
export interface UrgeGatePending {
  readonly topicKey: string
  readonly firedAtMs: number
  /** When the turn was spoken, or `null` while its outcome is unknown. */
  readonly spokenAtMs: number | null
  readonly category: ReasonCategory
  readonly reasonKind: ReasonKind
  /** Drawn at the fire; a spoken opening arms a double text when it is below {@link DOUBLE_TEXT_PROBABILITY}. */
  readonly doubleTextRoll: number
  /** Drawn at the fire; the armed double text is due this long after the opening was spoken. */
  readonly doubleTextOffsetMs: number
}

/** Rate damping left by unanswered openings; it recovers by half every `RECOVERY_HALF_LIFE_MS` from `sinceMs`. */
export interface UrgeGateDamp {
  readonly depth: number
  readonly sinceMs: number
}

/** One armed extra line after a spoken opening. */
export interface UrgeGateDoubleText {
  readonly topicKey: string
  readonly dueAtMs: number
  readonly expiresAtMs: number
}

/**
 * State the gate carries between evaluations. Plain JSON. Times later than the
 * next evaluation's `nowMs` (the clock moved backwards) are pulled back to that
 * `nowMs`, so a backward jump never accrues urge and never extends a hold.
 */
export interface UrgeGateMemory {
  readonly lastEvalAtMs: number | null
  /** Last fire of any kind (ordinary, urgent, double text) or forced external speech; the floor counts from it. */
  readonly lastFireAtMs: number | null
  readonly lastSpokenAtMs: number | null
  /** Last evaluation held by a long hard suppressor; opening hazard recovers from it via `clearFactor`. */
  readonly lastHardHoldAtMs: number | null
  /** Integrated hazard since the last ordinary fire. */
  readonly urge: number
  /** Exp(1) ticket the urge must reach; redrawn at every ordinary fire. */
  readonly urgeThreshold: number
  /** Mulberry32 checkpoint; advanced by exactly five draws per ordinary fire and by nothing else. */
  readonly rngState: number
  /** Ordinary fire times within the last hour, oldest first; the safety cap counts them. */
  readonly fires: readonly number[]
  readonly pending: UrgeGatePending | null
  /** Spoken openings and continuations since his last reply. */
  readonly unanswered: number
  readonly awaitingSinceMs: number | null
  readonly damp: UrgeGateDamp | null
  readonly doubleText: UrgeGateDoubleText | null
  readonly day: RitualDay | null
  readonly lastOwnDayAtMs: number | null
}

/** The social slice that survives a leader reload; everything else restarts from promotion. */
export type SavedGateMemory = Pick<UrgeGateMemory, 'lastFireAtMs' | 'lastSpokenAtMs' | 'unanswered' | 'awaitingSinceMs' | 'damp' | 'day' | 'lastOwnDayAtMs' | 'rngState'>

export type UrgeGateTimingReason = 'floor' | 'awaiting-reply' | 'quiet-unanswered' | 'urge' | 'safety-cap'

/** Why the gate held. `no-topic` means the drawn category had no reason to pick. */
export type UrgeGateHoldReason = GateHardReason | UrgeGateTimingReason | 'no-topic'

/**
 * Why the gate fired: `urge` when the urge crossed its threshold (open, due, or
 * continuation), `ritual` for a ritual, `double-text` for an armed extra line,
 * `urgent` for an urgent notify (timing bypassed), `forced` when `forceTiming`
 * skipped a timing hold that would have held.
 */
export type UrgeGateFireReason = 'urge' | 'ritual' | 'double-text' | 'urgent' | 'forced'

/**
 * `open`: nothing unanswered. `continuation-window`: one unanswered opening,
 * only a short continuation may follow. `quiet`: two or more unanswered, only
 * urgent notifies. `reopened`: a quiet window passed, openings are damped.
 */
export type UrgeGatePhase = 'open' | 'continuation-window' | 'quiet' | 'reopened'

export interface UrgeGateHazards {
  readonly open: number
  readonly continuation: number
  readonly ritual: number
  readonly due: number
  readonly total: number
}

export interface UrgeGateMultipliers {
  readonly base: number
  readonly pressure: number
  readonly exchange: number
  readonly clear: number
  /** Recovery after a reply times the phase damping. */
  readonly damping: number
  readonly floor: number
  readonly game: number
}

export interface UrgeGatePick {
  readonly categoryRoll: number
  readonly reasonRoll: number
  readonly category: HazardCategory
  readonly reasonKey: string | null
}

/** Everything the decision was based on, for the devtools gate panel. */
export interface UrgeGateTrace {
  readonly nowMs: number
  /** Chattiness after clamping. */
  readonly chattiness: number
  /** Hourly hazards of this evaluation; disallowed categories are 0. */
  readonly hazardPerHour: UrgeGateHazards
  readonly multipliers: UrgeGateMultipliers
  /** Urge after this evaluation's accrual (unchanged on holds that do not accrue). */
  readonly urge: number
  readonly urgeThreshold: number
  /** Wait until the threshold at the current hazard; `null` when the hazard is 0. */
  readonly expectedWaitMs: number | null
  readonly phase: UrgeGatePhase
  readonly unanswered: number
  /** End of the current unanswered quiet window, or `null` when nothing is unanswered. */
  readonly reopenAtMs: number | null
  readonly doubleTextDueAtMs: number | null
  readonly rituals: RitualDay | null
  readonly reasons: readonly Reason[]
  readonly pick: UrgeGatePick | null
  /** Ordinary fires counted by the safety cap before this decision. */
  readonly firesLastHour: number
  readonly pendingTopicKey: string | null
  readonly forceTiming: boolean
}

export type UrgeGateDecision
  = | {
    readonly fire: true
    readonly reason: UrgeGateFireReason
    readonly category: ReasonCategory
    readonly topicKey: string
    readonly topicText: string
    /** The reason she reaches out for; its `text` is optional context for the model. */
    readonly picked: Reason
    readonly trace: UrgeGateTrace
  }
  | { readonly fire: false, readonly reason: UrgeGateHoldReason, readonly trace: UrgeGateTrace }

export interface UrgeGateEvaluation {
  readonly decision: UrgeGateDecision
  readonly memory: UrgeGateMemory
}

function drawFirstThreshold(seed: number): { urgeThreshold: number, rngState: number } {
  const [u, next] = nextRandom(seedRng(seed))
  return { urgeThreshold: drawThreshold(u), rngState: next }
}

export const initialUrgeMemory: UrgeGateMemory = Object.freeze({
  lastEvalAtMs: null,
  lastFireAtMs: null,
  lastSpokenAtMs: null,
  lastHardHoldAtMs: null,
  urge: 0,
  ...drawFirstThreshold(0),
  fires: Object.freeze([]),
  pending: null,
  unanswered: 0,
  awaitingSinceMs: null,
  damp: null,
  doubleText: null,
  day: null,
  lastOwnDayAtMs: null,
})

/** Hard reasons that describe a lasting state; opening hazard ramps back up after they clear. */
const LONG_HARD_REASONS: ReadonlySet<GateHardReason> = new Set<GateHardReason>([
  'disabled',
  'dont-disturb',
  'stage-hidden',
  'presence-away',
  'presence-unknown',
  'stale-signal',
  'quiet-app',
])

function isLongHardReason(reason: GateHardReason): boolean {
  return LONG_HARD_REASONS.has(reason) || reason.startsWith('busy-')
}

const RITUAL_BY_REASON_KIND: Partial<Record<ReasonKind, RitualKind>> = {
  'ritual-greeting': 'greeting',
  'ritual-sign-off': 'sign-off',
  'ritual-welcome-back': 'welcome-back',
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clampChattiness(chattiness: number): number {
  return Number.isFinite(chattiness) ? Math.min(1, Math.max(0, chattiness)) : 0
}

function phaseTuning(unanswered: number) {
  return UNANSWERED_PHASES[Math.min(UNANSWERED_PHASES.length, Math.floor(unanswered)) - 1]
}

/**
 * Brings stored memory into a usable shape at `nowMs`: drops non-finite times,
 * pulls past-anchored times that lie in the future back to `nowMs`, prunes
 * fires older than an hour, and drops a double text whose expiry is further
 * away than {@link DOUBLE_TEXT_EXPIRY_MS} (only a backward clock jump causes that).
 */
function normalizeMemory(memory: UrgeGateMemory, nowMs: number): UrgeGateMemory {
  const atMost = (time: number | null): number | null => isTime(time) ? Math.min(time, nowMs) : null
  const fires = (Array.isArray(memory.fires) ? memory.fires : [])
    .filter(isTime)
    .map(time => Math.min(time, nowMs))
    .filter(time => nowMs - time < HOUR_MS)
    .sort((a, b) => a - b)

  const raw = memory.pending
  const pending: UrgeGatePending | null = raw !== null && typeof raw === 'object' && typeof raw.topicKey === 'string' && isTime(raw.firedAtMs)
    ? { ...raw, firedAtMs: Math.min(raw.firedAtMs, nowMs), spokenAtMs: atMost(raw.spokenAtMs) }
    : null

  const damp = memory.damp !== null && typeof memory.damp === 'object' && isTime(memory.damp.depth) && isTime(memory.damp.sinceMs)
    ? { depth: Math.min(1, Math.max(0, memory.damp.depth)), sinceMs: Math.min(memory.damp.sinceMs, nowMs) }
    : null

  const text = memory.doubleText
  const doubleText = text !== null && typeof text === 'object' && typeof text.topicKey === 'string'
    && isTime(text.dueAtMs) && isTime(text.expiresAtMs) && text.expiresAtMs - nowMs <= DOUBLE_TEXT_EXPIRY_MS
    ? text
    : null

  return {
    lastEvalAtMs: atMost(memory.lastEvalAtMs),
    lastFireAtMs: atMost(memory.lastFireAtMs),
    lastSpokenAtMs: atMost(memory.lastSpokenAtMs),
    lastHardHoldAtMs: atMost(memory.lastHardHoldAtMs),
    urge: isTime(memory.urge) && memory.urge > 0 ? memory.urge : 0,
    // 1 is the mean of the Exp(1) ticket; only reached when stored memory was corrupt.
    urgeThreshold: isTime(memory.urgeThreshold) && memory.urgeThreshold >= 0 ? memory.urgeThreshold : 1,
    rngState: isTime(memory.rngState) ? seedRng(memory.rngState) : 0,
    fires,
    pending,
    unanswered: isTime(memory.unanswered) && memory.unanswered > 0 ? Math.floor(memory.unanswered) : 0,
    awaitingSinceMs: atMost(memory.awaitingSinceMs),
    damp,
    doubleText,
    day: memory.day ?? null,
    lastOwnDayAtMs: atMost(memory.lastOwnDayAtMs),
  }
}

/** Epoch ms of the latest logical-day rollover at or before `nowMs`, from the host's local minute of day. */
function logicalDayStartMs(nowMs: number, local: GateLocalTime): number {
  const sinceRollover = ((local.minuteOfDay - LOGICAL_DAY_ROLLOVER_HOUR * 60) % DAY_MINUTES + DAY_MINUTES) % DAY_MINUTES
  return nowMs - (nowMs % MINUTE_MS) - sinceRollover * MINUTE_MS
}

/**
 * Ritual facts derived from the situation. The latest away span ended when the
 * current present state began; `tracking.lastAwayMs` is its length. A later
 * here/idle flip reports the same span again, which `advanceRituals` ignores
 * once the welcome-back window has opened.
 */
function ritualFacts(input: UrgeGateInput): Parameters<typeof advanceRituals>[1] {
  const { nowMs, situation, local } = input
  const presence = situation.presence.state
  const present = presence === 'here' || presence === 'idle'
  const lastAwayMs = situation.tracking.lastAwayMs
  const awayEnded = present && lastAwayMs !== null && situation.presence.sinceMs !== null
  const lastUserAtMs = situation.conversation.lastUserAtMs
  return {
    nowMs,
    local,
    presence,
    userSpokeToday: isTime(lastUserAtMs) && lastUserAtMs >= logicalDayStartMs(nowMs, local),
    awayEndedAtMs: awayEnded ? situation.presence.sinceMs : null,
    awayDurationMs: awayEnded ? lastAwayMs : null,
  }
}

interface PhaseInfo {
  readonly phase: UrgeGatePhase
  readonly damping: number
  readonly reopenAtMs: number | null
}

function phaseOf(memory: UrgeGateMemory, nowMs: number): PhaseInfo {
  if (memory.unanswered < 1)
    return { phase: 'open', damping: 1, reopenAtMs: null }
  const sinceSpokenMs = memory.lastSpokenAtMs === null ? Number.POSITIVE_INFINITY : nowMs - memory.lastSpokenAtMs
  const { allows, damping } = unansweredPhase(memory.unanswered, sinceSpokenMs)
  const reopenAtMs = memory.lastSpokenAtMs === null ? null : memory.lastSpokenAtMs + phaseTuning(memory.unanswered).quietMs
  const phase: UrgeGatePhase = allows === 'continuation' ? 'continuation-window' : allows === 'urgent' ? 'quiet' : 'reopened'
  return { phase, damping, reopenAtMs }
}

/**
 * Hourly hazards per category. Only the phase's categories are non-zero:
 * open/reopened allow open, ritual, and due; continuation-window allows only
 * continuation; quiet allows nothing. Every hazard is multiplied by the
 * exchange factor and the floor factor; only `open` carries the base rate,
 * thread pressure, clear ramp, damping, and the game factor.
 */
function hazardsOf(input: UrgeGateInput, memory: UrgeGateMemory, phase: PhaseInfo, reasons: readonly Reason[], chattiness: number): { hazards: UrgeGateHazards, multipliers: UrgeGateMultipliers } {
  const { nowMs, situation } = input
  const lastUserAtMs = situation.conversation.lastUserAtMs
  let maxThreadRipeness = 0
  let ritualRate = 0
  let dueNow = false
  for (const reason of reasons) {
    if (reason.kind.startsWith('thread-'))
      maxThreadRipeness = Math.max(maxThreadRipeness, reason.ripeness)
    const ritual = RITUAL_BY_REASON_KIND[reason.kind]
    if (ritual !== undefined)
      ritualRate += ritualHazardPerHour(ritual)
    dueNow ||= reason.dueNow
  }

  const multipliers: UrgeGateMultipliers = {
    base: baseRatePerHour(chattiness),
    pressure: pressure(maxThreadRipeness),
    exchange: exchangeFactor(isTime(lastUserAtMs) ? Math.max(0, nowMs - lastUserAtMs) : null),
    clear: clearFactor(memory.lastHardHoldAtMs === null ? null : nowMs - memory.lastHardHoldAtMs),
    damping: recoveryFactor(memory.damp, nowMs) * phase.damping,
    floor: memory.lastFireAtMs !== null && nowMs - memory.lastFireAtMs < FLOOR_MS ? 0 : 1,
    game: situation.activity?.category === 'game' ? GAME_FACTOR : 1,
  }
  const shared = multipliers.exchange * multipliers.floor
  const opens = phase.phase === 'open' || phase.phase === 'reopened'
  const open = opens ? multipliers.base * multipliers.pressure * multipliers.clear * multipliers.damping * multipliers.game * shared : 0
  const ritual = opens ? ritualRate * shared : 0
  const due = opens && dueNow ? DUE_BUMP_RATE_PER_HOUR * shared : 0
  const continuation = phase.phase === 'continuation-window' && memory.lastSpokenAtMs !== null
    ? continuationHazardPerHour(nowMs - memory.lastSpokenAtMs) * shared
    : 0
  return { hazards: { open, continuation, ritual, due, total: open + continuation + ritual + due }, multipliers }
}

/** The urgent reason with the highest effective salience, then the smallest source event id. */
function pickUrgent(reasons: readonly Reason[], situation: SituationState, nowMs: number): { reason: Reason, salience: number } | null {
  let best: { reason: Reason, salience: number } | null = null
  for (const reason of reasons) {
    if (!reason.urgent)
      continue
    const event = situation.events.find(candidate => candidate.id === reason.sourceEventId)
    const salience = event === undefined ? 0 : effectiveSalience(event, nowMs)
    const id = reason.sourceEventId ?? ''
    if (best === null || salience > best.salience || (salience === best.salience && id < (best.reason.sourceEventId ?? '')))
      best = { reason, salience }
  }
  return best
}

function syntheticReason(kind: 'continuation' | 'double-text', topicKey: string): Reason {
  return {
    key: topicKey,
    kind,
    category: kind,
    text: REASON_TEXT[kind],
    sourceEventId: null,
    ripeness: 1,
    weight: 0,
    urgent: false,
    dueAtMs: null,
    dueNow: false,
  }
}

const ZERO_HAZARDS: UrgeGateHazards = Object.freeze({ open: 0, continuation: 0, ritual: 0, due: 0, total: 0 })

function zeroMultipliers(chattiness: number): UrgeGateMultipliers {
  return { base: baseRatePerHour(chattiness), pressure: 0, exchange: 0, clear: 0, damping: 0, floor: 0, game: 0 }
}

/**
 * Decides whether the character reaches out on her own now. Pure: time comes
 * only from `input.nowMs`, randomness only from `memory.rngState`, and neither
 * argument is mutated.
 *
 * Order: hard suppressors ({@link hardReason}; `busy-game` lets
 * urgent notifies through) -> urgent notify -> due double text -> the urge
 * path, whose holds are checked in the order `floor`, `quiet-unanswered`,
 * `safety-cap`, `awaiting-reply`, `urge`, then `no-topic`.
 *
 * Urge accrues only on the urge path, over at most {@link ACCRUAL_DT_MAX_MS}
 * since the previous evaluation, so hard holds, urgent fires, and double-text
 * fires never add urge. Holds never draw; an ordinary fire draws exactly five
 * randoms (threshold, category, reason, double-text roll, double-text offset).
 * A non-finite `nowMs` holds with `invalid-time` and returns `memory` unchanged.
 */
export function evaluateUrgeGate(input: UrgeGateInput, memory: UrgeGateMemory): UrgeGateEvaluation {
  const { nowMs, situation } = input
  const chattiness = clampChattiness(input.settings.chattiness)
  const forceTiming = input.forceTiming === true

  if (!isTime(nowMs)) {
    const trace: UrgeGateTrace = {
      nowMs,
      chattiness,
      hazardPerHour: ZERO_HAZARDS,
      multipliers: zeroMultipliers(chattiness),
      urge: memory.urge,
      urgeThreshold: memory.urgeThreshold,
      expectedWaitMs: null,
      phase: 'open',
      unanswered: memory.unanswered,
      reopenAtMs: null,
      doubleTextDueAtMs: null,
      rituals: memory.day,
      reasons: [],
      pick: null,
      firesLastHour: 0,
      pendingTopicKey: null,
      forceTiming,
    }
    return { decision: { fire: false, reason: 'invalid-time', trace }, memory }
  }

  const normalized = normalizeMemory(memory, nowMs)
  const dtMs = normalized.lastEvalAtMs === null ? 0 : Math.min(ACCRUAL_DT_MAX_MS, nowMs - normalized.lastEvalAtMs)
  const day = advanceRituals(normalized.day, ritualFacts(input))
  const doubleText = normalized.doubleText !== null && nowMs < normalized.doubleText.expiresAtMs ? normalized.doubleText : null
  const base: UrgeGateMemory = { ...normalized, lastEvalAtMs: nowMs, day, doubleText }

  const reasons = collectReasons({
    situation,
    reasons: { threads: input.reasons.threads, rituals: day },
    nowMs,
    sessionId: input.sessionId,
    heldTopics: input.heldTopics,
    lastOwnDayAtMs: base.lastOwnDayAtMs,
  })
  const phase = phaseOf(base, nowMs)
  const { hazards, multipliers } = hazardsOf(input, base, phase, reasons, chattiness)
  const urgent = pickUrgent(reasons, situation, nowMs)

  const traceFor = (urge: number, pick: UrgeGatePick | null): UrgeGateTrace => ({
    nowMs,
    chattiness,
    hazardPerHour: hazards,
    multipliers,
    urge,
    urgeThreshold: base.urgeThreshold,
    expectedWaitMs: expectedWaitMs(urge, base.urgeThreshold, hazards.total),
    phase: phase.phase,
    unanswered: base.unanswered,
    reopenAtMs: phase.reopenAtMs,
    doubleTextDueAtMs: doubleText?.dueAtMs ?? null,
    rituals: day,
    reasons,
    pick,
    firesLastHour: base.fires.length,
    pendingTopicKey: base.pending?.topicKey ?? null,
    forceTiming,
  })

  const hard = hardReason(input, urgent !== null)
  if (hard !== null) {
    const held = isLongHardReason(hard) ? { ...base, lastHardHoldAtMs: nowMs } : base
    return { decision: { fire: false, reason: hard, trace: traceFor(base.urge, null) }, memory: held }
  }

  // (B) Urgent fire: no draw; urge, threshold, rng, fires, unanswered, and the double text stay as they are.
  if (urgent !== null) {
    const picked = urgent.reason
    return {
      decision: { fire: true, reason: 'urgent', category: 'urgent', topicKey: picked.key, topicText: picked.text, picked, trace: traceFor(base.urge, null) },
      memory: {
        ...base,
        lastFireAtMs: nowMs,
        pending: { topicKey: picked.key, firedAtMs: nowMs, spokenAtMs: null, category: 'urgent', reasonKind: picked.kind, doubleTextRoll: 1, doubleTextOffsetMs: 0 },
      },
    }
  }

  // (C) Double-text fire: no floor, no draw, no accrual; consumed once.
  if (doubleText !== null && nowMs >= doubleText.dueAtMs) {
    const picked = syntheticReason('double-text', doubleText.topicKey)
    return {
      decision: { fire: true, reason: 'double-text', category: 'double-text', topicKey: picked.key, topicText: picked.text, picked, trace: traceFor(base.urge, null) },
      memory: {
        ...base,
        doubleText: null,
        lastFireAtMs: nowMs,
        pending: { topicKey: doubleText.topicKey, firedAtMs: nowMs, spokenAtMs: null, category: 'double-text', reasonKind: 'double-text', doubleTextRoll: 1, doubleTextOffsetMs: 0 },
      },
    }
  }

  const accrued: UrgeGateMemory = { ...base, urge: accrue(base.urge, hazards.total, dtMs) }
  const ready = accrued.urge >= accrued.urgeThreshold
  let timing: UrgeGateTimingReason | null = null
  if (accrued.lastFireAtMs !== null && nowMs - accrued.lastFireAtMs < FLOOR_MS)
    timing = 'floor'
  else if (phase.phase === 'quiet')
    timing = 'quiet-unanswered'
  else if (accrued.fires.length >= SAFETY_CAP_PER_HOUR)
    timing = 'safety-cap'
  else if (phase.phase === 'continuation-window' && !ready)
    timing = 'awaiting-reply'
  else if (!ready)
    timing = 'urge'
  if (timing !== null && !forceTiming)
    return { decision: { fire: false, reason: timing, trace: traceFor(accrued.urge, null) }, memory: accrued }

  // (A) Ordinary fire: exactly five draws in a fixed order.
  const [thresholdRoll, s1] = nextRandom(accrued.rngState)
  const [categoryRoll, s2] = nextRandom(s1)
  const [reasonRoll, s3] = nextRandom(s2)
  const [doubleTextRoll, s4] = nextRandom(s3)
  const [doubleTextOffsetRoll, rngState] = nextRandom(s4)

  const category = pickCategory(hazards, categoryRoll)
  const picked = category === 'continuation'
    ? syntheticReason('continuation', accrued.pending?.topicKey ?? 'continuation')
    : pickReason(reasons, category, reasonRoll)
  const pick: UrgeGatePick = { categoryRoll, reasonRoll, category, reasonKey: picked?.key ?? null }
  if (picked === null)
    return { decision: { fire: false, reason: 'no-topic', trace: traceFor(accrued.urge, pick) }, memory: accrued }

  const reason: UrgeGateFireReason = timing !== null ? 'forced' : category === 'ritual' ? 'ritual' : 'urge'
  return {
    decision: { fire: true, reason, category, topicKey: picked.key, topicText: picked.text, picked, trace: traceFor(accrued.urge, pick) },
    memory: {
      ...accrued,
      urge: 0,
      urgeThreshold: drawThreshold(thresholdRoll),
      rngState,
      lastFireAtMs: nowMs,
      fires: [...accrued.fires, nowMs],
      pending: {
        topicKey: picked.key,
        firedAtMs: nowMs,
        spokenAtMs: null,
        category,
        reasonKind: picked.kind,
        doubleTextRoll,
        doubleTextOffsetMs: DOUBLE_TEXT_OFFSET_MIN_MS + doubleTextOffsetRoll * (DOUBLE_TEXT_OFFSET_MAX_MS - DOUBLE_TEXT_OFFSET_MIN_MS),
      },
    },
  }
}

/**
 * Memory for a window that just became the leader: urge 0, a fresh threshold
 * drawn from `seed`, and the clear ramp starting at `nowMs` so she does not
 * speak the moment she takes over. Restore the persisted social slice on top
 * with {@link restoreSocialMemory}.
 */
export function promotionUrgeMemory(nowMs: number, seed: number): UrgeGateMemory {
  return { ...initialUrgeMemory, ...drawFirstThreshold(seed), lastHardHoldAtMs: isTime(nowMs) ? nowMs : null }
}

/** Memory for a stage that became visible again: restarts the clear ramp, nothing else. */
export function visibilityRegainUrgeMemory(memory: UrgeGateMemory, nowMs: number): UrgeGateMemory {
  if (!isTime(nowMs))
    return memory
  return { ...normalizeMemory(memory, nowMs), lastHardHoldAtMs: nowMs }
}

/** Lays a persisted social slice over `memory` and normalizes the result at `nowMs`. */
export function restoreSocialMemory(memory: UrgeGateMemory, saved: SavedGateMemory, nowMs: number): UrgeGateMemory {
  const merged: UrgeGateMemory = {
    ...memory,
    lastFireAtMs: saved.lastFireAtMs,
    lastSpokenAtMs: saved.lastSpokenAtMs,
    unanswered: saved.unanswered,
    awaitingSinceMs: saved.awaitingSinceMs,
    damp: saved.damp,
    day: saved.day,
    lastOwnDayAtMs: saved.lastOwnDayAtMs,
    rngState: saved.rngState,
  }
  return isTime(nowMs) ? normalizeMemory(merged, nowMs) : merged
}

/**
 * Records how the pending fire ended. `spoken` starts the reply clock, counts
 * an unanswered opening (not for double texts or urgent notifies), marks a
 * ritual done, stamps own-day, and is the only place a double text is armed:
 * after a spoken open, ritual, or due fire whose stored roll is below
 * {@link DOUBLE_TEXT_PROBABILITY}, due at the stored offset after `nowMs`.
 * `declined`, `cancelled`, and `failed` clear the pending entry and nothing
 * else, so a decline is neutral. Ignored when nothing is pending, the outcome
 * was already recorded, or `nowMs` is not a valid time.
 */
export function recordUrgeFireOutcome(memory: UrgeGateMemory, outcome: GateOutcome, nowMs: number): UrgeGateMemory {
  if (!isTime(nowMs))
    return memory
  const normalized = normalizeMemory(memory, nowMs)
  const pending = normalized.pending
  if (pending === null || pending.spokenAtMs !== null)
    return normalized
  if (outcome !== 'spoken')
    return { ...normalized, pending: null }

  const opening = pending.category === 'open' || pending.category === 'ritual' || pending.category === 'due'
  const counts = pending.category !== 'double-text' && pending.category !== 'urgent'
  const ritual = RITUAL_BY_REASON_KIND[pending.reasonKind]
  return {
    ...normalized,
    pending: { ...pending, spokenAtMs: nowMs },
    lastSpokenAtMs: nowMs,
    unanswered: counts ? normalized.unanswered + 1 : normalized.unanswered,
    awaitingSinceMs: nowMs,
    lastOwnDayAtMs: pending.reasonKind === 'own-day' ? nowMs : normalized.lastOwnDayAtMs,
    day: ritual !== undefined && normalized.day !== null ? markRitualDone(normalized.day, ritual) : normalized.day,
    doubleText: opening && pending.doubleTextRoll < DOUBLE_TEXT_PROBABILITY
      ? { topicKey: pending.topicKey, dueAtMs: nowMs + pending.doubleTextOffsetMs, expiresAtMs: nowMs + DOUBLE_TEXT_EXPIRY_MS }
      : normalized.doubleText,
  }
}

/**
 * Records a user-origin turn. Unanswered openings turn into damping that
 * recovers by half every hour from now; the depth keeps whichever is deeper,
 * the damping still left or the one the unanswered count implies. Clears the
 * unanswered count, the reply clock, and any armed double text. Callers must
 * not report the character's own turns here.
 */
export function recordUrgeUserTurn(memory: UrgeGateMemory, nowMs: number): UrgeGateMemory {
  if (!isTime(nowMs))
    return memory
  const normalized = normalizeMemory(memory, nowMs)
  const damp = normalized.unanswered >= 1
    ? { depth: Math.max(1 - recoveryFactor(normalized.damp, nowMs), 1 - phaseTuning(normalized.unanswered).damping), sinceMs: nowMs }
    : normalized.damp
  return { ...normalized, damp, unanswered: 0, awaitingSinceMs: null, doubleText: null }
}

/**
 * Records a forced plugin or widget turn that spoke outside the gate. It
 * starts the floor and the continuation clock and cancels an armed double
 * text, but never counts as an unanswered opening.
 */
export function recordExternalSpeech(memory: UrgeGateMemory, nowMs: number): UrgeGateMemory {
  if (!isTime(nowMs))
    return memory
  return { ...normalizeMemory(memory, nowMs), lastFireAtMs: nowMs, lastSpokenAtMs: nowMs, doubleText: null }
}
