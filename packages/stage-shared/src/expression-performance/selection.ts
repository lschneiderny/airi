import type { CatalogEntry } from './catalog'
import type { ExpressionPerformanceSettings } from './settings'
import type { AffectSignal, DeciderContext, HoldCommand, PerformanceEmotion, ReactionEpisode, SlotCommand } from './types'

import { isAutoEligible } from './catalog'
import { entrySlots } from './combos'
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

/** Moods that settle in instead of flashing by; their expressions and held face stay `slots.lingerScale` times longer. */
export const lingeringEmotions: ReadonlySet<PerformanceEmotion> = new Set(['sad', 'sleepy', 'love', 'flustered', 'think'])

/**
 * Seconds a slot's expression stays from its start: `slots.holdSeconds`, longer for the effect slot and for a
 * lingering emotion. A speech lease also stays `slots.afterSpeechShare` of this after its speech ends.
 */
export function slotHoldSeconds(slot: SlotCommand['slot'], emotion: PerformanceEmotion | null, settings: ExpressionPerformanceSettings['slots']): number {
  return settings.holdSeconds * (slot === 'effect' ? settings.effectHoldScale : 1) * (emotion && lingeringEmotions.has(emotion) ? settings.lingerScale : 1)
}

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

/** The decider state an episode's automatic picks read and update. */
interface EpisodeState {
  streams: Record<AutoSlot, number>
  tickets: Record<AutoSlot, Tickets> | null
  occupants: Record<AutoSlot, string | null>
}

/**
 * The state an episode picks from. A new episode draws its tickets and vacates the automatic slots. An escalation
 * keeps both, so it cannot reroll a pick and fills only the slots that are still empty.
 */
export function enterEpisode<S extends EpisodeState>(state: S, episode: ReactionEpisode): S & { tickets: Record<AutoSlot, Tickets> } {
  if (!episode.escalation)
    return { ...state, ...drawEpisodeTickets(state.streams), occupants: { face: null, effect: null } }
  // The mind keeps the reaction history, so an escalation can reach a state that never saw its episode start:
  // after a decider switch, or in a compare replay of a recording that began mid-episode. It draws its own tickets.
  return state.tickets ? { ...state, tickets: state.tickets } : { ...state, ...drawEpisodeTickets(state.streams) }
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
 * The conductor has already checked LLM eligibility. It also reads the first command as the entry's lease before it
 * asks the mind, so the request needs no decided episode.
 */
export function explicitExpressionCommand(signal: Pick<ExpressionSignal, 'expressionId' | 'holdSeconds' | 'turnId'>, ctx: DeciderContext): (SlotCommand & { expressionId: string })[] | null {
  const entry = ctx.catalog.find(entry => entry.id === signal.expressionId)
  const slots = entry ? entrySlots(entry, ctx.catalog) : []
  if (!entry || slots.length === 0)
    return null
  // Every spanned slot shares the first slot's hold: one lease owns them all.
  const holdSeconds = signal.holdSeconds ?? slotHoldSeconds(slots[0], primaryMapping(entry)?.emotion ?? null, ctx.settings.slots)
  return slots.map(slot => ({ slot, expressionId: entry.id, holdSeconds, until: signal.holdSeconds ? 'hold' : 'speech', turnId: signal.turnId }))
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
 * The hold for an accepted episode. A turn's hold lasts as long as a face expression of its emotion, so both linger
 * alike after its speech. A turnless one has no speech to wait for and lasts `held.turnlessSeconds` for every emotion:
 * the emotion gates and the MMD body's pulse are timed on that length.
 */
export function emotionHold(episode: ReactionEpisode, turnId: string | undefined, settings: ExpressionPerformanceSettings): HoldCommand {
  const turnless = turnId === undefined
  return {
    emotion: episode.emotion,
    strength: episode.intensity,
    holdSeconds: turnless ? settings.held.turnlessSeconds : slotHoldSeconds('face', episode.emotion, settings.slots),
    until: turnless ? 'hold' : 'speech',
    turnId,
  }
}

/** Releases the held emotion; used when neutral resets reaction state or a clear names no slot. */
export function releaseHold(turnId: string | undefined): HoldCommand {
  return { emotion: null, strength: 0, holdSeconds: 0, until: 'hold', turnId }
}

/** The heaviest emotion mapping of an entry, earliest on ties, or null without mappings. */
export function primaryMapping(entry: CatalogEntry | undefined): CatalogEntry['mappings'][number] | null {
  return entry?.mappings.reduce<CatalogEntry['mappings'][number] | null>((best, mapping) => best && best.weight >= mapping.weight ? best : mapping, null) ?? null
}
