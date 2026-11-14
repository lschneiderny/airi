import type { PerfRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfFrameRing, PerfWindowPull, PerfWindowPullRequest } from '../../../../shared/eventa'
import type { PerfRecordingTimers, PerfWindowSource } from './types'

import { PERF_RECORD_VERSION, PerfRecordSchema } from '@proj-airi/stage-shared/perf/usage'
import { array, boolean, finite, null_, number, object, picklist, pipe, record, safeParse, string, union } from 'valibot'

import { usageEvent } from './records'

const PULL_TIMEOUT_MS = 1_000
/** A ring pull runs after the tick that wrote the incident, so it can wait longer than a rollup pull. */
const RING_PULL_TIMEOUT_MS = 3_000

export type PerfPullResult = { rollup: PerfWindowPull } | { missing: 'timeout' | 'error' | 'not-sampling' }

/** A window may report only the events it observes itself; main owns every other event name. */
const WindowEventsSchema = array(object({
  name: picklist(['model-load', 'feature-change']),
  detail: record(string(), union([string(), pipe(number(), finite()), boolean(), null_()])),
}))

const FrameRingSchema = object({
  intervalsMs: array(pipe(number(), finite())),
  stageMs: array(pipe(number(), finite())),
  slowestStage: array(string()),
})

/** Races a window pull against a timeout; a pull that has not answered in time is aborted. */
async function pullWithin<Answer>(timeoutMs: number, timers: PerfRecordingTimers, pull: (signal: AbortSignal) => Promise<Answer>): Promise<{ answer: Answer } | 'timeout'> {
  const controller = new AbortController()
  let cancelTimeout = () => {}
  const timedOut = new Promise<'timeout'>((resolve) => {
    cancelTimeout = timers.setTimeout(() => resolve('timeout'), timeoutMs)
  })
  try {
    const result = await Promise.race([pull(controller.signal).then(answer => ({ answer })), timedOut])
    if (result === 'timeout')
      controller.abort()
    return result
  }
  finally {
    cancelTimeout()
  }
}

/** Pulls one stage window's rollup. A pull that has not answered after 1 s is aborted and reported as missing. */
export async function pullWindowRollup(window: PerfWindowSource, request: PerfWindowPullRequest, timers: PerfRecordingTimers): Promise<PerfPullResult> {
  try {
    const result = await pullWithin(PULL_TIMEOUT_MS, timers, signal => window.pullRollup(request, signal))
    if (result === 'timeout')
      return { missing: 'timeout' }
    return result.answer === null ? { missing: 'not-sampling' } : { rollup: result.answer }
  }
  catch {
    // The failure itself is the record: the tick writes `rollup-missing` with reason `error`.
    return { missing: 'error' }
  }
}

/**
 * Pulls one stage window's frame ring for an incident, parsed because the renderer is outside main's trust boundary.
 * `null` when the window is not sampling, answers an invalid ring, fails, or has not answered after 3 s.
 */
export async function pullFrameRing(window: PerfWindowSource, timers: PerfRecordingTimers): Promise<PerfFrameRing | null> {
  try {
    const result = await pullWithin(RING_PULL_TIMEOUT_MS, timers, signal => window.pullFrameRing(signal))
    if (result === 'timeout' || result.answer === null)
      return null
    const parsed = safeParse(FrameRingSchema, result.answer)
    return parsed.success ? parsed.output : null
  }
  catch {
    // The failure itself is the record: the incident file keeps `ringMissing: true`.
    return null
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
