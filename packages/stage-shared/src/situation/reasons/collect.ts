import type { SituationState } from '../types'
import type { Reason, ReasonCategory, ReasonState } from './types'

import { URGENT_SALIENCE } from '../gate'
import { effectiveSalience } from '../reducer'
import { DUE_BUMP_WINDOW_MS } from '../urge'
import { openRituals, ritualHazardPerHour } from './rituals'
import { eligibleThreads, threadRipeness } from './threads'
import {
  GATE_ELIGIBLE_EVENT_KINDS,
  LONG_SESSION_MIN_TIER,
  OWN_DAY_RECOVERY_HALF_LIFE_MS,
  OWN_DAY_SALIENCE,
  OWN_DAY_WEIGHT_MAX,
  REASON_TEXT,
  SCREEN_SELECTION_WEIGHT,
  SELECTION_BETA,
  THREAD_TUNING,
} from './types'

/** Tuning: a `returned` event waits this long so he can settle in before she reacts. */
const RETURNED_MIN_AGE_MS = 3 * 60_000

/** Categories the gate draws by competing hazards; `double-text` and `urgent` bypass the draw. */
export type HazardCategory = Extract<ReasonCategory, 'open' | 'continuation' | 'ritual' | 'due'>

/** Categories that need a picked reason; `continuation` reuses the pending topic instead. */
export type PickCategory = Exclude<HazardCategory, 'continuation'>

const HAZARD_ORDER: readonly HazardCategory[] = ['open', 'continuation', 'ritual', 'due']

type ScreenEventKind = keyof typeof SCREEN_SELECTION_WEIGHT

function screenReasons(situation: SituationState, nowMs: number): Reason[] {
  let returnedAtMs: number | null = null
  for (const event of situation.events) {
    if (event.kind === 'returned' && event.origin === 'world' && Number.isFinite(event.atMs))
      returnedAtMs = returnedAtMs === null ? event.atMs : Math.max(returnedAtMs, event.atMs)
  }

  const reasons: Reason[] = []
  for (const event of situation.events) {
    // Self-origin events never qualify: the character's own turns and windows
    // must not give her something to talk about.
    if (event.origin !== 'world' || event.addressedAtMs !== null || !GATE_ELIGIBLE_EVENT_KINDS.has(event.kind))
      continue
    // The eligible set and the weight table name the same kinds (pinned by types.test.ts).
    const kind = event.kind as ScreenEventKind
    const text = typeof event.text === 'string' ? event.text.trim() : ''
    if (typeof event.topicKey !== 'string' || event.topicKey === '' || text === '')
      continue
    if (kind === 'long-session') {
      if (event.tier < LONG_SESSION_MIN_TIER)
        continue
      // A `long-session` event that matured before the latest `returned` event
      // is skipped: the reducer keeps counting tiers while the user is away,
      // so such a tier describes time the user did not spend in the app.
      if (returnedAtMs !== null && event.atMs < returnedAtMs)
        continue
    }
    if (kind === 'returned' && nowMs - event.atMs < RETURNED_MIN_AGE_MS)
      continue
    const ripeness = event.salience > 0 ? effectiveSalience(event, nowMs) / event.salience : 0
    reasons.push({
      key: event.topicKey,
      kind,
      category: 'open',
      text,
      sourceEventId: event.id,
      ripeness,
      weight: SCREEN_SELECTION_WEIGHT[kind] * ripeness ** SELECTION_BETA,
      urgent: kind === 'notify' && event.salience >= URGENT_SALIENCE,
      dueAtMs: null,
      dueNow: false,
    })
  }
  return reasons
}

/**
 * Every reason she could reach out for at `nowMs`, sorted by `key` (then
 * source event id) so callers see a stable order.
 *
 * A reason whose key is in `heldTopics` is never returned, urgent notifies
 * included: a held topic stays unselectable until its holder releases it
 * (the `holdTopic` contract widget reactions rely on).
 *
 * Screen reasons come only from settled world events (`long-session` tier 2+,
 * `returned` after 3 min, `notify`). Thread reasons are scoped to `sessionId`.
 * The collector only flags `urgent` and `dueNow`; the gate chooses the
 * category it fires under.
 */
