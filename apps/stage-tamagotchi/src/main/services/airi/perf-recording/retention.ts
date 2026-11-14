import type { PerfRetentionFs } from './retention-fs'
import type { RawSegment } from './rollup-segment'

import process from 'node:process'

import { join } from 'node:path'

import { useLogg } from '@guiiai/logg'
import { parsePerfLine } from '@proj-airi/stage-shared/perf/usage'

import { hasErrorCode } from './retention-fs'
import { rollUpRawSegment } from './rollup-segment'
import { PERF_FILE_MODE } from './segment-file'

export interface PerfRetentionOptions {
  /** The perf data directory holding `raw/`, `incidents/` and `sessions.jsonl`. */
  directory: string
  /** Wall clock in epoch milliseconds, compared with record times and file modification times. */
  now: () => number
  fs: PerfRetentionFs
  /** Whether a process with this id runs on this machine; a pid this process cannot signal still counts as running. */
  isPidAlive: (pid: number) => boolean
  /** Schedules a callback and returns the function that cancels it. */
  setTimer: (callback: () => void, ms: number) => () => void
}

const FIRST_RUN_DELAY_MS = 30_000
const RUN_INTERVAL_MS = 60 * 60 * 1000
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000
const RAW_MAX_BYTES = 1024 ** 3
/** A lock this old belongs to a pass that died; a live pass finishes a 64 MiB segment well within it. */
const LOCK_STALE_MS = 10 * 60 * 1000

const RAW_SEGMENT = /^(.+)\.(\d+)\.jsonl$/
const LIVE_MARKER = /^(.+)\.live$/

const log = useLogg('main/perf-retention').useGlobalConfig()

const segmentKey = (sessionId: string, segment: number) => `${sessionId}\u0000${segment}`

/**
 * Rolls closed raw segments up into `sessions.jsonl` and prunes the perf directory, 30 s after {@link start} and then
 * hourly, whether recording is on or not.
 *
 * A segment is closed when a later segment of its session exists, or its session has no `.live` file, or the `.live`
 * pid is dead (a hard kill or crash; the stale `.live` is removed). Each closed segment without a row gets one
 * `segment-rollup` or `rollup-failed` row, written under `raw/<sessionId>.<segment>.rollup.lock`, so app instances
 * sharing the directory never write a segment twice. `sessions.jsonl` is only appended to.
 *
 * Pruning deletes only segments that already had a row when the pass started, so a segment rolled up in a pass
 * survives until the next one: segments started more than 14 days ago, then the oldest while `raw/` holds more than
 * 1 GiB, never the segment a live session writes. Incident files older than 14 days go too; `traces/` keeps its own
 * retention.
 */
export class PerfRetention {
  #cancelTimer: (() => void) | null = null
  #running: Promise<void> | null = null
  #disposed = false

  constructor(private readonly options: PerfRetentionOptions) {}

  start(): void {
    if (this.#disposed || this.#cancelTimer !== null || this.#running !== null)
      return
    this.#schedule(FIRST_RUN_DELAY_MS)
  }

  /** Cancels the next pass and waits for a running one, which stops before its next segment. */
  async dispose(): Promise<void> {
    this.#disposed = true
    this.#cancelTimer?.()
    this.#cancelTimer = null
    await this.#running
  }

  async run(): Promise<void> {
    const rawDirectory = join(this.options.directory, 'raw')
    const names = await this.#readdirOrEmpty(rawDirectory)
    const rows = await this.#readRows()
    const segments: RawSegment[] = []
    for (const name of names) {
      const match = RAW_SEGMENT.exec(name)
      if (match !== null)
        segments.push({ sessionId: match[1], segment: Number(match[2]), path: join(rawDirectory, name) })
    }
    const liveSessions = await this.#liveSessions(rawDirectory, names)
    const lastSegment = new Map<string, number>()
    for (const { sessionId, segment } of [...segments, ...rows.values()])
      lastSegment.set(sessionId, Math.max(lastSegment.get(sessionId) ?? 0, segment))

    for (const segment of segments) {
      if (this.#disposed)
        return
      const followed = (lastSegment.get(segment.sessionId) ?? segment.segment) > segment.segment
      if (rows.has(segmentKey(segment.sessionId, segment.segment)) || (liveSessions.has(segment.sessionId) && !followed))
        continue
      try {
        await this.#rollUp(segment, followed)
      }
      catch (error) {
        log.withError(error).error(`Failed to roll up perf segment ${segment.path}`)
      }
    }
    if (this.#disposed)
      return
    const isWriting = (segment: RawSegment) => liveSessions.has(segment.sessionId) && lastSegment.get(segment.sessionId) === segment.segment
    await this.#pruneRaw(segments, { rows, isWriting })
    await this.#pruneIncidents()
  }

  #schedule(ms: number): void {
    this.#cancelTimer = this.options.setTimer(() => {
      this.#cancelTimer = null
      this.#running = this.run()
        .catch(error => log.withError(error).error('Failed to apply perf retention'))
        .finally(() => {
          this.#running = null
          if (!this.#disposed)
            this.#schedule(RUN_INTERVAL_MS)
        })
    }, ms)
  }

  async #readdirOrEmpty(path: string): Promise<string[]> {
    try {
      return await this.options.fs.readdir(path)
    }
    catch (error) {
      if (hasErrorCode(error, 'ENOENT'))
        return []
      throw error
    }
  }

