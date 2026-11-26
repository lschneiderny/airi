import type { RigScreenProfile } from './screen-motion'

import { describe, expect, it } from 'vitest'

import { headMoves, quickReversalsPerMinute, ScreenMotionRecorder } from './screen-motion'

const hz = 60

/** A path that rests at 0, then travels to each target in `seconds` and rests 1 s after it. */
function steps(targets: number[], seconds: number) {
  const path = Array.from<number>({ length: hz }).fill(0)
  for (const target of targets) {
    const from = path.at(-1)!
    for (let frame = 1; frame <= seconds * hz; frame++)
      path.push(from + (target - from) * frame / (seconds * hz))
    for (let frame = 0; frame < hz; frame++)
      path.push(target)
  }
  return path
}

describe('headMoves', () => {
  it('sizes each move by its net travel and counts the small ones', () => {
    // Three moves of 1, 0.2 and 0.6 % of model height, each in 0.2 s.
    const x = steps([1, 1.2, 0.6], 0.2)
    const moves = headMoves(x, x.map(() => 0), hz)

    expect(moves.perMinute).toBeCloseTo(3 / (x.length / hz / 60), 6)
    expect(moves.median).toBeCloseTo(0.6, 6)
    expect(moves.p90).toBeCloseTo(1, 6)
    expect(moves.smallShare).toBeCloseTo(1 / 3, 6)
    expect(moves.stillShare).toBeCloseTo(1 - 36 / (x.length - 1), 6)
  })

  it('does not count a span that travels less than a pixel on a tall character', () => {
    // 0.05 % of model height in 0.1 s is faster than a move's speed and shorter than its floor.
    const x = steps([0.05, 1.05], 0.1)
    const moves = headMoves(x, x.map(() => 0), hz)

    expect(moves.perMinute).toBeCloseTo(1 / (x.length / hz / 60), 6)
    expect(moves.median).toBeCloseTo(1, 6)
    expect(moves.stillShare).toBeCloseTo(1 - 6 / (x.length - 1), 6)
  })

  it('reports a drift slower than a move as stillness', () => {
    // 0.2 % of model height per second, under the 0.3 threshold.
    const x = Array.from({ length: 10 * hz }, (_, frame) => 0.2 * frame / hz)
    expect(headMoves(x, x.map(() => 0), hz)).toEqual({ perMinute: 0, median: 0, p90: 0, smallShare: 0, stillShare: 1 })
  })

  it('joins fast spans that a pause shorter than 0.1 s separates', () => {
    const x = steps([1], 0.2)
    // A 3-frame stall inside the move.
    x.splice(hz + 6, 0, x[hz + 5], x[hz + 5], x[hz + 5])
    expect(headMoves(x, x.map(() => 0), hz).perMinute).toBeCloseTo(1 / (x.length / hz / 60), 6)
  })
})

describe('quickReversalsPerMinute', () => {
  const wave = (periodSeconds: number, amplitude: number) => Array.from({ length: 60 * hz }, (_, frame) => amplitude * Math.sin(2 * Math.PI * frame / hz / periodSeconds))

  it('counts the turns of a fast ringing and none of a slow sway', () => {
    // A 0.5 s period turns every 0.25 s: about 240 turns a minute.
    expect(quickReversalsPerMinute(wave(0.5, 0.5), hz)).toBeGreaterThan(230)
    // A 4 s period turns every 2 s, slower than a quick reversal.
    expect(quickReversalsPerMinute(wave(4, 0.5), hz)).toBe(0)
  })

  it('ignores a ringing smaller than the swing threshold', () => {
    expect(quickReversalsPerMinute(wave(0.5, 0.05), hz)).toBe(0)
  })
})

describe('screenMotionRecorder', () => {
  // Two drawables on a model 2 units tall: the head marker, and a part four times its area that never moves.
  const profile: RigScreenProfile = { modelHeight: 2, visible: [0, 2], areas: [1, 4], head: { parameter: 'ParamMouthOpenY', drawables: [0] }, channels: {} }
  const square = (x: number, y: number) => [x - 1, y - 1, x + 1, y - 1, x + 1, y + 1, x - 1, y + 1]

  it('reports motion in % of model height, the picture weighted by area', () => {
    const path = steps([0.02], 0.2)
    const recorder = new ScreenMotionRecorder(profile, path.length)
    for (const x of path)
      recorder.sample({ count: 3, opacities: [1, 0, 1], vertexPositions: [square(x, 0), square(9, 9), square(5, 5)] })
    const summary = recorder.summarize(hz, 0)

    // 0.02 units on a model 2 units tall is 1 %.
    expect(summary.head.median).toBeCloseTo(1, 4)
    expect(summary.head.perMinute).toBeCloseTo(1 / (path.length / hz / 60), 4)
    // Only the head moves, and it holds a fifth of the area: 1 % travelled over the run, times 0.2.
    expect(summary.picture.speed).toBeCloseTo(0.2 / ((path.length - 1) / hz), 4)
    expect(summary.picture.quickReversalsPerMinute).toBe(0)
  })

  it('leaves the settling seconds out', () => {
    const path = steps([0.02], 0.2)
    const recorder = new ScreenMotionRecorder(profile, path.length)
    for (const x of path)
      recorder.sample({ count: 3, opacities: [1, 0, 1], vertexPositions: [square(x, 0), square(9, 9), square(5, 5)] })

    // The move ends 1.2 s in.
    expect(recorder.summarize(hz, 1.5).head.perMinute).toBe(0)
  })
})
