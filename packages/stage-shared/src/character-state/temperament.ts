import type { AdvanceContext, MoodAxes, MoodContribution, TemperamentDay, TemperamentState } from './types'

import { moodAt } from './mood'
import { CHARACTER_STATE_SETTINGS } from './settings'

const { followHalfLifeMs, anchorHalfLifeMs, stepMs, sampleOffsetMs, clamp, maxHoursPerCall } = CHARACTER_STATE_SETTINGS.temperament

/** `k_A`, per millisecond. */
const anchorRate = Math.LN2 / anchorHalfLifeMs
/** `e^(-k_A · 1 h)`: the anchor pull of one step. */
const anchorDecay = Math.exp(-anchorRate * stepMs)
/** `k_T · 1 h`: the share of the gap to mood followed in one step. */
const follow = (Math.LN2 / followHalfLifeMs) * stepMs

const ZERO: MoodAxes = Object.freeze({ valence: 0, energy: 0, tension: 0 })

/** One logical day of hourly mood samples, closed when the hourly sampling reaches the next logical day. */
export interface CompletedTemperamentDay extends TemperamentDay {
  /** The temperament after the day's last processed hour. */
  readonly temperament: MoodAxes
}

export interface TemperamentAdvance {
  readonly temperament: TemperamentState
  /** Days closed by this call, oldest first; a day without samples is never listed. */
  readonly completedDays: readonly CompletedTemperamentDay[]
}

/** One A3 step on one axis: anchor pull, follow the mood sample, clamp the offset from resting. */
function stepAxis(t: number, r: number, m: number, limit: number): number {
  const next = r + (t - r) * anchorDecay + follow * (m - t)
  return r + Math.min(limit, Math.max(-limit, next - r))
}

/**
 * Advances temperament over every completed epoch hour `[h, h + 1 h)` from `throughHourMs` up to `ctx.nowMs`
 * (plan A3). Each hour samples the mood at `h + 30 min` over the temperament so far, adds the sample to the logical
 * day of that instant, and steps `T <- R + (T - R) e^(-k_A 1 h) + k_T 1 h (m - T)` with `|T - R|` clamped per axis.
 *
 * The result depends only on the completed hours, so any split of `[throughHourMs, nowMs]` into calls gives equal
 * temperament and the same completed days in the same order, as long as no single call spans more than
 * `maxHoursPerCall` hours. A longer call processes only the newest `maxHoursPerCall` hours: the older hours get the
 * closed-form anchor pull `T <- R + (T - R) e^(-k_A span)` with no mood samples, so their days are never completed.
 *
 * A day closes as soon as the next hour to process samples another logical day (at the 04:00 rollover), and the
 * accumulator then restarts empty for that day. `nowMs` that is not finite or that completes no hour returns the
 * input unchanged. `throughHourMs` is expected on an epoch-hour boundary.
 */
export function advanceTemperament(
  temperament: TemperamentState,
  contributions: readonly MoodContribution[],
  resting: MoodAxes,
  ctx: Pick<AdvanceContext, 'nowMs' | 'logicalDayKeyOf'>,
): TemperamentAdvance {
  const hours = Math.floor((ctx.nowMs - temperament.throughHourMs) / stepMs)
  if (!Number.isFinite(ctx.nowMs) || !(hours >= 1))
    return { temperament, completedDays: [] }

  let { axes, throughHourMs, day } = temperament
  const skipped = Math.max(0, hours - maxHoursPerCall)
  if (skipped > 0) {
    const decay = Math.exp(-anchorRate * skipped * stepMs)
    axes = {
      valence: resting.valence + (axes.valence - resting.valence) * decay,
      energy: resting.energy + (axes.energy - resting.energy) * decay,
      tension: resting.tension + (axes.tension - resting.tension) * decay,
    }
    throughHourMs += skipped * stepMs
  }

  const completedDays: CompletedTemperamentDay[] = []
  const close = (nextKey: string) => {
    if (day.samples > 0)
      completedDays.push({ ...day, temperament: axes })
    day = { key: nextKey, sum: ZERO, samples: 0 }
  }

  for (let hour = skipped; hour < hours; hour++) {
    const sampleAtMs = throughHourMs + sampleOffsetMs
    const key = ctx.logicalDayKeyOf(sampleAtMs)
    if (key !== day.key)
      close(key)

    const mood = moodAt(contributions, axes, sampleAtMs)
    axes = {
      valence: stepAxis(axes.valence, resting.valence, mood.valence, clamp.valence),
      energy: stepAxis(axes.energy, resting.energy, mood.energy, clamp.energy),
      tension: stepAxis(axes.tension, resting.tension, mood.tension, clamp.tension),
    }
    day = {
      key: day.key,
      sum: { valence: day.sum.valence + mood.valence, energy: day.sum.energy + mood.energy, tension: day.sum.tension + mood.tension },
      samples: day.samples + 1,
    }
    throughHourMs += stepMs

    const nextKey = ctx.logicalDayKeyOf(throughHourMs + sampleOffsetMs)
    if (nextKey !== day.key)
      close(nextKey)
  }

  return { temperament: { axes, throughHourMs, day }, completedDays }
}
