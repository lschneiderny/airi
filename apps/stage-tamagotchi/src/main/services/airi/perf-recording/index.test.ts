import type { PerfRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfRecordingFs, PerfRecordingServiceOptions, PerfWindowSource } from '.'
import type { PerfWindowRollup } from '../../../../shared/eventa'
import type { PerfIdentityValue } from './identity'
import type { PerfProcessMetric } from './sample'

import process from 'node:process'

import { Buffer } from 'node:buffer'

import { FRAME_BINS_V1, parsePerfLine } from '@proj-airi/stage-shared/perf/usage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PerfRecordingService } from '.'

const RAW = '/perf/raw'

const gitA: PerfIdentityValue = { sha: 'a'.repeat(40), shortSha: 'aaaaaaa', branch: 'main', dirty: false, diffHash: null, source: 'runtime-git' }
const gitB: PerfIdentityValue = { ...gitA, dirty: true, diffHash: 'f'.repeat(64) }
const buildInfo: PerfIdentityValue = { sha: 'b'.repeat(40), shortSha: 'bbbbbbb', branch: 'main', dirty: null, diffHash: null, source: 'build-info' }

class MemoryFs implements PerfRecordingFs {
  readonly files = new Map<string, string[]>()
  readonly directories = new Set<string>()
  appends = 0
  private appendWaiters: (() => void)[] = []

  async mkdir(path: string) {
    this.directories.add(path)
  }

  async appendFile(path: string, data: string) {
    this.files.set(path, [...(this.files.get(path) ?? []), data])
    this.appends += 1
    this.appendWaiters.splice(0).forEach(resolve => resolve())
  }

  async writeFile(path: string, data: string) {
    this.files.set(path, [data])
  }

  async rm(path: string) {
    this.files.delete(path)
  }

  nextAppend(): Promise<void> {
    return new Promise(resolve => this.appendWaiters.push(resolve))
  }

  records(path: string): PerfRecord[] {
    return (this.files.get(path) ?? []).join('').split('\n').filter(line => line !== '').map((line) => {
      const parsed = parsePerfLine(line)
      if (!parsed.ok)
        throw new Error(`invalid perf line (${parsed.reason}): ${line.slice(0, 200)}`)
      return parsed.record
    })
  }
}

function rollup(modelName: string | null = null): PerfWindowRollup {
  return {
    v: 1,
    kind: 'window-rollup',
    window: 'renderer-supplied',
    paused: false,
    tags: {
      renderer: 'mmd',
      modelId: 'model-1',
      modelName,
      features: { speechMuted: false, mmdPhysics: true, naturalMotion: true, mmdRoam: false, wakeWord: false, hearing: false },
      featureHash: 'abc',
      activity: 'idle',
      chatGenerating: false,
      stageHost: 'window',
      devtoolsOpen: true,
      display: { width: 1920, height: 1080, scale: 1, refreshHz: 60 },
      diagnosticsTracing: false,
    },
    frames: 300,
    frameHist: Array.from<number>({ length: FRAME_BINS_V1.edges.length + 1 }).fill(0),
    frameSumMs: 5000,
    frameMaxMs: 20,
    longTasks: { count: 0, maxMs: 0, sumMs: 0 },
    stages: null,
    recorderUs: 40,
  }
}

function metric(pid: number, type: PerfProcessMetric['type'], cumulativeCPUUsage: number): PerfProcessMetric {
  return { pid, creationTime: 1_000 + pid, type, cpu: { cumulativeCPUUsage }, memory: { workingSetSize: 2048, peakWorkingSetSize: 4096 } }
}

function stageWindow(overrides: Partial<PerfWindowSource> = {}): PerfWindowSource {
  return {
    label: 'stage-main',
    osPid: 200,
    visible: true,
    devtoolsOsPid: 300,
    pullRollup: async () => rollup(),
    pullFrameRing: async () => null,
    ...overrides,
  }
}

