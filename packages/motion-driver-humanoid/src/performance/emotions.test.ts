import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { BodyPerformanceInput } from './contracts'
import type { MergedPerformancePlan, PerformanceLayer } from './stack'

import { PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { BODY_CHANNELS, channelGroup, channelIndex, DEG } from './channels'
import { createEmotionLayer } from './emotions'
import { createBodyPerformer } from './index'
import { channelTrace, fixtureRigs, idleInput, quietInput } from './performance.test-fixtures'

const traits = fixtureRigs[0].traits
const c = channelIndex
type Script = (t: number) => BodyPerformanceInput

const ramp = (t: number, from: number, seconds = 0.3) => Math.min(1, Math.max(0, (t - from) / seconds))

function held(emotion: PerformanceEmotion, level: (t: number) => number, side = 1, base: Script = quietInput): Script {
  return t => ({ ...base(t), held: { emotion, strength: 1, level: level(t), side } })
}

function pulse(emotion: PerformanceEmotion, at: number, band: 'slight' | 'clear' | 'strong' = 'clear', side = 1): Script {
  return (t) => {
    const input = quietInput(t)
    return { ...input, events: { ...input.events, impulse: t < at ? null : { seq: 1, at, emotion, intensity: 0.6, band, side } } }
  }
}

function layerEffect(script: Script, seconds: number) {
  const base = channelTrace(createBodyPerformer({ traits, seed: 1 }), seconds, script)
  const layered = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [createEmotionLayer()] }), seconds, script)
  return layered.map((trace, channel) => trace.map((v, i) => v - base[channel][i]))
}

const largest = (traces: number[][], tick: number) => Math.max(...traces.map(trace => Math.abs(trace[tick])))

