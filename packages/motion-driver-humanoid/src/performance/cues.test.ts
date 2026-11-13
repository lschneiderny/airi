import type { BodyCueKind, BodyPerformanceInput } from './contracts'
import type { PerformanceLayer } from './stack'

import { describe, expect, it } from 'vitest'

import { BODY_CHANNELS, channelGroup, channelIndex, DEG } from './channels'
import { createCueLayer } from './cues'
import { createBodyPerformer } from './index'
import { channelTrace, fixtureRigs, idleInput, quietInput } from './performance.test-fixtures'

const traits = fixtureRigs[0].traits
const c = channelIndex
const KINDS: readonly BodyCueKind[] = ['nod', 'shake', 'shrug', 'lean', 'glance']
// Natural's cue durations for one count (`cue-gestures.ts` `start`; Natural's glance holds 0.6 s).
const SECONDS: Readonly<Record<BodyCueKind, number>> = { nod: 0.45, shake: 0.5, shrug: 1.1, lean: 2.6, glance: 0.6 }
const AT = 0.5

function cue(kind: BodyCueKind, side = 1, count = 1, base: (t: number) => BodyPerformanceInput = quietInput) {
  return (t: number): BodyPerformanceInput => {
    const input = base(t)
    const record = { seq: 1, start: AT, end: AT + SECONDS[kind] * (kind === 'nod' || kind === 'shake' ? count : 1), kind, count, side }
    return { ...input, events: { ...input.events, cue: t < AT ? null : record } }
  }
}

function layerEffect(script: (t: number) => BodyPerformanceInput, seconds: number) {
  const base = channelTrace(createBodyPerformer({ traits, seed: 1 }), seconds, script)
  const layered = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [createCueLayer()] }), seconds, script)
  return layered.map((trace, channel) => trace.map((v, i) => v - base[channel][i]))
}

const peak = (values: readonly number[]) => values.reduce((best, v) => Math.abs(v) > Math.abs(best) ? v : best, 0)
const sum = (a: readonly number[], b: readonly number[]) => a.map((v, i) => v + b[i])
const firstMove = (values: readonly number[]) => values.find(v => Math.abs(v) > 1e-4) ?? 0
const belowNeck = BODY_CHANNELS.flatMap((name, channel) => channelGroup(name) === 'head' ? [] : [channel])

