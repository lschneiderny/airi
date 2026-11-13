import type { BodyIdleAct, BodyIdleKind, BodyPerformanceInput, BodyRigTraits } from './contracts'

import { describe, expect, it } from 'vitest'

import { BODY_CHANNELS, BODY_TICK, channelIndex, DEG } from './channels'
import { createBodyPerformer } from './index'
import { createPerformanceLayers } from './layers'
import { chisaTraits, ellenTraits, quietInput } from './performance.test-fixtures'

const c = channelIndex
const START = 1
const rigs = [{ name: 'chisa', traits: chisaTraits }, { name: 'ellen', traits: ellenTraits }] as const

function record(kind: BodyIdleKind, duration: number, extra: Partial<BodyIdleAct> = {}): BodyIdleAct {
  return { seq: 1, kind, duration, release: null, side: 1, period: 2, count: 2, variant: 0, keys: [], glances: [], ...extra }
}

/** The behaviours as Natural starts them, each with the timing and parameters its layer draws. */
const behaviours: readonly { readonly act: BodyIdleAct, readonly releaseAt?: number }[] = [
  { act: record('stretch', 5.2) },
  { act: record('yawn', 5.4) },
  { act: record('look-around', 5.2, { glances: [{ at: 0, x: 0.7, y: 0, hold: 1.8 }, { at: 1.9, x: -0.5, y: 0.22, hold: 1.8 }] }) },
  { act: record('check-in', 3.2) },
  { act: record('peer', 7) },
  { act: record('zone-out', 10) },
  { act: record('nod-off', 8.9, { keys: [{ t: 0, x: 3, y: 0 }, { t: 4.6, x: 2.4, y: 0 }] }) },
  { act: record('sway', 10, { period: 2 }) },
  { act: record('about-to-speak', Infinity), releaseAt: START + 4 },
  { act: record('let-go', 2.6) },
  { act: record('sleep', Infinity), releaseAt: START + 30 },
  { act: record('sigh', 3.4) },
  { act: record('shoulder-roll', 4.5, { count: 2 }) },
  { act: record('shift-stance', 1.5) },
  { act: record('clasp-hands', 6, { variant: 0 }) },
  { act: record('clasp-hands', 6, { variant: 1 }) },
  { act: record('hair-touch', 2.6) },
  { act: record('heel-rock', 2.2, { count: 2 }) },
  { act: record('arm-swing', 3, { count: 2 }) },
]

/** One behaviour from `START`; a behaviour let go early carries Natural's release from `releaseAt`. */
function playing(act: BodyIdleAct, releaseAt?: number) {
  return (t: number): BodyPerformanceInput => {
    const input = quietInput(t)
    if (t < START)
      return input
    const release = act.kind === 'sleep' ? 1.6 : 0.4
    return { ...input, idle: releaseAt !== undefined && t >= releaseAt ? { ...act, release } : act }
  }
}

function run(traits: BodyRigTraits, script: (t: number) => BodyPerformanceInput, seconds: number) {
  const performer = createBodyPerformer({ traits, seed: 5, layers: createPerformanceLayers({ traits, seed: 5 }) })
  const channels: Float32Array[] = []
  const shifts: number[] = []
  let penetration = 0
  let frame = performer.step(script(0))
  for (let tick = 1; tick < seconds / BODY_TICK; tick++) {
    frame = performer.step(script(tick * BODY_TICK))
    channels.push(frame.channels.slice())
    shifts.push(frame.diagnostics.gazeShifts)
    penetration = Math.max(penetration, frame.diagnostics.penetration.left, frame.diagnostics.penetration.right)
  }
  return { channels, shifts, penetration, collisions: frame.diagnostics.collisions.count, corrector: frame.diagnostics.corrector }
}

/** Seconds a behaviour lasts in the script, with its release. */
function span(entry: typeof behaviours[number]) {
  return entry.releaseAt === undefined ? entry.act.duration : entry.releaseAt - START + (entry.act.kind === 'sleep' ? 1.6 : 0.4)
}

