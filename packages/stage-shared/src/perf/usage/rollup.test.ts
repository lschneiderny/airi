import type { PerfRecord, RollupFailedRecord, SampleRecord, SegmentBucket, SegmentCell, SegmentRollupRecord, SessionStartRecord, WindowRollupRecord } from './records'

import { describe, expect, it } from 'vitest'

import { parsePerfLine } from './records'
import { bucketTotals, SegmentRollupFinishedError, SegmentRollupReducer } from './rollup'

const T0 = 1_794_000_000_000
const SESSION = 'session-1'
const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)
const host = { platform: 'linux', arch: 'x64', cpuModel: 'AMD Ryzen 7 5800X3D', cores: 16, totalMemKb: 32_000_000, gpu: null }
const features = { speechMuted: false, mmdPhysics: true, naturalMotion: true, mmdRoam: 'off', wakeWord: false, hearing: null }

const header = (t: number) => ({ v: 1 as const, t, sessionId: SESSION })

function sessionStart(t = T0, segment = 0): SessionStartRecord {
  return { ...header(t), kind: 'session-start', segment, host, buildMode: 'dev', appVersion: '0.9.0', electronVersion: '43.8.7', chromeVersion: '140.0.0.0', frameBins: 'frame-v1', stageBins: 'stage-v1', startedBy: 'default' }
}

function identity(epoch: number, t: number, sha = SHA_A): PerfRecord {
  return { ...header(t), kind: 'identity', epoch, sha, shortSha: sha.slice(0, 7), branch: 'luke/feat/perf-tracking', dirty: epoch > 0, diffHash: epoch > 0 ? `d${epoch}` : null, source: 'runtime-git' }
}

function sample(t: number, options: { hostContended?: boolean, cpuPctOfCore?: number } = {}): SampleRecord {
  return {
    ...header(t),
    kind: 'sample',
    epoch: 0,
    intervalMs: 5000,
    processes: [
      { pid: 7, creationTime: T0 - 9000, role: 'browser', label: 'browser', cpuPctOfCore: 12, workingSetKb: 200_000, peakWorkingSetKb: 210_000 },
      { pid: 42, creationTime: T0 - 8000, role: 'window:stage-main', label: 'stage-main', cpuPctOfCore: options.cpuPctOfCore ?? 40, workingSetKb: 300_000, peakWorkingSetKb: 310_000 },
    ],
    machine: { load1: 1, cores: 16, externalCpuPct: 2, psiCpuSomeAvg10: 0.5 },
    hostContended: options.hostContended ?? false,
    chromiumTrace: false,
    recorderMs: 0.5,
    bytesWritten: 2048,
  }
}

/** 300 frames in the [15, 18) ms bin unless `frameHist` says otherwise. */
function rollup(t: number, overrides: Partial<WindowRollupRecord> = {}): WindowRollupRecord {
  const frameHist = Array.from<number>({ length: 22 }).fill(0)
  frameHist[7] = 300
  return {
    ...header(t),
    kind: 'window-rollup',
    epoch: 0,
    window: 'stage-main',
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
    frameHist,
    frameSumMs: 5000,
    frameMaxMs: 17.5,
    longTasks: { count: 0, maxMs: 0, sumMs: 0 },
    stages: null,
    recorderUs: 100,
    ...overrides,
  }
}

function event(name: Extract<PerfRecord, { kind: 'event' }>['name'], t: number): PerfRecord {
  return { ...header(t), kind: 'event', name, window: 'stage-main', detail: {} }
}

function incident(id: string, t: number, window: string): PerfRecord {
  return { ...header(t), kind: 'incident', id, trigger: 'frame-stall', window, peak: { frameMaxMs: 700 }, hostContended: false, file: `incidents/${id}.json` }
}

/** One recorder tick per entry, as the recorder appends it: the sample, then the stage window's rollup. */
function ticks(times: number[], build: (t: number) => WindowRollupRecord = t => rollup(t)): PerfRecord[] {
  return times.flatMap(t => [sample(t), build(t)])
}

const afterSettling = (count: number) => Array.from({ length: count }, (_, index) => T0 + 65_000 + index * 5000)
const opening = [sessionStart(), identity(0, T0)]

function reduce(records: PerfRecord[], finish: Partial<Parameters<SegmentRollupReducer['finish']>[0]> = {}): SegmentRollupRecord | RollupFailedRecord {
  const reducer = new SegmentRollupReducer({ sessionId: SESSION, segment: 0 })
  for (const record of records)
    reducer.push(record)
  return reducer.finish({ endedAt: T0 + 3_600_000, recovered: false, malformedLines: 0, rawBytes: 4096, ...finish })
}

