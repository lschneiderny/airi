import type { GateHardReason, GateOutcome, GateSettings, GateSignals } from './gate'
import type { SituationState, TouchObservation } from './types'

import { nextRandom, seedRng } from './rng'
import { isDenylisted } from './window-title'

// Every constant below is a starting value that has not been measured against real days. Tune them with the
// devtools inspector.

/** A pet shorter than this (merged span) stays silent. Tuning: raise to make her speak only for longer pets. */
export const PET_SPEAK_MIN_MS = 3_000
/** A pet within this long of her last line stays silent. Tuning: raise if pets interrupt her too soon after she spoke. */
export const PET_QUIET_SINCE_LINE_MS = 20_000
/** Chance an eligible pet gets a soft line. Tuning: lower if she comments on pets too often. */
export const PET_SPEAK_P = 0.3
/** Pokes within {@link POKE_BURST_WINDOW_MS} that make a protest candidate. */
export const POKE_BURST_COUNT = 3
/** Window of a poke burst, and the gap after which a new burst may roll again. */
export const POKE_BURST_WINDOW_MS = 10_000
/** Chance an eligible poke burst gets a protest; each burst rolls once. Tuning: lower if protests feel automatic. */
export const POKE_PROTEST_P = 0.8
/** No reaction within this long of the last spoken reaction line. Tuning: raise if reactions feel spammy. */
export const REACTION_REFRACTORY_MS = 45_000
/** No reaction within this long of the last attempt, whatever its outcome. */
export const REACTION_RETRY_MS = 20_000
/** An attempt whose outcome never arrives stops blocking after this long. */
export const REACTION_PENDING_MAX_MS = 30_000

/** `pet-soft`: a soft line after a long enough pet. `poke-protest`: a playful protest after a poke burst. */
export type ReactionKind = 'pet-soft' | 'poke-protest'

/** The last speak decision, until {@link settleReaction} reports its outcome. */
export interface ReactionPending {
  readonly kind: ReactionKind
  readonly eventId: string
  readonly atMs: number
}

/**
 * State the reaction policy carries between touches. Plain JSON. It owns its own Mulberry32 checkpoint, separate
 * from the urge gate's, so reactions never shift the gate's draws. Hold anchors later than the next `nowMs` (the
 * clock moved backwards) are pulled back to that `nowMs`, so a backward jump never extends a hold.
 */
export interface ReactionMemory {
  /** Chat session the counters belong to; another session resets everything but `rngState`. */
  readonly sessionId: string | null
  /** Mulberry32 checkpoint; advanced by exactly one draw per roll and by nothing else. */
  readonly rngState: number
  /** Pet spans seen in this session; a pet merged into the previous span does not count again. */
  readonly petsSeen: number
  /** `startedAtMs` of the last counted pet span. An identity key, not a hold anchor: never pulled to `nowMs`. */
  readonly lastPetStartedAtMs: number | null
  /** The current poke burst already rolled. Cleared when a poke arrives {@link POKE_BURST_WINDOW_MS} after the previous one. */
  readonly pokeBurstRolled: boolean
  /** When a reaction line was last spoken; the refractory counts from it. */
  readonly lastLineAtMs: number | null
  /** When the policy last decided to speak, whatever the outcome; the retry wait counts from it. */
  readonly lastAttemptAtMs: number | null
  readonly pending: ReactionPending | null
}

/** Gate settings the reaction policy reads; a full {@link GateSettings} fits. */
export type ReactionSettings = Pick<GateSettings, 'enabled' | 'dontDisturb' | 'quietApps'>

export interface ReactionPolicyInput {
  /** Epoch milliseconds of this evaluation, from the caller's clock. */
  readonly nowMs: number
  /** The touch that was just reduced into `situation`. */
  readonly touch: TouchObservation
  /** Id of the touch event the reducer emitted for `touch`; carried into the decision and the pending attempt. */
  readonly eventId: string
  /** The situation after reducing `touch`; its tracking holds the merged pet and the recent pokes. */
  readonly situation: SituationState
  readonly sessionId: string
  readonly signals: GateSignals
  readonly settings: ReactionSettings
}

/**
 * The gate's hard suppressors that also hold a reaction, in {@link hardReason} order. Presence, stale signals, and
 * busy states are skipped: a touch proves the user is at the stage right now.
 */
export type ReactionHardReason = Extract<
  GateHardReason,
  'disabled' | 'dont-disturb' | 'stage-hidden' | 'user-speaking' | 'user-typing' | 'character-speaking' | 'generating' | 'queued' | 'quiet-app'
