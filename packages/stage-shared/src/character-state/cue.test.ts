import type { CharacterEvent } from '.'

import { is } from 'valibot'
import { describe, expect, it } from 'vitest'

import { CHARACTER_STATE_SETTINGS, CharacterEventSchema } from '.'
import { nextRandom, seedRng } from '../situation/rng'
import { MOOD_CUE_MARKER, moodCueBody, parseMoodCue } from './cue'

const MAX_CHARS = CHARACTER_STATE_SETTINGS.rendering.reasons.maxChars
const SEEDS = Array.from({ length: 200 }, (_, index) => 7_001 + index * 13)

describe('parseMoodCue', () => {
  it('reads one or two direction words and the reason', () => {
    expect(parseMoodCue('brighter tenser: he remembered')).toEqual({ directions: { valence: 1, energy: 0, tension: 1 }, reason: 'he remembered' })
    expect(parseMoodCue('brighter: you came back')).toEqual({ directions: { valence: 1, energy: 0, tension: 0 }, reason: 'you came back' })
    expect(parseMoodCue(' tireder calmer :  long day ')).toEqual({ directions: { valence: 0, energy: -1, tension: -1 }, reason: 'long day' })
    expect(parseMoodCue('lower livelier: he said: no')).toEqual({ directions: { valence: -1, energy: 1, tension: 0 }, reason: 'he said: no' })
  })

  it.each([
    ['contradictory valence', 'brighter lower: x'],
    ['contradictory energy', 'livelier tireder: x'],
    ['contradictory tension', 'tenser calmer: x'],
    ['an emotion word', 'happy'],
    ['an unknown word with a reason', 'happy: x'],
    ['empty', ''],
    ['blank', '   '],
    ['no reason separator', 'brighter'],
    ['an empty reason', 'brighter:  '],
    ['a reason of only marker text', 'brighter: <||>'],
    ['three words', 'brighter livelier tenser: x'],
    ['a repeated word', 'brighter brighter: x'],
    ['a number word', 'brighter 2: x'],
    ['a numeric step', '0.08: x'],
    ['a signed step', '+1 brighter: x'],
    ['the marker name', 'MOOD brighter: x'],
    ['capitals', 'Brighter: x'],
    ['no words', ': x'],
  ])('rejects %s', (_, body) => {
    expect(parseMoodCue(body)).toBeNull()
  })

  it('caps the reason and removes marker text and line breaks', () => {
    const long = parseMoodCue(`calmer: ${'he stayed with you '.repeat(10)}`)
    expect(long?.reason.length).toBeLessThanOrEqual(MAX_CHARS)
    expect(long?.reason.startsWith('he stayed with you he stayed')).toBe(true)
    expect(long?.reason).toBe(long?.reason.trim())

    const marked = parseMoodCue('lower: he said <|ACT sad|> and\nthen <<||left|>>')
    expect(marked?.reason).toBe('he said ACT sad and then left>')
    expect(marked?.reason).not.toMatch(/<\||\|>|\n/)
  })

  it('keeps every parsed cue a valid model-cue event for 200 seeded bodies', () => {
    const pieces = ['brighter', 'lower', 'livelier', 'tireder', 'tenser', 'calmer', 'happy', 'MOOD', '2', ':', ': ', ' ', '<|', '|>', '\n', 'he', 'came back', 'x'.repeat(40), '  ']
    for (const seed of SEEDS) {
      let state = seedRng(seed)
      let body = ''
      const length = 1 + (seed % 9)
      for (let index = 0; index < length; index++) {
        const [value, next] = nextRandom(state)
        state = next
        body += pieces[Math.floor(value * pieces.length)]
      }
      const cue = parseMoodCue(body)
      if (cue === null)
        continue
      const { valence, energy, tension } = cue.directions
      expect([valence, energy, tension].some(direction => direction !== 0)).toBe(true)
      expect(cue.reason).not.toMatch(/<\||\|>|[\r\n]/)
      const event: CharacterEvent = { kind: 'model-cue', id: `cue-${seed}`, atMs: 0, turnId: `turn-${seed}`, directions: cue.directions, reason: cue.reason }
      expect(is(CharacterEventSchema, event)).toBe(true)
    }
  })
})

describe('moodCueBody', () => {
  it('extracts the body of a native MOOD marker', () => {
    expect(moodCueBody('<|MOOD brighter: you came back|>')).toBe('brighter: you came back')
    expect(parseMoodCue(moodCueBody('<|MOOD happy|>')!)).toBeNull()
    expect(moodCueBody('<|MOOD|>')).toBe('')
  })

  it('agrees with the stage contract marker detection', () => {
    for (const token of ['<|MOOD brighter: x|>', '<|MOOD|>', '<|MOODY x|>', '<|ACT happy|>', '[MOOD brighter: x]', '<|mood brighter: x|>'])
      expect(moodCueBody(token) !== null).toBe(MOOD_CUE_MARKER.test(token))
    expect(MOOD_CUE_MARKER.source).toBe(/^<\|MOOD(?:\s|\|>)/.source)
  })
})