  /** Rows of `sessions.jsonl` by segment, with the time pruning ages them by: the segment's start, or a failed row's time. */
  async #readRows(): Promise<Map<string, { sessionId: string, segment: number, startedAt: number }>> {
    const rows = new Map<string, { sessionId: string, segment: number, startedAt: number }>()
    try {
      for await (const line of this.options.fs.readLines(join(this.options.directory, 'sessions.jsonl'))) {
        const parsed = parsePerfLine(line)
        if (!parsed.ok || (parsed.record.kind !== 'segment-rollup' && parsed.record.kind !== 'rollup-failed'))
          continue
        const { record } = parsed
        const key = segmentKey(record.sessionId, record.segment)
        const startedAt = record.kind === 'segment-rollup' ? record.startedAt : record.t
        rows.set(key, { sessionId: record.sessionId, segment: record.segment, startedAt: Math.min(rows.get(key)?.startedAt ?? startedAt, startedAt) })
      }
    }
    catch (error) {
      if (!hasErrorCode(error, 'ENOENT'))
        throw error
    }
    return rows
  }

  /** Sessions whose `.live` names a running process. A stale `.live` is removed; one without a readable pid counts as live. */
  async #liveSessions(rawDirectory: string, names: readonly string[]): Promise<Set<string>> {
    const live = new Set<string>()
    for (const name of names) {
      const match = LIVE_MARKER.exec(name)
      if (match === null)
        continue
      const path = join(rawDirectory, name)
      let text: string
      try {
        text = await this.options.fs.readFile(path, 'utf8')
      }
      catch (error) {
        // The session stopped since the listing.
        if (hasErrorCode(error, 'ENOENT'))
          continue
        throw error
      }
      const pid = Number.parseInt(text, 10)
      // A recorder that has created its `.live` but not yet written the pid is running.
      if (!Number.isSafeInteger(pid) || pid <= 0 || this.options.isPidAlive(pid))
        live.add(match[1])
      else
        await this.options.fs.rm(path, { force: true })
    }
    return live
  }

  async #rollUp(segment: RawSegment, followed: boolean): Promise<void> {
    const lockPath = segment.path.replace(/\.jsonl$/, '.rollup.lock')
    if (!(await this.#lock(lockPath)))
      return
    try {
      // Another instance may have written the row between this pass's read and the lock.
      if ((await this.#readRows()).has(segmentKey(segment.sessionId, segment.segment)))
        return
      const row = await rollUpRawSegment(this.options.fs, segment, followed)
      await this.options.fs.appendFile(join(this.options.directory, 'sessions.jsonl'), `${JSON.stringify(row)}\n`, { mode: PERF_FILE_MODE })
    }
    finally {
      await this.options.fs.rm(lockPath, { force: true })
    }
  }

  /** Creates the lock, replacing one older than {@link LOCK_STALE_MS}; `false` while another pass holds it. */
  async #lock(lockPath: string): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.options.fs.writeFile(lockPath, `${process.pid}\n`, { flag: 'wx', mode: PERF_FILE_MODE })
        return true
      }
      catch (error) {
        if (!hasErrorCode(error, 'EEXIST'))
          throw error
      }
      let mtimeMs: number
      try {
        mtimeMs = (await this.options.fs.stat(lockPath)).mtimeMs
      }
      catch (error) {
        // The holder finished between the create and the stat; try again.
        if (hasErrorCode(error, 'ENOENT'))
          continue
        throw error
      }
      if (this.options.now() - mtimeMs < LOCK_STALE_MS)
        return false
      await this.options.fs.rm(lockPath, { force: true })
    }
    return false
  }

  async #pruneRaw(
    segments: readonly RawSegment[],
    { rows, isWriting }: { rows: ReadonlyMap<string, { startedAt: number }>, isWriting: (segment: RawSegment) => boolean },
  ): Promise<void> {
    const cutoff = this.options.now() - RETENTION_MS
    const sized = await Promise.all(segments.map(async segment => ({ segment, size: await this.#sizeOrZero(segment.path) })))
    let totalBytes = sized.reduce((sum, entry) => sum + entry.size, 0)
    const rolledUp = sized
      .flatMap((entry) => {
        const row = rows.get(segmentKey(entry.segment.sessionId, entry.segment.segment))
        return row === undefined || isWriting(entry.segment) ? [] : [{ ...entry, startedAt: row.startedAt }]
      })
      .toSorted((left, right) => left.startedAt - right.startedAt)
    // Oldest first, so the expired segments come before any the size cap removes.
    for (const { segment, size, startedAt } of rolledUp) {
      if (startedAt >= cutoff && totalBytes <= RAW_MAX_BYTES)
        break
      await this.options.fs.rm(segment.path, { force: true })
      totalBytes -= size
    }
  }

  async #pruneIncidents(): Promise<void> {
    const cutoff = this.options.now() - RETENTION_MS
    const directory = join(this.options.directory, 'incidents')
    for (const name of await this.#readdirOrEmpty(directory)) {
      if (!name.endsWith('.json'))
        continue
      const path = join(directory, name)
      const modified = await this.#statOrNull(path)
      if (modified !== null && modified.mtimeMs < cutoff)
        await this.options.fs.rm(path, { force: true })
    }
  }

  async #sizeOrZero(path: string): Promise<number> {
    return (await this.#statOrNull(path))?.size ?? 0
  }

  async #statOrNull(path: string): Promise<{ size: number, mtimeMs: number } | null> {
    try {
      return await this.options.fs.stat(path)
    }
    catch (error) {
      if (hasErrorCode(error, 'ENOENT'))
        return null
      throw error
    }
  }
}
