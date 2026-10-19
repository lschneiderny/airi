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
})
