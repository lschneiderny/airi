import type { RollupFailedRecord, SegmentRollupRecord } from '@proj-airi/stage-shared/perf/usage'

import { createReadStream } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

import { parsePerfLine, SegmentRollupReducer } from '@proj-airi/stage-shared/perf/usage'

/** Lines of one file that `parsePerfLine` rejected, split by reason. */
export interface PerfFileCounts {
  readonly path: string
  malformed: number
  unknownVersion: number
}

export interface SegmentIdentity {
  readonly epoch: number
  readonly sha: string
  readonly dirty: boolean | null
}

/** One recording segment, from its `sessions.jsonl` row or, when it has none yet, reduced from its raw file. */
export interface PerfSegment {
  readonly dir: string
  readonly sessionId: string
  readonly segment: number
  readonly row: SegmentRollupRecord | RollupFailedRecord
  readonly identities: readonly SegmentIdentity[]
  /** From raw window-rollup tags; `null` for a rolled-up segment, whose cells carry no model name. */
  readonly modelName: string | null
  /** Largest stage-window working set in raw samples; `null` for a rolled-up segment, whose cells hold quartiles only. */
  readonly maxWorkingSetKb: number | null
  /** Incident ids from raw `incident` lines; empty for a rolled-up segment. */
  readonly incidentIds: readonly string[]
  /** The session's `.live` file names a running recorder. */
  readonly live: boolean
}

export interface PerfData {
  readonly dirs: readonly { readonly path: string, readonly found: boolean }[]
  readonly segments: readonly PerfSegment[]
  /** Every file read, including those without rejected lines. */
  readonly files: readonly PerfFileCounts[]
}

export interface PerfReadHost {
  readonly isPidAlive: (pid: number) => boolean
}

const RAW_SEGMENT = /^(.+)\.(\d+)\.jsonl$/
const LIVE_MARKER = /^(.+)\.live$/

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
}

async function readdirOrNull(path: string): Promise<string[] | null> {
  try {
    return await readdir(path)
  }
  catch (error) {
    if (isMissing(error))
      return null
    throw error
  }
}

async function* fileLines(path: string): AsyncGenerator<string> {
  const lines = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Number.POSITIVE_INFINITY })
  for await (const line of lines) {
    if (line.trim())
      yield line
  }
}

const segmentKey = (sessionId: string, segment: number) => `${sessionId}\u0000${segment}`

function identitiesOf(row: SegmentRollupRecord | RollupFailedRecord): SegmentIdentity[] {
  if (row.kind === 'rollup-failed')
    return []
  const byEpoch = new Map(row.cells.map(cell => [cell.epoch, { epoch: cell.epoch, sha: cell.sha, dirty: cell.dirty }]))
  return [...byEpoch.values()]
}

/**
 * Reads perf data directories without writing into them. Rows in `sessions.jsonl` win: a raw segment is reduced
 * in memory with `SegmentRollupReducer` only when no directory holds a row for its (sessionId, segment). Duplicate
 * rows keep the first `segment-rollup`, else the first row; a duplicate raw segment keeps the first directory's
 * copy. Missing directories are reported, never an error.
 */
export async function readPerfData(dirs: readonly string[], host: PerfReadHost): Promise<PerfData> {
  const found: { path: string, found: boolean }[] = []
  const files: PerfFileCounts[] = []
  const rows = new Map<string, { dir: string, row: SegmentRollupRecord | RollupFailedRecord }>()
  const raws: { dir: string, sessionId: string, segment: number, path: string }[] = []
  const livePids = new Map<string, number>()

  for (const dir of dirs) {
    const names = await readdirOrNull(dir)
    found.push({ path: dir, found: names !== null })
    if (names === null)
      continue
    if (names.includes('sessions.jsonl'))
      files.push(await readRows(dir, rows))
    const rawDir = join(dir, 'raw')
    for (const name of await readdirOrNull(rawDir) ?? []) {
      const segment = RAW_SEGMENT.exec(name)
      if (segment !== null) {
        raws.push({ dir, sessionId: segment[1], segment: Number(segment[2]), path: join(rawDir, name) })
        continue
      }
      const live = LIVE_MARKER.exec(name)
      const pid = live === null ? Number.NaN : Number.parseInt(await readFile(join(rawDir, name), 'utf8'), 10)
      if (live !== null && Number.isSafeInteger(pid) && pid > 0)
        livePids.set(live[1], pid)
    }
  }

  const liveSessions = new Set([...livePids].filter(([, pid]) => host.isPidAlive(pid)).map(([sessionId]) => sessionId))
  const lastSegment = new Map<string, number>()
  for (const { row } of rows.values())
    lastSegment.set(row.sessionId, Math.max(lastSegment.get(row.sessionId) ?? 0, row.segment))
  for (const raw of raws)
    lastSegment.set(raw.sessionId, Math.max(lastSegment.get(raw.sessionId) ?? 0, raw.segment))

  const segments: PerfSegment[] = [...rows.values()].map(({ dir, row }) => ({
    dir,
    sessionId: row.sessionId,
    segment: row.segment,
    row,
    identities: identitiesOf(row),
    modelName: null,
    maxWorkingSetKb: null,
    incidentIds: [],
    live: liveSessions.has(row.sessionId),
  }))
  // A raw segment copied into several directories is reduced once, keyed like rows by (sessionId, segment).
  const reduced = new Set(rows.keys())
  for (const raw of raws) {
    const key = segmentKey(raw.sessionId, raw.segment)
    if (reduced.has(key))
      continue
    reduced.add(key)
    const live = liveSessions.has(raw.sessionId)
    const result = await reduceRaw(raw, { live, followed: (lastSegment.get(raw.sessionId) ?? raw.segment) > raw.segment })
    files.push(result.counts)
    segments.push({ ...result.segment, live })
  }
  segments.sort((left, right) => left.sessionId.localeCompare(right.sessionId) || left.segment - right.segment)
  return { dirs: found, segments, files }
}

