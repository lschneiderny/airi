import type { ChatStreamEventContext, CueComplianceOutcome } from '@proj-airi/core-agent'

import { defineInvoke, defineInvokeEventa } from '@moeru/eventa'
import { cueComplianceRates } from '@proj-airi/core-agent'
import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import { DEVTOOLS_INSPECT_TIMEOUT_MS, getDevtoolsBusContext } from '../../services/devtools/bus'

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
  /** Marker-shaped cues the runtime stripped from speech because their body was no valid payload (`cueStats.rejected`). */
  stripped: number
  noAct: boolean
}

/** Which bucket a turn counts in. The rules live in core-agent so the QA scorer shares them. */
export type ActComplianceOutcome = CueComplianceOutcome

export { cueComplianceOutcome as actComplianceOutcome } from '@proj-airi/core-agent'

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

/**
 * The leader window answers it with {@link ActComplianceInspection} of its history. The situation observability
 * store serves it while that window leads, next to the situation inspection of the same page.
 */
export const actComplianceInspectInvoke = defineInvokeEventa<ActComplianceInspection>('eventa:devtools:act-compliance:inspect')

/** Counts outcomes over the newest {@link ACT_COMPLIANCE_RATE_WINDOW} records. Records are newest first. */
export function actComplianceRates(records: readonly ActComplianceRecord[]): ActComplianceRates {
  return cueComplianceRates(records, ACT_COMPLIANCE_RATE_WINDOW)
}

/**
 * Collects per-turn ACT compliance for the devtools Situation inspector.
 *
 * The stage of the window that runs chat feeds it: stream-end hooks add a record from the runtime's `cueStats`,
 * and the streaming-control controller reports rejected markers by turn. A rejection can arrive before the stream
 * ends (muted speech dispatches at once) or after it (speech dispatches during playback), so early rejections wait
 * for their record. Nothing is synchronized; follower windows read the leader through {@link inspectLeader},
 * which the devtools inspector bus answers.
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
      stripped: stats.rejected,
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

  /** Returns the turn history of this window. */
  async function inspect(): Promise<ActComplianceInspection> {
    return { records: records.value.map(record => ({ ...record, rejectedTokens: [...record.rejectedTokens] })) }
  }

  /** Returns {@link inspect} of the leader window. Rejects when no window answers in time. */
  async function inspectLeader(): Promise<ActComplianceInspection> {
    return defineInvoke(getDevtoolsBusContext(), actComplianceInspectInvoke)(undefined, { signal: AbortSignal.timeout(DEVTOOLS_INSPECT_TIMEOUT_MS) })
  }

  return {
    records: computed(() => records.value),
    recordStreamEnd,
    recordRejected,
    inspect,
    inspectLeader,
  }
})
