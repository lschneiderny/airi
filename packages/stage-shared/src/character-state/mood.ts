import type { AdvanceContext, CharacterEvent, ModelCueLogEntry, MoodAxes, MoodContribution, MoodSource, MoodState } from './types'

import { is } from 'valibot'

import { CHARACTER_STATE_SETTINGS } from './settings'
import { CharacterEventSchema } from './types'

const MOOD = CHARACTER_STATE_SETTINGS.mood
const AXES = ['valence', 'energy', 'tension'] as const

interface MoodPush {
  readonly source: MoodSource
  readonly reason: string
  readonly halfLifeMs: number
  readonly delta: MoodAxes
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function scaled(delta: MoodAxes, factor: number): MoodAxes {
  return { valence: delta.valence * factor, energy: delta.energy * factor, tension: delta.tension * factor }
}

function maxAbs(delta: MoodAxes): number {
  return Math.max(Math.abs(delta.valence), Math.abs(delta.energy), Math.abs(delta.tension))
}

/** The remaining weight of a contribution: `2^(-(t - atMs) / halfLifeMs)` inside `[atMs, expiresAtMs)`, else 0. */
export function remaining(contribution: Pick<MoodContribution, 'atMs' | 'halfLifeMs' | 'expiresAtMs'>, nowMs: number): number {
  if (nowMs < contribution.atMs || nowMs >= contribution.expiresAtMs)
    return 0
  return 2 ** (-(nowMs - contribution.atMs) / contribution.halfLifeMs)
}

/** The summed raw (pre-squash) mood of the live contributions at `nowMs`. */
export function rawAt(contributions: readonly MoodContribution[], nowMs: number): MoodAxes {
  let valence = 0
  let energy = 0
  let tension = 0
  for (const contribution of contributions) {
    const weight = remaining(contribution, nowMs)
    valence += contribution.delta.valence * weight
    energy += contribution.delta.energy * weight
    tension += contribution.delta.tension * weight
  }
  return { valence, energy, tension }
}

/**
 * The mood at `nowMs`: valence and energy are `tanh(atanh(T) + raw)`, tension is `σ(logit(T) + gain · raw)`, so
 * the temperament `T` is the zero point and the result always stays inside its axis range.
 */
export function moodAt(contributions: readonly MoodContribution[], temperament: MoodAxes, nowMs: number): MoodAxes {
  const raw = rawAt(contributions, nowMs)
  const limit = MOOD.atanhClamp
  // The tension clamp maps the same ±limit onto [0, 1], so both squashes saturate alike.
  const tension = clamp(temperament.tension, (1 - limit) / 2, (1 + limit) / 2)
  const logit = Math.log(tension / (1 - tension))
  return {
    valence: Math.tanh(Math.atanh(clamp(temperament.valence, -limit, limit)) + raw.valence),
    energy: Math.tanh(Math.atanh(clamp(temperament.energy, -limit, limit)) + raw.energy),
    tension: 1 / (1 + Math.exp(-(logit + MOOD.tensionGain * raw.tension))),
  }
}

function inWindow(atMs: number, eventAtMs: number, windowMs: number): boolean {
  return atMs > eventAtMs - windowMs && atMs <= eventAtMs
}

/** The model cue step after the rolling per-axis budget; the excess is truncated. */
function modelCueDelta(state: MoodState, event: Extract<CharacterEvent, { kind: 'model-cue' }>): MoodAxes {
  const cue = MOOD.modelCue
  const used = { valence: 0, energy: 0, tension: 0 }
  for (const entry of state.modelCueLog) {
    if (!inWindow(entry.atMs, event.atMs, cue.budgetWindowMs))
      continue
    for (const axis of AXES)
      used[axis] += Math.abs(entry.delta[axis])
  }
  const step = (axis: typeof AXES[number]): number => event.directions[axis] * Math.min(cue.step, Math.max(0, cue.budgetPerAxis - used[axis]))
  return { valence: step('valence'), energy: step('energy'), tension: step('tension') }
}

/** The share of a pleasant touch the rolling hourly valence budget still allows. */
function pleasantTouchFactor(state: MoodState, atMs: number): number {
  const touch = MOOD.events['touch-pleasant']
  let used = 0
  for (const contribution of state.contributions) {
    if (contribution.source === 'touch' && contribution.delta.valence > 0 && inWindow(contribution.atMs, atMs, MOOD.pleasantTouchBudgetWindowMs))
      used += contribution.delta.valence
  }
  return clamp((MOOD.pleasantTouchBudgetPerHour - used) / touch.delta.valence, 0, 1)
}

function significantToday(state: MoodState, atMs: number, ctx: AdvanceContext): number {
  const dayKey = ctx.logicalDayKeyOf(atMs)
  return state.contributions.filter(contribution => contribution.source === 'significant' && ctx.logicalDayKeyOf(contribution.atMs) === dayKey).length
}

/** The A2 mood push of an event before headroom, or `null` when the event has none or a budget refuses it. */
function pushOf(state: MoodState, event: CharacterEvent, ctx: AdvanceContext): MoodPush | null {
  const events = MOOD.events
  switch (event.kind) {
    case 'model-cue':
      return { source: 'model-cue', reason: event.reason, halfLifeMs: MOOD.modelCue.halfLifeMs, delta: modelCueDelta(state, event) }
    case 'touch-pleasant': {
      const touch = events['touch-pleasant']
      return { source: 'touch', reason: 'he touched you gently', halfLifeMs: touch.halfLifeMs, delta: scaled(touch.delta, pleasantTouchFactor(state, event.atMs)) }
    }
    case 'touch-unwelcome':
      return { source: 'touch', reason: 'he kept poking you', ...events['touch-unwelcome'] }
    case 'reach-out-unanswered':
      return event.consecutive === 1
        ? { source: 'reach-out-unanswered', reason: 'he did not answer when you reached out', ...events['reach-out-unanswered-first'] }
        : { source: 'reach-out-unanswered', reason: 'he left you unanswered again', ...events['reach-out-unanswered-second'] }
    case 'late-reply':
      return { source: 'reply', reason: 'he answered you after all', ...events['late-reply'] }
    case 'return': {
      const settings = MOOD.return
      const factor = clamp(Math.log2(event.gapMs / settings.referenceGapMs) / settings.octaves, 0, 1)
      return { source: 'return', reason: 'he came back after being away', halfLifeMs: settings.halfLifeMs, delta: scaled(settings.delta, factor) }
    }
    case 'ritual-reciprocated':
      return { source: 'ritual', reason: 'he joined in your little ritual', ...events['ritual-reciprocated'] }
    case 'significant-positive':
    case 'significant-negative':
    case 'hurtful':
      if (significantToday(state, event.atMs, ctx) >= MOOD.significantPerDay)
        return null
      return { source: 'significant', reason: event.reason, ...events[event.kind === 'significant-positive' ? 'significant-positive' : 'significant-negative'] }
    default:
      return null
  }
}

/** Shrinks a step so the summed raw value of each axis stays within the headroom rail. */
function withinHeadroom(delta: MoodAxes, raw: MoodAxes): MoodAxes {
  const rail = (axis: typeof AXES[number]): number => {
    const sign = Math.sign(delta[axis])
    return sign * Math.min(Math.abs(delta[axis]), Math.max(0, MOOD.headroom - sign * raw[axis]))
  }
  return { valence: rail('valence'), energy: rail('energy'), tension: rail('tension') }
}

/**
 * Adds the mood part of `event` (Appendix A2) after the model cue and pleasant touch budgets, the daily significant
 * cap, and the headroom rail. Events without a mood part, malformed events, repeated ids, and steps below the mood
 * epsilon return `state` itself.
 */
export function insertContribution(state: MoodState, event: CharacterEvent, ctx: AdvanceContext): MoodState {
  if (!is(CharacterEventSchema, event) || state.contributions.some(contribution => contribution.id === event.id))
    return state

  const push = pushOf(state, event, ctx)
  if (push === null)
    return state

  const delta = withinHeadroom(push.delta, rawAt(state.contributions, event.atMs))
  const size = maxAbs(delta)
  if (size <= MOOD.epsilon)
    return state

  const contribution: MoodContribution = {
    id: event.id,
    source: push.source,
    reason: push.reason,
    atMs: event.atMs,
    halfLifeMs: push.halfLifeMs,
    delta,
    expiresAtMs: event.atMs + push.halfLifeMs * Math.log2(size / MOOD.epsilon),
  }

  let contributions = [...state.contributions, contribution]
  if (contributions.length > MOOD.maxContributions) {
    // Over the cap, the contribution that expires first leaves; it carries the least remaining influence.
    const first = contributions.reduce((earliest, candidate) => candidate.expiresAtMs < earliest.expiresAtMs ? candidate : earliest)
    contributions = contributions.filter(candidate => candidate !== first)
  }

  const modelCueLog: readonly ModelCueLogEntry[] = event.kind === 'model-cue'
    ? [...state.modelCueLog.filter(entry => entry.atMs > event.atMs - MOOD.modelCue.budgetWindowMs), { atMs: event.atMs, delta }].slice(-MOOD.modelCue.maxLogEntries)
    : state.modelCueLog

  return { contributions, modelCueLog }
}

/**
 * Drops expired contributions and model cue log entries older than the budget window. `moodAt` at `nowMs` and later
 * is unchanged, because an expired contribution weighs exactly 0 from its `expiresAtMs` on.
 */
export function pruneMood(state: MoodState, nowMs: number): MoodState {
  const contributions = state.contributions.filter(contribution => contribution.expiresAtMs > nowMs)
  const modelCueLog = state.modelCueLog.filter(entry => entry.atMs > nowMs - MOOD.modelCue.budgetWindowMs)
  if (contributions.length === state.contributions.length && modelCueLog.length === state.modelCueLog.length)
    return state
  return { contributions, modelCueLog }
}
