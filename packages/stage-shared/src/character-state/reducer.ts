import type {
  AdvanceContext,
  AppliedEvents,
  CharacterEvent,
  CharacterEventKind,
  CharacterProfile,
  CharacterStateRecordV1,
  DailySummary,
  MoodAxes,
  RelationshipLevels,
  RelationshipStages,
  RelationshipState,
} from './types'

import { is } from 'valibot'

import { insertContribution, pruneMood } from './mood'
import { applyRelationshipEvent, currentWound, initialRelationship, rolloverStages } from './relationship'
import { CHARACTER_STATE_SETTINGS } from './settings'
import { advanceTemperament } from './temperament'
import { CharacterEventSchema, MAX_APPLIED_EVENT_IDS } from './types'

const { stepMs, sampleOffsetMs } = CHARACTER_STATE_SETTINGS.temperament
const DAY_MS = 24 * 3_600_000
/** Far enough past a logical day start to land inside the next logical day, even across a 23 or 25 hour day. */
const NEXT_DAY_PROBE_MS = 1.5 * DAY_MS
/** A wound that has decayed below this is cleared; it no longer measurably damps trust gains. */
const WOUND_FLOOR = 0.001

const INTERACTION_KINDS: ReadonlySet<CharacterEventKind> = new Set(['user-turn', 'touch-pleasant', 'touch-unwelcome', 'character-spoke'])

interface StageSnapshot {
  readonly levels: RelationshipLevels
  readonly stages: RelationshipStages
}

function clampAxes(axes: MoodAxes): MoodAxes {
  const signed = (value: number) => Math.min(1, Math.max(-1, value))
  return { valence: signed(axes.valence), energy: signed(axes.energy), tension: Math.min(1, Math.max(0, axes.tension)) }
}

/**
 * The state of a new card at `ctx.nowMs`: no mood contributions, temperament at the profile's resting disposition
 * from the current epoch hour, and the relationship at the profile's starting stage, rolled over into today.
 */
export function initialCharacterState(cardId: string, profile: CharacterProfile, ctx: AdvanceContext): CharacterStateRecordV1 {
  const throughHourMs = Math.floor(ctx.nowMs / stepMs) * stepMs
  return {
    version: 1,
    cardId,
    createdAtMs: ctx.nowMs,
    updatedAtMs: ctx.nowMs,
    lastInteractionAtMs: null,
    mood: { contributions: [], modelCueLog: [] },
    temperament: {
      axes: { ...profile.resting },
      throughHourMs,
      day: { key: ctx.logicalDayKeyOf(throughHourMs + sampleOffsetMs), sum: { valence: 0, energy: 0, tension: 0 }, samples: 0 },
    },
    relationship: rolloverStages(initialRelationship(profile), ctx.logicalDayKeyOf(ctx.nowMs)),
    history: [],
    appliedEvents: { recent: [], evictedThroughMs: null },
  }
}

/**
 * The instant up to which rollovers and pruning may run: `nowMs`, but never past the next unprocessed temperament
 * sample (`throughHourMs + 30 min`). Pruning later would drop contributions that sample still needs, and rolling a
 * day over before temperament closed it would record the closed day with the next day's stages; either would make
 * the result depend on how `advance` calls are split.
 */
function horizonOf(nowMs: number, throughHourMs: number): number {
  return Math.min(nowMs, throughHourMs + sampleOffsetMs)
}

/**
 * Runs {@link rolloverStages} for every logical day starting in `(fromMs's day, toMs]`, oldest first. Returns the
 * relationship and, per logical day it rolled out of, the levels and stages that day closed with. Once no stage-up is
 * pending the remaining rollovers cannot change levels or stages, so it jumps to the last one.
 */
function rollOver(rel: RelationshipState, fromMs: number, toMs: number, ctx: AdvanceContext): { rel: RelationshipState, closing: Map<string, StageSnapshot> } {
  const closing = new Map<string, StageSnapshot>()
  let start = ctx.logicalDayStartOf(fromMs)
  while (true) {
    const next = ctx.logicalDayStartOf(start + NEXT_DAY_PROBE_MS)
    if (!(next > start) || next > toMs)
      break
    start = next
    const key = ctx.logicalDayKeyOf(start)
    if (key === rel.lastDayKey)
      continue
    closing.set(rel.lastDayKey, { levels: rel.levels, stages: rel.stages })
    rel = rolloverStages(rel, key)
    const { closeness, trust, familiarity } = rel.pendingStageUps
    if (closeness === null && trust === null && familiarity === null) {
      const last = ctx.logicalDayStartOf(toMs)
      if (last > start)
        rel = rolloverStages(rel, ctx.logicalDayKeyOf(last))
      break
    }
  }
  return { rel, closing }
}

