import type { ContentTracing } from 'electron'

import type { PerfTraceResult, PerfTraceState } from '../../../../shared/eventa'
import type { PerfRecordingTimers } from './types'

import { join } from 'node:path'

import { useLogg } from '@guiiai/logg'
import { errorMessageFrom } from '@moeru/std'

/** The categories a frame-time investigation needs. A category this Chromium does not offer is left out. */
const WANTED_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'blink',
  'cc',
  'gpu',
  'v8',
  'toplevel',
  'electron',
]
const TRACE_BUFFER_KB = 64 * 1024
const TRACES_KEPT = 5
const DEFAULT_SECONDS = 10
const MIN_SECONDS = 1
const MAX_SECONDS = 30

const log = useLogg('main/perf-recording/trace').useGlobalConfig()

/** The directory operations the capture uses; `node:fs/promises` satisfies it. */
export interface PerfTraceFs {
  mkdir: (path: string, options: { recursive: true, mode: number }) => Promise<unknown>
  readdir: (path: string) => Promise<string[]>
  rm: (path: string, options: { force: true }) => Promise<void>
}

export interface PerfTraceCaptureOptions {
  contentTracing: Pick<ContentTracing, 'getCategories' | 'startRecording' | 'stopRecording'>
  /** Where traces are written: `<perf dir>/traces`. */
  directory: string
  /** Wall clock in epoch milliseconds, for the trace file name. */
  now: () => number
  setTimeout: PerfRecordingTimers['setTimeout']
  fs: PerfTraceFs
  /** Called once a trace started and once it stopped, also when the stop failed. */
  onTracingChange: (tracing: boolean) => void
}

/**
 * Captures one Chromium trace at a time on request, into `<ISO start time>.json` with ':' and '.' as '-', and keeps
 * the newest five. Nothing here starts a trace on its own.
 */
export class PerfTraceCapture {
  private readonly listeners = new Set<(state: PerfTraceState) => void>()
  private state: PerfTraceState = { capturing: false, lastFile: null }

  constructor(private readonly options: PerfTraceCaptureOptions) {}

  getState(): PerfTraceState {
    return this.state
  }

  onStateChange(listener: (state: PerfTraceState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** `seconds` comes from a renderer, so it is bounded to 1 to 30 here; a value that is not a number means the default. */
  async capture(seconds = DEFAULT_SECONDS): Promise<PerfTraceResult> {
    if (this.state.capturing)
      return { error: 'A Chromium trace is already being captured.' }
    this.setState({ ...this.state, capturing: true })

    const { contentTracing, directory, fs } = this.options
    const file = join(directory, `${new Date(this.options.now()).toISOString().replace(/[:.]/g, '-')}.json`)
    let tracing = false
    try {
      const available = new Set(await contentTracing.getCategories())
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await contentTracing.startRecording({
        included_categories: WANTED_CATEGORIES.filter(category => available.has(category)),
        recording_mode: 'record-until-full',
        trace_buffer_size_in_kb: TRACE_BUFFER_KB,
      })
      tracing = true
      this.options.onTracingChange(true)
      const boundedSeconds = Number.isFinite(seconds) ? Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, seconds)) : DEFAULT_SECONDS
      await new Promise<void>(resolve => this.options.setTimeout(resolve, boundedSeconds * 1000))
      // Tracing ends only once every process flushed its buffer, so the flag stays on until the file is written.
      await this.stopRecording(file)
    }
    catch (error) {
      log.withError(error).error('Failed to capture a Chromium trace')
      return { error: errorMessageFrom(error) ?? 'The Chromium trace failed.' }
    }
    finally {
      if (tracing)
        this.options.onTracingChange(false)
      this.setState({ ...this.state, capturing: false })
    }

    this.setState({ ...this.state, lastFile: file })
    await this.removeOldTraces()
    return { file }
  }

  /** A failed stop leaves Chromium tracing, so it is tried once more before the failure is reported. */
  private async stopRecording(file: string): Promise<void> {
    try {
      await this.options.contentTracing.stopRecording(file)
    }
    catch (error) {
      log.withError(error).warn('Stopping the Chromium trace failed; retrying once')
      await this.options.contentTracing.stopRecording(file)
    }
  }

  private async removeOldTraces(): Promise<void> {
    const { directory, fs } = this.options
    try {
      // ISO names sort by time.
      const traces = (await fs.readdir(directory)).filter(name => name.endsWith('.json')).sort()
      await Promise.all(traces.slice(0, -TRACES_KEPT).map(name => fs.rm(join(directory, name), { force: true })))
    }
    catch (error) {
      log.withError(error).warn('Failed to remove old Chromium traces')
    }
  }

  private setState(state: PerfTraceState): void {
    this.state = state
    for (const listener of this.listeners)
      listener(state)
  }
}
