import { describe, expect, it } from 'vitest'

import { useLlmmarkerParser } from './llm-marker-parser'

/**
 * @example
 * const parser = useLlmmarkerParser({ onLiteral, onSpecial })
 */
describe('useLlmmarkerParser', () => {
  /**
   * @example
   * Plain model text is emitted as literal output.
   */
  it('parses pure literals', async () => {
    const collectedLiterals: string[] = []
    const parser = useLlmmarkerParser({
      onLiteral: (literal) => {
        collectedLiterals.push(literal)
      },
    })

    await parser.consume('Hello, world!')
    await parser.end()

    expect(collectedLiterals.join('')).toBe('Hello, world!')
  })

  /**
   * @example
   * `<|...|>` markers are emitted as special output.
   */
  it('parses special markers separately from literals', async () => {
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []
    const parser = useLlmmarkerParser({
      onLiteral: (literal) => {
        collectedLiterals.push(literal)
      },
      onSpecial: (special) => {
        collectedSpecials.push(special)
      },
    })

    await parser.consume('Hello <|ACT|> world')
    await parser.end()

    expect(collectedLiterals.join('')).toBe('Hello  world')
    expect(collectedSpecials).toEqual(['<|ACT|>'])
  })

  /**
   * @example
   * Unfinished markers are withheld instead of leaking into literal text.
   */
  it('does not include unfinished special markers', async () => {
    const collectedLiterals: string[] = []
    const collectedSpecials: string[] = []
    const parser = useLlmmarkerParser({
      onLiteral: (literal) => {
        collectedLiterals.push(literal)
      },
      onSpecial: (special) => {
        collectedSpecials.push(special)
      },
    })

    await parser.consume('<|unfinished')
    await parser.end()

    expect(collectedLiterals).toEqual([])
    expect(collectedSpecials).toEqual([])
  })

  describe('recoverCueNames', () => {
    const recoverCueNames = ['ACT', 'DELAY']

    async function run(chunks: string[], extra: { recoverCueNames?: string[] } = { recoverCueNames }) {
      const literals: string[] = []
      const specials: string[] = []
      let fullText: string | undefined
      const parser = useLlmmarkerParser({
        ...extra,
        onLiteral: (literal) => {
          literals.push(literal)
        },
        onSpecial: (special) => {
          specials.push(special)
        },
        onEnd: (text) => {
          fullText = text
        },
      })
      for (const chunk of chunks)
        await parser.consume(chunk)
      await parser.end()
      return { literal: literals.join(''), specials, fullText, recovered: parser.stats.recovered }
    }

    function splitsOf(text: string) {
      return Array.from({ length: text.length + 1 }, (_, i) => [text.slice(0, i), text.slice(i)])
    }

    it.each([
      ['[ACT happy] Hi', '<|ACT happy|>'],
      ['<ACT happy> Hi', '<|ACT happy|>'],
      ['<|ACT happy> Hi', '<|ACT happy|>'],
      ['<ACT happy|> Hi', '<|ACT happy|>'],
      ['[act happy] Hi', '<|ACT happy|>'],
      ['<delay 2> Hi', '<|DELAY 2|>'],
      ['[ACT] Hi', '<|ACT|>'],
      ['[ACT [x] y] Hi', '<|ACT [x] y|>'],
      ['[ACT {"a":[1]}] Hi', '<|ACT {"a":[1]}|>'],
    ])('recovers %j at every chunk split', async (input, special) => {
      for (const [a, b] of splitsOf(input)) {
        const result = await run([a, b])
        expect(result.specials, `split at ${a.length}`).toEqual([special])
        expect(result.literal, `split at ${a.length}`).toBe(' Hi')
        expect(result.recovered).toBe(1)
      }
    })

    it('recovers one character per chunk', async () => {
      const result = await run([...'Yo [ACT happy] Hi'])
      expect(result).toMatchObject({ literal: 'Yo  Hi', specials: ['<|ACT happy|>'], recovered: 1 })
    })

    it('leaves non-cue brackets and longer names literal', async () => {
      for (const input of ['[note] text', '[ACTION] go', '<ACTOR> hi', '<b>bold</b>', 'a < b and [1]', '[ACT', '<|AC']) {
        for (const [a, b] of splitsOf(input)) {
          const result = await run([a, b])
          expect(result.literal, input).toBe(input)
          expect(result.specials).toEqual([])
          expect(result.recovered).toBe(0)
        }
      }
    })

    it('keeps well-formed markers untouched, including long JSON bodies', async () => {
      const long = `<|ACT {"emotion":{"name":"happy","intensity":1},"motion":"wave","note":"${'x'.repeat(80)}"}|>`
      const result = await run(['Hi <|ACT happy|> ', long, '<|STICKER heart|>', '<|DELAY 1|>'])
      expect(result.specials).toEqual(['<|ACT happy|>', long, '<|STICKER heart|>', '<|DELAY 1|>'])
      expect(result.literal).toBe('Hi  ')
      expect(result.recovered).toBe(0)
    })

    it('recovers when the closer ends at exactly 63 and 64 characters but not 65', async () => {
      for (const [length, ok] of [[63, true], [64, true], [65, false]] as const) {
        const body = 'a'.repeat(length - 6)
        const input = `[ACT ${body}] tail`
        for (const [a, b] of splitsOf(input)) {
          const result = await run([a, b])
          if (ok) {
            expect(result.specials).toEqual([`<|ACT ${body}|>`])
            expect(result.literal).toBe(' tail')
          }
          else {
            expect(result.specials).toEqual([])
            expect(result.literal).toBe(input)
          }
        }
      }
    })

    it('does not let an unclosed opener swallow later prose or markers', async () => {
      const prose = ' and then I kept talking for a good while without ever closing it, '
      const result = await run(['<|ACT happy', prose, 'really. <|ACT sad|> then [ACT calm] fin'])
      expect(result.specials).toEqual(['<|ACT sad|>', '<|ACT calm|>'])
      expect(result.literal).toBe(`<|ACT happy${prose}really.  then  fin`)
      expect(result.recovered).toBe(1)
    })

    it('recovers <|ACT happy> followed by prose and still finds the later marker', async () => {
      const result = await run(['<|ACT happy> Hello there. ', '<|DELAY 1|> More.'])
      expect(result.specials).toEqual(['<|ACT happy|>', '<|DELAY 1|>'])
      expect(result.literal).toBe(' Hello there.  More.')
    })

    it('flushes an unterminated near-miss as literal at the end of the stream', async () => {
      const result = await run(['Hi [ACT hap', 'py'])
      expect(result).toMatchObject({ literal: 'Hi [ACT happy', specials: [] })
    })

    it('recovers after escaped-form normalization', async () => {
      const result = await run(['[ACT happy] Hi <{\'|\'}ACT sad{\'|\'}> ', '<{\'|\'}ACT calm{\'|\'}>'])
      expect(result.specials).toEqual(['<|ACT happy|>', '<|ACT sad|>', '<|ACT calm|>'])
      expect(result.literal).toBe(' Hi  ')
      expect(result.recovered).toBe(1)
    })

    it('handles CJK text around and inside cues', async () => {
      const input = '你好[ACT 开心]世界<DELAY 2>再见'
      for (const [a, b] of splitsOf(input)) {
        const result = await run([a, b])
        expect(result.specials).toEqual(['<|ACT 开心|>', '<|DELAY 2|>'])
        expect(result.literal).toBe('你好世界再见')
      }
    })

    it('removes recovered markers from the full text passed to onEnd', async () => {
      const result = await run(['Hi [ACT ha', 'ppy] there <|DELAY 1|> [aside] ok'])
      expect(result.fullText).toBe('Hi  there <|DELAY 1|> [aside] ok')
      expect(result.recovered).toBe(1)
    })

    it('keeps the original output byte for byte when the option is unset', async () => {
      const input = 'Hi [ACT happy] <ACT x> <|ACT y> [aside] <|ACT z|> end'
      const result = await run(input.split(''), {})
      // Without the option the unclosed `<|ACT y>` swallows everything up to the next `|>`.
      expect(result.literal).toBe('Hi [ACT happy] <ACT x>  end')
      expect(result.specials).toEqual(['<|ACT y> [aside] <|ACT z|>'])
      expect(result.fullText).toBe(input)
      expect(result.recovered).toBe(0)

      const plain = await run(['Hello <|ACT|> world <|unfinished'], {})
      expect(plain).toMatchObject({ literal: 'Hello  world ', specials: ['<|ACT|>'], fullText: 'Hello <|ACT|> world <|unfinished' })
    })
  })
})
