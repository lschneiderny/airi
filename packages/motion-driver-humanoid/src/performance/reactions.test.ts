import type { BodyPerformanceInput } from './contracts'

import { describe, expect, it } from 'vitest'

import { BODY_CHANNELS, channelGroup, channelIndex, DEG } from './channels'
import { createBodyPerformer } from './index'
import { channelTrace, fixtureRigs, quietInput } from './performance.test-fixtures'
import { createReactionLayer } from './reactions'

const traits = fixtureRigs[0].traits
const c = channelIndex
type Script = (t: number) => BodyPerformanceInput

interface Poke { readonly at: number, readonly region: 'head' | 'body', readonly x: number, readonly y: number }

/** Pokes as Natural reports them; a head poke also carries Natural's head nudge (about 2.3 deg of yaw away from +x). */
function poking(pokes: readonly Poke[], base: Script = quietInput): Script {
  return (t) => {
    const input = base(t)
    const done = pokes.filter(p => t >= p.at)
    const last = done.at(-1)
    const head = done.findLast(p => p.region === 'head')
    const age = head ? (t - head.at) / 0.15 : 0
    const nudge = head ? -0.04 * Math.sign(head.x || 1) * age * age * Math.exp(2 * (1 - age)) : 0
    return {
      ...input,
      head: { ...input.head, terms: { ...input.head.terms, impulse: { yaw: nudge, pitch: 0, roll: 0 } } },
      events: { ...input.events, poke: last ? { seq: done.length, at: last.at, region: last.region, x: last.x, y: last.y } : null },
    }
  }
}

function petting(level: number, x: number): Script {
  return (t) => {
    const input = quietInput(t)
    const l = Math.min(1, Math.max(0, (t - 0.5) / 0.5)) * level
    return { ...input, events: { ...input.events, pet: { level: l, active: l > 0, x, y: 0 } } }
  }
}

function layerEffect(script: Script, seconds: number) {
  const base = channelTrace(createBodyPerformer({ traits, seed: 1 }), seconds, script)
  const layered = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [createReactionLayer()] }), seconds, script)
  return layered.map((trace, channel) => trace.map((v, i) => v - base[channel][i]))
}

const peak = (values: readonly number[]) => values.reduce((best, v) => Math.abs(v) > Math.abs(best) ? v : best, 0)
const trunk = ['lowerYaw', 'lowerPitch', 'lowerRoll', 'midYaw', 'midPitch', 'midRoll', 'upperYaw', 'upperPitch', 'upperRoll'] as const

