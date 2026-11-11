import type { PerformanceLayer } from './stack'

import { describe, expect, it } from 'vitest'

import { ARM_START, BODY_CHANNELS, BODY_TICK, channelIndex, DEG } from './channels'
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
