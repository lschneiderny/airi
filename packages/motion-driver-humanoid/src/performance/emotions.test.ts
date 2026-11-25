import type { PerformanceEmotion } from '@proj-airi/stage-shared/expression-performance'

import type { BodyPerformanceInput } from './contracts'
import type { MergedPerformancePlan, PerformanceLayer } from './stack'

import { defaultExpressionPerformanceSettings, PERFORMANCE_EMOTIONS } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it } from 'vitest'

import { ARM_START, BODY_CHANNELS, channelGroup, channelIndex, DEG } from './channels'
import { BODY_EMOTIONS, createEmotionLayer } from './emotions'
import { HAND_SHAPES, writeHandShape } from './hand-shapes'
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
const fixtureReachesTuck = createBodyPerformer({ traits, seed: 1 }).step(quietInput(0)).capabilities.hairTouch

/** The emotion layer's own output channels and plan on the last tick of a script, through the whole performer. */
function emotionOutput(script: Script, seconds: number) {
  const layer = createEmotionLayer()
  let channels = new Float64Array(BODY_CHANNELS.length)
  let plan: MergedPerformancePlan | null = null
  const recorder: PerformanceLayer = {
    ...layer,
    step: (context) => {
      const output = layer.step(context)
      channels = Float64Array.from(output.channels)
      plan = { ...context.plan }
      return output
    },
  }
  const performer = createBodyPerformer({ traits, seed: 1, layers: [recorder] })
  let support = 0
  for (let tick = 0; tick < seconds * 120; tick++)
    support = performer.step(script(tick / 120)).diagnostics.shiftTarget
  return { channels, plan: plan as MergedPerformancePlan | null, support }
}

const TRUNK = ['hipsYaw', 'hipsPitch', 'lowerYaw', 'lowerPitch', 'lowerRoll', 'midYaw', 'midPitch', 'midRoll', 'upperYaw', 'upperPitch', 'upperRoll'] as const
const ARM = [0, 1, 2, 3, 4, 5, 6, 7] as const

