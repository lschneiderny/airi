import type { CursorBand } from './cursor-notice'

import { describe, expect, it } from 'vitest'

import { cooldown, drawCursorEpisode, engageFar, engageMedium, interestSpan, noticeDwell } from './cursor-notice'
import { createRandomStream } from './random'

function recordedSource(values: number[]) {
  const seen: number[] = []
  return {
    seen,
    random: () => {
      const value = values[seen.length]
      if (value === undefined)
        throw new Error('the draw asked for more values than recorded')
      seen.push(value)
      return value
    },
  }
}

describe('drawCursorEpisode', () => {
  it('draws engaging, span, dwell, then cooldown', () => {
    // 0.25 turns the Box-Muller angle to zero, so the span is the medium median.
    const source = recordedSource([0.1, 0.3, 0.25, 0.4, 0.5])
    expect(drawCursorEpisode('medium', source.random)).toEqual({ band: 'medium', engaging: true, span: 2.5, dwell: 0.35, cooldown: 7 })
    expect(source.seen).toHaveLength(5)
  })

  it('draws no engagement and no span for a near cursor', () => {
    const source = recordedSource([0.4, 0.5])
    expect(drawCursorEpisode('near', source.random)).toEqual({ band: 'near', engaging: true, span: Number.POSITIVE_INFINITY, dwell: 0.35, cooldown: 7 })
    expect(source.seen).toHaveLength(2)
  })

  it('keeps the span, dwell, and cooldown in their bounds', () => {
    const random = createRandomStream(7)
    for (const band of ['near', 'medium', 'far'] as CursorBand[]) {
      for (let i = 0; i < 1000; i++) {
        const episode = drawCursorEpisode(band, random)
        if (band !== 'near') {
          expect(episode.span).toBeGreaterThanOrEqual(interestSpan.min)
          expect(episode.span).toBeLessThanOrEqual(interestSpan.max)
        }
        expect(episode.dwell).toBeGreaterThanOrEqual(noticeDwell.min)
        expect(episode.dwell).toBeLessThanOrEqual(noticeDwell.max)
        expect(episode.cooldown).toBeGreaterThanOrEqual(cooldown.min)
        expect(episode.cooldown).toBeLessThanOrEqual(cooldown.max)
      }
    }
  })

  it.each([
    ['medium', engageMedium],
    ['far', engageFar],
  ] as const)('engages a %s cursor at its share', (band, share) => {
    const draws = 10_000
    const random = createRandomStream(1)
    let engaged = 0
    for (let i = 0; i < draws; i++) {
      if (drawCursorEpisode(band, random).engaging)
        engaged++
    }
    const sd = Math.sqrt(share * (1 - share) / draws)
    expect(Math.abs(engaged / draws - share)).toBeLessThanOrEqual(4 * sd)
  })
})
