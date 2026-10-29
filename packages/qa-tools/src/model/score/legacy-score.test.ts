import type { ReplyTranscriptRecord } from '../transcript/schema'

import { describe, expect, it } from 'vitest'

import fixture from './__fixtures__/legacy-dolphin3-defaults.json'

import { legacyScoreReplies, scoreReplies } from './legacy-score'

// Captured once with:
// bun scripts/ollama-bench/score.ts scripts/ollama-bench/results/2026-10-27-mac-m2/sweep.jsonl dolphin3:8b
// (the row { model: 'dolphin3:8b', config: 'defaults' }; the replies above are that row's replies).
const captured = {
  replies: 7,
  blank: 0,
  toolNoSpeech: 0,
  toolAny: 0,
  errors: 0,
  leadCue: '7/7',
  badCue: 0,
  jsonCue: 0,
  malformed: 4,
  emoji: 0,
  stageDir: 0,
  lower: '0%',
  persona: '0%',
  aiBreak: 0,
  words: 23,
  genTps: '18.6',
  avgReplyS: '5.5',
  thinkChars: 0,
}

function recordFrom(reply: typeof fixture[number], index: number): ReplyTranscriptRecord {
  return {
    schema: 'airi.reply-transcript/v1',
    replyId: `legacy-${index}`,
    set: 'test',
    runKey: 'dolphin3:8b|defaults',
    source: { kind: 'ollama-sweep', file: 'sweep.jsonl', fileSha256: 'x', rowIndex: 0, path: `replies[${index}]` },
    model: { id: 'dolphin3:8b', provider: 'ollama', digest: null, capabilities: [] },
    generation: { config: 'defaults', options: {}, think: false, withTools: false },
    prompt: { sha256: null, shaSource: 'unknown', toolsSha256: null, contractVersion: null },
    machine: { label: 'test' },
    conversation: { kind: 'turn', turn: index, user: '', origin: 'user' },
    reply: {
      text: reply.text,
      thinkingText: '',
      toolCalls: [],
      finish: null,
      error: reply.error,
      steps: null,
    },
    timing: { ttftMs: null, totalMs: reply.totalMs },
    usage: reply.usage,
  }
}

describe('scoreReplies', () => {
  it('reproduces the whole object the original script printed for dolphin3:8b defaults', () => {
    expect(fixture).toHaveLength(7)
    expect(scoreReplies(fixture)).toEqual(captured)
  })
})

describe('legacyScoreReplies', () => {
  it('scores transcript records to the same whole object', () => {
    expect(legacyScoreReplies(fixture.map(recordFrom))).toEqual(captured)
  })

  it('handles an empty record list', () => {
    expect(legacyScoreReplies([])).toMatchObject({ replies: 0, blank: 0, leadCue: '0/0', words: 0 })
  })

  it('treats a null total time as zero and keeps tool calls', () => {
    const base = recordFrom(fixture[0]!, 0)
    const record: ReplyTranscriptRecord = {
      ...base,
      reply: { ...base.reply, text: '', toolCalls: [{ name: 'x', arguments: {} }] },
      timing: { ttftMs: null, totalMs: null },
      usage: null,
    }
    expect(legacyScoreReplies([record])).toMatchObject({ replies: 1, toolNoSpeech: 1, toolAny: 1, avgReplyS: '0.0' })
  })
})
