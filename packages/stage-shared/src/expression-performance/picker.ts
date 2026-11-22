import type { AutoSlot, Tickets } from './selection'
import type { Decider, DeciderContext, PerformanceDecision } from './types'

import { entrySlots } from './combos'
import { applySlotOccupants, autoPicks, clearCommands, drawEpisodeTickets, enterEpisode, explicitExpressionCommand, neutralCommands, slotHoldSeconds } from './selection'

/** Episode tickets and occupants survive checkpoints so escalations cannot reroll a pick. */
export interface PickerState {
  recency: Record<string, number>
  occupants: Record<AutoSlot, string | null>
  streams: Record<AutoSlot, number>
  tickets: Record<AutoSlot, Tickets> | null
}

/**
 * Pure baseline policy: it picks the entries that show an episode the mind decided. Speech lifetimes belong to the
 * slot performer, not this state.
 */
export function createPickerDecider(): Decider<PickerState> {
  return {
    initial(seed) {
      return {
        recency: {},
        occupants: { face: null, effect: null },
        streams: { face: (seed ^ 0x9E3779B9) >>> 0, effect: (seed ^ 0x85EBCA6B) >>> 0 },
        tickets: null,
      }
    },
    nextDeadline: () => null,
    decide(signal, ctx: DeciderContext, state) {
      const decision: PerformanceDecision = { slots: [] }
      if (signal.kind === 'expression') {
        const commands = explicitExpressionCommand(signal, ctx)
        if (!commands)
          return { decision, state }
        decision.slots.push(...commands)
        // An episode the entry started draws its tickets, so a later escalation picks from them. The entry is the
        // pick, so no automatic pick runs and the other slot keeps its occupant.
        const drawn = signal.episode && !signal.episode.escalation ? drawEpisodeTickets(signal.intentId) : {}
        const occupants = applySlotOccupants(state.occupants, commands, ctx.catalog)
        return { decision, state: { ...state, ...drawn, occupants, recency: { ...state.recency, [commands[0].expressionId]: signal.at } } }
      }
      if (signal.kind === 'clear') {
        // Episode tickets stay, so a later escalation may refill a cleared slot.
        decision.slots = clearCommands(signal)
        const occupants = applySlotOccupants(state.occupants, decision.slots, ctx.catalog)
        return { decision, state: { ...state, occupants } }
      }
      if (signal.kind === 'neutral') {
        decision.slots = neutralCommands(signal.turnId)
        return { decision, state: { ...state, occupants: { face: null, effect: null }, tickets: null } }
      }
      if (signal.kind !== 'reaction')
        return { decision, state }
      const { episode } = signal
      let next = enterEpisode(state, episode, signal.intentId)
      if (!ctx.settings.autoExpressions)
        return { decision, state: next }
      for (const { slot: picked, expressionId } of autoPicks(episode, ctx, next.tickets, next.occupants, next.recency, signal.at)) {
        // Every slot a combo spans shares the hold of the slot it was picked for: one lease owns them all.
        const holdSeconds = slotHoldSeconds(picked, episode.emotion, ctx.settings.slots)
        const commands = entrySlots(ctx.catalog.find(entry => entry.id === expressionId)!, ctx.catalog).map(slot => ({ slot, expressionId, holdSeconds, until: 'speech' as const, turnId: signal.turnId }))
        decision.slots.push(...commands)
        next = { ...next, occupants: applySlotOccupants(next.occupants, commands, ctx.catalog), recency: { ...next.recency, [expressionId]: signal.at } }
      }
      return { decision, state: next }
    },
  }
}
