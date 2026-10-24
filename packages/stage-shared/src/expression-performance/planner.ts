import type { CatalogEntry } from './catalog'
import type { PickerState } from './picker'
import type { ScheduledPlan, SchedulerState } from './scheduler'
import type { AutoSlot } from './selection'
import type { Decider, DeciderContext, PerformanceDecision, SlotCommand } from './types'

import { entrySlots } from './combos'
import { createPickerDecider } from './picker'
import { acceptReaction } from './reaction-strength'
import { cancelTurn, createSchedulerState, earliestExpiry, expire, schedule, take } from './scheduler'
import { applySlotOccupants, autoPicks, clearCommands, drawEpisodeTickets, emotionHold, explicitExpressionCommand, explicitExpressionReaction, neutralCommands, releaseHold } from './selection'
import { bandRank } from './types'

/** An automatic pick waiting for its timing slot. */
export interface PlannedPick {
  slot: AutoSlot
  expressionId: string
  holdSeconds: number
}

/**
 * The picker state plus pending plans and the change budget. It extends the picker state so both
 * deciders select from the same seeded ticket streams, which keeps compare-mode replays fair.
 */
export interface PlannerState extends PickerState {
  scheduler: SchedulerState<PlannedPick>
  /** Admitted automatic slot changes still inside the budget window, oldest first, and the latest one. */
  budget: { changes: number[], lastAt: number | null }
}

/**
 * Admits one automatic slot change at `at`, or returns null when it is over budget. A change
 * needs fewer than `windowMax` admitted slot changes in the last `window` seconds, counted per
 * slot, and at least `minGap` seconds since the previous performance moment. The changes of one
 * decision share one moment, so a face and an effect change together: `minGap` is measured
 * between performance moments, not slot changes.
 */
function admit(budget: PlannerState['budget'], at: number, settings: DeciderContext['settings']['planner'], sameMoment: boolean, count: number): PlannerState['budget'] | null {
  const changes = budget.changes.filter(change => at - change < settings.window)
  if (changes.length + count > settings.windowMax)
    return null
  if (!sameMoment && budget.lastAt !== null && at - budget.lastAt < settings.minGap)
    return null
  return { changes: [...changes, ...Array.from({ length: count }).fill(at)], lastAt: at }
}

function pickSlots(pick: PlannedPick, catalog: readonly CatalogEntry[]) {
  const entry = catalog.find(entry => entry.id === pick.expressionId)
  return entry ? entrySlots(entry, catalog) : []
}

/** A newer immediate change for a slot makes its pending plans stale. */
function withoutSlots(scheduler: SchedulerState<PlannedPick>, slots: readonly SlotCommand['slot'][], catalog: readonly CatalogEntry[]): SchedulerState<PlannedPick> {
  const plans = scheduler.plans.filter(plan => !pickSlots(plan.payload, catalog).some(slot => slots.includes(slot)))
  return plans.length === scheduler.plans.length ? scheduler : { ...scheduler, plans }
}

/**
 * Pure planner policy. It selects exactly like the picker but decides when a pick reaches the performer:
 * - Episodes are returned at once, so Natural motion never waits for a timing slot.
 * - Strong episodes, escalations, and signals without a turn id emit their picks at once.
 * - Other faces wait for the turn's next `sentence_start`, other effects for its next `pause`.
 *   A pick that waits `planner.scheduleExpiry` seconds is emitted by the deadline signal at its
 *   expiry; `nextDeadline` reports the earliest expiry, so no other input is needed.
 * - When one event releases several plans, the first plan per slot in scheduler precedence wins
 *   (band rank, then intensity, then insertion order); the others are consumed and dropped.
 * - Every automatic change passes the budget (see {@link admit}); over-budget picks are dropped, not queued.
 * - Explicit LLM expressions, clears, and neutral bypass the budget and act at once.
 * - `utterance_end` cancels the turn's pending plans.
 * - A decision made while `autoExpressions` is off drops every pending plan before it handles the signal.
 */
