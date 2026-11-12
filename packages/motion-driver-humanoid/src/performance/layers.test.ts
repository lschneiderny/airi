import type { BodyPerformanceInput } from './contracts'

import { describe, expect, it } from 'vitest'

import { ARM_START, BODY_TICK, channelIndex, DEG } from './channels'
import { createBodyPerformer } from './index'
import { createPerformanceLayers } from './layers'
import { channelTrace, fixtureRigs, idleInput, quietInput } from './performance.test-fixtures'

const traits = fixtureRigs[0].traits
const c = channelIndex
const NOD_AT = 0.5
const NOD_SECONDS = 0.45
const NOD_DEG = 6.6

function layered(seed = 1) {
  return createBodyPerformer({ traits, seed, layers: createPerformanceLayers({ traits, seed }) })
}

/** Natural's nod as it reaches the body: the cue record plus Natural's own head cue term (one dip of 6.6 degrees). */
function nod(t: number): BodyPerformanceInput {
  const input = quietInput(t)
  const u = (t - NOD_AT) / NOD_SECONDS
  const pitch = u > 0 && u < 1 ? NOD_DEG * DEG * Math.sin(Math.PI * u) : 0
  return {
    ...input,
    head: { ...input.head, terms: { ...input.head.terms, cue: { yaw: 0, pitch, roll: 0 } } },
    events: { ...input.events, cue: t < NOD_AT ? null : { seq: 1, start: NOD_AT, end: NOD_AT + NOD_SECONDS, kind: 'nod', count: 1, side: 1 } },
  }
}

function held(emotion: BodyPerformanceInput['held']['emotion'], strength: number, from: number, base: (t: number) => BodyPerformanceInput = quietInput) {
  return (t: number): BodyPerformanceInput => {
    const input = base(t)
    return t < from ? input : { ...input, held: { emotion, strength, level: 1, side: 1 } }
  }
}

/** Speech as Natural maps it: a 0.1 voice floor, a bump at each onset, Natural's 250 ms slow envelope. */
function speaking(onsets: readonly number[], start: number, end: number) {
  const state = { onset: 0, slow: 0 }
  return (t: number): BodyPerformanceInput => {
    const input = idleInput(t)
    let level = t >= start && t < end ? 0.1 : 0
    if (onsets.some(at => Math.abs(t - at) < BODY_TICK / 2)) {
      state.onset++
      level = 0.45
    }
    state.slow = level + (state.slow - level) * Math.exp(-BODY_TICK / 0.25)
    return { ...input, voice: { speaking: t >= start && t < end, level, slow: state.slow, onsetSeq: state.onset, emphasis: null } }
  }
}

function frames(script: (t: number) => BodyPerformanceInput, seconds: number) {
  const performer = layered()
  const out: { channels: Float32Array, activation: { left: number, right: number }, hand: string | null, phase: string, inhales: number }[] = []
  for (let tick = 0; tick < seconds / BODY_TICK; tick++) {
    const frame = performer.step(script(tick * BODY_TICK))
    const g = frame.diagnostics.gesture
    out.push({ channels: frame.channels.slice(), activation: { ...g.activation }, hand: g.hand, phase: g.phase, inhales: frame.diagnostics.inhales })
  }
  return out
}

/** Largest per-tick second difference of one arm's nine joint channels, radians. */
function armJerk(run: ReturnType<typeof frames>, side: 'left' | 'right') {
  let largest = 0
  for (let i = 2; i < run.length; i++) {
    for (let j = ARM_START[side]; j < ARM_START[side] + 9; j++)
      largest = Math.max(largest, Math.abs(run[i].channels[j] - 2 * run[i - 1].channels[j] + run[i - 2].channels[j]))
  }
  return largest
}

describe('registered performance layers', () => {
  it('leave the output bit-identical without speech, emotion, cue, touch or clip input', () => {
    for (const rig of fixtureRigs) {
      const base = channelTrace(createBodyPerformer({ traits: rig.traits, seed: 3 }), 30, idleInput)
      const all = channelTrace(createBodyPerformer({ traits: rig.traits, seed: 3, layers: createPerformanceLayers({ traits: rig.traits, seed: 3 }) }), 30, idleInput)
      expect(all, rig.name).toEqual(base)
    }
  })

  it('play a nod on the head once when Natural also sends its own head cue', () => {
    const still = channelTrace(layered(), 2, quietInput)
    const nodded = channelTrace(layered(), 2, nod)
    const pitch = nodded[c('neckPitch')].map((v, i) => v + nodded[c('headPitch')][i] - still[c('neckPitch')][i] - still[c('headPitch')][i])
    const peak = Math.max(...pitch) / DEG
    expect(peak).toBeGreaterThan(NOD_DEG * 0.9)
    expect(peak).toBeLessThan(NOD_DEG * 1.1)
  })

  it('sigh once at a sad onset', () => {
    const run = frames(held('sad', 1, 1), 4)
    expect(run[Math.round(0.9 / BODY_TICK)].inhales).toBe(0)
    expect(run.at(-1)?.inhales).toBe(1)
  })

  it('perform the thinking hand an emotion requests above weight 0.5, and none below', () => {
    const strong = frames(held('think', 1, 0.5), 4)
    const weak = frames(held('think', 0.4, 0.5), 4)
    expect(strong.at(-1)?.activation.right).toBe(1)
    expect(Math.max(...weak.map(frame => frame.activation.right))).toBe(0)
  })

  it('never cut a gesturing arm that an emotion form asks for: the form waits for the retraction', () => {
    const onsets = [1.2, 2.0, 2.8, 3.6]
    const speech = speaking(onsets, 0.6, 4.2)
    const alone = frames(speech, 9)
    const side = alone.find(frame => frame.hand === 'left' || frame.hand === 'right')?.hand as 'left' | 'right' | undefined
    expect(side).toBeDefined()
    if (!side)
      return
    // The emotion asks for the gesturing arm in the middle of the unit.
    const both = frames((t) => {
      const input = speech(t)
      return t < 2.2 ? input : { ...input, held: { emotion: 'think', strength: 1, level: 1, side: side === 'right' ? 1 : -1 } }
    }, 9)
    const form = frames(held('think', 1, 2.2, idleInput), 9)
    expect(armJerk(both, side)).toBeLessThanOrEqual(1.05 * Math.max(armJerk(alone, side), armJerk(form, side)))
    // The unit keeps the arm through the request, and the form holds it once the unit has retracted.
    expect(both[Math.round(2.6 / BODY_TICK)].hand).toBe(alone[Math.round(2.6 / BODY_TICK)].hand)
    expect(both.at(-1)?.activation[side]).toBe(1)
  })
})
