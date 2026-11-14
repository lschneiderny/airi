import type { PerfRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfWindowPull, PerfWindowPullRequest } from '../../../../shared/eventa'
import type { PerfRecordingTimers, PerfWindowSource } from './types'

import { PERF_RECORD_VERSION, PerfRecordSchema } from '@proj-airi/stage-shared/perf/usage'
import { array, boolean, finite, null_, number, object, picklist, pipe, record, safeParse, string, union } from 'valibot'

import { usageEvent } from './records'

const PULL_TIMEOUT_MS = 1_000

export type PerfPullResult = { rollup: PerfWindowPull } | { missing: 'timeout' | 'error' | 'not-sampling' }

/** A window may report only the events it observes itself; main owns every other event name. */
const WindowEventsSchema = array(object({
  name: picklist(['model-load', 'feature-change']),
  detail: record(string(), union([string(), pipe(number(), finite()), boolean(), null_()])),
}))

/** Pulls one stage window's rollup. A pull that has not answered after 1 s is aborted and reported as missing. */
export async function pullWindowRollup(window: PerfWindowSource, request: PerfWindowPullRequest, timers: PerfRecordingTimers): Promise<PerfPullResult> {
  const controller = new AbortController()
  let cancelTimeout = () => {}
  const timedOut = new Promise<'timeout'>((resolve) => {
    cancelTimeout = timers.setTimeout(() => resolve('timeout'), PULL_TIMEOUT_MS)
  })
  try {
    const answer = await Promise.race([window.pullRollup(request, controller.signal), timedOut])
    if (answer === 'timeout') {
      controller.abort()
      return { missing: 'timeout' }
    }
    return answer === null ? { missing: 'not-sampling' } : { rollup: answer }
  }
  catch {
    // The failure itself is the record: the tick writes `rollup-missing` with reason `error`.
    return { missing: 'error' }
  }
  finally {
    cancelTimeout()
  }
}

/**
 * Turns each window's pull into its `window-rollup`, stamped with what only main knows, or into `rollup-missing` when
 * the pull gave none or an invalid one, and each window's events under its label. The tick writes the events after all
 * rollups.
 */
export function pulledRecords(
  pulls: readonly PerfPullResult[],
  windows: readonly PerfWindowSource[],
  stamp: { t: number, sessionId: string, epoch: number },
): { rollups: PerfRecord[], events: PerfRecord[] } {
  const rollups: PerfRecord[] = []
  const events: PerfRecord[] = []
  pulls.forEach((pull, index) => {
    const window = windows[index]
    if (!('rollup' in pull)) {
      rollups.push(usageEvent(stamp.t, stamp.sessionId, { name: 'rollup-missing', window: window.label, detail: { reason: pull.missing } }))
      return
    }
    // The renderer is outside main's trust boundary, so its rollup and events are parsed before main writes them under its own label.
    const { events: windowEvents, ...rollup } = pull.rollup
    const parsed = safeParse(PerfRecordSchema, { ...rollup, v: PERF_RECORD_VERSION, ...stamp, window: window.label, visible: window.visible })
    if (parsed.success && parsed.output.kind === 'window-rollup') {
      // Whole Hz, so a 59.96 Hz and a 60 Hz report share a cell.
      parsed.output.tags.display.refreshHz = Math.round(window.refreshHz)
      rollups.push(parsed.output)
    }
    else {
      rollups.push(usageEvent(stamp.t, stamp.sessionId, { name: 'rollup-missing', window: window.label, detail: { reason: 'invalid' } }))
    }
    const parsedEvents = safeParse(WindowEventsSchema, windowEvents)
    for (const event of parsedEvents.success ? parsedEvents.output : [])
      events.push(usageEvent(stamp.t, stamp.sessionId, { ...event, window: window.label }))
  })
  return { rollups, events }
}
