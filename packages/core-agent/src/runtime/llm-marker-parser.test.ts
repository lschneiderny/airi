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

    async function run(chunks: string[], extra: { recoverCueNames?: string[], acceptRecovered?: boolean } = { recoverCueNames }) {
      const literals: string[] = []
      const specials: string[] = []
      let fullText: string | undefined
      const parser = useLlmmarkerParser({
        recoverCueNames: extra.recoverCueNames,
        onLiteral: (literal) => {
          literals.push(literal)
        },
        onSpecial: (special, recovery) => {
          if (recovery && extra.acceptRecovered === false)
            return false
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
      for (const input of ['[note] text', '[ACTION] go', '<ACTOR> hi', '<b>bold</b>', 'a < b and [1]', '[ACT']) {
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

    it('drops an unterminated canonical tail at the end of the stream like the unset parser', async () => {
      for (const input of ['Hi <|ACT happy', 'Hi <|DELAY 1', 'Hi <|AC', 'Hi <|ACT {"emotion":"ha']) {
        for (const [a, b] of splitsOf(input)) {
          const result = await run([a, b])
          const unset = await run([a, b], {})
          expect(result, `${input} split at ${a.length}`).toMatchObject({ literal: 'Hi ', specials: [], fullText: input, recovered: 0 })
          expect(result.literal).toBe(unset.literal)
        }
      }
    })

    it('does not let an unclosed JSON opener swallow later prose or markers', async () => {
      const opener = '<|ACT {"emotion":"happy"}'
      const prose = ' Hello there, it is so good to see you again today, really it is. '
      const input = `${opener}${prose}<|DELAY 1|> bye`
      for (const [a, b] of splitsOf(input)) {
        const result = await run([a, b])
        expect(result.specials, `split at ${a.length}`).toEqual(['<|DELAY 1|>'])
        expect(result.literal, `split at ${a.length}`).toBe(`${opener}${prose} bye`)
        expect(result.recovered).toBe(0)
      }
    })

    it('speaks the rest of the reply when a JSON opener never gets its closer', async () => {
      const input = '<|ACT {"emotion":"happy"} Hello there, it is so good to see you again today.'
      for (const [a, b] of splitsOf(input)) {
        const result = await run([a, b])
        expect(result, `split at ${a.length}`).toMatchObject({ literal: input, specials: [], fullText: input, recovered: 0 })
      }
    })

    it.each([
      ['<|ACT {"emotion":"happy","note":"a > b"}|> Hi', '<|ACT {"emotion":"happy","note":"a > b"}|>', 0],
      ['<ACT {"note":"}>"}> Hi', '<|ACT {"note":"}>"}|>', 1],
      ['[ACT {"note":"x ] \\" }"}] Hi', '<|ACT {"note":"x ] \\" }"}|>', 1],
    ])('closes the JSON body of %j only after its balanced brace', async (input, special, recovered) => {
      for (const [a, b] of splitsOf(input)) {
        const result = await run([a, b])
        expect(result.specials, `split at ${a.length}`).toEqual([special])
        expect(result.literal, `split at ${a.length}`).toBe(' Hi')
        expect(result.recovered).toBe(recovered)
      }
    })

    it('requires the closer within 64 characters after the balanced brace', async () => {
      for (const [gap, ok] of [[62, true], [63, false]] as const) {
        const body = `{"a":1}${'x'.repeat(gap)}`
        const input = `<ACT ${body}|> tail`
        for (const [a, b] of splitsOf(input)) {
          const result = await run([a, b])
          if (ok) {
            expect(result.specials, `gap ${gap} split at ${a.length}`).toEqual([`<|ACT ${body}|>`])
            expect(result.literal).toBe(' tail')
          }
          else {
            expect(result.specials, `gap ${gap} split at ${a.length}`).toEqual([])
            expect(result.literal).toBe(input)
          }
        }
      }
    })

    it('flushes a JSON body that does not balance within 1024 characters', async () => {
      const head = `<|ACT {"note":"${'x'.repeat(1100)}`
      const input = `${head} <|DELAY 1|> bye`
      for (const [a, b] of splitsOf(input)) {
        const result = await run([a, b])
        expect(result.specials, `split at ${a.length}`).toEqual(['<|DELAY 1|>'])
        expect(result.literal, `split at ${a.length}`).toBe(`${head}  bye`)
      }
    })

    it('speaks the raw text of a recovered cue that onSpecial rejects', async () => {
      const input = 'Hi [ACT happy] there <ACT sad> ok <|ACT calm|>'
      for (const [a, b] of splitsOf(input)) {
        const result = await run([a, b], { recoverCueNames, acceptRecovered: false })
        expect(result, `split at ${a.length}`).toMatchObject({
          literal: 'Hi [ACT happy] there <ACT sad> ok ',
          specials: ['<|ACT calm|>'],
          fullText: input,
          recovered: 0,
        })
      }
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

    it.each([
      ['<|ACT {"emotion":"happy"|> Hi', '<|ACT {"emotion":"happy"|>', 0],
      ['<|ACT {"emotion":"happy}|> Hi', '<|ACT {"emotion":"happy}|>', 0],
      ['<|ACT {"emotion":{"name":"happy"|> Hi', '<|ACT {"emotion":{"name":"happy"|>', 0],
      ['[ACT {"emotion":"happy"] Hi', '<|ACT {"emotion":"happy"|>', 1],
      ['<ACT {"emotion":"happy"> Hi', '<|ACT {"emotion":"happy"|>', 1],
      ['<ACT {"note":"a > b"> Hi', '<|ACT {"note":"a > b"|>', 1],
    ])('closes the malformed JSON body of %j at its closer', async (input, special, recovered) => {
      for (const [a, b] of splitsOf(input)) {
        const result = await run([a, b])
        expect(result.specials, `split at ${a.length}`).toEqual([special])
        expect(result.literal, `split at ${a.length}`).toBe(' Hi')
        expect(result.recovered).toBe(recovered)
      }
    })

    it('keeps speaking and parsing after a malformed but closed JSON marker', async () => {
      const result = await run(['<|ACT {"emotion":"happy"|> Hello there ', '<|DELAY 1|> bye'])
      expect(result.specials).toEqual(['<|ACT {"emotion":"happy"|>', '<|DELAY 1|>'])
      expect(result.literal).toBe(' Hello there  bye')
    })

    it('closes a JSON body with an unterminated string once 64 characters follow its closer', async () => {
      const prose = ' Hello there, it is so good to see you again today, really it is, my friend.'
      const result = await run(['<|ACT {"emotion":"happy}|>', prose])
      expect(result.specials).toEqual(['<|ACT {"emotion":"happy}|>'])
      expect(result.literal).toBe(prose)
    })

    it.each([
      ['<|ACT happy and more <|DELAY 1|> bye', '<|ACT happy and more  bye', ['<|DELAY 1|>'], 0],
      ['<|ACT {"emotion":"happy"} and more <|DELAY 1|> bye', '<|ACT {"emotion":"happy"} and more  bye', ['<|DELAY 1|>'], 0],
      ['<ACT happy and more <ACT sad> bye', '<ACT happy and more  bye', ['<|ACT sad|>'], 1],
      ['[ACT {"emotion":"happy" and more [DELAY 1] bye', '[ACT {"emotion":"happy" and more  bye', ['<|DELAY 1|>'], 1],
    ])('does not let the closer of a later marker close the unclosed body of %j', async (input, literal, specials, recovered) => {
      for (const [a, b] of splitsOf(input)) {
        const result = await run([a, b])
        expect(result.specials, `split at ${a.length}`).toEqual(specials)
        expect(result.literal, `split at ${a.length}`).toBe(literal)
        expect(result.recovered).toBe(recovered)
      }
    })

    describe('malformed marker property', () => {
      // mulberry32: a seeded PRNG, so the corpus is identical on every run.
      function createRandom(seed: number) {
        let state = seed
        return () => {
          state = (state + 0x6D2B79F5) | 0
          let t = Math.imul(state ^ (state >>> 15), state | 1)
          t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t
          return ((t ^ (t >>> 14)) >>> 0) / 4294967296
        }
      }

      const forms = [
        { open: '<|', closers: ['|>', '>', ''] },
        { open: '<', closers: ['>', '|>', ''] },
        { open: '[', closers: [']', ''] },
      ]
      const names = ['ACT', 'act', 'Act', 'DELAY']
      const jsonBodies = ['{"emotion":"happy"}', '{"emotion":"开心","intensity":0.8}', '{"emotion":{"name":"sad"},"motion":"wave"}', '{"note":"a b"}']
      const bareBodies = ['happy', '开心', '2', 'sad and calm', '']
      const inserts = ['>', ']', '|>', '开心', '}', '{', '"']

      function createCorpus(seed: number, perForm: number) {
        const random = createRandom(seed)
        const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)]!
        const insertAt = (text: string, index: number, value: string) => `${text.slice(0, index)}${value}${text.slice(index)}`
        const corpus: { open: string, closer: string, marker: string, wellFormed: boolean }[] = []

        for (const form of forms) {
          for (let i = 0; i < perForm; i++) {
            const json = random() < 0.6
            let body = json ? pick(jsonBodies) : pick(bareBodies)
            if (json) {
              if (random() < 0.4)
                body = body.slice(0, body.lastIndexOf('}')) + body.slice(body.lastIndexOf('}') + 1)
              if (random() < 0.3) {
                const quotes = [...body.matchAll(/"/g)].map(match => match.index)
                const quote = pick(quotes)
                body = body.slice(0, quote) + body.slice(quote + 1)
              }
              if (random() < 0.2)
                body = `{${body}`
              if (random() < 0.2)
                body = `${body}}`
              if (random() < 0.5) {
                // Right after a quote, which is usually inside a JSON string.
                const quotes = [...body.matchAll(/"/g)].map(match => match.index)
                if (quotes.length)
                  body = insertAt(body, pick(quotes) + 1, pick(inserts))
              }
            }
            else if (body && random() < 0.4) {
              body = insertAt(body, Math.floor(random() * (body.length + 1)), pick(inserts))
            }
            // A bare body needs a space after the name, otherwise the name is not a cue name (`ACThappy`).
            const separator = json && random() < 0.3 ? '' : ' '
            const closer = pick(form.closers)
            const wellFormed = form.open === '<|' && closer === '|>' && (json ? jsonBodies.includes(body) : bareBodies.includes(body))
            corpus.push({ open: form.open, closer, wellFormed, marker: `${pick(['', 'Hi ', '你好', 'ok. '])}${form.open}${pick(names)}${separator}${body}${closer}` })
          }
        }
        return corpus
      }

      it('never swallows the prose or the marker after a malformed cue, at every chunk split', { timeout: 600_000 }, async () => {
        const corpus = createCorpus(20261020, 600)
        const random = createRandom(5)
        const malformed = corpus.filter(({ wellFormed }) => !wellFormed)
        for (const form of forms)
          expect(malformed.filter(({ open }) => open === form.open).length).toBeGreaterThanOrEqual(500)

        const failures: string[] = []
        for (const { open, closer, marker } of malformed) {
          const gap = ['', ' ', '世界'][Math.floor(random() * 3)]!
          for (const withDelay of [true, false]) {
            const input = `${marker}${gap}SENTINEL${withDelay ? ' <|DELAY 1|> bye' : ''}`
            // An unterminated canonical `<|NAME ...` tail at the end of the stream is dropped by design.
            const droppedTail = open === '<|' && closer === '' && !withDelay
            for (const [a, b] of splitsOf(input)) {
              const result = await run([a, b])
              const swallowed = result.specials.some(special => special.includes('SENTINEL'))
              const spoken = result.literal.split('SENTINEL').length === 2
              const delayed = !withDelay || (result.specials.at(-1) === '<|DELAY 1|>' && result.literal.endsWith(' bye'))
              if (swallowed || (!droppedTail && (!spoken || !delayed)))
                failures.push(`${JSON.stringify([a, b])} -> ${JSON.stringify({ literal: result.literal, specials: result.specials })}`)
            }
          }
        }
        expect(failures.length, failures.slice(0, 20).join('\n')).toBe(0)
      })
    })
  })
  // A flush emits the held text and waits for its handler. Parsing continues after it.
  it('emits the held-back end of the text on flush, and keeps parsing after it', async () => {
    const collectedLiterals: string[] = []
    const parser = useLlmmarkerParser({
      onLiteral: (literal) => {
        collectedLiterals.push(literal)
      },
    })

    await parser.consume('查曼谷和上海未来三天的天气。')
    await parser.flush()
    expect(collectedLiterals.join('')).toBe('查曼谷和上海未来三天的天气。')

    await parser.consume('第 1/3 步完成。')
    await parser.end()
    expect(collectedLiterals.join('')).toBe('查曼谷和上海未来三天的天气。第 1/3 步完成。')
  })
  // Near-miss recovery holds a cue opener back. A flush ends the text of a model step, so a partial opener cannot
  // complete and is emitted as text. An opened cue stays held for the next text or the end of the stream.
  it('flushes a partial cue opener as text and keeps an opened cue during recovery', async () => {
    const literals: string[] = []
    const specials: string[] = []
    const parser = useLlmmarkerParser({
      recoverCueNames: ['ACT'],
      onLiteral: (literal) => {
        literals.push(literal)
      },
      onSpecial: (special) => {
        specials.push(special)
      },
    })

    await parser.consume('Hi [AC')
    await parser.flush()
    expect(literals.join('')).toBe('Hi [AC')

    await parser.consume(' then [ACT happy')
    await parser.flush()
    expect(literals.join('')).toBe('Hi [AC then ')

    await parser.consume(']')
    await parser.end()
    expect(specials).toEqual(['<|ACT happy|>'])
    expect(literals.join('')).toBe('Hi [AC then ')
  })
})