describe('emotion posture layer', () => {
  it('changes nothing while no emotion is held or pulsed', () => {
    const base = channelTrace(createBodyPerformer({ traits, seed: 1 }), 20, idleInput)
    const layered = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [createEmotionLayer()] }), 20, idleInput)
    expect(layered).toEqual(base)
  })

  it('closes an angry hand from the walking hand she holds, so a closing walk still ends at the fist', () => {
    // The walk's hand halfway to the fist: the angry fist (amount 0.8) takes the rest of the way from there.
    const fist = new Float64Array(26)
    const relaxed = new Float64Array(26)
    writeHandShape('fist', fist)
    writeHandShape('relaxed', relaxed)
    const channels = new Float64Array(BODY_CHANNELS.length)
    for (let j = 9; j < 26; j++)
      channels[ARM_START.right + j] = 0.5 * (fist[j] - relaxed[j])
    const walking: Script = t => ({ ...quietInput(t), gait: { mode: 'walking', walkForm: true, weight: 1, support: 0, channels, ankles: null } })
    const trace = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [createEmotionLayer()] }), 4, held('angry', () => 1, 1, walking))
    const knuckle = HAND_SHAPES.fist.fingers[0][0]
    // Added to the walking hand instead, the fist's offset from the rest hand would pass the knuckle's limit. The
    // knuckle leads the closing hand (`orderedShare`): 0.8 of the hand's way is all of the knuckle's.
    expect(trace[c('rightIndex0')].at(-1)! / DEG).toBeCloseTo(knuckle, -1)
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
    // The anticipation is a few thousandths of a degree against a held lift of several degrees.
    const first = lift.find(v => Math.abs(v) > 1e-6) ?? 0
    expect(Math.sign(first)).toBe(-Math.sign(settled))
    // Joy bounces: the lift passes its held size before it settles.
    expect(Math.min(...lift)).toBeLessThan(1.05 * settled)

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
  it('curls the sad slump through the mid and upper trunk and caps it at 20 degrees', () => {
    const end = 12 * 120 - 1
    const d = layerEffect(held('sad', t => ramp(t, 0.5)), 12)
    const [lower, mid, upper] = [d[c('lowerPitch')][end], d[c('midPitch')][end], d[c('upperPitch')][end]]
    const total = lower + mid + upper
    expect(lower / total).toBeLessThan(0.25)
    expect(upper / total).toBeGreaterThan(0.15)
    expect(mid).toBeGreaterThan(lower + upper)
    expect(total).toBeLessThan(20 * DEG)
    // A clear-weight sad curls 0.6 of its 18 degrees.
    const clear = layerEffect(t => ({ ...quietInput(t), held: { emotion: 'sad', strength: 0.6, level: ramp(t, 0.5), side: 1 } }), 8)
    const lean = clear[c('lowerPitch')][959] + clear[c('midPitch')][959] + clear[c('upperPitch')][959]
    expect(lean / DEG).toBeCloseTo(0.6 * 18, 0)
  })

  it('sags sleepy back from the hips and lists it to its side, where sad curls forward', () => {
    const end = 12 * 120 - 1
    const sleepy = layerEffect(held('sleepy', t => ramp(t, 0.5)), 12)
    const sad = layerEffect(held('sad', t => ramp(t, 0.5)), 12)
    expect(sleepy[c('lowerPitch')][end]).toBeLessThan(0)
    expect(sleepy[c('pelvisZ')][end]).toBeGreaterThan(sad[c('pelvisZ')][end])
    expect(sleepy[c('lowerRoll')][end]).toBeGreaterThan(4 * DEG)
    expect(sad[c('rightClavProt')][end]).toBeGreaterThan(sleepy[c('rightClavProt')][end] + 4 * DEG)
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

  it('settles a clear surprised startle to its held share of the pose', () => {
    const surprised = layerEffect(pulse('surprised', 0.5), 5)
    // The elbow's 75 degrees at the clear weight 0.6, held at 0.35 of it, behind the arm followers. Re-pinned from 55:
    // the startle now brings both hands up in front, palms out, instead of a half lift.
    expect(surprised[c('leftElbow')][Math.round(4.3 * 120)] / DEG).toBeCloseTo(0.6 * 0.35 * 75, 0)
  })

  it('leaves the arms of a startle from a poke to the touch reaction, and keeps its trunk recoil', () => {
    const poked = (at: number): Script => (t) => {
      const input = pulse('surprised', 0.5)(t)
      return { ...input, events: { ...input.events, poke: t < at ? null : { seq: 1, at, region: 'body', x: 0.7, y: 0 } } }
    }
    const alone = emotionOutput(pulse('surprised', 0.5), 0.8).channels
    const touched = emotionOutput(poked(0.5), 0.8).channels
    const earlier = emotionOutput(poked(0.1), 0.8).channels
    expect(touched[c('leftElbow')] / alone[c('leftElbow')]).toBeCloseTo(0.25, 6)
    expect(touched[c('midPitch')]).toBeCloseTo(alone[c('midPitch')], 9)
    expect(earlier[c('leftElbow')]).toBeCloseTo(alone[c('leftElbow')], 9)
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
    const love = (owned: number) => armForms(t => ({ ...pulse('love', 0.5)(t), owned: { ...quietInput(t).owned, rightArm: t > 2 ? owned : 0 } }), 4)
    expect(love(0).at(-1)).toEqual({ side: 'right', form: 'hand-to-chest' })
    expect(love(1).at(-1)).toBeNull()
  })

  it('gives the hand to chest to love alone, and the hair touch to awkward only on a rig that reaches it', () => {
    const forms = PERFORMANCE_EMOTIONS.filter(emotion => BODY_EMOTIONS[emotion].armForm === 'hand-to-chest')
    expect(forms).toEqual(['love'])
    const awkward = armForms(t => ({ ...quietInput(t), held: { emotion: 'awkward', strength: 0.8, level: ramp(t, 0.5), side: -1 } }), 3).at(-1)
    expect(awkward).toEqual(fixtureReachesTuck ? { side: 'left', form: 'hair-touch' } : null)
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

  // With the face hidden no two emotions share a pose: the trunk and weight differ by 3 degrees (3 thousandths of a leg
  // length, a quarter of the support) somewhere, and the arms by 5 degrees or by a held form.
  it('gives every emotion a trunk, weight and arm pose of its own', () => {
    const emotions = PERFORMANCE_EMOTIONS.filter(emotion => emotion !== 'neutral')
    const poses = emotions.map((emotion) => {
      const { channels, plan, support } = emotionOutput(held(emotion, () => 1), 10)
      return {
        emotion,
        body: [...TRUNK.map(name => channels[c(name)] / DEG), channels[c('pelvisY')] * 1000, channels[c('pelvisZ')] * 1000, support * 12],
        arms: [...ARM.map(j => channels[ARM_START.left + j] / DEG), ...ARM.map(j => channels[ARM_START.right + j] / DEG)],
        form: plan?.armForm?.form ?? null,
      }
    })
    const apart = (a: readonly number[], b: readonly number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])))
    for (const [i, a] of poses.entries()) {
      for (const b of poses.slice(i + 1)) {
        expect(apart(a.body, b.body), `${a.emotion} and ${b.emotion} trunk and weight`).toBeGreaterThan(3)
        if (a.form === b.form)
          expect(apart(a.arms, b.arms), `${a.emotion} and ${b.emotion} arms`).toBeGreaterThan(5)
      }
    }
  })

  it('poses a weaker emotion as the same pose smaller, except the far arm that completes a held form', () => {
    for (const emotion of PERFORMANCE_EMOTIONS.filter(emotion => emotion !== 'neutral')) {
      const at = (strength: number) => emotionOutput(t => ({ ...quietInput(t), held: { emotion, strength, level: 1, side: 1 } }), 10)
      const clear = at(0.6)
      const strong = at(0.9)
      expect(strong.plan?.armForm ?? null, emotion).toEqual(clear.plan?.armForm ?? null)
      expect(strong.support, emotion).toBeCloseTo(clear.support, 6)
      const channels = [...TRUNK.map(name => c(name)), c('pelvisY'), c('pelvisZ'), ...ARM.map(j => ARM_START.right + j)]
      if (!BODY_EMOTIONS[emotion].armForm)
        channels.push(...ARM.map(j => ARM_START.left + j))
      for (const channel of channels) {
        const pelvis = channel === c('pelvisY') || channel === c('pelvisZ')
        if (Math.abs(clear.channels[channel]) < (pelvis ? 0.001 : 0.2 * DEG))
          continue
        // The trunk's slump passes its soft cap above 16 degrees, a few percent under the proportion.
        expect(strong.channels[channel] / clear.channels[channel], `${emotion} ${BODY_CHANNELS[channel]}`).toBeCloseTo(1.5, 1)
      }
    }
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
