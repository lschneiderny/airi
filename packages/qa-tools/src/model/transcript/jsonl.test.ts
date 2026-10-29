import type { ReplyTranscriptRecord } from './schema'

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createTranscriptWriter, readTranscript } from './jsonl'
import { replyIdFor } from './schema'

function createRecord(rowIndex: number): ReplyTranscriptRecord {
  const source = { kind: 'ollama-sweep' as const, file: 'sweep.jsonl', fileSha256: 'c'.repeat(64), rowIndex, path: 'replies[0]' }
  return {
    schema: 'airi.reply-transcript/v1',
    replyId: replyIdFor(source),
    set: 'legacy-test',
    runKey: 'run-1',
    source,
    model: { id: 'qwen3:8b', provider: 'ollama', digest: null, capabilities: [] },
    generation: { config: 'defaults', options: {}, think: false, withTools: false },
    prompt: { sha256: null, shaSource: 'unknown', toolsSha256: null, contractVersion: null },
    machine: { label: 'mac-m2' },
    conversation: { kind: 'turn', turn: rowIndex, user: `line ${rowIndex}\nwith a newline`, origin: 'user' },
    reply: { text: `reply ${rowIndex}`, thinkingText: '', toolCalls: [], finish: 'stop', error: null, steps: null },
    timing: { ttftMs: null, totalMs: 10 },
    usage: null,
  }
}

async function collect(path: string): Promise<ReplyTranscriptRecord[]> {
  const records: ReplyTranscriptRecord[] = []
  for await (const record of readTranscript(path))
    records.push(record)
  return records
}

describe('transcript jsonl', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'qa-transcript-'))
    path = join(dir, 'transcripts.jsonl')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips three records, one \\n-terminated line each with no trailing blank line', async () => {
    const records = [0, 1, 2].map(createRecord)
    const writer = createTranscriptWriter(path)
    for (const record of records)
      await writer.write(record)
    await writer.close()

    const text = readFileSync(path, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.endsWith('\n\n')).toBe(false)
    expect(text.split('\n')).toHaveLength(4)
    expect(await collect(path)).toEqual(records)
  })

  it('appends onto an existing file, keeping the existing record and adding one \n-terminated line', async () => {
    const first = createTranscriptWriter(path)
    await first.write(createRecord(0))
    await first.close()

    const second = createTranscriptWriter(path)
    await second.write(createRecord(1))
    await second.close()

    const text = readFileSync(path, 'utf8')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.split('\n')).toEqual([JSON.stringify(createRecord(0)), JSON.stringify(createRecord(1)), ''])
    expect(await collect(path)).toEqual([createRecord(0), createRecord(1)])
  })

  it('does not see leftovers from a previous run when writing to a fresh path twice', async () => {
    for (const fileName of ['first.jsonl', 'second.jsonl']) {
      const target = join(dir, fileName)
      const writer = createTranscriptWriter(target)
      await writer.write(createRecord(0))
      await writer.close()

      expect(await collect(target)).toHaveLength(1)
    }
  })

  it('refuses to write an invalid record and leaves the file without a partial line', async () => {
    const writer = createTranscriptWriter(path)
    await writer.write(createRecord(0))
    await expect(writer.write({ ...createRecord(1), set: '' })).rejects.toThrow(/set/)
    await writer.close()

    expect(await collect(path)).toHaveLength(1)
  })

  it('reports the line number of a corrupt JSON line', async () => {
    writeFileSync(path, `${JSON.stringify(createRecord(0))}\n{\n${JSON.stringify(createRecord(2))}\n`)

    await expect(collect(path)).rejects.toThrow(/line 2/)
  })

  it('reports the line number of valid JSON that fails the schema', async () => {
    writeFileSync(path, `${JSON.stringify(createRecord(0))}\n${JSON.stringify(createRecord(1))}\n${JSON.stringify({ schema: 'airi.reply-transcript/v1' })}\n`)

    await expect(collect(path)).rejects.toThrow(/line 3/)
  })

  it('rejects for a file that does not exist instead of hanging', async () => {
    await expect(collect(join(dir, 'missing.jsonl'))).rejects.toThrow(/ENOENT/)
  })

  it('yields nothing for an empty file', async () => {
    writeFileSync(path, '')

    expect(await collect(path)).toEqual([])
  })

  it('skips blank lines (a trailing blank line is not an error) but keeps physical line numbers', async () => {
    writeFileSync(path, `${JSON.stringify(createRecord(0))}\n\n${JSON.stringify(createRecord(1))}\n\n`)
    expect(await collect(path)).toHaveLength(2)

    writeFileSync(path, `${JSON.stringify(createRecord(0))}\n\n{\n`)
    await expect(collect(path)).rejects.toThrow(/line 3/)
  })

  it('reads CRLF line endings', async () => {
    writeFileSync(path, `${JSON.stringify(createRecord(0))}\r\n${JSON.stringify(createRecord(1))}\r\n`)

    expect(await collect(path)).toEqual([createRecord(0), createRecord(1)])
  })
})