export function collectReasons(input: {
  situation: SituationState
  reasons: ReasonState
  nowMs: number
  sessionId: string
  heldTopics: ReadonlySet<string>
  lastOwnDayAtMs: number | null
}): readonly Reason[] {
  const { situation, reasons, nowMs, sessionId, heldTopics, lastOwnDayAtMs } = input
  const collected: Reason[] = screenReasons(situation, nowMs)

  for (const thread of eligibleThreads(reasons.threads, nowMs, { sessionId, heldTopics })) {
    const ripeness = threadRipeness(thread, nowMs)
    collected.push({
      key: thread.topicKey,
      kind: `thread-${thread.kind}`,
      category: 'open',
      text: thread.cue,
      sourceEventId: null,
      ripeness,
      weight: THREAD_TUNING[thread.kind].selectionWeight * ripeness ** SELECTION_BETA,
      urgent: false,
      dueAtMs: thread.dueAtMs,
      dueNow: thread.kind === 'later' && thread.dueAtMs !== null
        && thread.dueAtMs >= nowMs - DUE_BUMP_WINDOW_MS && thread.dueAtMs <= nowMs,
    })
  }

  // A backward clock jump counts as "just raised" rather than a negative weight.
  const sinceOwnDayMs = lastOwnDayAtMs === null ? null : Math.max(0, nowMs - lastOwnDayAtMs)
  collected.push({
    key: 'own-day',
    kind: 'own-day',
    category: 'open',
    text: REASON_TEXT['own-day'],
    sourceEventId: null,
    ripeness: OWN_DAY_SALIENCE,
    weight: sinceOwnDayMs === null
      ? OWN_DAY_WEIGHT_MAX
      : OWN_DAY_WEIGHT_MAX * (1 - 2 ** (-sinceOwnDayMs / OWN_DAY_RECOVERY_HALF_LIFE_MS)),
    urgent: false,
    dueAtMs: null,
    dueNow: false,
  })

  // Every open ritual is offered, so overlapping windows (an overnight absence
  // opening both greeting and welcome-back) compete by rate in `pickReason`.
  if (reasons.rituals !== null) {
    for (const kind of openRituals(reasons.rituals, nowMs)) {
      collected.push({
        key: `ritual:${kind}`,
        kind: `ritual-${kind}`,
        category: 'ritual',
        text: REASON_TEXT[`ritual-${kind}`],
        sourceEventId: null,
        ripeness: 1,
        weight: ritualHazardPerHour(kind),
        urgent: false,
        dueAtMs: null,
        dueNow: false,
      })
    }
  }

  return collected
    .filter(reason => !heldTopics.has(reason.key))
    .sort((a, b) => compareText(a.key, b.key) || compareText(a.sourceEventId ?? '', b.sourceEventId ?? ''))
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Cumulative pick over `hazards` in `open, continuation, ritual, due` order; `roll` is in [0, 1). */
export function pickCategory(hazards: Readonly<Record<HazardCategory, number>>, roll: number): HazardCategory {
  const positive = HAZARD_ORDER.filter(category => hazards[category] > 0)
  const total = positive.reduce((sum, category) => sum + hazards[category], 0)
  const target = roll * total
  let cumulative = 0
  for (const category of positive) {
    cumulative += hazards[category]
    if (target < cumulative)
      return category
  }
  // Rounding can leave `target` at the total; the last positive hazard owns that edge.
  return positive.at(-1) ?? 'open'
}

/**
 * The reason to fire under `category`, or `null` when none qualifies (the gate
 * then holds with `no-topic`).
 *
 * `open` and `ritual` pick by cumulative weight among positive-weight reasons
 * of that category: weighted random, not argmax, so lighter reasons still
 * surface sometimes and the pick does not flap between near-equal leaders.
 * `due` ignores `roll` and takes the `dueNow` reason with the earliest
 * `dueAtMs`, the first by key on a tie.
 */
export function pickReason(reasons: readonly Reason[], category: PickCategory, roll: number): Reason | null {
  if (category === 'due') {
    let earliest: Reason | null = null
    for (const reason of reasons) {
      if (reason.dueNow && reason.dueAtMs !== null && (earliest === null || reason.dueAtMs < (earliest.dueAtMs ?? Infinity)))
        earliest = reason
    }
    return earliest
  }

  const candidates = reasons.filter(reason => reason.category === category && reason.weight > 0)
  const total = candidates.reduce((sum, reason) => sum + reason.weight, 0)
  const target = roll * total
  let cumulative = 0
  for (const reason of candidates) {
    cumulative += reason.weight
    if (target < cumulative)
      return reason
  }
  return candidates.at(-1) ?? null
}
