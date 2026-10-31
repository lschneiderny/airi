import type { ReactionState } from './reaction-strength'
import type { AutoSlot, Tickets } from './selection'
import type { TouchAffectMemory } from './touch-affect'
import type { Decider, DeciderContext, PerformanceDecision } from './types'

import { entrySlots } from './combos'
import { acceptReaction, createReactionState } from './reaction-strength'
import { applySlotOccupants, autoPicks, clearCommands, drawEpisodeTickets, emotionHold, explicitExpressionCommand, explicitExpressionReaction, neutralCommands, releaseHold } from './selection'
import { initialTouchAffectMemory, touchAffect } from './touch-affect'

/** Episode tickets and occupants survive checkpoints so escalations cannot reroll a pick. */
export interface PickerState {
  reaction: ReactionState
  recency: Record<string, number>
  occupants: Record<AutoSlot, string | null>
  streams: Record<AutoSlot, number>
  tickets: Record<AutoSlot, Tickets> | null
  /** Touch pacing and habituation behind the mood doses of `touch` signals. */
  touch: TouchAffectMemory
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
        touch: initialTouchAffectMemory,
      }
    },
    nextDeadline: () => null,
    decide(signal, ctx: DeciderContext, state) {
      const decision: PerformanceDecision = { episodes: [], slots: [], holds: [], moods: [] }
      if (signal.kind === 'touch') {
        const affect = touchAffect(state.touch, signal, ctx.settings)
        if (affect.dose)
          decision.moods.push(affect.dose)
        return { decision, state: { ...state, touch: affect.memory } }
      }
      if (signal.kind === 'expression') {
        const commands = explicitExpressionCommand(signal, ctx)
        if (!commands)
          return { decision, state }
        decision.slots.push(...commands)
        const command = commands[0]
        const derived = explicitExpressionReaction(command, signal, ctx, state)
        decision.episodes.push(...derived.episodes)
        decision.holds.push(...derived.holds)
        const occupants = applySlotOccupants(derived.state.occupants, commands, ctx.catalog)
        return { decision, state: { ...derived.state, occupants, recency: { ...state.recency, [command.expressionId]: signal.at } } }
      }
      if (signal.kind === 'clear') {
        // Reaction history and episode tickets stay, so a later escalation may refill a cleared slot.
        decision.slots = clearCommands(signal)
        if (!signal.slot)
          decision.holds.push(releaseHold(signal.turnId))
        const occupants = applySlotOccupants(state.occupants, decision.slots, ctx.catalog)
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
      for (const { expressionId } of autoPicks(episode, ctx, next.tickets!, next.occupants, next.recency, signal.at)) {
        const commands = entrySlots(ctx.catalog.find(entry => entry.id === expressionId)!, ctx.catalog).map(slot => ({ slot, expressionId, holdSeconds: ctx.settings.naturalBands[episode.band].faceHold, until: 'speech' as const, turnId: signal.turnId }))
        decision.slots.push(...commands)
        next = { ...next, occupants: applySlotOccupants(next.occupants, commands, ctx.catalog), recency: { ...next.recency, [expressionId]: signal.at } }
      }
      return { decision, state: next }
    },
  }
}
