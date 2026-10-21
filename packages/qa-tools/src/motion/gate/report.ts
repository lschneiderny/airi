import type { InferOutput } from 'valibot'

import { array, boolean, literal, looseObject, nullable, number, optional, parse, picklist, pipe, record, regex, string } from 'valibot'

/**
 * Report schema versions:
 * - absent (1): the todo-12 shape, verdict fields only.
 * - 2: adds the review fields `trajectory` and `levels` to every emotion result. They are additive; no verdict
 *   field changed, and a reader of schema 1 ignores them.
 */
export const currentReportSchema = 2

/** Paired mean trajectory of one emotion check, direction-folded like `E`, with a seeded bootstrap 95% band. */
export const ResultTrajectorySchema = looseObject({
  /** Seconds after the pulse of the first point, and the step between points. */
  start: number(),
  step: number(),
  mean: array(number()),
  low: array(number()),
  high: array(number()),
  /** Trials behind the mean (full variant, side known when the check is sided, not rejected). */
  n: number(),
})
export type ResultTrajectory = InferOutput<typeof ResultTrajectorySchema>

/** Absolute levels of one Cubism parameter across the trials of a check, in the rig's raw units. */
export const ResultLevelSchema = looseObject({
  id: string(),
  /** Mean baseline-window level. */
  baseline: number(),
  /** Mean of the per-trial scored-window peaks (the sample furthest from the baseline). */
  peak: number(),
  /** The single per-trial peak furthest from the mean baseline. */
  extreme: number(),
  min: number(),
  max: number(),
})
export type ResultLevel = InferOutput<typeof ResultLevelSchema>

/** Report shape shared by the emotion and liveliness gates; later tools read `report.json` through this schema. */
export const GateReportSchema = looseObject({
  gateId: string(),
  /** The gate's integer version. `run.json` stores it as a string. */
  version: number(),
  fileSha: string(),
  inputHash: pipe(string(), regex(/^[0-9a-f]{64}$/)),
  level: picklist(['t1', 't2', 't3']),
  limitation: string(),
  pass: boolean(),
  nullStats: record(string(), looseObject({ sigma0: number(), q: number(), n: number() })),
  results: array(looseObject({
    key: string(),
    verdict: picklist(['pass', 'fail', 'n/a']),
    /** Schema 2, emotion checks of face, eyelid and posture channels; `null` when no trial carried samples. */
    trajectory: optional(nullable(ResultTrajectorySchema)),
    levels: optional(nullable(array(ResultLevelSchema))),
  })),
  determinismHash: pipe(string(), regex(/^[0-9a-f]{64}$/)),
  /** Present for emotion runs: what was run. `seedsLimit` is null for the committed seed counts. */
  selection: optional(looseObject({ seedsLimit: nullable(number()) })),
  /** Absent in schema-1 reports (before the review fields existed). */
  reportSchema: optional(literal(currentReportSchema)),
})
export type GateReport = InferOutput<typeof GateReportSchema>

export function parseGateReport(input: unknown): GateReport {
  return parse(GateReportSchema, input)
}
