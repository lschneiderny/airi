import type { PerfTraceCaptureOptions } from './trace'

import { basename, dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PerfTraceCapture } from './trace'

const DIRECTORY = '/perf/traces'

type TraceConfig = Parameters<PerfTraceCaptureOptions['contentTracing']['startRecording']>[0]

/** A Chromium tracer that writes each stopped trace into the in-memory directory. */
class FakeTracing {
  readonly configs: TraceConfig[] = []
  stops = 0
  /** How many of the next stops throw. */
  failStops = 0

  constructor(private readonly files: Map<string, string>, private readonly categories: string[]) {}

  async getCategories() {
    return this.categories
  }

  async startRecording(config: TraceConfig) {
    this.configs.push(config)
  }

  async stopRecording(path?: string) {
    this.stops += 1
    if (this.failStops > 0) {
      this.failStops -= 1
      throw new Error('stop failed')
    }
    this.files.set(path ?? '', '{"traceEvents":[]}')
    return path ?? ''
  }
}

function createCapture(categories = ['v8', 'cc']) {
  const files = new Map<string, string>()
  const tracing = new FakeTracing(files, categories)
  const changes: boolean[] = []
  const delaysMs: number[] = []
  const pending: Array<() => void> = []
  let scheduled: () => void = () => {}
  const waits = { started: new Promise<void>(resolve => scheduled = resolve) }
  const capture = new PerfTraceCapture({
    contentTracing: tracing,
    directory: DIRECTORY,
    now: () => Date.UTC(2026, 10, 14, 12, 0, 0),
    setTimeout: (callback, ms) => {
      delaysMs.push(ms)
      pending.push(callback)
      scheduled()
      return () => {}
    },
    fs: {
      mkdir: async () => {},
      readdir: async path => [...files.keys()].filter(file => dirname(file) === path).map(file => basename(file)),
      rm: async (path) => {
        files.delete(path)
      },
    },
    onTracingChange: tracing => changes.push(tracing),
  })
  return { capture, files, tracing, changes, delaysMs, waits, elapse: () => pending.splice(0).forEach(callback => callback()) }
}

/** Resolves once the capture waits for its trace. A capture that settles first fails here instead of timing the test out. */
async function untilWaiting(waits: { started: Promise<void> }, result: Promise<unknown>) {
  const first = await Promise.race([waits.started.then(() => 'waiting'), result.then(() => 'settled')])
  expect(first).toBe('waiting')
}

describe('perfTraceCapture', () => {
  it('traces the wanted categories that this Chromium offers into a 64 MiB buffer', async () => {
    const { capture, tracing, waits, elapse } = createCapture(['v8', 'unrelated', 'electron', 'cc', 'disabled-by-default-devtools.timeline'])

    const result = capture.capture(10)
    await untilWaiting(waits, result)
    elapse()

    expect(await result).toEqual({ file: `${DIRECTORY}/2026-11-14T12-00-00-000Z.json` })
    expect(tracing.configs).toEqual([{
      included_categories: ['disabled-by-default-devtools.timeline', 'cc', 'v8', 'electron'],
      recording_mode: 'record-until-full',
      trace_buffer_size_in_kb: 65_536,
    }])
  })

  it('refuses a second capture while one runs and writes one trace', async () => {
    const { capture, files, waits, elapse } = createCapture()

    const first = capture.capture(10)
    await untilWaiting(waits, first)
    // A refused capture settles at once. One that started instead waits for its timer, so it loses this race.
    const second = await Promise.race([capture.capture(10), Promise.resolve('still waiting')])
    elapse()

    expect(second).toEqual({ error: expect.stringContaining('already') })
    expect(await first).toHaveProperty('file')
    expect(files.size).toBe(1)
    expect(capture.getState()).toEqual({ capturing: false, lastFile: `${DIRECTORY}/2026-11-14T12-00-00-000Z.json` })
  })

  it('keeps the newest five traces and leaves other files alone', async () => {
    const { capture, files, waits, elapse } = createCapture()
    const older = [1, 2, 3, 4, 5].map(day => `${DIRECTORY}/2026-11-0${day}T08-00-00-000Z.json`)
    for (const path of [...older, `${DIRECTORY}/notes.txt`])
      files.set(path, '{}')

    const result = capture.capture(10)
    await untilWaiting(waits, result)
    elapse()
    await result

    expect([...files.keys()].sort()).toEqual([...older.slice(1), `${DIRECTORY}/2026-11-14T12-00-00-000Z.json`, `${DIRECTORY}/notes.txt`])
  })

  it.each([
    ['a trace is written', 0, false],
    ['the stop fails once and the retry works', 1, false],
    ['the stop fails twice', 2, true],
  ])('tells the recorder that tracing started and stopped when %s', async (_, failStops, failed) => {
    const { capture, tracing, changes, waits, elapse } = createCapture()
    tracing.failStops = failStops

    const result = capture.capture(10)
    await untilWaiting(waits, result)
    expect(changes).toEqual([true])
    elapse()

    const settled = await result
    expect('error' in settled).toBe(failed)
    if ('error' in settled)
      expect(settled.error).toContain('stop failed')
    expect(tracing.stops).toBe(Math.min(failStops + 1, 2))
    expect(changes).toEqual([true, false])
    expect(capture.getState().capturing).toBe(false)
  })

  it.each([
    ['a negative length', -5, 1],
    ['a huge length', 3600, 30],
    ['a length that is not a number', Number.NaN, 10],
    ['a fractional length', 2.5, 2.5],
  ])('bounds %s from the renderer to 1 to 30 seconds', async (_, seconds, expectedSeconds) => {
    const { capture, delaysMs, waits, elapse } = createCapture()

    const result = capture.capture(seconds)
    await untilWaiting(waits, result)
    elapse()
    await result

    expect(delaysMs).toEqual([expectedSeconds * 1000])
  })
})
