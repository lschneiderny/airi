import type { PerfRecord } from '@proj-airi/stage-shared/perf/usage'

import { Buffer } from 'node:buffer'
import { randomInt } from 'node:crypto'
import { join } from 'node:path'

/** The asynchronous file operations the recorder uses; `node:fs/promises` satisfies it. */
export interface PerfRecordingFs {
  mkdir: (path: string, options: { recursive: true, mode: number }) => Promise<unknown>
  appendFile: (path: string, data: string, options: { mode: number }) => Promise<void>
  writeFile: (path: string, data: string, options: { mode: number }) => Promise<void>
  rm: (path: string, options: { force: true }) => Promise<void>
}

/** A segment reaching this size closes at the next append. */
export const SEGMENT_MAX_BYTES = 64 * 1024 * 1024
export const PERF_FILE_MODE = 0o600

/** `<ISO start time with ':' and '.' as '-'>-<6 base36 characters>`, safe in a file name on every platform. */
export function createPerfSessionId(startedAtMs: number): string {
  const suffix = randomInt(36 ** 6).toString(36).padStart(6, '0')
  return `${new Date(startedAtMs).toISOString().replace(/[:.]/g, '-')}-${suffix}`
}

function localDay(atMs: number): string {
  const date = new Date(atMs)
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

/**
 * The raw files of one recording session: `raw/<sessionId>.<segment>.jsonl` plus `raw/<sessionId>.live`.
 *
 * A segment closes at local midnight or once it holds {@link SEGMENT_MAX_BYTES}; the caller then starts the
 * next one with {@link rotate} and writes its header lines first. The `.live` file holds the recording
 * process id while the session runs, so a later start can tell a crashed session from a finished one.
 */
export class PerfSegmentFile {
  #segment = 0
  #segmentDay: string
  #segmentBytes = 0
  #sessionBytes = 0

  constructor(
    private readonly fs: PerfRecordingFs,
    private readonly rawDirectory: string,
    readonly sessionId: string,
    startedAtMs: number,
  ) {
    this.#segmentDay = localDay(startedAtMs)
  }

  get segment(): number {
    return this.#segment
  }

  /** Bytes the session wrote to all its segments so far. */
  get sessionBytes(): number {
    return this.#sessionBytes
  }

  get livePath(): string {
    return join(this.rawDirectory, `${this.sessionId}.live`)
  }

  shouldRotate(atMs: number): boolean {
    return this.#segmentBytes >= SEGMENT_MAX_BYTES || localDay(atMs) !== this.#segmentDay
  }

  rotate(atMs: number): void {
    this.#segment += 1
    this.#segmentDay = localDay(atMs)
    this.#segmentBytes = 0
  }

  /** Writes the records with one append, so a stop or a crash never leaves part of a tick behind. */
  async append(records: readonly PerfRecord[]): Promise<void> {
    const chunk = records.map(record => `${JSON.stringify(record)}\n`).join('')
    await this.fs.appendFile(join(this.rawDirectory, `${this.sessionId}.${this.#segment}.jsonl`), chunk, { mode: PERF_FILE_MODE })
    const bytes = Buffer.byteLength(chunk)
    this.#segmentBytes += bytes
    this.#sessionBytes += bytes
  }
}
