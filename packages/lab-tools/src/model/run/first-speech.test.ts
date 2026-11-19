import { describe, expect, it } from 'vitest'

import { firstSpeechMs, spokenText } from './first-speech'

describe('firstSpeechMs', () => {
  it('waits for the words after a long opening cue, not the first token', async () => {
    const text = '<|ACT {"emotion":"happy","intensity":"clear"}|> Good morning!'
    const marks: [number, number][] = [[100, 10], [400, 30], [900, 48], [950, 54], [1000, text.length]]

    await expect(firstSpeechMs(text, marks)).resolves.toBe(950)
  })

  it('is the first delta for a reply that opens with words', async () => {
    await expect(firstSpeechMs('Hi there <|ACT happy|>', [[120, 3], [200, 22]])).resolves.toBe(120)
  })

  it('is null for a reply without speech or without recorded deltas', async () => {
    await expect(firstSpeechMs('<|ACT happy|>', [[100, 13]])).resolves.toBeNull()
    await expect(firstSpeechMs('Hello', [])).resolves.toBeNull()
  })
})

describe('spokenText', () => {
  it('removes cues and collapses the spacing they leave', async () => {
    await expect(spokenText('<|ACT happy|> Hello <|DELAY 1|> there!')).resolves.toBe('Hello there!')
  })
})
