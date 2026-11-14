import type { PerfRecord, RollupFailedRecord, SegmentRollupRecord } from '@proj-airi/stage-shared/perf/usage'

import type { PerfRetentionOptions } from './retention'

import { mkdir, mkdtemp, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parsePerfLine, SegmentRollupReducer } from '@proj-airi/stage-shared/perf/usage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PerfRetention } from './retention'
import { nodePerfRetentionFs } from './retention-fs'

const NOW = Date.UTC(2026, 10, 14, 12)
const DAY = 24 * 60 * 60 * 1000
const LIVE_PID = 4242
const DEAD_PID = 999_999
const SHA = 'a'.repeat(40)
const host = { platform: 'linux', arch: 'x64', cpuModel: 'cpu', cores: 16, totalMemKb: 32_000_000, gpu: null }
const features = { speechMuted: false, mmdPhysics: true, naturalMotion: true, mmdRoam: 'off', wakeWord: false, hearing: null }

let directory: string
let raw: string

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'perf-retention-'))
  raw = join(directory, 'raw')
  await mkdir(raw)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

/** A segment as the recorder writes it: header lines, then one sample and one stage window rollup per 5 s tick. */
function segmentRecords(sessionId: string, options: { startedAt: number, segment?: number, ticks?: number, stopped?: boolean }): PerfRecord[] {
  const { startedAt, segment = 0, ticks = 3 } = options
  const header = (t: number) => ({ v: 1 as const, t, sessionId })
  const frameHist = Array.from<number>({ length: 22 }).fill(0)
  frameHist[7] = 300
  const records: PerfRecord[] = [
    { ...header(startedAt), kind: 'session-start', segment, host, buildMode: 'dev', appVersion: '0.9.0', electronVersion: '43', chromeVersion: '140', frameBins: 'frame-v1', stageBins: 'stage-v1', startedBy: 'default' },
    { ...header(startedAt), kind: 'identity', epoch: 0, sha: SHA, shortSha: SHA.slice(0, 7), branch: null, dirty: false, diffHash: null, source: 'runtime-git' },
  ]
  for (let tick = 1; tick <= ticks; tick += 1) {
    const t = startedAt + tick * 5000
    records.push(
      { ...header(t), kind: 'sample', epoch: 0, intervalMs: 5000, processes: [], machine: { load1: 1, cores: 16, externalCpuPct: 0, psiCpuSomeAvg10: null }, hostContended: false, chromiumTrace: false, recorderMs: 0.5, bytesWritten: 0 },
      {
        ...header(t),
        kind: 'window-rollup',
        epoch: 0,
        window: 'stage-main',
        visible: true,
        paused: false,
        tags: { renderer: 'mmd', modelId: 'm', modelName: 'M', features, featureHash: 'f', activity: 'idle', chatGenerating: false, stageHost: 'window', devtoolsOpen: false, display: { width: 1, height: 1, scale: 1, refreshHz: 60 }, diagnosticsTracing: false },
        frames: 300,
        frameHist,
        frameSumMs: 5000,
        frameMaxMs: 17,
        longTasks: { count: 0, maxMs: 0, sumMs: 0 },
        stages: null,
        recorderUs: 100,
      },
    )
  }
  if (options.stopped)
    records.push({ ...header(startedAt + ticks * 5000 + 1), kind: 'event', name: 'recording-stop', detail: {} })
  return records
}

async function writeSegment(sessionId: string, records: readonly (PerfRecord | string)[], segment = 0): Promise<string> {
  const path = join(raw, `${sessionId}.${segment}.jsonl`)
  await writeFile(path, records.map(record => `${typeof record === 'string' ? record : JSON.stringify(record)}\n`).join(''))
  return path
}

async function writeRow(row: SegmentRollupRecord | RollupFailedRecord): Promise<void> {
  await writeFile(join(directory, 'sessions.jsonl'), `${JSON.stringify(row)}\n`, { flag: 'a' })
}

function rolledUpRow(sessionId: string, startedAt: number, segment = 0): SegmentRollupRecord {
  const reducer = new SegmentRollupReducer({ sessionId, segment })
  for (const record of segmentRecords(sessionId, { startedAt, segment, stopped: true }))
    reducer.push(record)
  const row = reducer.finish({ endedAt: startedAt + 20_000, recovered: false, malformedLines: 0, rawBytes: 1 })
  if (row.kind !== 'segment-rollup')
    throw new Error('Expected the crafted segment to roll up')
  return row
}

async function sessionsText(): Promise<string> {
  return await readFile(join(directory, 'sessions.jsonl'), 'utf8').catch(() => '')
}

async function rows(): Promise<(SegmentRollupRecord | RollupFailedRecord)[]> {
  return (await sessionsText()).split('\n').filter(Boolean).map((line) => {
    const parsed = parsePerfLine(line)
    if (!parsed.ok || (parsed.record.kind !== 'segment-rollup' && parsed.record.kind !== 'rollup-failed'))
      throw new Error(`Unexpected sessions.jsonl line: ${line}`)
    return parsed.record
  })
}

