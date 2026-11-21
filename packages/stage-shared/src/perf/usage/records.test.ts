import type { PerfRecord, SegmentRollupRecord, WindowRollupRecord } from './records'

import { describe, expect, it } from 'vitest'

import { FRAME_BINS_V1, STAGE_BINS_V1 } from './bins'
import { parsePerfLine, SEGMENT_ROLLUP_VERSION } from './records'

const T = 1_794_000_000_000
const base = { v: 1, t: T, sessionId: 'session-1' } as const

const host = { platform: 'linux', arch: 'x64', cpuModel: 'AMD Ryzen 7 5800X3D', cores: 16, totalMemKb: 32_000_000, gpu: null }

const features = { speechMuted: false, mmdPhysics: true, naturalMotion: true, mmdRoam: 'off', wakeWord: false, hearing: null }

const quartiles = { q1: 16.4, median: 16.7, q3: 17.1 }

const stages: WindowRollupRecord['stages'] = { 'mmd.physics': { n: 300, sumMs: 120.5, maxMs: 3.2, hist: [[3, 120], [4, 180]] } }

const cellKey = {
  epoch: 0,
  sha: 'a'.repeat(40),
  dirty: true,
  diffHash: 'd1',
  window: 'stage',
  renderer: 'mmd',
  modelId: 'model-1',
  featureHash: 'f1',
  features,
  activity: 'talking',
  hostContended: false,
  stageHost: 'desktop',
  devtoolsOpen: false,
  refreshHz: 144,
} as const

const cellTotals = {
  windows: 24,
  frames: 7200,
  frameHist: Array.from<number>({ length: 22 }).fill(1),
  quartiles: { p50FrameMs: quartiles, share21: quartiles, share36: quartiles, share100: quartiles, cpuPct: null, workingSetKb: quartiles },
  stages,
  incidents: 0,
}

const segmentRollup: SegmentRollupRecord = {
  ...base,
  v: SEGMENT_ROLLUP_VERSION,
  kind: 'segment-rollup',
  segment: 0,
  startedAt: T,
  endedAt: T + 600_000,
  recovered: false,
  malformedLines: 1,
  excludedWindows: 12,
  cells: [{ ...cellKey, buckets: [{ startMs: T + 60_000, endMs: T + 300_000, ...cellTotals }, { startMs: T + 300_000, endMs: T + 600_000, ...cellTotals, incidents: 2 }] }],
  recorderMs: 12.5,
  rawBytes: 40_960,
  host,
  buildMode: 'packaged',
}

const records: PerfRecord[] = [
  {
    ...base,
    kind: 'session-start',
    segment: 0,
    host,
    buildMode: 'dev',
    appVersion: '0.9.0',
    electronVersion: '38.0.0',
    chromeVersion: '140.0.0.0',
    frameBins: 'frame-v1',
    stageBins: 'stage-v1',
    startedBy: 'toggle',
  },
  { ...base, kind: 'identity', epoch: 0, sha: 'a'.repeat(40), shortSha: 'aaaaaaa', branch: null, dirty: true, diffHash: 'd1', source: 'runtime-git' },
  {
    ...base,
    kind: 'sample',
    epoch: 0,
    intervalMs: 5000,
    processes: [{ pid: 42, creationTime: T - 1000, role: 'window:stage', label: 'stage', cpuPctOfCore: null, workingSetKb: 300_000, peakWorkingSetKb: 310_000 }],
    machine: { load1: 1.5, cores: 16, externalCpuPct: 4.2, psiCpuSomeAvg10: null },
    hostContended: false,
    chromiumTrace: false,
    recorderMs: 0.8,
    bytesWritten: 512,
  },
  {
    ...base,
    kind: 'window-rollup',
    epoch: 0,
    window: 'stage',
    visible: true,
    paused: false,
    tags: {
      renderer: 'mmd',
      modelId: 'model-1',
      modelName: 'Chisa v1',
      features,
      featureHash: 'f1',
      activity: 'idle',
      chatGenerating: false,
      stageHost: 'window',
      devtoolsOpen: false,
      display: { width: 2560, height: 1440, scale: 1, refreshHz: 144 },
      diagnosticsTracing: false,
    },
    frames: 300,
    frameHist: Array.from({ length: 22 }, (_, index) => (index === 6 ? 300 : 0)),
    frameSumMs: 5000,
    frameMaxMs: 17.9,
    longTasks: { count: 0, maxMs: 0, sumMs: 0 },
    stages,
    recorderUs: 140,
  },
  { ...base, kind: 'event', name: 'model-load', window: 'stage', detail: { renderer: 'mmd', ms: 812, cached: false, reason: null } },
  { ...base, kind: 'incident', id: 'inc-1', trigger: 'frame-stall', window: 'stage', pid: 42, peak: { frameMaxMs: 640 }, hostContended: false, file: 'incidents/inc-1.json' },
  segmentRollup,
  { ...base, kind: 'rollup-failed', segment: 1, reason: 'raw file missing' },
  {
    ...base,
    kind: 'bench-run',
    matrix: 'bench-v1',
    scenario: 'mmd-idle',
    scenarioVersion: 1,
    run: 2,
    sha: 'b'.repeat(40),
    dirty: false,
    diffHash: null,
    modelFingerprint: 'c'.repeat(64),
    host,
    buildMode: 'dev',
    electronVersion: '38.0.0',
    valid: false,
    invalidReason: 'host-contended',
    metrics: {
      fps: 59.9,
      p50FrameMs: 16.7,
      p95FrameMsApprox: 18,
      share21: 0.01,
      share36: 0,
      share100: 0,
      stageWindowCpuPct: 31.5,
      stageWindowCpuMsPerFrame: 5.26,
      gpuCpuPct: 12,
      browserCpuPct: 3,
      stageWindowWorkingSetKb: 400_000,
      stageSumMeanMs: null,
      recorderMs: 0.4,
    },
  },
]