export function createPlannerDecider(): Decider<PlannerState> {
  const picker = createPickerDecider()
  return {
    initial(seed) {
      return { ...picker.initial(seed), scheduler: createSchedulerState<PlannedPick>(), budget: { changes: [], lastAt: null } }
    },
    nextDeadline: state => earliestExpiry(state.scheduler),
    decide(signal, ctx, state) {
      const decision: PerformanceDecision = { episodes: [], slots: [], holds: [] }
      // Every pending plan is an automatic pick, so any decision made while the switch is off drops
      // them all: none can activate later, even after the switch is turned back on. Explicit
      // expressions, clears, active slots, and performer leases are not plans and stay untouched.
      if (!ctx.settings.autoExpressions && state.scheduler.plans.length > 0)
        state = { ...state, scheduler: { ...state.scheduler, plans: [] } }
      let next = state
      let admittedThisDecision = false

      function emitAuto(pick: PlannedPick, turnId: string | undefined) {
        const slots = pickSlots(pick, ctx.catalog)
        if (slots.length === 0)
          return false
        const budget = admit(next.budget, signal.at, ctx.settings.planner, admittedThisDecision, slots.length)
        if (!budget)
          return false
        admittedThisDecision = true
        const commands = slots.map(slot => ({ slot, expressionId: pick.expressionId, holdSeconds: pick.holdSeconds, until: 'speech' as const, turnId }))
        decision.slots.push(...commands)
        next = { ...next, budget, occupants: applySlotOccupants(next.occupants, commands, ctx.catalog), recency: { ...next.recency, [pick.expressionId]: signal.at }, scheduler: withoutSlots(next.scheduler, slots, ctx.catalog) }
        return true
      }

      function release(plans: ScheduledPlan<PlannedPick>[]) {
        const arbitrated = new Set<SlotCommand['slot']>()
        for (const plan of plans) {
          const slots = pickSlots(plan.payload, ctx.catalog)
          if (slots.some(slot => arbitrated.has(slot)))
            continue
          for (const slot of slots)
            arbitrated.add(slot)
          emitAuto(plan.payload, plan.turnId)
        }
      }

      switch (signal.kind) {
        case 'expression': {
          const commands = explicitExpressionCommand(signal, ctx)
          if (!commands)
            return { decision, state }
          decision.slots.push(...commands)
          const command = commands[0]
          const derived = explicitExpressionReaction(command, signal, ctx, state)
          decision.episodes.push(...derived.episodes)
          decision.holds.push(...derived.holds)
          const recency = { ...state.recency, [command.expressionId]: signal.at }
          // A newly derived episode supersedes the previous reaction's queued picks. No automatic
          // picks are made for this explicit command, including when its slot is a prop.
          const scheduler = derived.episodes.some(episode => !episode.escalation)
            ? { ...state.scheduler, plans: [] }
            : state.scheduler
          return { decision, state: {
            ...derived.state,
            occupants: applySlotOccupants(derived.state.occupants, commands, ctx.catalog),
            recency,
            scheduler: withoutSlots(scheduler, commands.map(command => command.slot), ctx.catalog),
          } }
        }
        case 'clear': {
          // Like the picker: reaction history and episode tickets stay, so a later escalation may refill the slot.
          decision.slots = clearCommands(signal)
          if (!signal.slot)
            decision.holds.push(releaseHold(signal.turnId))
          const cleared = decision.slots.map(command => command.slot)
          const occupants = applySlotOccupants(state.occupants, decision.slots, ctx.catalog)
          return { decision, state: { ...state, occupants, scheduler: withoutSlots(state.scheduler, cleared, ctx.catalog) } }
        }
        case 'timing': {
          if (signal.event.kind === 'utterance_end')
            return { decision, state: { ...state, scheduler: cancelTurn(state.scheduler, signal.event.turnId) } }
          const taken = take(state.scheduler, signal.event)
          next = { ...next, scheduler: taken.state }
          release(taken.plans)
          return { decision, state: next }
        }
        case 'deadline': {
          const expired = expire(state.scheduler, signal.at)
          next = { ...next, scheduler: expired.state }
          release(expired.expired)
          return { decision, state: next }
        }
        case 'speech':
        case 'muted':
          return { decision, state }
      }

      const reaction = acceptReaction(state.reaction, signal.emotion, ctx.settings.bands ? signal.nominal : 0.6, signal.at, ctx.settings)
      next = { ...next, reaction: reaction.state }
      if (signal.emotion === 'neutral' && reaction.state !== state.reaction) {
        decision.slots = neutralCommands(signal.turnId)
        decision.holds.push(releaseHold(signal.turnId))
        return { decision, state: { ...next, occupants: { face: null, effect: null }, tickets: null, scheduler: { ...next.scheduler, plans: [] } } }
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

      const turnId = signal.turnId
      const immediate = episode.band === 'strong' || episode.escalation
      const holdSeconds = ctx.settings.naturalBands[episode.band].faceHold
      for (const { slot, expressionId } of autoPicks(episode, ctx, next.tickets!, next.occupants, next.recency, signal.at)) {
        const pick = { slot, expressionId, holdSeconds }
        // Without a turn no timing event can ever take the plan, so devtools pulses emit at once.
        if (immediate || turnId === undefined) {
          emitAuto(pick, turnId)
          continue
        }
        next = { ...next, scheduler: schedule(next.scheduler, {
          reactionId: episode.id,
          slot: slot === 'face' ? 'sentence_start' : 'pause',
          turnId,
          notBefore: signal.at,
          expiresAt: signal.at + ctx.settings.planner.scheduleExpiry,
          priority: bandRank[episode.band],
          intensity: episode.intensity,
          payload: pick,
        }) }
      }
      return { decision, state: next }
    },
  }
}
