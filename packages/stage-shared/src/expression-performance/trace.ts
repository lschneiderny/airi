import type { AffectSignal, Decider, DeciderContext, PerformanceDecision } from './types'

import { array, boolean, check, finite, literal, maxValue, minValue, number, optional, parse, picklist, pipe, strictObject, string, unknown, variant } from 'valibot'

import { CatalogEntrySchema } from './catalog'
import { ExpressionPerformanceSettingsSchema } from './settings'

const seconds = pipe(number(), finite(), minValue(0))
const turnId = optional(string())
const emotion = picklist(['happy', 'sad', 'angry', 'think', 'surprised', 'awkward', 'question', 'curious', 'neutral'])
const contextSchema = strictObject({ catalog: array(CatalogEntrySchema), settings: ExpressionPerformanceSettingsSchema })
const signalSchema = variant('kind', [
  strictObject({ kind: literal('emotion'), source: picklist(['act', 'tool', 'devtools']), emotion, nominal: pipe(number(), finite(), minValue(0), maxValue(1)), turnId, at: seconds }),
  strictObject({ kind: literal('expression'), source: picklist(['act', 'tool']), expressionId: string(), holdSeconds: optional(seconds), turnId, at: seconds }),
  strictObject({ kind: literal('speech'), event: picklist(['clip-start', 'clip-end', 'clip-stopped', 'turn-end']), turnId: string(), clipId: optional(string()), at: seconds }),
  strictObject({ kind: literal('muted'), muted: boolean(), at: seconds }),
  strictObject({ kind: literal('timing'), event: strictObject({ id: string(), kind: picklist(['sentence_start', 'pause', 'utterance_end', 'emphasis']), turnId: string(), at: seconds }), at: seconds }),
  strictObject({ kind: literal('deadline'), at: seconds }),
])

function isJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return true
  if (typeof value === 'number')
    return Number.isFinite(value)
  if (Array.isArray(value))
    return value.every(isJson)
  return typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value).every(isJson)
}

/** Checkpoints and contexts belong to the recording start, not the decider's initial seed. */
export const AffectTraceSchema = pipe(strictObject({
  version: literal(1),
  decider: picklist(['picker', 'planner']),
  checkpoint: pipe(unknown(), check(isJson, 'Expected a JSON checkpoint')),
  initialContext: contextSchema,
  entries: array(variant('type', [
    strictObject({ type: literal('signal'), signal: signalSchema }),
    strictObject({ type: literal('context'), context: contextSchema }),
  ])),
  truncated: boolean(),
  endAt: seconds,
}), check((trace) => {
  let at = 0
  for (const entry of trace.entries) {
    if (entry.type === 'context')
      continue
    if (entry.signal.at < at || entry.signal.at > trace.endAt)
      return false
    at = entry.signal.at
  }
  return true
}, 'Expected monotonic signal times no later than endAt'))

/** An explicit recording session, including its terminal monotonic time for comparison deadlines. */
export interface AffectTrace {
  version: 1
  decider: 'picker' | 'planner'
  checkpoint: unknown
  initialContext: DeciderContext
  entries: ({ type: 'signal', signal: AffectSignal } | { type: 'context', context: DeciderContext })[]
  truncated: boolean
  endAt: number
}

/** Validates imported trace JSON without exposing a schema dependency to CLI consumers. */
export function parseAffectTrace(input: unknown): AffectTrace {
  return parse(AffectTraceSchema, input)
}

/** The caller tags the selected policy because the runtime-neutral Decider has no identity field. */
export type TraceDecider<S> = Decider<S> & { kind: AffectTrace['decider'] }

/** Calls the sink synchronously before the wrapped policy sees each signal. */
export function withAffectTrace<S>(decider: Decider<S>, sink: (signal: AffectSignal) => void): Decider<S> {
  return {
    ...decider,
    decide(signal, context, state) {
      sink(signal)
      return decider.decide(signal, context, state)
    },
  }
}

/** Exact replay preserves deadlines; comparison rebuilds them from the target policy's state. */
export function replayAffectTrace<S>(trace: AffectTrace, decider: TraceDecider<S>, options: { mode: 'exact' } | { mode: 'compare', seed: number }) {
  if (trace.truncated)
    throw new Error('Cannot replay a truncated affect trace')
  if (options.mode === 'exact' && trace.decider !== decider.kind)
    throw new Error('Exact replay requires the recorded decider kind')

  // State validation belongs to the selected decider; the trace envelope deliberately treats it as opaque.
  let state = options.mode === 'exact' ? structuredClone(trace.checkpoint) as S : decider.initial(options.seed)
  let context = trace.initialContext
  const decisions: { at: number, decision: PerformanceDecision }[] = []
  function feed(signal: AffectSignal) {
    const result = decider.decide(signal, context, state)
    state = result.state
    decisions.push({ at: signal.at, decision: result.decision })
  }
  function deadlines(until: number) {
    let previous = -Infinity
    for (let at = decider.nextDeadline(state); at !== null && at <= until; at = decider.nextDeadline(state)) {
      if (!Number.isFinite(at) || at <= previous)
        throw new Error('Decider deadlines must advance')
      previous = at
      feed({ kind: 'deadline', at })
    }
  }
  for (const entry of trace.entries) {
    if (entry.type === 'context') {
      context = entry.context
      continue
    }
    if (options.mode === 'compare') {
      if (entry.signal.kind === 'deadline')
        continue
      deadlines(entry.signal.at)
    }
    feed(entry.signal)
  }
  if (options.mode === 'compare')
    deadlines(trace.endAt)
  return decisions
}
