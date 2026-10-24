import type { CatalogEntry } from './catalog'
import type { ReactionState } from './reaction-strength'
import type { ExpressionPerformanceSettings } from './settings'
import type { AffectSignal, DeciderContext, HoldCommand, ReactionEpisode, SlotCommand } from './types'

import { isAutoEligible } from './catalog'
import { entrySlots } from './combos'
import { acceptReaction, drawRandom } from './reaction-strength'
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
export function pickerCandidates(catalog: readonly CatalogEntry[], episode: ReactionEpisode, slot: AutoSlot, occupants: Record<AutoSlot, string | null>): Candidate[] {
  return catalog.filter(isAutoEligible).filter((entry) => {
    if (entry.kind !== 'combo')
      return entry.kind === slot
    const slots = entrySlots(entry, catalog)
    return slots[0] === slot && !slots.includes('prop') && slots.every(slot => slot === 'prop' || occupants[slot] === null)
  }).flatMap((entry) => {
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
  const occupied = { ...occupants }
  let seen = recency
  for (const slot of ['face', 'effect'] as const) {
    if (occupied[slot])
      continue
    const id = pickExpression(pickerCandidates(ctx.catalog, episode, slot, occupied), tickets[slot], slot === 'face' ? 1 : effectGate, seen, at, ctx.settings.picker)
    if (id === null)
      continue
    picks.push({ slot, expressionId: id })
    for (const spanned of entrySlots(ctx.catalog.find(entry => entry.id === id)!, ctx.catalog)) {
      if (spanned !== 'prop')
        occupied[spanned] = id
    }
    seen = { ...seen, [id]: at }
  }
  return picks
}

/**
 * Commands for every slot of an explicit LLM expression, or null when it has no slots.
 * The conductor has already checked LLM eligibility.
 */
export function explicitExpressionCommand(signal: ExpressionSignal, ctx: DeciderContext): (SlotCommand & { expressionId: string })[] | null {
  const entry = ctx.catalog.find(entry => entry.id === signal.expressionId)
  const slots = entry ? entrySlots(entry, ctx.catalog) : []
  if (!entry || slots.length === 0)
    return null
  return slots.map(slot => ({ slot, expressionId: entry.id, holdSeconds: signal.holdSeconds ?? ctx.settings.naturalBands.clear.faceHold, until: signal.holdSeconds ? 'hold' : 'speech', turnId: signal.turnId }))
}

/** Vacate whole owners before installing a batch, so commands for one combo stay together. */
export function applySlotOccupants(occupants: Record<AutoSlot, string | null>, commands: readonly SlotCommand[], catalog: readonly CatalogEntry[]): Record<AutoSlot, string | null> {
  const vacated = new Set(commands.flatMap(command => command.slot === 'prop'
    ? Object.values(occupants).filter((id) => {
        const entry = catalog.find(entry => entry.id === id)
        return entry && entrySlots(entry, catalog).includes('prop')
      })
    : [occupants[command.slot]]))
  const next = {
    face: vacated.has(occupants.face) ? null : occupants.face,
    effect: vacated.has(occupants.effect) ? null : occupants.effect,
  }
  for (const command of commands) {
    if (command.slot !== 'prop')
      next[command.slot] = command.expressionId
  }
  return next
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

/**
 * The hold for an accepted episode. A turn's hold ends with its speech, so it uses the band's face
 * hold; a turnless one has no speech to wait for and lasts `held.turnlessSeconds`.
 */
export function emotionHold(episode: ReactionEpisode, turnId: string | undefined, settings: ExpressionPerformanceSettings): HoldCommand {
  const turnless = turnId === undefined
  return {
    emotion: episode.emotion,
    strength: episode.intensity,
    holdSeconds: turnless ? settings.held.turnlessSeconds : settings.naturalBands[episode.band].faceHold,
    until: turnless ? 'hold' : 'speech',
    turnId,
  }
}

/** Releases the held emotion; used when neutral resets reaction state or a clear names no slot. */
export function releaseHold(turnId: string | undefined): HoldCommand {
  return { emotion: null, strength: 0, holdSeconds: 0, until: 'hold', turnId }
}

/** The decider state an explicit expression's derived reaction reads and updates. */
interface ExpressionReactionState {
  reaction: ReactionState
  streams: Record<AutoSlot, number>
  tickets: Record<AutoSlot, Tickets> | null
}

/**
 * Derives a reaction from an explicit expression that has emotion mappings, so the held face
 * follows what the LLM chose. The primary mapping is the heaviest one, earliest on ties, and it
 * is accepted exactly like a direct emotion signal at the mapping's minimum band. The hold mirrors
 * the slot command's own lifetime. No automatic picks run: the expression is the pick.
 * A repeat inside the same episode yields no new episode but still refreshes the hold, at the
 * running episode's strength, so the held face keeps matching the refreshed slot lease.
 *
 * A new episode draws its tickets so a later stronger signal of the same emotion escalates without
 * a null ticket. Occupants are unchanged here: the caller records every spanned slot.
 * With `heldEmotions` off, or no mapping, the state is returned untouched,
 * which keeps the old slot-only behavior.
 */
export function explicitExpressionReaction<S extends ExpressionReactionState>(command: SlotCommand & { expressionId: string }, signal: ExpressionSignal, ctx: DeciderContext, state: S): { episodes: ReactionEpisode[], holds: HoldCommand[], state: S } {
  const primary = ctx.settings.heldEmotions
    ? ctx.catalog.find(entry => entry.id === command.expressionId)?.mappings.reduce<CatalogEntry['mappings'][number] | null>((best, mapping) => best && best.weight >= mapping.weight ? best : mapping, null)
    : null
  if (!primary)
    return { episodes: [], holds: [], state }
  const reaction = acceptReaction(state.reaction, primary.emotion, ctx.settings.bands ? ctx.settings.intensity[primary.minBand] : 0.6, signal.at, ctx.settings)
  let next = { ...state, reaction: reaction.state }
  const episode = reaction.episode
  const running = reaction.state.current?.episode
  const held = episode ?? (running?.emotion === primary.emotion ? running : null)
  if (episode && !episode.escalation)
    next = { ...next, ...drawEpisodeTickets(state.streams) }
  return {
    episodes: episode ? [episode] : [],
    // A configured zero dose has no running episode, but still refreshes the explicit slot's lease.
    holds: [{ emotion: primary.emotion, strength: held?.intensity ?? (ctx.settings.bands ? ctx.settings.intensity[primary.minBand] : 0.6), holdSeconds: command.holdSeconds, until: command.until, turnId: signal.turnId }],
    state: next,
  }
}
