import type { BodyArmForm, BodyGestureForm, BodyPerformanceFrame, BodyPerformanceInput, BodyRigTraits } from './contracts'
import type { PerformanceLayer } from './stack'

import { describe, expect, it } from 'vitest'

import { ARM_NOISE_DEGREES } from './arms'
import { ARM_START, BODY_TICK, channelIndex, DEG, JOINT_LIMITS, SIDES } from './channels'
import { ARM_FORMS, GESTURE_FORMS, GestureKeys, writeHandShape } from './gesture-forms'
import { createGestureLayers } from './gestures'
import { BodySkeleton, createBodyPerformer } from './index'
import { chisaTraits, ellenTraits, fixtureRigs, idleInput } from './performance.test-fixtures'

const traits = fixtureRigs[0].traits

interface Utterance {
  readonly start: number
  readonly end: number
  readonly energy: number
  /** Onset times; `major` marks an accepted emphasis, `weak` an onset below the gate's S2 voice-peak rule. */
  readonly onsets: readonly { readonly at: number, readonly major?: boolean, readonly weak?: boolean, readonly loud?: boolean }[]
  readonly gaze?: 'free' | 'sustained'
}

interface Script {
  readonly utterances: readonly Utterance[]
  readonly owned?: (time: number) => Partial<BodyPerformanceInput['owned']>
  readonly armForm?: (time: number) => { side: 'left' | 'right', form: BodyArmForm } | null
  /** Natural's mood tension; its speak scenario reports 0. */
  readonly tension?: number
}

/**
 * Speech as Natural maps it into body intent: the speak scenario's shape, a 0.10 voice floor with a bump at each onset,
 * Natural's 250 ms slow envelope, and the onset and emphasis sequences.
 */
function speechInput(script: Script, time: number, state: { onset: number, emphasis: number, slow: number }): BodyPerformanceInput {
  const base = idleInput(time)
  const utterance = script.utterances.find(u => time >= u.start && time < u.end)
  let level = utterance ? 0.1 : 0
  for (const u of script.utterances) {
    for (const onset of u.onsets) {
      if (Math.abs(time - onset.at) < BODY_TICK / 2) {
        state.onset++
        if (onset.major)
          state.emphasis++
        level = onset.weak ? 0.25 : onset.loud ? 0.8 : 0.45
      }
    }
  }
  state.slow = level + (state.slow - level) * Math.exp(-BODY_TICK / 0.25)
  const last = script.utterances.filter(u => u.start <= time).at(-1)
  return {
    ...base,
    voice: { speaking: utterance !== undefined, level, slow: state.slow, onsetSeq: state.onset, emphasis: state.emphasis ? { seq: state.emphasis, at: time, magnitude: 0.5, tau: 0.3, kind: 'nod', side: 1 } : null },
    energy: { ...base.energy, level: last?.energy ?? 0.5 },
    mood: { ...base.mood, tension: script.tension ?? base.mood.tension },
    gaze: { ...base.gaze, kind: utterance?.gaze ?? 'free' },
    owned: { ...base.owned, ...script.owned?.(time) },
  }
}

/** A layer standing in for an emotion layer: it only plans the requested arm form. */
function armFormPlanner(script: Script): PerformanceLayer {
  let time = 0
  return {
    id: 'arm-form-request',
    order: 'emotion',
    mode: 'additive',
    mask: new Float64Array(77),
    plan: (context) => {
      time = context.time
      const request = script.armForm?.(time)
      return request ? { armForm: request } : {}
    },
    step: () => ({ channels: new Float64Array(77), weight: 0, sequence: 0 }),
    reset: () => {},
  }
}

interface Run {
  readonly frames: { readonly time: number, readonly channels: Float32Array, readonly gesture: BodyPerformanceFrame['diagnostics']['gesture'], readonly corrector: BodyPerformanceFrame['diagnostics']['corrector'], readonly correction: BodyPerformanceFrame['diagnostics']['correction'], readonly holds: number }[]
  readonly onsets: number[]
}

/**
 * Records the largest rate, rad/s, at which a gesture layer's arm-joint targets (flex to wrist deviation) move while
 * the layer requests weight on two consecutive ticks.
 */
