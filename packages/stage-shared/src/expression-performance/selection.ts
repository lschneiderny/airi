import type { CatalogEntry } from './catalog'
import type { ExpressionPerformanceSettings } from './settings'
import type { AffectSignal, DeciderContext, ReactionEpisode, SlotCommand } from './types'

import { isAutoEligible } from './catalog'
import { drawRandom } from './reaction-strength'
import { bandRank } from './types'

/**
 * Selection rules shared by the picker and the planner, so both deciders choose the same
 * expression from the same tickets and differ only in when, and whether, they emit it.
 */

/** Automatic picks fill only these slots; props are reachable only through explicit LLM requests. */
export type AutoSlot = 'face' | 'effect'
export interface Tickets { gate: number, pick: number }
interface Candidate { id: string, weight: number }
type ExpressionSignal = Extract<AffectSignal, { kind: 'expression' }>
type ClearSignal = Extract<AffectSignal, { kind: 'clear' }>

/** A clear without a slot releases every slot an LLM can fill. */
const clearedSlots = ['face', 'effect', 'prop'] as const satisfies readonly SlotCommand['slot'][]

/** Always advances twice, independently of candidates and gate outcome. */
export function drawPickerTickets(random: number) {
  const gate = drawRandom(random)
  const pick = drawRandom(gate.random)
  return { random: pick.random, tickets: { gate: gate.value, pick: pick.value } }
}

/** Draws one ticket pair per slot for a new episode, even when no candidate exists, so replays stay aligned. */
export function drawEpisodeTickets(streams: Record<AutoSlot, number>) {
  const face = drawPickerTickets(streams.face)
  const effect = drawPickerTickets(streams.effect)
  return { streams: { face: face.random, effect: effect.random }, tickets: { face: face.tickets, effect: effect.tickets } }
}

/** Zero tau disables recency, including a selection at the current signal time. */
export function recencyWeight(weight: number, lastAt: number | undefined, at: number, settings: ExpressionPerformanceSettings['picker']) {
  const age = lastAt === undefined ? Infinity : Math.max(0, at - lastAt)
  return weight * (1 - (settings.recencyTau === 0 ? 0 : settings.recencyDepth * Math.exp(-age / settings.recencyTau)))
}

/** Stable code-point ordering makes a catalog's input order irrelevant to replay. */
export function pickerCandidates(catalog: readonly CatalogEntry[], episode: ReactionEpisode, slot: AutoSlot): Candidate[] {
  return catalog.filter(isAutoEligible).filter(entry => entry.kind === slot).flatMap((entry) => {
    const mapping = entry.mappings.find(mapping => mapping.emotion === episode.emotion && bandRank[mapping.minBand] <= bandRank[episode.band] && Number.isFinite(mapping.weight) && mapping.weight > 0)
    return mapping ? [{ id: entry.id, weight: mapping.weight }] : []
  }).sort((a, b) => {
    const left = Array.from(a.id, character => character.codePointAt(0)!)
    const right = Array.from(b.id, character => character.codePointAt(0)!)
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
      if (left[i] !== right[i])
        return left[i] - right[i]
    }
    return left.length - right.length
  })
}

/** The gate and weighted choice use independent, previously drawn episode tickets. */
export function pickExpression(candidates: Candidate[], tickets: Tickets, probability: number, recency: Record<string, number>, at: number, settings: ExpressionPerformanceSettings['picker']): string | null {
  if (tickets.gate >= probability)
    return null
  const weighted = candidates.map(candidate => ({ ...candidate, weight: recencyWeight(candidate.weight, recency[candidate.id], at, settings) }))
  const total = weighted.reduce((sum, candidate) => sum + candidate.weight, 0)
  let ticket = tickets.pick * total
  for (const candidate of weighted) {
    ticket -= candidate.weight
    if (ticket < 0)
      return candidate.id
  }
  return null
}

/**
 * Picks for the empty automatic slots of an episode, face first. Faces always pass the gate;
 * effects pass with a probability rising from `effectGateFrom` to `effectGateTo`, and equal
 * thresholds act as a step. A face pick counts as recent for the effect pick that follows.
 */
export function autoPicks(episode: ReactionEpisode, ctx: DeciderContext, tickets: Record<AutoSlot, Tickets>, occupants: Record<AutoSlot, string | null>, recency: Record<string, number>, at: number) {
  const { effectGateFrom, effectGateTo } = ctx.settings.picker
  const effectGate = effectGateFrom === effectGateTo
    ? Number(episode.intensity >= effectGateTo)
    : Math.max(0, Math.min(1, (episode.intensity - effectGateFrom) / (effectGateTo - effectGateFrom)))
  const picks: { slot: AutoSlot, expressionId: string }[] = []
  let seen = recency
  for (const slot of ['face', 'effect'] as const) {
    if (occupants[slot])
      continue
    const id = pickExpression(pickerCandidates(ctx.catalog, episode, slot), tickets[slot], slot === 'face' ? 1 : effectGate, seen, at, ctx.settings.picker)
    if (id === null)
      continue
    picks.push({ slot, expressionId: id })
    seen = { ...seen, [id]: at }
  }
  return picks
}

/**
 * The slot command for an explicit LLM expression, or null when the entry is unknown or not a
 * slot kind. The conductor has already checked LLM eligibility.
 */
export function explicitExpressionCommand(signal: ExpressionSignal, ctx: DeciderContext): (SlotCommand & { expressionId: string }) | null {
  const entry = ctx.catalog.find(entry => entry.id === signal.expressionId)
  if (!entry || (entry.kind !== 'face' && entry.kind !== 'effect' && entry.kind !== 'prop'))
    return null
  return { slot: entry.kind, expressionId: entry.id, holdSeconds: signal.holdSeconds ?? ctx.settings.naturalBands.clear.faceHold, until: signal.holdSeconds ? 'hold' : 'speech', turnId: signal.turnId }
}

/** Releases the named slot now, or every LLM-fillable slot when none is named. */
export function clearCommands(signal: ClearSignal): SlotCommand[] {
  const slots = signal.slot ? [signal.slot] : clearedSlots
  return slots.map(slot => ({ slot, expressionId: null, holdSeconds: 0, until: 'hold', turnId: signal.turnId }))
}

/** Neutral releases only the automatic slots; outfits, props, and the rest set stay. */
export function neutralCommands(turnId: string | undefined): SlotCommand[] {
  return (['face', 'effect'] as const).map(slot => ({ slot, expressionId: null, holdSeconds: 0, until: 'speech', turnId }))
}
