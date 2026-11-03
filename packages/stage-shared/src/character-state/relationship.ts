import type {
  AdvanceContext,
  CharacterEvent,
  CharacterProfile,
  ClosenessStage,
  FamiliarityStage,
  RelationshipDay,
  RelationshipLevels,
  RelationshipPoints,
  RelationshipStages,
  RelationshipState,
  TrustStage,
  Unlock,
} from './types'

import { CHARACTER_STATE_SETTINGS } from './settings'
import { CLOSENESS_STAGES, FAMILIARITY_STAGES, TRUST_STAGES } from './types'

const SETTINGS = CHARACTER_STATE_SETTINGS.relationship
const HOUR_MS = 3_600_000
const DIMENSIONS = ['closeness', 'trust', 'familiarity'] as const

type Dimension = typeof DIMENSIONS[number]
type PointsKind = keyof typeof SETTINGS.points
type NegativeKind = keyof typeof SETTINGS.negatives

const ZERO_POINTS: RelationshipPoints = { closeness: 0, trust: 0, familiarity: 0 }

interface StageLadder<S extends string> {
  /** Stages from lowest to highest. */
  readonly order: readonly S[]
  /** Up and down thresholds of every stage above the lowest. */
  readonly thresholds: Readonly<Partial<Record<S, { readonly up: number, readonly down: number }>>>
}

const LADDERS: { readonly [D in Dimension]: StageLadder<RelationshipStages[D]> } = {
  closeness: { order: CLOSENESS_STAGES, thresholds: SETTINGS.stages.closeness },
  trust: { order: TRUST_STAGES, thresholds: SETTINGS.stages.trust },
  familiarity: { order: FAMILIARITY_STAGES, thresholds: SETTINGS.stages.familiarity },
}

function thresholdAt<S extends string>(ladder: StageLadder<S>, index: number): { readonly up: number, readonly down: number } {
  const threshold = ladder.thresholds[ladder.order[index]]
  if (threshold === undefined)
    throw new Error(`stage ${ladder.order[index]} has no threshold`)
  return threshold
}

/** Index of the highest stage whose up-threshold `level` reaches. */
function qualifiedIndex<S extends string>(ladder: StageLadder<S>, level: number): number {
  let index = 0
  for (let next = 1; next < ladder.order.length; next++) {
    if (level >= thresholdAt(ladder, next).up)
      index = next
  }
  return index
}

/**
 * Applies an immediate stage-down while the level is below the stage's down-threshold, and records a pending stage-up
 * for the next rollover. A drop withdraws a pending stage-up the level no longer reaches.
 */
function settleLadder<S extends string>(ladder: StageLadder<S>, level: number, stage: S, pending: S | null): { stage: S, pending: S | null } {
  const before = ladder.order.indexOf(stage)
  let index = before
  while (index > 0 && level < thresholdAt(ladder, index).down)
    index--
  const qualified = qualifiedIndex(ladder, level)
  const qualifiedStage = qualified > index ? ladder.order[qualified] : null
  if (index < before)
    return { stage: ladder.order[index], pending: qualifiedStage }
  const pendingIndex = pending === null ? -1 : ladder.order.indexOf(pending)
  return { stage, pending: qualified > pendingIndex ? qualifiedStage ?? pending : pending }
}

/** Moves one stage toward `pending` when it is above `stage`. */
function stepToward<S extends string>(ladder: StageLadder<S>, stage: S, pending: S | null): S {
  const index = ladder.order.indexOf(stage)
  return pending !== null && ladder.order.indexOf(pending) > index ? ladder.order[index + 1] : stage
}

function emptyDay(key: string): RelationshipDay {
  return { key, sums: ZERO_POINTS, negatives: 0, milestones: 0, unwelcomeTouches: 0, countedTouchHours: [] }
}

/** The wound at `atMs`, decayed with its half-life since `woundAtMs`. */
export function currentWound(rel: RelationshipState, atMs: number): number {
  return rel.wound * 2 ** (-Math.max(0, atMs - rel.woundAtMs) / SETTINGS.woundHalfLifeMs)
}

/** Settles every dimension after a level change; see {@link settleLadder}. */
function settleStages(rel: RelationshipState): RelationshipState {
  const { levels, stages, pendingStageUps: pending } = rel
  const closeness = settleLadder(LADDERS.closeness, levels.closeness, stages.closeness, pending.closeness)
  const trust = settleLadder(LADDERS.trust, levels.trust, stages.trust, pending.trust)
  const familiarity = settleLadder(LADDERS.familiarity, levels.familiarity, stages.familiarity, pending.familiarity)
  return {
    ...rel,
    stages: { closeness: closeness.stage, trust: trust.stage, familiarity: familiarity.stage },
    pendingStageUps: { closeness: closeness.pending, trust: trust.pending, familiarity: familiarity.pending },
  }
}