/** The bucket of a cell that every window of the test falls into. */
function only(cell: SegmentCell): SegmentBucket {
  expect(cell.buckets).toHaveLength(1)
  return cell.buckets[0]
}

function rolled(records: PerfRecord[], finish: Partial<Parameters<SegmentRollupReducer['finish']>[0]> = {}): SegmentRollupRecord {
  const result = reduce(records, finish)
  if (result.kind !== 'segment-rollup')
    throw new Error(`Expected a segment rollup, received rollup-failed: ${result.reason}`)
  return result
}

describe('segmentRollupReducer', () => {
  it('rolls included windows into one cell joined to the sample and writes a schema-valid line', () => {
    const result = rolled([...opening, ...ticks(afterSettling(4))])
    const [cell] = result.cells

    expect(parsePerfLine(JSON.stringify(result))).toEqual({ ok: true, record: result })
    expect(result).toMatchObject({ sessionId: SESSION, segment: 0, startedAt: T0, endedAt: T0 + 3_600_000, recovered: false, excludedWindows: 0, rawBytes: 4096, host, buildMode: 'dev' })
    expect(result.cells).toHaveLength(1)
    expect(cell).toMatchObject({ epoch: 0, sha: SHA_A, window: 'stage-main', renderer: 'mmd', hostContended: false, refreshHz: 144 })
    const bucket = only(cell)
    expect(bucket).toMatchObject({ startMs: T0 + 60_000, endMs: T0 + 80_000, windows: 4, frames: 1200, stages: null, incidents: 0 })
    expect(bucket.frameHist[7]).toBe(1200)
    expect(bucket.quartiles.p50FrameMs.median).toBe(18)
    expect(bucket.quartiles.share21.median).toBe(0)
    expect(bucket.quartiles.cpuPct?.median).toBe(40)
    expect(bucket.quartiles.workingSetKb?.median).toBe(300_000)
    expect(result.recorderMs).toBeCloseTo(4 * 0.5 + 4 * 0.1)
  })

  it('reports per-window quartiles across the bucket', () => {
    const slowerHist = (bin: number) => Array.from({ length: 22 }, (_, index) => (index === bin ? 300 : 0))
    const bins = [7, 7, 8, 9]
    const result = rolled([...opening, ...afterSettling(4).flatMap((t, index) => [sample(t), rollup(t, { frameHist: slowerHist(bins[index]) })])])

    expect(only(result.cells[0]).quartiles.p50FrameMs).toEqual({ q1: 18, median: 19.5, q3: 22 })
    expect(only(result.cells[0]).quartiles.share21).toEqual({ q1: 0, median: 0, q3: 0.25 })
  })

  it.each([
    ['starts at the end of the first 60 s', 0, T0 + 65_000],
    ['starts 1 ms before the end of the first 60 s', 1, T0 + 64_999],
  ])('settling: a window that %s is excluded %i times', (_name, excluded, t) => {
    const result = rolled([...opening, ...ticks([t])])

    expect(result.excludedWindows).toBe(excluded)
    expect(result.cells.flatMap(cell => cell.buckets).reduce((sum, bucket) => sum + bucket.windows, 0)).toBe(1 - excluded)
  })

  it('excludes hidden, paused and frameless windows and counts them', () => {
    const times = afterSettling(5)
    const result = rolled([
      ...opening,
      ...ticks(times.slice(0, 2)),
      ...ticks([times[2]], t => rollup(t, { visible: false })),
      ...ticks([times[3]], t => rollup(t, { paused: true })),
      ...ticks([times[4]], t => rollup(t, { frames: 0, frameHist: Array.from<number>({ length: 22 }).fill(0) })),
    ])

    expect(result.excludedWindows).toBe(3)
    expect(only(result.cells[0]).windows).toBe(2)
  })

  const settlingEvents: [string, (te: number) => PerfRecord][] = [
    ['model-load', te => event('model-load', te)],
    ['resume', te => event('resume', te)],
    ['renderer-reload', te => event('renderer-reload', te)],
    ['a new identity epoch', te => identity(1, te, SHA_B)],
  ]
  const TE = T0 + 300_000

  describe.each(settlingEvents)('20 s after %s', (_name, eventAt) => {
    it.each([
      ['ends at the event', [-30_000, 0], 1],
      ['ends 1 ms before the event', [-30_001, -1], 0],
      ['starts 20 s after the event', [20_000, 25_000], 1],
      ['starts 1 ms short of 20 s after the event', [19_999, 24_999], 2],
    ])('a window that %s is excluded as expected', (_case, offsets, excluded) => {
      // The recorder writes an event in the append of the first tick at or after it, after that tick's rollup.
      const result = rolled([
        ...opening,
        ...ticks(offsets.filter(offset => offset <= 0).map(offset => TE + offset)),
        eventAt(TE),
        ...ticks(offsets.filter(offset => offset > 0).map(offset => TE + offset)),
      ])

      expect(result.excludedWindows).toBe(excluded)
    })
  })

  it('excludes the window spanning a suspend..resume gap and 20 s after resume, with events written after the rollup', () => {
    const suspendAt = T0 + 300_000
    const resumeAt = suspendAt + 600_000
    const result = rolled([
      ...opening,
      ...ticks([suspendAt - 1]),
      // The recorder writes the queued suspend and resume events in the first tick after resume, after its rollup.
      ...ticks([resumeAt + 3000]),
      event('suspend', suspendAt),
      event('resume', resumeAt),
      ...ticks([resumeAt + 23_000, resumeAt + 28_000]),
    ])

    expect(result.excludedWindows).toBe(2)
    // The window before the suspend and the one 28 s after resume end in different 5-minute buckets.
    expect(result.cells[0].buckets.map(bucket => bucket.windows)).toEqual([1, 1])
  })

  it('excludes every window after a suspend that never resumes', () => {
    const result = rolled([...opening, ...ticks(afterSettling(2)), event('suspend', T0 + 74_000), ...ticks([T0 + 300_000, T0 + 305_000])])

    expect(result.excludedWindows).toBe(2)
    expect(only(result.cells[0]).windows).toBe(2)
  })

  it('decides a window once the next tick starts, so a later event does not reach back', () => {
    const [first, second] = afterSettling(2)
    const result = rolled([...opening, ...ticks([first, second]), event('model-load', first - 1000)])

    expect(result.excludedWindows).toBe(1)
    expect(only(result.cells[0]).windows).toBe(1)
  })

  it('keeps contended windows in their own cell instead of excluding them', () => {
    const times = afterSettling(4)
    const result = rolled([...opening, ...times.flatMap((t, index) => [sample(t, { hostContended: index % 2 === 0 }), rollup(t)])])

    expect(result.excludedWindows).toBe(0)
    expect(result.cells.map(cell => [cell.hostContended, only(cell).windows])).toEqual([[true, 2], [false, 2]])
  })

  it.each([
    ['7.5 s', false, 40, 7500],
    ['7.501 s', true, null, 7501],
  ])('a sample %s before the rollup leaves it contended %s with CPU %s', (_name, hostContended, cpu, gap) => {
    const t = T0 + 100_000
    const result = rolled([...opening, sample(t - gap), rollup(t)])

    expect(result.cells[0].hostContended).toBe(hostContended)
    expect(only(result.cells[0]).quartiles.cpuPct?.median ?? null).toBe(cpu)
    expect(only(result.cells[0]).quartiles.workingSetKb === null).toBe(cpu === null)
  })

  it('splits cells by identity epoch', () => {
    const times = afterSettling(12)
    const result = rolled([
      ...opening,
      ...ticks(times.slice(0, 4)),
      identity(1, times[4], SHA_B),
      ...ticks(times.slice(4), t => rollup(t, { epoch: 1 })),
    ])

    expect(result.cells.map(cell => [cell.epoch, cell.sha, cell.dirty, cell.diffHash, only(cell).windows])).toEqual([[0, SHA_A, false, null, 4], [1, SHA_B, true, 'd1', 3]])
    expect(result.excludedWindows).toBe(5)
  })

  it('keeps a window whose label has no process in the sample, without CPU or memory', () => {
    const result = rolled([...opening, ...ticks(afterSettling(2), t => rollup(t, { window: 'stage-extra' }))])

    expect(result.cells[0]).toMatchObject({ window: 'stage-extra', hostContended: false })
    expect(only(result.cells[0])).toMatchObject({ windows: 2, quartiles: { cpuPct: null } })
  })

  it('finishes a crashed segment with recovered set and the caller\'s malformed lines', () => {
    const result = rolled([...opening, ...ticks(afterSettling(3))], { recovered: true, malformedLines: 3 })

    expect(result).toMatchObject({ recovered: true, malformedLines: 3 })
    expect(only(result.cells[0]).windows).toBe(3)
  })

  const [lastT] = afterSettling(3).slice(-1)
  const unusable: [string, PerfRecord][] = [
    ['a frame histogram of the wrong length', rollup(lastT + 5000, { frameHist: [300] })],
    ['a stage bin index past the overflow bin', rollup(lastT + 5000, { stages: { physics: { n: 1, sumMs: 1, maxMs: 1, hist: [[18, 1]] } } })],
    ['a record of another session', { ...rollup(lastT + 5000), sessionId: 'session-2' }],
    ['a duplicate rollup', rollup(lastT)],
    ['an out-of-order rollup', rollup(lastT - 7000)],
    ['an out-of-order sample', sample(lastT - 1)],
    ['a rollup of an epoch without identity', rollup(lastT + 5000, { epoch: 7 })],
    ['a second session-start', sessionStart()],
    ['a session-start of another segment', sessionStart(T0, 3)],
    ['a rollup row that belongs in sessions.jsonl', { ...header(lastT), kind: 'rollup-failed', segment: 0, reason: 'x' }],
  ]

  it.each(unusable)('counts %s as malformed without throwing', (_name, bad) => {
    const result = rolled([...opening, ...ticks(afterSettling(3)), bad], { malformedLines: 2 })

    expect(result.malformedLines).toBe(3)
    expect(only(result.cells[0]).windows).toBe(3)
    expect(only(result.cells[0]).frames).toBe(900)
  })

  it.each([
    ['missing-session-start', [identity(0, T0), ...ticks(afterSettling(2))]],
    ['unsupported-bins', [{ ...sessionStart(), frameBins: 'frame-v2' }, identity(0, T0), ...ticks(afterSettling(2))]],
  ])('returns a %s rollup-failed row that parses', (reason, records) => {
    const result = reduce(records)

    expect(result).toMatchObject({ kind: 'rollup-failed', sessionId: SESSION, segment: 0, reason })
    expect(parsePerfLine(JSON.stringify(result)).ok).toBe(true)
  })

  it('throws on push or finish after finish', () => {
    const reducer = new SegmentRollupReducer({ sessionId: SESSION, segment: 0 })
    reducer.push(sessionStart())
    reducer.finish({ endedAt: T0 + 1000, recovered: false, malformedLines: 0, rawBytes: 0 })

    expect(() => reducer.push(identity(0, T0))).toThrow(SegmentRollupFinishedError)
    expect(() => reducer.finish({ endedAt: T0 + 1000, recovered: false, malformedLines: 0, rawBytes: 0 })).toThrow(SegmentRollupFinishedError)
  })

  it('counts each incident once toward the bucket of its window\'s latest rollup', () => {
    const times = afterSettling(3)
    const result = rolled([
      ...opening,
      ...ticks(times),
      incident('inc-1', times[2] + 100, 'stage-main'),
      incident('inc-1', times[2] + 100, 'stage-main'),
      incident('inc-2', times[2] + 200, 'stage-other'),
    ])

    expect(result.cells.map(cell => only(cell).incidents)).toEqual([1])
    expect(result.malformedLines).toBe(1)
  })

  /** Rollups of a tick each, with the stage window's CPU and the frame bin of all 300 frames per tick. */
  const ticksAt = (entries: [t: number, cpuPctOfCore: number, bin: number][]) => entries.flatMap(([t, cpuPctOfCore, bin]) => [
    sample(t, { cpuPctOfCore }),
    rollup(t, { frameHist: Array.from({ length: 22 }, (_, index) => (index === bin ? 300 : 0)) }),
  ])
  const BOUNDARY = T0 + 300_000

  it('splits a cell into wall-clock 5-minute buckets by window end, each with its own counts, quartiles and span', () => {
    const result = rolled([...opening, ...ticksAt([[BOUNDARY - 10_000, 40, 7], [BOUNDARY - 5000, 40, 7], [BOUNDARY, 40, 7], [BOUNDARY + 5000, 60, 8], [BOUNDARY + 10_000, 60, 8]])])
    const [cell] = result.cells

    expect(result.cells).toHaveLength(1)
    expect(cell.buckets.map(bucket => [bucket.startMs, bucket.endMs, bucket.windows, bucket.frames])).toEqual([
      [BOUNDARY - 15_000, BOUNDARY, 3, 900],
      [BOUNDARY, BOUNDARY + 10_000, 2, 600],
    ])
    expect(cell.buckets.map(bucket => [bucket.quartiles.p50FrameMs.median, bucket.quartiles.cpuPct?.median, bucket.frameHist[7], bucket.frameHist[8]])).toEqual([[18, 40, 900, 0], [21, 60, 0, 600]])
  })

  it('puts a window spanning a bucket boundary into the bucket of its end, whose span starts at the window start', () => {
    const result = rolled([...opening, ...ticksAt([[BOUNDARY - 10_000, 40, 7], [BOUNDARY + 2000, 40, 7]])])

    expect(result.cells[0].buckets.map(bucket => [bucket.startMs, bucket.endMs, bucket.windows])).toEqual([
      [BOUNDARY - 15_000, BOUNDARY - 10_000, 1],
      [BOUNDARY - 10_000, BOUNDARY + 2000, 1],
    ])
  })

  it('merges stage timings across windows of a bucket', () => {
    const [first, second] = afterSettling(2)
    const result = rolled([
      ...opening,
      sample(first),
      rollup(first, { stages: { physics: { n: 100, sumMs: 50, maxMs: 2, hist: [[3, 100]] } } }),
      sample(second),
      rollup(second, { stages: { physics: { n: 60, sumMs: 40, maxMs: 3, hist: [[3, 50], [4, 10]] }, render: { n: 60, sumMs: 6, maxMs: 0.2, hist: [[1, 60]] } } }),
    ])

    expect(only(result.cells[0]).stages).toEqual({
      physics: { n: 160, sumMs: 90, maxMs: 3, hist: [[3, 150], [4, 10]] },
      render: { n: 60, sumMs: 6, maxMs: 0.2, hist: [[1, 60]] },
    })
  })
})

