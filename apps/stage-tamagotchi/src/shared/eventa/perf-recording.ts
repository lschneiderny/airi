import type { SessionStartRecord, WindowRollupRecord } from '@proj-airi/stage-shared/perf/usage'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

/** Whether and where the usage performance recorder writes. Main owns it; renderers only read it. */
export interface PerfRecordingState {
  enabled: boolean
  /** True while a session is writing records. */
  active: boolean
  sessionId: string | null
  directory: string
  buildMode: SessionStartRecord['buildMode']
  /** What switched recording on: the settings toggle, the `AIRI_PERF_RECORD` environment variable, or the development default. */
  source: SessionStartRecord['startedBy']
}

/**
 * One stage window's rollup for one tick. Main adds the session id, the time, the epoch
 * and the visibility, which only main knows, when it writes the record.
 */
export type PerfWindowRollup = Omit<WindowRollupRecord, 'sessionId' | 't' | 'epoch' | 'visible'>

/** The recent frame intervals and per-stage times of one stage window, for an incident capture. */
export interface PerfFrameRing {
  intervalsMs: number[]
  stageMs: number[]
  slowestStage: string[]
}

export interface PerfTraceState {
  capturing: boolean
  lastFile: string | null
}

/** The written trace file, or why none was written. */
export type PerfTraceResult = { file: string } | { error: string }

export const perfRecordingGet = defineInvokeEventa<PerfRecordingState>('eventa:invoke:electron:perf-recording:get')
export const perfRecordingSetEnabled = defineInvokeEventa<PerfRecordingState, { enabled: boolean }>('eventa:invoke:electron:perf-recording:set-enabled')
export const perfRecordingChanged = defineEventa<PerfRecordingState>('eventa:event:electron:perf-recording:changed')

/** Main asks a stage window for its rollup. The window answers null when it is not sampling. */
export const perfRecordingPullRollup = defineInvokeEventa<PerfWindowRollup | null, { tick: number }>('eventa:invoke:electron:perf-recording:pull-rollup')
/** Main asks a stage window for its frame ring. The window answers null when it is not sampling. */
export const perfRecordingPullFrameRing = defineInvokeEventa<PerfFrameRing | null>('eventa:invoke:electron:perf-recording:pull-frame-ring')

/** A stage window tells main that it reloaded: on page load, and 2 s after the last Vite `vite:afterUpdate`. */
export const perfRecordingRendererReload = defineEventa<void>('eventa:event:electron:perf-recording:renderer-reload')

/** Starts a Chromium trace of the given length. The result names the written file, or says why none was written. */
export const perfTraceCapture = defineInvokeEventa<PerfTraceResult, { seconds: number }>('eventa:invoke:electron:perf-recording:trace-capture')
export const perfTraceState = defineEventa<PerfTraceState>('eventa:event:electron:perf-recording:trace-state')
