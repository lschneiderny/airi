import type { MotionScenario, ScenarioEvent } from './schema'

export interface ScenarioPlayer {
  /** Events with `t0 < at <= t1`, in scenario order. The window is half-open so consecutive windows never repeat or skip an event. */
  eventsBetween: (t0: number, t1: number) => ScenarioEvent[]
}

/** Pure lookup over a scenario; the caller owns the clock. */
export function createScenarioPlayer(scenario: MotionScenario): ScenarioPlayer {
  return {
    eventsBetween: (t0, t1) => scenario.events.filter(event => event.at > t0 && event.at <= t1),
  }
}
