import type { NaturalSmileClosureInput } from './smile-closure'

import { describe, expect, it } from 'vitest'

import { createRandomStream } from './random'
import { NaturalSmileClosure } from './smile-closure'

const dt = 1 / 120

function run(seed: number, seconds: number, input: (time: number) => NaturalSmileClosureInput) {
  const closure = new NaturalSmileClosure(createRandomStream(seed), dt)
  let maxLid = 0
  let maxSmile = 0
  for (let i = 0; i < seconds / dt; i++) {
    const output = closure.step(input(i * dt))
    maxLid = Math.max(maxLid, output.lidClose)
    maxSmile = Math.max(maxSmile, output.eyeSmile)
  }
  return { closure, maxLid, maxSmile }
}

describe('natural closed-eye smile', () => {
  it('never closes at valence 0 or at pep 0', () => {
    const neutral = run(1, 600, () => ({ pep: 1, valence: 0, blocked: false }))
    const calm = run(1, 600, () => ({ pep: 0, valence: 1, blocked: false }))
    for (const { closure, maxLid, maxSmile } of [neutral, calm]) {
      expect(closure.startCount + closure.dropCount).toBe(0)
      expect(maxLid).toBe(0)
      expect(maxSmile).toBe(0)
    }
  })

  it('closes about six times a minute at pep 1 and full valence', () => {
    const { closure, maxLid, maxSmile } = run(2, 1200, () => ({ pep: 1, valence: 0.8, blocked: false }))
    const duePerMinute = (closure.startCount + closure.dropCount) / 20
    expect(duePerMinute).toBeGreaterThan(5)
    expect(duePerMinute).toBeLessThan(7)
    // A running closure drops the one that falls due during it, at most about a sixth of them.
    expect(closure.startCount).toBeGreaterThan(0.75 * (closure.startCount + closure.dropCount))
    expect(maxLid).toBeCloseTo(0.9, 2)
    expect(maxSmile).toBeCloseTo(0.5, 2)
  })

  it('drops a closure that falls due while blocked instead of queueing it', () => {
    const blockedUntil = 300
    const { closure } = run(3, blockedUntil + 1 / 120, time => ({ pep: 1, valence: 1, blocked: time < blockedUntil }))
    expect(closure.startCount).toBe(0)
    expect(closure.dropCount).toBeGreaterThan(15)
    // Unblocked, nothing that was due starts at once.
    const output = closure.step({ pep: 1, valence: 1, blocked: false })
    expect(closure.startCount).toBe(0)
    expect(output.lidClose).toBe(0)
  })

  it('draws three uniforms per due closure whether it starts or not', () => {
    const source = createRandomStream(4)
    let draws = 0
    const closure = new NaturalSmileClosure(() => {
      draws++
      return source()
    }, dt)
    for (let i = 0; i < 600 / dt; i++)
      closure.step({ pep: 1, valence: 0.7, blocked: (i * dt) % 40 < 10 })
    expect(closure.dropCount).toBeGreaterThan(0)
    expect(draws).toBe(1 + 3 * (closure.startCount + closure.dropCount))
  })
})
