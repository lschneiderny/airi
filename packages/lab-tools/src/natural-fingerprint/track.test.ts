import type { Track } from './track'

import { describe, expect, it } from 'vitest'

import { fillGaps, parseTrack, resampleSeries, resampleTrack } from './track'

function track(frames: number): Track {
  const zeros = Array.from<number>({ length: frames }).fill(0)
  return {
    format: 'natural-track',
    version: 1,
    source: 'video',
    tracker: 'test',
    fps: 30,
    channels: { tilt: [...zeros], x: [...zeros], y: [...zeros], scale: [...zeros], eyeOpen: [...zeros] },
    voice: { level: [...zeros], voiced: zeros.map((_, i) => i % 2 === 0) },
  }
}

describe('resampleSeries', () => {
  it('interpolates 30 fps linearly to 60 Hz', () => {
    expect(resampleSeries([0, 1, 2], 30)).toEqual([0, 0.5, 1, 1.5, 2, 2])
  })

  it('fills gaps of up to 0.5 s and keeps longer ones at their length', () => {
    const filled = fillGaps([0, ...Array.from<null>({ length: 15 }).fill(null), 16], 15)
    expect(filled).toEqual(Array.from({ length: 17 }, (_, i) => i))

    const long = [0, ...Array.from<null>({ length: 16 }).fill(null), 17, 18]
    const resampled = resampleSeries(long, 30)
    // 16 missing frames at 30 fps stay 32 missing samples at 60 Hz.
    expect(resampled.filter(value => value === null)).toHaveLength(32)
    expect(resampled[0]).toBe(0)
    expect(resampled.at(-1)).toBe(18)
  })

  it('leaves leading and trailing gaps open', () => {
    expect(fillGaps([null, 1, null], 15)).toEqual([null, 1, null])
  })
})

describe('resampleTrack', () => {
  it('doubles every series and keeps voiced frames boolean', () => {
    const resampled = resampleTrack(track(30))
    expect(resampled.level).toHaveLength(60)
    expect(resampled.channels.tilt).toHaveLength(60)
    expect(resampled.voiced.slice(0, 4)).toEqual([true, false, false, true])
  })
})

describe('parseTrack', () => {
  it('accepts a well-formed track', () => {
    expect(parseTrack(track(3)).fps).toBe(30)
  })

  it('rejects a malformed track with a clear message', () => {
    expect(() => parseTrack({ ...track(3), format: 'other' })).toThrow(/not a natural-track file/)
    const short = track(3)
    short.channels.tilt.pop()
    expect(() => parseTrack(short)).toThrow(/same number of frames/)
  })
})