function createRecorder(overrides: Partial<PerfRecordingServiceOptions> = {}) {
  const fs = new MemoryFs()
  const state = {
    metrics: [metric(100, 'Browser', 2), metric(200, 'Tab', 1), metric(300, 'Tab', 0.5)],
    windows: [stageWindow()],
    identityReads: [gitA] as PerfIdentityValue[],
  }
  const options: PerfRecordingServiceOptions = {
    directory: '/perf',
    now: () => Date.now(),
    monotonicNow: () => Date.now(),
    timers: {
      setInterval: (callback, ms) => {
        const handle = setInterval(callback, ms)
        return () => clearInterval(handle)
      },
      setTimeout: (callback, ms) => {
        const handle = setTimeout(callback, ms)
        return () => clearTimeout(handle)
      },
    },
    getAppMetrics: () => state.metrics,
    getWindows: () => state.windows,
    readMachine: async () => ({ load1: 0.5, cores: 8, cpuTimes: [{ user: 1, nice: 0, sys: 1, idle: 8, irq: 0 }], psiText: 'some avg10=1.50 avg60=0.00 avg300=0.00 total=1\n' }),
    describeHost: async () => ({
      host: { platform: 'linux', arch: 'x64', cpuModel: 'Test CPU', cores: 8, totalMemKb: 16_000_000, gpu: '10de:2206' },
      appVersion: '0.0.0',
      electronVersion: '43.8.7',
      chromeVersion: '140.0.0.0',
    }),
    // The last queued read repeats, like a checkout that stays as it is.
    identity: {
      read: async () => {
        const [next, ...rest] = state.identityReads
        if (rest.length > 0)
          state.identityReads = rest
        return next ?? gitA
      },
    },
    mode: { dev: true, packaged: false, env: {} },
    getStoredEnabled: () => undefined,
    setStoredEnabled: () => {},
    fs,
    ...overrides,
  }
  const service = new PerfRecordingService(options)
  const segment = (index = 0) => `${RAW}/${service.getState().sessionId}.${index}.jsonl`
  return { service, fs, state, segment }
}

