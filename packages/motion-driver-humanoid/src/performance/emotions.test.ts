import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { BodyPerformanceInput } from './contracts'
import type { MergedPerformancePlan, PerformanceLayer } from './stack'

import { defaultExpressionPerformanceSettings, PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'
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

/** Unheld clear pulses, each a new Natural impulse record from its time on. */
function pulses(...list: { at: number, emotion: PerformanceEmotion }[]): Script {
  return (t) => {
    const input = quietInput(t)
    const index = list.findLastIndex(p => p.at <= t)
    return { ...input, events: { ...input.events, impulse: index < 0 ? null : { seq: index + 1, at: list[index].at, emotion: list[index].emotion, intensity: 0.6, band: 'clear', side: 1 } } }
  }
}

function armForms(script: Script, seconds: number) {
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
  channelTrace(createBodyPerformer({ traits, seed: 1, layers: [createEmotionLayer(), recorder] }), seconds, script)
  return seen
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

  it('crossfades a hold that switches emotion at full level, releasing the old posture no faster than Natural\'s held release', () => {
    const level = (t: number) => ramp(t, 0.5)
    const switching: Script = t => ({ ...quietInput(t), held: { emotion: t < 3 ? 'curious' : 'love', strength: 0.9, level: level(t), side: 1 } })
    const pitch = layerEffect(switching, 4)[c('lowerPitch')]
    const atSwitch = pitch[3 * 120 - 1]
    // Natural's held release time constant is 0.6 s (stage-shared held.releaseTau): 0.3 s later at least half remains.
    expect(pitch[Math.round(3.3 * 120)]).toBeGreaterThan(0.5 * atSwitch)
  })

  // A slump curls through the thoracic spine while the lumbar spine flexes only mid-range and the pelvis rolls back
  // (Nairn et al. 2013, Manual Therapy 18(6)); E/g3/b2/expectations.md sizes the split and the cap.
  it('curls the sad, sleepy and curious slump through the mid and upper trunk and caps it at 20 degrees', () => {
    const end = 12 * 120 - 1
    for (const emotion of ['sad', 'sleepy', 'curious'] as const) {
      const d = layerEffect(held(emotion, t => ramp(t, 0.5)), 12)
      const [lower, mid, upper] = [d[c('lowerPitch')][end], d[c('midPitch')][end], d[c('upperPitch')][end]]
      const total = lower + mid + upper
      expect(lower / total, emotion).toBeLessThan(0.25)
      expect(upper / total, emotion).toBeGreaterThan(0.15)
      expect(mid, emotion).toBeGreaterThan(lower + upper)
      expect(total, emotion).toBeLessThan(20 * DEG)
    }
  })

  it('keeps the total trunk lean of a clear-weight slump', () => {
    const end = 8 * 120 - 1
    // Weight 0.6 times each scale times 4c's lower plus mid pitch: sad 2.1 x 9, sleepy 3.5 x 7, curious 3.6 x 5.5.
    for (const [emotion, lean] of [['sad', 11.34], ['sleepy', 14.7], ['curious', 11.88]] as const) {
      const d = layerEffect(t => ({ ...quietInput(t), held: { emotion, strength: 0.6, level: ramp(t, 0.5), side: 1 } }), 8)
      const total = d[c('lowerPitch')][end] + d[c('midPitch')][end] + d[c('upperPitch')][end]
      expect(total / DEG, emotion).toBeCloseTo(lean, 0)
    }
  })

  it('returns to rest after a held emotion releases', () => {
    const d = layerEffect(held('sad', t => ramp(t, 0.5) * (1 - ramp(t, 4))), 12)
    expect(largest(d, 599)).toBeGreaterThan(2 * DEG)
    expect(largest(d, 1439)).toBeLessThan(0.05 * DEG)
  })

  it('holds an unheld clear pulse at its intensity as long as the held face, releases with it, and ignores a slight pulse', () => {
    const d = layerEffect(pulse('angry', 0.5), 10)
    const heldAtIntensity = layerEffect(t => ({ ...quietInput(t), held: { emotion: 'angry', strength: 0.6, level: ramp(t, 0.5, 0.05), side: 1 } }), 6)
    const pitch = d[c('lowerPitch')]
    // The face of a turnless episode holds for held.turnlessSeconds (stage-shared emotionHold), 4 s by default.
    const endOfHold = Math.round((0.5 + defaultExpressionPerformanceSettings.held.turnlessSeconds - 0.05) * 120)
    expect(pitch[endOfHold] / heldAtIntensity[c('lowerPitch')][endOfHold]).toBeGreaterThan(0.9)
    // The criterion's release window opens 8 s after the cue (emotion-table version 3): by then under 2 % of the hold.
    expect(largest(d, Math.round(8.5 * 120) - 1)).toBeLessThan(0.02 * largest(d, endOfHold))
    // A value and slope continuous envelope through angry's 2.2 Hz response bends no faster than omega^2 times its size.
    const peak = Math.max(...pitch.map(Math.abs))
    const bend = Math.max(...pitch.slice(2).map((v, i) => Math.abs(v - 2 * pitch[i + 1] + pitch[i])))
    expect(bend).toBeLessThan(2 * peak * (2 * Math.PI * 2.2 / 120) ** 2)
    expect(largest(layerEffect(pulse('angry', 0.5, 'slight'), 3), 359)).toBe(0)
  })

  it('settles a pulsed startle to its held share for the rest of the hold', () => {
    const d = layerEffect(pulse('surprised', 0.5), 5)
    const heldAtIntensity = layerEffect(t => ({ ...quietInput(t), held: { emotion: 'surprised', strength: 0.6, level: ramp(t, 0.5, 0.05), side: 1 } }), 5)
    const tick = Math.round(4.3 * 120)
    expect(d[c('leftClavElev')][tick] / heldAtIntensity[c('leftClavElev')][tick]).toBeCloseTo(1, 1)
  })

  it('continues from the current pose when the same emotion pulses again during its hold', () => {
    const pitch = layerEffect(pulses({ at: 0.5, emotion: 'angry' }, { at: 2.5, emotion: 'angry' }), 4)[c('lowerPitch')]
    const atRetrigger = pitch[Math.round(2.5 * 120)]
    const after = pitch.slice(Math.round(2.5 * 120), Math.round(3.5 * 120))
    expect(Math.min(...after.map(v => v / atRetrigger))).toBeGreaterThan(0.95)
  })

  it('releases a held pulse when another emotion pulses, as the held face switches', () => {
    // Flustered alone writes the mid-trunk yaw; happy writes none.
    const yaw = layerEffect(pulses({ at: 0.5, emotion: 'flustered' }, { at: 3, emotion: 'happy' }), 6)[c('midYaw')]
    const atSwitch = yaw[Math.round(3 * 120)]
    expect(Math.abs(atSwitch)).toBeGreaterThan(2 * DEG)
    expect(Math.abs(yaw[Math.round(5 * 120)] / atSwitch)).toBeLessThan(0.3)
  })

  it('keeps a pulse\'s arm form for the hold, and never on an arm a clip owns', () => {
    const sad = (owned: number) => armForms(t => ({ ...pulse('sad', 0.5)(t), owned: { ...quietInput(t).owned, rightArm: t > 2 ? owned : 0 } }), 4)
    expect(sad(0).at(-1)).toEqual({ side: 'right', form: 'hand-to-chest' })
    expect(sad(1).at(-1)).toBeNull()
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
    const forms = (emotion: PerformanceEmotion, strength: number, side: number) => armForms(t => ({ ...quietInput(t), held: { emotion, strength, level: ramp(t, 0.5), side } }), 5).at(-1)
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
