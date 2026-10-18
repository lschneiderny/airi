import type { CatalogEntry } from './catalog'
import type { ReactionState } from './reaction-strength'
import type { ExpressionPerformanceSettings } from './settings'
import type { Decider, DeciderContext, PerformanceDecision, ReactionEpisode, SlotCommand } from './types'

import { isAutoEligible } from './catalog'
import { acceptReaction, createReactionState, drawRandom } from './reaction-strength'
import { bandRank } from './types'

type AutoSlot = 'face' | 'effect'

/** A clear without a slot releases every slot an LLM can fill. */
const clearedSlots = ['face', 'effect', 'prop'] as const satisfies readonly SlotCommand['slot'][]
interface Tickets { gate: number, pick: number }
interface Candidate { id: string, weight: number }

/** Episode tickets and occupants survive checkpoints so escalations cannot reroll a pick. */
export interface PickerState {
  reaction: ReactionState
  recency: Record<string, number>
  occupants: Record<AutoSlot, string | null>
  streams: Record<AutoSlot, number>
  tickets: Record<AutoSlot, Tickets> | null
}

/** Always advances twice, independently of candidates and gate outcome. */
export function drawPickerTickets(random: number) {
  const gate = drawRandom(random)
  const pick = drawRandom(gate.random)
  return { random: pick.random, tickets: { gate: gate.value, pick: pick.value } }
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

/** Pure baseline policy; speech lifetimes belong to the slot performer, not this state. */
export function createPickerDecider(): Decider<PickerState> {
  return {
    initial(seed) {
      return {
        reaction: createReactionState(seed),
        recency: {},
        occupants: { face: null, effect: null },
        streams: { face: (seed ^ 0x9E3779B9) >>> 0, effect: (seed ^ 0x85EBCA6B) >>> 0 },
        tickets: null,
      }
    },
    nextDeadline: () => null,
    decide(signal, ctx: DeciderContext, state) {
      const decision: PerformanceDecision = { episodes: [], slots: [] }
      if (signal.kind === 'expression') {
        const entry = ctx.catalog.find(entry => entry.id === signal.expressionId)
        if (!entry || (entry.kind !== 'face' && entry.kind !== 'effect' && entry.kind !== 'prop'))
          return { decision, state }
        decision.slots.push({ slot: entry.kind, expressionId: entry.id, holdSeconds: signal.holdSeconds ?? ctx.settings.naturalBands.clear.faceHold, until: signal.holdSeconds ? 'hold' : 'speech', turnId: signal.turnId })
        const occupants = entry.kind === 'prop' ? state.occupants : { ...state.occupants, [entry.kind]: entry.id }
        return { decision, state: { ...state, occupants, recency: { ...state.recency, [entry.id]: signal.at } } }
      }
      if (signal.kind === 'clear') {
        // Reaction history and episode tickets stay, so a later escalation may refill a cleared slot.
        const slots = signal.slot ? [signal.slot] : clearedSlots
        decision.slots = slots.map(slot => ({ slot, expressionId: null, holdSeconds: 0, until: 'hold', turnId: signal.turnId }))
        const occupants = {
          face: slots.includes('face') ? null : state.occupants.face,
          effect: slots.includes('effect') ? null : state.occupants.effect,
        }
        return { decision, state: { ...state, occupants } }
      }
      if (signal.kind !== 'emotion')
        return { decision, state }
      const reaction = acceptReaction(state.reaction, signal.emotion, ctx.settings.bands ? signal.nominal : 0.6, signal.at, ctx.settings)
      let next = { ...state, reaction: reaction.state }
      if (signal.emotion === 'neutral' && reaction.state !== state.reaction) {
        decision.slots = (['face', 'effect'] as const).map(slot => ({ slot, expressionId: null, holdSeconds: 0, until: 'speech', turnId: signal.turnId }))
        return { decision, state: { ...next, occupants: { face: null, effect: null }, tickets: null } }
      }
      const episode = reaction.episode
      if (!episode)
        return { decision, state: next }
      decision.episodes.push(episode)
      if (!episode.escalation) {
        const face = drawPickerTickets(state.streams.face)
        const effect = drawPickerTickets(state.streams.effect)
        next = { ...next, streams: { face: face.random, effect: effect.random }, tickets: { face: face.tickets, effect: effect.tickets }, occupants: { face: null, effect: null } }
      }
      if (!ctx.settings.autoExpressions)
        return { decision, state: next }
      const { effectGateFrom, effectGateTo } = ctx.settings.picker
      const effectGate = effectGateFrom === effectGateTo
        ? Number(episode.intensity >= effectGateTo)
        : Math.max(0, Math.min(1, (episode.intensity - effectGateFrom) / (effectGateTo - effectGateFrom)))
      for (const slot of ['face', 'effect'] as const) {
        if (next.occupants[slot])
          continue
        const id = pickExpression(pickerCandidates(ctx.catalog, episode, slot), next.tickets![slot], slot === 'face' ? 1 : effectGate, next.recency, signal.at, ctx.settings.picker)
        if (id === null)
          continue
        const command: SlotCommand = { slot, expressionId: id, holdSeconds: ctx.settings.naturalBands[episode.band].faceHold, until: 'speech', turnId: signal.turnId }
        decision.slots.push(command)
        next = { ...next, occupants: { ...next.occupants, [slot]: id }, recency: { ...next.recency, [id]: signal.at } }
      }
      return { decision, state: next }
    },
  }
}
