import type { Fingerprint } from './fingerprint'
import type { Resampled } from './track'

import { describe, expect, it } from 'vitest'

import { MEASURES } from './fingerprint'
import { buildReference, compareToReference, parseReference, place } from './reference'

const HZ = 60

/** A 1 Hz sine tilt of `amplitude` degrees. */
function sine(seconds: number, amplitude: number): Resampled {
  const n = seconds * HZ
  const tilt = Array.from({ length: n }, (_, i) => amplitude * Math.sin(2 * Math.PI * i / HZ))
  const ones = tilt.map(() => 1)
  return { source: 'video', channels: { tilt, x: ones, y: ones, scale: ones, eyeOpen: ones }, level: tilt.map(() => 0), voiced: tilt.map(() => false) }
}

describe('buildReference', () => {
  const reference = buildReference({ name: 'test', note: 'synthetic', tracker: 'test 1', windowSeconds: 20, segments: ['a', 'b'], tracks: [sine(20, 4), sine(40, 8)] })

  it('bands each measure over every window of every track', () => {
    // One 20 s window in the first track, three (hop 10 s) in the second.
    expect(reference.measures.tiltSdDeg.values).toHaveLength(4)
    const [lo, hi] = reference.measures.tiltSdDeg.band ?? [Number.NaN, Number.NaN]
    expect(lo).toBeCloseTo(4 / Math.SQRT2, 1)
    expect(hi).toBeCloseTo(8 / Math.SQRT2, 1)
    expect(reference.measures.talkShare).toEqual({ values: [], band: null })
    expect(parseReference(JSON.parse(JSON.stringify(reference)))).toEqual(reference)
  })

  it('places a fingerprint below, inside or above each band', () => {
    const print = Object.fromEntries(MEASURES.map(measure => [measure, null])) as Fingerprint
    const rows = compareToReference({ ...print, tiltSdDeg: 1 }, reference)
    expect(rows.find(row => row.measure === 'tiltSdDeg')?.placement).toBe('below')
    expect(rows.find(row => row.measure === 'talkShare')?.placement).toBe('n/a')
    expect(place(5, [4, 6])).toBe('inside')
    expect(place(7, [4, 6])).toBe('above')
  })
})