/**
 * Adds one event's points to the day's sums. With `E(S) = G (1 - e^-S)`, each level moves by `(1 - level) ΔE'`, where
 * `ΔE' = (E(S + x) - E(S)) / (1 - E(S))` is the event's share of the room left today; a day's gain therefore equals
 * `(1 - level at day start) E(S)` for any split of its events and never exceeds `G`. Trust gains are damped by
 * `(1 - wound)`.
 */
function addPoints(rel: RelationshipState, kind: PointsKind, atMs: number): RelationshipState {
  const points = SETTINGS.points[kind]
  const wound = currentWound(rel, atMs)
  const levels: Record<Dimension, number> = { ...rel.levels }
  const sums: Record<Dimension, number> = { ...rel.day.sums }
  for (const dimension of DIMENSIONS) {
    const gain = SETTINGS.dailyGain[dimension]
    const before = gain * (1 - Math.exp(-sums[dimension]))
    sums[dimension] += points[dimension]
    const after = gain * (1 - Math.exp(-sums[dimension]))
    const share = (after - before) / (1 - before) * (dimension === 'trust' ? 1 - wound : 1)
    levels[dimension] = Math.min(1, levels[dimension] + (1 - levels[dimension]) * share)
  }
  return settleStages({ ...rel, levels, day: { ...rel.day, sums } })
}

/** Applies a negative event unless the day's negative cap is spent. */
function addNegative(rel: RelationshipState, kind: NegativeKind, atMs: number): RelationshipState {
  if (rel.day.negatives >= SETTINGS.maxNegativesPerDay)
    return rel
  const negative = SETTINGS.negatives[kind]
  const wound = negative.wound > 0
    ? { wound: Math.min(1, currentWound(rel, atMs) + negative.wound), woundAtMs: atMs }
    : {}
  return settleStages({
    ...rel,
    ...wound,
    levels: {
      ...rel.levels,
      closeness: Math.max(0, rel.levels.closeness - negative.closenessDrop),
      trust: rel.levels.trust * negative.trustFactor,
    },
    day: { ...rel.day, negatives: rel.day.negatives + 1 },
  })
}

/**
 * Familiarity erosion after the user was away for `gapMs`: nothing within the grace, then
 * `f = r f + (1 - r) f 2^(-(g - grace) / halfLife)`. Closeness and trust never change from absence. A gap that is not
 * a finite number beyond the grace returns `rel` unchanged.
 */
export function absenceOnReturn(rel: RelationshipState, gapMs: number): RelationshipState {
  const { graceMs, retained, halfLifeMs } = SETTINGS.absence
  if (!Number.isFinite(gapMs) || gapMs <= graceMs)
    return rel
  const familiarity = rel.levels.familiarity
  const eroded = retained * familiarity + (1 - retained) * familiarity * 2 ** (-(gapMs - graceMs) / halfLifeMs)
  return settleStages({ ...rel, levels: { ...rel.levels, familiarity: eroded } })
}

/**
 * Applies one character event to the relationship (plan Appendix A5). Points accumulate per logical day of
 * `event.atMs`; a new day starts fresh sums and caps. Negative events and the stage-downs they cause apply at once;
 * stage-ups wait for {@link rolloverStages}. A `return` event applies {@link absenceOnReturn}. Events without a
 * relationship part, and unknown kinds, return `rel` unchanged.
 */
