/**
 * Which bucket a turn counts in. A rejection wins over recovery: a recovered marker-shaped cue that the stage
 * rejects counts as rejected and must not read as a successful recovery. Bracketed prose such as `[Act 2]` is
 * never recovered. A turn whose only cues the runtime stripped also counts as rejected, but a native or recovered
 * cue of the same turn wins over the stripped ones.
 */
export type CueComplianceOutcome = 'rejected' | 'recovered' | 'parsed' | 'none'

/** The per-turn cue counts the bucket rules read. */
export interface CueComplianceCounts {
  act: number
  recovered: number
  rejected: number
  stripped: number
}

export interface CueComplianceRates {
  /** Spoken turns counted, newest first, at most the window. */
  turns: number
  /** Declined turns within the same newest records. They are excluded from every rate. */
  declined: number
  parsed: number
  recovered: number
  rejected: number
  none: number
}

export function cueComplianceOutcome(record: CueComplianceCounts): CueComplianceOutcome {
  if (record.rejected > 0)
    return 'rejected'
  if (record.recovered > 0)
    return 'recovered'
  if (record.act > 0)
    return 'parsed'
  if (record.stripped > 0)
    return 'rejected'
  return 'none'
}

/** Counts outcomes over the newest `window` records. Records are newest first. */
export function cueComplianceRates(records: readonly (CueComplianceCounts & { declined: boolean })[], window: number): CueComplianceRates {
  const rates: CueComplianceRates = { turns: 0, declined: 0, parsed: 0, recovered: 0, rejected: 0, none: 0 }
  for (const record of records.slice(0, window)) {
    if (record.declined) {
      rates.declined++
      continue
    }
    rates.turns++
    rates[cueComplianceOutcome(record)]++
  }
  return rates
}
