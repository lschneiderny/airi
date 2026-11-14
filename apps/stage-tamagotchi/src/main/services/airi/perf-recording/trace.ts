import type { ContentTracing } from 'electron'

import type { PerfTraceResult, PerfTraceState } from '../../../../shared/eventa'
import type { PerfRecordingTimers } from './types'

import { createReadStream, createWriteStream } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'

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
  /** Compresses a file into another; defaults to a `node:zlib` stream. */
  gzip?: (from: string, to: string) => Promise<void>
}

/** Streams `from` through gzip into `to`, so a 100 MB trace never sits in memory or blocks the main thread. */
async function gzipFile(from: string, to: string): Promise<void> {
  await pipeline(createReadStream(from), createGzip(), createWriteStream(to, { mode: 0o600 }))
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
 * Captures one Chromium trace at a time on request, into `<ISO start time>.json.gz` with ':' and '.' as '-', and keeps
 * the newest five. Chromium writes the plain `.json`, which is gzipped and then removed. Nothing here starts a trace on
 * its own.
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
    const plainFile = join(directory, `${new Date(this.options.now()).toISOString().replace(/[:.]/g, '-')}.json`)
    const file = `${plainFile}.gz`
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
      await this.stopRecording(plainFile)
    }
    catch (error) {
      log.withError(error).error('Failed to capture a Chromium trace')
      this.setState({ ...this.state, capturing: false })
      return { error: errorMessageFrom(error) ?? 'The Chromium trace failed.' }
    }
    finally {
      if (tracing)
        this.options.onTracingChange(false)
    }

    try {
      await this.compress(plainFile)
    }
    catch (error) {
      // The plain trace stays on disk; the next capture compresses it.
      log.withError(error).error('Failed to gzip a Chromium trace')
      this.setState({ ...this.state, capturing: false })
      return { error: errorMessageFrom(error) ?? 'The Chromium trace could not be compressed.' }
    }
    this.setState({ capturing: false, lastFile: file })
    await this.removeOldTraces()
    return { file }
  }

  /** The plain file goes only after the gzip finished; a failed gzip drops its partial output and keeps the plain file. */
  private async compress(plainFile: string): Promise<void> {
    const { fs } = this.options
    const compressed = `${plainFile}.gz`
    try {
      // Called on `fs`, because a class-based fs needs its `this`.
      await (fs.gzip ? fs.gzip(plainFile, compressed) : gzipFile(plainFile, compressed))
    }
    catch (error) {
      await fs.rm(compressed, { force: true })
      throw error
    }
    await fs.rm(plainFile, { force: true })
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
      const names = await fs.readdir(directory)
      // A plain trace is left by a crash or an earlier failed gzip, so it is compressed now; one that still fails stays.
      const compressed: string[] = []
      for (const name of names.filter(candidate => candidate.endsWith('.json'))) {
        try {
          await this.compress(join(directory, name))
          compressed.push(`${name}.gz`)
        }
        catch (error) {
          log.withError(error).warn('Failed to gzip a leftover Chromium trace')
        }
      }
      // ISO names sort by time.
      const traces = [...names.filter(name => name.endsWith('.json.gz')), ...compressed].sort()
      await Promise.all([...new Set(traces)].slice(0, -TRACES_KEPT).map(name => fs.rm(join(directory, name), { force: true })))
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
