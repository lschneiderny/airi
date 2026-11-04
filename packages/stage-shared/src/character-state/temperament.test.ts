import type { CompletedTemperamentDay, MoodAxes, MoodContribution, TemperamentState } from '.'

import { describe, expect, it } from 'vitest'

import { advanceTemperament, CHARACTER_STATE_SETTINGS } from '.'
import { nextRandom, seedRng } from '../situation/rng'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
// 04:00 UTC, a logical day start for the UTC rollover used here.
const START_MS = Date.UTC(2026, 10, 3, 4)
const RESTING: MoodAxes = { valence: 0.1, energy: 0, tension: 0.15 }
const AXES = ['valence', 'energy', 'tension'] as const
const { clamp } = CHARACTER_STATE_SETTINGS.temperament
const { epsilon } = CHARACTER_STATE_SETTINGS.mood

/** Logical day key with the 04:00 rollover in UTC. */
function logicalDayKeyOf(ms: number): string {
  return new Date(ms - 4 * HOUR_MS).toISOString().slice(0, 10)
}

function ctx(nowMs: number) {
  return { nowMs, logicalDayKeyOf }
}

function initial(axes: MoodAxes = RESTING, throughHourMs = START_MS): TemperamentState {
  return {
    axes,
    throughHourMs,
    day: { key: logicalDayKeyOf(throughHourMs + 30 * MINUTE_MS), sum: { valence: 0, energy: 0, tension: 0 }, samples: 0 },
  }
}

function contribution(id: string, atMs: number, delta: MoodAxes, halfLifeMs: number): MoodContribution {
  const maxAbs = Math.max(Math.abs(delta.valence), Math.abs(delta.energy), Math.abs(delta.tension))
  return { id, source: 'significant', reason: 'test', atMs, halfLifeMs, delta, expiresAtMs: atMs + halfLifeMs * Math.log2(maxAbs / epsilon) }
}

function offset(temperament: TemperamentState, axis: typeof AXES[number]): number {
  return Math.abs(temperament.axes[axis] - RESTING[axis])
}

/** Advances through `cuts` (ascending) and then to `endMs`, concatenating the completed days. */
function advanceInPieces(start: TemperamentState, contributions: readonly MoodContribution[], cuts: readonly number[], endMs: number) {
  let temperament = start
  const completedDays: CompletedTemperamentDay[] = []
  for (const nowMs of [...cuts, endMs]) {
    const result = advanceTemperament(temperament, contributions, RESTING, ctx(nowMs))
    temperament = result.temperament
    completedDays.push(...result.completedDays)
  }
  return { temperament, completedDays }
}

/** Seeded uniform values in [0, 1). */
function randoms(seed: number, count: number): number[] {
  let state = seedRng(seed)
  const values: number[] = []
  for (let index = 0; index < count; index++) {
    const [value, next] = nextRandom(state)
    values.push(value)
    state = next
  }
  return values
}

/**
 * The todo 3 model-spam stream built from the A2 constants: a `brighter` cue every minute for three days, each cut
 * to what the rolling 60 minute budget still allows, with live contributions capped at 64.
 */
function modelSpamStream(): MoodContribution[] {
  const { step, halfLifeMs, budgetWindowMs, budgetPerAxis } = CHARACTER_STATE_SETTINGS.mood.modelCue
  const accepted: MoodContribution[] = []
  for (let minute = 0; minute < 3 * 24 * 60; minute++) {
    const atMs = START_MS + minute * MINUTE_MS
    const used = accepted.filter(entry => entry.atMs > atMs - budgetWindowMs).reduce((sum, entry) => sum + entry.delta.valence, 0)
    const delta = Math.min(step, Math.max(0, budgetPerAxis - used))
    if (delta < 1e-12)
      continue
    accepted.push({ ...contribution(`cue-${minute}`, atMs, { valence: delta, energy: 0, tension: 0 }, halfLifeMs), source: 'model-cue' })
    expect(accepted.filter(entry => entry.expiresAtMs > atMs).length).toBeLessThanOrEqual(CHARACTER_STATE_SETTINGS.mood.maxContributions)
  }
  return accepted
}