describe('bucketTotals', () => {
  const quartiles = (median: number) => ({ q1: median - 1, median, q3: median + 1 })
  const hist = (bin: number, count: number) => Array.from({ length: 22 }, (_, index) => (index === bin ? count : 0))
  const early: SegmentBucket = {
    startMs: T0,
    endMs: T0 + 300_000,
    windows: 10,
    frames: 3000,
    frameHist: hist(7, 3000),
    quartiles: { p50FrameMs: quartiles(17), share21: quartiles(1), share36: quartiles(1), share100: quartiles(1), cpuPct: null, workingSetKb: null },
    stages: { physics: { n: 10, sumMs: 5, maxMs: 1, hist: [[3, 10]] } },
    incidents: 1,
  }
  const late: SegmentBucket = {
    startMs: T0 + 300_000,
    endMs: T0 + 600_000,
    windows: 30,
    frames: 9000,
    frameHist: hist(8, 9000),
    quartiles: { p50FrameMs: quartiles(21), share21: quartiles(2), share36: quartiles(2), share100: quartiles(2), cpuPct: quartiles(50), workingSetKb: null },
    stages: { physics: { n: 30, sumMs: 20, maxMs: 2, hist: [[3, 20], [4, 10]] }, render: { n: 30, sumMs: 3, maxMs: 0.2, hist: [[1, 30]] } },
    incidents: 2,
  }

  it('returns one bucket\'s own totals', () => {
    const { startMs: _start, endMs: _end, ...totals } = early

    expect(bucketTotals([early])).toEqual(totals)
  })

  it('sums counts and merges histograms and stage timings exactly, taking each quartile as the window-weighted median', () => {
    const totals = bucketTotals([early, late])

    expect(totals).toMatchObject({ windows: 40, frames: 12_000, incidents: 3 })
    expect([totals.frameHist[7], totals.frameHist[8]]).toEqual([3000, 9000])
    expect(totals.quartiles).toEqual({ p50FrameMs: quartiles(21), share21: quartiles(2), share36: quartiles(2), share100: quartiles(2), cpuPct: quartiles(50), workingSetKb: null })
    expect(totals.stages).toEqual({
      physics: { n: 40, sumMs: 25, maxMs: 2, hist: [[3, 30], [4, 10]] },
      render: { n: 30, sumMs: 3, maxMs: 0.2, hist: [[1, 30]] },
    })
  })

  it('takes the lower value when the window weights split evenly', () => {
    expect(bucketTotals([{ ...late, windows: 10 }, early]).quartiles.p50FrameMs.median).toBe(17)
  })
})