describe('touch reaction layer', () => {
  it('flinches away from a body poke, lifting the poked side\'s shoulder, and returns to rest', () => {
    for (const x of [-1, 1]) {
      const d = layerEffect(poking([{ at: 0.5, region: 'body', x, y: 0 }]), 4)
      // Natural turns and rolls the head away from +x with negative yaw and roll; the trunk flinches the same way.
      expect(Math.sign(peak(d[c('midRoll')]))).toBe(-x)
      expect(Math.sign(peak(d[c('midYaw')]))).toBe(-x)
      expect(Math.sign(peak(d[c('pelvisX')]))).toBe(x)
      const [poked, other] = x > 0 ? ['rightClavElev', 'leftClavElev'] as const : ['leftClavElev', 'rightClavElev'] as const
      expect(peak(d[c(poked)])).toBeGreaterThan(2 * DEG)
      expect(peak(d[c(other)])).toBe(0)
      expect(Math.max(...d.map(trace => Math.abs(trace.at(-1) ?? 0)))).toBeLessThan(1e-3 * DEG)
    }
  })

  it('peaks at the 3.5 Hz flinch response\'s peak time and rings once', () => {
    const roll = layerEffect(poking([{ at: 0.5, region: 'body', x: 1, y: 0 }]), 2)[c('midRoll')]
    const at = roll.indexOf(peak(roll)) / 120 - 0.5
    // A step through f 3.5 Hz and damping 0.45 peaks at pi / omega_d = 0.16 s (architecture 4d's "about 80 ms" is not
    // what its own response gives); the per-tick slope limit of the 3a filter adds about a frame.
    const peakTime = Math.PI / (2 * Math.PI * 3.5 * Math.sqrt(1 - 0.45 ** 2))
    expect(at).toBeGreaterThan(peakTime - 0.03)
    expect(at).toBeLessThan(peakTime + 0.03)
    const after = roll.slice(roll.indexOf(peak(roll)))
    expect(Math.sign(peak(after.map(v => Math.sign(v) === Math.sign(peak(roll)) ? 0 : v)))).toBe(-Math.sign(peak(roll)))
  })

  it('bends the belly in on a low poke', () => {
    const d = layerEffect(poking([{ at: 0.5, region: 'body', x: 0.2, y: 0.6 }]), 2)
    expect(peak(d[c('lowerPitch')])).toBeGreaterThan(2 * DEG)
    expect(peak(d[c('pelvisZ')])).toBeLessThan(0)
  })

  it('moves the trunk more for a body poke than for a head poke, and a repeated poke less than the first', () => {
    const trunkPeak = (d: number[][], from = 0, to = d[0].length) => Math.max(...trunk.map(name => Math.abs(peak(d[c(name)].slice(from, to)))))
    const body = layerEffect(poking([{ at: 0.5, region: 'body', x: 1, y: 0 }]), 3)
    const head = layerEffect(poking([{ at: 0.5, region: 'head', x: 1, y: 0 }]), 3)
    expect(trunkPeak(head)).toBeGreaterThan(0.1 * DEG)
    expect(trunkPeak(body)).toBeGreaterThan(2 * trunkPeak(head))
    const twice = layerEffect(poking([{ at: 0.5, region: 'body', x: 1, y: 0 }, { at: 2, region: 'body', x: 1, y: 0 }]), 4)
    expect(trunkPeak(twice, 240, 480) / trunkPeak(twice, 0, 240)).toBeCloseTo(0.6, 1)
  })

  it('drops the shoulders further the more she is petted, and leans toward the hand', () => {
    const drop = [0.25, 0.5, 1].map(level => layerEffect(petting(level, 1), 3)[c('rightClavElev')].at(-1) ?? 0)
    expect(drop[0]).toBeLessThan(0)
    expect(drop[1]).toBeLessThan(drop[0])
    expect(drop[2]).toBeLessThan(drop[1])
    const performer = createBodyPerformer({ traits, seed: 1, layers: [createReactionLayer()] })
    const script = petting(1, 1)
    let target = 0
    for (let tick = 0; tick < 3 * 120; tick++)
      target = performer.step(script(tick / 120)).diagnostics.shiftTarget
    expect(target).toBe(1)
  })

  it('writes no term to an owned group', () => {
    const owned = { root: 1, lowerBody: 1, leftLegIk: 1, rightLegIk: 1, upperBody: 1, head: 1, leftArm: 1, rightArm: 1, leftFingers: 1, rightFingers: 1 }
    const d = layerEffect(t => ({ ...poking([{ at: 0.5, region: 'body', x: 1, y: 0.6 }])(t), owned }), 2)
    for (let channel = 0; channel < BODY_CHANNELS.length; channel++) {
      if (owned[channelGroup(BODY_CHANNELS[channel])] === 1)
        expect(Math.max(...d[channel].map(Math.abs)), BODY_CHANNELS[channel]).toBe(0)
    }
  })

  it('reports each poke and the start of a pet', () => {
    const performer = createBodyPerformer({ traits, seed: 1, layers: [createReactionLayer()] })
    const pokes = poking([{ at: 0.5, region: 'body', x: 1, y: 0 }, { at: 1, region: 'head', x: 1, y: 0 }])
    const seen: string[] = []
    for (let tick = 0; tick < 3 * 120; tick++) {
      const t = tick / 120
      const input = pokes(t)
      const { reaction } = performer.step(t < 2 ? input : petting(1, 1)(t)).diagnostics
      const entry = `${reaction.seq}:${reaction.kind}`
      if (seen.at(-1) !== entry)
        seen.push(entry)
    }
    expect(seen).toEqual(['0:null', '1:body-poke', '2:head-poke', '3:pet'])
  })
})
