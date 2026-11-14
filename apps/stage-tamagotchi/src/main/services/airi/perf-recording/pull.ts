import type { PerfRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfWindowRollup } from '../../../../shared/eventa'
import type { PerfRecordingTimers, PerfWindowSource } from './types'

import { PERF_RECORD_VERSION, PerfRecordSchema } from '@proj-airi/stage-shared/perf/usage'
import { safeParse } from 'valibot'

import { usageEvent } from './records'

const PULL_TIMEOUT_MS = 1_000

export type PerfPullResult = { rollup: PerfWindowRollup } | { missing: 'timeout' | 'error' | 'not-sampling' }

/** Pulls one stage window's rollup. A pull that has not answered after 1 s is aborted and reported as missing. */
export async function pullWindowRollup(window: PerfWindowSource, tick: number, timers: PerfRecordingTimers): Promise<PerfPullResult> {
  const controller = new AbortController()
  let cancelTimeout = () => {}
  const timedOut = new Promise<'timeout'>((resolve) => {
    cancelTimeout = timers.setTimeout(() => resolve('timeout'), PULL_TIMEOUT_MS)
  })
  try {
    const answer = await Promise.race([window.pullRollup({ tick }, controller.signal), timedOut])
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
 * the pull gave none or an invalid one.
 */
export function pulledRecords(
  pulls: readonly PerfPullResult[],
  windows: readonly PerfWindowSource[],
  stamp: { t: number, sessionId: string, epoch: number },
): PerfRecord[] {
  return pulls.map((pull, index) => {
    const window = windows[index]
    // The renderer is outside main's trust boundary, so its rollup is parsed before main writes it under its own label.
    const parsed = 'rollup' in pull
      ? safeParse(PerfRecordSchema, { ...pull.rollup, v: PERF_RECORD_VERSION, ...stamp, window: window.label, visible: window.visible })
      : null
    return parsed?.success
      ? parsed.output
      : usageEvent(stamp.t, stamp.sessionId, { name: 'rollup-missing', window: window.label, detail: { reason: 'missing' in pull ? pull.missing : 'invalid' } })
  })
}