describe('advanceTemperament', () => {
  it('gives identical axes and completed days for one call and four arbitrary splits over ten days (200 seeds)', () => {
    const endMs = START_MS + 10 * DAY_MS
    for (let seed = 1; seed <= 200; seed++) {
      const values = randoms(seed, 3 + 20 * 5)
      const cuts = values.slice(0, 3).map(value => START_MS + Math.floor(value * 10 * DAY_MS)).sort((a, b) => a - b)
      const contributions = Array.from({ length: 20 }, (_, index) => {
        const [at, v, e, t, life] = values.slice(3 + index * 5, 8 + index * 5)
        return contribution(`c-${index}`, START_MS + Math.floor(at * 10 * DAY_MS), { valence: v * 0.6 - 0.3, energy: e * 0.4 - 0.2, tension: t * 0.3 - 0.15 }, (1 + life * 8) * HOUR_MS)
      })
      const whole = advanceTemperament(initial(), contributions, RESTING, ctx(endMs))
      const pieces = advanceInPieces(initial(), contributions, cuts, endMs)
      expect(pieces.temperament).toEqual(whole.temperament)
      expect(pieces.completedDays).toEqual(whole.completedDays)
    }
  })

  it('moves T.v from 0.100 to 0.115 after one day and 0.109 after ten days for one significant positive event', () => {
    const { delta, halfLifeMs } = CHARACTER_STATE_SETTINGS.mood.events['significant-positive']
    const contributions = [contribution('sig-1', START_MS, delta, halfLifeMs)]
    const oneDay = advanceTemperament(initial(), contributions, RESTING, ctx(START_MS + DAY_MS)).temperament
    const tenDays = advanceTemperament(initial(), contributions, RESTING, ctx(START_MS + 10 * DAY_MS)).temperament
    expect(Math.abs(oneDay.axes.valence - 0.115)).toBeLessThanOrEqual(0.002)
    expect(Math.abs(tenDays.axes.valence - 0.109)).toBeLessThanOrEqual(0.002)
  })

  it('holds temperament at the resting disposition at every hour of the three-day model-spam stream', () => {
    const contributions = modelSpamStream()
    let temperament = initial()
    for (let hour = 1; hour <= 4 * 24; hour++) {
      temperament = advanceTemperament(temperament, contributions, RESTING, ctx(START_MS + hour * HOUR_MS)).temperament
      expect(temperament.axes).toEqual(RESTING)
    }
  })

  it('applies only the anchor pull on a day of model cues alone, while the day still records the felt mood', () => {
    const start = initial({ valence: 0.3, energy: 0.1, tension: 0.25 })
    const cues = modelSpamStream().filter(entry => entry.atMs < START_MS + DAY_MS)
    const cued = advanceTemperament(start, cues, RESTING, ctx(START_MS + DAY_MS))
    const quiet = advanceTemperament(start, [], RESTING, ctx(START_MS + DAY_MS))
    expect(cued.temperament.axes).toEqual(quiet.temperament.axes)
    expect(cued.completedDays.map(day => day.temperament)).toEqual(quiet.completedDays.map(day => day.temperament))
    // The history row keeps what she felt: the cues still lift the day's mood samples.
    expect(cued.completedDays[0].sum.valence).toBeGreaterThan(quiet.completedDays[0].sum.valence + 1)
  })

  it('still drifts toward a day of touch and a reply, but not when the same contributions are model cues', () => {
    const { 'touch-pleasant': touch, 'late-reply': reply } = CHARACTER_STATE_SETTINGS.mood.events
    const engaged: MoodContribution[] = [
      ...[6, 10, 16, 16.5].map((hour, index) => ({ ...contribution(`touch-${index}`, START_MS + hour * HOUR_MS, touch.delta, touch.halfLifeMs), source: 'touch' as const })),
      { ...contribution('reply', START_MS + 8 * HOUR_MS, reply.delta, reply.halfLifeMs), source: 'reply' },
    ]
    const asCues = engaged.map(entry => ({ ...entry, source: 'model-cue' as const }))
    const end = ctx(START_MS + DAY_MS)
    const drifted = advanceTemperament(initial(), engaged, RESTING, end).temperament.axes
    expect(drifted.valence - RESTING.valence).toBeGreaterThan(0.002)
    expect(drifted.tension).toBeLessThan(RESTING.tension)
    expect(advanceTemperament(initial(), asCues, RESTING, end).temperament.axes).toEqual(RESTING)
  })

  it('holds |T - R| exactly at the clamp under a saturating mood instead of following it', () => {
    const contributions = [contribution('max', START_MS, { valence: 2.5, energy: -2.5, tension: 2.5 }, 100 * DAY_MS)]
    const { temperament } = advanceTemperament(initial(), contributions, RESTING, ctx(START_MS + 60 * DAY_MS))
    expect(temperament.axes.valence - RESTING.valence).toBeCloseTo(clamp.valence, 12)
    expect(RESTING.energy - temperament.axes.energy).toBeCloseTo(clamp.energy, 12)
    expect(temperament.axes.tension - RESTING.tension).toBeCloseTo(clamp.tension, 12)
  })

  it('never increases |T - R| without contributions (200 seeded starts)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const [v, e, t] = randoms(seed, 3)
      let temperament = initial({
        valence: RESTING.valence + (v * 2 - 1) * clamp.valence,
        energy: RESTING.energy + (e * 2 - 1) * clamp.energy,
        tension: RESTING.tension + (t * 2 - 1) * clamp.tension,
      })
      for (let hour = 1; hour <= 48; hour++) {
        const next = advanceTemperament(temperament, [], RESTING, ctx(START_MS + hour * HOUR_MS)).temperament
        for (const axis of AXES)
          expect(offset(next, axis)).toBeLessThanOrEqual(offset(temperament, axis))
        temperament = next
      }
    }
  })

  it('processes only completed epoch hours', () => {
    const start = initial({ valence: 0.3, energy: 0, tension: 0.15 })
    const partial = advanceTemperament(start, [], RESTING, ctx(START_MS + 1.5 * HOUR_MS)).temperament
    expect(partial.throughHourMs).toBe(START_MS + HOUR_MS)
    expect(partial.day.samples).toBe(1)
    expect(partial.axes.valence).toBeLessThan(0.3)
    expect(advanceTemperament(partial, [], RESTING, ctx(START_MS + 1.99 * HOUR_MS)).temperament).toBe(partial)
  })

  it('accumulates one sample per hour and closes each logical day at its 04:00 rollover', () => {
    const atRollover = advanceTemperament(initial(), [], RESTING, ctx(START_MS + DAY_MS))
    expect(atRollover.completedDays).toHaveLength(1)
    const [day] = atRollover.completedDays
    expect(day.key).toBe('2026-11-03')
    expect(day.samples).toBe(24)
    for (const axis of AXES)
      expect(day.sum[axis] / day.samples).toBeCloseTo(RESTING[axis], 12)
    expect(day.temperament).toEqual(atRollover.temperament.axes)
    expect(atRollover.temperament.day).toEqual({ key: '2026-11-04', sum: { valence: 0, energy: 0, tension: 0 }, samples: 0 })

    const beforeRollover = advanceTemperament(initial(), [], RESTING, ctx(START_MS + DAY_MS - 1))
    expect(beforeRollover.completedDays).toEqual([])
    expect(beforeRollover.temperament.day.samples).toBe(23)

    const tenDays = advanceTemperament(initial(), [], RESTING, ctx(START_MS + 10 * DAY_MS + 5 * HOUR_MS))
    expect(tenDays.completedDays.map(entry => entry.samples)).toEqual(Array.from({ length: 10 }).fill(24))
    expect(tenDays.temperament.day.samples).toBe(5)
  })

  it('samples mood at the middle of each hour', () => {
    // A contribution starting at :45 is invisible to that hour's :30 sample and visible to the next.
    const contributions = [contribution('late', START_MS + 45 * MINUTE_MS, { valence: 0.5, energy: 0, tension: 0 }, 9 * HOUR_MS)]
    const first = advanceTemperament(initial(), contributions, RESTING, ctx(START_MS + HOUR_MS)).temperament
    expect(first.day.sum.valence).toBeCloseTo(RESTING.valence, 12)
    const second = advanceTemperament(first, contributions, RESTING, ctx(START_MS + 2 * HOUR_MS)).temperament
    expect(second.day.sum.valence - first.day.sum.valence).toBeGreaterThan(RESTING.valence + 0.3)
  })

  it('caps one call at 400 days and applies only the anchor pull for the older gap', () => {
    const maxHours = CHARACTER_STATE_SETTINGS.temperament.maxHoursPerCall
    const start = initial({ valence: 0.4, energy: -0.25, tension: 0.3 })
    const gapMs = 405 * DAY_MS
    const skippedMs = gapMs - maxHours * HOUR_MS
    // Fully expired before the processed span starts, so only the skipped span could see it.
    const insideSkipped = [contribution('old', START_MS + DAY_MS, { valence: -2.5, energy: 2.5, tension: 2.5 }, HOUR_MS)]

    const capped = advanceTemperament(start, insideSkipped, RESTING, ctx(START_MS + gapMs))
    expect(capped.temperament.throughHourMs).toBe(START_MS + gapMs)
    expect(capped.temperament).toEqual(advanceTemperament(start, [], RESTING, ctx(START_MS + gapMs)).temperament)
    expect(capped.completedDays).toHaveLength(400)
    expect(capped.completedDays[0].key).toBe(logicalDayKeyOf(START_MS + skippedMs + 30 * MINUTE_MS))

    // The jump is the closed form of the hourly anchor pull, so a mood-free span decays as 2^(-gap / anchor half-life)
    // either way. Energy rests at 0, so its offset keeps full relative precision.
    const anchorDecay = 2 ** (-gapMs / CHARACTER_STATE_SETTINGS.temperament.anchorHalfLifeMs)
    expect(capped.temperament.axes.energy / (-0.25 * anchorDecay)).toBeCloseTo(1, 9)

    // Days processed before the jump are unaffected; equal input gives equal output.
    expect(advanceTemperament(start, insideSkipped, RESTING, ctx(START_MS + gapMs))).toEqual(capped)
  })

  it('returns the input unchanged for nowMs before throughHourMs, NaN, or infinite', () => {
    const start = initial({ valence: 0.3, energy: 0, tension: 0.15 })
    for (const nowMs of [START_MS - DAY_MS, START_MS, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const result = advanceTemperament(start, [], RESTING, ctx(nowMs))
      expect(result.temperament).toBe(start)
      expect(result.completedDays).toEqual([])
    }
  })
})
