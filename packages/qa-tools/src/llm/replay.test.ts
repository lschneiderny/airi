import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import { completion, streamChunks } from './protocol'
import { parseScript, ReplayScript } from './script'
import { encodeSpeech } from './speech'

describe('replay scripts', () => {
  it('parses JSON arrays and JSONL while preserving ACT bytes and tool arguments', () => {
    const entries = [{ content: '<|ACT {"emotion":"happy"}|>Hi!' }, { toolCalls: [{ name: 'perform_action', arguments: { action: 'stop' } }] }]
    expect(parseScript(JSON.stringify(entries), 'script.json')).toEqual(parseScript(entries.map(entry => JSON.stringify(entry)).join('\r\n'), 'script.jsonl'))
    expect(parseScript(JSON.stringify(entries), 'script.json')[0].content).toBe(entries[0].content)
  })

  it.each([
    ['[{}', 'broken.json'],
    ['{"content":4}', 'broken.jsonl'],
    ['[{"match":{"regex":"["}}]', 'broken.json'],
    ['[{"toolCalls":[{"name":"a","arguments":"{"}]}]', 'broken.json'],
  ])('rejects invalid script %s with its source name', (text, source) => {
    expect(() => parseScript(text, source)).toThrow(source)
  })

  it('prefers unused matches without skipping earlier entries or repeating matches', () => {
    const script = new ReplayScript(parseScript(JSON.stringify([
      { content: 'first' },
      { match: 'wave', content: 'second' },
      { match: { regex: '^HELLO$', flags: 'i' }, content: 'third' },
    ]), 'selection.json'), 'selection.json')
    expect(script.take('please wave').index).toBe(1)
    expect(script.take('hello').index).toBe(2)
    expect(script.take('wave again').index).toBe(0)
    expect(() => script.take('exhausted')).toThrow('selection.json: exhausted at index 3')
  })

  it('serves appended replies after an empty start, in order', () => {
    const script = new ReplayScript([], 'mcp')
    expect(() => script.take('hi')).toThrow('mcp: exhausted at index 0')
    expect(script.remaining).toBe(0)
    script.append({ content: 'one', toolCalls: [] })
    script.append({ content: 'two', toolCalls: [] })
    expect(script.take('hi').entry.content).toBe('one')
    expect(script.remaining).toBe(1)
    expect(script.take('again').entry.content).toBe('two')
  })
})

describe('openAI replay chunks', () => {
  it('reassembles split Unicode text and multiple indexed tool arguments', () => {
    const [entry] = parseScript(JSON.stringify([{
      content: '<|ACT {"emotion":"happy"}|>Hi \u{1F44B}!',
      toolCalls: [
        { name: 'perform_action', arguments: { action: 'stop' } },
        { name: 'other', arguments: '{"value":2}' },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    }]), 'chunks.json')
    const chunks = [...streamChunks(entry, { index: 2, chunkChars: 1 })]
    expect(chunks.map(chunk => chunk.choices[0]?.delta.content ?? '').join('')).toBe(entry.content)
    // Every frame must survive UTF-8 encoding independently, including surrogate pairs.
    expect(chunks.map(chunk => Buffer.from(chunk.choices[0]?.delta.content ?? '').toString()).join('')).toBe(entry.content)
    const calls = chunks.flatMap(chunk => chunk.choices[0]?.delta.tool_calls ?? [])
    for (const index of [0, 1]) {
      const parts = calls.filter(call => call.index === index)
      expect(parts[0]).toMatchObject({ id: `call_2_${index}`, type: 'function' })
      expect(JSON.parse(parts.map(part => part.function.arguments).join(''))).toEqual(index === 0 ? { action: 'stop' } : { value: 2 })
    }
    expect(chunks.at(-2)?.choices[0]?.finish_reason).toBe('tool_calls')
    expect(chunks.at(-1)).toMatchObject({ choices: [], usage: entry.usage })
    expect(completion(entry, 2)).toMatchObject({
      choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: entry.content, tool_calls: [{ function: { name: 'perform_action', arguments: '{"action":"stop"}' } }, { function: { name: 'other', arguments: '{"value":2}' } }] } }],
    })
  })

  it('finishes a plain reply with stop', () => {
    const [entry] = parseScript('[{"content":"hello"}]', 'plain.json')
    expect([...streamChunks(entry, { index: 0, chunkChars: 3 })].at(-1)?.choices[0]?.finish_reason).toBe('stop')
  })
})

describe('pCM speech', () => {
  it.each([['', 0.25], ['hello', 0.25], ['a'.repeat(40), 2], ['a'.repeat(1000), 30]])('encodes a valid bounded WAV for %s', (input, seconds) => {
    const wav = encodeSpeech(input)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ')
    expect(wav.readUInt16LE(20)).toBe(1)
    expect(wav.readUInt16LE(22)).toBe(1)
    expect(wav.readUInt32LE(24)).toBe(24000)
    expect(wav.readUInt16LE(34)).toBe(16)
    expect(wav.toString('ascii', 36, 40)).toBe('data')
    expect(wav.readUInt32LE(40) / 48000).toBe(seconds)
    expect(wav.readUInt32LE(4) + 8).toBe(wav.length)
    expect(wav.length).toBe(44 + seconds * 48000)
    expect(wav.subarray(44).every(byte => byte === 0)).toBe(true)
  })
})
