import type { PerfTraceCaptureOptions } from './trace'

import { basename, dirname } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PerfTraceCapture } from './trace'

const DIRECTORY = '/perf/traces'

type TraceConfig = Parameters<PerfTraceCaptureOptions['contentTracing']['startRecording']>[0]

/** A Chromium tracer that writes each stopped trace into the in-memory directory. */
class FakeTracing {
  readonly configs: TraceConfig[] = []
  failStop = false

  constructor(private readonly files: Map<string, string>, private readonly categories: string[]) {}

  async getCategories() {
    return this.categories
  }

  async startRecording(config: TraceConfig) {
    this.configs.push(config)
  }

  async stopRecording(path?: string) {
    if (this.failStop)
      throw new Error('stop failed')
    this.files.set(path ?? '', '{"traceEvents":[]}')
    return path ?? ''
  }
}

function createCapture(categories = ['v8', 'cc']) {
  const files = new Map<string, string>()
  const tracing = new FakeTracing(files, categories)
  const changes: boolean[] = []
  let elapse: (() => void) | undefined
  let scheduled: () => void = () => {}
  const waits = { started: new Promise<void>(resolve => scheduled = resolve) }
  const capture = new PerfTraceCapture({
    contentTracing: tracing,
    directory: DIRECTORY,
    now: () => Date.UTC(2026, 10, 14, 12, 0, 0),
    setTimeout: (callback) => {
      elapse = callback
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
  return { capture, files, tracing, changes, waits, elapse: () => elapse?.() }
}

describe('perfTraceCapture', () => {
  it('traces the wanted categories that this Chromium offers into a 64 MiB buffer', async () => {
    const { capture, tracing, waits, elapse } = createCapture(['v8', 'unrelated', 'electron', 'cc', 'disabled-by-default-devtools.timeline'])

    const result = capture.capture(10)
    await waits.started
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
    await waits.started
    const second = await capture.capture(10)
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
    await waits.started
    elapse()
    await result

    expect([...files.keys()].sort()).toEqual([...older.slice(1), `${DIRECTORY}/2026-11-14T12-00-00-000Z.json`, `${DIRECTORY}/notes.txt`])
  })

  it.each([
    ['a trace is written', false],
    ['the stop fails', true],
  ])('tells the recorder that tracing started and stopped when %s', async (_, failStop) => {
    const { capture, tracing, changes, waits, elapse } = createCapture()
    tracing.failStop = failStop

    const result = capture.capture(10)
    await waits.started
    expect(changes).toEqual([true])
    elapse()

    expect('error' in await result).toBe(failStop)
    expect(changes).toEqual([true, false])
    expect(capture.getState().capturing).toBe(false)
  })
})
