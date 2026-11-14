import type { BodyFootStep, BodyIdleAct, BodyIdleKind, BodyPerformanceInput, BodyRigTraits } from './contracts'

import { describe, expect, it } from 'vitest'

import { armResponse } from './arms'
import { BODY_CHANNELS, BODY_TICK, channelIndex, DEG } from './channels'
import { createBodyPerformer } from './index'
import { createPerformanceLayers } from './layers'
import { chisaTraits, ellenTraits, fixtureRigs, quietInput } from './performance.test-fixtures'

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
    const arms = behaviours.filter(entry => ['stretch', 'yawn', 'clasp-hands', 'hair-touch', 'arm-swing', 'shoulder-roll'].includes(entry.act.kind))
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

  // The old path swung straight arms through a mirrored T. A straight elbow reads below about 20 degrees of flexion.
  it.each(rigs)('raises and lowers $name\'s arms through shoulder height with bent elbows, one arm after the other', (rig) => {
    const acted = run(rig.traits, playing(record('stretch', 5.2)), START + 5.2)
    const level = (side: 'left' | 'right') => acted.channels.map(frame => frame[c(`${side}Flex`)] / DEG >= 90)
    for (const side of ['left', 'right'] as const) {
      const up = level(side).indexOf(true)
      const down = level(side).lastIndexOf(true)
      expect(up, side).toBeGreaterThan(0)
      expect(acted.channels[up][c(`${side}Elbow`)] / DEG, `${side} rising`).toBeGreaterThan(45)
      expect(acted.channels[down][c(`${side}Elbow`)] / DEG, `${side} falling`).toBeGreaterThan(45)
    }
    // A mirrored pair reaches shoulder height on the same tick.
    expect(Math.abs(level('left').indexOf(true) - level('right').indexOf(true)) * BODY_TICK).toBeGreaterThan(0.1)
  })

  /** Plays `acts` one after another from `START`, 2.5 s apart; returns each foot step with the support of the tick before it. */
  function replants(traits: BodyRigTraits, acts: readonly BodyIdleAct[], releaseAfterLift?: number) {
    const performer = createBodyPerformer({ traits, seed: 5, layers: createPerformanceLayers({ traits, seed: 5 }) })
    const steps: { step: BodyFootStep, support: number }[] = []
    const supports: { at: number, support: number }[] = []
    let support = 0
    for (let tick = 0; tick < (START + 2.5 * acts.length) / BODY_TICK; tick++) {
      const t = tick * BODY_TICK
      const index = Math.floor((t - START) / 2.5)
      const lifted = steps.at(-1)?.step.startTime
      const input = quietInput(t)
      const act = t >= START ? acts[index] : undefined
      const released = act && releaseAfterLift !== undefined && lifted !== undefined && t >= lifted + releaseAfterLift
      const frame = performer.step(act ? { ...input, idle: released ? { ...act, release: 0.4 } : act } : input)
      for (const step of frame.footSteps)
        steps.push({ step: { ...step }, support })
      support = frame.support
      supports.push({ at: t, support })
    }
    return { steps, supports }
  }

  it.each(rigs)('re-plants the foot she takes her weight off on $name\'s body: one 0.4 s step lifting 0.02 L, 4 to 8 degrees, landed by the end (4e act 3)', (rig) => {
    const { steps } = replants(rig.traits, [record('shift-stance', 1.5, { side: 1 })])
    expect(steps).toHaveLength(1)
    const [{ step, support }] = steps
    // Positive support: the right foot carries, so the left steps once its load is down to 5 %.
    expect(step.foot).toBe('left')
    expect(support).toBeGreaterThanOrEqual(0.9)
    expect(step.duration).toBe(0.4)
    expect(step.lift).toBeCloseTo(0.02 * rig.traits.legLength, 9)
    expect(Math.abs(step.yaw) / DEG).toBeGreaterThanOrEqual(4)
    expect(Math.abs(step.yaw) / DEG).toBeLessThanOrEqual(8)
    expect(step.startTime + step.duration).toBeLessThanOrEqual(START + 1.5 + 2 * BODY_TICK)
  })

  it('turns each re-planted foot back toward where it stood, so its steps never add up past 12 degrees', () => {
    const acts = Array.from({ length: 8 }, (_, k) => record('shift-stance', 1.6, { seq: k + 1, side: 1 }))
    const { steps } = replants(chisaTraits, acts)
    expect(steps).toHaveLength(8)
    let last = 0
    for (const { step } of steps) {
      const turn = step.yaw - last
      expect(Math.abs(turn) / DEG).toBeGreaterThanOrEqual(4 - 1e-9)
      expect(Math.abs(turn) / DEG).toBeLessThanOrEqual(8 + 1e-9)
      expect(turn * last).toBeLessThanOrEqual(0)
      expect(Math.abs(step.yaw) / DEG).toBeLessThanOrEqual(12)
      last = step.yaw
    }
  })

  it('keeps her weight on the stance foot until a step let go in the air has landed', () => {
    const { steps, supports } = replants(chisaTraits, [record('shift-stance', 1.5, { side: 1 })], 0.1)
    expect(steps).toHaveLength(1)
    const { startTime, duration } = steps[0].step
    const airborne = supports.filter(entry => entry.at > startTime + 0.1 && entry.at < startTime + duration)
    expect(airborne.length).toBeGreaterThan(0)
    expect(Math.min(...airborne.map(entry => entry.support))).toBeGreaterThanOrEqual(0.85)
  })

  it.each(['sigh', 'yawn'] as const)('takes one deep breath in a %s (4c\'s sigh inhale)', (kind) => {
    const performer = createBodyPerformer({ traits: chisaTraits, seed: 5, layers: createPerformanceLayers({ traits: chisaTraits, seed: 5 }) })
    const still = createBodyPerformer({ traits: chisaTraits, seed: 5, layers: createPerformanceLayers({ traits: chisaTraits, seed: 5 }) })
    const script = playing(record(kind, kind === 'sigh' ? 3.4 : 5.4))
    let acted = 0
    let quiet = 0
    for (let tick = 0; tick < (START + 6) / BODY_TICK; tick++) {
      acted = performer.step(script(tick * BODY_TICK)).diagnostics.inhales
      quiet = still.step(quietInput(tick * BODY_TICK)).diagnostics.inhales
    }
    expect(acted - quiet).toBe(1)
  })

  it('swings her arms at their own pendulum period, the relaxed upper-arm follower\'s (3f)', () => {
    const entry = record('arm-swing', 3, { count: 2 })
    const still = run(chisaTraits, quietInput, START + 4)
    const acted = run(chisaTraits, playing(entry), START + 4)
    const swing = acted.channels.map((frame, tick) => (frame[c('leftFlex')] - still.channels[tick][c('leftFlex')]) / DEG)
    const peaks = swing.flatMap((value, tick) => tick > 0 && tick < swing.length - 1 && value > 2 && value >= swing[tick - 1] && value > swing[tick + 1] ? [tick * BODY_TICK] : [])
    const period = 1 / armResponse(2, 0, quietInput(0).mood.tension)[0]
    expect(peaks.length).toBeGreaterThanOrEqual(2)
    expect(Math.abs(peaks[1] - peaks[0] - period)).toBeLessThan(0.15)
  })

  it('clasps both hands, rocks her pelvis two to four times with the feet following onto their balls, and lets the far hand go first (4e act 6)', () => {
    const traits = fixtureRigs[0].traits
    const D = 6
    const performer = createBodyPerformer({ traits, seed: 5, layers: createPerformanceLayers({ traits, seed: 5 }) })
    const still = createBodyPerformer({ traits, seed: 5, layers: createPerformanceLayers({ traits, seed: 5 }) })
    const script = playing(record('clasp-hands', D, { side: 1 }))
    const both: number[] = []
    const free = { left: Infinity, right: Infinity }
    const rock: number[] = []
    const pitch: number[] = []
    let last = { acted: new Float32Array(0), still: new Float32Array(0) }
    for (let tick = 1; tick < (START + D + 2) / BODY_TICK; tick++) {
      const t = tick * BODY_TICK
      const frame = performer.step(script(t))
      const base = still.step(quietInput(t))
      const { activation } = frame.diagnostics.gesture
      if (t > START + 1 && t < START + D - 1.5)
        both.push(Math.min(activation.left, activation.right))
      for (const side of ['left', 'right'] as const) {
        if (t > START + 1 && activation[side] === 0)
          free[side] = Math.min(free[side], t)
      }
      rock.push(frame.channels[c('pelvisZ')] - base.channels[c('pelvisZ')])
      pitch.push(frame.channels[c('leftFootPitch')] - base.channels[c('leftFootPitch')])
      last = { acted: frame.channels.slice(), still: base.channels.slice() }
    }
    expect(Math.min(...both)).toBe(1)
    // Natural's side 1 is her right: the left hand lets go first.
    expect(free.left).toBeLessThan(free.right)
    expect(free.right).toBeLessThanOrEqual(START + D)
    const peaks = rock.filter((value, i) => i > 0 && i < rock.length - 1 && Math.abs(value) > 0.006 && Math.abs(value) >= Math.abs(rock[i - 1]) && Math.abs(value) > Math.abs(rock[i + 1]))
    expect(peaks.length).toBeGreaterThanOrEqual(2)
    expect(peaks.length).toBeLessThanOrEqual(4)
    expect(Math.max(...rock.map(Math.abs))).toBeLessThanOrEqual(0.012 + 1e-6)
    expect(Math.max(...rock.map(Math.abs))).toBeGreaterThan(0.01)
    // The heels lift as the pelvis goes forward over the feet, and only then.
    expect(Math.min(...pitch)).toBeLessThan(-0.5 * DEG)
    expect(pitch.every((value, i) => rock[i] > 0 || value > -1e-6)).toBe(true)
    expect(Math.max(...BODY_CHANNELS.map((_, channel) => channel < 3 ? 0 : Math.abs(last.acted[channel] - last.still[channel]) / DEG))).toBeLessThan(0.5)
  })

  it.each(rigs)('raises $name onto the balls of both feet two or three times: toes down 14 degrees, pelvis up 0.012 L, shoulders up 2 at each top (4e act 11)', (rig) => {
    const still = run(rig.traits, quietInput, START + 3)
    const acted = run(rig.traits, playing(record('heel-rock', 2.2, { count: 2 })), START + 3)
    const diff = (channel: number) => acted.channels.map((frame, tick) => frame[channel] - still.channels[tick][channel])
    for (const side of ['left', 'right'] as const) {
      const feet = diff(c(`${side}FootPitch`))
      const tops = feet.filter((value, i) => i > 0 && i < feet.length - 1 && value < -7 * DEG && value <= feet[i - 1] && value < feet[i + 1])
      expect(tops.length, side).toBe(2)
      expect(Math.min(...feet) / DEG, side).toBeCloseTo(-14, 1)
    }
    expect(Math.max(...diff(c('pelvisY')))).toBeCloseTo(0.012, 4)
  })

  it('flicks each hand open at its arm\'s forward peaks of an arm swing (4e act 7)', () => {
    const entry = record('arm-swing', 3, { count: 2 })
    const still = run(chisaTraits, quietInput, START + 4)
    const acted = run(chisaTraits, playing(entry), START + 4)
    for (const side of ['left', 'right'] as const) {
      // Flexion is forward on both sides: each arm's forward peak is its own flexion peak.
      const swing = acted.channels.map((frame, tick) => (frame[c(`${side}Flex`)] - still.channels[tick][c(`${side}Flex`)]) / DEG)
      // Opening uncurls the fingers: the index's middle joint curls less than at rest.
      const open = acted.channels.map((frame, tick) => (still.channels[tick][c(`${side}Index1`)] - frame[c(`${side}Index1`)]) / DEG)
      const forward = swing.flatMap((value, tick) => tick > 0 && tick < swing.length - 1 && value > 2 && value >= swing[tick - 1] && value > swing[tick + 1] ? [tick] : [])
      const flicks = open.flatMap((value, tick) => tick > 0 && tick < open.length - 1 && value > 2 && value >= open[tick - 1] && value > open[tick + 1] ? [tick] : [])
      expect(forward.length, side).toBeGreaterThanOrEqual(2)
      expect(flicks.length, side).toBe(forward.length)
      // Each flick peaks within 0.15 s of its forward peak (the finger followers' lag included).
      flicks.forEach((tick, k) => expect(Math.abs(tick - forward[k]) * BODY_TICK, `${side} ${k}`).toBeLessThan(0.15))
    }
  })

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
