import type { ChatStreamEventContext } from '@proj-airi/core-agent'

import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

/** Length cap of the turn history: older turns are dropped first. */
export const ACT_COMPLIANCE_HISTORY_MAX = 100
/** Number of newest turns the compliance rates cover. */
export const ACT_COMPLIANCE_RATE_WINDOW = 50
/** Rejected tokens kept per turn, so a turn full of broken cues cannot grow without bound. */
const REJECTED_TOKENS_MAX = 5

/** How one reply used the ACT cue channel. */
export interface ActComplianceRecord {
  turnId: string
  /** When the reply's stream ended. */
  atMs: number
  origin: 'user' | 'unprompted'
  /** The unprompted turn ended without speech. Its cues were never performed. */
  declined: boolean
  /** ACT markers the reply emitted, including recovered near-misses. */
  act: number
  /** Near-miss cues the parser rewrote into markers. */
  recovered: number
  /** Markers of this turn that the stage's streaming-control controller rejected. */
  rejected: number
  /** The first rejected markers of this turn, as written after recovery. */
  rejectedTokens: string[]
  noAct: boolean
}

/**
 * Which bucket a turn counts in. A rejection wins over recovery: prose such as `[Act 2]` is recovered as a cue,
 * then rejected by the stage, and must not read as a successful recovery.
 */
export type ActComplianceOutcome = 'rejected' | 'recovered' | 'parsed' | 'none'

export interface ActComplianceRates {
  /** Spoken turns counted, newest first, at most {@link ACT_COMPLIANCE_RATE_WINDOW}. */
  turns: number
  /** Declined turns within the same newest records. They are excluded from every rate. */
  declined: number
  parsed: number
  recovered: number
  rejected: number
  none: number
}

export interface ActComplianceInspection {
  /** Newest first, at most {@link ACT_COMPLIANCE_HISTORY_MAX}. */
  records: ActComplianceRecord[]
}

export function actComplianceOutcome(record: Pick<ActComplianceRecord, 'act' | 'recovered' | 'rejected'>): ActComplianceOutcome {
  if (record.rejected > 0)
    return 'rejected'
  if (record.recovered > 0)
    return 'recovered'
  if (record.act > 0)
    return 'parsed'
  return 'none'
}

/** Counts outcomes over the newest {@link ACT_COMPLIANCE_RATE_WINDOW} records. Records are newest first. */
export function actComplianceRates(records: readonly ActComplianceRecord[]): ActComplianceRates {
  const rates: ActComplianceRates = { turns: 0, declined: 0, parsed: 0, recovered: 0, rejected: 0, none: 0 }
  for (const record of records.slice(0, ACT_COMPLIANCE_RATE_WINDOW)) {
    if (record.declined) {
      rates.declined++
      continue
    }
    rates.turns++
    rates[actComplianceOutcome(record)]++
  }
  return rates
}

/**
 * Collects per-turn ACT compliance for the devtools Situation inspector.
 *
 * The stage of the window that runs chat feeds it: stream-end hooks add a record from the runtime's `cueStats`,
 * and the streaming-control controller reports rejected markers by turn. A rejection can arrive before the stream
 * ends (muted speech dispatches at once) or after it (speech dispatches during playback), so early rejections wait
 * for their record. Nothing is synchronized or sent anywhere; follower windows read the leader through
 * {@link inspect}.
 */
export const useActComplianceStore = defineStore('devtools:act-compliance', () => {
  const records = shallowRef<readonly ActComplianceRecord[]>([])
  // Rejections of turns whose stream has not ended yet. Bounded like the history.
  let pending = new Map<string, { count: number, tokens: string[] }>()

  /** Adds the record of a finished turn. A turn without `cueStats` (no stream end reached) is ignored. */
  function recordStreamEnd(context: Pick<ChatStreamEventContext, 'turnId' | 'cueStats'>, atMs: number) {
    const stats = context.cueStats
    if (!stats || records.value.some(record => record.turnId === context.turnId))
      return

    const early = pending.get(context.turnId)
    pending.delete(context.turnId)
    const record: ActComplianceRecord = {
      turnId: context.turnId,
      atMs,
      origin: stats.origin,
      declined: stats.declined,
      act: stats.act,
      recovered: stats.recovered,
      rejected: early?.count ?? 0,
      rejectedTokens: early?.tokens ?? [],
      noAct: stats.act === 0,
    }
    records.value = [record, ...records.value].slice(0, ACT_COMPLIANCE_HISTORY_MAX)
  }

  /** Counts one marker the streaming-control controller rejected for `turnId`. */
  function recordRejected(turnId: string, token: string) {
    const index = records.value.findIndex(record => record.turnId === turnId)
    if (index >= 0) {
      const record = records.value[index]
      const next = [...records.value]
      next[index] = {
        ...record,
        rejected: record.rejected + 1,
        rejectedTokens: record.rejectedTokens.length < REJECTED_TOKENS_MAX ? [...record.rejectedTokens, token] : record.rejectedTokens,
      }
      records.value = next
      return
    }

    const early = pending.get(turnId) ?? { count: 0, tokens: [] }
    early.count++
    if (early.tokens.length < REJECTED_TOKENS_MAX)
      early.tokens.push(token)
    pending.set(turnId, early)
    if (pending.size > ACT_COMPLIANCE_HISTORY_MAX)
      pending = new Map([...pending].slice(-ACT_COMPLIANCE_HISTORY_MAX))
  }

  /** Returns the turn history of the leader window. */
  async function inspect(): Promise<ActComplianceInspection> {
    return { records: records.value.map(record => ({ ...record, rejectedTokens: [...record.rejectedTokens] })) }
  }

  return {
    records: computed(() => records.value),
    recordStreamEnd,
    recordRejected,
    inspect,
  }
}, {
  synced: {
    actions: ['inspect'],
    state: false,
  },
})
