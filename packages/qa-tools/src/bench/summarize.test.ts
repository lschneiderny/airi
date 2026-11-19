import type { PerfRecord, SampleRecord, WindowRollupRecord } from '@proj-airi/stage-shared/perf/usage'

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { FRAME_BINS_V1 } from '@proj-airi/stage-shared/perf/usage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { selectScenarios } from './matrix'
import { measurableFrom, modelFingerprint, readRawRun, summarizeBenchRun } from './summarize'

const T0 = 1_800_000_000_000
const sessionId = 'bench-session'
const header = (t: number) => ({ v: 1 as const, t, sessionId })
const [mmdIdle] = selectScenarios('mmd-idle')

/** 250 frames of 16 ms (bin [15, 18)) per 5 s window, so 50 fps, with 2 ms of stage time per frame. */
function window(t: number, frames = 250): WindowRollupRecord {
  const frameHist = Array.from<number>({ length: FRAME_BINS_V1.edges.length + 1 }).fill(0)
  frameHist[7] = frames
  return {
    ...header(t),
    kind: 'window-rollup',
    epoch: 0,
    window: 'stage-main',
    visible: true,
    paused: false,
    tags: {
      renderer: 'mmd',
      modelId: 'model',
      modelName: 'Model',
      features: { speechMuted: false, mmdPhysics: true, naturalMotion: true, mmdRoam: false, wakeWord: false, hearing: false },
      featureHash: 'f',
      activity: 'idle',
      chatGenerating: false,
      stageHost: 'window',
      devtoolsOpen: false,
      display: { width: 1920, height: 1080, scale: 1, refreshHz: 60 },
      diagnosticsTracing: false,
    },
    frames,
    frameHist,
    frameSumMs: frames * 16,
    frameMaxMs: 17,
    longTasks: { count: 0, maxMs: 0, sumMs: 0 },
    stages: { physics: { n: frames, sumMs: frames * 2, maxMs: 3, hist: [[8, frames]] } },
    recorderUs: 100,
  }
}

function sample(t: number, stageCpu: number, hostContended = false): SampleRecord {
  return {
    ...header(t),
    kind: 'sample',
    epoch: 0,
    intervalMs: 5000,
    processes: [
      { pid: 10, creationTime: 1, role: 'window:stage-main', label: 'stage', cpuPctOfCore: stageCpu, workingSetKb: 400_000, peakWorkingSetKb: 410_000 },
      { pid: 11, creationTime: 1, role: 'gpu', label: 'gpu', cpuPctOfCore: 30, workingSetKb: 200_000, peakWorkingSetKb: 200_000 },
      { pid: 12, creationTime: 1, role: 'browser', label: 'main', cpuPctOfCore: 5, workingSetKb: 150_000, peakWorkingSetKb: 150_000 },
    ],
    machine: { load1: 1, cores: 16, externalCpuPct: 2, psiCpuSomeAvg10: 0 },
    hostContended,
    chromiumTrace: false,
    recorderMs: 1,
    bytesWritten: 100,
  }
}

/**
 * A 200 s recording: model loaded at 30 s, a tick every 5 s. Stage CPU is 80 % inside the measured span
 * (100 s .. 160 s) and 200 % outside it, so a sample outside the span would show in the result.
 */
function recording(options: { contendedAt?: number, modelLoadAt?: number } = {}): PerfRecord[] {
  const records: PerfRecord[] = [
    {
      ...header(T0),
      kind: 'session-start',
      segment: 0,
      host: { platform: 'linux', arch: 'x64', cpuModel: 'cpu', cores: 16, totalMemKb: 64_000_000, gpu: null },
      buildMode: 'dev',
      appVersion: '0.0.0',
      electronVersion: '40.0.0',
      chromeVersion: '140',
      frameBins: 'frame-v1',
      stageBins: 'stage-v1',
      startedBy: 'env',
    },
    { ...header(T0 + 1), kind: 'identity', epoch: 0, sha: 'a'.repeat(40), shortSha: 'aaaaaaa', branch: 'main', dirty: true, diffHash: 'diff', source: 'runtime-git' },
    { ...header(T0 + (options.modelLoadAt ?? 30_000)), kind: 'event', name: 'model-load', window: 'stage-main', detail: { ms: 900 } },
  ]
  for (let at = 5_000; at <= 200_000; at += 5_000) {
    const measured = at > 100_000 && at <= 160_000
    records.push(window(T0 + at), sample(T0 + at, measured ? 80 : 200, at === options.contendedAt))
  }
  return records
}

