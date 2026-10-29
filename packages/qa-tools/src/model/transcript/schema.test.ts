import type { ReplyTranscriptRecord } from './schema'

import { describe, expect, it } from 'vitest'

import * as v from 'valibot'

import { replyIdFor, ReplyTranscriptRecordSchema } from './schema'

function createRecord(overrides: Partial<ReplyTranscriptRecord> = {}): ReplyTranscriptRecord {
  const source = { kind: 'ollama-bench' as const, file: 'bench.jsonl', fileSha256: 'a'.repeat(64), rowIndex: 0, path: 'turns[0]' }
  return {
    schema: 'airi.reply-transcript/v1',
    replyId: replyIdFor(source),
    set: 'legacy-test',
    runKey: 'run-1',
    source,
    model: { id: 'qwen3:8b', provider: 'ollama', digest: null, capabilities: ['tools', 'thinking'] },
    generation: { config: 'defaults', options: { temperature: 0.7 }, think: false, withTools: true },
    prompt: { sha256: null, shaSource: 'unknown', toolsSha256: null, contractVersion: null },
    machine: { label: 'mac-m2' },
    conversation: { kind: 'turn', turn: 0, user: 'hello', origin: 'user' },
    reply: { text: '<|ACT happy|> Hi!', thinkingText: '', toolCalls: [{ name: 'lookup', arguments: { q: 1 } }], finish: 'stop', error: null, steps: null },
    timing: { ttftMs: 120, totalMs: 900 },
    usage: null,
    ...overrides,
  }
}

describe('replyTranscriptRecordSchema', () => {
  it('accepts a valid record, including the optional fields', () => {
    const record = createRecord({
      events: [{ kind: 'literal', value: 'Hi' }, { kind: 'special', value: 'ACT happy', raw: '<|ACT happy|>' }],
      stickers: [{ id: 'sticker-1' }],
      usage: { prompt_tokens: 10 },
    })

    expect(v.safeParse(ReplyTranscriptRecordSchema, record).success).toBe(true)
  })

  it.each(['schema', 'set'] as const)('rejects a record missing %s', (key) => {
    const { [key]: _removed, ...rest } = createRecord()

    expect(v.safeParse(ReplyTranscriptRecordSchema, rest).success).toBe(false)
  })

  it('rejects an empty set id', () => {
    expect(v.safeParse(ReplyTranscriptRecordSchema, createRecord({ set: '' })).success).toBe(false)
  })

  it('rejects an extra top-level key and an extra nested key (strictObject)', () => {
    expect(v.safeParse(ReplyTranscriptRecordSchema, { ...createRecord(), scenarioId: 'x' }).success).toBe(false)
    expect(v.safeParse(ReplyTranscriptRecordSchema, createRecord({ timing: { ttftMs: 1, totalMs: 2, extra: 3 } as ReplyTranscriptRecord['timing'] })).success).toBe(false)
  })

  it('rejects an unknown source kind', () => {
    const record = createRecord()

    expect(v.safeParse(ReplyTranscriptRecordSchema, { ...record, source: { ...record.source, kind: 'other' } }).success).toBe(false)
  })
})

describe('replyIdFor', () => {
  const base = { file: 'bench.jsonl', fileSha256: 'b'.repeat(64) }

  it('differs for two rows of the same file that share a path', () => {
    expect(replyIdFor({ ...base, rowIndex: 0, path: 'turns[0]' })).not.toBe(replyIdFor({ ...base, rowIndex: 1, path: 'turns[0]' }))
  })

  it('is stable for identical input and is 16 hex characters', () => {
    const first = replyIdFor({ ...base, rowIndex: 3, path: 'replies[2]' })

    expect(first).toBe(replyIdFor({ ...base, rowIndex: 3, path: 'replies[2]' }))
    expect(first).toMatch(/^[0-9a-f]{16}$/)
  })
})
