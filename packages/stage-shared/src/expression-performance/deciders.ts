import type { PickerState } from './picker'
import type { PlannerState } from './planner'
import type { ExpressionPerformanceSettings } from './settings'
import type { Decider } from './types'

import { createPickerDecider } from './picker'
import { createPlannerDecider } from './planner'

/** The state of either policy; the planner state extends the picker state. */
export type DeciderState = PickerState | PlannerState

/**
 * A state is only ever fed back to the decider whose `initial` created it, but the shared seam
 * types it as either policy's state, so the planner checks that it received its own state.
 */
function plannerState(state: DeciderState): PlannerState {
  if (!('scheduler' in state))
    throw new Error('The planner decider received a picker state; create its state with initial(seed)')
  return state
}

/** Constructs the replayable policy selected by the settings document. */
export function createDecider(kind: ExpressionPerformanceSettings['decider']): Decider<DeciderState> {
  if (kind === 'picker')
    return createPickerDecider()
  const planner = createPlannerDecider()
  return {
    initial: planner.initial,
    nextDeadline: state => planner.nextDeadline(plannerState(state)),
    decide: (signal, ctx, state) => planner.decide(signal, ctx, plannerState(state)),
  }
}
