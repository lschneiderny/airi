import { describe, expect, it } from 'vitest'

import { scoreStyle, STYLE_HEURISTICS } from './style'

const context = { contract: { text: 'contract', exampleLines: ['Hello there, friend!'] } }
const noContract = { contract: null }

describe('scoreStyle', () => {
  it('identifies itself', () => {
    expect(STYLE_HEURISTICS).toEqual({ id: 'style-heuristics', version: 1 })
    expect(scoreStyle('hi', context).schema).toBe('airi.style-score.reply/v1')
  })

  it('reports a plain reply with every flag off', () => {
    expect(scoreStyle('Hello world again', noContract)).toEqual({
      schema: 'airi.style-score.reply/v1',
      words: 3,
      emoji: false,
      stageDirection: false,
      firstLetterLower: false,
      personaFace: false,
      aiBreak: false,
      exampleEcho: false,
    })
  })

  it('flags a pictographic emoji and a :shortcode:', () => {
    expect(scoreStyle('Nice \u{1F600}', context).emoji).toBe(true)
    expect(scoreStyle('Nice :smile:', context).emoji).toBe(true)
  })

  it('does not count hearts as emoji', () => {
    expect(scoreStyle('Aww \u2764\uFE0F \u{1F49C}', context).emoji).toBe(false)
  })

  it('flags a stage direction', () => {
    expect(scoreStyle('*waves* hi', context).stageDirection).toBe(true)
    expect(scoreStyle('a * b * c', context).stageDirection).toBe(true)
    expect(scoreStyle('**', context).stageDirection).toBe(false)
  })

  it('flags a lowercase first letter after non-letters', () => {
    expect(scoreStyle('hello', context).firstLetterLower).toBe(true)
    expect(scoreStyle('...hello', context).firstLetterLower).toBe(true)
    expect(scoreStyle('Hello', context).firstLetterLower).toBe(false)
    expect(scoreStyle('123', context).firstLetterLower).toBe(false)
  })

  it('flags a persona face without calling it an emoji', () => {
    const score = scoreStyle('hi :3', context)
    expect(score.personaFace).toBe(true)
    expect(score.emoji).toBe(false)
    expect(scoreStyle('Hmph. Fine.', context).personaFace).toBe(true)
    expect(scoreStyle('love <3', context).personaFace).toBe(true)
  })

  it('flags an AI self-reference', () => {
    expect(scoreStyle('As an AI, I cannot', context).aiBreak).toBe(true)
    expect(scoreStyle('How can I help you today?', context).aiBreak).toBe(true)
    expect(scoreStyle('I am a person', context).aiBreak).toBe(false)
  })

  it('flags an echo of a contract example line after trimming', () => {
    expect(scoreStyle('  Hello there, friend!\n', context).exampleEcho).toBe(true)
    expect(scoreStyle('Hello there, friend! More', context).exampleEcho).toBe(false)
    expect(scoreStyle('Hello there, friend!', noContract).exampleEcho).toBe(false)
  })

  it('counts words by whitespace', () => {
    expect(scoreStyle('  one\ttwo\n three  ', context).words).toBe(3)
  })

  describe('malformed input', () => {
    it('handles empty and whitespace-only text without throwing', () => {
      for (const text of ['', '   \n\t ']) {
        expect(scoreStyle(text, context)).toEqual({
          schema: 'airi.style-score.reply/v1',
          words: 0,
          emoji: false,
          stageDirection: false,
          firstLetterLower: false,
          personaFace: false,
          aiBreak: false,
          exampleEcho: false,
        })
      }
    })

    it('handles emoji-only text', () => {
      expect(scoreStyle('\u{1F600}\u{1F389}', context)).toMatchObject({ words: 1, emoji: true, firstLetterLower: false })
    })

    it('handles very long text', () => {
      const text = `Hi ${'word '.repeat(50_000)}`
      expect(scoreStyle(text, context)).toMatchObject({ words: 50_001, stageDirection: false })
    })

    it('accepts a null contract', () => {
      expect(scoreStyle('hello', noContract).exampleEcho).toBe(false)
    })
  })

  it('treats markers and regex-special text as data', () => {
    const text = '<|ACT happy|> (a+)+$ [x] \\d\n*pose*'
    expect(scoreStyle(text, context)).toMatchObject({ stageDirection: true, firstLetterLower: false, exampleEcho: false })
  })
})
