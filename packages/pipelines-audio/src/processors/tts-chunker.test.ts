// packages/pipelines-audio/src/processors/tts-chunker.test.ts

import type { TtsInputChunk } from './tts-chunker'

import { describe, expect, it } from 'vitest'

import { chunkTtsInput, isProbablyAngleTag, processNarrative, TTS_FLUSH_INSTRUCTION, TTS_SPECIAL_TOKEN } from './tts-chunker'

async function collectChunkText(input: string) {
  const chunks: string[] = []

  for await (const chunk of chunkTtsInput(input))
    chunks.push(chunk.text)

  return chunks
}

async function collectChunks(text: string): Promise<TtsInputChunk[]> {
  const chunks: TtsInputChunk[] = []
  for await (const chunk of chunkTtsInput(text))
    chunks.push(chunk)
  return chunks
}

describe('chunkTtsInput boost', () => {
  it('preserves pre-change chunk bytes and sentence identity across mid-sentence markers', async () => {
    const chunks = await collectChunks(`One two three four${TTS_SPECIAL_TOKEN} five six. Seven eight nine ten${TTS_SPECIAL_TOKEN} eleven twelve.`)
    // Captured from the unchanged chunker before sentence metadata was added.
    expect(chunks.map(chunk => chunk.text)).toEqual([
      'One two three four',
      'five six.',
      'Seven eight nine ten',
      'eleven twelve.',
    ])
    expect(chunks.map(chunk => chunk.sentenceIndex)).toEqual([0, 0, 1, 1])
    expect(chunks.map(chunk => chunk.sentenceStart)).toEqual([true, false, true, false])
  })

  it('does not consume sentence starts for empty input or marker-only chunks', async () => {
    expect(await collectChunks('')).toEqual([])
    const chunks = await collectChunks(`${TTS_SPECIAL_TOKEN}${TTS_SPECIAL_TOKEN}Hello.`)
    expect(chunks.map(chunk => chunk.sentenceIndex)).toEqual([0, 0, 0])
    expect(chunks.map(chunk => chunk.sentenceStart)).toEqual([false, false, true])
  })

  it('advances after flush, ellipsis, and CJK sentence endings and resets per input', async () => {
    const chunks = await collectChunks(`Tail${TTS_FLUSH_INSTRUCTION}Next…你好。好！对？End`)
    expect(chunks.map(chunk => chunk.sentenceIndex)).toEqual([0, 1, 2, 3, 4, 5])
    expect(chunks.every(chunk => chunk.sentenceStart)).toBe(true)
    expect((await collectChunks('Fresh'))[0]).toMatchObject({ sentenceIndex: 0, sentenceStart: true })
  })

  // ROOT CAUSE:
  //
  // Boost chunks ended at any soft punctuation regardless of length, so "嗯，那就好，" became
  // "嗯，" plus "那就好，". A TTS request costs the same however short its text, so those
  // fragments delayed the audio boost exists to bring forward.
  it('does not yield boost fragments shorter than the minimum word count', async () => {
    const chunks = await collectChunks('嗯，那就好，听你说没事我心里就踏实了。倒是你，现在都两点了，')

    expect(chunks[0]?.text).not.toBe('嗯，')
    expect(chunks[0]?.text.startsWith('嗯，那就好，')).toBe(true)
    for (const chunk of chunks.filter(chunk => chunk.reason === 'boost'))
      expect(chunk.words).toBeGreaterThanOrEqual(4)
  })

  it('still yields a long opening clause early at soft punctuation', async () => {
    const chunks = await collectChunks('I really want to tell you something, and then I will say more.')

    expect(chunks[0]).toMatchObject({ text: 'I really want to tell you something,', reason: 'boost' })
  })
})