async function readRows(dir: string, rows: Map<string, { dir: string, row: SegmentRollupRecord | RollupFailedRecord }>): Promise<PerfFileCounts> {
  const path = join(dir, 'sessions.jsonl')
  const counts: PerfFileCounts = { path, malformed: 0, unknownVersion: 0 }
  for await (const line of fileLines(path)) {
    const parsed = parsePerfLine(line)
    if (!parsed.ok) {
      if (parsed.reason === 'version')
        counts.unknownVersion += 1
      else
        counts.malformed += 1
      continue
    }
    const { record } = parsed
    // `sessions.jsonl` holds only rollup rows; any other valid record there is unusable and counted.
    if (record.kind !== 'segment-rollup' && record.kind !== 'rollup-failed') {
      counts.malformed += 1
      continue
    }
    const key = segmentKey(record.sessionId, record.segment)
    const existing = rows.get(key)
    if (existing === undefined || (existing.row.kind === 'rollup-failed' && record.kind === 'segment-rollup'))
      rows.set(key, { dir, row: record })
  }
  return counts
}

async function reduceRaw(
  raw: { readonly dir: string, readonly sessionId: string, readonly segment: number, readonly path: string },
  session: { readonly live: boolean, readonly followed: boolean },
): Promise<{ counts: PerfFileCounts, segment: Omit<PerfSegment, 'live'> }> {
  const counts: PerfFileCounts = { path: raw.path, malformed: 0, unknownVersion: 0 }
  const reducer = new SegmentRollupReducer({ sessionId: raw.sessionId, segment: raw.segment })
  const identities = new Map<number, SegmentIdentity>()
  const incidentIds = new Set<string>()
  let endedAt = 0
  let stopped = false
  let modelName: string | null = null
  let maxWorkingSetKb: number | null = null
  for await (const line of fileLines(raw.path)) {
    const parsed = parsePerfLine(line)
    if (!parsed.ok) {
      if (parsed.reason === 'version')
        counts.unknownVersion += 1
      else
        counts.malformed += 1
      continue
    }
    const { record } = parsed
    // The reducer counts records it cannot use; the extras below come only from this session's records.
    reducer.push(record)
    if (record.sessionId !== raw.sessionId)
      continue
    endedAt = Math.max(endedAt, record.t)
    switch (record.kind) {
      case 'identity':
        identities.set(record.epoch, { epoch: record.epoch, sha: record.sha, dirty: record.dirty })
        break
      case 'window-rollup':
        modelName = record.tags.modelName ?? modelName
        break
      case 'sample':
        for (const entry of record.processes) {
          if (entry.role.startsWith('window:stage'))
            maxWorkingSetKb = Math.max(maxWorkingSetKb ?? 0, entry.workingSetKb)
        }
        break
      case 'event':
        stopped ||= record.name === 'recording-stop'
        break
      case 'incident':
        incidentIds.add(record.id)
        break
      default:
        break
    }
  }
  const row = reducer.finish({
    endedAt,
    // Same rule as retention: no `recording-stop` and no later segment, and the recorder is not running.
    recovered: !session.live && !stopped && !session.followed,
    malformedLines: counts.malformed + counts.unknownVersion,
    rawBytes: (await stat(raw.path)).size,
  })
  return {
    counts,
    segment: { dir: raw.dir, sessionId: raw.sessionId, segment: raw.segment, row, identities: [...identities.values()], modelName, maxWorkingSetKb, incidentIds: [...incidentIds] },
  }
}