>

/**
 * Why the policy held, in evaluation order. `ignored`: the situation did not record the touch (a body pet, a stale
 * or malformed touch). `roll`: the draw was at or above the kind's probability.
 */
export type ReactionHoldReason
  = | 'invalid-time'
    | 'ignored'
    | 'pet-short'
    | 'first-pet'
    | 'recent-line'
    | 'poke-count'
    | 'burst-rolled'
    | 'pending'
    | 'refractory'
    | 'retry-wait'
    | ReactionHardReason
    | 'roll'

export type ReactionDecision
  = | {
    readonly speak: true
    readonly kind: ReactionKind
    readonly eventId: string
    /** The draw, below `probability`. */
    readonly roll: number
    readonly probability: number
  }
  | {
    readonly speak: false
    readonly reason: ReactionHoldReason
    /** The kind the touch would react with, or `null` when the touch was not usable (`invalid-time`, `ignored`). */
    readonly kind: ReactionKind | null
    /** The draw when the hold is `roll`, otherwise `null` (nothing was drawn). */
    readonly roll: number | null
  }

export interface ReactionEvaluation {
  readonly decision: ReactionDecision
  readonly memory: ReactionMemory
}

export function initialReactionMemory(seed: number): ReactionMemory {
  return {
    sessionId: null,
    rngState: seedRng(seed),
    petsSeen: 0,
    lastPetStartedAtMs: null,
    pokeBurstRolled: false,
    lastLineAtMs: null,
    lastAttemptAtMs: null,
    pending: null,
  }
}

function isTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

const REACTION_KINDS: ReadonlySet<string> = new Set<ReactionKind>(['pet-soft', 'poke-protest'])

/**
 * Brings stored memory into a usable shape at `nowMs`: drops non-finite values, pulls hold anchors in the future
 * back to `nowMs`, drops a pending attempt older than {@link REACTION_PENDING_MAX_MS}, and resets everything but
 * `rngState` when the session changed.
 */
function normalizeMemory(memory: ReactionMemory, nowMs: number, sessionId: string): ReactionMemory {
  const rngState = isTime(memory.rngState) ? seedRng(memory.rngState) : 0
  if (memory.sessionId !== sessionId)
    return { ...initialReactionMemory(rngState), sessionId }

  const atMost = (time: number | null): number | null => isTime(time) ? Math.min(time, nowMs) : null
  const raw = memory.pending
  const pending = raw !== null && typeof raw === 'object' && REACTION_KINDS.has(raw.kind) && typeof raw.eventId === 'string'
    && isTime(raw.atMs) && nowMs - Math.min(raw.atMs, nowMs) < REACTION_PENDING_MAX_MS
    ? { kind: raw.kind, eventId: raw.eventId, atMs: Math.min(raw.atMs, nowMs) }
    : null

  return {
    sessionId,
    rngState,
    petsSeen: isTime(memory.petsSeen) && memory.petsSeen > 0 ? Math.floor(memory.petsSeen) : 0,
    lastPetStartedAtMs: isTime(memory.lastPetStartedAtMs) ? memory.lastPetStartedAtMs : null,
    pokeBurstRolled: memory.pokeBurstRolled === true,
    lastLineAtMs: atMost(memory.lastLineAtMs),
    lastAttemptAtMs: atMost(memory.lastAttemptAtMs),
    pending,
  }
}

/** The subset of {@link hardReason} that holds a reaction, in the same order and failing closed the same way. */
function reactionHardReason(input: ReactionPolicyInput): ReactionHardReason | null {
  const { signals, settings, situation } = input
  if (settings.enabled !== true)
    return 'disabled'
  if (settings.dontDisturb !== false)
    return 'dont-disturb'
  if (signals.stageVisible !== true)
    return 'stage-hidden'
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
  const activity = situation.activity
  if (activity !== null) {
    const quietApps = Array.isArray(settings.quietApps) ? settings.quietApps.filter((glob): glob is string => typeof glob === 'string') : []
    if (activity.category === 'call' || (activity.appId !== '' && isDenylisted(activity.appId, quietApps)))
      return 'quiet-app'
  }
  return null
}

function hold(memory: ReactionMemory, reason: ReactionHoldReason, kind: ReactionKind | null, roll: number | null = null): ReactionEvaluation {
  return { decision: { speak: false, reason, kind, roll }, memory }
}

