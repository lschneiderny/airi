import type { GesturePlace } from './phrases'

import { describe, expect, it } from 'vitest'

import { createRandomStream } from '../random'
import { drawPhrase, gestureDrive, nextHands, retractShare } from './phrases'

describe('gesture phrases', () => {
  it('moves each phrase to another place and gives it another theme than the phrase before', () => {
    const random = createRandomStream(7)
    let previous = drawPhrase(random, 0.65, ['right'], null)
    for (let i = 0; i < 200; i++) {
      const next = drawPhrase(random, 0.65, ['right'], previous)
      expect(next.place).not.toBe(previous.place)
      if (previous.theme !== 'beat')
        expect(next.theme).not.toBe(previous.theme)
      previous = next
    }
  })

  it('keeps a calm speaker low and short, and takes an excited one out, up and longer', () => {
    const count = (drive: number) => {
      const random = createRandomStream(3)
      const places: Record<GesturePlace, number> = { centre: 0, low: 0, side: 0, high: 0, inner: 0 }
      let strokes = 0
      for (let i = 0; i < 400; i++) {
        const phrase = drawPhrase(random, drive, ['left'], null)
        places[phrase.place]++
        strokes += phrase.length
      }
      return { ...places, strokes }
    }
    const calm = count(0.2)
    const excited = count(0.9)
    expect(calm.low).toBeGreaterThan(excited.low)
    expect(excited.side + excited.high).toBeGreaterThan(2 * (calm.side + calm.high))
    expect(excited.strokes).toBeGreaterThan(calm.strokes)
    expect(retractShare(0.2)).toBeGreaterThan(retractShare(0.45))
    expect(retractShare(0.65)).toBe(0)
  })

  it('opens two-hand phrases only with two-hand themes and places, and one-hand ones never inward', () => {
    const random = createRandomStream(11)
    for (let i = 0; i < 300; i++) {
      const one = drawPhrase(random, 0.8, ['right'], null)
      expect(one.place).not.toBe('inner')
      expect(one.theme).not.toBe('frame')
      const two = drawPhrase(random, 0.8, ['right', 'left'], null)
      expect(two.theme).not.toBe('chop')
    }
  })

  it('hands a phrase to the other hand or to both, but only to a free hand', () => {
    const random = createRandomStream(5)
    const seen = new Set<string>()
    for (let i = 0; i < 300; i++) {
      seen.add(nextHands(random, 0.7, ['right'], ['left', 'right'], 'right').join('+'))
      expect(nextHands(random, 0.7, ['right'], ['right'], 'right')).toEqual(['right'])
    }
    expect([...seen].sort()).toEqual(['left', 'right', 'right+left'])
  })

  it('reads an excited mood as a livelier speaker at the same energy', () => {
    expect(gestureDrive(0.5, { valence: 0.6, arousal: 0.9 })).toBeGreaterThan(gestureDrive(0.5, { valence: 0, arousal: 0 }) + 0.25)
    expect(gestureDrive(0.2, { valence: 0, arousal: 0 })).toBe(0.2)
  })
})
