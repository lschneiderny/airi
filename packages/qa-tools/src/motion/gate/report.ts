import type { InferOutput } from 'valibot'

import { array, boolean, looseObject, nullable, number, optional, parse, picklist, pipe, record, regex, string } from 'valibot'

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
  results: array(looseObject({ key: string(), verdict: picklist(['pass', 'fail', 'n/a']) })),
  determinismHash: pipe(string(), regex(/^[0-9a-f]{64}$/)),
  /** Present for emotion runs: what was run. `seedsLimit` is null for the committed seed counts. */
  selection: optional(looseObject({ seedsLimit: nullable(number()) })),
})
export type GateReport = InferOutput<typeof GateReportSchema>

export function parseGateReport(input: unknown): GateReport {
  return parse(GateReportSchema, input)
}
