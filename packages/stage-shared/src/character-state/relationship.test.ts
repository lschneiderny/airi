import type { AdvanceContext, CharacterEvent, RelationshipLevels, RelationshipStages, RelationshipState } from '.'

import { describe, expect, it } from 'vitest'

import {
  absenceOnReturn,
  applyRelationshipEvent,
  CHARACTER_STATE_SETTINGS,
  DEFAULT_CHARACTER_PROFILE,
  initialRelationship,
  rolloverStages,
  unlocksOf,
} from '.'
import { nextRandom, seedRng } from '../situation/rng'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const ROLLOVER_MS = 4 * HOUR_MS
/** 04:00 UTC, the start of the logical day 2026-11-03. */
const START_MS = Date.UTC(2026, 10, 3, 4)
const { dailyGain, stages: thresholds } = CHARACTER_STATE_SETTINGS.relationship

/** UTC test context: the logical day rolls over at 04:00 UTC. */
function contextAt(nowMs: number): AdvanceContext {
  return {
    nowMs,
    logicalDayKeyOf: ms => new Date(ms - ROLLOVER_MS).toISOString().slice(0, 10),
    logicalDayStartOf: ms => Math.floor((ms - ROLLOVER_MS) / DAY_MS) * DAY_MS + ROLLOVER_MS,
  }
}

const dayKeyOf = (ms: number) => contextAt(ms).logicalDayKeyOf(ms)

function apply(rel: RelationshipState, event: CharacterEvent): RelationshipState {
  return applyRelationshipEvent(rel, event, contextAt(event.atMs))
}

function applyAll(rel: RelationshipState, events: readonly CharacterEvent[]): RelationshipState {
  return events.reduce(apply, rel)
}

let eventIndex = 0
function laterTurn(atMs: number): CharacterEvent {
  return { kind: 'user-turn', id: `turn-${eventIndex++}`, atMs, exchange: 'later' }
}

function relationshipWith(levels: RelationshipLevels, stages: RelationshipStages, dayKey = dayKeyOf(START_MS)): RelationshipState {
  const initial = initialRelationship(DEFAULT_CHARACTER_PROFILE)
  return { ...initial, levels, stages, lastDayKey: dayKey, day: { ...initial.day, key: dayKey } }
}

const zeroLevels: RelationshipLevels = { closeness: 0, trust: 0, familiarity: 0 }
const firstStages: RelationshipStages = { closeness: 'stranger', trust: 'guarded', familiarity: 'new' }

describe('initialRelationship', () => {
  it('maps a starting stage to its up-threshold plus the margin', () => {
    expect(initialRelationship(DEFAULT_CHARACTER_PROFILE).levels).toEqual(zeroLevels)
    expect(initialRelationship(DEFAULT_CHARACTER_PROFILE).stages).toEqual(firstStages)
    const close = initialRelationship({ ...DEFAULT_CHARACTER_PROFILE, startingStage: 'close' })
    expect(close.levels.closeness).toBeCloseTo(0.36, 10)
    expect(close.stages.closeness).toBe('close')
    expect(initialRelationship({ ...DEFAULT_CHARACTER_PROFILE, startingStage: 'friendly' }).levels.closeness).toBeCloseTo(0.16, 10)
  })
})

