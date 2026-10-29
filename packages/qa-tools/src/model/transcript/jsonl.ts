import type { FileHandle } from 'node:fs/promises'

import type { ReplyTranscriptRecord } from './schema'

import { createReadStream } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname } from 'node:path'

import { errorMessageFrom } from '@moeru/std'

import * as v from 'valibot'

import { ReplyTranscriptRecordSchema } from './schema'

function describeIssues(issues: [v.BaseIssue<unknown>, ...v.BaseIssue<unknown>[]]): string {
  return issues.map(issue => `${v.getDotPath(issue) ?? '(root)'}: ${issue.message}`).join('; ')
}

/**
 * Streams a transcript file one record at a time, so large files never sit in memory.
 * Blank lines (including a trailing one) are skipped; CRLF endings are accepted. The first line that is not
 * valid JSON or does not match the schema throws an error that names its 1-based physical line number.
 */
export async function* readTranscript(path: string): AsyncGenerator<ReplyTranscriptRecord, void, undefined> {
  const input = createReadStream(path, { encoding: 'utf8' })
  let lineNumber = 0
  let pending = ''

  // Splits on `\n` only and drops a trailing `\r`, so CRLF files read the same as LF files.
  function* parseLine(line: string): Generator<ReplyTranscriptRecord, void, undefined> {
    lineNumber++
    if (line.trim() === '')
      return
    let json: unknown
    try {
      json = JSON.parse(line)
    }
    catch (error) {
      throw new Error(`${path}: line ${lineNumber} is not valid JSON (${errorMessageFrom(error) ?? 'parse error'})`)
    }
    const parsed = v.safeParse(ReplyTranscriptRecordSchema, json)
    if (!parsed.success)
      throw new Error(`${path}: line ${lineNumber} is not a reply transcript record (${describeIssues(parsed.issues)})`)
    yield parsed.output
  }

  try {
    // The stream's own async iterator rejects on a stream error (missing file, directory), so nothing can hang
    // and no per-line promise is attached to a long-lived one.
    for await (const chunk of input) {
      pending += chunk
      let newline = pending.indexOf('\n')
      while (newline !== -1) {
        const line = pending.slice(0, newline).replace(/\r$/, '')
        pending = pending.slice(newline + 1)
        yield* parseLine(line)
        newline = pending.indexOf('\n')
      }
    }
    yield* parseLine(pending.replace(/\r$/, ''))
  }
  finally {
    input.destroy()
  }
}

export interface TranscriptWriter {
  /** Validates the record, then appends it as one `\n`-terminated line. An invalid record writes nothing. */
  write: (record: ReplyTranscriptRecord) => Promise<void>
  close: () => Promise<void>
}

/** Appends validated records to `path`, creating the file and its parent directory on the first write. */
export function createTranscriptWriter(path: string): TranscriptWriter {
  let handle: FileHandle | undefined
  return {
    async write(record) {
      const parsed = v.safeParse(ReplyTranscriptRecordSchema, record)
      if (!parsed.success)
        throw new Error(`Refusing to write an invalid transcript record (${describeIssues(parsed.issues)})`)
      if (!handle) {
        await mkdir(dirname(path), { recursive: true })
        handle = await open(path, 'a')
      }
      await handle.appendFile(`${JSON.stringify(parsed.output)}\n`, 'utf8')
    },
    async close() {
      const open = handle
      handle = undefined
      await open?.close()
    },
  }
}
