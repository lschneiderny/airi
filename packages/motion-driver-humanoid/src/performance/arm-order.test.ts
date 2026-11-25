import type { HandShape } from './hand-shapes'
import type { PerformanceLayer } from './stack'

import { describe, expect, it } from 'vitest'

import { ARM_START, BODY_CHANNELS, BODY_TICK, channelIndex, DEG } from './channels'
import { writeHandShape } from './hand-shapes'
import { createBodyPerformer } from './index'
import { channelTrace, fixtureRigs, lagOf, quietInput } from './performance.test-fixtures'

const breathOnly = (time: number) => ({ ...quietInput(time), breath: { phase: time * 2 * Math.PI / 4, period: 4, scale: 1 } })

/** An override layer that moves the left arm by one key at its first tick and holds it: the shared driver of a preparation. */
function keyStep(): PerformanceLayer {
  const mask = new Float64Array(BODY_CHANNELS.length)
  mask.fill(1, ARM_START.left, ARM_START.left + 26)
  const target = new Float64Array(BODY_CHANNELS.length)
  let armed = false
  return {
    id: 'key-step',
    order: 'gesture',
    mode: 'override',
    mask,
    step: (context) => {
      if (!armed) {
        armed = true
        target.set(context.previous.channels)
        const start = ARM_START.left
        target[start + 2] += 40 * DEG
        target[start + 3] += 10 * DEG
        target[start + 5] += 60 * DEG
        target[start + 6] += 30 * DEG
      }
      return { channels: target, weight: 1, sequence: 1 }
    },
    reset: () => {
      armed = false
    },
  }
}

/**
 * An additive layer that holds the left hand in `shape` from the start and, when `swing`, flexes the wrist 30 degrees at
 * one second: a hand swung while its fingers stay passive (an additive layer leaves the trail its activation).
 */
function swungHand(shape: HandShape, swing: boolean): PerformanceLayer {
  const mask = new Float64Array(BODY_CHANNELS.length)
  mask.fill(1, ARM_START.left, ARM_START.left + 26)
  const out = new Float64Array(BODY_CHANNELS.length)
  const pose = new Float64Array(26)
  writeHandShape(shape, pose)
  return {
    id: 'swung-hand',
    order: 'emotion',
    mode: 'additive',
    enterSeconds: 0,
    mask,
    step: (context) => {
      const start = ARM_START.left
      for (let j = 9; j < 26; j++)
        out[start + j] = pose[j] - context.rest[start + j]
      out[start + 7] = swing && context.time >= 1 ? 30 * DEG : 0
      return { channels: out, weight: 1, sequence: 1 }
    },
    reset: () => {},
  }
}

describe('arm chain order', () => {
  it.each(fixtureRigs)('makes the forearm follow the upper arm in breath-only motion on $name', ({ traits }) => {
    const traces = channelTrace(createBodyPerformer({ traits, seed: 1 }), 24, breathOnly)
    const settled = (channel: Parameters<typeof channelIndex>[0], sign = 1) => traces[channelIndex(channel)].slice(Math.round(8 / BODY_TICK)).map(v => sign * v)
    // Breath (3c) adducts the upper arm and flexes the elbow on the same link: compare the elbow with -abduct.
    const lag = lagOf(settled('leftAbduct', -1), settled('leftElbow'))
    // A forearm swinging with the plumb line's counter-rotation led by 117 ms (14 ticks), and the faster elbow follower
    // alone by 17 ms (2 ticks). The cascade delays the elbow's share by the head start plus 4a's 30 ms start offset.
    expect(lag).toBeGreaterThanOrEqual(2)
  })

  it.each(fixtureRigs)('peaks a shared key step at the upper arm, then the elbow, then the forearm twist on $name', ({ traits }) => {
    const stepped = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [keyStep()] }), 3, quietInput)
    const still = channelTrace(createBodyPerformer({ traits, seed: 1 }), 3, quietInput)
    const peak = (channel: Parameters<typeof channelIndex>[0]) => {
      const a = stepped[channelIndex(channel)]
      const b = still[channelIndex(channel)]
      let best = 0
      let at = 0
      for (let i = 1; i < a.length; i++) {
        const speed = Math.abs(a[i] - b[i] - a[i - 1] + b[i - 1])
        if (speed > best) {
          best = speed
          at = i
        }
      }
      return at
    }
    // Without the cascade all three peak on the same tick: the shared target reaches every follower at once.
    expect(peak('leftElbow')).toBeGreaterThan(peak('leftFlex'))
    expect(peak('leftPron')).toBeGreaterThan(peak('leftElbow'))
  })
})

