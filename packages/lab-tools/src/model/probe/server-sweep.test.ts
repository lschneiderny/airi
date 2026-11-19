import type { ReplyTranscriptRecord } from '../transcript/schema'

import { describe, expect, it } from 'vitest'

import { ollamaBinary, parseVariant, sweepTiming } from './server-sweep'

describe('parseVariant', () => {
  it('reads a label and its OLLAMA_ settings', () => {
    expect(parseVariant('default:')).toEqual({ label: 'default', env: {} })
    expect(parseVariant('kv-q8:OLLAMA_FLASH_ATTENTION=1,OLLAMA_KV_CACHE_TYPE=q8_0')).toEqual({ label: 'kv-q8', env: { OLLAMA_FLASH_ATTENTION: '1', OLLAMA_KV_CACHE_TYPE: 'q8_0' } })
  })

  it.each(['Bad Label:', 'x:PATH=/bin', 'x:OLLAMA_HOST=0.0.0.0', 'x:OLLAMA_X'])('refuses %s', (text) => {
    expect(() => parseVariant(text)).toThrow()
  })
})

describe('ollamaBinary', () => {
  it('prefers an explicit binary, then the macOS app, then PATH', () => {
    expect(ollamaBinary('/opt/ollama', () => true)).toBe('/opt/ollama')
    expect(ollamaBinary(undefined, () => true)).toBe('/Applications/Ollama.app/Contents/Resources/ollama')
    expect(ollamaBinary(undefined, () => false)).toBe('ollama')
  })
})

describe('sweepTiming', () => {
  const record = (turn: number, ttftMs: number, totalMs: number, completion: number, firstSpeechMs?: number, prompt = 6000 + turn): ReplyTranscriptRecord => ({
    schema: 'airi.reply-transcript/v1',
    replyId: `sweep-${turn}`,
    set: 'sweep-test',
    runKey: 'sweep-test@1/model/seed-1',
    source: { kind: 'live', file: 'test', fileSha256: 'source', rowIndex: turn, path: 'reply' },
    model: { id: 'model', provider: 'test', digest: null, capabilities: [] },
    generation: { config: 'seed-1', options: {}, think: null, withTools: false },
    prompt: { sha256: null, shaSource: 'recorded', toolsSha256: null, contractVersion: null },
    machine: { label: 'test' },
    conversation: { kind: 'turn', turn, user: 'x', origin: 'user' },
    reply: { text: 'hi', thinkingText: '', toolCalls: [], finish: 'stop', error: null, steps: 1 },
    timing: { ttftMs, totalMs, firstSpeechMs },
    usage: { prompt_tokens: prompt, completion_tokens: completion },
  })

  it('splits cold and warm turns and computes decode speed after the first token', () => {
    expect(sweepTiming([record(1, 4000, 5000, 11), record(2, 200, 1200, 21, 300), record(3, 400, 1400, 21, 500)])).toEqual({
      coldTtftMs: 4000,
      warmTtftMs: 300,
      warmFirstSpeechMs: 400,
      meanTotalMs: (5000 + 1200 + 1400) / 3,
      decodeTps: 50 / 3,
      maxPromptTokens: 6003,
    })
  })
})