function watchTargetSlope(layer: PerformanceLayer, slope: { worst: number }): PerformanceLayer {
  const step = layer.step
  const previous = new Float64Array(77)
  let weighted = false
  layer.step = (context) => {
    const output = step(context)
    for (const side of SIDES) {
      for (let j = 2; j <= 8; j++) {
        const c = ARM_START[side] + j
        if (weighted && output.weight > 0)
          slope.worst = Math.max(slope.worst, Math.abs(output.channels[c] - previous[c]) / BODY_TICK)
        previous[c] = output.channels[c]
      }
    }
    weighted = output.weight > 0
    return output
  }
  return layer
}

function perform(script: Script, seconds: number, options: { seed?: number, traits?: BodyRigTraits, layers?: boolean, slope?: { worst: number }, corrections?: Record<'left' | 'right', number> } = {}): Run {
  const rig = options.traits ?? traits
  const seed = options.seed ?? 1
  const gestures = createGestureLayers({ traits: rig, seed }).map(layer => options.slope ? watchTargetSlope(layer, options.slope) : layer)
  const layers = options.layers === false ? [] : [...gestures, ...(script.armForm ? [armFormPlanner(script)] : [])]
  const performer = createBodyPerformer({ traits: rig, seed, layers })
  const state = { onset: 0, emphasis: 0, slow: 0 }
  const frames: Run['frames'][number][] = []
  const onsets: number[] = []
  for (let tick = 1; tick <= Math.round(seconds / BODY_TICK); tick++) {
    const time = tick * BODY_TICK
    const before = state.onset
    const frame = performer.step(speechInput(script, time, state))
    if (state.onset !== before)
      onsets.push(time)
    const g = frame.diagnostics.gesture
    for (const side of SIDES) {
      // A new contact while the gesture layer holds the arm at full weight: the corrector's correction rising. (As the
      // weight ramps out, the arm is handed back to the idle hang, which the corrector may already hold.)
      const rise = frame.diagnostics.correction[side] - (frames.at(-1)?.correction[side] ?? frame.diagnostics.correction[side])
      if (options.corrections && g.activation[side] === 1)
        options.corrections[side] = Math.max(options.corrections[side], rise)
    }
    frames.push({ time, channels: frame.channels.slice(), gesture: { ...g, activation: { ...g.activation } }, corrector: { ...frame.diagnostics.corrector }, correction: { ...frame.diagnostics.correction }, holds: frame.diagnostics.collisions.count })
  }
  return { frames, onsets }
}

/** Every stroke the layer reported: the frame index of its report, its hit, form and hand, and the onset it answers. */
function strokes(run: Run) {
  const out: { index: number, hit: number, onset: number, form: BodyGestureForm, hand: string }[] = []
  for (let i = 1; i < run.frames.length; i++) {
    const g = run.frames[i].gesture
    if (g.strokeSeq !== run.frames[i - 1].gesture.strokeSeq && g.form && g.hand && g.plannedHit !== null) {
      const hit = g.plannedHit
      // A stroke lands at least 60 ms after its onset, so a later onset inside the stroke is not the one it answers.
      out.push({ index: i, hit, onset: run.onsets.filter(onset => onset <= hit - 0.06).at(-1) ?? Number.NaN, form: g.form, hand: g.hand })
    }
  }
  return out
}

/** Wrist path from the shoulder joint in the chest frame (the shoulder's parent, as the gesture report measures). */
function wristPath(run: Run, side: 'left' | 'right', rig: BodyRigTraits = traits) {
  const skeleton = new BodySkeleton(rig)
  const chest = (['spine0', 'spine1', 'spine2', 'spine3'] as const)[rig.spineChain.length - 1]
  return run.frames.map((frame) => {
    skeleton.update(frame.channels)
    const arm = skeleton.arm(side, frame.channels)
    const f = skeleton.frames[chest]
    const d = [arm.wrist.x - arm.shoulder.x, arm.wrist.y - arm.shoulder.y, arm.wrist.z - arm.shoulder.z]
    return [f[0] * d[0] + f[3] * d[1] + f[6] * d[2], f[1] * d[0] + f[4] * d[1] + f[7] * d[2], f[2] * d[0] + f[5] * d[1] + f[8] * d[2]] as const
  })
}

/** Kinematic apexes (plan 2.1): wrist-speed minima at most half a speed peak within the 300 ms before them, in seconds. */
function apexes(run: Run, side: 'left' | 'right', rig: BodyRigTraits = traits): number[] {
  const path = wristPath(run, side, rig)
  const speed = path.map((p, i) => i ? Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1], p[2] - path[i - 1][2]) : 0)
  const out: number[] = []
  for (let i = 2; i < speed.length - 1; i++) {
    if (speed[i] <= speed[i - 1] && speed[i + 1] > speed[i] && speed[i] <= 0.5 * Math.max(...speed.slice(Math.max(1, i - 36), i)))
      out.push(run.frames[i].time)
  }
  return out
}

