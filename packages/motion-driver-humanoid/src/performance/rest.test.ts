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
    // The first sink starts after the 1.5 s entry and reaches 4f's 18 degrees on the 5 degree droop within its 4 to
    // 9 s, then recovers to the droop past its 3 degree overshoot.
    const first = head.slice(at(3.5), at(13))
    expect(Math.max(...first)).toBeGreaterThan(20)
    expect(Math.min(...head.slice(at(13), at(40)))).toBeLessThan(5)
    expect(Math.min(...head.slice(at(13), at(40)))).toBeGreaterThan(0)
    // The pelvis drops 4f's 0.012 L and the stand-life pass's 0.002 L, and further while a nod sinks (the knees give).
    // Re-pinned from 4f's -0.012: the doze sinks on softer knees so it reads apart from standing (stand-life rank 8).
    const pelvis = doze.map((frame, k) => frame.channels[c('pelvisY')] - still[k].channels[c('pelvisY')])
    expect(Math.max(...pelvis.slice(at(13), at(40)))).toBeCloseTo(-0.014, 3)
  })

  it('takes the knees and chest down with each doze nod and straightens them on its catch', () => {
    const still = run(quietInput, 40)
    const doze = run(resting('doze', 2, 40, quietInput), 40)
    const delta = (k: number, channel: Parameters<typeof c>[0]) => doze[k].channels[c(channel)] - still[k].channels[c(channel)]
    const head = doze.map((_, k) => delta(k, 'headPitch'))
    const deepest = at(3.5) + head.slice(at(3.5), at(13)).indexOf(Math.max(...head.slice(at(3.5), at(13))))
    const after = deepest + at(2)
    // At the bottom of the nod the pelvis is 0.005 L lower and the chest rounder than once the head has caught itself.
    expect(delta(after, 'pelvisY') - delta(deepest, 'pelvisY')).toBeGreaterThan(0.005)
    expect((delta(deepest, 'upperPitch') - delta(after, 'upperPitch')) / DEG).toBeGreaterThan(1)
  })

  it('settles a rest from the pelvis up, the head last, and on waking lifts the chest before the head', () => {
    const still = run(quietInput, 30)
    const rest = run(resting('rest', 2, 20, quietInput), 30)
    const delta = (channel: Parameters<typeof c>[0]) => rest.map((frame, k) => frame.channels[c(channel)] - still[k].channels[c(channel)])
    const parts = { pelvis: delta('lowerPitch'), chest: delta('midPitch'), head: delta('headPitch') }
    const crossing = (values: number[], from: number, rising: boolean) => {
      const half = values[at(15)] / 2
      return (values.slice(from).findIndex(v => rising ? v >= half : v <= half)) * BODY_TICK
    }
    const entry = Object.fromEntries(Object.entries(parts).map(([part, values]) => [part, crossing(values, at(2), true)]))
    expect(entry.pelvis).toBeLessThan(entry.chest - 0.15)
    expect(entry.chest).toBeLessThan(entry.head - 0.15)
    const wake = { chest: crossing(parts.chest, at(20), false), head: crossing(parts.head, at(20), false) }
    expect(wake.chest).toBeLessThan(wake.head - 0.2)
    // Settled, the chest is rounded and the shoulders forward, so a still tells her from standing.
    expect((parts.chest[at(15)] + delta('upperPitch')[at(15)]) / DEG).toBeGreaterThan(3)
    expect(delta('leftClavProt')[at(15)] / DEG).toBeGreaterThan(2)
  })

  it('rests with the chest dropped, the shoulders forward, the arms hanging heavy and the head tilted over the stance leg', () => {
    const rig = fixtureRigs[0].traits
    // A seed whose rest keeps the hands hanging (the other half clasp them).
    const seed = Array.from({ length: 8 }, (_, k) => k + 1).find(k => run(resting('rest', 2, 30, quietInput), 12, { traits: rig, seed: k })[at(10)].hands === 0)!
    const rest = run(resting('rest', 2, 30, quietInput), 12, { traits: rig, seed })
    const k = at(10)
    const stance = Math.sign(rest[k].support)
    // Against a still standing on the same leg, so the posture's contrapposto is the same in both.
    const still = run(t => ({ ...quietInput(t), posture: { amplitude: 0, shiftRate: 0, support: stance } }), 12, { traits: rig, seed })
    const delta = (channel: Parameters<typeof c>[0]) => (rest[k].channels[c(channel)] - still[k].channels[c(channel)]) / DEG
    expect(delta('midPitch') + delta('upperPitch')).toBeGreaterThan(5)
    for (const side of ['left', 'right'] as const) {
      expect(delta(`${side}ClavProt`), side).toBeGreaterThan(5)
      // The upper arms roll in, so the backs of the hands come round to the front.
      expect(delta(`${side}Twist`), side).toBeGreaterThan(4)
    }
    // Over the stance leg the contrapposto already has that arm long, near its joint limit; the other elbow lets go.
    const free = stance > 0 ? 'left' : 'right'
    expect(delta(`${free}Elbow`)).toBeLessThan(-4)
    // Positive support stands her on the right foot; a positive roll tilts the head toward her right.
    expect(stance * (delta('headRoll') + delta('neckRoll'))).toBeGreaterThan(3)
  })

  it('wakes from a rest onto a soft half stance on the leg she rested on, the free heel down, instead of staying on one leg', () => {
    // The posture's own schedule holds the support she wakes onto: no shifts of its own, no fixed support.
    const frames = run(resting('rest', 2, 20, t => ({ ...quietInput(t), posture: { amplitude: 0, shiftRate: 0, support: null } })), 30)
    const rested = frames[at(18)].support
    expect(Math.abs(rested)).toBeGreaterThan(0.9)
    const woken = frames[at(25)]
    expect(woken.support * Math.sign(rested)).toBeGreaterThan(0.5)
    expect(woken.support * Math.sign(rested)).toBeLessThan(0.7)
    // The free foot's heel, lifted while she rested on one leg, is down.
    const free = rested > 0 ? 'leftFootPitch' : 'rightFootPitch'
    expect(frames[at(18)].channels[c(free)] / DEG).toBeLessThan(-3)
    expect(woken.channels[c(free)] / DEG).toBeGreaterThan(-1)
  })

  it('keeps the dozing knees and chest giving through the long pauses between nods', () => {
    const still = run(quietInput, 60)
    const doze = run(resting('doze', 2, 60, quietInput), 60)
    const delta = (k: number, channel: Parameters<typeof c>[0]) => doze[k].channels[c(channel)] - still[k].channels[c(channel)]
    // The head rests on its droop between nods: find the longest stretch where it stays within a degree of it.
    const head = doze.map((_, k) => (delta(k, 'headPitch') + delta(k, 'neckPitch')) / DEG)
    let best = [0, 0]
    let from = -1
    for (let k = at(4); k < head.length; k++) {
      const resting = Math.abs(head[k] - 5) < 1
      if (resting && from < 0)
        from = k
      if ((!resting || k === head.length - 1) && from >= 0) {
        if (k - from > best[1] - best[0])
          best = [from, k]
        from = -1
      }
    }
    expect((best[1] - best[0]) * BODY_TICK).toBeGreaterThan(6)
    const pause = doze.slice(best[0], best[1]).map((_, i) => best[0] + i)
    const range = (values: number[]) => Math.max(...values) - Math.min(...values)
    expect(range(pause.map(k => delta(k, 'pelvisY')))).toBeGreaterThan(0.0008)
    expect(range(pause.map(k => delta(k, 'midPitch'))) / DEG).toBeGreaterThan(0.4)
  })
})