/**
 * Decides whether the character answers a touch with a line. Pure: time comes only from `input.nowMs`, and only
 * the roll step draws, so every earlier hold leaves `rngState` unchanged.
 *
 * Order: time and memory normalization, bookkeeping (always applied), candidate (pet or poke), pacing (pending,
 * refractory, retry wait), the hard suppressor subset, then the roll. A speak decision sets `pending` and
 * `lastAttemptAtMs`; the caller reports the outcome through {@link settleReaction}.
 */
export function reactionPolicy(input: ReactionPolicyInput, memory: ReactionMemory): ReactionEvaluation {
  const { nowMs, touch, situation } = input
  if (!isTime(nowMs))
    return hold(memory, 'invalid-time', null)
  let next = normalizeMemory(memory, nowMs, input.sessionId)

  const { lastPet, pokeTimes } = situation.tracking
  const touchAtMs = touch.atMs
  // The touch is usable only when the reducer recorded it: a pet ends the latest pet span, a poke is the newest poke.
  const recorded = isTime(touchAtMs) && (touch.gesture === 'pet'
    ? lastPet !== null && lastPet.endedAtMs === touchAtMs
    : touch.gesture === 'poke' && pokeTimes.at(-1) === touchAtMs)

  // Bookkeeping. A pet span counts once, however many pets merge into it.
  if (recorded && touch.gesture === 'pet' && lastPet !== null && lastPet.startedAtMs !== next.lastPetStartedAtMs)
    next = { ...next, petsSeen: next.petsSeen + 1, lastPetStartedAtMs: lastPet.startedAtMs }
  if (recorded && touch.gesture === 'poke') {
    const previousPokeAtMs = pokeTimes.at(-2)
    if (previousPokeAtMs === undefined || touchAtMs - previousPokeAtMs >= POKE_BURST_WINDOW_MS)
      next = { ...next, pokeBurstRolled: false }
  }

  if (!recorded)
    return hold(next, 'ignored', null)

  let kind: ReactionKind
  let probability: number
  if (touch.gesture === 'pet' && lastPet !== null) {
    kind = 'pet-soft'
    if (lastPet.durationMs < PET_SPEAK_MIN_MS)
      return hold(next, 'pet-short', kind)
    if (next.petsSeen <= 1)
      return hold(next, 'first-pet', kind)
    const lastLine = Math.max(situation.conversation.lastCharacterAtMs ?? Number.NEGATIVE_INFINITY, next.lastLineAtMs ?? Number.NEGATIVE_INFINITY)
    if (nowMs - lastLine < PET_QUIET_SINCE_LINE_MS)
      return hold(next, 'recent-line', kind)
    probability = PET_SPEAK_P
  }
  else {
    kind = 'poke-protest'
    if (pokeTimes.filter(time => touchAtMs - time < POKE_BURST_WINDOW_MS).length < POKE_BURST_COUNT)
      return hold(next, 'poke-count', kind)
    if (next.pokeBurstRolled)
      return hold(next, 'burst-rolled', kind)
    probability = POKE_PROTEST_P
  }

  if (next.pending !== null)
    return hold(next, 'pending', kind)
  if (next.lastLineAtMs !== null && nowMs - next.lastLineAtMs < REACTION_REFRACTORY_MS)
    return hold(next, 'refractory', kind)
  if (next.lastAttemptAtMs !== null && nowMs - next.lastAttemptAtMs < REACTION_RETRY_MS)
    return hold(next, 'retry-wait', kind)

  const hard = reactionHardReason(input)
  if (hard !== null)
    return hold(next, hard, kind)

  const [roll, rngState] = nextRandom(next.rngState)
  next = { ...next, rngState, pokeBurstRolled: kind === 'poke-protest' ? true : next.pokeBurstRolled }
  if (roll >= probability)
    return hold(next, 'roll', kind, roll)
  return {
    decision: { speak: true, kind, eventId: input.eventId, roll, probability },
    memory: { ...next, pending: { kind, eventId: input.eventId, atMs: nowMs }, lastAttemptAtMs: nowMs },
  }
}

/**
 * Records the outcome of the pending reaction. Only `spoken` starts the refractory; a declined, cancelled, or
 * failed (refused) send clears `pending` and leaves the retry wait from the attempt as the only pacing.
 */
export function settleReaction(memory: ReactionMemory, outcome: GateOutcome, nowMs: number): ReactionMemory {
  if (!isTime(nowMs))
    return memory
  return outcome === 'spoken'
    ? { ...memory, lastLineAtMs: nowMs, pending: null }
    : { ...memory, pending: null }
}
