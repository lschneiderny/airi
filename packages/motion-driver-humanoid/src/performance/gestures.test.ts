import type { BodySide } from './channels'
import type { BodyArmForm, BodyGestureForm, BodyGestureHand, BodyPerformanceFrame, BodyPerformanceInput, BodyRigTraits } from './contracts'
import type { PerformanceLayer } from './stack'

import { describe, expect, it } from 'vitest'

import { ARM_NOISE_DEGREES } from './arms'
import { ARM_START, BODY_TICK, channelIndex, DEG, JOINT_LIMITS, SIDES } from './channels'
import { BodyCollision } from './collision'
import { GESTURE_FORMS, gestureGain, GestureKeys, NO_OFFSET, writeArmFormHand, writeHandShare } from './gesture-forms'
import { createGestureLayers } from './gestures'
import { writeHandShape } from './hand-shapes'
import { BodySkeleton, createBodyPerformer } from './index'
import { chisaTraits, ellenTraits, fixtureRigs, idleInput, quietInput } from './performance.test-fixtures'

const traits = fixtureRigs[0].traits

interface Utterance {
  readonly start: number
  readonly end: number
  readonly energy: number
  /** Onset times; `major` marks an accepted emphasis, `weak` an onset below the gate's S2 voice-peak rule. */
  readonly onsets: readonly { readonly at: number, readonly major?: boolean, readonly weak?: boolean, readonly loud?: boolean }[]
  readonly gaze?: 'free' | 'sustained'
  /** Silences inside the utterance, `[start, end]`: speaking goes on, the voice floor drops to 0. */
  readonly pauses?: readonly (readonly [number, number])[]
}

interface Script {
  readonly utterances: readonly Utterance[]
  readonly owned?: (time: number) => Partial<BodyPerformanceInput['owned']>
  readonly armForm?: (time: number) => { side: BodyGestureHand, form: BodyArmForm } | null
  /** Natural's mood tension; its speak scenario reports 0. */
  readonly tension?: number
  readonly mood?: { readonly valence: number, readonly arousal: number }
  /** Natural's speech emphasis head pitch term, radians. */
  readonly headEmphasis?: (time: number) => number
  /** The body's facing, radians; the feet turning under the gaze. */
  readonly facing?: (time: number) => number
  /** No posture sway, breath or arm noise, so the trunk and the colliders hold still. */
  readonly still?: boolean
}

/**
 * Speech as Natural maps it into body intent: the speak scenario's shape, a 0.10 voice floor with a bump at each onset,
 * Natural's 250 ms slow envelope, and the onset and emphasis sequences.
 */
