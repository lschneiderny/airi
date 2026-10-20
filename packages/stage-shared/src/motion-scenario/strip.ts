import type { MotionScenario, ScenarioEvent } from './schema'

function strip(event: ScenarioEvent): ScenarioEvent {
  if (event.kind !== 'emotion' && event.kind !== 'act')
    return event
  return {
    kind: 'noop',
    at: event.at,
    replaced: event.kind,
    ...(event.trialId === undefined ? {} : { trialId: event.trialId }),
  }
}

/**
 * Replaces every `emotion` and `act` event with a `noop` that keeps `at` and `trialId`.
 * The paired null run therefore has the same event count and timeline as the full run.
 */
export function stripEmotions(scenario: MotionScenario): MotionScenario {
  return { ...scenario, events: scenario.events.map(strip) }
}
