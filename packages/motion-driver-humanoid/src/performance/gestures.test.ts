import type { BodyArmForm, BodyGestureForm, BodyPerformanceFrame, BodyPerformanceInput, BodyRigTraits } from './contracts'
import type { PerformanceLayer } from './stack'

import { describe, expect, it } from 'vitest'

import { ARM_START, BODY_TICK, channelIndex, DEG, SIDES } from './channels'
import { GESTURE_FORMS, GestureKeys, writeHandShape } from './gesture-forms'
import { createGestureLayers } from './gestures'
import { BodySkeleton, createBodyPerformer } from './index'
import { fixtureRigs, idleInput } from './performance.test-fixtures'

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
  readonly frames: { readonly time: number, readonly channels: Float32Array, readonly gesture: BodyPerformanceFrame['diagnostics']['gesture'], readonly corrector: BodyPerformanceFrame['diagnostics']['corrector'], readonly holds: number }[]
  readonly onsets: number[]
}

function perform(script: Script, seconds: number, options: { seed?: number, traits?: BodyRigTraits, layers?: boolean } = {}): Run {
  const rig = options.traits ?? traits
  const seed = options.seed ?? 1
  const layers = options.layers === false ? [] : [...createGestureLayers({ traits: rig, seed }), ...(script.armForm ? [armFormPlanner(script)] : [])]
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
    frames.push({ time, channels: frame.channels.slice(), gesture: { ...g, activation: { ...g.activation } }, corrector: { ...frame.diagnostics.corrector }, holds: frame.diagnostics.collisions.count })
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
      out.push({ index: i, hit, onset: run.onsets.filter(onset => onset <= hit).at(-1) ?? Number.NaN, form: g.form, hand: g.hand })
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
    for (const energy of [0.45, 0.85]) {
      const run = perform({ utterances: [utterance(0.4, energy, peaks(0.4))] }, 9, { traits: rig, seed: 3 })
      const planned = strokes(run)
      expect(planned).toHaveLength(5)
      for (const stroke of planned) {
        // The onset reaches the performer at most a display frame and a tick after detection, which precedes the
        // labelled peak by at least 24.7 ms (unit M `onset-latency.txt`): the hit lands inside 200 ms less a frame.
        expect(stroke.hit - stroke.onset).toBeLessThanOrEqual(0.2 - 1 / 60 + 0.0247 - 1 / 60 - BODY_TICK)
        expect(stroke.hit - stroke.onset).toBeGreaterThan(0.06)
        const side = stroke.hand === 'both' ? 'right' : stroke.hand as 'left' | 'right'
        expect(Math.abs(nearest(apexes(run, side, rig), stroke.hit) - stroke.hit)).toBeLessThanOrEqual(0.05)
      }
      expect(run.frames.at(-1)?.corrector).toEqual({ capHits: 0, guardScans: 0 })
      expect(run.frames.at(-1)?.holds).toBe(0)
    }
  })

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
    const peak = (name: string) => {
      const c = channelIndex(`${side}${name}` as Parameters<typeof channelIndex>[0])
      let best = 0
      let at = 0
      for (let i = start + 1; i < start + 120; i++) {
        const speed = Math.abs(run.frames[i].channels[c] - silent.frames[i].channels[c] - run.frames[i - 1].channels[c] + silent.frames[i - 1].channels[c])
        if (speed > best) {
          best = speed
          at = i
        }
      }
      return at
    }
    expect(peak('Elbow')).toBeGreaterThan(peak('Flex'))
    expect(peak('Wflex')).toBeGreaterThan(peak('Elbow'))
    expect(peak('Index0')).toBeGreaterThan(peak('Wflex'))
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