function speechInput(script: Script, time: number, state: { onset: number, emphasis: number, slow: number }): BodyPerformanceInput {
  const base = script.still ? quietInput(time) : idleInput(time)
  const utterance = script.utterances.find(u => time >= u.start && time < u.end)
  let level = utterance && !utterance.pauses?.some(([start, end]) => time >= start && time < end) ? 0.1 : 0
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
    head: script.headEmphasis ? { ...base.head, terms: { ...base.head.terms, emphasis: { yaw: 0, pitch: script.headEmphasis(time), roll: 0 } } } : base.head,
    facingYaw: script.facing?.(time) ?? base.facingYaw,
    voice: { speaking: utterance !== undefined, level, slow: state.slow, onsetSeq: state.onset, emphasis: state.emphasis ? { seq: state.emphasis, at: time, magnitude: 0.5, tau: 0.3, kind: 'nod', side: 1 } : null },
    energy: { ...base.energy, level: last?.energy ?? 0.5 },
    mood: { ...base.mood, ...script.mood, tension: script.tension ?? base.mood.tension },
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
  readonly frames: { readonly time: number, readonly channels: Float32Array, readonly gesture: BodyPerformanceFrame['diagnostics']['gesture'], readonly corrector: BodyPerformanceFrame['diagnostics']['corrector'], readonly correction: BodyPerformanceFrame['diagnostics']['correction'], readonly holds: number, readonly support: number }[]
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
    frames.push({ time, channels: frame.channels.slice(), gesture: { ...g, activation: { ...g.activation } }, corrector: { ...frame.diagnostics.corrector }, correction: { ...frame.diagnostics.correction }, holds: frame.diagnostics.collisions.count, support: frame.support })
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

/**
 * A transition's speed peaks, counted as the reference's were (sources.md): a peak counts once the speed has risen and
 * then fallen by 10 % of the span's top speed. Returns the peaks' indices in `span`.
 */
function speedPeaks(span: readonly number[]): number[] {
  const delta = 0.1 * Math.max(...span)
  const peaks: number[] = []
  let low = span[0]
  let high = -Infinity
  let at = -1
  let rising = true
  span.forEach((v, i) => {
    if (rising && v > high) {
      high = v
      at = i
    }
    if (rising && high - low >= delta && high - v >= delta) {
      peaks.push(at)
      rising = false
      low = v
    }
    else if (!rising) {
      low = Math.min(low, v)
      if (v - low >= delta) {
        rising = true
        high = v
        at = i
      }
    }
  })
  return peaks
}

const nearest = (values: readonly number[], to: number) => values.reduce((best, value) => Math.abs(value - to) < Math.abs(best - to) ? value : best, Infinity)

/**
 * The hand a stroke marker reports: its own, or for a two-hand stroke the lead (dominant) hand, whose apex the marker
 * is; the second hand's lands 40 to 70 ms later.
 */
function markedSide(run: Run, stroke: { hit: number, hand: string }, rig: BodyRigTraits = traits): 'left' | 'right' {
  if (stroke.hand !== 'both')
    return stroke.hand === 'left' ? 'left' : 'right'
  const off = (side: 'left' | 'right') => Math.abs(nearest(apexes(run, side, rig), stroke.hit) - stroke.hit)
  return off('left') <= off('right') ? 'left' : 'right'
}

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
    // The third utterance starts after the second's end has lowered the hands (0.3 s after speaking ends), so its
    // onsets fall inside the refractory that the end of speech starts. (A unit its caps lower while speech goes on
    // takes the short refractory, `TIMING.pauseBase`.)
    const run = perform({ utterances: [utterance(0.5, 0.65, peaks(0.5)), utterance(12, 0.65, peaks(12)), utterance(19, 0.65, peaks(19).slice(0, 3), { end: 22.3 })] }, 26)
    const starts = run.frames.flatMap((frame, i) => i > 0 && frame.gesture.unitSeq !== run.frames[i - 1].gesture.unitSeq ? [frame.time] : [])
    expect(starts).toHaveLength(2)
    expect(starts[0]).toBeGreaterThanOrEqual(0.5)
    expect(starts[0]).toBeLessThanOrEqual(1.5)
    expect(starts[1]).toBeGreaterThanOrEqual(12)
    expect(starts[1]).toBeLessThanOrEqual(13)
  })

  it('strokes every prominent onset at least 0.45 s apart, and never without one', () => {
    // The last onset comes 1.3 s after the one before: 2 s would let the waiting hands go first (`RISE`).
    const onsets = [{ at: 1.2 }, { at: 1.4 }, { at: 2.4, major: true }, { at: 3.1, weak: true }, { at: 3.7 }]
    const run = perform({ utterances: [utterance(0.4, 0.65, onsets)] }, 9)
    const planned = strokes(run)
    expect(planned.map(s => Math.round(s.onset * 10) / 10)).toEqual([1.2, 2.4, 3.7])
    for (const stroke of planned)
      expect(stroke.hit - stroke.onset).toBeLessThan(0.3)
  })

  it('moves each new phrase of a long utterance to another place, prepared from where the hands are', () => {
    const onsets = Array.from({ length: 12 }, (_, i) => ({ at: 1 + 0.75 * i, major: i % 3 === 0 }))
    let found = 0
    for (const seed of [1, 2, 3, 4]) {
      const run = perform({ utterances: [{ start: 0.5, end: 11, energy: 0.85, onsets }] }, 11, { seed })
      const unit = run.frames[run.frames.length - 1].gesture.unitSeq
      // The wrist where each preparation ends, of every preparation of the first unit after its first.
      const ends: number[] = []
      for (let i = 1; i < run.frames.length; i++) {
        const g = run.frames[i].gesture
        if (run.frames[i - 1].gesture.phase === 'preparation' && g.phase !== 'preparation' && g.unitSeq === 1)
          ends.push(i - 1)
      }
      if (ends.length < 2)
        continue
      found++
      const lead = run.frames[ends[0]].gesture.hand === 'left' ? 'left' : 'right'
      const path = wristPath(run, lead)
      const [a, b] = [path[ends[0]], path[ends[1]]]
      expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), `seed ${seed}`).toBeGreaterThan(0.05)
      expect(unit).toBeGreaterThanOrEqual(1)
    }
    expect(found).toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('carries a hand into its next phrase with a second submovement that homes in on the new place', () => {
    const onsets = Array.from({ length: 12 }, (_, i) => ({ at: 1 + 0.75 * i, major: i % 3 === 0 }))
    let checked = 0
    for (const seed of [1, 2, 3, 4]) {
      const run = perform({ utterances: [{ start: 0.5, end: 11, energy: 0.85, onsets }] }, 11, { seed })
      // Every preparation of the first unit after its first is a phrase change; a one-hand phrase's is its hand's.
      for (let i = 1; i < run.frames.length; i++) {
        const g = run.frames[i].gesture
        if (g.unitSeq !== 1 || g.phase !== 'preparation' || run.frames[i - 1].gesture.phase === 'preparation' || run.frames[i - 1].gesture.phase === 'rest' || (g.hand !== 'left' && g.hand !== 'right'))
          continue
        const end = run.frames.findIndex((frame, k) => k > i && frame.gesture.phase !== 'preparation')
        // A stroke may leave from a preparation about to end, cutting its correction short.
        if (run.frames[end].gesture.phase === 'stroke')
          continue
        const fed = [2, 3, 4, 5].map(j => ARM_START[g.hand as BodySide] + j)
        // The output's followers land the second submovement a little after the plan's end, as for the unit's own.
        const span = run.frames.slice(i, end + Math.round(0.15 / BODY_TICK)).map((frame, k) => Math.hypot(...fed.map(c => frame.channels[c] - run.frames[i + k - 1].channels[c])))
        expect(speedPeaks(span).length, `seed ${seed} at ${run.frames[i].time.toFixed(2)} s`).toBeGreaterThanOrEqual(2)
        checked++
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('raises the hands after a pause only for an onset they stroke, and strokes it before lowering them', () => {
    // The first unit lowers its hands in the pause; its refractory has passed by 4.4 s. Speech resumes with a weak
    // onset, then a stroking one 0.4 s before speaking ends: the hands rise for that one and stroke it.
    const run = perform({ utterances: [{ start: 0.5, end: 5.4, energy: 0.5, onsets: [{ at: 1 }, { at: 1.9 }, { at: 4.5, weak: true }, { at: 5 }], pauses: [[2.3, 4.2]] }] }, 8)
    const units = run.frames.flatMap((frame, i) => i > 0 && frame.gesture.unitSeq !== run.frames[i - 1].gesture.unitSeq ? [frame] : [])
    expect(units).toHaveLength(2)
    expect(units[1].time).toBeGreaterThanOrEqual(5)
    const second = strokes(run).filter(s => run.frames[s.index].gesture.unitSeq === 2)
    expect(second).toHaveLength(1)
    expect(second[0].onset).toBeCloseTo(5, 1)
    expect(second[0].hit - second[0].onset).toBeLessThan(0.7)
  })

  it('strokes the onset that opens a unit once the hands have risen, instead of letting it pass', () => {
    // A calm speaker's unit opens on a loud onset; the next onset is weak, and speaking ends before another comes.
    for (const seed of [1, 2, 3]) {
      const run = perform({ utterances: [{ start: 0.5, end: 2.2, energy: 0.3, onsets: [{ at: 1, loud: true }, { at: 1.6, weak: true }] }] }, 5, { seed })
      const planned = strokes(run)
      expect(planned, `seed ${seed}`).toHaveLength(1)
      expect(planned[0].onset).toBeCloseTo(1, 1)
    }
  })

  it('lets the hands go once a thought has nothing more to stress, while speech goes on, and raises them for the next stroke', () => {
    // After the stroke at 2.8 s only weak onsets come until 7 s; speech never pauses.
    for (const seed of [1, 2, 3]) {
      const run = perform({ utterances: [{ start: 0.5, end: 8.5, energy: 0.65, onsets: [{ at: 1 }, { at: 1.9 }, { at: 2.8 }, { at: 4.2, weak: true }, { at: 5.6, weak: true }, { at: 7 }] }] }, 9, { seed })
      const last = strokes(run).filter(s => s.hit < 4)
      const lowered = run.frames.find(f => f.time > last.at(-1)!.hit && f.gesture.phase === 'retraction')
      expect(lowered, `seed ${seed}`).toBeDefined()
      expect(lowered!.time - last.at(-1)!.hit, `seed ${seed}`).toBeLessThan(2)
      expect(strokes(run).some(s => s.onset > 6.9), `seed ${seed}`).toBe(true)
    }
  })

  it('lets one hand of two go while the other strokes alone', () => {
    // Strokes 1.1 s apart with no pause, so one-hand phrases follow two-hand ones. Since its last stroke a raised hand
    // holds, recovers, waits at most 1.4 s and starts home; a hand left out of the phrase used to wait 4.4 s.
    const onsets = Array.from({ length: 10 }, (_, i) => ({ at: 1 + i * 1.1, major: i % 3 === 0 }))
    for (let seed = 1; seed <= 20; seed++) {
      const run = perform({ utterances: [{ start: 0.5, end: 12.5, energy: 0.65, onsets }] }, 12.5, { seed })
      const hits = strokes(run)
      for (const side of SIDES) {
        let raised = Number.NaN
        for (const frame of run.frames) {
          if (frame.gesture.activation[side] < 1) {
            raised = Number.NaN
            continue
          }
          if (Number.isNaN(raised))
            raised = frame.time
          const last = hits.filter(hit => (hit.hand === side || hit.hand === 'both') && hit.hit <= frame.time).at(-1)?.hit ?? -Infinity
          expect(frame.time - Math.max(raised, last), `seed ${seed}, ${side} at ${frame.time.toFixed(2)}`).toBeLessThanOrEqual(3.4)
        }
      }
    }
  }, 120_000)

  it('lowers the hands in a pause between phrases and gestures again after it', () => {
    const run = perform({ utterances: [{ start: 0.5, end: 9, energy: 0.85, onsets: [1, 1.9, 2.8, 5.6, 6.5, 7.4].map(at => ({ at })), pauses: [[3.2, 5.2]] }] }, 9)
    const inPause = run.frames.filter(f => f.time > 3.2 && f.time < 5.6)
    expect(inPause.some(f => f.gesture.phase === 'rest')).toBe(true)
    const after = strokes(run).filter(s => s.hit > 5.6)
    expect(after.length).toBeGreaterThanOrEqual(2)
    expect(run.frames.at(-1)!.gesture.unitSeq).toBe(2)
  })

  it('holds an excited speaker\'s hands through a short pause, taking them on to the next place, and lowers a calmer one\'s', () => {
    const onsets = [1, 1.8, 2.6, 4.2, 5.0, 5.8].map(at => ({ at }))
    const run = (energy: number, seed: number) => perform({ utterances: [{ start: 0.5, end: 6.5, energy, onsets, pauses: [[3, 3.9]] }] }, 7, { seed })
    const inPause = (r: Run) => r.frames.filter(f => f.time > 3 && f.time < 4.2)
    let moved = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const excited = run(0.85, seed)
      expect(inPause(excited).map(f => f.gesture.phase), `seed ${seed}`).not.toContain('retraction')
      expect(excited.frames.at(-1)!.gesture.unitSeq).toBe(1)
      expect(strokes(excited).filter(s => s.hit > 4.2).length).toBeGreaterThanOrEqual(2)
      // A phrase that has stroked ends with the thought: its hands go on to the next place once the voice has been
      // quiet 0.4 s (the slow envelope falls under 0.05 about 0.17 s into the pause).
      if (inPause(excited).some((f, i, all) => i > 0 && f.time > 3.5 && f.gesture.phase === 'preparation' && all[i - 1].gesture.phase !== 'preparation'))
        moved++
      expect(inPause(run(0.45, seed)).map(f => f.gesture.phase), `seed ${seed}`).toContain('retraction')
    }
    expect(moved).toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('turns the trunk and tilts the head toward a one-handed phrase, lifts that shoulder and settles the other, more when livelier', () => {
    // Seed 3 opens with a one-handed phrase at both energies.
    const measure = (energy: number) => {
      const script: Script = { utterances: [utterance(0.5, energy, peaks(0.5))], still: true }
      const run = perform(script, 6.5, { seed: 3 })
      const still = perform(script, 6.5, { seed: 3, layers: false })
      const hand = strokes(run)[0].hand as BodySide
      expect(hand).not.toBe('both')
      const toward = hand === 'left' ? 1 : -1
      // The first phrase only: the next may go on with the other hand or both.
      const first = strokes(run)[0].index
      const end = run.frames.findIndex((f, i) => i > first && f.gesture.hand !== hand)
      const held = run.frames.slice(0, end < 0 ? undefined : end).map((f, i) => ({ f, s: still.frames[i] })).filter(({ f }) => f.gesture.phase === 'hold' || f.gesture.phase === 'stroke')
      const mean = (c: number) => held.reduce((sum, { f, s }) => sum + f.channels[c] - s.channels[c], 0) / held.length
      const other: BodySide = hand === 'left' ? 'right' : 'left'
      return { turn: toward * mean(channelIndex('upperYaw')), tilt: toward * mean(channelIndex('headRoll')), lift: mean(ARM_START[hand]), free: mean(ARM_START[other]) }
    }
    const calm = measure(0.45)
    const lively = measure(0.85)
    for (const body of [calm, lively]) {
      expect(body.turn).toBeGreaterThan(0.5 * DEG)
      expect(body.tilt).toBeGreaterThan(0.5 * DEG)
      expect(body.lift).toBeGreaterThan(0)
      expect(body.free).toBeLessThan(0)
    }
    expect(lively.turn).toBeGreaterThan(calm.turn)
    expect(lively.lift).toBeGreaterThan(calm.lift)
  }, 60_000)

  it('moves the weight to the other foot as the hands come down, in most units', () => {
    let shifted = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const run = perform({ utterances: [utterance(0.5, 0.65, peaks(0.5))] }, 9, { seed })
      const down = run.frames.findIndex(f => f.time > 6.5 && f.gesture.phase === 'retraction')
      expect(down).toBeGreaterThan(0)
      // Where the weight stood as the hands came down, and where it went over the next 1.4 s, while the shift holds
      // the support against Natural's own shifts.
      const before = run.frames[down].support
      const moved = run.frames[down + Math.round(1.4 / BODY_TICK)].support - before
      if (Math.abs(moved) > 0.3) {
        shifted++
        if (before !== 0)
          expect(Math.sign(moved), `seed ${seed}`).toBe(-Math.sign(before))
      }
    }
    expect(shifted).toBeGreaterThanOrEqual(2)
  }, 60_000)

  it('gestures seldom and small when calm, often and large when excited, for the same speech', () => {
    const onsets = Array.from({ length: 16 }, (_, i) => ({ at: 1 + 0.8 * i, major: i % 4 === 0, loud: i % 5 === 2 }))
    const speech = (energy: number, mood?: Script['mood']): Script => ({ utterances: [{ start: 0.5, end: 14.5, energy, onsets }], mood })
    const calm = perform(speech(0.2), 15)
    const excited = perform(speech(0.5, { valence: 0.6, arousal: 0.9 }), 15)
    const reach = (run: Run) => {
      const path = [...wristPath(run, 'left'), ...wristPath(run, 'right')]
      const ys = path.map(p => p[1])
      return Math.max(...ys) - Math.min(...ys)
    }
    expect(strokes(excited).length).toBeGreaterThanOrEqual(2 * strokes(calm).length)
    expect(reach(excited)).toBeGreaterThan(reach(calm))
  }, 60_000)

  it('moves a beat\'s fingers with the stroke and brings them back with the recovery', () => {
    // A beat closes the hand toward a cup, or in a set phrase opens the half-open hand fully. The index knuckle (channel
    // 12) follows behind the arm (4a: the hand shape last), so its turn counts from the hit, after the recovery's.
    let closing = 0
    for (const seed of [1, 2, 3, 4]) {
      const run = perform({ utterances: [utterance(0.5, 0.45, peaks(0.5, false))] }, 6.5, { seed })
      for (const beat of strokes(run).filter(s => s.form === 'beat' && s.hand !== 'both' && s.hit < 5.5)) {
        const side = beat.hand === 'left' ? 'left' : 'right'
        const curl = (time: number) => run.frames[Math.round(time / BODY_TICK) - 1].channels[ARM_START[side] + 12]
        const start = curl(beat.hit)
        let turn = 0
        for (let t = beat.hit; t <= beat.hit + 0.35; t += BODY_TICK) {
          if (Math.abs(curl(t) - start) > Math.abs(turn))
            turn = curl(t) - start
        }
        expect(Math.abs(turn) / DEG, `seed ${seed} at ${beat.hit}`).toBeGreaterThan(1.5)
        if (turn > 0) {
          closing++
          expect(turn / DEG).toBeGreaterThan(6)
          expect(Math.abs(curl(beat.hit + 0.8) - start)).toBeLessThan(0.4 * turn)
        }
      }
    }
    expect(closing).toBeGreaterThanOrEqual(2)
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
          const side = markedSide(run, stroke, rig)
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
          const path = wristPath(run, markedSide(run, stroke, rig), rig)
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

  it('lets an arm recovering from its hold go on to the ready key when the unit retracts, without a corrector kick', () => {
    // Speech ends at several times after the last stroke, so the retraction (0.3 s later) finds arms at every point of
    // their recovery, the leg from the post-stroke hold back to the ready key.
    const correction = { left: 0, right: 0 }
    let recovering = 0
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      for (const end of [5.9, 6.0, 6.1, 6.2, 6.3, 6.4]) {
        const run = perform({ utterances: [{ ...utterance(0.4, 0.65, peaks(0.4)), end: 0.4 + end }], tension: 0 }, 8.5, { traits: chisaTraits, seed, corrections: correction })
        const retraction = run.frames.findIndex(frame => frame.gesture.phase === 'retraction')
        if (retraction > 0 && run.frames[retraction - 1].gesture.phase === 'hold')
          recovering++
      }
    }
    expect(recovering).toBeGreaterThanOrEqual(5)
    expect(correction.left / BODY_TICK).toBeLessThanOrEqual(15 * DEG)
    expect(correction.right / BODY_TICK).toBeLessThanOrEqual(15 * DEG)
  }, 120_000)

  it('retracts a stroke cut by the unit\'s cap along its cleared path, without a corrector kick', () => {
    // Six strokes; the sixth starts 50 ms before the 9 s cap, as on the clip scenario's second rig, seed 5. They come
    // 1.6 s apart, the last 1.55 s: the calm hand waiting 1.95 s for the sixth let go first (`RISE`).
    const onsets = [1.0, 2.6, 4.2, 5.8, 7.4, 8.95].map((at, i) => ({ at: 0.5 + at, major: i % 2 === 0 }))
    for (const energy of [0.45, 0.85]) {
      for (const seed of [2, 3, 10]) {
        const run = perform({ utterances: [{ start: 0.5, end: 12, energy, onsets }] }, 12, { seed, traits: ellenTraits })
        const capped = run.frames.findIndex(frame => frame.time >= 9.5)
        expect(run.frames[capped - 2].gesture.phase).toBe('stroke')
        const side = run.frames[capped].gesture.hand === 'right' ? 'right' : 'left'
        const retracting = run.frames.findIndex(frame => frame.time >= 9.5 && frame.gesture.phase === 'retraction')
        let moved = 0
        let kick = 0
        for (let i = retracting; i < run.frames.length; i++) {
          const frame = run.frames[i]
          moved = Math.max(moved, frame.correction[side])
          if (frame.gesture.activation[side] === 1)
            kick = Math.max(kick, frame.correction[side] - run.frames[i - 1].correction[side])
        }
        // As for strokes past a real bust: the corrector does not move the retracting arm more than the unit's strokes
        // need, nor faster than half the pops report's velocity step.
        expect(moved).toBeLessThanOrEqual(6 * DEG)
        expect(kick / BODY_TICK).toBeLessThanOrEqual(15 * DEG)
      }
    }
  })

  it.each([['chisa', chisaTraits], ['ellen', ellenTraits]] as const)('hands a retracted arm back to the hang only once it is home on %s\'s real rig', (_, rig) => {
    // At rest the corrector holds these rigs' hanging arms out of the body by a few degrees, so the hang's target lies
    // inside its margin. An arm still travelling home when its weight starts to fall is carried into that margin moving,
    // and the corrector stops it in one tick. The trunk holds still, so every contact here comes from the exit itself.
    let exits = 0
    for (const energy of [0.45, 0.85]) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const run = perform({ utterances: [{ start: 2, end: 6.5, energy, onsets: [{ at: 2.4, major: true }] }], tension: 0, still: true }, 9, { seed, traits: rig })
        for (const side of SIDES) {
          const start = run.frames.findIndex(frame => frame.gesture.activation[side] > 0)
          if (start < 1)
            continue
          const home = run.frames[start - 1].channels
          // The hand lets go after its one stroke (`RISE`), before speaking ends.
          const handBack = run.frames.findIndex((frame, i) => frame.time > 2.4 && frame.gesture.activation[side] < 1 && run.frames[i - 1].gesture.activation[side] === 1)
          expect(handBack, `seed ${seed}, energy ${energy}, ${side}`).toBeGreaterThan(0)
          exits++
          // KEY_HEADROOM's settle: 1.9 degrees past a fed-forward key plus the elbow's 1.2 degree moving-hold noise.
          for (let j = 2; j <= 5; j++) {
            const c = ARM_START[side] + j
            expect(Math.abs(run.frames[handBack].channels[c] - home[c]), `seed ${seed}, energy ${energy}, ${side} channel ${j}`).toBeLessThanOrEqual(3.5 * DEG)
          }
        }
      }
    }
    expect(exits).toBeGreaterThanOrEqual(12)
  }, 120_000)

  it.each([['chisa', chisaTraits], ['ellen', ellenTraits]] as const)('hands an emotion arm form back to the hang only once the arm is home on %s\'s real rig', (_, rig) => {
    // The same margin as a speech unit's exit: a form arm still travelling home when its weight starts to fall is
    // stopped by the corrector in one tick.
    for (const side of SIDES) {
      for (const form of ['hand-to-chest', 'thinking-hand'] as const) {
        const run = perform({ utterances: [], armForm: t => t > 0.5 && t < 4 ? { side, form } : null, tension: 0, still: true }, 7, { seed: 1, traits: rig })
        const start = run.frames.findIndex(frame => frame.gesture.activation[side] > 0)
        expect(start, `${form}, ${side}`).toBeGreaterThan(0)
        const home = run.frames[start - 1].channels
        const handBack = run.frames.findIndex((frame, i) => frame.time > 4 && frame.gesture.activation[side] < 1 && run.frames[i - 1].gesture.activation[side] === 1)
        expect(handBack, `${form}, ${side}`).toBeGreaterThan(0)
        for (let j = 2; j <= 5; j++) {
          const c = ARM_START[side] + j
          expect(Math.abs(run.frames[handBack].channels[c] - home[c]), `${form}, ${side} channel ${j}`).toBeLessThanOrEqual(3.5 * DEG)
        }
      }
    }
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

  it('shows every form over 500 seeds of neutral speech, more with the dominant hand, larger at higher energy', () => {
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
    expect([...forms].sort()).toEqual(Object.keys(GESTURE_FORMS).sort())
    expect(hands.right).toBeGreaterThan(hands.left)
    const mean = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length
    expect(mean(travel.high)).toBeGreaterThan(mean(travel.low))
  }, 120_000)

  it('cuts a chop nearly straight down, apart from a beat\'s forward fall by more than the report\'s 10 deg', () => {
    // A phrase's beats leave from several places and keep its hand, so the chop cannot rely on its hand alone to read
    // as its own form.
    const angle = (a: readonly number[], b: readonly number[]) => Math.acos(a.reduce((s, v, k) => s + v * b[k], 0) / Math.hypot(...a) / Math.hypot(...b))
    expect(angle(GESTURE_FORMS.chop.stroke, [0, -1, 0])).toBeLessThan(5 * DEG)
    expect(angle(GESTURE_FORMS.chop.stroke, GESTURE_FORMS.beat.stroke)).toBeGreaterThan(20 * DEG)
  })

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

  it('holds a two-hand stroke\'s shape less fully on the second hand, so the hands do not mirror', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const run = perform({ utterances: [utterance(0.3, 0.85, peaks(0.3))] }, 6.5, { seed })
      const both = strokes(run).find(stroke => stroke.hand === 'both' && stroke.form !== 'beat')
      if (!both)
        continue
      const landed = SIDES.map(side => apexes(run, side).find(time => time >= both.onset + 0.06) ?? Number.NaN)
      const frame = run.frames[Math.round((Math.max(...landed) + 0.1) / BODY_TICK)]
      const shape = new Float64Array(26)
      const ready = new Float64Array(26)
      writeHandShape(GESTURE_FORMS[both.form as keyof typeof GESTURE_FORMS].shape, shape)
      // The ready hand, half way from relaxed to open: both hands ease back toward it through the hold.
      writeHandShare('open', 0.5, ready)
      // Each hand's summed finger curl away from the form's shape, in degrees, against the shape's own way from the
      // ready hand.
      const off = SIDES.map((side) => {
        let sum = 0
        for (let j = 12; j < 24; j++)
          sum += Math.abs(frame.channels[ARM_START[side] + j] - shape[j]) / DEG
        return sum
      })
      let span = 0
      for (let j = 12; j < 24; j++)
        span += Math.abs(ready[j] - shape[j]) / DEG
      const first = landed[0] < landed[1] ? 0 : 1
      // The second hand sits a share of the way back toward relaxed; the first holds the shape.
      expect(off[1 - first] - off[first]).toBeGreaterThan(0.2 * span)
      return
    }
    throw new Error('No two-hand stroke of a shaped form in 200 seeds at energy 0.85')
  })

  it('holds a hand at its ready key curled less than the rest hand, so held palm down it is no claw', () => {
    // Hands raised at 0.5 s with nothing to stroke wait at their ready keys until they let go.
    const relaxed = new Float64Array(26)
    writeHandShape('relaxed', relaxed)
    const curl = (hand: ArrayLike<number>, start: number) => Array.from({ length: 4 }, (_, finger) => hand[start + 13 + finger * 3] + hand[start + 14 + finger * 3]).reduce((a, b) => a + b)
    for (const rig of [chisaTraits, ellenTraits]) {
      const run = perform({ utterances: [utterance(0.5, 0.65, [])] }, 1.6, { traits: rig })
      const frame = run.frames.at(-1)!
      const side = frame.gesture.hand === 'left' ? 'left' : 'right'
      expect(frame.gesture.activation[side]).toBe(1)
      expect(curl(frame.channels, ARM_START[side])).toBeLessThanOrEqual(0.8 * curl(relaxed, 0))
    }
  })

  it('sends consecutive beats of a hand along different paths', () => {
    // The speak scenario's peaks; a beat's direction is the wrist's travel over the 0.1 s before its hit. One beat in ten
    // used to repeat the last one's direction within 1.5 degrees.
    const speak = [0.8, 1.8, 3.03, 3.98, 5.17, 6.1, 7.2].map((at, i) => ({ at: 0.3 + at, major: i % 2 === 0 }))
    let pairs = 0
    for (let seed = 1; seed <= 30; seed++) {
      const run = perform({ utterances: [utterance(0.3, 0.65, speak)] }, 8.5, { seed, traits: chisaTraits })
      const frameAt = (time: number) => run.frames.findIndex(frame => frame.time >= time)
      const beats = strokes(run).filter(stroke => stroke.form === 'beat' && stroke.hand !== 'both')
      for (let k = 1; k < beats.length; k++) {
        const [a, b] = [beats[k - 1], beats[k]]
        if (a.hand !== b.hand || run.frames[a.index].gesture.unitSeq !== run.frames[b.index].gesture.unitSeq)
          continue
        const path = wristPath(run, a.hand === 'left' ? 'left' : 'right', chisaTraits)
        const [u, v] = [a, b].map(beat => [0, 1, 2].map(j => path[frameAt(beat.hit)][j] - path[frameAt(beat.hit - 0.1)][j]))
        const angle = Math.acos(Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / Math.hypot(...u) / Math.hypot(...v)))
        expect(angle, `seed ${seed}, ${a.hand} beats at ${a.hit.toFixed(2)} and ${b.hit.toFixed(2)}`).toBeGreaterThanOrEqual(8 * DEG)
        pairs++
      }
    }
    expect(pairs).toBeGreaterThanOrEqual(30)
  }, 120_000)

  it('lands every two-hand stroke of a unit with the second hand 30 to 90 ms behind, its hold as long as the first hand\'s', () => {
    // The gesture-timing rule: the nearest apex of each hand within 200 ms of the stroke's reported apex.
    // The speak scenario's peaks: 0.8 to 1.25 s apart, so a stroke can meet one hand still recovering from its hold.
    const speak = [0.8, 1.8, 3.03, 3.98, 5.17].map((at, i) => ({ at: 0.3 + at, major: i % 2 === 0 }))
    let later = 0
    for (let seed = 1; seed <= 90; seed++) {
      const run = perform({ utterances: [utterance(0.3, 0.65, speak)] }, 6.5, { seed, traits: chisaTraits })
      const both = strokes(run).filter(stroke => stroke.hand === 'both')
      for (const stroke of both) {
        const [left, right] = SIDES.map(side => nearest(apexes(run, side, chisaTraits), stroke.hit))
        expect(Math.abs(left - stroke.hit), `seed ${seed} stroke ${stroke.hit.toFixed(3)}`).toBeLessThanOrEqual(0.2)
        expect(Math.abs(right - stroke.hit), `seed ${seed} stroke ${stroke.hit.toFixed(3)}`).toBeLessThanOrEqual(0.2)
        expect(Math.abs(left - right), `seed ${seed} stroke ${stroke.hit.toFixed(3)}`).toBeGreaterThanOrEqual(0.03 - 1e-9)
        expect(Math.abs(left - right), `seed ${seed} stroke ${stroke.hit.toFixed(3)}`).toBeLessThanOrEqual(0.09 + 1e-9)
      }
      later += Math.max(0, both.length - 1)
    }
    // Strokes after a unit's first are the ones that leave a post-stroke hold. 90 seeds: a hand left out of a one-hand
    // phrase now lets go (`RISE`), so fewer units stroke with both hands again.
    expect(later).toBeGreaterThanOrEqual(5)
  }, 120_000)

  it.each([['chisa', chisaTraits], ['ellen', ellenTraits]] as const)('marks every stroke where it lands, also when it starts while the arm still moves, on %s', (_, rig) => {
    // The speak scenario's peaks come 0.8 to 1.25 s apart, so strokes start during recoveries, corrected ones among
    // them. A marked apex ends its stroke: the hand does not speed up past half the stroke's peak within 0.15 s after it.
    const speak = [0.8, 1.8, 3.03, 3.98, 5.17].map((at, i) => ({ at: 0.3 + at, major: i % 2 === 0 }))
    const after = Math.round(0.15 / BODY_TICK)
    for (let seed = 1; seed <= 40; seed++) {
      const run = perform({ utterances: [utterance(0.3, 0.65, speak)] }, 6.5, { seed, traits: rig })
      const paths = { left: wristPath(run, 'left', rig), right: wristPath(run, 'right', rig) }
      const speed = (side: 'left' | 'right', i: number) => Math.hypot(...[0, 1, 2].map(k => paths[side][i][k] - paths[side][i - 1][k]))
      for (const stroke of strokes(run)) {
        // A two-hand stroke is marked on its first hand; the second lands 40 to 70 ms later.
        const sides = stroke.hand === 'both' ? SIDES : [stroke.hand === 'left' ? 'left' as const : 'right' as const]
        const at = run.frames.findIndex(frame => frame.time >= stroke.hit - 1e-9)
        const ratio = Math.min(...sides.map((side) => {
          const peak = Math.max(...Array.from({ length: Math.round(0.3 / BODY_TICK) }, (_, k) => speed(side, at - k)))
          return Math.max(...Array.from({ length: after }, (_, k) => speed(side, at + 1 + k))) / peak
        }))
        expect(ratio, `seed ${seed} stroke ${stroke.hit.toFixed(3)}`).toBeLessThanOrEqual(0.5)
      }
    }
  }, 120_000)

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

  it('keeps gesturing with the free hand when a clip claims one arm of a two-handed unit', () => {
    const script: Script = { utterances: [utterance(0.5, 0.85, peaks(0.5))] }
    // The app's upper-layer fade claims the right arm two ticks into the stroke on the 2.6 s onset.
    const claimAt = 2.6 + 2 * BODY_TICK
    const claim = (time: number) => {
      const u = Math.max(0, Math.min(1, (time - claimAt) / 0.25))
      return u * u * (3 - 2 * u)
    }
    // Seeds 4 and 7 draw a two-handed first unit led by the right hand.
    for (const seed of [4, 7]) {
      expect(strokes(perform(script, 8, { seed, traits: chisaTraits }))[0]?.hand).toBe('both')
      const run = perform({ ...script, owned: time => ({ rightArm: claim(time), rightFingers: claim(time) }) }, 8, { seed, traits: chisaTraits })
      expect(run.frames.find(frame => frame.time >= claimAt)?.gesture.activation.right).toBe(1)
      const next = strokes(run).find(stroke => Math.abs(stroke.onset - 3.5) < BODY_TICK / 2)
      expect(next?.hand).toBe('left')
      const speed = (path: readonly (readonly number[])[]) => path.map((p, i) => i ? Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1], p[2] - path[i - 1][2]) / BODY_TICK : 0)
      const idle = Math.max(...speed(wristPath(perform({ utterances: [] }, 8, { seed, traits: chisaTraits }), 'left', chisaTraits)))
      const stroke = speed(wristPath(run, 'left', chisaTraits)).filter((_, i) => run.frames[i].time >= 3.5 && run.frames[i].time <= (next?.hit ?? 0))
      expect(Math.max(...stroke)).toBeGreaterThan(2 * idle)
      // The free arm never waits at full weight for longer than one inter-peak interval without a planned motion.
      let waiting = 0
      let longest = 0
      for (const frame of run.frames) {
        const moving = frame.gesture.phase === 'preparation' || frame.gesture.phase === 'stroke' || frame.gesture.phase === 'retraction'
        waiting = moving || frame.gesture.activation.left < 1 ? 0 : waiting + BODY_TICK
        longest = Math.max(longest, waiting)
      }
      expect(longest).toBeLessThanOrEqual(1.2)
    }
  })

  it('nods the head with each stroke, its apex on the hit, 3 degrees for a major stroke', () => {
    const pitch = [channelIndex('neckPitch'), channelIndex('headPitch')]
    const yaw = [channelIndex('neckYaw'), channelIndex('headYaw')]
    // The phrase tilts the head toward a one-handed phrase's hand (`BODY`), held from its preparation on: a slow lean,
    // never a beat.
    const roll = [channelIndex('neckRoll'), channelIndex('headRoll')]
    // A still facing, then the feet turning 40 degrees under the gaze during the utterance (the gaze head held in space).
    const turning = (time: number) => 40 * DEG * Math.max(0, Math.min(1, (time - 2) / 3))
    const added: number[][] = []
    for (const facing of [undefined, turning]) {
      const script: Script = { utterances: [utterance(0.5, 0.65, peaks(0.5))], facing }
      const run = perform(script, 9)
      const silent = perform(script, 9, { layers: false })
      const nod = run.frames.map((frame, i) => pitch.reduce((sum, c) => sum + frame.channels[c] - silent.frames[i].channels[c], 0) / DEG)
      added.push(nod)
      for (let i = 0; i < run.frames.length; i++) {
        for (const c of yaw)
          expect(run.frames[i].channels[c]).toBe(silent.frames[i].channels[c])
        for (const c of roll) {
          const tilt = (frame: number) => run.frames[frame].channels[c] - silent.frames[frame].channels[c]
          expect(Math.abs(tilt(i))).toBeLessThanOrEqual(2 * DEG)
          if (i > 0)
            expect(Math.abs(tilt(i) - tilt(i - 1)) / BODY_TICK).toBeLessThanOrEqual(15 * DEG)
        }
      }
      const found = strokes(run)
      expect(found.length).toBeGreaterThanOrEqual(4)
      for (const stroke of found) {
        const major = peaks(0.5).find(peak => Math.abs(peak.at - stroke.onset) < BODY_TICK / 2)?.major
        let apex = 0
        for (let i = 0; i < run.frames.length; i++) {
          if (Math.abs(run.frames[i].time - stroke.hit) < 0.3 && nod[i] > nod[apex])
            apex = i
        }
        expect(nod[apex]).toBeCloseTo(major ? 3 : 1.8, 1)
        expect(run.frames[apex].time).toBeGreaterThanOrEqual(stroke.hit - 3 * BODY_TICK - 1e-9)
        expect(run.frames[apex].time).toBeLessThanOrEqual(stroke.hit + BODY_TICK + 1e-9)
      }
    }
    // The same beat on top of a different gaze pitch: equal to the frame's float32 resolution (about 4e-7 degrees here).
    expect(Math.max(...added[0].map((v, i) => Math.abs(v - added[1][i])))).toBeLessThan(1e-5)
  })

  it('drops Natural\'s emphasis nod from the head while a gesture unit performs', () => {
    const head = [15, 16, 17, 18, 19, 20]
    const utterances = [utterance(0.5, 0.65, peaks(0.5))]
    const headEmphasis = (time: number) => time >= 0.6 && time < 6.5 ? 1 * DEG : 0
    const plain = perform({ utterances }, 9)
    const emphasised = perform({ utterances, headEmphasis }, 9)
    const performing = plain.frames.flatMap((frame, i) => frame.gesture.phase !== 'rest' ? [i] : [])
    expect(performing.length * BODY_TICK).toBeGreaterThan(5)
    for (const i of performing) {
      for (const c of head)
        expect(emphasised.frames[i].channels[c]).toBe(plain.frames[i].channels[c])
    }
    // Without the gesture layers the same term moves the head.
    const alone = perform({ utterances }, 9, { layers: false })
    const aloneEmphasised = perform({ utterances, headEmphasis }, 9, { layers: false })
    const moved = Math.max(...alone.frames.map((frame, i) => Math.abs(aloneEmphasised.frames[i].channels[19] - frame.channels[19])))
    expect(moved).toBeGreaterThan(0.5 * DEG)
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

  it('corrects about 40 % of preparations and retractions with an overlapping second submovement, by seed', () => {
    const script: Script = { utterances: [utterance(0.5, 0.65, [], { end: 2 })], still: true }
    // Each transition's speed peaks on the arm's output (flex, abduction, twist, elbow), counted by `speedPeaks`.
    const transitions = (seed: number) => {
      const run = perform(script, 5, { seed })
      const side = run.frames.find(frame => frame.gesture.hand)?.gesture.hand === 'left' ? 'left' : 'right'
      const fed = [2, 3, 4, 5].map(j => ARM_START[side] + j)
      const speed = run.frames.map((frame, i) => i ? Math.hypot(...fed.map(c => frame.channels[c] - run.frames[i - 1].channels[c])) : 0)
      return (['preparation', 'retraction'] as const).map((phase) => {
        const start = run.frames.findIndex(frame => frame.gesture.phase === phase)
        const end = run.frames.findIndex((frame, i) => i > start && frame.gesture.phase !== phase) + Math.round(0.15 / BODY_TICK)
        const span = speed.slice(start, end)
        const peaks = speedPeaks(span)
        return peaks.length < 2 ? null : { ratio: span[peaks[1]] / span[peaks[0]], trough: Math.min(...span.slice(peaks[0], peaks[1])) / span[peaks[0]] }
      })
    }
    const all = Array.from({ length: 40 }, (_, k) => transitions(k + 1)).flat()
    const corrected = all.filter(t => t !== null)
    expect(corrected.length / all.length).toBeGreaterThan(0.25)
    expect(corrected.length / all.length).toBeLessThan(0.55)
    for (const { ratio, trough } of corrected) {
      expect(ratio).toBeGreaterThan(0.5)
      expect(ratio).toBeLessThan(1.2)
      expect(trough).toBeGreaterThan(0.15)
      expect(trough).toBeLessThan(0.6)
    }
    expect(transitions(7)).toEqual(all.slice(12, 14))
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
    // Up to 1.75 s: the hands, raised at 0.5 s with nothing to stroke, let go about 1.3 s after they are ready (`RISE`).
    for (let tick = 1; tick <= Math.round(1.75 / BODY_TICK); tick++) {
      const frame = performer.step(speechInput(script, tick * BODY_TICK, state))
      frames.push({ channels: frame.channels.slice(), unitSeq: frame.diagnostics.gesture.unitSeq, hand: frame.diagnostics.gesture.hand })
    }
    const start = frames.findIndex(frame => frame.unitSeq === 1)
    const side = frames[start].hand === 'left' ? 'left' : 'right'
    // By 1.75 s the layer's target has settled on the ready key; each arm angle stays between where it began and the
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
          expect(keys.solve(side, keys.readyKey(energy, { ...NO_OFFSET, out: outward }), ready)).toBe(true)
          const stroke = ready.slice()
          writeHandShape(GESTURE_FORMS[form].shape, stroke)
          const size = gestureGain(energy) * GESTURE_FORMS[form].scale
          expect(keys.solve(side, keys.strokeKey(keys.readyKey(energy, { ...NO_OFFSET, out: outward }), form, size), stroke, ready)).toBe(true)
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
        writeArmFormHand(form, side, pose)
        expect(keys.armForm(side, form, pose), `${side} ${form}`).toBe(true)
        expect(keys.pathDepth(side, from, pose)).toBe(0)
        for (let j = 2; j <= 8; j++) {
          const [min, max] = JOINT_LIMITS[start + j]
          expect(Math.min(pose[j] - min, max - pose[j]) / DEG, `${side} ${form} joint ${j}`).toBeGreaterThanOrEqual(2)
        }
      }
    }
  })

  it.each(fixtureRigs)('lays one hand over the other at the front-low anchor, clear and 2 degrees inside every limit, on $name', ({ traits: rig }) => {
    const rest = createBodyPerformer({ traits: rig, seed: 1 }).restChannels()
    const keys = new GestureKeys(rig, rest)
    const channels = rest.slice()
    for (const side of SIDES) {
      const start = ARM_START[side]
      const from = new Float64Array(rest.subarray(start, start + 26))
      const pose = from.slice()
      writeArmFormHand('clasp', side, pose)
      expect(keys.armForm(side, 'clasp', pose), side).toBe(true)
      expect(keys.pathDepth(side, from, pose), side).toBe(0)
      for (let j = 2; j <= 8; j++) {
        const [min, max] = JOINT_LIMITS[start + j]
        expect(Math.min(pose[j] - min, max - pose[j]) / DEG, `${side} joint ${j}`).toBeGreaterThanOrEqual(2)
      }
      channels.set(pose, start)
    }
    const skeleton = new BodySkeleton(rig)
    skeleton.update(channels)
    const arm = rig.arms.left
    const forearm = Math.hypot(arm.forearm.x, arm.forearm.y, arm.forearm.z)
    const length = Math.hypot(arm.upperArm.x, arm.upperArm.y, arm.upperArm.z) + forearm
    const hands = SIDES.map((side) => {
      const pose = skeleton.arm(side, channels)
      const h = pose.hand
      const sigma = side === 'left' ? 1 : -1
      // The hand points along its frame's -y and its palm faces its -sigma x.
      return { wrist: { ...pose.wrist }, tip: { x: h[9] - arm.handLength * h[1], y: h[10] - arm.handLength * h[4], z: h[11] - arm.handLength * h[7] }, palm: -sigma * h[6] }
    })
    const [left, right] = hands
    // Just below the waist: the wrists one hand breadth under ANSUR II's female waist (omphalion) height, in the rig's
    // leg lengths by the women's waist, trochanterion and lateral malleolus heights and hand breadth (Gordon et al. 2014).
    const legs = rig.legs
    if (!legs)
      throw new Error('a fixture rig has leg joints')
    const hipJoint = (legs.left.hip.y + legs.right.hip.y) / 2
    const height = hipJoint + (98.01 - 84.54 - 7.82) / (84.54 - 6.27) * rig.legLength
    for (const hand of hands) {
      expect(Math.abs(hand.wrist.y - height) / length).toBeLessThan(0.02)
      expect(hand.wrist.z).toBeGreaterThan(rig.hips.z)
      // The palm faces the body, rolled toward the other hand by at most the clasp's 30 degrees (re-pinned from flat
      // to the body: a hand held flat met the other in a V on six rigs).
      expect(hand.palm).toBeLessThan(-Math.cos(30 * DEG) + 1e-6)
    }
    expect(Math.abs((left.wrist.x + right.wrist.x) / 2 - rig.hips.x) / length).toBeLessThan(0.02)
    // The hands cross the midline, each past the other's wrist side, and the right one lies a hand's thickness in front.
    expect(left.tip.x).toBeLessThan(rig.hips.x)
    expect(right.tip.x).toBeGreaterThan(rig.hips.x)
    expect(Math.abs(right.wrist.z - left.wrist.z - 0.12 * forearm) / length).toBeLessThan(0.005)
  })

  it.each([['ellen', ellenTraits], ['vivian', fixtureRigs[1].traits], ['chisa', chisaTraits]] as const)('rests the thinking hand\'s index fingertip on the face on %s', (_, rig) => {
    const rest = createBodyPerformer({ traits: rig, seed: 1 }).restChannels()
    const keys = new GestureKeys(rig, rest)
    const collision = new BodyCollision(rig, rest.slice())
    const skeleton = new BodySkeleton(rig)
    for (const side of SIDES) {
      const start = ARM_START[side]
      const from = new Float64Array(rest.subarray(start, start + 26))
      const pose = from.slice()
      writeArmFormHand('thinking-hand', side, pose)
      expect(keys.armForm(side, 'thinking-hand', pose), side).toBe(true)
      expect(keys.pathDepth(side, from, pose), side).toBe(0)
      const channels = rest.slice()
      channels.set(pose, start)
      skeleton.update(channels)
      const h = skeleton.arm(side, channels).hand
      const { handLength, upperArm, forearm } = rig.arms[side]
      const length = Math.hypot(upperArm.x, upperArm.y, upperArm.z) + Math.hypot(forearm.x, forearm.y, forearm.z)
      const tip = { x: h[9] - handLength * h[1], y: h[10] - handLength * h[4], z: h[11] - handLength * h[7] }
      // The fingertip leads: it ends clear of the head proxies, nearer them than the wrist, within the first back-off
      // steps from the anchor march's 0.01 A clearance (the elbow's 142 degree limit keeps the hand that far out).
      const gap = collision.distance(tip.x, tip.y, tip.z) / length
      const wrist = skeleton.arm(side, channels).wrist
      expect(gap, side).toBeGreaterThan(0.004)
      expect(gap, side).toBeLessThan(0.07)
      expect(collision.distance(wrist.x, wrist.y, wrist.z) / length, side).toBeGreaterThan(gap)
    }
  })

  it('reports the clasp capability on a rig whose arms reach the front-low anchor, and not on one whose arms cannot', () => {
    expect(createBodyPerformer({ traits: fixtureRigs[0].traits, seed: 1 }).step(quietInput(0)).capabilities.clasp).toBe(true)
    // Chisa's body proxies leave no clear key at the clasp's height (E/fc/u1/clasp-height/probe-clasp-height.txt).
    expect(createBodyPerformer({ traits: chisaTraits, seed: 1 }).step(quietInput(0)).capabilities.clasp).toBe(false)
  })

  it('puts the combing fingertips on the side of the head at the tragion, then one ear breadth back, palm toward the head, clear and 2 degrees inside every limit, on Chisa', () => {
    const rig = chisaTraits
    const rest = createBodyPerformer({ traits: rig, seed: 1 }).restChannels()
    const keys = new GestureKeys(rig, rest)
    const skeleton = new BodySkeleton(rig)
    const collision = new BodyCollision(rig, rest)
    const arm = rig.arms.left
    const length = Math.hypot(arm.upperArm.x, arm.upperArm.y, arm.upperArm.z) + Math.hypot(arm.forearm.x, arm.forearm.y, arm.forearm.z)
    // ANSUR II's women (Gordon et al. 2014): the tragion 12.65 cm under the top of a head 14.78 cm broad, the ear 3.32 cm
    // broad, scaled by the widest span of the head proxies across the head bone.
    let top = rig.head.y + length
    while (collision.distance(rig.head.x, top, rig.head.z) > 0)
      top -= 0.002 * length
    let breadth = 0
    for (let y = rig.head.y; y < top; y += 0.01 * length) {
      let x = rig.head.x + length
      while (x > rig.head.x && collision.distance(x, y, rig.head.z) > 0)
        x -= 0.005 * length
      breadth = Math.max(breadth, 2 * (x - rig.head.x))
    }
    const tragion = top - 12.65 / 14.78 * breadth
    const back = 3.32 / 14.78 * breadth
    for (const side of SIDES) {
      const start = ARM_START[side]
      const from = new Float64Array(rest.subarray(start, start + 26))
      const touch = from.slice()
      writeArmFormHand('hair-touch', side, touch)
      expect(keys.armForm(side, 'hair-touch', touch), side).toBe(true)
      const sweep = touch.slice()
      expect(keys.armForm(side, 'hair-sweep', sweep), side).toBe(true)
      expect(keys.pathDepth(side, from, touch), side).toBe(0)
      expect(keys.pathDepth(side, touch, sweep), side).toBe(0)
      const tips = [touch, sweep].map((pose) => {
        for (let j = 2; j <= 8; j++) {
          const [min, max] = JOINT_LIMITS[start + j]
          expect(Math.min(pose[j] - min, max - pose[j]) / DEG, `${side} joint ${j}`).toBeGreaterThanOrEqual(2)
        }
        const channels = rest.slice()
        channels.set(pose, start)
        skeleton.update(channels)
        const hand = skeleton.arm(side, channels).hand
        // The palm faces the side of the head within the tuck's 50 degree roll about the hand: its normal, the hand
        // frame's -sigma x, against the way across to the midline square to the hand (its frame's -y).
        const sigma = side === 'left' ? 1 : -1
        const along = sigma * hand[1]
        const across = [-sigma + along * hand[1], along * hand[4], along * hand[7]]
        const facing = -sigma * (hand[0] * across[0] + hand[3] * across[1] + hand[6] * across[2]) / Math.hypot(...across)
        expect(facing, side).toBeGreaterThan(Math.cos(50 * DEG) - 1e-6)
        return { x: hand[9] - arm.handLength * hand[1], y: hand[10] - arm.handLength * hand[4], z: hand[11] - arm.handLength * hand[7] }
      })
      const sigma = side === 'left' ? 1 : -1
      for (const [tip, depth] of [[tips[0], rig.head.z], [tips[1], rig.head.z - back]] as const) {
        // At the side of the head, at the tragion's height and the anchor's depth, where 6.3's march stops: the hand
        // capsule's radius plus 0.01 A off the proxies.
        expect(sigma * (tip.x - rig.head.x) / length, side).toBeGreaterThan(0.15)
        expect(Math.abs(tip.y - tragion) / length, side).toBeLessThan(0.01)
        expect(Math.abs(tip.z - depth) / length, side).toBeLessThan(0.01)
        const reach = 0.15 * Math.hypot(arm.forearm.x, arm.forearm.y, arm.forearm.z) + 0.01 * length
        expect(Math.abs(collision.distance(tip.x, tip.y, tip.z) - reach) / length, side).toBeLessThan(0.01)
      }
    }
  })

  it('refuses the hair tuck on a rig whose arms cannot reach its anchor, and reports the capability wherever both arms reach it', () => {
    // The fixture Ellen's proportional head proxy is small, so its tragion sits low beside the neck, out of reach.
    const rig = fixtureRigs[0].traits
    const rest = createBodyPerformer({ traits: rig, seed: 1 }).restChannels()
    const keys = new GestureKeys(rig, rest)
    for (const side of SIDES) {
      const pose = new Float64Array(rest.subarray(ARM_START[side], ARM_START[side] + 26))
      expect(keys.armForm(side, 'hair-touch', pose), side).toBe(false)
      expect(keys.armForm(side, 'hair-sweep', pose), side).toBe(false)
    }
    const capability = (traits: BodyRigTraits) => createBodyPerformer({ traits, seed: 1 }).step(quietInput(0)).capabilities
    expect(capability(rig).hairTouch).toBe(false)
    expect(capability(chisaTraits).hairTouch).toBe(true)
    // Ellen's conservative head probe reports no head clearance, but her arms reach both keys clear of her head, which
    // is the clearance 4e act 8 asks for.
    expect(capability(ellenTraits).headClearance).toEqual({ left: false, right: false })
    expect(capability(ellenTraits).hairTouch).toBe(true)
  })

  it('sweeps a held hair touch on to the sweep without going home, and never starts the sweep on its own', () => {
    const held = perform({ utterances: [], armForm: time => time > 0.2 && time < 2 ? { side: 'right', form: 'hair-touch' } : time >= 2 && time < 4 ? { side: 'right', form: 'hair-sweep' } : null }, 6, { traits: chisaTraits })
    const at = (run: typeof held, time: number) => run.frames[Math.round(time / BODY_TICK) - 1].gesture.activation.right
    for (const time of [1, 2, 2.5, 3.9])
      expect(at(held, time), `${time} s`).toBe(1)
    expect(at(held, 6)).toBe(0)
    const alone = perform({ utterances: [], armForm: time => time > 0.2 && time < 4 ? { side: 'right', form: 'hair-sweep' } : null }, 4, { traits: chisaTraits })
    expect(alone.frames.every(frame => frame.gesture.activation.right === 0)).toBe(true)
  })

  it('holds a two-hand clasp on both arms, lets one hand go first, then the other', () => {
    const script: Script = { utterances: [], armForm: time => time > 0.2 && time < 4 ? { side: 'both', form: 'clasp' } : time >= 4 && time < 5 ? { side: 'right', form: 'clasp' } : null }
    const run = perform(script, 8)
    const at = (time: number) => run.frames[Math.round(time / BODY_TICK) - 1].gesture.activation
    expect(at(3)).toEqual({ left: 1, right: 1 })
    expect(at(4.9)).toEqual({ left: 0, right: 1 })
    expect(at(8)).toEqual({ left: 0, right: 0 })
    expect(run.frames.at(-1)?.holds).toBe(0)
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