describe('finger follow-through', () => {
  const { traits } = fixtureRigs[0]
  const index = ['leftIndex0', 'leftIndex1', 'leftIndex2'] as const
  /** Each index joint's largest trail behind the swung wrist (degrees, signed) and the tick it peaks on. */
  function trail(shape: HandShape, tension: number) {
    const input = (time: number) => ({ ...quietInput(time), mood: { valence: 0, arousal: 0, tension } })
    const swung = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [swungHand(shape, true)] }), 3, input)
    const held = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [swungHand(shape, false)] }), 3, input)
    return index.map((name) => {
      const c = channelIndex(name)
      let peak = 0
      let at = 0
      for (let i = 0; i < swung[c].length; i++) {
        const d = (swung[c][i] - held[c][i]) / DEG
        if (Math.abs(d) > Math.abs(peak)) {
          peak = d
          at = i
        }
      }
      return { peak, at }
    })
  }

  it('trails a palmar wrist swing with a few degrees of extension that grows and arrives later toward the tip', () => {
    const [knuckle, middle, tip] = trail('relaxed', 0.4)
    expect(knuckle.peak).toBeLessThan(0)
    expect(Math.abs(tip.peak)).toBeLessThan(5)
    expect(Math.abs(middle.peak)).toBeGreaterThan(Math.abs(knuckle.peak))
    expect(Math.abs(tip.peak)).toBeGreaterThan(Math.abs(middle.peak))
    expect(middle.at).toBeGreaterThan(knuckle.at)
    expect(tip.at).toBeGreaterThan(middle.at)
  })

  it('trails less on a tense hand', () => {
    const loose = trail('relaxed', 0.4)
    const tense = trail('relaxed', 0.9)
    for (let k = 0; k < 3; k++)
      expect(Math.abs(tense[k].peak)).toBeLessThan(0.7 * Math.abs(loose[k].peak))
  })

  it('leaves a fist closed', () => {
    for (const { peak } of trail('fist', 0.4))
      expect(Math.abs(peak)).toBeLessThan(0.05)
  })
})

describe('wrist follow-through', () => {
  const { traits } = fixtureRigs[0]
  /** An additive layer that swings the left arm as a walk does, 0.9 Hz, the elbow bending as the arm swings forward. */
  function walkSwing(size: number): PerformanceLayer {
    const mask = new Float64Array(BODY_CHANNELS.length)
    mask.fill(1, ARM_START.left, ARM_START.left + 9)
    const out = new Float64Array(BODY_CHANNELS.length)
    return {
      id: 'walk-swing',
      order: 'emotion',
      mode: 'additive',
      enterSeconds: 0,
      mask,
      step: (context) => {
        const phase = Math.sin(2 * Math.PI * 0.9 * context.time)
        out[ARM_START.left + 2] = size * 20 * DEG * phase
        out[ARM_START.left + 5] = size * 10 * DEG * (1 + phase)
        return { channels: out, weight: 1, sequence: 1 }
      },
      reset: () => {},
    }
  }
  /** The hand's deviation from the still arm's (degrees) and the forearm's swing rate, over the settled seconds. */
  function trail(tension: number) {
    const input = (time: number) => ({ ...quietInput(time), mood: { valence: 0, arousal: 0, tension } })
    const swung = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [walkSwing(1)] }), 6, input)
    const held = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [walkSwing(0)] }), 6, input)
    const from = Math.round(2 / BODY_TICK)
    const flex = swung[channelIndex('leftFlex')]
    const elbow = swung[channelIndex('leftElbow')]
    const wdev = channelIndex('leftWdev')
    const bend: number[] = []
    const rate: number[] = []
    for (let i = from; i < flex.length; i++) {
      bend.push((swung[wdev][i] - held[wdev][i]) / DEG)
      rate.push((flex[i] + elbow[i] - flex[i - 1] - elbow[i - 1]) / BODY_TICK)
    }
    return { bend, rate }
  }
  const correlation = (a: readonly number[], b: readonly number[]) => {
    const mean = (x: readonly number[]) => x.reduce((s, v) => s + v, 0) / x.length
    const ma = mean(a)
    const mb = mean(b)
    let ab = 0
    let aa = 0
    let bb = 0
    for (let i = 0; i < a.length; i++) {
      ab += (a[i] - ma) * (b[i] - mb)
      aa += (a[i] - ma) ** 2
      bb += (b[i] - mb) ** 2
    }
    return ab / Math.sqrt(aa * bb)
  }

  it('bends the hand back while the forearm swings forward and forward while it swings back', () => {
    // A positive deviation bends the hand back on the forearm: the hand lags the swing instead of leading it in a wave.
    const { bend, rate } = trail(0.4)
    expect(correlation(bend, rate)).toBeGreaterThan(0.7)
    expect(Math.max(...bend)).toBeGreaterThan(3)
  })

  it('trails less on a tense hand', () => {
    const span = (x: readonly number[]) => Math.max(...x) - Math.min(...x)
    expect(span(trail(0.9).bend)).toBeLessThan(0.7 * span(trail(0.4).bend))
  })
})
