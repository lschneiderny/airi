import type { Live2DTouchEvent, Live2DTouchRegion, Live2DTouchSample } from './touch-gestures'

import { describe, expect, it } from 'vitest'

import { Live2DTouchGestures } from './touch-gestures'

const headWidth = 100

function at(timeMs: number, x: number, y = 0, region: Live2DTouchRegion | null = 'head'): Live2DTouchSample {
  return { timeMs, x, y, region, scale: headWidth }
}

/** Strokes back and forth across 40% of the head every 200 ms, sampled every 20 ms. */
function stroke(gestures: Live2DTouchGestures, fromMs: number, toMs: number) {
  const events: Live2DTouchEvent[] = []
  for (let time = fromMs; time <= toMs; time += 20) {
    const phase = ((time - fromMs) % 400) / 200
    const x = phase <= 1 ? phase * 40 : (2 - phase) * 40
    events.push(...gestures.moved(at(time, x)))
  }
  return events
}

function headAt(timeMs: number, x: number, y = 0): Live2DTouchSample {
  return { ...at(timeMs, x * headWidth, y * headWidth, Math.abs(x) <= 0.5 && Math.abs(y) <= 0.5 ? 'head' : null), head: { x, y, halfHeight: 0.5 } }
}

/** Constant-speed triangular strokes, using integer frame indices instead of clock delays. */
function headStrokes(gestures: Live2DTouchGestures, hz: number, amplitude: number, speed: number, durationMs: number, center = 0) {
  const events: { timeMs: number, event: Live2DTouchEvent }[] = []
  for (let frame = 0; frame <= durationMs * hz / 1000; frame++) {
    const timeMs = frame * 1000 / hz
    const phase = (timeMs / 1000 * speed) % (4 * amplitude)
    const x = center + (phase <= 2 * amplitude ? -amplitude + phase : 3 * amplitude - phase)
    for (const event of gestures.moved(headAt(timeMs, x)))
      events.push({ timeMs, event })
  }
  return events
}