describe('applyRelationshipEvent daily diminishing returns', () => {
  it('caps a farmed day with point sum 10 at G per dimension within 1e-4, and never above G', () => {
    let rel = relationshipWith(zeroLevels, firstStages)
    // 200 later user turns: closeness and familiarity sums reach 10.
    for (let index = 0; index < 200; index++) {
      const before = rel.levels
      rel = apply(rel, laterTurn(START_MS + HOUR_MS + index * MINUTE_MS))
      expect(rel.levels.closeness).toBeGreaterThanOrEqual(before.closeness)
      expect(rel.levels.closeness).toBeLessThanOrEqual(dailyGain.closeness)
      expect(rel.levels.familiarity).toBeLessThanOrEqual(dailyGain.familiarity)
    }
    // 25 kept promises: the trust sum reaches 10.
    for (let index = 0; index < 25; index++)
      rel = apply(rel, { kind: 'kept-promise', id: `promise-${index}`, atMs: START_MS + 5 * HOUR_MS + index * MINUTE_MS, reason: 'he called back' })

    expect(rel.day.sums.closeness).toBeCloseTo(10, 9)
    expect(rel.day.sums.familiarity).toBeCloseTo(10, 9)
    expect(rel.day.sums.trust).toBeCloseTo(10, 9)
    expect(Math.abs(rel.levels.closeness - dailyGain.closeness)).toBeLessThan(1e-4)
    expect(Math.abs(rel.levels.familiarity - dailyGain.familiarity)).toBeLessThan(1e-4)
    expect(Math.abs(rel.levels.trust - dailyGain.trust)).toBeLessThan(1e-4)
    expect(rel.levels.closeness).toBeLessThanOrEqual(dailyGain.closeness)
    expect(rel.levels.trust).toBeLessThanOrEqual(dailyGain.trust)
    expect(rel.levels.familiarity).toBeLessThanOrEqual(dailyGain.familiarity)
  })

  it('starts fresh day sums on the next logical day', () => {
    let rel = relationshipWith(zeroLevels, firstStages)
    for (let index = 0; index < 200; index++)
      rel = apply(rel, laterTurn(START_MS + HOUR_MS + index * MINUTE_MS))
    const afterDayOne = rel.levels.closeness
    rel = apply(rel, laterTurn(START_MS + DAY_MS + HOUR_MS))
    expect(rel.day.key).toBe(dayKeyOf(START_MS + DAY_MS))
    expect(rel.day.sums.closeness).toBeCloseTo(0.05, 10)
    expect(rel.levels.closeness).toBeGreaterThan(afterDayOne)
  })

  it('counts a pleasant touch at most once per hour and a milestone at most once per day', () => {
    let rel = relationshipWith(zeroLevels, firstStages)
    rel = applyAll(rel, [
      { kind: 'touch-pleasant', id: 'touch-1', atMs: START_MS + HOUR_MS },
      { kind: 'touch-pleasant', id: 'touch-2', atMs: START_MS + HOUR_MS + 30 * MINUTE_MS },
      { kind: 'touch-pleasant', id: 'touch-3', atMs: START_MS + 2 * HOUR_MS },
    ])
    expect(rel.day.sums.closeness).toBeCloseTo(0.2, 10)

    rel = applyAll(rel, [
      { kind: 'milestone', id: 'm-1', atMs: START_MS + 3 * HOUR_MS, reason: 'first movie night', memoryId: 'memory-1' },
      { kind: 'milestone', id: 'm-2', atMs: START_MS + 4 * HOUR_MS, reason: 'second movie night', memoryId: 'memory-2' },
    ])
    expect(rel.milestoneIds).toEqual(['memory-1'])
    expect(rel.day.milestones).toBe(1)
    expect(rel.day.sums.closeness).toBeCloseTo(0.7, 10)
  })

  it('keeps the newest 64 milestone ids', () => {
    let rel = relationshipWith(zeroLevels, firstStages)
    for (let day = 0; day < 70; day++)
      rel = apply(rel, { kind: 'milestone', id: `m-${day}`, atMs: START_MS + day * DAY_MS + HOUR_MS, reason: 'a shared moment', memoryId: `memory-${day}` })
    expect(rel.milestoneIds).toHaveLength(64)
    expect(rel.milestoneIds[0]).toBe('memory-6')
    expect(rel.milestoneIds.at(-1)).toBe('memory-69')
  })

  it('damps trust gains by the wound, which halves in five days', () => {
    const promise = (id: string, atMs: number): CharacterEvent => ({ kind: 'kept-promise', id, atMs, reason: 'he called back' })
    const healthy = apply(relationshipWith(zeroLevels, firstStages), promise('p-1', START_MS + HOUR_MS))
    const wounded = { ...relationshipWith(zeroLevels, firstStages), wound: 0.5, woundAtMs: START_MS + HOUR_MS }
    expect(apply(wounded, promise('p-2', START_MS + HOUR_MS)).levels.trust).toBeCloseTo(healthy.levels.trust * 0.5, 12)
    expect(apply(wounded, promise('p-3', START_MS + HOUR_MS + 5 * DAY_MS)).levels.trust).toBeCloseTo(healthy.levels.trust * 0.75, 12)
  })
})