describe('cue gesture layer', () => {
  it('changes nothing while no cue plays', () => {
    const base = channelTrace(createBodyPerformer({ traits, seed: 1 }), 20, idleInput)
    const layered = channelTrace(createBodyPerformer({ traits, seed: 1, layers: [createCueLayer()] }), 20, idleInput)
    expect(layered).toEqual(base)
  })

  it('moves a channel below the neck for every cue and returns every channel to rest', () => {
    for (const kind of KINDS) {
      const d = layerEffect(cue(kind), 10)
      expect(Math.max(...belowNeck.map(channel => Math.abs(peak(d[channel])))), kind).toBeGreaterThan(0.5 * DEG)
      expect(Math.max(...d.map(trace => Math.abs(trace.at(-1) ?? 0))), kind).toBeLessThan(1e-3 * DEG)
    }
  })

  it('plays the nod on the head once, at Natural\'s 6.6 degrees, while asking the posture to drop Natural\'s head cue', () => {
    const d = layerEffect(cue('nod'), 2)
    expect(Math.max(...sum(d[c('neckPitch')], d[c('headPitch')])) / DEG).toBeGreaterThan(6.6 * 0.95)
    expect(Math.max(...sum(d[c('neckPitch')], d[c('headPitch')])) / DEG).toBeLessThan(6.6 * 1.05)
    const plans: boolean[] = []
    const recorder: PerformanceLayer = {
      id: 'recorder',
      order: 'reaction',
      mode: 'additive',
      mask: new Float64Array(BODY_CHANNELS.length),
      step: (context) => {
        plans.push(context.plan.suppressHeadCue)
        return { channels: new Float64Array(BODY_CHANNELS.length), weight: 0, sequence: 0 }
      },
      reset() {},
    }
    channelTrace(createBodyPerformer({ traits, seed: 1, layers: [createCueLayer(), recorder] }), 2, cue('nod'))
    expect(plans[Math.round((AT + 0.2) * 120)]).toBe(true)
    expect(plans[Math.round((AT + 1) * 120)]).toBe(false)
  })

  it('first moves against the main motion in a nod and a shrug, but not in a shake', () => {
    const nod = layerEffect(cue('nod'), 2)
    const head = sum(nod[c('neckPitch')], nod[c('headPitch')])
    expect(Math.sign(firstMove(head))).toBe(-Math.sign(peak(head)))
    const shrug = layerEffect(cue('shrug', 1), 2)[c('rightClavElev')]
    expect(Math.sign(firstMove(shrug))).toBe(-Math.sign(peak(shrug)))
    for (const side of [-1, 1]) {
      const shake = layerEffect(cue('shake', side), 2)[c('headYaw')]
      expect(Math.sign(firstMove(shake))).toBe(side)
    }
  })

  it('alternates a two-count shake through four half cycles', () => {
    const yaw = layerEffect(cue('shake', 1, 2), 3)[c('headYaw')].filter(v => Math.abs(v) > 0.05 * DEG)
    const changes = yaw.slice(1).filter((v, i) => Math.sign(v) !== Math.sign(yaw[i])).length
    expect(changes).toBe(3)
  })

  // Owner comparison of 2026-11-12 ("Shake size: Show me both"): the larger trunk follow, 0.62 of the head's shake
  // (E/g3/emotion-measure-review.md, Rulings 7; E/g3/e/notes.md).
  it('turns the upper torso against a shake by 0.62 of the head\'s turn', () => {
    const d = layerEffect(cue('shake', 1), 2)
    const head = sum(d[c('neckYaw')], d[c('headYaw')])
    expect(Math.abs(peak(d[c('upperYaw')]) / peak(head))).toBeCloseTo(0.62, 1)
  })

  it('lifts the two shoulders of a shrug unequally, the far one later', () => {
    const d = layerEffect(cue('shrug', -1), 3)
    const near = d[c('leftClavElev')]
    const far = d[c('rightClavElev')]
    expect(Math.max(...far) / Math.max(...near)).toBeLessThan(0.9)
    const halfway = (values: number[]) => values.findIndex(v => v > 0.5 * Math.max(...values))
    expect(halfway(far) - halfway(near)).toBeGreaterThanOrEqual(3)
  })

  it('moves the support to the lean\'s side for the cue', () => {
    for (const side of [-1, 1]) {
      const performer = createBodyPerformer({ traits, seed: 1, layers: [createCueLayer()] })
      const script = cue('lean', side)
      const targets: number[] = []
      for (let tick = 0; tick < 4 * 120; tick++)
        targets.push(performer.step(script(tick / 120)).diagnostics.shiftTarget)
      expect(targets[Math.round((AT + 1) * 120)]).toBe(side)
      expect(targets.at(-1)).toBe(0)
    }
  })

  it('turns the upper torso after the glance\'s head turn, through the 250 ms link', () => {
    const d = layerEffect(cue('glance', 1), 4)
    const head = sum(d[c('neckYaw')], d[c('headYaw')])
    const torso = d[c('upperYaw')]
    const at = (values: number[]) => values.indexOf(peak(values))
    expect(Math.sign(peak(torso))).toBe(Math.sign(peak(head)))
    expect(at(torso) - at(head)).toBeGreaterThan(0.1 * 120)
  })

  it('writes no term to an owned group, and keeps the head cue when only the body is owned', () => {
    const owned = { root: 1, lowerBody: 1, leftLegIk: 1, rightLegIk: 1, upperBody: 1, head: 0, leftArm: 1, rightArm: 1, leftFingers: 1, rightFingers: 1 }
    for (const kind of ['nod', 'shrug'] as const) {
      const d = layerEffect(t => ({ ...cue(kind)(t), owned }), 3)
      for (const channel of belowNeck)
        expect(Math.max(...d[channel].map(Math.abs)), `${kind} ${BODY_CHANNELS[channel]}`).toBe(0)
    }
    expect(Math.max(...layerEffect(t => ({ ...cue('nod')(t), owned }), 2)[c('headPitch')])).toBeGreaterThan(2 * DEG)
  })

  it('reports each cue once', () => {
    const performer = createBodyPerformer({ traits, seed: 1, layers: [createCueLayer()] })
    const seen = new Set<string>()
    for (let tick = 0; tick < 2 * 120; tick++) {
      const frame = performer.step(cue('shrug')(tick / 120))
      seen.add(`${frame.diagnostics.cue.seq}:${frame.diagnostics.cue.kind}`)
    }
    expect([...seen]).toEqual(['0:null', '1:shrug'])
  })
})
