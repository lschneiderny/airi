// packages/pipelines-audio/src/processors/tts-chunker.test.ts

import type { TextSegment, TextToken } from '../types'
import type { TtsInputChunk, TtsInputChunkOptions } from './tts-chunker'

import { describe, expect, it } from 'vitest'

import { chunkTtsInput, createTtsSegmentStream, isProbablyAngleTag, processNarrative, TTS_FLUSH_INSTRUCTION, TTS_SPECIAL_TOKEN } from './tts-chunker'

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

function token(type: TextToken['type'], value: string, sequence: number): TextToken {
  return { type, value, streamId: 'stream', intentId: 'intent', sequence, createdAt: 0 }
}

/** Streams `parts` as tokens: `<|...|>` parts become specials, everything else a literal delta. */
async function collectFullSegments(parts: string[], options?: TtsInputChunkOptions) {
  const tokens = new ReadableStream<TextToken>({
    start(controller) {
      parts.forEach((part, index) => controller.enqueue(token(part.startsWith('<|') ? 'special' : 'literal', part, index)))
      controller.close()
    },
  })
  const segments: TextSegment[] = []
  const reader = createTtsSegmentStream(tokens, { streamId: 'stream', intentId: 'intent' }, options).getReader()
  while (true) {
    const { value, done } = await reader.read()
    if (done)
      return segments
    segments.push(value)
  }
}

async function collectSegments(parts: string[], options?: TtsInputChunkOptions): Promise<Pick<TextSegment, 'text' | 'special' | 'reason'>[]> {
  return (await collectFullSegments(parts, options)).map(({ text, special, reason }) => ({ text, special, reason }))
}

describe('createTtsSegmentStream BREAK boundary', () => {
  // The space after the comma puts text in the buffer, so any special already ended the segment there.
  it('ends the segment at a BREAK after buffered text, as every special does', async () => {
    expect(await collectSegments(['Hi there, ', '<|BREAK|>', ' ok.'])).toEqual([
      { text: 'Hi there,', special: '<|BREAK|>', reason: 'special' },
      { text: 'ok.', special: null, reason: 'hard' },
    ])
  })

  // ROOT CAUSE:
  //
  // Text held at soft punctuation stays pending when the buffer is empty, so a special that follows it
  // directly yields an empty segment and the held text joins the text after it. For a BREAK that would
  // speak "Hi there," after the pause.
  it('keeps text held at soft punctuation before a BREAK that follows it directly', async () => {
    expect(await collectSegments(['Hi there,', '<|BREAK 2|>', ' ok.'])).toEqual([
      { text: 'Hi there,', special: '<|BREAK 2|>', reason: 'special' },
      { text: 'ok.', special: null, reason: 'hard' },
    ])
  })

  it('leaves other specials after soft punctuation as they were', async () => {
    expect(await collectSegments(['Hi there,', '<|ACT happy|>', ' ok.'])).toEqual([
      { text: '', special: '<|ACT happy|>', reason: 'special' },
      { text: 'Hi there, ok.', special: null, reason: 'hard' },
    ])
  })

  it('ends the segment at a malformed BREAK too, which the controller later rejects', async () => {
    expect(await collectSegments(['Hi there,', '<|BREAK x|>', ' ok.'])).toEqual([
      { text: 'Hi there,', special: '<|BREAK x|>', reason: 'special' },
      { text: 'ok.', special: null, reason: 'hard' },
    ])
  })
})

describe('createTtsSegmentStream DELAY boundary', () => {
  // A valid DELAY pauses the speech track like a BREAK, so text written before it must be spoken before it.
  it('keeps text held at soft punctuation before a valid DELAY that follows it directly', async () => {
    expect(await collectSegments(['Hi there,', '<|DELAY 2|>', ' ok.'])).toEqual([
      { text: 'Hi there,', special: '<|DELAY 2|>', reason: 'special' },
      { text: 'ok.', special: null, reason: 'hard' },
    ])
  })

  it('treats a malformed DELAY, which pauses nothing, as any other special', async () => {
    expect(await collectSegments(['Hi there,', '<|DELAY soon|>', ' ok.'])).toEqual([
      { text: '', special: '<|DELAY soon|>', reason: 'special' },
      { text: 'Hi there, ok.', special: null, reason: 'hard' },
    ])
  })
})