describe('applyRelationshipEvent negatives', () => {
  const levels: RelationshipLevels = { closeness: 0.5, trust: 0.5, familiarity: 0.5 }
  const stages: RelationshipStages = { closeness: 'close', trust: 'confiding', familiarity: 'knows-you' }

  it('drops trust by 15% on a hurtful event and ignores negatives beyond two per day', () => {
    let rel = relationshipWith(levels, stages)
    rel = apply(rel, { kind: 'hurtful', id: 'h-1', atMs: START_MS + HOUR_MS, reason: 'he mocked her' })
    expect(rel.levels.trust).toBeCloseTo(0.425, 12)
    expect(rel.levels.closeness).toBeCloseTo(0.47, 12)
    expect(rel.wound).toBeCloseTo(0.15, 12)

    rel = apply(rel, { kind: 'unkind', id: 'u-1', atMs: START_MS + 2 * HOUR_MS, reason: 'he snapped at her' })
    expect(rel.levels.trust).toBeCloseTo(0.425 * 0.95, 12)
    const capped = rel
    rel = applyAll(rel, [
      { kind: 'hurtful', id: 'h-2', atMs: START_MS + 3 * HOUR_MS, reason: 'he mocked her again' },
      { kind: 'unkind', id: 'u-2', atMs: START_MS + 4 * HOUR_MS, reason: 'he snapped again' },
    ])
    expect(rel.levels).toEqual(capped.levels)
    expect(rel.wound).toBe(capped.wound)
    expect(rel.day.negatives).toBe(2)
  })

  it('costs trust on the third unwelcome touch burst of a day only', () => {
    let rel = relationshipWith(levels, stages)
    const burst = (index: number): CharacterEvent => ({ kind: 'touch-unwelcome', id: `poke-${index}`, atMs: START_MS + index * HOUR_MS })
    rel = applyAll(rel, [burst(1), burst(2)])
    expect(rel.levels.trust).toBe(0.5)
    rel = apply(rel, burst(3))
    expect(rel.levels.trust).toBeCloseTo(0.485, 12)
    rel = apply(rel, burst(4))
    expect(rel.levels.trust).toBeCloseTo(0.485, 12)
    expect(rel.day.unwelcomeTouches).toBe(4)
    expect(rel.day.negatives).toBe(1)
  })

  it('applies a stage-down immediately when a level crosses the down-threshold', () => {
    const rel = relationshipWith({ ...levels, closeness: 0.3 }, stages)
    const after = apply(rel, { kind: 'hurtful', id: 'h-1', atMs: START_MS + HOUR_MS, reason: 'he mocked her' })
    expect(after.levels.closeness).toBeCloseTo(0.27, 12)
    expect(after.stages.closeness).toBe('friendly')
  })
})

describe('absenceOnReturn', () => {
  const levels: RelationshipLevels = { closeness: 0.4, trust: 0.4, familiarity: 0.5 }
  const stages: RelationshipStages = { closeness: 'close', trust: 'open', familiarity: 'knows-you' }

  it('reduces familiarity by about 3% after a 10-day gap and leaves closeness and trust unchanged', () => {
    const rel = relationshipWith(levels, stages)
    const after = absenceOnReturn(rel, 10 * DAY_MS)
    const loss = 1 - after.levels.familiarity / levels.familiarity
    expect(loss).toBeGreaterThan(0.025)
    expect(loss).toBeLessThan(0.035)
    expect(after.levels.closeness).toBe(levels.closeness)
    expect(after.levels.trust).toBe(levels.trust)
  })

  it('changes nothing within the 3-day grace, for a negative gap, or for a non-finite gap', () => {
    const rel = relationshipWith(levels, stages)
    expect(absenceOnReturn(rel, 3 * DAY_MS)).toBe(rel)
    expect(absenceOnReturn(rel, -5 * DAY_MS)).toBe(rel)
    expect(absenceOnReturn(rel, Number.NaN)).toBe(rel)
  })

  it('is applied by a return event and never touches closeness or trust', () => {
    const rel = relationshipWith(levels, stages)
    const after = apply(rel, { kind: 'return', id: 'return-1', atMs: START_MS + HOUR_MS, gapMs: 10 * DAY_MS })
    expect(after.levels).toEqual(absenceOnReturn(rel, 10 * DAY_MS).levels)
  })
})

describe('malformed input', () => {
  it('returns the state unchanged for an unknown event kind', () => {
    const rel = relationshipWith(zeroLevels, firstStages)
    // A stored or replicated event from a newer build; JSON carries no type evidence.
    const unknown: CharacterEvent = JSON.parse(JSON.stringify({ kind: 'love', id: 'x-1', atMs: START_MS + HOUR_MS }))
    expect(apply(rel, unknown)).toBe(rel)
  })

  it('returns the state unchanged for a return event with a negative gap', () => {
    const rel = relationshipWith({ closeness: 0.4, trust: 0.4, familiarity: 0.5 }, { closeness: 'close', trust: 'open', familiarity: 'knows-you' })
    expect(apply(rel, { kind: 'return', id: 'return-1', atMs: START_MS + HOUR_MS, gapMs: -DAY_MS }).levels).toEqual(rel.levels)
  })
})

