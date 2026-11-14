import type { IncidentRecord, PerfRecord, SampleRecord, UsageEventRecord, WindowRollupRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfFrameRing } from '../../../../shared/eventa'
import type { PerfIncidentCaptureOptions } from './incident-capture'
import type { PerfWindowSource } from './types'

import { FRAME_BINS_V1, IncidentBudget, PERF_RECORD_VERSION } from '@proj-airi/stage-shared/perf/usage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PerfIncidentCapture } from './incident-capture'

const SESSION = '2026-11-14T12-00-00-000Z-abc123'
const STARTED_AT = Date.UTC(2026, 10, 14, 12)
const TICK_MS = 5_000
const MIB_KB = 1024

type CaptureFs = PerfIncidentCaptureOptions['fs']

class IncidentFs implements CaptureFs {
  readonly files = new Map<string, { data: string, mode: number }>()
  readonly renames = new Map<string, number>()
  private readonly renameWaiters = new Map<string, () => void>()

  async mkdir() {}

  async writeFile(path: string, data: string, options: { mode: number }) {
    this.files.set(path, { data, mode: options.mode })
  }

  async rename(from: string, to: string) {
    const file = this.files.get(from)
    if (!file)
      throw new Error(`ENOENT: ${from}`)
    this.files.delete(from)
    this.files.set(to, file)
    this.renames.set(to, (this.renames.get(to) ?? 0) + 1)
    this.renameWaiters.get(to)?.()
  }

  nextRename(path: string): Promise<void> {
    return new Promise(resolve => this.renameWaiters.set(path, resolve))
  }

  json(path: string) {
    const file = this.files.get(path)
    if (!file)
      throw new Error(`no file at ${path}`)
    return JSON.parse(file.data)
  }
}

function sampleAt(t: number, overrides: Partial<SampleRecord> = {}): SampleRecord {
  return {
    v: PERF_RECORD_VERSION,
    t,
    sessionId: SESSION,
    kind: 'sample',
    epoch: 0,
    intervalMs: TICK_MS,
    processes: [
      { pid: 100, creationTime: 1, role: 'browser', label: '', cpuPctOfCore: 5, workingSetKb: 100_000, peakWorkingSetKb: 100_000 },
      { pid: 150, creationTime: 1, role: 'gpu', label: '', cpuPctOfCore: 10, workingSetKb: 200_000, peakWorkingSetKb: 200_000 },
      { pid: 200, creationTime: 1, role: 'window:stage-main', label: 'stage-main', cpuPctOfCore: 20, workingSetKb: 400 * MIB_KB, peakWorkingSetKb: 400 * MIB_KB },
    ],
    machine: { load1: 1, cores: 8, externalCpuPct: 0, psiCpuSomeAvg10: null },
    hostContended: false,
    chromiumTrace: false,
    recorderMs: 0,
    bytesWritten: 0,
    ...overrides,
  }
}

function rollupAt(t: number, overrides: Partial<WindowRollupRecord> = {}): WindowRollupRecord {
  return {
    v: PERF_RECORD_VERSION,
    t,
    sessionId: SESSION,
    kind: 'window-rollup',
    epoch: 0,
    window: 'stage-main',
    visible: true,
    paused: false,
    tags: {
      renderer: 'mmd',
      modelId: 'model-1',
      modelName: null,
      features: { speechMuted: false, mmdPhysics: true, naturalMotion: true, mmdRoam: false, wakeWord: false, hearing: false },
      featureHash: 'abc',
      activity: 'idle',
      chatGenerating: false,
      stageHost: 'window',
      devtoolsOpen: false,
      display: { width: 1920, height: 1080, scale: 1, refreshHz: 60 },
      diagnosticsTracing: false,
    },
    frames: 300,
    frameHist: Array.from<number>({ length: FRAME_BINS_V1.edges.length + 1 }).fill(0),
    frameSumMs: 5_000,
    frameMaxMs: 20,
    longTasks: { count: 0, maxMs: 0, sumMs: 0 },
    stages: null,
    recorderUs: 40,
    ...overrides,
  }
}

function eventAt(t: number, name: UsageEventRecord['name'], window?: string): UsageEventRecord {
  return { v: PERF_RECORD_VERSION, t, sessionId: SESSION, kind: 'event', name, ...(window === undefined ? {} : { window }), detail: {} }
}

const RING: PerfFrameRing = { intervalsMs: [16, 700, 16], stageMs: [3, 690, 3], slowestStage: ['physics', 'physics', 'render'] }

interface TickInput {
  /** `null` writes `rollup-missing` instead of a rollup. */
  rollup?: Partial<WindowRollupRecord> | null
  sample?: Partial<SampleRecord>
  events?: UsageEventRecord['name'][]
  /** Records the service re-queued after a failed append, ahead of the tick's own. */
  requeued?: PerfRecord[]
}

