import type { SessionStartRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfFrameRing, PerfWindowRollup } from '../../../../shared/eventa'
import type { PerfIdentity } from './identity'
import type { PerfMachineReading, PerfProcessMetric, PerfRendererOwner } from './sample'
import type { PerfRecordingFs } from './segment-file'
import type { PerfWindowLabel } from './window-label'

/** Schedules a callback and returns the function that cancels it. */
export interface PerfRecordingTimers {
  setInterval: (callback: () => void, ms: number) => () => void
  setTimeout: (callback: () => void, ms: number) => () => void
}

/** An open app window as main sees it. Only stage windows are pulled; the signal aborts a pull that timed out. */
export interface PerfWindowSource extends PerfRendererOwner {
  label: PerfWindowLabel
  visible: boolean
  pullRollup: (request: { tick: number }, signal: AbortSignal) => Promise<PerfWindowRollup | null>
  pullFrameRing: (signal: AbortSignal) => Promise<PerfFrameRing | null>
}

export type PerfHostDescription = Pick<SessionStartRecord, 'host' | 'appVersion' | 'electronVersion' | 'chromeVersion'>

export interface PerfRecordingServiceOptions {
  directory: string
  /** Wall clock in epoch milliseconds: record times, session ids and the local-midnight rotation. */
  now: () => number
  /** A monotonic clock in milliseconds for CPU deltas and tick intervals, so a wall-clock jump cannot skew them. */
  monotonicNow: () => number
  timers: PerfRecordingTimers
  getAppMetrics: () => PerfProcessMetric[]
  getWindows: () => PerfWindowSource[]
  readMachine: () => Promise<PerfMachineReading>
  describeHost: () => Promise<PerfHostDescription>
  identity: Pick<PerfIdentity, 'read'>
  mode: { dev: boolean, packaged: boolean, env: Record<string, string | undefined> }
  getStoredEnabled: () => boolean | undefined
  setStoredEnabled: (enabled: boolean) => void
  fs: PerfRecordingFs
}