describe('the act layer', () => {
  // Nineteen behaviours, each beside a still run, take about 12 s per rig.
  it.each(rigs)('plays every behaviour on $name\'s body, from rest and back to it, without a step, and clear of the body', (rig) => {
    const seconds = (entry: typeof behaviours[number]) => START + span(entry) + 4
    for (const entry of behaviours) {
      const label = `${rig.name} ${entry.act.kind}`
      const still = run(rig.traits, quietInput, seconds(entry))
      const acted = run(rig.traits, playing(entry.act, entry.releaseAt), seconds(entry))
      const diff = (tick: number, channel: number) => (acted.channels[tick][channel] - still.channels[tick][channel]) / DEG
      const onset = Math.round(START / BODY_TICK)
      let peak = 0
      let pelvis = 0
      let second = 0
      for (let tick = 2; tick < acted.channels.length; tick++) {
        for (let channel = 0; channel < BODY_CHANNELS.length; channel++) {
          // Pelvis channels are leg lengths; every other channel is an angle.
          if (channel < 3) {
            pelvis = Math.max(pelvis, Math.abs(acted.channels[tick][channel] - still.channels[tick][channel]))
            continue
          }
          peak = Math.max(peak, Math.abs(diff(tick, channel)))
          second = Math.max(second, Math.abs(diff(tick, channel) - 2 * diff(tick - 1, channel) + diff(tick - 2, channel)))
        }
      }
      // Visible: some joint moves at least 1.5 degrees, or the pelvis 0.01 L (a heel raise lifts it 0.012 L).
      expect(peak > 1.5 || pelvis > 0.01, label).toBe(true)
      // Eased: nothing has moved on the first tick, and no joint changes its speed by more than 0.25 deg per tick
      // within one tick (a step of 1 degree would read 1).
      expect(Math.max(...BODY_CHANNELS.map((_, channel) => channel < 3 ? 0 : Math.abs(diff(onset, channel)))), label).toBeLessThan(0.05)
      expect(second, label).toBeLessThan(0.25)
      // Back at rest 3 s after it ends.
      const last = acted.channels.length - 1
      expect(Math.max(...BODY_CHANNELS.map((_, channel) => channel < 3 ? 0 : Math.abs(diff(last, channel)))), label).toBeLessThan(0.5)
      // Clear of the body to a hundred-thousandth of a unit (the corrector's numerical floor).
      expect(acted.penetration, label).toBeLessThan(1e-5)
      expect(acted.collisions, label).toBe(0)
      expect(acted.corrector, label).toEqual({ capHits: 0, guardScans: 0 })
    }
  }, 30_000)

  // 4e: an act's exit can start from any tick. Each arm behaviour is let go every 0.2 s, and every 0.05 s where a yawn
  // and a hair touch used to finish their reach and spring back.
  it.each(rigs)('lets every arm behaviour go from wherever it is on $name\'s body, eased, at any tick', (rig) => {
    const arms = behaviours.filter(entry => ['yawn', 'clasp-hands', 'hair-touch', 'arm-swing', 'shoulder-roll'].includes(entry.act.kind))
    for (const entry of arms) {
      const instants = Array.from({ length: Math.floor(entry.act.duration / 0.2) }, (_, k) => 0.1 + 0.2 * k)
      if (entry.act.kind === 'yawn')
        instants.push(0.95, 1, 1.05, 1.1, 1.15, 1.2)
      if (entry.act.kind === 'hair-touch')
        instants.push(0.5, 0.55, 0.6, 0.65, 0.7, 0.75)
      const seconds = START + entry.act.duration + 3
      const still = run(rig.traits, quietInput, seconds)
      for (const at of instants.filter(at => at < entry.act.duration)) {
        const label = `${rig.name} ${entry.act.kind} ${entry.act.variant} let go ${at.toFixed(2)} s in`
        const acted = run(rig.traits, playing(entry.act, START + at), Math.min(seconds, START + at + 3))
        const diff = (tick: number, channel: number) => (acted.channels[tick][channel] - still.channels[tick][channel]) / DEG
        let second = 0
        for (let tick = 2; tick < acted.channels.length; tick++) {
          for (let channel = 3; channel < BODY_CHANNELS.length; channel++)
            second = Math.max(second, Math.abs(diff(tick, channel) - 2 * diff(tick - 1, channel) + diff(tick - 2, channel)))
        }
        expect(second, label).toBeLessThan(0.25)
        expect(acted.penetration, label).toBeLessThan(1e-5)
        expect(acted.collisions, label).toBe(0)
      }
    }
  }, 120_000)

  it('turns her head and trunk to architecture 4e\'s 35 degrees for a look-around\'s widest glance', () => {
    const entry = behaviours.find(b => b.act.kind === 'look-around')!
    const acted = run(chisaTraits, playing(entry.act), START + 2)
    const turn = Math.max(...acted.channels.map(frame => (frame[c('neckYaw')] + frame[c('headYaw')] + frame[c('lowerYaw')] + frame[c('midYaw')] + frame[c('upperYaw')]) / DEG))
    expect(turn).toBeGreaterThan(20)
  })

  it('brings her hand to her mouth while she yawns', () => {
    const performer = createBodyPerformer({ traits: chisaTraits, seed: 5, layers: createPerformanceLayers({ traits: chisaTraits, seed: 5 }) })
    const script = playing(record('yawn', 5.4))
    let held = 0
    for (let tick = 0; tick < (START + 3) / BODY_TICK; tick++)
      held = Math.max(held, performer.step(script(tick * BODY_TICK)).diagnostics.gesture.activation.right)
    expect(held).toBe(1)
  })

  it('holds her gaze still while she sleeps, whatever Natural\'s free gaze does', () => {
    const wandering = (t: number): BodyPerformanceInput => {
      const input = playing(record('sleep', Infinity))(t)
      const shift = Math.floor(t / 3)
      return { ...input, gaze: { ...input.gaze, kind: 'free', yaw: (shift % 2 ? 8 : -8) * DEG, saccadeSeq: shift } }
    }
    const asleep = run(chisaTraits, wandering, 40)
    const from = Math.round((START + 0.5) / BODY_TICK)
    expect(asleep.shifts.at(-1)).toBe(asleep.shifts[from])
    const awake = run(chisaTraits, (t: number) => ({ ...wandering(t), idle: null }), 40)
    expect(awake.shifts.at(-1)).toBeGreaterThan(awake.shifts[from] + 5)
  })
})