function setup(window: Partial<PerfWindowSource> = {}) {
  const fs = new IncidentFs()
  const budget = new IncidentBudget()
  const windows: PerfWindowSource[] = [{
    label: 'stage-main',
    osPid: 200,
    visible: true,
    devtoolsOsPid: null,
    refreshHz: 60,
    pullRollup: async () => null,
    pullFrameRing: async () => RING,
    ...window,
  }]
  const capture = new PerfIncidentCapture({
    directory: '/perf',
    sessionId: SESSION,
    startedAt: STARTED_AT,
    fs,
    budget,
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
  })
  let t = STARTED_AT

  async function tick(input: TickInput = {}): Promise<PerfRecord[]> {
    t += TICK_MS
    const sample = sampleAt(t, input.sample)
    const records: PerfRecord[] = [
      ...(input.requeued ?? []),
      ...(input.events ?? []).map(name => eventAt(t, name, name === 'model-load' || name === 'renderer-reload' ? 'stage-main' : undefined)),
      sample,
      input.rollup === null ? eventAt(t, 'rollup-missing', 'stage-main') : rollupAt(t, input.rollup),
    ]
    const decided = capture.decide({ t, sample, records, windows })
    return [...decided.suppressed, ...await capture.write(decided.incidents, windows)]
  }

  /** Ticks through the first 60 s of the session, which suppress every incident as settling. */
  async function settle() {
    while (t < STARTED_AT + 60_000)
      await tick()
  }

  return { fs, budget, windows, tick, settle, now: () => t }
}

function incidentOf(records: readonly PerfRecord[]): IncidentRecord {
  const incident = records.find(record => record.kind === 'incident')
  if (incident?.kind !== 'incident')
    throw new Error(`no incident in ${JSON.stringify(records)}`)
  return incident
}

function suppressedOf(records: readonly PerfRecord[]) {
  return records.flatMap(record => record.kind === 'event' && record.name === 'incident-suppressed' ? [record.detail] : [])
}