describe('emotion posture layer', () => {
  it('changes nothing while no emotion is held or pulsed', () => {
    const base = channelTrace(createBodyPerformer({ traits, seed: 1 }), 20, idleInput)
    const layered = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [createEmotionLayer()] }), 20, idleInput)
    expect(layered).toEqual(base)
  })

  it('moves the body for every held emotion except neutral, which writes nothing', () => {
    for (const emotion of PERFORMANCE_EMOTIONS) {
      const d = layerEffect(held(emotion, t => ramp(t, 0.5)), 5)
      if (emotion === 'neutral')
        expect(largest(d, 599)).toBe(0)
      else
        expect(largest(d, 599), emotion).toBeGreaterThan(2 * DEG)
    }
  })

  it('first moves against the posture where its response anticipates, and overshoots where it is underdamped', () => {
    const happy = layerEffect(held('happy', t => ramp(t, 0.5)), 5)
    const lift = happy[c('lowerPitch')].map((v, i) => v + happy[c('midPitch')][i])
    const settled = lift[599]
    expect(settled).toBeLessThan(0)
    const first = lift.find(v => Math.abs(v) > 1e-4) ?? 0
    expect(Math.sign(first)).toBe(-Math.sign(settled))

    const surprised = layerEffect(held('surprised', t => ramp(t, 0.5, 0.05)), 5)[c('leftClavElev')]
    expect(Math.max(...surprised)).toBeGreaterThan(1.05 * surprised[599])
  })

  it('leans think toward its side and lifts awkward\'s side shoulder', () => {
    const roll = (side: number) => layerEffect(held('think', t => ramp(t, 0.5), side), 5)[c('lowerRoll')][599]
    expect(roll(1)).toBeGreaterThan(1 * DEG)
    expect(roll(-1)).toBeCloseTo(-roll(1), 6)
    const awkward = layerEffect(held('awkward', t => ramp(t, 0.5), 1), 5)
    expect(awkward[c('rightClavElev')][599]).toBeGreaterThan(awkward[c('leftClavElev')][599] + 2 * DEG)
  })

  it('returns to rest after a held emotion releases', () => {
    const d = layerEffect(held('sad', t => ramp(t, 0.5) * (1 - ramp(t, 4))), 12)
    expect(largest(d, 599)).toBeGreaterThan(2 * DEG)
    expect(largest(d, 1439)).toBeLessThan(0.05 * DEG)
  })

  it('holds an unheld clear pulse at its intensity for the face\'s hold, releases with the face, and ignores a slight pulse', () => {
    const d = layerEffect(pulse('angry', 0.5), 10)
    const heldAtIntensity = layerEffect(t => ({ ...quietInput(t), held: { emotion: 'angry', strength: 0.6, level: ramp(t, 0.5, 0.05), side: 1 } }), 3)
    const pitch = d[c('lowerPitch')]
    // Clear band: head tau 0.38 s, face hold 1.2 s, face release tau 0.5 s (stage-shared naturalBands).
    const inHold = Math.round((0.5 + 1.15) * 120)
    expect(pitch[inHold] / heldAtIntensity[c('lowerPitch')][inHold]).toBeCloseTo(1, 1)
    expect(largest(d, Math.round(8.5 * 120) - 1)).toBeLessThan(0.05 * DEG)
    // A value and slope continuous envelope through angry's 2.2 Hz response bends no faster than omega^2 times its size.
    const peak = Math.max(...pitch.map(Math.abs))
    const bend = Math.max(...pitch.slice(2).map((v, i) => Math.abs(v - 2 * pitch[i + 1] + pitch[i])))
    expect(bend).toBeLessThan(2 * peak * (2 * Math.PI * 2.2 / 120) ** 2)
    expect(largest(layerEffect(pulse('angry', 0.5, 'slight'), 3), 359)).toBe(0)
  })

  it('writes no term to an owned group', () => {
    const owned = { root: 1, lowerBody: 1, leftLegIk: 1, rightLegIk: 1, upperBody: 1, head: 1, leftArm: 1, rightArm: 1, leftFingers: 0, rightFingers: 1 }
    const d = layerEffect(t => ({ ...held('angry', s => ramp(s, 0.5))(t), owned }), 5)
    for (let channel = 0; channel < BODY_CHANNELS.length; channel++) {
      if (owned[channelGroup(BODY_CHANNELS[channel])] === 1)
        expect(Math.max(...d[channel].map(Math.abs)), BODY_CHANNELS[channel]).toBe(0)
    }
    expect(Math.max(...d[c('leftIndex1')].map(Math.abs))).toBeGreaterThan(1 * DEG)
  })

  it('requests the thinking hand and the hand to chest above weight 0.5, on the emotion\'s side', () => {
    const forms = (emotion: PerformanceEmotion, strength: number, side: number) => {
      const seen: MergedPerformancePlan['armForm'][] = []
      const recorder: PerformanceLayer = {
        id: 'recorder',
        order: 'reaction',
        mode: 'additive',
        mask: new Float64Array(BODY_CHANNELS.length),
        step: (context) => {
          seen.push(context.plan.armForm)
          return { channels: new Float64Array(BODY_CHANNELS.length), weight: 0, sequence: 0 }
        },
        reset() {},
      }
      channelTrace(createBodyPerformer({ traits, seed: 1, layers: [createEmotionLayer(), recorder] }), 5, t => ({ ...quietInput(t), held: { emotion, strength, level: ramp(t, 0.5), side } }))
      return seen.at(-1)
    }
    expect(forms('think', 0.6, -1)).toEqual({ side: 'left', form: 'thinking-hand' })
    expect(forms('think', 0.4, -1)).toBeNull()
    expect(forms('love', 0.6, 1)).toEqual({ side: 'right', form: 'hand-to-chest' })
    expect(forms('love', 0.4, 1)).toBeNull()
  })

  it('reports an onset when an emotion starts and a release when it ends', () => {
    const performer = createBodyPerformer({ traits, seed: 1, layers: [createEmotionLayer()] })
    const script = held('happy', t => ramp(t, 0.5) * (1 - ramp(t, 2)))
    const reports: string[] = []
    for (let tick = 0; tick < 6 * 120; tick++) {
      const { emotion } = performer.step(script(tick / 120)).diagnostics
      const last = reports.at(-1)
      const entry = `${emotion.seq}:${emotion.emotion}:${emotion.phase}`
      if (entry !== last)
        reports.push(entry)
    }
    expect(reports).toEqual(['0:null:null', '1:happy:onset', '2:happy:release'])
  })
})