describe('rolloverStages', () => {
  it('changes the stage only at the next rollover when a level crosses the close up-threshold mid-day', () => {
    let rel = relationshipWith({ closeness: 0.345, trust: 0, familiarity: 0 }, { closeness: 'friendly', trust: 'guarded', familiarity: 'new' })
    rel = apply(rel, { kind: 'milestone', id: 'm-1', atMs: START_MS + 12 * HOUR_MS, reason: 'first movie night', memoryId: 'memory-1' })
    expect(rel.levels.closeness).toBeGreaterThan(thresholds.closeness.close.up)
    expect(rel.stages.closeness).toBe('friendly')
    expect(rel.pendingStageUps.closeness).toBe('close')

    expect(rolloverStages(rel, dayKeyOf(START_MS)).stages.closeness).toBe('friendly')
    const next = rolloverStages(rel, dayKeyOf(START_MS + DAY_MS))
    expect(next.stages.closeness).toBe('close')
    expect(next.pendingStageUps.closeness).toBeNull()
    expect(next.lastDayKey).toBe(dayKeyOf(START_MS + DAY_MS))
  })

  it('applies at most one stage-up per dimension per rollover and repeats nothing for the same day key', () => {
    let rel = relationshipWith({ closeness: 0.65, trust: 0.5, familiarity: 0.3 }, firstStages)
    rel = apply(rel, laterTurn(START_MS + HOUR_MS))
    expect(rel.pendingStageUps).toEqual({ closeness: 'intimate', trust: 'confiding', familiarity: 'knows-you' })

    const seen: RelationshipStages[] = []
    for (let day = 1; day <= 4; day++) {
      const key = dayKeyOf(START_MS + day * DAY_MS)
      rel = rolloverStages(rel, key)
      expect(rolloverStages(rel, key)).toBe(rel)
      seen.push(rel.stages)
    }
    expect(seen).toEqual([
      { closeness: 'friendly', trust: 'open', familiarity: 'knows-you' },
      { closeness: 'close', trust: 'confiding', familiarity: 'knows-you' },
      { closeness: 'intimate', trust: 'confiding', familiarity: 'knows-you' },
      { closeness: 'intimate', trust: 'confiding', familiarity: 'knows-you' },
    ])
  })

  it('makes at most one stage change per rollover and no stage-down under ±0.005 seeded noise around every threshold', () => {
    const cases = [
      ...(['friendly', 'close', 'intimate'] as const).map((stage, index) => ({ dimension: 'closeness' as const, up: thresholds.closeness[stage].up, below: (['stranger', 'friendly', 'close'] as const)[index] })),
      ...(['open', 'confiding'] as const).map((stage, index) => ({ dimension: 'trust' as const, up: thresholds.trust[stage].up, below: (['guarded', 'open'] as const)[index] })),
      { dimension: 'familiarity' as const, up: thresholds.familiarity['knows-you'].up, below: 'new' as const },
    ]
    const order = { closeness: ['stranger', 'friendly', 'close', 'intimate'], trust: ['guarded', 'open', 'confiding'], familiarity: ['new', 'knows-you'] } as const
    let maxChangesPerRollover = 0
    let stageDowns = 0

    for (let seed = 0; seed < 200; seed++) {
      let rng = seedRng(seed)
      const noise = () => {
        const [value, next] = nextRandom(rng)
        rng = next
        return (value * 2 - 1) * 0.005
      }
      for (const { dimension, up, below } of cases) {
        let rel = relationshipWith(zeroLevels, { ...firstStages, [dimension]: below })
        for (let day = 0; day < 20; day++) {
          const dayStart = START_MS + day * DAY_MS
          rel = { ...rel, levels: { ...rel.levels, [dimension]: up + noise() } }
          const before = rel.stages[dimension]
          rel = apply(rel, { kind: 'ritual-reciprocated', id: `ritual-${seed}-${day}`, atMs: dayStart + 8 * HOUR_MS })
          if (order[dimension].indexOf(rel.stages[dimension] as never) < order[dimension].indexOf(before as never))
            stageDowns++
          const preRollover = rel.stages[dimension]
          rel = rolloverStages(rel, dayKeyOf(dayStart + DAY_MS))
          const step = order[dimension].indexOf(rel.stages[dimension] as never) - order[dimension].indexOf(preRollover as never)
          if (step < 0)
            stageDowns++
          maxChangesPerRollover = Math.max(maxChangesPerRollover, Math.abs(step))
        }
      }
    }
    expect(maxChangesPerRollover).toBeLessThanOrEqual(1)
    expect(stageDowns).toBe(0)
  })
})