async function nextTick(fs: MemoryFs, ms = 5_000) {
  const appended = fs.nextAppend()
  await vi.advanceTimersByTimeAsync(ms)
  await appended
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 10, 14, 12, 0, 0))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('perfRecordingService', () => {
  it('writes the session header, then one append per tick with the sample and the pulled rollups', async () => {
    const { service, fs, state, segment } = createRecorder()
    await service.setEnabled(true)

    const sessionId = service.getState().sessionId
    expect(sessionId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-z]{6}$/)
    expect(fs.files.get(`${RAW}/${sessionId}.live`)).toEqual([`${process.pid}\n`])
    expect(fs.records(segment()).map(record => record.kind)).toEqual(['session-start', 'identity', 'event'])
    expect(fs.records(segment())[1]).toMatchObject({ kind: 'identity', epoch: 0, sha: gitA.sha, source: 'runtime-git' })

    // 2.5 CPU seconds over 5 s of wall time is half a core.
    state.metrics = [metric(100, 'Browser', 2), metric(200, 'Tab', 3.5), metric(300, 'Tab', 0.5)]
    const appendsBefore = fs.appends
    await nextTick(fs)

    expect(fs.appends).toBe(appendsBefore + 1)
    const [sample, windowRollup] = fs.records(segment()).slice(3)
    expect(sample).toMatchObject({ kind: 'sample', epoch: 0, intervalMs: 5_000, hostContended: false })
    expect(sample.kind === 'sample' && sample.processes).toEqual(expect.arrayContaining([
      expect.objectContaining({ pid: 100, role: 'browser', cpuPctOfCore: 0 }),
      expect.objectContaining({ pid: 200, role: 'window:stage-main', label: 'stage-main', cpuPctOfCore: 50, workingSetKb: 2048 }),
      expect.objectContaining({ pid: 300, role: 'devtools:stage-main', cpuPctOfCore: 0 }),
    ]))
    expect(windowRollup).toMatchObject({ kind: 'window-rollup', sessionId, epoch: 0, window: 'stage-main', visible: true, frames: 300 })
  })

  it('removes the live file and stops scheduling when recording is turned off', async () => {
    const { service, fs, segment } = createRecorder()
    await service.setEnabled(true)
    const sessionId = service.getState().sessionId
    const path = segment()
    await nextTick(fs)

    await service.setEnabled(false)

    expect(fs.records(path).at(-1)).toMatchObject({ kind: 'event', name: 'recording-stop' })
    expect(fs.files.has(`${RAW}/${sessionId}.live`)).toBe(false)
    expect(service.getState()).toMatchObject({ enabled: false, active: false, sessionId: null })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stores a toggle under AIRI_PERF_RECORD but keeps recording as the environment says', async () => {
    const stored: Array<boolean> = []
    const { service, fs } = createRecorder({ mode: { dev: true, packaged: false, env: { AIRI_PERF_RECORD: '1' } }, setStoredEnabled: enabled => stored.push(enabled) })
    await service.restore()
    const sessionId = service.getState().sessionId
    const appendsBefore = fs.appends

    const state = await service.setEnabled(false)

    expect(state).toMatchObject({ enabled: true, active: true, sessionId, source: 'env' })
    expect(stored).toEqual([false])
    await nextTick(fs)
    expect(fs.appends).toBe(appendsBefore + 1)
  })

  it('records a pull that never answers as rollup-missing after 1 s and aborts it', async () => {
    let pullSignal: AbortSignal | undefined
    const { service, fs, state, segment } = createRecorder()
    state.windows = [stageWindow({
      pullRollup: (_, signal) => {
        pullSignal = signal
        return new Promise(() => {})
      },
    })]
    await service.setEnabled(true)

    const appended = fs.nextAppend()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fs.records(segment()).map(record => record.kind)).not.toContain('sample')
    await vi.advanceTimersByTimeAsync(1_000)
    await appended

    expect(fs.records(segment()).slice(3)).toMatchObject([
      { kind: 'sample' },
      { kind: 'event', name: 'rollup-missing', window: 'stage-main', detail: { reason: 'timeout' } },
    ])
    expect(pullSignal?.aborted).toBe(true)
  })

  it.each([
    ['the environment override', { mode: { dev: true, packaged: false, env: { AIRI_PERF_RECORD: '0', AIRI_PERF_DIR: '/perf' } }, getStoredEnabled: () => true }],
    ['the stored toggle', { getStoredEnabled: () => false }],
    ['the packaged default', { mode: { dev: false, packaged: true, env: { AIRI_PERF_RECORD: '1' } } }],
  ] satisfies [string, Partial<PerfRecordingServiceOptions>][])('schedules, pulls and writes nothing when %s turns recording off', async (_, overrides) => {
    const getWindows = vi.fn(() => [stageWindow()])
    const { service, fs } = createRecorder({ ...overrides, getWindows })

    await service.restore()
    await vi.advanceTimersByTimeAsync(60_000)
    service.rendererReloaded('stage-main')
    service.powerChanged('suspend')

    expect(vi.getTimerCount()).toBe(0)
    expect(getWindows).not.toHaveBeenCalled()
    expect(fs.directories.size + fs.files.size).toBe(0)
    expect(service.getState().active).toBe(false)
  })

  it.each([
    ['a confirmed change', 1, [gitB, gitB]],
    ['a change that the second read does not confirm', 0, [gitB, gitA]],
    ['a git read that falls back to build info twice', 0, [buildInfo, buildInfo]],
    ['a fallback followed by a real change', 1, [buildInfo, gitB]],
  ] satisfies [string, number, PerfIdentityValue[]][])('after a renderer reload, %s leaves epoch %i', async (_, epoch, reads) => {
    const { service, fs, state, segment } = createRecorder()
    await service.setEnabled(true)

    state.identityReads = [...reads]
    service.rendererReloaded('stage-main')
    await nextTick(fs)

    const tick = fs.records(segment()).slice(3)
    expect(tick.filter(record => record.kind === 'identity')).toEqual(epoch === 1 ? [expect.objectContaining({ epoch: 1, diffHash: gitB.diffHash })] : [])
    expect(tick).toContainEqual(expect.objectContaining({ kind: 'event', name: 'renderer-reload', window: 'stage-main', detail: { identityChanged: epoch === 1 } }))
    expect(tick.filter(record => record.kind === 'sample' || record.kind === 'window-rollup').map(record => 'epoch' in record && record.epoch)).toEqual([epoch, epoch])
  })

  it('starts a new segment with the session header once a segment reaches 64 MiB', async () => {
    const { service, fs, state, segment } = createRecorder()
    const oneMiB = 'x'.repeat(1024 * 1024)
    state.windows = [stageWindow({ pullRollup: async () => rollup(oneMiB) })]
    await service.setEnabled(true)

    for (let tick = 0; tick < 65; tick++)
      await nextTick(fs)

    const segmentBytes = (fs.files.get(segment(0)) ?? []).reduce((sum, chunk) => sum + Buffer.byteLength(chunk), 0)
    expect(segmentBytes).toBeGreaterThanOrEqual(64 * 1024 * 1024)
    expect(segmentBytes).toBeLessThan(66 * 1024 * 1024)
    const next = fs.records(segment(1))
    expect(next.slice(0, 3)).toMatchObject([
      { kind: 'session-start', segment: 1, sessionId: service.getState().sessionId },
      { kind: 'identity', epoch: 0, sha: gitA.sha },
      { kind: 'sample' },
    ])
  })

  it('starts a new segment at local midnight', async () => {
    vi.setSystemTime(new Date(2026, 10, 14, 23, 59, 52))
    const { service, fs, segment } = createRecorder()
    await service.setEnabled(true)

    await nextTick(fs)
    expect(fs.files.has(segment(1))).toBe(false)
    await nextTick(fs)

    expect(fs.records(segment(1)).map(record => record.kind)).toEqual(['session-start', 'identity', 'sample', 'window-rollup'])
  })

  it('lets an in-flight tick finish before dispose writes the stop, and writes nothing after it', async () => {
    const { service, fs, state, segment } = createRecorder()
    state.windows = [stageWindow({ pullRollup: () => new Promise(() => {}) })]
    await service.setEnabled(true)
    const sessionId = service.getState().sessionId
    const path = segment()

    await vi.advanceTimersByTimeAsync(5_000)
    const disposed = service.dispose()
    await vi.advanceTimersByTimeAsync(1_000)
    await disposed
    const appendsAfterDispose = fs.appends
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fs.records(path).slice(3).map(record => record.kind === 'event' ? record.name : record.kind)).toEqual(['sample', 'rollup-missing', 'recording-stop'])
    expect(fs.files.has(`${RAW}/${sessionId}.live`)).toBe(false)
    expect(fs.appends).toBe(appendsAfterDispose)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps one interval when recording is turned off and on again during a tick', async () => {
    const { service, fs, state, segment } = createRecorder()
    state.windows = [stageWindow({ pullRollup: () => new Promise(() => {}) })]
    await service.setEnabled(true)
    const firstSegment = segment()

    await vi.advanceTimersByTimeAsync(5_000)
    const turnedOff = service.setEnabled(false)
    const turnedOn = service.setEnabled(true)
    await vi.advanceTimersByTimeAsync(1_000)
    await Promise.all([turnedOff, turnedOn])

    expect(fs.records(firstSegment).at(-1)).toMatchObject({ kind: 'event', name: 'recording-stop' })
    expect(segment()).not.toBe(firstSegment)
    expect(vi.getTimerCount()).toBe(1)
    const appendsBefore = fs.appends
    await vi.advanceTimersByTimeAsync(6_000)
    expect(fs.appends).toBe(appendsBefore + 1)
  })
})
