import type { MotionQaRunScenarioResult, MotionScenario, ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'
import type { InferOutput } from 'valibot'

import { ScenarioEventSchema } from '@proj-airi/stage-shared/motion-scenario'
import { array, finite, literal, looseObject, number, parse, pipe, string, variant } from 'valibot'

/** The trace fields the harness checks; stage-ui-live2d owns the full `NaturalTrace` v2 shape. */
export const TraceEventsSchema = looseObject({
  version: literal(2),
  t: array(pipe(number(), finite())),
  events: array(variant('source', [
    looseObject({ t: pipe(number(), finite()), source: literal('scenario'), event: ScenarioEventSchema }),
    looseObject({ t: pipe(number(), finite()), source: literal('natural'), event: looseObject({ kind: string() }) }),
  ])),
})
export type TraceEvents = InferOutput<typeof TraceEventsSchema>

/** Parses the trace the bridge returned; throws when it is not a v2 trace with stamped events. */
export function parseTraceEvents(value: unknown): TraceEvents {
  return parse(TraceEventsSchema, value)
}

/** How late a scenario event may be stamped after its `at` before the run counts as throttled. */
export const maxEventLagSeconds = 0.5

/** Labels of the marker the bridge stamps when a capture starts: `capture:<label>`. */
export const captureMarkerPrefix = 'capture:'

/** The scenario events stamped into a trace, without the bridge's capture marker. */
export function scenarioEventsOf(trace: TraceEvents): ScenarioEvent[] {
  return trace.events.flatMap(entry => entry.source === 'scenario' && (entry.event.kind !== 'marker' || !entry.event.label.startsWith(captureMarkerPrefix)) ? [entry.event] : [])
}

/** Differences between two scenario event lists by position, comparing `kind` and `at`; empty when they agree. */
export function compareScenarioEvents(expected: readonly ScenarioEvent[], actual: readonly ScenarioEvent[]): string[] {
  const differences: string[] = []
  for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
    const a = expected[index]
    const b = actual[index]
    if (!a || !b)
      differences.push(`#${index}: ${a ? `${a.kind}@${a.at}` : 'missing'} vs ${b ? `${b.kind}@${b.at}` : 'missing'}`)
    else if (a.kind !== b.kind || a.at !== b.at)
      differences.push(`#${index}: ${a.kind}@${a.at} vs ${b.kind}@${b.at}`)
  }
  return differences
}

export interface T3Verification {
  ok: boolean
  failures: string[]
  counts: { scenarioEvents: number, naturalHolds: number, naturalImpulses: number, samples: number, screenshots: number, maxEventLagSeconds: number | null }
}

/**
 * Decides whether a rendered run proved anything: the scenario was dispatched completely, every scenario event is in the
 * trace in order with its `at`, the capture marker is there, Natural reported holds when held emotions were on, the trace
 * has samples, and every planned screenshot exists. A run that misses any of these fails, so success output is never
 * printed for an empty or partial trace.
 */
export function verifyT3Run(input: {
  scenario: MotionScenario
  run: MotionQaRunScenarioResult
  trace: TraceEvents
  screenshots: number
  /** Trace time of the scenario start; when given, each event must be stamped within `maxEventLagSeconds` after its `at`. */
  scenarioStartTraceT?: number
}): T3Verification {
  const { scenario, run, trace } = input
  const failures: string[] = []
  if (trace.version !== 2)
    failures.push(`trace version is ${trace.version}, expected 2`)
  if (run.rejected.length > 0)
    failures.push(`the bridge rejected ${run.rejected.length} events: ${run.rejected.map(item => `${item.kind}@${item.at}: ${item.reason}`).join('; ')}`)
  if (run.dispatched !== scenario.events.length)
    failures.push(`the bridge dispatched ${run.dispatched} of ${scenario.events.length} events`)
  const stamped = scenarioEventsOf(trace)
  const differences = compareScenarioEvents(scenario.events, stamped)
  if (differences.length > 0)
    failures.push(`trace scenario events differ from the scenario: ${differences.slice(0, 5).join('; ')}${differences.length > 5 ? ` (+${differences.length - 5} more)` : ''}`)
  if (!trace.events.some(entry => entry.source === 'scenario' && entry.event.kind === 'marker' && entry.event.label.startsWith(captureMarkerPrefix)))
    failures.push('the trace has no capture marker')
  const naturalHolds = trace.events.filter(entry => entry.source === 'natural' && entry.event.kind === 'hold').length
  const naturalImpulses = trace.events.filter(entry => entry.source === 'natural' && entry.event.kind === 'impulse').length
  const emotional = scenario.events.some(event => event.kind === 'emotion' || event.kind === 'act')
  if (emotional && (scenario.settings?.heldEmotions ?? true) && naturalHolds === 0)
    failures.push('the scenario has emotions but the trace has no Natural hold events')
  const start = input.scenarioStartTraceT
  let maxLag: number | null = null
  if (start !== undefined) {
    for (const entry of trace.events) {
      if (entry.source !== 'scenario' || (entry.event.kind === 'marker' && entry.event.label.startsWith(captureMarkerPrefix)))
        continue
      const lag = entry.t - (start + entry.event.at)
      maxLag = maxLag === null ? lag : Math.max(maxLag, lag)
    }
    if (maxLag !== null && maxLag > maxEventLagSeconds)
      failures.push(`scenario events were stamped up to ${maxLag.toFixed(3)} s after their time (limit ${maxEventLagSeconds} s): the stage window's frames were throttled`)
  }
  if (trace.t.length === 0)
    failures.push('the trace has no samples')
  const planned = scenario.screenshotsAt?.length ?? 0
  if (input.screenshots !== planned)
    failures.push(`${input.screenshots} of ${planned} screenshots were written`)
  return {
    ok: failures.length === 0,
    failures,
    counts: { scenarioEvents: stamped.length, naturalHolds, naturalImpulses, samples: trace.t.length, screenshots: input.screenshots, maxEventLagSeconds: maxLag },
  }
}