describe('unlocksOf', () => {
  it('derives unlocks from stages and the milestone count', () => {
    expect(unlocksOf(firstStages, 0)).toEqual([])
    expect(unlocksOf({ closeness: 'friendly', trust: 'open', familiarity: 'new' }, 0)).toEqual(['teasing'])
    expect(unlocksOf({ closeness: 'close', trust: 'guarded', familiarity: 'knows-you' }, 2)).toEqual(['nicknames', 'initiative'])
    expect(unlocksOf({ closeness: 'intimate', trust: 'confiding', familiarity: 'knows-you' }, 3)).toEqual(['teasing', 'nicknames', 'initiative', 'vulnerability', 'callbacks'])
  })
})

/**
 * The relationship events of the A7 typical month: a reciprocated 08:00 greeting, an unanswered reach-out at noon, an
 * evening session (the third user turn is the first real exchange, followed by 24 later turns) with two pleasant
 * touches in different hours, a disclosure alongside every third day's significant positive, away days 15 to 17 with a
 * return event, and a hurtful event on day 22.
 */
function typicalMonth(): { rel: RelationshipState, levelsByDay: RelationshipLevels[] } {
  let rel = initialRelationship(DEFAULT_CHARACTER_PROFILE)
  const levelsByDay: RelationshipLevels[] = []
  let lastActiveMs: number | null = null
  for (let day = 1; day <= 30; day++) {
    const dayStart = START_MS + (day - 1) * DAY_MS
    rel = rolloverStages(rel, dayKeyOf(dayStart))
    if (day >= 15 && day <= 17) {
      levelsByDay.push(rel.levels)
      continue
    }
    const at = (hour: number, minute = 0) => dayStart + (hour - 4) * HOUR_MS + minute * MINUTE_MS
    const events: CharacterEvent[] = []
    if (lastActiveMs !== null && at(8) - lastActiveMs > DAY_MS)
      events.push({ kind: 'return', id: `return-${day}`, atMs: at(8), gapMs: at(8) - lastActiveMs })
    events.push(
      { kind: 'user-turn', id: `greet-${day}`, atMs: at(8), exchange: 'early' },
      { kind: 'ritual-reciprocated', id: `ritual-${day}`, atMs: at(8, 1) },
      { kind: 'reach-out-unanswered', id: `reach-${day}`, atMs: at(14), consecutive: 1 },
      { kind: 'user-turn', id: `evening-1-${day}`, atMs: at(20), exchange: 'early' },
      { kind: 'user-turn', id: `evening-2-${day}`, atMs: at(20, 2), exchange: 'first-real' },
    )
    for (let turn = 0; turn < 24; turn++)
      events.push({ kind: 'user-turn', id: `evening-later-${day}-${turn}`, atMs: at(20, 4 + turn * 3), exchange: 'later' })
    events.push(
      { kind: 'touch-pleasant', id: `touch-a-${day}`, atMs: at(20, 30) },
      { kind: 'touch-pleasant', id: `touch-b-${day}`, atMs: at(21, 30) },
    )
    if (day % 3 === 0) {
      events.push(
        { kind: 'significant-positive', id: `sig-${day}`, atMs: at(21), reason: 'he shared good news' },
        { kind: 'disclosure', id: `disclosure-${day}`, atMs: at(21, 1), reason: 'he told her about his week' },
      )
    }
    if (day === 22)
      events.push({ kind: 'hurtful', id: 'hurt-22', atMs: at(22), reason: 'he mocked her' })
    rel = applyAll(rel, events)
    lastActiveMs = at(22, 30)
    levelsByDay.push(rel.levels)
  }
  return { rel, levelsByDay }
}

describe('typical month (A7)', () => {
  it('ends day 30 with closeness 0.35 ± 0.03, levels in [0, 1], and daily gains within G', () => {
    const { rel, levelsByDay } = typicalMonth()
    expect(Math.abs(rel.levels.closeness - 0.35)).toBeLessThanOrEqual(0.03)
    expect(rel.activeDays).toBe(27)
    let previous = zeroLevels
    for (const levels of levelsByDay) {
      for (const dimension of ['closeness', 'trust', 'familiarity'] as const) {
        expect(levels[dimension]).toBeGreaterThanOrEqual(0)
        expect(levels[dimension]).toBeLessThanOrEqual(1)
        expect(levels[dimension] - previous[dimension]).toBeLessThanOrEqual(dailyGain[dimension] + 1e-12)
      }
      previous = levels
    }
  })

  it('is deterministic across runs', () => {
    expect(typicalMonth()).toEqual(typicalMonth())
  })
})
