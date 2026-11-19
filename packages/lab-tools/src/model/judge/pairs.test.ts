import type { ReplyTranscriptRecord } from '../transcript/schema'
import type { JudgeReply, SpokenReply } from './pairs'

import { mulberry32 } from '@proj-airi/stage-shared/perf/usage'
import { describe, expect, it } from 'vitest'

import { buildJudgeReplies, pairKey, planPairs, slotOf } from './pairs'

function record(overrides: { model?: string, config?: string, turn?: number | null, user?: string, replyId?: string, runKey?: string, error?: string | null, kind?: 'turn' | 'probe' } = {}): ReplyTranscriptRecord {
  const model = overrides.model ?? 'model-a'
  const config = overrides.config ?? 'seed-1'
  return {
    schema: 'airi.reply-transcript/v1',
    replyId: overrides.replyId ?? `${model}/${config}/${overrides.turn ?? 1}`,
    set: 'test-set',
    runKey: overrides.runKey ?? `test-set@1/${model}/${config}`,
    source: { kind: 'live', file: 'test', fileSha256: 'source', rowIndex: 0, path: 'reply' },
    model: { id: model, provider: 'test', digest: null, capabilities: [] },
    generation: { config, options: {}, think: null, withTools: false },
    prompt: { sha256: null, shaSource: 'recorded', toolsSha256: null, contractVersion: null },
    machine: { label: 'test' },
    conversation: { kind: overrides.kind ?? 'turn', turn: overrides.turn === undefined ? 1 : overrides.turn, user: overrides.user ?? 'hi', origin: 'user' },
    reply: { text: 'hello', thinkingText: '', toolCalls: [], finish: 'stop', error: overrides.error ?? null, steps: 1 },
    timing: { ttftMs: null, totalMs: null },
    usage: null,
  }
}

const spoken = (r: ReplyTranscriptRecord, text = r.reply.text): SpokenReply => ({ record: r, spoken: text, cues: [] })

describe('slotOf', () => {
  it('keys a reply by turn, seed, stage, and user text', () => {
    expect(slotOf(record({ config: 'temp-0.3-seed-2-nothink', turn: 3, user: 'hey' }))).toEqual({ key: JSON.stringify([3, '2', null, 'hey']), turn: 3, user: 'hey', seed: '2', stage: null })
  })

  it('keeps the relationship stage of a live record in the slot', () => {
    const staged: ReplyTranscriptRecord = {
      ...record({ config: 'default-nothink@intimate' }),
      schema: 'airi.reply-transcript/v2',
      live: {
        scenario: { id: 'relationship-stages', version: 1, stage: 'intimate' },
        endpoint: { shape: 'openai-chat-completions', baseUrl: 'http://127.0.0.1:11434/v1' },
        request: { model: 'model-a', bodySha256: 'body', startedAt: '2026-11-18T12:00:00.000Z' },
        response: { status: 200, id: null, model: null, systemFingerprint: null, endedAt: '2026-11-18T12:00:01.000Z' },
        contractSha256: 'contract',
      },
    }

    expect(slotOf(staged)?.stage).toBe('intimate')
  })

  it('gives probes and turnless records no slot', () => {
    expect(slotOf(record({ kind: 'probe' }))).toBeNull()
    expect(slotOf(record({ turn: null }))).toBeNull()
  })
})

describe('buildJudgeReplies', () => {
  it('attaches the same conversation\'s previous exchange and leaves out failed replies', () => {
    const first = record({ turn: 1, user: 'good morning' })
    const second = record({ turn: 2, user: 'how are you?' })
    const failed = record({ model: 'model-b', turn: 2, error: 'timeout' })
    const replies = buildJudgeReplies([spoken(first, 'Morning!'), spoken(second, 'Great!'), spoken(failed)])

    expect(replies.map(r => r.replyId)).toEqual([first.replyId, second.replyId])
    expect(replies[0]!.previous).toBeNull()
    expect(replies[1]!.previous).toEqual({ user: 'good morning', spoken: 'Morning!' })
  })
})

describe('planPairs', () => {
  const replies = (models: string[], turns: number[]): JudgeReply[] => buildJudgeReplies(models.flatMap(model => turns.map(turn => spoken(record({ model, turn, user: `turn ${turn}` })))))

  it('pairs only different contenders that answered the same slot', () => {
    const plan = planPairs(replies(['a', 'b', 'c'], [1, 2]), { random: mulberry32(1) })

    expect(plan).toHaveLength(6)
    for (const pair of plan) {
      expect(pair.left.slot.key).toBe(pair.right.slot.key)
      expect(pair.left.contender).not.toBe(pair.right.contender)
    }
  })

  it('covers every matchup before repeating one', () => {
    const plan = planPairs(replies(['a', 'b', 'c'], [1, 2, 3, 4]), { random: mulberry32(7) })
    const matchup = (i: number) => [plan[i]!.left.contender, plan[i]!.right.contender].sort().join('|')

    expect(new Set([0, 1, 2].map(matchup)).size).toBe(3)
  })

  it('shows contenders on both sides', () => {
    const plan = planPairs(replies(['a', 'b'], [1, 2, 3, 4, 5, 6, 7, 8]), { random: mulberry32(3) })

    expect(plan.some(pair => pair.left.contender === 'a · default')).toBe(true)
    expect(plan.some(pair => pair.right.contender === 'a · default')).toBe(true)
  })

  it('skips judged pairs and contenders outside the filter', () => {
    const all = replies(['a', 'b', 'c'], [1])
    const [first] = planPairs(all, { random: mulberry32(1) })
    const judged = new Set([pairKey(first!.left.slot.key, first!.right.replyId, first!.left.replyId)])

    expect(planPairs(all, { random: mulberry32(1), judged }).map(pair => pair.id)).not.toContain(first!.id)
    expect(planPairs(all, { random: mulberry32(1), contenders: ['a ·', 'b ·'] }).map(pair => [pair.left.contender, pair.right.contender].sort())).toEqual([['a · default', 'b · default']])
  })
})