function retention(overrides: Partial<PerfRetentionOptions> = {}): PerfRetention {
  return new PerfRetention({
    directory,
    now: () => NOW,
    fs: nodePerfRetentionFs,
    isPidAlive: pid => pid === LIVE_PID,
    setTimer: () => () => {},
    ...overrides,
  })
}

describe('perfRetention rollup', () => {
  it('rolls up a session whose recorder died as recovered and removes its stale .live', async () => {
    await writeSegment('crashed', segmentRecords('crashed', { startedAt: NOW - DAY }))
    await writeFile(join(raw, 'crashed.live'), `${DEAD_PID}\n`)

    await retention().run()

    expect(await rows()).toMatchObject([{ kind: 'segment-rollup', sessionId: 'crashed', segment: 0, recovered: true, endedAt: NOW - DAY + 15_000 }])
    expect((await readdir(raw)).toSorted()).toEqual(['crashed.0.jsonl'])
  })

  it('rolls up only closed segments: a stopped session and the earlier segments of a live one', async () => {
    await writeSegment('stopped', segmentRecords('stopped', { startedAt: NOW - DAY, stopped: true }))
    await writeSegment('running', segmentRecords('running', { startedAt: NOW - 2 * DAY }), 0)
    await writeSegment('running', segmentRecords('running', { startedAt: NOW - DAY, segment: 1 }), 1)
    await writeFile(join(raw, 'running.live'), `${LIVE_PID}\n`)

    await retention().run()

    const written = (await rows()).map(row => ({ sessionId: row.sessionId, segment: row.segment, recovered: row.kind === 'segment-rollup' && row.recovered }))
    expect(written.toSorted((left, right) => left.sessionId.localeCompare(right.sessionId))).toEqual([
      { sessionId: 'running', segment: 0, recovered: false },
      { sessionId: 'stopped', segment: 0, recovered: false },
    ])
    expect(await readdir(raw)).toContain('running.live')
  })

  it('counts malformed and unknown-version lines in the row', async () => {
    const records = segmentRecords('mixed', { startedAt: NOW - DAY, stopped: true })
    await writeSegment('mixed', [...records, '{not json', JSON.stringify({ ...records[2], v: 2 })])

    await retention().run()

    expect(await rows()).toMatchObject([{ kind: 'segment-rollup', malformedLines: 2 }])
  })

  it('never writes a segment twice when two instances share the directory', async () => {
    for (const sessionId of ['one', 'two', 'three'])
      await writeSegment(sessionId, segmentRecords(sessionId, { startedAt: NOW - DAY, stopped: true }))

    await Promise.all([retention().run(), retention().run()])
    await retention().run()

    expect((await rows()).map(row => row.sessionId).toSorted()).toEqual(['one', 'three', 'two'])
  })

  it('does not write a row that another instance wrote after this pass read sessions.jsonl', async () => {
    await writeSegment('raced', segmentRecords('raced', { startedAt: NOW - DAY, stopped: true }))
    // The other instance rolls the segment up and releases its lock just before this one creates the lock.
    const fs = {
      ...nodePerfRetentionFs,
      writeFile: async (path: string, data: string, options: { flag: 'wx', mode: number }) => {
        await retention().run()
        await nodePerfRetentionFs.writeFile(path, data, options)
      },
    }

    await retention({ fs }).run()

    expect((await rows()).map(row => row.sessionId)).toEqual(['raced'])
  })

  it('skips a segment whose lock is fresh and replaces a lock older than 10 minutes', async () => {
    await writeSegment('locked', segmentRecords('locked', { startedAt: NOW - DAY, stopped: true }))
    const lock = join(raw, 'locked.0.rollup.lock')
    await writeFile(lock, '1\n')
    await utimes(lock, (NOW - 60_000) / 1000, (NOW - 60_000) / 1000)

    await retention().run()
    expect(await rows()).toEqual([])

    await utimes(lock, (NOW - 11 * 60_000) / 1000, (NOW - 11 * 60_000) / 1000)
    await retention().run()
    expect(await rows()).toMatchObject([{ kind: 'segment-rollup', sessionId: 'locked' }])
    expect(await readdir(raw)).not.toContain('locked.0.rollup.lock')
  })

  it('writes rollup-failed for a segment the reducer cannot roll up, and for a reducer exception', async () => {
    await writeSegment('headless', segmentRecords('headless', { startedAt: NOW - DAY, stopped: true }).slice(1))
    await retention().run()

    await writeSegment('throws', segmentRecords('throws', { startedAt: NOW - DAY, stopped: true }))
    vi.spyOn(SegmentRollupReducer.prototype, 'finish').mockImplementation(() => {
      throw new RangeError('histogram mismatch')
    })
    await retention().run()

    expect(await rows()).toMatchObject([
      { kind: 'rollup-failed', sessionId: 'headless', reason: 'missing-session-start' },
      { kind: 'rollup-failed', sessionId: 'throws', reason: 'reducer-error' },
    ])
  })
})