function sampleLine(patch: Record<string, unknown>): string {
  const sample = records.find(record => record.kind === 'sample')
  return JSON.stringify({ ...sample, ...patch })
}

describe('parsePerfLine', () => {
  it.each(records.map(record => [record.kind, record] as const))('round-trips a %s record', (_kind, record) => {
    expect(parsePerfLine(JSON.stringify(record))).toEqual({ ok: true, record })
  })

  it.each([
    ['truncated JSON', '{'],
    ['an empty line', ''],
    ['a line cut mid-record', JSON.stringify(records[2]).slice(0, 40)],
  ])('reports json for %s', (_name, line) => {
    expect(parsePerfLine(line)).toEqual({ ok: false, reason: 'json' })
  })

  it.each([
    ['a future version', sampleLine({ v: 2 })],
    ['a string version', sampleLine({ v: '1' })],
    ['a segment rollup of a future version', JSON.stringify({ ...segmentRollup, v: SEGMENT_ROLLUP_VERSION + 1 })],
  ])('reports version for %s', (_name, line) => {
    expect(parsePerfLine(line)).toEqual({ ok: false, reason: 'version' })
  })

  it.each([
    ['a sample with only its header', '{"v":1,"kind":"sample"}'],
    ['a missing version', sampleLine({ v: undefined })],
    ['a non-object line', '42'],
    ['a null line', 'null'],
    ['an unknown kind', sampleLine({ kind: 'mystery' })],
    ['a non-integer t', sampleLine({ t: T + 0.5 })],
    ['an unsafe integer t', sampleLine({ t: 2 ** 60 })],
    ['an overflowing number', sampleLine({ t: 0 }).replace('"t":0', '"t":1e400')],
    ['a wrong field type', sampleLine({ hostContended: 'no' })],
    ['an unknown event name', JSON.stringify({ ...records[4], name: 'crash' })],
    ['an absolute incident file', JSON.stringify({ ...records[5], file: '/home/user/perf/incidents/inc-1.json' })],
    ['an incident file outside the perf dir', JSON.stringify({ ...records[5], file: '../secrets.json' })],
    ['a segment cell without buckets', JSON.stringify({ ...segmentRollup, cells: [{ ...cellKey, buckets: [] }] })],
    ['a version 2 segment cell with version 1 totals', JSON.stringify({ ...segmentRollup, cells: [{ ...cellKey, ...cellTotals }] })],
    ['a version 1 segment cell with buckets', JSON.stringify({ ...segmentRollup, v: 1 })],
  ])('reports schema for %s', (_name, line) => {
    expect(parsePerfLine(line)).toEqual({ ok: false, reason: 'schema' })
  })

  it('reads a version 1 segment rollup as version 2, each cell one bucket spanning the segment', () => {
    const v1 = { ...segmentRollup, v: 1, cells: [{ ...cellKey, ...cellTotals }, { ...cellKey, activity: 'idle', ...cellTotals, windows: 30 }] }

    expect(parsePerfLine(JSON.stringify(v1))).toEqual({
      ok: true,
      record: {
        ...segmentRollup,
        cells: [
          { ...cellKey, buckets: [{ startMs: T, endMs: T + 600_000, ...cellTotals }] },
          { ...cellKey, activity: 'idle', buckets: [{ startMs: T, endMs: T + 600_000, ...cellTotals, windows: 30 }] },
        ],
      },
    })
  })

  describe('histogram lengths', () => {
    const frameBinCount = FRAME_BINS_V1.edges.length + 1
    const stageBinCount = STAGE_BINS_V1.edges.length + 1
    const windowRollup = records.find(record => record.kind === 'window-rollup')!

    function withWindowHist(frameHist: number[], stageHist?: [number, number][]): string {
      return JSON.stringify({
        ...windowRollup,
        frameHist,
        stages: stageHist ? { 'mmd.physics': { n: 1, sumMs: 1, maxMs: 1, hist: stageHist } } : windowRollup.stages,
      })
    }

    function withBucket(patch: Record<string, unknown>): string {
      const [cell] = segmentRollup.cells
      return JSON.stringify({ ...segmentRollup, cells: [{ ...cell, buckets: [{ ...cell.buckets[0], ...patch }] }] })
    }

    it.each([
      ['a short window frameHist', withWindowHist(Array.from<number>({ length: frameBinCount - 1 }).fill(0))],
      ['a long window frameHist', withWindowHist(Array.from<number>({ length: frameBinCount + 1 }).fill(0))],
      ['an empty window frameHist', withWindowHist([])],
      ['a short segment bucket frameHist', withBucket({ frameHist: Array.from<number>({ length: frameBinCount - 1 }).fill(0) })],
      ['a long segment bucket frameHist', withBucket({ frameHist: Array.from<number>({ length: frameBinCount + 1 }).fill(0) })],
      ['a window stage bin past overflow', withWindowHist(Array.from<number>({ length: frameBinCount }).fill(0), [[stageBinCount, 1]])],
      ['a segment bucket stage bin past overflow', withBucket({ stages: { 'mmd.physics': { n: 1, sumMs: 1, maxMs: 1, hist: [[stageBinCount, 1]] } } })],
    ])('reports schema for %s', (_name, line) => {
      expect(parsePerfLine(line)).toEqual({ ok: false, reason: 'schema' })
    })

    it('accepts the overflow bin of both histograms', () => {
      const hist: [number, number][] = [[stageBinCount - 1, 1]]
      const line = withWindowHist(Array.from<number>({ length: frameBinCount }).fill(0), hist)
      expect(parsePerfLine(line).ok).toBe(true)
    })
  })

  describe('bench-run stages', () => {
    const benchRun = records.find(record => record.kind === 'bench-run')!
    const withStages = (stages: unknown) => JSON.stringify({ ...benchRun, stages })

    it('accepts a bench run without stages and one with them', () => {
      const stages = { 'mmd.physics': { msPerFrame: 1.2, p95MsApprox: 2, n: 300 } }

      expect(parsePerfLine(JSON.stringify(benchRun))).toEqual({ ok: true, record: benchRun })
      expect(parsePerfLine(withStages(stages))).toEqual({ ok: true, record: { ...benchRun, stages } })
    })

    it.each([
      ['a negative call count', { 'mmd.physics': { msPerFrame: 1.2, p95MsApprox: 2, n: -1 } }],
      ['a non-numeric msPerFrame', { 'mmd.physics': { msPerFrame: '1.2', p95MsApprox: 2, n: 300 } }],
      ['an empty stage id', { '': { msPerFrame: 1.2, p95MsApprox: 2, n: 300 } }],
    ])('reports schema for %s', (_name, stages) => {
      expect(parsePerfLine(withStages(stages))).toEqual({ ok: false, reason: 'schema' })
    })
  })
})
