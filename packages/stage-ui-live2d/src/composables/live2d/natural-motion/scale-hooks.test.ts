import { NaturalBlinkScheduler } from '@proj-airi/motion-driver-natural/blink'
import { NaturalBreathLayer } from '@proj-airi/motion-driver-natural/breath'
import { createRandomStream } from '@proj-airi/motion-driver-natural/random'
import { NaturalSpeechEmphasis } from '@proj-airi/motion-driver-natural/speech-emphasis'
import { describe, expect, it } from 'vitest'

const dt = 1 / 120

describe('natural layer scale hooks', () => {
  it('preserves raw seeded outputs and draw counts with explicit unit scales for 10000 steps', () => {
    const simulate = (explicit: boolean) => {
      let draws = 0
      const stream = (seed: number) => {
        const random = createRandomStream(seed)
        return () => {
          draws++
          return random()
        }
      }
      const blink = new NaturalBlinkScheduler(stream(7))
      const breath = new NaturalBreathLayer(stream(8))
      const emphasis = new NaturalSpeechEmphasis(stream(9))
      if (explicit) {
        blink.intervalScale = 1
        breath.periodScale = 1
        emphasis.sizeScale = 1
      }
      const values = new Float64Array(10000 * 6)
      for (let i = 0; i < 10000; i++) {
        const f = blink.step(dt)
        const b = breath.step(dt)
        const e = emphasis.step(dt, i * dt % 0.3 < 0.12 ? 0.9 : 0, 1)
        values.set([f, b.value, b.headY, ...e], i * 6)
      }
      return { bytes: new Uint8Array(values.buffer), draws }
    }

    const implicit = simulate(false)
    const explicit = simulate(true)

    expect(explicit).toEqual(implicit)
  })

  it('doubles the mean open interval without scaling double-blink gaps or lid durations', () => {
    const sample = (scale: number) => {
      const blink = new NaturalBlinkScheduler(createRandomStream(17))
      blink.intervalScale = scale
      const intervals: number[] = []
      const doubles: number[] = []
      const durations: number[] = []
      let previous = 1
      let reopened = 0
      let started = 0
      for (let i = 1; i < 2000000 && intervals.length < 500; i++) {
        const factor = blink.step(dt)
        const at = i * dt
        if (previous === 1 && factor < 1) {
          started = at
          if (reopened > 0) {
            const interval = at - reopened
            ;(interval < 0.6 ? doubles : intervals).push(interval)
          }
        }
        if (previous < 1 && factor === 1) {
          reopened = at
          durations.push(at - started)
        }
        previous = factor
      }
      return { intervals, doubles, durations }
    }
    const normal = sample(1)

    const doubled = sample(2)

    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    expect(doubled.intervals).toHaveLength(500)
    expect(mean(doubled.intervals) / mean(normal.intervals)).toBeCloseTo(2, 1)
    expect(Math.max(...doubled.doubles)).toBeLessThanOrEqual(0.22 + dt)
    expect(Math.max(...doubled.durations)).toBeLessThanOrEqual(0.35 + dt)
  })

  it('slows breath phase without changing its wandering-period draws', () => {
    const normal = new NaturalBreathLayer(createRandomStream(18))
    const slow = new NaturalBreathLayer(createRandomStream(18))
    slow.periodScale = 2
    let phase = 0

    for (let i = 0; i < 10000; i++) {
      normal.step(dt)
      const output = slow.step(dt)
      phase = (phase + 2 * Math.PI * dt / (normal.period * 2)) % (2 * Math.PI)
      expect(output.value).toBe(0.45 + 0.12 * Math.sin(phase))
      expect(slow.period).toBe(normal.period)
    }
  })

  it('scales accepted speech pulses without changing their seeded timing', () => {
    const normal = new NaturalSpeechEmphasis(createRandomStream(19))
    const doubled = new NaturalSpeechEmphasis(createRandomStream(19))
    doubled.sizeScale = 2
    let peak = 0

    for (let i = 0; i < 10000; i++) {
      const level = i * dt % 0.3 < 0.12 ? 0.9 : 0
      const a = normal.step(dt, level, 1)
      const b = doubled.step(dt, level, 1)
      peak = Math.max(peak, Math.hypot(...b))
      expect(b).toEqual(a.map(value => value * 2))
    }

    expect(peak).toBeGreaterThan(0.05)
    expect(doubled.emphasisCount).toBe(normal.emphasisCount)
  })
})
