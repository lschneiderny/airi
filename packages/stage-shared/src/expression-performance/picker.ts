import type { ReactionState } from './reaction-strength'
import type { AutoSlot, Tickets } from './selection'
import type { Decider, DeciderContext, PerformanceDecision } from './types'

import { acceptReaction, createReactionState } from './reaction-strength'
import { autoPicks, clearCommands, drawEpisodeTickets, emotionHold, explicitExpressionCommand, explicitExpressionReaction, neutralCommands, releaseHold } from './selection'

/** Episode tickets and occupants survive checkpoints so escalations cannot reroll a pick. */
export interface PickerState {
  reaction: ReactionState
  recency: Record<string, number>
  occupants: Record<AutoSlot, string | null>
  streams: Record<AutoSlot, number>
  tickets: Record<AutoSlot, Tickets> | null
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
      const decision: PerformanceDecision = { episodes: [], slots: [], holds: [] }
      if (signal.kind === 'expression') {
        const command = explicitExpressionCommand(signal, ctx)
        if (!command)
          return { decision, state }
        decision.slots.push(command)
        const derived = explicitExpressionReaction(command, signal, ctx, state)
        decision.episodes.push(...derived.episodes)
        decision.holds.push(...derived.holds)
        const occupants = command.slot === 'prop' ? derived.state.occupants : { ...derived.state.occupants, [command.slot]: command.expressionId }
        return { decision, state: { ...derived.state, occupants, recency: { ...state.recency, [command.expressionId]: signal.at } } }
      }
      if (signal.kind === 'clear') {
        // Reaction history and episode tickets stay, so a later escalation may refill a cleared slot.
        decision.slots = clearCommands(signal)
        if (!signal.slot)
          decision.holds.push(releaseHold(signal.turnId))
        const cleared = decision.slots.map(command => command.slot)
        const occupants = {
          face: cleared.includes('face') ? null : state.occupants.face,
          effect: cleared.includes('effect') ? null : state.occupants.effect,
        }
        return { decision, state: { ...state, occupants } }
      }
      if (signal.kind !== 'emotion')
        return { decision, state }
      const reaction = acceptReaction(state.reaction, signal.emotion, ctx.settings.bands ? signal.nominal : 0.6, signal.at, ctx.settings)
      let next = { ...state, reaction: reaction.state }
      if (signal.emotion === 'neutral' && reaction.state !== state.reaction) {
        decision.slots = neutralCommands(signal.turnId)
        decision.holds.push(releaseHold(signal.turnId))
        return { decision, state: { ...next, occupants: { face: null, effect: null }, tickets: null } }
      }
      const episode = reaction.episode
      if (!episode)
        return { decision, state: next }
      decision.episodes.push(episode)
      decision.holds.push(emotionHold(episode, signal.turnId, ctx.settings))
      if (!episode.escalation)
        next = { ...next, ...drawEpisodeTickets(state.streams), occupants: { face: null, effect: null } }
      if (!ctx.settings.autoExpressions)
        return { decision, state: next }
      for (const { slot, expressionId } of autoPicks(episode, ctx, next.tickets!, next.occupants, next.recency, signal.at)) {
        decision.slots.push({ slot, expressionId, holdSeconds: ctx.settings.naturalBands[episode.band].faceHold, until: 'speech', turnId: signal.turnId })
        next = { ...next, occupants: { ...next.occupants, [slot]: expressionId }, recency: { ...next.recency, [expressionId]: signal.at } }
      }
      return { decision, state: next }
    },
  }
}