/**
 * Brings the state forward to `ctx.nowMs`: advances temperament over the completed epoch hours, runs the 04:00
 * rollover once per crossed logical day, appends one {@link DailySummary} per logical day temperament completed
 * (newest 400 kept), clears a wound that has decayed away, and prunes expired mood. The result depends only on the
 * instants reached, so `advance(advance(s, t1), t2)` equals `advance(s, t2)` while no call spans more than the
 * temperament's per-call limit; a `nowMs` at or before `updatedAtMs`, or not finite, returns `state` itself.
 */
export function advance(state: CharacterStateRecordV1, profile: CharacterProfile, ctx: AdvanceContext): CharacterStateRecordV1 {
  const { nowMs } = ctx
  if (!Number.isFinite(nowMs) || nowMs <= state.updatedAtMs)
    return state

  const { temperament, completedDays } = advanceTemperament(state.temperament, state.mood.contributions, profile.resting, ctx)
  const horizon = horizonOf(nowMs, temperament.throughHourMs)
  const rolled = rollOver(state.relationship, horizonOf(state.updatedAtMs, state.temperament.throughHourMs), horizon, ctx)
  let relationship = rolled.rel
  if (relationship.wound > 0 && currentWound(relationship, nowMs) < WOUND_FLOOR)
    relationship = { ...relationship, wound: 0 }

  const rows: DailySummary[] = completedDays.map((day) => {
    const closed = rolled.closing.get(day.key) ?? relationship
    return {
      dayKey: day.key,
      mood: clampAxes({ valence: day.sum.valence / day.samples, energy: day.sum.energy / day.samples, tension: day.sum.tension / day.samples }),
      temperament: day.temperament,
      levels: closed.levels,
      stages: closed.stages,
    }
  })

  return {
    ...state,
    updatedAtMs: nowMs,
    mood: pruneMood(state.mood, horizon),
    temperament,
    relationship,
    history: rows.length === 0 ? state.history : [...state.history, ...rows].slice(-CHARACTER_STATE_SETTINGS.history.maxRows),
  }
}

function remember(applied: AppliedEvents, event: CharacterEvent): AppliedEvents {
  const recent = [...applied.recent, { id: event.id, atMs: event.atMs }]
  if (recent.length <= MAX_APPLIED_EVENT_IDS)
    return { ...applied, recent }
  const evicted = recent.slice(0, recent.length - MAX_APPLIED_EVENT_IDS)
  const evictedThroughMs = Math.max(applied.evictedThroughMs ?? Number.NEGATIVE_INFINITY, ...evicted.map(entry => entry.atMs))
  return { recent: recent.slice(-MAX_APPLIED_EVENT_IDS), evictedThroughMs }
}

/**
 * Applies one event: advances to `event.atMs`, then adds its mood part (Appendix A2) and relationship part (A5), and
 * records `lastInteractionAtMs` for user turns, touch, and character speech. The event is a no-op, returning `state`
 * itself, when it is malformed, when its id was already applied (even if a budget refused it or its contribution was
 * pruned), when it is at or before the newest evicted id, or when it belongs to a logical day before the one of
 * `updatedAtMs`. The last rule keeps the relationship's per-day sums moving forward, so events alternating between two
 * days cannot each start a fresh daily allowance.
 */
export function applyEvent(state: CharacterStateRecordV1, event: CharacterEvent, profile: CharacterProfile, ctx: AdvanceContext): CharacterStateRecordV1 {
  if (!is(CharacterEventSchema, event))
    return state
  const { appliedEvents } = state
  if (event.atMs < ctx.logicalDayStartOf(state.updatedAtMs))
    return state
  if (appliedEvents.evictedThroughMs !== null && event.atMs <= appliedEvents.evictedThroughMs)
    return state
  if (appliedEvents.recent.some(entry => entry.id === event.id))
    return state

  const advanced = advance(state, profile, { ...ctx, nowMs: event.atMs })
  const lastInteractionAtMs = INTERACTION_KINDS.has(event.kind)
    ? Math.max(advanced.lastInteractionAtMs ?? Number.NEGATIVE_INFINITY, event.atMs)
    : advanced.lastInteractionAtMs
  return {
    ...advanced,
    updatedAtMs: Math.max(advanced.updatedAtMs, event.atMs),
    lastInteractionAtMs,
    mood: insertContribution(advanced.mood, event, ctx),
    relationship: applyRelationshipEvent(advanced.relationship, event, ctx),
    appliedEvents: remember(appliedEvents, event),
  }
}
