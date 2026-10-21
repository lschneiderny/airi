import { describe, expect, it } from 'vitest'

import { useLlmmarkerParser } from './llm-marker-parser'
import { acceptsRecoveredCue, stripsRecoveredCue } from './recovered-cue'

describe('acceptsRecoveredCue', () => {
  // Wired like the chat runtime: a rejected recovered cue is spoken as the text the model wrote.
  async function run(text: string) {
    const literals: string[] = []
    const specials: string[] = []
    let fullText: string | undefined
    const parser = useLlmmarkerParser({
      recoverCueNames: ['ACT', 'DELAY'],
      onLiteral: (literal) => {
        literals.push(literal)
      },
      onSpecial: (special, recovery) => {
        if (recovery && !acceptsRecoveredCue(special, recovery.raw))
          return false
        specials.push(special)
      },
      onEnd: (value) => {
        fullText = value
      },
    })
    await parser.consume(text)
    await parser.end()
    return { literal: literals.join(''), specials, fullText, recovered: parser.stats.recovered }
  }

  it.each([
    'We start [Act 2] now',
    'In [act two] the hero returns.',
    'An [ACT of kindness] matters.',
    'I will [act] it out.',
    'Hmm [ACT banana] ok',
    'Wait [DELAY soon] ok',
    'Wait [delay -1] ok',
    'Odd [ACT {"note":"x"}] ok',
    'Odd [ACT {"emotion":"happy"] ok',
  ])('keeps %j spoken verbatim and does not count it as recovered', async (text) => {
    expect(await run(text)).toEqual({ literal: text, specials: [], fullText: text, recovered: 0 })
  })

  it.each([
    ['[ACT happy] Hi', '<|ACT happy|>'],
    ['<act Sad slight> Hi', '<|ACT Sad slight|>'],
    ['[ACT:flustered] Hi', '<|ACT:flustered|>'],
    ['[ACT love 0.3] Hi', '<|ACT love 0.3|>'],
    ['<|ACT sleepy strong> Hi', '<|ACT sleepy strong|>'],
    ['[ACT {"emotion":"happy","intensity":"strong"}] Hi', '<|ACT {"emotion":"happy","intensity":"strong"}|>'],
    ['<ACT {"look":"away"}|> Hi', '<|ACT {"look":"away"}|>'],
    ['[ACT {"motion":"nod"}] Hi', '<|ACT {"motion":"nod"}|>'],
    ['[DELAY 1] Hi', '<|DELAY 1|>'],
    ['<delay 0.5> Hi', '<|DELAY 0.5|>'],
  ])('still recovers the valid near-miss cue %j', async (text, special) => {
    expect(await run(text)).toEqual({ literal: ' Hi', specials: [special], fullText: ' Hi', recovered: 1 })
  })

  it.each([
    ['<ACT banana> Hi', '<|ACT banana|>'],
    ['<|ACT 2> Hi', '<|ACT 2|>'],
    ['<delay soon|> Hi', '<|DELAY soon|>'],
  ])('keeps accepting the angle-bracket near-miss %j so its markup never reaches speech', async (text, special) => {
    expect(await run(text)).toEqual({ literal: ' Hi', specials: [special], fullText: ' Hi', recovered: 1 })
  })

  it('leaves native markers to the existing parsing', async () => {
    expect(await run('A <|ACT banana|> b')).toEqual({ literal: 'A  b', specials: ['<|ACT banana|>'], fullText: 'A <|ACT banana|> b', recovered: 0 })
  })
})

describe('stripsRecoveredCue', () => {
  it.each([
    ['<|ACT {"emotion":"happy",}|>', '[ACT {"emotion":"happy",}]'],
    ['<|ACT {"emotion":"calm"}|>', '[ACT {"emotion":"calm"}]'],
    ['<|ACT {"emotion":"happy"|>', '[ACT {"emotion":"happy"]'],
    ['<|ACT|>', '[ACT]'],
    ['<|DELAY|>', '[DELAY]'],
    ['<|DELAY {"seconds":1}|>', '[DELAY {"seconds":1}]'],
  ])('strips the marker-shaped square-bracket cue %j that does not parse', (special, raw) => {
    expect(stripsRecoveredCue(special, raw)).toBe(true)
  })

  it.each([
    ['<|ACT 2|>', '[Act 2]'],
    ['<|ACT calm|>', '[ACT calm]'],
    ['<|ACT {"emotion":"calm"}|>', '[Act {"emotion":"calm"}]'],
    ['<|ACT|>', '[act]'],
    ['<|ACT happy|>', '[ACT happy]'],
    ['<|ACT {"emotion":"happy"}|>', '[ACT {"emotion":"happy"}]'],
    ['<|DELAY 1|>', '[DELAY 1]'],
    ['<|ACT {"emotion":"happy",}|>', '<ACT {"emotion":"happy",}>'],
  ])('does not strip %j written as %j', (special, raw) => {
    expect(stripsRecoveredCue(special, raw)).toBe(false)
  })
})
