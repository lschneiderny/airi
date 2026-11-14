import { cp, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readPerfData } from './read'
import { summarizeSessions } from './sessions'

const fixtures = resolve(import.meta.dirname, '../../fixtures/perf')
const hostA = resolve(fixtures, 'host-a')
const hostB = resolve(fixtures, 'host-b')
const ids = {
  rolled: '2026-11-10T09-00-00-000Z-k3x9aa',
  live: '2026-11-14T08-00-00-000Z-z1y2bb',
  failed: '2026-11-12T20-00-00-000Z-q7m2cc',
  crashed: '2026-11-13T18-30-00-000Z-p4n8dd',
}
const now = Date.parse('2026-11-14T09:00:00.000Z')
const livePid = 4242

async function sessions(options: { alive?: boolean, sinceMs?: number | null } = {}) {
  const data = await readPerfData([hostA, hostB], { isPidAlive: pid => (options.alive ?? true) && pid === livePid })
  return { data, summaries: summarizeSessions(data, { now, sinceMs: options.sinceMs ?? null }) }
}

function byId(summaries: Awaited<ReturnType<typeof sessions>>['summaries'], id: string) {
  const summary = summaries.find(candidate => candidate.sessionId === id)
  if (summary === undefined)
    throw new Error(`Missing session ${id}`)
  return summary
}

describe('perf sessions', () => {
  it('lists one row per session across two hosts, merging segments and deduplicating rows', async () => {
    const { summaries } = await sessions()

    expect(summaries.map(summary => summary.sessionId).toSorted()).toEqual(Object.values(ids).toSorted())
    expect(byId(summaries, ids.rolled)).toMatchObject({ segments: 2, failedSegments: 0, shortSha: '3f1c2b9', dirty: true, epochs: 2, renderer: 'mmd', modelId: 'mmd-chisa', recovered: false, live: false, host: 'linux/x64' })
    expect(byId(summaries, ids.crashed)).toMatchObject({ host: 'darwin/arm64', recovered: true, live: false, stageCpuPct: 80 })
  })

  it('reduces an un-rolled live segment in memory with numbers from its raw lines', async () => {
    const live = byId((await sessions()).summaries, ids.live)

    expect(live).toMatchObject({ live: true, recovered: false, renderer: 'live2d', modelName: 'Hiyori', stageCpuPct: 25, maxWorkingSetKb: 252_200, incidents: 1 })
    // Ten counted 5 s windows of 300 frames each; the histogram median sits in the [15, 18) ms bin.
    expect(live.fps).toBe(60)
    expect(live.medianFpsLowerBound).toBeCloseTo(1000 / 18)
    expect(live.share36).toBeCloseTo(13 / 300)
    expect(live.share100).toBeCloseTo(3 / 300)
  })

  it('marks an un-rolled session whose recorder pid is gone as recovered', async () => {
    expect(byId((await sessions({ alive: false })).summaries, ids.live)).toMatchObject({ live: false, recovered: true })
  })

  it('keeps rolled-up and failed segments to what their rows hold', async () => {
    const { summaries } = await sessions()

    expect(byId(summaries, ids.rolled)).toMatchObject({ modelName: null, maxWorkingSetKb: null })
    expect(byId(summaries, ids.rolled).fps).toBe(60)
    expect(byId(summaries, ids.failed)).toMatchObject({ segments: 1, failedSegments: 1, startedAt: null, durationMs: null, renderer: null, fps: null, medianFpsLowerBound: null, share36: null, stageCpuPct: null })
  })

  it('counts malformed and unknown-version lines per file', async () => {
    const { data } = await sessions()

    expect(data.files).toEqual(expect.arrayContaining([
      { path: resolve(hostA, 'sessions.jsonl'), malformed: 1, unknownVersion: 1 },
      { path: resolve(hostA, 'raw', `${ids.live}.0.jsonl`), malformed: 1, unknownVersion: 0 },
    ]))
    expect(data.files.filter(file => file.malformed + file.unknownVersion > 0)).toHaveLength(2)
  })

  it('keeps sessions active since the cutoff', async () => {
    const { summaries } = await sessions({ sinceMs: 2 * 86_400_000 })

    expect(summaries.map(summary => summary.sessionId).toSorted()).toEqual([ids.failed, ids.crashed, ids.live].toSorted())
  })

  it('counts an un-rolled segment once when two directory copies hold it', async () => {
    const copy = await mkdtemp(join(tmpdir(), 'perf-copy-'))
    try {
      await cp(hostA, copy, { recursive: true })
      const data = await readPerfData([hostA, copy], { isPidAlive: pid => pid === livePid })
      const live = byId(summarizeSessions(data, { now, sinceMs: null }), ids.live)

      expect(live).toMatchObject({ segments: 1, incidents: 1, fps: 60 })
    }
    finally {
      await rm(copy, { recursive: true, force: true })
    }
  })

  it('reports no sessions for a missing directory', async () => {
    const data = await readPerfData([resolve(fixtures, 'missing')], { isPidAlive: () => false })

    expect(summarizeSessions(data, { now, sinceMs: null })).toEqual([])
    expect(data.dirs).toEqual([{ path: resolve(fixtures, 'missing'), found: false }])
  })
})
