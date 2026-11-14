import type { BodyFootStep, BodyIdleAct, BodyPerformanceInput, BodyRest, BodyRigTraits } from './contracts'

import { describe, expect, it } from 'vitest'

import { BODY_TICK, channelIndex, DEG } from './channels'
import { createBodyPerformer } from './index'
import { createPerformanceLayers } from './layers'
import { chisaTraits, fixtureRigs, idleInput, quietInput } from './performance.test-fixtures'

const c = channelIndex

/** The director's rest from `from` to `to` seconds, on an otherwise idle (or `base`) body. */
function resting(rest: BodyRest, from: number, to: number, base = idleInput) {
  return (t: number): BodyPerformanceInput => {
    const input = base(t)
    return t >= from && t < to ? { ...input, directive: { ...input.directive, rest } } : input
  }
}

function run(script: (t: number) => BodyPerformanceInput, seconds: number, options: { traits?: BodyRigTraits, seed?: number } = {}) {
  const traits = options.traits ?? chisaTraits
  const seed = options.seed ?? 5
  const performer = createBodyPerformer({ traits, seed, layers: createPerformanceLayers({ traits, seed }) })
  const frames: { channels: Float32Array, support: number, steps: BodyFootStep[], hands: number }[] = []
  for (let tick = 0; tick < seconds / BODY_TICK; tick++) {
    const frame = performer.step(script(tick * BODY_TICK))
    const { activation } = frame.diagnostics.gesture
    frames.push({ channels: frame.channels.slice(), support: frame.support, steps: frame.footSteps.map(step => ({ ...step })), hands: Math.min(activation.left, activation.right) })
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

  it('rests deeper on one leg: the pelvis goes 1.25 times as far over the stance foot as the weight alone takes it, and comes back', () => {
    const still = run(quietInput, 30)
    const rest = run(resting('rest', 2, 20, quietInput), 30)
    // The posture's lateral gain (`posture.ts`): the pelvis moves this many leg lengths per unit of support.
    const gain = 0.38 * Math.abs(chisaTraits.feet.left.ankle.x - chisaTraits.feet.right.ankle.x) / (2 * chisaTraits.legLength)
    const pelvis = (k: number) => rest[k].channels[c('pelvisX')] - still[k].channels[c('pelvisX')]
    expect(pelvis(at(15)) / (-gain * rest[at(15)].support)).toBeCloseTo(1.25, 2)
    expect(Math.abs(pelvis(at(28)))).toBeLessThan(0.001)
  })

  it('changes legs through a foot re-plant while she rests, and rests on the new leg after it (4f, 4e act 3)', () => {
    const before = run(resting('rest', 2, 30, quietInput), 10)
    const stance = Math.sign(before[at(9)].support)
    // Natural draws the act's side; resting, the act takes her weight to the other leg whichever side it drew.
    const act: BodyIdleAct = { seq: 1, kind: 'shift-stance', duration: 1.5, release: null, side: stance > 0 ? 1 : -1, period: 2, count: 1, variant: 0, keys: [], glances: [] }
    const script = (t: number) => {
      const input = resting('rest', 2, 30, quietInput)(t)
      return t >= 10 ? { ...input, idle: act } : input
    }
    const frames = run(script, 20)
    const steps = frames.flatMap(frame => frame.steps)
    // The foot she stood on, once unloaded, re-plants.
    expect(steps).toHaveLength(1)
    expect(steps[0].foot).toBe(stance > 0 ? 'right' : 'left')
    expect(Math.min(...frames.slice(at(13), at(20)).map(frame => -stance * frame.support))).toBeGreaterThan(0.9)
  })

  it('rests with her hands clasped low in front or hanging, chosen by the seed (4f)', () => {
    const rig = fixtureRigs[0].traits
    const clasped = (seed: number) => run(resting('rest', 2, 30, quietInput), 12, { traits: rig, seed })[at(10)].hands === 1
    const choices = Array.from({ length: 8 }, (_, seed) => clasped(seed + 1))
    expect(choices).toContain(true)
    expect(choices).toContain(false)
    expect(clasped(choices.indexOf(true) + 1)).toBe(true)
    // Hanging hands are the standing hang: no gesture layer holds them.
    expect(run(resting('rest', 2, 30, quietInput), 12, { traits: rig, seed: choices.indexOf(false) + 1 })[at(10)].hands).toBe(0)
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
