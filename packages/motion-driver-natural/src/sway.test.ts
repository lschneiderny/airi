import type { NaturalSwayInput, NaturalSwayOutput } from './sway'

import { describe, expect, it } from 'vitest'

import { createRandomStream } from './random'
import { NaturalSwayLayer } from './sway'

const dt = 1 / 120

function counting(seed: number) {
  const random = createRandomStream(seed)
  const stream = () => {
    stream.draws++
    return random()
  }
  stream.draws = 0
  return stream
}

/** Talking with an onset every 0.9 s for the first half, silent for the second. */
function scripted(i: number, pep: number): NaturalSwayInput {
  const time = i * dt
  const talking = time % 60 < 30
  return { talking, onsetCount: talking ? Math.floor(time / 0.9) : 0, pep, amplitude: 1.4, duck: 1 }
}

function run(seed: number, seconds: number, pep: number) {
  const layer = new NaturalSwayLayer(createRandomStream(seed), dt)
  const outputs: NaturalSwayOutput[] = []
  for (let i = 0; i < seconds / dt; i++)
    outputs.push(layer.step(scripted(i, pep)))
  return { layer, outputs }
}

describe('natural sway layer', () => {
  it('outputs exactly zero at pep 0 while its swings keep coming', () => {
    const { layer, outputs } = run(3, 60, 0)
    expect(layer.swingCount).toBeGreaterThan(30)
    for (const { head, body } of outputs) {
      expect(head).toEqual([0, 0, 0])
      expect(body).toEqual([0, 0, 0])
    }
  })

  it('scales its output with the pep', () => {
    const full = run(3, 30, 1).outputs
    const half = run(3, 30, 0.5).outputs
    for (const [i, { head, body }] of full.entries()) {
      for (const axis of [0, 1, 2]) {
        expect(half[i].head[axis]).toBeCloseTo(0.5 * head[axis], 12)
        expect(half[i].body[axis]).toBeCloseTo(0.5 * body[axis], 12)
      }
    }
  })

  it('stays bounded with bounded per-step change over a long run with onsets', () => {
    const { outputs } = run(7, 600, 1)
    let maxRoll = 0
    let maxStep = 0
    let maxJerk = 0
    let sumSquares = 0
    for (const [i, { head, body }] of outputs.entries()) {
      maxRoll = Math.max(maxRoll, Math.abs(head[2]), Math.abs(body[2]))
      sumSquares += head[2] * head[2]
      if (i < 2)
        continue
      for (const axis of [0, 1, 2]) {
        for (const [now, before, earlier] of [[head, outputs[i - 1].head, outputs[i - 2].head], [body, outputs[i - 1].body, outputs[i - 2].body]]) {
          maxStep = Math.max(maxStep, Math.abs(now[axis] - before[axis]))
          maxJerk = Math.max(maxJerk, Math.abs(now[axis] - 2 * before[axis] + earlier[axis]))
        }
      }
    }
    // One clamped swing leans 0.18 x e^0.875 = 0.43, times amplitude 1.4 is 0.6; the follower overshoot stays under a quarter of it.
    expect(maxRoll).toBeLessThan(0.75)
    // The largest travel is two such leans, 1.2. An underdamped step response peaks near 0.5 w per unit of travel:
    // 0.5 x 2 pi x 1.6 x 1.2 / 120 = 0.05 per step.
    expect(maxStep).toBeLessThan(0.055)
    // No pop: a new target changes the per-step change by at most w^2 dt^2 per unit of travel, 0.007 x 1.2.
    expect(maxJerk).toBeLessThan(0.009)
    expect(Math.sqrt(sumSquares / outputs.length)).toBeGreaterThan(0.1)
  })

  it('starts a swing on a talking onset only after the running swing is 0.45 s old', () => {
    const layer = new NaturalSwayLayer(createRandomStream(5), dt)
    const input = { talking: true, onsetCount: 0, pep: 1, amplitude: 1, duck: 1 }
    // Run until a scheduled swing starts, so the age is known.
    let before = layer.swingCount
    while (layer.swingCount === before)
      layer.step(input)
    before = layer.swingCount
    layer.step({ ...input, onsetCount: 1 })
    expect(layer.swingCount).toBe(before)
    for (let i = 0; i < 0.45 / dt; i++)
      layer.step({ ...input, onsetCount: 1 })
    expect(layer.swingCount).toBe(before)
    layer.step({ ...input, onsetCount: 2 })
    expect(layer.swingCount).toBe(before + 1)
  })

  it('ignores an onset while silent', () => {
    const layer = new NaturalSwayLayer(createRandomStream(5), dt)
    const input = { talking: false, onsetCount: 0, pep: 1, amplitude: 1, duck: 1 }
    let before = layer.swingCount
    while (layer.swingCount === before)
      layer.step(input)
    for (let i = 0; i < 0.45 / dt; i++)
      layer.step(input)
    before = layer.swingCount
    layer.step({ ...input, onsetCount: 1 })
    expect(layer.swingCount).toBe(before)
  })

  it('draws five uniforms per swing whatever the values', () => {
    const random = counting(11)
    const layer = new NaturalSwayLayer(random, dt)
    const initial = random.draws
    for (let i = 0; i < 300 / dt; i++)
      layer.step(scripted(i, 1))
    expect(layer.swingCount).toBeGreaterThan(100)
    expect(random.draws - initial).toBe(5 * layer.swingCount)
  })

  it('replays the same series for the same seed', () => {
    expect(run(9, 60, 1).outputs).toEqual(run(9, 60, 1).outputs)
    expect(run(9, 60, 1).outputs).not.toEqual(run(10, 60, 1).outputs)
  })
})