const nearest = (values: readonly number[], to: number) => values.reduce((best, value) => Math.abs(value - to) < Math.abs(best - to) ? value : best, Infinity)

const utterance = (start: number, energy: number, onsets: Utterance['onsets'], extra: Partial<Utterance> = {}): Utterance => ({ start, end: start + 6, energy, onsets, ...extra })
const peaks = (start: number, major = true) => [1.0, 2.1, 3.0, 4.2, 5.4].map((at, i) => ({ at: start + at, major: major && i % 2 === 0 }))

describe('co-speech gestures', () => {
  it('leaves the performer bit-identical when nothing speaks', () => {
    const silent: Script = { utterances: [] }
    const withLayers = perform(silent, 30)
    const without = perform(silent, 30, { layers: false })
    for (let i = 0; i < withLayers.frames.length; i++)
      expect(Array.from(withLayers.frames[i].channels)).toEqual(Array.from(without.frames[i].channels))
  })

  it('starts one unit per utterance before its first onset, and none inside the refractory', () => {
    const run = perform({ utterances: [utterance(0.5, 0.65, peaks(0.5)), utterance(12, 0.65, peaks(12)), utterance(18.3, 0.65, peaks(18.3))] }, 26)
    const starts = run.frames.flatMap((frame, i) => i > 0 && frame.gesture.unitSeq !== run.frames[i - 1].gesture.unitSeq ? [frame.time] : [])
    expect(starts).toHaveLength(2)
    expect(starts[0]).toBeGreaterThanOrEqual(0.5)
    expect(starts[0]).toBeLessThanOrEqual(1.5)
    expect(starts[1]).toBeGreaterThanOrEqual(12)
    expect(starts[1]).toBeLessThanOrEqual(13)
  })

  it('strokes every prominent onset at least 0.45 s apart, and never without one', () => {
    const onsets = [{ at: 1.2 }, { at: 1.4 }, { at: 2.4, major: true }, { at: 3.5, weak: true }, { at: 4.4 }]
    const run = perform({ utterances: [utterance(0.4, 0.65, onsets)] }, 9)
    const planned = strokes(run)
    expect(planned.map(s => Math.round(s.onset * 10) / 10)).toEqual([1.2, 2.4, 4.4])
    for (const stroke of planned)
      expect(stroke.hit - stroke.onset).toBeLessThan(0.3)
  })

  it.each(fixtureRigs)('hits within the emphasis window and shows each hit kinematically on $name', ({ traits: rig }) => {
    // Natural reports mood tension 0 in speech without an emotion (the softest active followers); 0.4 is idle's.
    for (const tension of [0, 0.4]) {
      for (const energy of [0.45, 0.85]) {
        const run = perform({ utterances: [utterance(0.4, energy, peaks(0.4))], tension }, 9, { traits: rig, seed: 3 })
        const planned = strokes(run)
        expect(planned).toHaveLength(5)
        for (const stroke of planned) {
          // The onset reaches the performer a frame and a tick after detection, 24.7 to 87.2 ms before the labelled
          // peak (unit M `controls.md`): every form hits within 200 ms of the peak for the shortest lead. The hit is the
          // speed minimum as the stroke's profile ends; only a profile the followers cannot take faster under their
          // 20 rad/s input slope may end later (a chop at energy 0.85 and tension 0 turns the elbow 48 degrees).
          const onset = Math.round(stroke.onset / BODY_TICK) - 1
          const end = run.frames.findIndex((frame, i) => i > onset && frame.gesture.phase !== 'stroke')
          const landed = run.frames[end].time - stroke.onset
          const window = 0.2 + 0.0247 - 1 / 60 - BODY_TICK
          expect(stroke.hit - stroke.onset, `${stroke.form} at tension ${tension}, energy ${energy}`).toBeLessThanOrEqual(Math.max(window, landed + 2 * BODY_TICK))
          expect(landed, `${stroke.form} profile at tension ${tension}, energy ${energy}`).toBeLessThanOrEqual(stroke.form === 'chop' ? 0.2 : window - 2 * BODY_TICK)
          expect(stroke.hit - stroke.onset).toBeGreaterThan(0.06)
          const side = stroke.hand === 'both' ? 'right' : stroke.hand as 'left' | 'right'
          expect(Math.abs(nearest(apexes(run, side, rig), stroke.hit) - stroke.hit)).toBeLessThanOrEqual(0.05)
        }
        expect(run.frames.at(-1)?.corrector).toEqual({ capHits: 0, guardScans: 0 })
        expect(run.frames.at(-1)?.holds).toBe(0)
      }
    }
  })

  it.each(fixtureRigs)('drives each stroke within the followers\' input slope, so the hold does not swing again on $name', ({ traits: rig }) => {
    // `advanceSecondOrder` limits a follower's target slope to 20 rad/s: a faster target is not followed.
    const followerInputSlope = 20
    for (const tension of [0, 0.4]) {
      for (const energy of [0.45, 0.85]) {
        const slope = { worst: 0 }
        const run = perform({ utterances: [utterance(0.4, energy, peaks(0.4))], tension }, 8, { traits: rig, seed: 3, slope })
        expect(slope.worst).toBeLessThanOrEqual(followerInputSlope)
        const planned = strokes(run)
        expect(planned).toHaveLength(5)
        for (const stroke of planned) {
          const path = wristPath(run, stroke.hand === 'left' ? 'left' : 'right', rig)
          const speed = (i: number) => Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1], path[i][2] - path[i - 1][2])
          const onset = Math.round(stroke.onset / BODY_TICK) - 1
          const hit = Math.round(stroke.hit / BODY_TICK) - 1
          let peak = 0
          for (let i = onset; i <= hit; i++)
            peak = Math.max(peak, speed(i))
          // The shortest post-stroke hold is 4a's beat hold, 0.1 s at tempo 1.105 (energy 0.85).
          for (let i = hit + 1; i <= hit + Math.round(0.08 / BODY_TICK); i++)
            expect(speed(i)).toBeLessThanOrEqual(0.5 * peak)
        }
      }
    }
  })

  it.each([['chisa', chisaTraits], ['ellen', ellenTraits]] as const)('starts a unit at every speak energy on %s\'s real rig', (_, rig) => {
    for (const energy of [0.45, 0.65, 0.85]) {
      const run = perform({ utterances: [utterance(0.4, energy, peaks(0.4))], tension: 0 }, 3, { traits: rig, seed: 1 })
      expect(run.frames.at(-1)?.gesture.unitSeq, `energy ${energy}`).toBe(1)
    }
  })

  it.each([['chisa', chisaTraits], ['ellen', ellenTraits]] as const)('performs a chop on %s\'s real rig when two accepted emphases fall within 3 s', (_, rig) => {
    for (const energy of [0.45, 0.65, 0.85]) {
      // Accepted emphases at 1.0, 2.1 and 3.0 s after the utterance starts: the second and third each follow a stroked one
      // within 3 s, so 4a's chop is chosen; it must be performed, not replaced by a beat.
      const onsets = [1.0, 2.1, 3.0].map(at => ({ at: 0.4 + at, major: true }))
      const run = perform({ utterances: [utterance(0.4, energy, onsets)], tension: 0 }, 5, { traits: rig, seed: 1 })
      expect(strokes(run).map(stroke => stroke.form), `energy ${energy}`).toContain('chop')
    }
  })

  it('gestures past a real bust without a corrector kick', () => {
    // Natural reports mood tension 0 in speech without an emotion: the softest active arm followers.
    const correction = { left: 0, right: 0 }
    for (const [seed, energy] of [[1, 0.45], [2, 0.65], [3, 0.85]]) {
      const run = perform({ utterances: [utterance(0.4, energy, peaks(0.4))], tension: 0 }, 9, { traits: chisaTraits, seed, corrections: correction })
      expect(strokes(run)).toHaveLength(5)
    }
    // A correction rising by r per tick adds r / tick of velocity at once; the pops report counts a 30 deg/s velocity
    // step, so a graze is allowed only well under it (half).
    expect(correction.left / BODY_TICK).toBeLessThanOrEqual(15 * DEG)
    expect(correction.right / BODY_TICK).toBeLessThanOrEqual(15 * DEG)
  })

  it('chooses press from the utterance\'s energy at the onset levels real speech has', () => {
    // Natural's onset detector fires at voice levels of 0.31 to 0.46; every onset here sits at 0.45.
    const presses: Record<number, number> = { 0.45: 0, 0.65: 0, 0.85: 0 }
    for (let seed = 1; seed <= 200; seed++) {
      for (const energy of [0.45, 0.65, 0.85]) {
        const run = perform({ utterances: [utterance(0.3, energy, peaks(0.3))] }, 6.5, { seed })
        presses[energy] += strokes(run).filter(stroke => stroke.form === 'press').length
      }
    }
    expect(presses[0.45]).toBeGreaterThan(0)
    expect(presses[0.85]).toBeGreaterThan(presses[0.45])
  }, 120_000)

  it('shows five forms over 500 seeds of neutral speech, more with the dominant hand, larger at higher energy', () => {
    const forms = new Set<BodyGestureForm>()
    const hands = { left: 0, right: 0 }
    const travel = { low: [] as number[], high: [] as number[] }
    for (let seed = 1; seed <= 500; seed++) {
      const energy = [0.45, 0.65, 0.85][seed % 3]
      const onsets = peaks(0.3).map((onset, i) => ({ ...onset, loud: (seed + i) % 4 === 0 }))
      const run = perform({ utterances: [utterance(0.3, energy, onsets, { gaze: seed % 5 === 0 ? 'sustained' : 'free' })] }, 6.5, { seed })
      for (const stroke of strokes(run)) {
        forms.add(stroke.form)
        if (stroke.hand !== 'both')
          hands[stroke.hand as 'left' | 'right']++
        if (seed <= 60 && energy !== 0.65 && stroke.form === 'beat' && stroke.hand !== 'both') {
          const path = wristPath(run, stroke.hand as 'left' | 'right')
          const from = Math.round(stroke.onset / BODY_TICK) - 1
          const to = Math.round(stroke.hit / BODY_TICK) - 1
          travel[energy < 0.65 ? 'low' : 'high'].push(Math.hypot(...path[to].map((v, k) => v - path[from][k]) as [number, number, number]))
        }
      }
    }
    expect(forms.size).toBeGreaterThanOrEqual(5)
    expect(hands.right).toBeGreaterThan(hands.left)
    const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length
    expect(mean(travel.high)).toBeGreaterThan(mean(travel.low))
  }, 120_000)

  it('plays a two-hand stroke with the second hand 40 to 70 ms later and smaller', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = perform({ utterances: [utterance(0.3, 0.85, peaks(0.3))] }, 6.5, { seed })
      const both = strokes(run).find(stroke => stroke.hand === 'both')
      if (!both)
        continue
      const landed = SIDES.map(side => apexes(run, side).find(time => time >= both.onset + 0.06) ?? Number.NaN)
      expect(Math.abs(landed[0] - landed[1])).toBeGreaterThanOrEqual(0.03)
      expect(Math.abs(landed[0] - landed[1])).toBeLessThanOrEqual(0.09)
      return
    }
    throw new Error('No two-hand stroke in 200 seeds at energy 0.85')
  })

  it('never starts on an owned arm, and yields a claimed arm before the claim reaches half', () => {
    const owned = perform({ utterances: [utterance(0.5, 0.65, peaks(0.5))], owned: () => ({ leftArm: 1, rightArm: 1 }) }, 7)
    expect(owned.frames.at(-1)?.gesture.unitSeq).toBe(0)
    // The app's upper-layer fade: a 0.25 s smoothstep from the claim.
    const claim = (time: number) => {
      const u = Math.max(0, Math.min(1, (time - 2.5) / 0.25))
      return u * u * (3 - 2 * u)
    }
    const run = perform({ utterances: [utterance(0.5, 0.65, peaks(0.5))], owned: time => ({ leftArm: claim(time), rightArm: claim(time), leftFingers: claim(time), rightFingers: claim(time) }) }, 7)
    let jerk = 0
    let strokeJerk = 0
    for (let i = 2; i < run.frames.length; i++) {
      const frame = run.frames[i]
      if (claim(frame.time) > 0.5)
        expect(Math.max(frame.gesture.activation.left, frame.gesture.activation.right)).toBe(0)
      for (const side of SIDES) {
        for (const name of ['Flex', 'Abduct', 'Elbow'] as const) {
          const c = channelIndex(`${side}${name}`)
          const second = Math.abs(frame.channels[c] - 2 * run.frames[i - 1].channels[c] + run.frames[i - 2].channels[c])
          if (frame.time > 2.5 && frame.time < 3)
            jerk = Math.max(jerk, second)
          else if (frame.time < 2.5)
            strokeJerk = Math.max(strokeJerk, second)
        }
      }
    }
    expect(run.frames.find(frame => frame.time > 0.5 && frame.time < 2.5)?.gesture.unitSeq).toBe(1)
    // The yield is no sharper than the unit's own strokes.
    expect(jerk).toBeLessThanOrEqual(strokeJerk)
  })

  it('prepares the upper arm, then the elbow, then the wrist, then the fingers', () => {
    const run = perform({ utterances: [utterance(0.5, 0.65, [])] }, 2)
    const silent = perform({ utterances: [] }, 2, { layers: false })
    const start = run.frames.findIndex(frame => frame.gesture.unitSeq === 1)
    const hand = run.frames[start].gesture.hand
    const side = hand === 'left' ? 'left' : 'right'
    // A bone's speed is that of all its channels together: the upper arm is flex, abduction and twist, as the gesture
    // report measures the upper arm bone.
    const peak = (...names: string[]) => {
      const cs = names.map(name => channelIndex(`${side}${name}` as Parameters<typeof channelIndex>[0]))
      let best = 0
      let at = 0
      for (let i = start + 1; i < start + 120; i++) {
        const speed = Math.hypot(...cs.map(c => run.frames[i].channels[c] - silent.frames[i].channels[c] - run.frames[i - 1].channels[c] + silent.frames[i - 1].channels[c]))
        if (speed > best) {
          best = speed
          at = i
        }
      }
      return at
    }
    // The gesture-timing report reads bone speeds at 60 Hz: the elbow's peak follows the upper arm's by two of its
    // frames, as the elbow's cascade link made it follow before a fed elbow passed the link.
    expect(peak('Elbow')).toBeGreaterThanOrEqual(peak('Flex', 'Abduct', 'Twist') + 2 * Math.round(1 / 60 / BODY_TICK))
    expect(peak('Wflex')).toBeGreaterThan(peak('Elbow'))
    expect(peak('Index0')).toBeGreaterThan(peak('Wflex'))
  })

  it.each(fixtureRigs)('follows the planned preparation without overshooting the ready key on $name', ({ traits: rig }) => {
    const targets: Record<string, Float64Array> = {}
    const layers = createGestureLayers({ traits: rig, seed: 1 })
    for (const layer of layers) {
      const step = layer.step
      layer.step = (context) => {
        const output = step(context)
        targets[layer.id] = Float64Array.from(output.channels)
        return output
      }
    }
    const performer = createBodyPerformer({ traits: rig, seed: 1, layers })
    const state = { onset: 0, emphasis: 0, slow: 0 }
    // Natural reports mood tension 0 in speech without an emotion: the softest active arm followers.
    const script: Script = { utterances: [utterance(0.5, 0.65, [])], tension: 0 }
    const frames: { channels: Float32Array, unitSeq: number, hand: string | null }[] = []
    for (let tick = 1; tick <= Math.round(2.5 / BODY_TICK); tick++) {
      const frame = performer.step(speechInput(script, tick * BODY_TICK, state))
      frames.push({ channels: frame.channels.slice(), unitSeq: frame.diagnostics.gesture.unitSeq, hand: frame.diagnostics.gesture.hand })
    }
    const start = frames.findIndex(frame => frame.unitSeq === 1)
    const side = frames[start].hand === 'left' ? 'left' : 'right'
    // By 2.5 s the layer's target has settled on the ready key; each arm angle stays between where it began and the
    // key, within the channel's own moving-hold noise.
    const key = targets[`gesture-${side}`]
    ;(['Flex', 'Abduct', 'Twist', 'Elbow'] as const).forEach((name, k) => {
      const c = channelIndex(`${side}${name}`)
      const from = frames[start - 1].channels[c]
      let beyond = 0
      for (let i = start; i < frames.length; i++)
        beyond = Math.max(beyond, frames[i].channels[c] - Math.max(from, key[c]), Math.min(from, key[c]) - frames[i].channels[c])
      expect(beyond / DEG, name).toBeLessThanOrEqual(ARM_NOISE_DEGREES[2 + k] + 0.3)
    })
  })

  it('retracts to the idle hang with no velocity step once speech ends', () => {
    const run = perform({ utterances: [utterance(0.5, 0.65, peaks(0.5))] }, 12)
    const silent = perform({ utterances: [] }, 12, { layers: false })
    const end = run.frames.findLastIndex(frame => frame.gesture.phase === 'retraction')
    expect(end).toBeGreaterThan(0)
    const settled = run.frames.length - 1
    let differs = 0
    for (const side of SIDES) {
      for (let j = 2; j < 9; j++)
        differs = Math.max(differs, Math.abs(run.frames[settled].channels[ARM_START[side] + j] - silent.frames[settled].channels[ARM_START[side] + j]))
    }
    expect(differs).toBeLessThan(0.5 * DEG)
    const retraction = run.frames.findIndex(frame => frame.gesture.phase === 'retraction')
    let step = 0
    let motion = 0
    for (let i = retraction; i < end + 120; i++) {
      for (const side of SIDES) {
        for (let j = 2; j < 9; j++) {
          const c = ARM_START[side] + j
          step = Math.max(step, Math.abs(run.frames[i].channels[c] - 2 * run.frames[i - 1].channels[c] + run.frames[i - 2].channels[c]))
          motion = Math.max(motion, Math.abs(run.frames[i].channels[c] - run.frames[i - 1].channels[c]))
        }
      }
    }
    // A smooth return changes velocity per tick by a small share of its speed; a step would equal it.
    expect(step).toBeLessThan(0.25 * motion)
  })

  it.each(fixtureRigs)('keeps every form clear of the proxies along its path at both energy extremes on $name', ({ traits: rig }) => {
    const rest = createBodyPerformer({ traits: rig, seed: 1 }).restChannels()
    const keys = new GestureKeys(rig, rest)
    for (const side of SIDES) {
      for (const energy of [0, 1]) {
        for (const form of Object.keys(GESTURE_FORMS) as (keyof typeof GESTURE_FORMS)[]) {
          const outward = form === 'frame' ? 0.1 : 0
          const ready = new Float64Array(rest.subarray(ARM_START[side], ARM_START[side] + 26))
          writeHandShape('relaxed', ready)
          expect(keys.solve(side, keys.readyKey(energy, outward), ready)).toBe(true)
          const stroke = ready.slice()
          writeHandShape(GESTURE_FORMS[form].shape, stroke)
          const size = Math.max(0.5, Math.min(1.5, 0.55 + 0.9 * energy)) * GESTURE_FORMS[form].scale
          expect(keys.solve(side, keys.strokeKey(keys.readyKey(energy, outward), form, size), stroke, ready)).toBe(true)
          expect(keys.pathDepth(side, ready, stroke)).toBe(0)
        }
      }
    }
  })

  it.each([...fixtureRigs, { name: 'chisa', traits: chisaTraits }])('reaches both emotion arm forms elbow out, clear from rest and 2 degrees inside every limit, on $name', ({ traits: rig }) => {
    const rest = createBodyPerformer({ traits: rig, seed: 1 }).restChannels()
    const keys = new GestureKeys(rig, rest)
    for (const side of SIDES) {
      const start = ARM_START[side]
      const from = new Float64Array(rest.subarray(start, start + 26))
      for (const form of ['hand-to-chest', 'thinking-hand'] as const) {
        const pose = from.slice()
        writeHandShape(ARM_FORMS[form].shape, pose)
        expect(keys.armForm(side, form, pose), `${side} ${form}`).toBe(true)
        expect(keys.pathDepth(side, from, pose)).toBe(0)
        for (let j = 2; j <= 8; j++) {
          const [min, max] = JOINT_LIMITS[start + j]
          expect(Math.min(pose[j] - min, max - pose[j]) / DEG, `${side} ${form} joint ${j}`).toBeGreaterThanOrEqual(2)
        }
      }
    }
  })

  it('holds a requested emotion arm form, and lets speech take the other hand', () => {
    const script: Script = { utterances: [utterance(3, 0.65, peaks(3))], armForm: time => time > 0.2 && time < 8 ? { side: 'right', form: 'hand-to-chest' } : null }
    const run = perform(script, 12)
    const held = run.frames.find(frame => frame.time > 1.5)
    expect(held?.gesture.activation.right).toBe(1)
    const planned = strokes(run)
    expect(planned.length).toBeGreaterThan(0)
    expect(planned.every(stroke => stroke.hand === 'left')).toBe(true)
    expect(run.frames.at(-1)?.gesture.activation.right).toBe(0)
    expect(run.frames.at(-1)?.holds).toBe(0)
  })
})