export function applyRelationshipEvent(rel: RelationshipState, event: CharacterEvent, ctx: AdvanceContext): RelationshipState {
  const seen = (next: RelationshipState) => ({ ...next, lastSeenAtMs: event.atMs })
  const dayKey = ctx.logicalDayKeyOf(event.atMs)
  const today = rel.day.key === dayKey ? rel : { ...rel, day: emptyDay(dayKey) }

  switch (event.kind) {
    case 'user-turn':
      if (event.exchange === 'first-real')
        return seen({ ...addPoints(today, 'first-real-exchange', event.atMs), activeDays: rel.activeDays + 1 })
      return seen(event.exchange === 'later' ? addPoints(today, 'later-user-turn', event.atMs) : today)
    case 'reach-out-reply':
      return seen(addPoints(today, 'reach-out-reply', event.atMs))
    case 'disclosure':
      return addPoints(today, 'disclosure', event.atMs)
    case 'kept-promise':
      return addPoints(today, 'kept-promise', event.atMs)
    case 'ritual-reciprocated':
      return seen(addPoints(today, 'ritual-reciprocated', event.atMs))
    case 'milestone': {
      if (today.day.milestones >= SETTINGS.maxMilestonesPerDay)
        return today
      const next = addPoints(today, 'milestone', event.atMs)
      const milestoneIds = rel.milestoneIds.includes(event.memoryId)
        ? rel.milestoneIds
        : [...rel.milestoneIds, event.memoryId].slice(-SETTINGS.maxMilestoneIds)
      return { ...next, milestoneIds, day: { ...next.day, milestones: next.day.milestones + 1 } }
    }
    case 'touch-pleasant': {
      const hourMs = Math.floor(event.atMs / HOUR_MS) * HOUR_MS
      if (today.day.countedTouchHours.includes(hourMs))
        return seen(today)
      const next = addPoints(today, 'touch-pleasant', event.atMs)
      return seen({ ...next, day: { ...next.day, countedTouchHours: [...next.day.countedTouchHours, hourMs] } })
    }
    case 'touch-unwelcome': {
      const unwelcomeTouches = today.day.unwelcomeTouches + 1
      const counted = { ...today, day: { ...today.day, unwelcomeTouches } }
      return seen(unwelcomeTouches === SETTINGS.persistentUnwelcomeTouchBurst
        ? addNegative(counted, 'touch-unwelcome-persistent', event.atMs)
        : counted)
    }
    case 'unkind':
    case 'hurtful':
      return addNegative(today, event.kind, event.atMs)
    case 'return':
      return seen(absenceOnReturn(today, event.gapMs))
    case 'model-cue':
    case 'reach-out-unanswered':
    case 'late-reply':
    case 'character-spoke':
    case 'significant-positive':
    case 'significant-negative':
      return today
    default:
      return rel
  }
}

/**
 * The 04:00 rollover into logical day `dayKey`: each dimension moves at most one stage toward its pending stage-up,
 * the pending stage-ups are recomputed from the levels, and the day bookkeeping starts fresh. Calling it again with
 * the processed day key returns `rel` unchanged.
 */
export function rolloverStages(rel: RelationshipState, dayKey: string): RelationshipState {
  if (rel.lastDayKey === dayKey)
    return rel
  const { stages, pendingStageUps: pending } = rel
  return settleStages({
    ...rel,
    stages: {
      closeness: stepToward(LADDERS.closeness, stages.closeness, pending.closeness),
      trust: stepToward(LADDERS.trust, stages.trust, pending.trust),
      familiarity: stepToward(LADDERS.familiarity, stages.familiarity, pending.familiarity),
    },
    pendingStageUps: { closeness: null, trust: null, familiarity: null },
    day: rel.day.key === dayKey ? rel.day : emptyDay(dayKey),
    lastDayKey: dayKey,
  })
}

function reaches(stages: RelationshipStages, dimension: Dimension, stage: string): boolean {
  const order: readonly string[] = LADDERS[dimension].order
  return order.indexOf(stages[dimension]) >= order.indexOf(stage)
}

/** Behaviour unlocked by the stages and the number of shared milestones (plan Appendix A6), in a fixed order. */
export function unlocksOf(stages: RelationshipStages, milestoneCount: number): Unlock[] {
  const { teasing, nicknames, initiative, vulnerability, callbacks } = SETTINGS.unlocks
  const unlocks: Unlock[] = []
  if (reaches(stages, 'closeness', teasing.closeness) && reaches(stages, 'trust', teasing.trust))
    unlocks.push('teasing')
  if (reaches(stages, 'closeness', nicknames.closeness) && reaches(stages, 'familiarity', nicknames.familiarity))
    unlocks.push('nicknames')
  if (reaches(stages, 'closeness', initiative.closeness))
    unlocks.push('initiative')
  if (reaches(stages, 'closeness', vulnerability.closeness) && reaches(stages, 'trust', vulnerability.trust))
    unlocks.push('vulnerability')
  if (reaches(stages, 'familiarity', callbacks.familiarity) && milestoneCount >= callbacks.minMilestones)
    unlocks.push('callbacks')
  return unlocks
}

/**
 * The relationship a new card starts with: closeness at its starting stage's up-threshold plus the margin (0 for
 * `stranger`), trust and familiarity at 0. The empty day keys make the first event and rollover start a fresh day.
 */
export function initialRelationship(profile: CharacterProfile): RelationshipState {
  const closenessStage: ClosenessStage = profile.startingStage
  const closeness = closenessStage === 'stranger'
    ? 0
    : SETTINGS.stages.closeness[closenessStage].up + SETTINGS.startingStageMargin
  const trust: TrustStage = 'guarded'
  const familiarity: FamiliarityStage = 'new'
  return {
    levels: { closeness, trust: 0, familiarity: 0 } satisfies RelationshipLevels,
    stages: { closeness: closenessStage, trust, familiarity },
    wound: 0,
    woundAtMs: 0,
    day: emptyDay(''),
    activeDays: 0,
    milestoneIds: [],
    lastSeenAtMs: null,
    lastDayKey: '',
    pendingStageUps: { closeness: null, trust: null, familiarity: null },
  }
}