describe('createTtsSegmentStream ASCII faces', () => {
  const strip = { stripAsciiFaces: true }

  it('strips a face split across deltas even where boost would end the segment at its colon', async () => {
    expect(await collectSegments(['that is so cute of you :', '3 bye'], strip)).toEqual([
      { text: 'that is so cute of you bye', special: null, reason: 'flush' },
    ])
  })

  it('speaks faces unchanged without the option', async () => {
    expect(await collectSegments(['love you <3'])).toEqual([
      { text: 'love you <3', special: null, reason: 'flush' },
    ])
  })

  it.each([
    [['so sorry about that one >', '.< really'], 'so sorry about that one really'],
    [['I am so tired today ;', '_; ok'], 'I am so tired today ok'],
    [['love you <', '3'], 'love you'],
  ])('keeps the face in %j whole and strips it', async (parts, text) => {
    expect((await collectSegments(parts, strip)).map(segment => segment.text)).toEqual([text])
  })

  it('keeps the special of a face before it', async () => {
    expect(await collectSegments(['love you :3', '<|ACT happy|>', ' bye'], strip)).toEqual([
      { text: 'love you', special: '<|ACT happy|>', reason: 'special' },
      { text: 'bye', special: null, reason: 'flush' },
    ])
  })

  // ROOT CAUSE:
  //
  // A segment that was empty after face stripping was skipped with its display text, so a face that
  // formed its own segment never reached the caption while the chat bubble kept it.
  it.each([
    ['at the end of a reply', ['Okay. :3'], [{ text: 'Okay.' }, { text: '', displayText: ':3', special: null }]],
    ['before a special', ['Okay. ^^', '<|BREAK|>', ' bye.'], [{ text: 'Okay.' }, { text: '', displayText: '^^', special: '<|BREAK|>' }, { text: 'bye.' }]],
    ['as the whole reply', ['<3'], [{ text: '', displayText: '<3', special: null }]],
  ])('emits a face alone in a segment %s with display text and nothing to speak', async (_label, parts, expected) => {
    expect(await collectFullSegments(parts, strip)).toMatchObject(expected)
  })

  it('still skips a segment that is empty without any face', async () => {
    expect(await collectSegments(['Okay.   '], strip)).toEqual([
      { text: 'Okay.', special: null, reason: 'hard' },
    ])
  })

  it.each([
    [['We meet at 10:30 and then talk about everything, C:D drive']],
    [['We meet at 10:', '30 and then x^^y and :3c later']],
  ])('splits %j, which only looks like faces, exactly as without the option', async (parts) => {
    const stripped = await collectSegments(parts, strip)

    expect(stripped).toEqual(await collectSegments(parts))
    expect(stripped.map(segment => segment.text).join(' ')).toContain('10:')
  })
})

describe('chunkTtsInput length limit', () => {
  async function collectReasonsAndText(text: string) {
    return (await collectChunks(text)).map(chunk => [chunk.reason, chunk.text])
  }

  // ROOT CAUSE:
  //
  // The length limit ended a chunk at any soft punctuation, also at the Chinese `、` between list items. So
  // 网络、地址解析 became two TTS requests, and the voice paused in the middle of the list.
  // Each case opens with two sentences, so the boost chunks end before the length limit decides.
  it('does not end a chunk at a Chinese list separator', async () => {
    expect(await collectReasonsAndText('我这里只能看到工具返回的错误：连接 Home Assistant 地址时，网络请求失败。它没有提供更具体的原因或 HTTP 状态码，所以我没法判断究竟是网络、地址解析还是服务端暂时不可用。')).toEqual([
      ['boost', '我这里只能看到工具返回的错误：'],
      ['boost', '连接 Home Assistant 地址时，'],
      ['hard', '网络请求失败。'],
      ['limit', '它没有提供更具体的原因或 HTTP 状态码，'],
      ['hard', '所以我没法判断究竟是网络、地址解析还是服务端暂时不可用。'],
    ])
  })

  it('ends a chunk at a Japanese comma', async () => {
    expect(await collectReasonsAndText('今日は晴れです。散歩しました。公園へ行って、少し散歩してから、カフェでコーヒーを飲んで、本を読みました。')).toEqual([
      ['hard', '今日は晴れです。'],
      ['hard', '散歩しました。'],
      ['limit', '公園へ行って、少し散歩してから、'],
      ['hard', 'カフェでコーヒーを飲んで、本を読みました。'],
    ])
  })

  it('ends a chunk at a Chinese list separator after twice the word limit', async () => {
    expect(await collectReasonsAndText('这是第一句。这是第二句。支持的格式有 PNG、JPEG、WebP、GIF、AVIF、BMP、TIFF、SVG、HEIC、ICO、PSD、RAW、EXR、HDR、TGA、DDS、JXL、QOI、PCX、WBMP、XBM、XPM、CUR、ANI、EPS、AI、PDF、DNG、CR2、NEF 等等。')).toEqual([
      ['hard', '这是第一句。'],
      ['hard', '这是第二句。'],
      ['limit', '支持的格式有 PNG、JPEG、WebP、GIF、AVIF、BMP、TIFF、SVG、HEIC、ICO、PSD、RAW、EXR、HDR、TGA、DDS、JXL、QOI、PCX、WBMP、'],
      ['hard', 'XBM、XPM、CUR、ANI、EPS、AI、PDF、DNG、CR2、NEF 等等。'],
    ])
  })
})

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