describe('perfRetention prune', () => {
  it('deletes a rolled-up segment started over 14 days ago, and rolls up an old un-rolled one before deleting it a pass later', async () => {
    await writeSegment('rolled', segmentRecords('rolled', { startedAt: NOW - 16 * DAY, stopped: true }))
    await writeRow(rolledUpRow('rolled', NOW - 16 * DAY))
    await writeSegment('unrolled', segmentRecords('unrolled', { startedAt: NOW - 16 * DAY, stopped: true }))
    await writeSegment('fresh', segmentRecords('fresh', { startedAt: NOW - DAY, stopped: true }))
    const before = await sessionsText()

    await retention().run()
    const afterFirst = await sessionsText()
    expect((await readdir(raw)).toSorted()).toEqual(['fresh.0.jsonl', 'unrolled.0.jsonl'])
    expect(afterFirst.startsWith(before)).toBe(true)

    await retention().run()
    expect(await readdir(raw)).toEqual(['fresh.0.jsonl'])
    const afterSecond = await sessionsText()
    expect(afterSecond.startsWith(afterFirst)).toBe(true)
    expect((await rows()).map(row => row.sessionId).toSorted()).toEqual(['fresh', 'rolled', 'unrolled'])
  })

  it('makes a segment with a rollup-failed row prunable once it is old', async () => {
    await writeSegment('headless', segmentRecords('headless', { startedAt: NOW - 16 * DAY, stopped: true }).slice(1))

    await retention().run()
    expect(await readdir(raw)).toEqual(['headless.0.jsonl'])

    await retention().run()
    expect(await readdir(raw)).toEqual([])
  })

  it('deletes the oldest rolled-up segments while raw/ exceeds 1 GiB, never an un-rolled or live one', async () => {
    const sessions = ['oldest', 'older', 'newer', 'unrolled', 'live']
    for (const [index, sessionId] of sessions.entries()) {
      await writeSegment(sessionId, segmentRecords(sessionId, { startedAt: NOW - (5 - index) * DAY, stopped: sessionId !== 'live' }))
      if (sessionId !== 'unrolled')
        await writeRow(rolledUpRow(sessionId, NOW - (5 - index) * DAY))
    }
    await writeFile(join(raw, 'live.live'), `${LIVE_PID}\n`)
    // Each segment reads as 300 MiB: five make 1.5 GiB, so two of the rolled-up ones must go.
    const fs = { ...nodePerfRetentionFs, stat: async (path: string) => ({ ...await nodePerfRetentionFs.stat(path), size: path.endsWith('.jsonl') ? 300 * 1024 ** 2 : 1 }) }

    await retention({ fs }).run()

    expect((await readdir(raw)).toSorted()).toEqual(['live.0.jsonl', 'live.live', 'newer.0.jsonl', 'unrolled.0.jsonl'])
  })

  it('deletes incident files older than 14 days and leaves traces alone', async () => {
    const incidents = join(directory, 'incidents')
    const traces = join(directory, 'traces')
    await mkdir(incidents)
    await mkdir(traces)
    for (const [path, ageDays] of [[join(incidents, 'old.json'), 15], [join(incidents, 'recent.json'), 13], [join(traces, 'old.json.gz'), 30]] as const) {
      await writeFile(path, '{}')
      await utimes(path, (NOW - ageDays * DAY) / 1000, (NOW - ageDays * DAY) / 1000)
    }

    await retention().run()

    expect(await readdir(incidents)).toEqual(['recent.json'])
    expect(await readdir(traces)).toEqual(['old.json.gz'])
  })
})

describe('perfRetention schedule', () => {
  it('runs a pass when its timer fires, schedules the next, and cancels it on dispose', async () => {
    await writeSegment('stopped', segmentRecords('stopped', { startedAt: NOW - DAY, stopped: true }))
    const timers: { callback: () => void, cancel: ReturnType<typeof vi.fn> }[] = []
    let onTimer: () => void = () => {}
    const setTimer = (callback: () => void) => {
      const cancel = vi.fn()
      timers.push({ callback, cancel })
      onTimer()
      return cancel
    }
    const service = retention({ setTimer })

    service.start()
    expect(timers).toHaveLength(1)
    const nextScheduled = new Promise<void>((resolve) => {
      onTimer = resolve
    })
    timers[0].callback()
    await nextScheduled

    expect(await rows()).toMatchObject([{ sessionId: 'stopped' }])
    expect(timers).toHaveLength(2)
    await service.dispose()
    expect(timers[1].cancel).toHaveBeenCalledOnce()
  })
})
