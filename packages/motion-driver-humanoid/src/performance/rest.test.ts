import type { BodyPerformanceInput, BodyRest } from './contracts'

import { describe, expect, it } from 'vitest'

import { BODY_TICK, channelIndex, DEG } from './channels'
import { createBodyPerformer } from './index'
import { createPerformanceLayers } from './layers'
import { chisaTraits, idleInput, quietInput } from './performance.test-fixtures'

const c = channelIndex

/** The director's rest from `from` to `to` seconds, on an otherwise idle (or `base`) body. */
function resting(rest: BodyRest, from: number, to: number, base = idleInput) {
  return (t: number): BodyPerformanceInput => {
    const input = base(t)
    return t >= from && t < to ? { ...input, directive: { ...input.directive, rest } } : input
  }
}

function run(script: (t: number) => BodyPerformanceInput, seconds: number) {
  const performer = createBodyPerformer({ traits: chisaTraits, seed: 5, layers: createPerformanceLayers({ traits: chisaTraits, seed: 5 }) })
  const frames: { channels: Float32Array, support: number }[] = []
  for (let tick = 0; tick < seconds / BODY_TICK; tick++) {
    const frame = performer.step(script(tick * BODY_TICK))
    frames.push({ channels: frame.channels.slice(), support: frame.support })
  }
  return frames
}

const at = (seconds: number) => Math.round(seconds / BODY_TICK)

describe('the rest layer', () => {
  it('rests on one leg with the torso and shoulders lowered while the director rests her, and lets go after', () => {
    const still = run(idleInput, 30)
    const rest = run(resting('rest', 2, 20), 30)
    const lower = (k: number) => (rest[k].channels[c('lowerPitch')] - still[k].channels[c('lowerPitch')]) / DEG
    // Architecture 4f: the support goes fully to one side and the torso lower drops 3 degrees, over a 1.5 s ramp.
    expect(Math.abs(rest[at(15)].support)).toBeGreaterThan(0.9)
    expect(lower(at(15))).toBeGreaterThan(2.5)
    expect(lower(at(2) + 1)).toBeLessThan(0.05)
    expect(Math.abs(lower(at(25)))).toBeLessThan(0.1)
  })

  it('dozes with the pelvis dropped and the head sinking in nod-offs that recover', () => {
    // A quiet base holds the support still: the posture lowers the pelvis 0.0065 L per unit of support shift.
    const still = run(quietInput, 40)
    const doze = run(resting('doze', 2, 40, quietInput), 40)
    const head = doze.map((frame, k) => (frame.channels[c('headPitch')] + frame.channels[c('neckPitch')] - still[k].channels[c('headPitch')] - still[k].channels[c('neckPitch')]) / DEG)
    // The first sink starts after the 1.5 s entry and reaches 4f's 18 degrees within its 4 to 9 s, then recovers.
    const first = head.slice(at(3.5), at(13))
    expect(Math.max(...first)).toBeGreaterThan(15)
    expect(Math.min(...head.slice(at(13), at(40)))).toBeLessThan(2)
    expect((doze[at(20)].channels[c('pelvisY')] - still[at(20)].channels[c('pelvisY')])).toBeCloseTo(-0.012, 3)
  })
})
