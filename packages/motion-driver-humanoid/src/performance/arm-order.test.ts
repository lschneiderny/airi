import { describe, expect, it } from 'vitest'

import { BODY_TICK, channelIndex } from './channels'
import { createBodyPerformer } from './index'
import { channelTrace, fixtureRigs, lagOf, quietInput } from './performance.test-fixtures'

const breathOnly = (time: number) => ({ ...quietInput(time), breath: { phase: time * 2 * Math.PI / 4, period: 4, scale: 1 } })

describe('arm chain order', () => {
  it.each(fixtureRigs)('keeps the forearm from leading the upper arm in breath-only motion on $name', ({ traits }) => {
    const traces = channelTrace(createBodyPerformer({ traits, seed: 1 }), 24, breathOnly)
    const settled = (channel: Parameters<typeof channelIndex>[0], sign = 1) => traces[channelIndex(channel)].slice(Math.round(8 / BODY_TICK)).map(v => sign * v)
    // Breath (3c) adducts the upper arm and flexes the elbow on the same link: compare the elbow with -abduct.
    const lag = lagOf(settled('leftAbduct', -1), settled('leftElbow'))
    // The plumb line holds the upper arm still in the world while breath pitches the chest; a forearm that swung
    // with that counter-rotation would lead the upper arm by about 117 ms (14 ticks). What may remain is the faster
    // elbow follower's head start, tau_upper - tau_elbow = 17 ms (2 ticks) at this tension.
    expect(lag).toBeGreaterThanOrEqual(-2)
  })
})
