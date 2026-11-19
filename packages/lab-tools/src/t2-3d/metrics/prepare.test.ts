import { analyticTrace, angleX } from '@proj-airi/qa-tools/t2-3d/metrics/test-trace'
import { describe, expect, it } from 'vitest'

import { prepareTrace } from './prepare'
import { placeWindows, segment } from './segments'

describe('analysis windows and segmentation', () => {
  it('centres fixed windows with a half-window hop', () => {
    expect(placeWindows([{ start: 60, end: 60 + 13 * 60 }], 10)).toEqual([{ start: 150, end: 750 }])
    expect(placeWindows([{ start: 0, end: 23 * 60 }], 10)).toEqual([{ start: 90, end: 690 }, { start: 390, end: 990 }, { start: 690, end: 1290 }])
  })

  it('excludes warm-up before resampling and reconstructs missing core ancestors', () => {
    const trace = analyticTrace({ seconds: 15, hz: 30, bones: ['hips', 'chest', 'upperChest', 'neck'], world: (b, t) => angleX(b === 'upperChest' ? t * 0.1 : b === 'neck' ? t * 0.3 : 0) })
    const p = prepareTrace({ ...trace, trace: { ...trace.trace, scoredFrom: 2 } })
    expect(p.times[0]).toBe(2)
    expect(p.bodySpeed.length).toBe(13 * 60)
    expect(p.o6.neck?.[300][0]).toBeCloseTo(0.3, 5)
  })

  it('uses maximal idle runs without bridging speaking or locomotion', () => {
    const p = prepareTrace(analyticTrace({ seconds: 40, bones: ['hips'], speaking: t => t >= 12 && t < 14 ? 1 : 0, mode: t => t >= 28 && t < 30 ? 3 : 0 }))
    expect(p.eligibleSpans).toEqual([{ start: 0, end: 720 }, { start: 840, end: 1680 }, { start: 1800, end: 2400 }])
    expect(p.windows.length).toBe(3)
  })

  it('places no window across the start or the end of her sleep', () => {
    const events = [{ t: 12, kind: 'marker', label: 'idle:sleep:start' }, { t: 34, kind: 'marker', label: 'idle:sleep:end' }] as const
    const p = prepareTrace(analyticTrace({ seconds: 50, bones: ['hips'], events: [...events] }))
    expect(p.eligibleSpans).toEqual([{ start: 0, end: 3000 }])
    expect(p.dozeSpans).toEqual([{ start: 720, end: 2040 }])
    // 12 s awake, 22 s asleep, 16 s awake: one window, three at a 5 s hop, two.
    expect(p.windows).toEqual([{ start: 60, end: 660 }, { start: 780, end: 1380 }, { start: 1080, end: 1680 }, { start: 1380, end: 1980 }, { start: 2070, end: 2670 }, { start: 2370, end: 2970 }])
  })

  it('requires at least eighty percent speaking in a character talk window', () => {
    const p = prepareTrace(analyticTrace({ seconds: 20, bones: ['hips'], scenario: 'talk', speaking: t => t < 4 ? 1 : 0 }))
    expect(p.windows).toEqual([{ start: 0, end: 300 }])
  })

  it('restricts walk windows to root speeds above the stated threshold', () => {
    const p = prepareTrace(analyticTrace({ seconds: 15, bones: ['hips'], scenario: 'walk', position: t => [0, 0, t < 3 ? 0 : 0.4 * (t - 3)] }))
    expect(p.eligibleSpans[0]?.start).toBe(180)
    expect(p.windows.length).toBe(1)
  })

  it('merges short move and hold runs while retaining hysteresis', () => {
    const speed = [...Array.from<number>({ length: 30 }).fill(0), ...Array.from<number>({ length: 30 }).fill(2), ...Array.from<number>({ length: 3 }).fill(0), 2, ...Array.from<number>({ length: 29 }).fill(1), ...Array.from<number>({ length: 30 }).fill(0)]
    expect(segment(speed, 1)).toEqual([{ start: 0, end: 30, moving: false }, { start: 30, end: 93, moving: true }, { start: 93, end: 123, moving: false }])
  })
})