describe('live2d touch gestures', () => {
  it('reports a short, still press over the model as a poke at the press point', () => {
    const gestures = new Live2DTouchGestures()
    gestures.pressed(at(0, 10, 20, 'body'))
    expect(gestures.released(at(150, 12, 21, 'body'))).toEqual([{ kind: 'poke', region: 'body', x: 10, y: 20 }])
  })

  it('ignores long presses, dragged presses, and presses outside the model', () => {
    const gestures = new Live2DTouchGestures()
    gestures.pressed(at(0, 0))
    expect(gestures.released(at(600, 0))).toEqual([])
    gestures.pressed(at(1000, 0))
    expect(gestures.released(at(1100, 30))).toEqual([])
    gestures.pressed(at(2000, 0, 0, null))
    expect(gestures.released(at(2050, 0, 0, null))).toEqual([])
  })

  it('starts a hover pet from back-and-forth strokes and ends it once the cursor rests', () => {
    const gestures = new Live2DTouchGestures()
    expect(stroke(gestures, 0, 1000)).toContainEqual({ kind: 'pet-start' })
    expect(gestures.petting).toBe(true)
    // Resting just under the idle limit keeps the pet.
    expect(gestures.update(1500)).toEqual([])
    expect(gestures.update(1700)).toEqual([{ kind: 'pet-end', durationMs: expect.any(Number) }])
    expect(gestures.petting).toBe(false)
  })

  it('does not pet a cursor that only passes over the head', () => {
    const gestures = new Live2DTouchGestures()
    const events: Live2DTouchEvent[] = []
    for (let time = 0; time <= 500; time += 20)
      events.push(...gestures.moved(at(time, time / 2)))
    expect(events).toEqual([])
  })

  it('ends a pet shortly after the cursor leaves the head', () => {
    const gestures = new Live2DTouchGestures()
    stroke(gestures, 0, 1000)
    expect(gestures.moved(at(1020, 200, 0, 'body'))).toEqual([])
    expect(gestures.moved(at(1300, 210, 0, 'body'))).toEqual([{ kind: 'pet-end', durationMs: expect.any(Number) }])
  })

  it('counts only held strokes when a held button is required, and the held press is not a poke', () => {
    const gestures = new Live2DTouchGestures({ requireHold: true })
    expect(stroke(gestures, 0, 1000)).toEqual([])

    gestures.pressed(at(2000, 0))
    expect(stroke(gestures, 2000, 2600)).toContainEqual({ kind: 'pet-start' })
    expect(gestures.released(at(2620, 0))).toEqual([{ kind: 'pet-end', durationMs: expect.any(Number) }])
    expect(gestures.petting).toBe(false)
  })

  it('ends any pet when the pointer is cancelled', () => {
    const gestures = new Live2DTouchGestures()
    stroke(gestures, 0, 1000)
    expect(gestures.cancelled(1010)).toEqual([{ kind: 'pet-end', durationMs: expect.any(Number) }])
    expect(gestures.cancelled(1020)).toEqual([])
  })

  it.each([30, 60, 144, 240])('holds one continuous pet at %i Hz and ends after resting', (hz) => {
    const gestures = new Live2DTouchGestures()
    expect(headStrokes(gestures, hz, 0.3, 1.2, 4000).map(entry => entry.event)).toEqual([{ kind: 'pet-start' }])
    expect(gestures.update(4601)).toEqual([{ kind: 'pet-end', durationMs: expect.any(Number) }])
    expect(gestures.update(4700)).toEqual([])
  })

  it.each(['horizontal', 'vertical'])('pets through %s overshoots into the head margin', (axis) => {
    const gestures = new Live2DTouchGestures()
    const events: Live2DTouchEvent[] = []
    for (let frame = 0; frame <= 240; frame++) {
      const timeMs = frame * 1000 / 60
      const phase = (timeMs / 1000 * 1.2) % 2.4
      const position = phase <= 1.2 ? -0.6 + phase : 1.8 - phase
      events.push(...gestures.moved(headAt(timeMs, axis === 'horizontal' ? position : 0, axis === 'vertical' ? position : 0)))
    }
    expect(events).toEqual([{ kind: 'pet-start' }])
  })

  it('does not pet a straight pass across the margin zone', () => {
    const gestures = new Live2DTouchGestures()
    const events: Live2DTouchEvent[] = []
    for (let frame = 0; frame <= 120; frame++)
      events.push(...gestures.moved(headAt(frame * 1000 / 60, -1 + frame / 60)))
    expect(events).toEqual([])
  })

  it('does not pet a wiggle confined to the margin', () => {
    expect(headStrokes(new Live2DTouchGestures(), 144, 0.2, 1.2, 4000, 0.75)).toEqual([])
  })

  it.each(['update', 'moved'] as const)('commits a still hover press once at 90 ms through %s', (method) => {
    const gestures = new Live2DTouchGestures()
    gestures.pressed(headAt(0, 0))
    expect(gestures.pressPending).toBe(true)
    const advance = (timeMs: number) => method === 'update' ? gestures.update(timeMs) : gestures.moved(headAt(timeMs, 0))
    expect(advance(89)).toEqual([])
    expect(advance(90)).toEqual([{ kind: 'poke', region: 'head', x: 0, y: 0 }])
    expect(gestures.pressPending).toBe(false)
    expect(advance(100)).toEqual([])
    expect(gestures.released(headAt(120, 0))).toEqual([])
  })

  it('pokes on an early release at 50 ms', () => {
    const gestures = new Live2DTouchGestures()
    gestures.pressed(headAt(0, 0))
    expect(gestures.released(headAt(50, 0))).toEqual([{ kind: 'poke', region: 'head', x: 0, y: 0 }])
    expect(gestures.pressPending).toBe(false)
  })

  it('keeps requireHold pokes release-only', () => {
    const gestures = new Live2DTouchGestures({ requireHold: true })
    gestures.pressed(headAt(0, 0))
    expect(gestures.update(100)).toEqual([])
    expect(gestures.released(headAt(120, 0))).toEqual([{ kind: 'poke', region: 'head', x: 0, y: 0 }])
  })

  it.each([60, 144])('starts slow strokes within 1.6 s and keeps them continuous at %i Hz', (hz) => {
    const events = headStrokes(new Live2DTouchGestures(), hz, 0.15, 0.3, 5600)
    expect(events.map(entry => entry.event)).toEqual([{ kind: 'pet-start' }])
    expect(events[0].timeMs).toBeLessThanOrEqual(1600)
  })

  it('rejects a drag released before the commit deadline', () => {
    const gestures = new Live2DTouchGestures()
    gestures.pressed(headAt(0, 0))
    expect(gestures.moved(headAt(40, 0.08))).toEqual([])
    expect(gestures.released(headAt(80, 0.08))).toEqual([])
  })

  it('permanently rejects a drag that returns before the commit deadline (i2)', () => {
    const gestures = new Live2DTouchGestures()
    gestures.pressed(headAt(0, 0))
    expect(gestures.moved(headAt(40, 0.08))).toEqual([])
    expect(gestures.moved(headAt(70, 0))).toEqual([])
    expect(gestures.update(90)).toEqual([])
    expect(gestures.released(headAt(120, 0))).toEqual([])
  })

  it('allows small jitter before committing at 90 ms', () => {
    const gestures = new Live2DTouchGestures()
    gestures.pressed(headAt(0, 0))
    expect(gestures.moved(headAt(40, 0.03))).toEqual([])
    expect(gestures.moved(headAt(70, -0.03))).toEqual([])
    expect(gestures.update(90)).toEqual([{ kind: 'poke', region: 'head', x: 0, y: 0 }])
    expect(gestures.update(100)).toEqual([])
    expect(gestures.released(headAt(120, 0))).toEqual([])
  })

  it('does not poke again when a committed press later drags', () => {
    const gestures = new Live2DTouchGestures()
    gestures.pressed(headAt(0, 0))
    expect(gestures.update(90)).toEqual([{ kind: 'poke', region: 'head', x: 0, y: 0 }])
    expect(gestures.moved(headAt(100, 0.5))).toEqual([])
    expect(gestures.released(headAt(120, 0.5))).toEqual([])
  })
})