const STALL = { frameMaxMs: 700 } satisfies Partial<WindowRollupRecord>

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('perfIncidentCapture', () => {
  it('writes the incident file with the last 6 ticks at once, then rewrites it once with the window\'s frame ring', async () => {
    let answer: (ring: PerfFrameRing) => void = () => {}
    const { fs, tick, settle, now } = setup({ pullFrameRing: () => new Promise((resolve) => {
      answer = resolve
    }) })
    await settle()

    const added = await tick({ rollup: STALL })

    const incident = incidentOf(added)
    expect(incident).toMatchObject({ trigger: 'frame-stall', window: 'stage-main', pid: 200, peak: { frameMaxMs: 700 }, hostContended: false, file: `incidents/${incident.id}.json` })
    const path = `/perf/${incident.file}`
    const written = fs.json(path)
    expect(written).toMatchObject({ incident, frameRing: null, ringMissing: true })
    expect(fs.files.get(path)?.mode).toBe(0o600)
    const recentSamples = written.recent.map((line: string) => JSON.parse(line)).filter((record: PerfRecord) => record.kind === 'sample')
    expect(recentSamples.map((record: PerfRecord) => record.t)).toEqual([25_000, 20_000, 15_000, 10_000, 5_000, 0].map(ago => now() - ago))

    const rewritten = fs.nextRename(path)
    answer(RING)
    await rewritten

    expect(fs.json(path)).toEqual({ ...written, frameRing: { window: 'stage-main', ...RING }, ringMissing: false })
    expect(fs.renames.get(path)).toBe(2)
  })

  it('reports a second stall within 10 min as cooldown and writes no second file', async () => {
    const { fs, tick, settle } = setup()
    await settle()
    await tick({ rollup: STALL })
    for (let clean = 0; clean < 6; clean++)
      await tick()

    const added = await tick({ rollup: STALL })

    expect(added).toEqual([expect.objectContaining({ kind: 'event', name: 'incident-suppressed', window: 'stage-main' })])
    expect(suppressedOf(added)).toEqual([{ trigger: 'frame-stall', reason: 'cooldown', pid: 200 }])
    expect([...fs.files.keys()]).toHaveLength(1)
  })

  const conditions: [string, TickInput, string][] = [
    ['the host is contended', { sample: { hostContended: true } }, 'host-contended'],
    ['a Chromium trace runs', { sample: { chromiumTrace: true } }, 'chromium-trace'],
    ['the window is hidden', { rollup: { visible: false } }, 'hidden'],
    ['the stage is paused', { rollup: { paused: true } }, 'hidden'],
    ['the window loaded a model', { events: ['model-load'] }, 'settling'],
    ['the window reloaded', { events: ['renderer-reload'] }, 'settling'],
    ['the machine resumed', { events: ['resume'] }, 'settling'],
    ['the machine suspended', { events: ['suspend'] }, 'suspended'],
  ]

  it.each(conditions)('suppresses a stall while %s and writes no file', async (_, input, reason) => {
    const { fs, tick, settle } = setup()
    await settle()

    const added = await tick({ ...input, rollup: { ...STALL, ...input.rollup } })

    expect(suppressedOf(added)).toEqual([{ trigger: 'frame-stall', reason, pid: 200 }])
    expect(fs.files.size).toBe(0)
  })

  it('suppresses a stall in the first 60 s of the session as settling', async () => {
    const { tick } = setup()

    expect(suppressedOf(await tick({ rollup: STALL }))).toEqual([{ trigger: 'frame-stall', reason: 'settling', pid: 200 }])
  })

  it('fires on a window that did not answer the tick\'s pull', async () => {
    const { tick, settle } = setup()
    await settle()

    expect(incidentOf(await tick({ rollup: null }))).toMatchObject({ trigger: 'frame-stall', window: 'stage-main', peak: { rollupMissing: 1 } })
  })

  it('reports a stall past the hourly budget as budget', async () => {
    const { fs, budget, tick, settle, now } = setup()
    await settle()
    for (let admitted = 0; admitted < 6; admitted++)
      budget.admit(now())

    expect(suppressedOf(await tick({ rollup: STALL }))).toEqual([{ trigger: 'frame-stall', reason: 'budget', pid: 200 }])
    expect(fs.files.size).toBe(0)
  })

  it('leaves ringMissing true when the window does not answer the ring pull within 3 s, and aborts the pull', async () => {
    let ringSignal: AbortSignal | undefined
    const { fs, tick, settle } = setup({ pullFrameRing: (signal) => {
      ringSignal = signal
      return new Promise(() => {})
    } })
    await settle()
    const incident = incidentOf(await tick({ rollup: STALL }))

    await vi.advanceTimersByTimeAsync(3_000)

    expect(ringSignal?.aborted).toBe(true)
    expect(fs.json(`/perf/${incident.file}`)).toMatchObject({ frameRing: null, ringMissing: true })
    expect(fs.renames.get(`/perf/${incident.file}`)).toBe(1)
  })

  it('keeps lines re-queued after a failed append once in the next incident\'s recent lines', async () => {
    const { fs, tick, settle, now } = setup()
    await settle()
    const traceStart = eventAt(now() + TICK_MS, 'trace-start')
    await tick({ requeued: [traceStart] })

    const incident = incidentOf(await tick({ requeued: [traceStart], rollup: STALL }))

    const recent: string[] = fs.json(`/perf/${incident.file}`).recent
    expect(recent.filter(line => line === JSON.stringify(traceStart))).toHaveLength(1)
  })

  it('does not fire pegged for a stage renderer that runs near one core after a model load', async () => {
    const { tick, now } = setup()
    const steady = { processes: sampleAt(0).processes.map(entry => entry.pid === 200 ? { ...entry, cpuPctOfCore: 101 } : entry) }
    // The renderer settles at 20 % before its model loads at 6 min; the load restarts its baseline.
    while (now() < STARTED_AT + 6 * 60_000)
      await tick()
    await tick({ events: ['model-load'], sample: steady })

    const added: PerfRecord[] = []
    while (now() < STARTED_AT + 20 * 60_000)
      added.push(...await tick({ sample: steady }))

    expect(added.filter(record => record.kind === 'incident')).toEqual([])
  })

  it('fires pegged for a non-window process 25 points over its settled baseline and attaches the stage window\'s ring', async () => {
    let answer: (ring: PerfFrameRing) => void = () => {}
    const { fs, tick, settle, now } = setup({ pullFrameRing: () => new Promise((resolve) => {
      answer = resolve
    }) })
    await settle()
    // The GPU process settles at 10 % in minutes 2-5 after its first sample.
    while (now() <= STARTED_AT + TICK_MS + 5 * 60_000)
      await tick()
    const hot = { processes: sampleAt(0).processes.map(entry => entry.role === 'gpu' ? { ...entry, cpuPctOfCore: 95 } : entry) }
    for (let sample = 0; sample < 5; sample++)
      expect(await tick({ sample: hot })).toEqual([])

    const added = await tick({ sample: hot })

    const incident = incidentOf(added)
    expect(incident).toMatchObject({ trigger: 'pegged', pid: 150, peak: { cpuPctOfCore: 95, baselinePct: 10 } })
    expect(incident.window).toBeUndefined()
    const path = `/perf/${incident.file}`
    const rewritten = fs.nextRename(path)
    answer(RING)
    await rewritten
    expect(fs.json(path)).toMatchObject({ frameRing: { window: 'stage-main' }, ringMissing: false })
  })

  it('fires memory growth for a window process measured from the window\'s last model load', async () => {
    const { tick, settle } = setup()
    await settle()
    await tick({ events: ['model-load'] })
    // Flat for the baseline (minutes 2-5 after the load), then 25 MiB/min.
    const growth: PerfRecord[] = []
    for (let minute = 0; minute < 40 && growth.length === 0; minute += TICK_MS / 60_000) {
      const workingSetKb = (400 + Math.max(0, minute - 6) * 25) * MIB_KB
      const processes = sampleAt(0).processes.map(entry => entry.pid === 200 ? { ...entry, workingSetKb } : entry)
      growth.push(...(await tick({ sample: { processes } })).filter(record => record.kind === 'incident'))
    }

    expect(growth).toEqual([expect.objectContaining({ trigger: 'memory-growth', window: 'stage-main', pid: 200 })])
    const incident = incidentOf(growth)
    expect(incident.peak.workingSetKb).toBeGreaterThanOrEqual((400 + 300) * MIB_KB)
  })
})