describe('tTS Chunker Logic Cleanup', () => {
  describe('isProbablyAngleTag Heuristics', () => {
    it('should identify narrative tags', () => {
      expect(isProbablyAngleTag(0, '<sigh>')).toBe(true)
    })

    it('should skip code patterns like generics', () => {
      expect(isProbablyAngleTag(4, 'List<String>')).toBe(false)
      expect(isProbablyAngleTag(1, 'x<y')).toBe(false)
    })
  })

  describe('processNarrative Function', () => {
    const options = { stripNarrative: true }

    it('should strip standard bracketed narrative', () => {
      expect(processNarrative('Hello [sighs] world', options)).toBe('Hello  world')
      expect(processNarrative('<<tag>>', options)).toBe('')
    })

    it('should restore stripping for CJK brackets', () => {
      expect(processNarrative('你好（叹气）世界', options)).toBe('你好世界')
      expect(processNarrative('【动作】你好', options)).toBe('你好')
    })

    it('should fix asterisk bullet leakage', () => {
      expect(processNarrative('* item 1', options)).toBe('* item 1')
      expect(processNarrative('*bold text*', options)).toBe('')
      expect(processNarrative('a*b', options)).toBe('a*b')
    })

    it('should handle complex nesting correctly', () => {
      expect(processNarrative('Normal (nested [action]) text', options)).toBe('Normal  text')
    })

    it('should handle open bracket correctly', () => {
      expect(processNarrative('Version (beta', options)).toBe('Version (beta')
    })

    it('should handle valid narrative tag', () => {
      expect(processNarrative('Hello,<laugh>', options)).toBe('Hello,')
      expect(processNarrative('Hello<laugh>', options)).toBe('Hello')
      expect(processNarrative('<laughs>Hello', options)).toBe('Hello')
      expect(processNarrative('Hello<laughs>', options)).toBe('Hello')
      expect(processNarrative('你好<laughs>', options)).toBe('你好')
      expect(processNarrative('List<T>', options)).toBe('List<T>')
    })

    it('should preserve code literals in keepNarrativeText mode', () => {
      const keepOptions = { stripNarrative: true, keepNarrativeText: true }
      expect(processNarrative('Value is List<String> [action]', keepOptions)).toContain('List<String>')
      expect(processNarrative('x < y (sigh)', keepOptions)).toContain('x < y')
      expect(processNarrative('price<limit', keepOptions)).toContain('price<limit')
    })

    it('should be case-insensitive for narrative tags', () => {
      const options = { stripNarrative: true }
      expect(processNarrative('Hello<LAUGHs>', options)).toBe('Hello')
      expect(processNarrative('abc<Action>', options)).toBe('abc')
      expect(processNarrative('List<String>', options)).toBe('List<String>')
    })
  })

  describe('isProbablyAngleTag Stream Prefix Handling', () => {
    it('should identify partial prefixes of narrative keywords', () => {
      expect(isProbablyAngleTag(5, 'hello<sm')).toBe(true)
      expect(isProbablyAngleTag(5, 'hello<la')).toBe(true) // laugh 的前缀
    })

    it('should not identify non-narrative prefixes as tags', () => {
      expect(isProbablyAngleTag(4, 'List<Str')).toBe(false)
    })
  })

  describe('edge Cases test', () => {
    it('should not treat single-letter operands as narrative prefixes', () => {
      expect(isProbablyAngleTag(1, 'a<b')).toBe(false)
      expect(isProbablyAngleTag(1, 'x<s')).toBe(false)
    })

    it('should support non-CJK Unicode letters as tag context', () => {
      expect(isProbablyAngleTag(4, 'café<laugh>')).toBe(true)
      expect(isProbablyAngleTag(6, 'привет<sigh>')).toBe(true)
    })
  })

  describe('chunkTtsInput grapheme preservation', () => {
    // ROOT CAUSE:
    //
    // CRLF is one grapheme cluster, but the hard punctuation set contains
    // only separate CR and LF characters. Normalize CRLF before matching
    // punctuation so Windows line endings end the chunk.
    // https://github.com/moeru-ai/airi/pull/2414
    it('treats CRLF as a hard chunk boundary (Issue #2366)', async () => {
      expect(await collectChunkText('abc\r\ndef')).toEqual(['abc', 'def'])
    })

    // ROOT CAUSE:
    //
    // `readGraphemeClusters` returns multi-code-unit grapheme strings.
    // The old `value.length > 1` guard discarded them.
    //
    // We fixed this by preserving each returned cluster.
    // This keeps Thai combining marks intact.
    //
    // https://github.com/moeru-ai/airi/issues/2366
    it('preserves Thai combining clusters while chunking (Issue #2366)', async () => {
      const input = 'ดึกป่านนี้แล้วยังจะหาเรื่องกินอีกนะคะเนี่ย!'

      const chunks = await collectChunkText(input)

      expect(chunks.join('')).toBe(input)
    })

    it('preserves emoji grapheme clusters while chunking', async () => {
      const input = '👩‍💻👍🏽!'

      const chunks = await collectChunkText(input)

      expect(chunks.join('')).toBe(input)
    })
  })
})