const context = { scenario: mmdIdle, run: 2, modelFingerprint: 'f'.repeat(64), measured: { startMs: T0 + 100_000, endMs: T0 + 160_000 } }

describe('summarizeBenchRun', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-bench-summarize-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function writeRaw(records: readonly PerfRecord[], extraLines: readonly string[] = []): string {
    mkdirSync(join(dir, 'raw'))
    writeFileSync(join(dir, 'raw', `${sessionId}.0.jsonl`), [...records.map(record => JSON.stringify(record)), ...extraLines].map(line => `${line}\n`).join(''))
    return dir
  }

  it('reduces the measured span of a raw file into one valid bench-run record', async () => {
    const raw = await readRawRun(writeRaw(recording(), ['{"v":2,"kind":"sample"}']))
    const summary = summarizeBenchRun(raw, context)

    expect(raw.malformedLines).toBe(1)
    if (!summary.ok)
      throw new Error(summary.reason)
    expect(summary.windows).toBe(12)
    expect(summary.record).toMatchObject({
      kind: 'bench-run',
      t: T0 + 160_000,
      sessionId,
      matrix: 'bench-v1',
      scenario: 'mmd-idle',
      scenarioVersion: mmdIdle.version,
      run: 2,
      sha: 'a'.repeat(40),
      dirty: true,
      diffHash: 'diff',
      modelFingerprint: 'f'.repeat(64),
      buildMode: 'dev',
      electronVersion: '40.0.0',
      valid: true,
    })
    expect(summary.record.invalidReason).toBeUndefined()
    const { metrics } = summary.record
    expect(metrics.fps).toBeCloseTo(50, 9)
    expect(metrics).toMatchObject({ p50FrameMs: 18, p95FrameMsApprox: 18, share21: 0, share36: 0, share100: 0, stageWindowCpuPct: 80, gpuCpuPct: 30, browserCpuPct: 5, stageWindowWorkingSetKb: 400_000, stageSumMeanMs: 2 })
    // 80 % of one core at 50 fps is 16 ms of stage-window CPU per rendered frame.
    expect(metrics.stageWindowCpuMsPerFrame).toBeCloseTo(16, 9)
    // Twelve measured samples at 1 ms plus twelve windows at 100 us.
    expect(metrics.recorderMs).toBeCloseTo(13.2, 9)
  })

  it('marks the run invalid when a measured sample was taken on a contended host', async () => {
    const summary = summarizeBenchRun(await readRawRun(writeRaw(recording({ contendedAt: 130_000 }))), context)

    expect(summary.ok && summary.record).toMatchObject({ valid: false, invalidReason: 'host-contended' })
  })

  it('ignores contention outside the measured span', async () => {
    const summary = summarizeBenchRun(await readRawRun(writeRaw(recording({ contendedAt: 60_000 }))), context)

    expect(summary.ok && summary.record.valid).toBe(true)
  })

  it('marks the run invalid when the rollup excludes a measured window, here one settling from a model load', async () => {
    const summary = summarizeBenchRun(await readRawRun(writeRaw(recording({ modelLoadAt: 95_000 }))), context)

    expect(summary.ok && summary.record).toMatchObject({ valid: false, invalidReason: 'excluded-window' })
  })

  it('refuses a raw file without a session start', async () => {
    const summary = summarizeBenchRun(await readRawRun(writeRaw(recording().slice(1))), context)

    expect(summary).toEqual({ ok: false, reason: expect.stringContaining('session-start') })
  })
})

describe('measurableFrom', () => {
  it('is the later of the session settling end and the end of the last model load settling', () => {
    expect(measurableFrom(recording())).toBe(T0 + 60_000)
    expect(measurableFrom(recording({ modelLoadAt: 50_000 }))).toBe(T0 + 70_000)
    expect(measurableFrom(recording().slice(1))).toBeNull()
  })
})

describe('modelFingerprint', () => {
  it('depends on the file name, size and modification time, never on the directory', () => {
    const a = modelFingerprint({ path: '/models/a/model.pmx', size: 1000, mtimeMs: 5 })

    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(modelFingerprint({ path: '/elsewhere/model.pmx', size: 1000, mtimeMs: 5 })).toBe(a)
    expect(modelFingerprint({ path: '/models/a/model.pmx', size: 1001, mtimeMs: 5 })).not.toBe(a)
    expect(modelFingerprint({ path: '/models/a/model.pmx', size: 1000, mtimeMs: 6 })).not.toBe(a)
    expect(modelFingerprint({ path: '/models/a/other.pmx', size: 1000, mtimeMs: 5 })).not.toBe(a)
  })
})
