import type { TimingEvent } from './types'

/**
 * A performance plan waiting for a timing slot of one turn.
 *
 * @param P The decider's JSON payload, applied by the decider when the plan is taken or expires.
 */
export interface ScheduledPlan<P> {
  /** The reaction that produced the plan, so a decider can correlate later signals with it. */
  reactionId: string
  /** The timing event kind that releases the plan. */
  slot: TimingEvent['kind']
  /** Only a timing event of this turn takes the plan; other turns never see it. */
  turnId: string
  /** Earliest event time, in signal seconds, that may take the plan (inclusive). */
  notBefore: number
  /** Event time from which the plan can no longer be taken (exclusive); {@link expire} returns it from then on. */
  expiresAt: number
  /** Higher priority is taken first among plans released by the same event. */
  priority: number
  /** Breaks priority ties: higher intensity is taken first. */
  intensity: number
  payload: P
  /** Insertion order, the last tie breaker. */
  seq: number
}

/**
 * Plain-JSON scheduler state, kept inside a decider's state so checkpoints and trace replay
 * carry pending plans. The functions below never mutate their input.
 *
 * @param P The decider's JSON payload.
 */
export interface SchedulerState<P> {
  plans: ScheduledPlan<P>[]
  nextSeq: number
}

export type PlanRequest<P> = Omit<ScheduledPlan<P>, 'seq'>

export function createSchedulerState<P>(): SchedulerState<P> {
  return { plans: [], nextSeq: 0 }
}

function byPrecedence<P>(a: ScheduledPlan<P>, b: ScheduledPlan<P>) {
  return b.priority - a.priority || b.intensity - a.intensity || a.seq - b.seq
}

export function schedule<P>(state: SchedulerState<P>, request: PlanRequest<P>): SchedulerState<P> {
  return { plans: [...state.plans, { ...request, seq: state.nextSeq }], nextSeq: state.nextSeq + 1 }
}

/**
 * Consumes every plan that `event` releases: same slot kind and turn id, with
 * `notBefore <= event.at < expiresAt`. Each plan is taken at most once.
 *
 * Returns the taken plans in precedence order (priority, then intensity, both descending, then
 * insertion order), so the decider resolves conflicts by applying the first plan per performer slot.
 */
export function take<P>(state: SchedulerState<P>, event: TimingEvent): { state: SchedulerState<P>, plans: ScheduledPlan<P>[] } {
  const released = (plan: ScheduledPlan<P>) => plan.slot === event.kind && plan.turnId === event.turnId && plan.notBefore <= event.at && event.at < plan.expiresAt
  const plans = state.plans.filter(released)
  if (plans.length === 0)
    return { state, plans }
  return { state: { ...state, plans: state.plans.filter(plan => !released(plan)) }, plans: plans.sort(byPrecedence) }
}

/** Drops every pending plan of a turn, for example when its utterance ends. */
export function cancelTurn<P>(state: SchedulerState<P>, turnId: string): SchedulerState<P> {
  const plans = state.plans.filter(plan => plan.turnId !== turnId)
  return plans.length === state.plans.length ? state : { ...state, plans }
}

/**
 * Removes and returns the plans that can no longer be taken at `now` (`expiresAt <= now`),
 * ordered by expiry time and then insertion order.
 */
export function expire<P>(state: SchedulerState<P>, now: number): { state: SchedulerState<P>, expired: ScheduledPlan<P>[] } {
  const expired = state.plans.filter(plan => plan.expiresAt <= now)
  if (expired.length === 0)
    return { state, expired }
  return {
    state: { ...state, plans: state.plans.filter(plan => plan.expiresAt > now) },
    expired: expired.sort((a, b) => a.expiresAt - b.expiresAt || a.seq - b.seq),
  }
}

/** The decider's `nextDeadline` contribution: the earliest pending expiry, or null with no plans. */
export function earliestExpiry<P>(state: SchedulerState<P>): number | null {
  return state.plans.length === 0 ? null : Math.min(...state.plans.map(plan => plan.expiresAt))
}
