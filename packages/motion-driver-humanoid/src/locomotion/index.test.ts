import type { Foot, FootAnchor } from '../foot-contact'
import type { Vec3 } from '../types'
import type { GaitTraits, GaitVariability, LocomotionFrame, LocomotionInput } from './index'

import { describe, expect, it } from 'vitest'

import { createLocomotion } from './index'

// L = 10 fixture from design notes B.2: the bind hip sits 10 units above each ankle.
const legLength = 10
const traits: GaitTraits = {
  legLength,
  footBaselineY: 1,
  hipToAnkleY: 10,
  bindAnkles: {
    left: { x: 1, y: 1, z: 0 },
    right: { x: -1, y: 1, z: 0 },
  },
}
const dt = 1 / 120
// l_ref = 0.5 L and f_ref = 1.8 Hz.
const referenceSpeed = 0.5 * legLength * 1.8
const maxAcceleration = referenceSpeed
const rad = Math.PI / 180
const sides = ['left', 'right'] as const
const pelvisChannels = ['pelvisLateral', 'pelvisDrop', 'pelvisForeAft'] as const
const angleChannels = ['lowerBodyRoll', 'lowerBodyYaw', 'upperBodyRoll', 'chestCounterRoll', 'spinePitch', 'chestPitch', 'chestCounterYaw'] as const

interface Pose {
  x: number
  yaw: number
}

type Drive = (now: number) => Partial<LocomotionInput>

function bindFeet(pose: Pose): Record<Foot, FootAnchor> {
  const place = (bind: Vec3): FootAnchor => ({
    position: {
      x: pose.x + Math.cos(pose.yaw) * bind.x + Math.sin(pose.yaw) * bind.z,
      y: traits.footBaselineY,
      z: -Math.sin(pose.yaw) * bind.x + Math.cos(pose.yaw) * bind.z,
    },
    yaw: pose.yaw,
  })
  return { left: place(traits.bindAnkles.left), right: place(traits.bindAnkles.right) }
}

// The structural tests below pin a periodic walk (equal steps, mirrored sides), so they turn the stride variability off;
// `{}` keeps the product's default.
const periodic: { variability?: GaitVariability } = { variability: { strideTime: 0, strideLength: 0, armLag: 0 } }

// Closed loop: each frame's foot targets come back as the next frame's planted anchors.
function createRun(start: Pose, seed = 7, gaitTraits: GaitTraits = traits, options = periodic) {
  const locomotion = createLocomotion({ traits: gaitTraits, seed, ...options })
  locomotion.rebase(start)
  const frames: LocomotionFrame[] = []
  let planted = bindFeet(start)
  let tick = 0
  return {
    locomotion,
    frames,
    advance(seconds: number, drive: Drive) {
      for (const end = tick + Math.round(seconds * 120); tick < end; tick++) {
        const now = tick * dt
        const frame = locomotion.step({
          now,
          goalX: null,
          pace: 'walk',
          arriveFacing: start.yaw,
          enabled: true,
          idleSupport: 0,
          plantedFeet: planted,
          ...drive(now),
        }, dt)
        planted = { left: frame.feet.left.target, right: frame.feet.right.target }
        frames.push(frame)
      }
    },
  }
}

const scenarioDefinitions = {
  // A 10 s walk at v_ref toward a far goal, already facing the heading.
  cruise: { start: { x: 0, yaw: Math.PI / 2 }, seconds: 10, drive: () => ({ goalX: 500, arriveFacing: Math.PI / 2 }) },
  arrive: { start: { x: 0, yaw: Math.PI / 2 }, seconds: 8, drive: () => ({ goalX: 30, arriveFacing: Math.PI / 2 }) },
  // Turn toward the goal, walk, stop, then turn back to face the camera.
  journey: { start: { x: 0, yaw: 0 }, seconds: 12, drive: () => ({ goalX: -25, arriveFacing: 0 }) },
  // Walk, slow to a stroll, then reverse: brake, turn around and walk back.
  paces: {
    start: { x: 0, yaw: Math.PI / 2 },
    seconds: 22,
    drive: (now: number): Partial<LocomotionInput> => {
      if (now < 3)
        return { goalX: 200, pace: 'walk', arriveFacing: Math.PI / 2 }
      if (now < 5)
        return { goalX: 200, pace: 'stroll', arriveFacing: Math.PI / 2 }
      return { goalX: -40, pace: 'walk', arriveFacing: -Math.PI / 2 }
    },
  },
} satisfies Record<string, { start: Pose, seconds: number, drive: Drive }>

type ScenarioName = keyof typeof scenarioDefinitions

function simulate(name: ScenarioName, seed = 7) {
  const definition = scenarioDefinitions[name]
  const run = createRun(definition.start, seed)
  run.advance(definition.seconds, definition.drive)
  return run
}

const scenarioCache = new Map<ScenarioName, ReturnType<typeof simulate>>()

function scenario(name: ScenarioName) {
  const cached = scenarioCache.get(name)
  if (cached)
    return cached
  const run = simulate(name)
  scenarioCache.set(name, run)
  return run
}

const allScenarios = Object.keys(scenarioDefinitions) as ScenarioName[]

function hip(frame: LocomotionFrame, foot: Foot): Vec3 {
  const { position, yaw } = frame.root
  const bind = traits.bindAnkles[foot]
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  // pelvisLateral moves toward the character's right, (-cos, 0, sin) in world axes.
  return {
    x: position.x + cos * bind.x + sin * bind.z - cos * frame.body.pelvisLateral,
    y: bind.y + traits.hipToAnkleY - frame.body.pelvisDrop,
    z: position.z - sin * bind.x + cos * bind.z + sin * frame.body.pelvisLateral,
  }
}

function distance(a: Vec3, b: Vec3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
}

function foreAft(frame: LocomotionFrame, point: Vec3) {
  const { position, yaw } = frame.root
  return (point.x - position.x) * Math.sin(yaw) + (point.z - position.z) * Math.cos(yaw)
}

function wrap(value: number) {
  return Math.atan2(Math.sin(value), Math.cos(value))
}

function eventsOf(frames: readonly LocomotionFrame[], kind: 'liftOff' | 'heelStrike') {
  return frames.flatMap((frame, tick) => frame.events.filter(event => event.kind === kind).map(event => ({ ...event, tick, frame })))
}

function maxReach(frames: readonly LocomotionFrame[]) {
  let max = 0
  for (const frame of frames) {
    for (const side of sides) {
      if (frame.feet[side].planted)
        max = Math.max(max, distance(hip(frame, side), frame.feet[side].target.position))
    }
  }
  return max
}

function slidePerStep(frames: readonly LocomotionFrame[]) {
  const steps: number[] = []
  for (const side of sides) {
    let current = -1
    for (let tick = 1; tick < frames.length; tick++) {
      const previous = frames[tick - 1]?.feet[side]
      const foot = frames[tick]?.feet[side]
      if (!previous || !foot)
        continue
      if (previous.planted && !foot.planted) {
        current = steps.length
        steps.push(0)
      }
      if (current >= 0 && foot.target.position.y - traits.footBaselineY < 0.01 * legLength) {
        steps[current] = (steps[current] ?? 0) + Math.hypot(
          foot.target.position.x - previous.target.position.x,
          foot.target.position.z - previous.target.position.z,
        )
      }
    }
  }
  return steps
}

describe('procedural gait', () => {
  it('planted slip: a planted foot target never moves while it stays planted', () => {
    for (const name of allScenarios) {
      const { frames } = scenario(name)
      for (const side of sides) {
        let first: Vec3 | null = null
        let maxSlip = 0
        for (const frame of frames) {
          const foot = frame.feet[side]
          if (!foot.planted) {
            first = null
            continue
          }
          const origin: Vec3 = first ?? foot.target.position
          first = origin
          maxSlip = Math.max(maxSlip, distance(foot.target.position, origin))
        }
        expect(maxSlip, `${name} ${side}`).toBeLessThanOrEqual(1e-9)
      }
    }
  })

  it('ground slide: a foot near the ground moves at most 0.002 L horizontally per step', () => {
    let max = 0
    let steps = 0
    for (const name of ['cruise', 'arrive'] as const) {
      const slides = slidePerStep(scenario(name).frames)
      steps += slides.length
      max = Math.max(max, ...slides)
    }
    console.info(`locomotion ground slide: max ${(max / legLength).toFixed(6)} L per step over ${steps} steps`)
    expect(steps).toBeGreaterThan(20)
    expect(max).toBeLessThanOrEqual(0.002 * legLength)
  })

  it('reach: every planted ankle stays within 0.985 L of its hip without leash clamps', () => {
    let max = 0
    for (const name of allScenarios) {
      const run = scenario(name)
      const reach = maxReach(run.frames)
      max = Math.max(max, reach)
      expect(run.locomotion.leashClamps, `${name} leash clamps`).toBe(0)
      expect(reach, name).toBeLessThanOrEqual(0.985 * legLength + 1e-9)
    }
    console.info(`locomotion reach: max hip-to-ankle ${(max / legLength).toFixed(6)} L`)
  })

  it('stride variability: over Beauchet\'s 11-stride window stride time and length vary by 1.8 % and 3.9 %, persist from stride to stride, and vary independently', () => {
    // Beauchet et al. 2005: CVs 1.8 % and 3.9 %, each over about 11 strides; Hausdorff and Terrier: long-range correlated.
    // A 20 minute walk cut into 11-stride windows. The 120 Hz strike grid adds about 0.3 % to the time CV; bounds allow
    // 15 % of the source.
    const run = createRun({ x: 0, yaw: Math.PI / 2 }, 7, traits, {})
    run.advance(1200, () => ({ goalX: 100000, arriveFacing: Math.PI / 2 }))
    const strikes = eventsOf(run.frames, 'heelStrike').filter(strike => strike.foot === 'left' && strike.tick * dt >= 5)
    const times = strikes.slice(1).map((strike, index) => (strike.tick - (strikes[index]?.tick ?? 0)) * dt)
    const lengths = strikes.slice(1).map((strike, index) => {
      const before = strikes[index]?.frame.feet.left.target.position ?? strike.frame.feet.left.target.position
      const landed = strike.frame.feet.left.target.position
      return Math.hypot(landed.x - before.x, landed.z - before.z)
    })
    expect(times.length).toBeGreaterThan(1000)
    const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    const correlation = (a: readonly number[], b: readonly number[]) => {
      const [ma, mb] = [mean(a), mean(b)]
      const cov = mean(a.map((value, index) => (value - ma) * ((b[index] ?? mb) - mb)))
      return cov / Math.sqrt(mean(a.map(value => (value - ma) ** 2)) * mean(b.map(value => (value - mb) ** 2)))
    }
    const cv = (values: readonly number[]) => Math.sqrt(mean(values.map(value => (value - mean(values)) ** 2))) / mean(values)
    // A window's CV with the sample SD (n - 1), averaged over the windows as the study averages its subjects.
    const windowCv = (values: readonly number[]) => {
      const windows = Array.from({ length: Math.floor(values.length / 11) }, (_, index) => values.slice(11 * index, 11 * index + 11))
      return mean(windows.map((window) => {
        const m = mean(window)
        return Math.sqrt(window.reduce((sum, value) => sum + (value - m) ** 2, 0) / (window.length - 1)) / m
      }))
    }
    console.info(`locomotion stride variability: 11-stride CV time ${(100 * windowCv(times)).toFixed(2)} %, length ${(100 * windowCv(lengths)).toFixed(2)} %; whole walk ${(100 * cv(times)).toFixed(2)} % / ${(100 * cv(lengths)).toFixed(2)} %, lag-1 r ${correlation(times.slice(1), times.slice(0, -1)).toFixed(2)} / ${correlation(lengths.slice(1), lengths.slice(0, -1)).toFixed(2)}, time-length r ${correlation(times, lengths).toFixed(2)}`)
    expect(windowCv(times)).toBeGreaterThan(0.85 * 0.018)
    expect(windowCv(times)).toBeLessThan(1.15 * 0.018)
    expect(windowCv(lengths)).toBeGreaterThan(0.85 * 0.039)
    expect(windowCv(lengths)).toBeLessThan(1.15 * 0.039)
    // White noise has a lag-1 correlation near 0; a persistent (long-range correlated) series stays well above it.
    expect(correlation(times.slice(1), times.slice(0, -1))).toBeGreaterThan(0.3)
    expect(correlation(lengths.slice(1), lengths.slice(0, -1))).toBeGreaterThan(0.3)
    expect(Math.abs(correlation(times, lengths))).toBeLessThan(0.3)
  })

  it('step period: steady heel strikes at v_ref are 66 or 67 ticks apart', () => {
    const strikes = eventsOf(scenario('cruise').frames, 'heelStrike').filter(strike => strike.frame.speed === referenceSpeed)
    const gaps = strikes.slice(1).map((strike, index) => strike.tick - (strikes[index]?.tick ?? 0))
    console.info(`locomotion step period at v_ref: ${[...new Set(gaps)].sort().join(' or ')} ticks over ${gaps.length} steps`)
    expect(gaps.length).toBeGreaterThan(8)
    for (const gap of gaps) {
      expect([66, 67]).toContain(gap)
      expect(Math.abs(gap - 120 / 1.8)).toBeLessThanOrEqual(1)
    }
  })

  it('symmetry: steady left and right steps, stances, support and arms mirror each other', () => {
    const { frames } = scenario('cruise')
    const steady = (tick: number) => tick * dt >= 3
    const strikes = eventsOf(frames, 'heelStrike').filter(strike => steady(strike.tick))
    const lengths = { left: [] as number[], right: [] as number[] }
    for (let index = 1; index < strikes.length; index++) {
      const strike = strikes[index]
      const previous = strikes[index - 1]
      if (!strike || !previous)
        continue
      const landed = strike.frame.feet[strike.foot].target.position
      const before = previous.frame.feet[previous.foot].target.position
      lengths[strike.foot].push(Math.hypot(landed.x - before.x, landed.z - before.z))
    }
    const all = [...lengths.left, ...lengths.right]
    expect(lengths.left.length).toBeGreaterThan(4)
    expect(lengths.right.length).toBeGreaterThan(4)
    expect(Math.max(...all) - Math.min(...all)).toBeLessThanOrEqual(1e-6 * legLength)

    const lifts = eventsOf(frames, 'liftOff')
    const stances: number[] = []
    for (const strike of strikes) {
      const lift = lifts.find(event => event.foot === strike.foot && event.tick > strike.tick)
      if (lift)
        stances.push(lift.tick - strike.tick)
    }
    expect(Math.max(...stances) - Math.min(...stances)).toBeLessThanOrEqual(1)

    // Two strides, starting at a support zero crossing (phase = n + 0.1).
    const start = Math.ceil(frames.find((_, tick) => steady(tick))?.phase ?? 0) + 0.1
    const window = frames.filter(frame => frame.phase >= start && frame.phase < start + 4)
    expect(window.length).toBeGreaterThan(200)
    expect(Math.abs(window.reduce((sum, frame) => sum + frame.support, 0) / window.length)).toBeLessThan(1e-3)

    // The arms swing in antiphase from one trunk drive; the forward swing (16) is larger than the back swing (12), so the two
    // arms' offsets from 2 degrees, the right one taken at the left's size, sum to a seventh of their difference.
    for (const name of allScenarios) {
      for (const frame of scenario(name).frames) {
        const left = frame.armSwing.left.flexion - 2 * rad
        const right = (frame.armSwing.right.flexion - 2 * rad) / (1 - 0.219)
        expect(left + right - Math.abs(left - right) / 7).toBeCloseTo(0, 12)
      }
    }
  })

  it('alternation: swing feet strictly alternate and one foot is always planted', () => {
    for (const name of ['cruise', 'arrive'] as const) {
      const lifts = eventsOf(scenario(name).frames, 'liftOff')
      expect(lifts.length).toBeGreaterThan(4)
      for (let index = 1; index < lifts.length; index++)
        expect(lifts[index]?.foot, `${name} lift ${index}`).not.toBe(lifts[index - 1]?.foot)
    }
    for (const name of allScenarios) {
      for (const frame of scenario(name).frames)
        expect(frame.feet.left.planted || frame.feet.right.planted, name).toBe(true)
    }
  })

  it('speed ramp: speed never changes faster than a_max', () => {
    for (const name of allScenarios) {
      const { frames } = scenario(name)
      let maxChange = 0
      for (let tick = 1; tick < frames.length; tick++)
        maxChange = Math.max(maxChange, Math.abs((frames[tick]?.speed ?? 0) - (frames[tick - 1]?.speed ?? 0)))
      expect(maxChange, name).toBeLessThanOrEqual(maxAcceleration * dt + 1e-9)
    }
    expect(Math.max(...scenario('paces').frames.map(frame => frame.speed))).toBe(referenceSpeed)
  })

  it('arrival: the root stops at the goal with both feet planted side by side', () => {
    for (const [name, goal, facing] of [['arrive', 30, Math.PI / 2], ['journey', -25, 0], ['paces', -40, -Math.PI / 2]] as const) {
      const last = scenario(name).frames.at(-1)
      expect(last, name).toBeDefined()
      if (!last)
        continue
      expect(last.mode, name).toBe('idle')
      expect(Math.abs(last.root.position.x - goal), name).toBeLessThanOrEqual(1e-3)
      expect(last.speed, name).toBe(0)
      expect(Math.abs(wrap(last.root.yaw - facing)), name).toBeLessThan(1e-9)
      expect(last.feet.left.planted && last.feet.right.planted, name).toBe(true)
      const gap = foreAft(last, last.feet.left.target.position) - foreAft(last, last.feet.right.target.position)
      expect(Math.abs(gap), name).toBeLessThan(0.05 * legLength)
    }
  })

  it('turn: a 90 degree turn in place takes two steps and leaves both feet aligned', () => {
    const run = createRun({ x: 0, yaw: 0 })
    run.advance(2, () => ({ goalX: 0, arriveFacing: Math.PI / 2 }))
    const { frames } = run
    const lifts = eventsOf(frames, 'liftOff')
    expect(lifts.map(event => event.foot)).toEqual(['left', 'right'])
    expect(frames.filter(frame => frame.mode === 'turning')).toHaveLength(108)
    expect(frames.every(frame => frame.root.position.x === 0 && frame.speed === 0)).toBe(true)
    let maxLift = 0
    for (let tick = 1; tick < frames.length; tick++) {
      for (const side of sides) {
        const foot = frames[tick]?.feet[side]
        const previous = frames[tick - 1]?.feet[side]
        if (!foot || !previous)
          continue
        maxLift = Math.max(maxLift, foot.target.position.y - traits.footBaselineY)
        if (foot.planted && previous.planted)
          expect(distance(foot.target.position, previous.target.position)).toBe(0)
      }
    }
    expect(maxLift).toBeGreaterThan(0)
    expect(maxLift).toBeLessThanOrEqual(0.03 * legLength + 1e-12)
    const last = frames.at(-1)
    expect(last?.mode).toBe('idle')
    if (!last)
      return
    expect(last.root.yaw).toBeCloseTo(Math.PI / 2, 12)
    const aligned = bindFeet({ x: 0, yaw: Math.PI / 2 })
    for (const side of sides) {
      expect(Math.abs(wrap(last.feet[side].target.yaw - last.root.yaw))).toBeLessThan(1e-9)
      expect(distance(last.feet[side].target.position, aligned[side].position)).toBeLessThan(1e-9)
    }
  })

  it('roll contract: without a foot trait every foot stays flat', () => {
    for (const name of allScenarios) {
      for (const frame of scenario(name).frames) {
        for (const side of sides) {
          const { roll, planted } = frame.feet[side]
          expect(roll, `${name} ${side}`).toEqual({ pitch: 0, ankleOffset: [0, 0], pivot: planted ? 'flat' : 'air' })
        }
      }
    }
  })

  it('roll: heel strike pitches up, mid-stance is flat, lift-off pitches down, and the pivot point holds still', () => {
    const foot = { ankleHeight: 1, ballForward: 1.5, heelBack: 0 }
    const run = createRun({ x: 0, yaw: Math.PI / 2 }, 7, { ...traits, foot: { left: foot, right: foot } })
    run.advance(10, () => ({ goalX: 500, arriveFacing: Math.PI / 2 }))
    const { frames } = run
    const steady = (tick: number) => tick * dt >= 3
    const strikes = eventsOf(frames, 'heelStrike').filter(event => steady(event.tick))
    const lifts = eventsOf(frames, 'liftOff').filter(event => steady(event.tick))
    expect(strikes.length).toBeGreaterThan(8)
    for (const strike of strikes)
      expect(strike.frame.feet[strike.foot].roll.pitch).toBeGreaterThan(0.95 * 14 * rad)
    for (const lift of lifts)
      expect(lift.frame.feet[lift.foot].roll.pitch).toBeLessThan(-0.95 * 32 * rad)
    let flat = 0
    for (const [tick, frame] of frames.entries()) {
      for (const side of sides) {
        const { roll, planted } = frame.feet[side]
        if (!planted || !steady(tick))
          continue
        if (roll.pivot === 'flat') {
          flat++
          expect(roll.pitch).toBe(0)
          continue
        }
        // The ankle sits at `a` from the pivot when flat, and at a rotated by the pitch now: pivot = ankle - R(pitch) a.
        const a = roll.pivot === 'heel' ? [foot.heelBack, foot.ankleHeight] : [-foot.ballForward, foot.ankleHeight]
        const cos = Math.cos(roll.pitch)
        const sin = Math.sin(roll.pitch)
        expect(roll.ankleOffset[0] - (a[0] * cos - a[1] * sin) + a[0]).toBeCloseTo(0, 12)
        expect(roll.ankleOffset[1] - (a[0] * sin + a[1] * cos) + a[1]).toBeCloseTo(0, 12)
      }
    }
    expect(flat).toBeGreaterThan(100)
  })

  it('twist: the torso counter-rotates the pelvis up the spine, and the head counters the torso 80 ms late', () => {
    const { frames } = scenario('cruise')
    const steady = frames.filter((frame, tick) => tick * dt >= 3 && frame.mode === 'walking')
    expect(steady.length).toBeGreaterThan(600)
    const peak = Math.max(...steady.map(frame => Math.abs(frame.body.lowerBodyYaw)))
    // A full stride at v_ref: 6 degrees of pelvis yaw (architecture 5.2).
    expect(peak).toBeCloseTo(6 * rad, 3)
    const torso = (frame: LocomotionFrame) => frame.body.twist.lower + frame.body.twist.mid + frame.body.twist.upper
    // 0.08 s is 9.6 ticks: interpolate the torso between the frames 9 and 10 ticks earlier.
    const earlierTorso = (index: number) => {
      const near = steady[index - 9]
      const far = steady[index - 10]
      return near && far ? 0.4 * torso(near) + 0.6 * torso(far) : null
    }
    // The head counter is a critically damped link of 80 ms lag fed with minus the torso (architecture 3a): at the
    // stride frequency it follows minus the torso of 80 ms earlier, a little smaller (0.95 at 0.9 Hz).
    const pairs = steady.flatMap((frame, index) => {
      const earlier = earlierTorso(index)
      return earlier === null ? [] : [[frame.body.twist.head, -earlier] as const]
    })
    const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    const heads = pairs.map(([head]) => head)
    const counters = pairs.map(([, counter]) => counter)
    const [mh, mc] = [mean(heads), mean(counters)]
    const covariance = mean(pairs.map(([head, counter]) => (head - mh) * (counter - mc)))
    const spread = (values: readonly number[], m: number) => Math.sqrt(mean(values.map(value => (value - m) ** 2)))
    expect(covariance / (spread(heads, mh) * spread(counters, mc))).toBeGreaterThan(0.99)
    expect(spread(heads, mh) / spread(counters, mc)).toBeGreaterThan(0.9)
    expect(spread(heads, mh) / spread(counters, mc)).toBeLessThanOrEqual(1)
    for (const frame of steady) {
      // Each torso segment turns against the pelvis; the upper one, whose lag is 0.09 steps, still turns with it at
      // a sign change, so the products are checked on the larger part of the stride only.
      if (Math.abs(frame.body.lowerBodyYaw) > 0.5 * peak) {
        expect(frame.body.twist.upper * frame.body.lowerBodyYaw).toBeLessThan(0)
        expect(frame.body.twist.mid * frame.body.lowerBodyYaw).toBeLessThan(0)
      }
    }
  })

  it('twist chain: each torso segment and the head answer the segment below, so stopping the drive at once does not snap them', () => {
    // Architecture 3a: a lag is a critically damped link. Halting the gait near the pelvis yaw's peak stops the drive in
    // one tick; each segment keeps most of its yaw on that tick and settles, where a sample of the phase drops to zero.
    const run = createRun({ x: 0, yaw: Math.PI / 2 })
    let stopAt = Number.POSITIVE_INFINITY
    run.advance(6, (now) => {
      const last = run.frames.at(-1)
      if (stopAt === Number.POSITIVE_INFINITY && now > 4 && last && Math.abs(last.body.lowerBodyYaw) > 0.8 * 6 * rad)
        stopAt = now
      return { goalX: 500, arriveFacing: Math.PI / 2, enabled: now < stopAt }
    })
    const { frames } = run
    const halt = frames.findIndex((frame, tick) => tick > 120 && frame.mode === 'idle')
    expect(halt).toBeGreaterThan(4 * 120)
    const reads = [
      (frame: LocomotionFrame) => frame.body.twist.lower,
      (frame: LocomotionFrame) => frame.body.twist.mid,
      (frame: LocomotionFrame) => frame.body.twist.upper,
      (frame: LocomotionFrame) => frame.body.twist.head,
    ]
    for (const read of reads) {
      const before = read(frames[halt - 1] as LocomotionFrame)
      expect(Math.abs(before)).toBeGreaterThan(0.5 * rad)
      expect(Math.abs(read(frames[halt] as LocomotionFrame))).toBeGreaterThan(0.5 * Math.abs(before))
      expect(Math.abs(read(frames.at(-1) as LocomotionFrame))).toBeLessThan(1e-3 * rad)
    }
  })

  it('arm swing: the forward swing is larger, the elbow follows the shoulder 200 ms late, and the clavicle protracts', () => {
    const { frames } = scenario('cruise')
    const steady = frames.filter((frame, tick) => tick * dt >= 3 && frame.mode === 'walking')
    const flexion = steady.map(frame => frame.armSwing.left.flexion)
    // The trunk's three lag links pass the stride frequency at 0.99 of its size.
    expect(Math.max(...flexion)).toBeLessThanOrEqual(2 * rad + 16 * rad)
    expect(Math.max(...flexion)).toBeGreaterThan(2 * rad + 0.98 * 16 * rad)
    expect(Math.min(...flexion)).toBeGreaterThanOrEqual(2 * rad - 12 * rad)
    expect(Math.min(...flexion)).toBeLessThan(2 * rad - 0.98 * 12 * rad)
    // The elbow's forward bend peaks when the shoulder's forward swing peaked 0.2 s (24 ticks) earlier.
    const peaks = (values: readonly number[]) => values.flatMap((value, index) => index > 0 && index < values.length - 1 && value > (values[index - 1] ?? 0) && value >= (values[index + 1] ?? 0) ? [index] : [])
    const shoulder = peaks(flexion)
    const elbow = peaks(steady.map(frame => frame.armSwing.left.elbowFlex))
    expect(shoulder.length).toBeGreaterThan(4)
    for (const peak of shoulder) {
      const next = elbow.find(index => index >= peak)
      if (next !== undefined)
        expect(Math.abs(next - peak - 24)).toBeLessThanOrEqual(1)
    }
    for (const frame of steady) {
      const swing = frame.armSwing.left
      // Forward of 2 degrees the hand moves toward the midline and the clavicle protracts; behind it, it retracts. The
      // clavicle leads the arm by 26 ms, over which the arm moves under 3 degrees, so the signs are compared beyond that.
      if (Math.abs(swing.flexion - 2 * rad) > 3 * rad)
        expect(Math.sign(swing.clavProt)).toBe(Math.sign(swing.flexion - 2 * rad))
      expect(swing.abduct).toBeLessThanOrEqual(0)
    }
  })

  it('arm swing: the right arm swings 0.781 of the left, the mean overground asymmetry', () => {
    const { frames } = scenario('cruise')
    const steady = frames.filter((frame, tick) => tick * dt >= 3 && frame.mode === 'walking')
    const range = (side: 'left' | 'right') => {
      const flexion = steady.map(frame => frame.armSwing[side].flexion)
      return Math.max(...flexion) - Math.min(...flexion)
    }
    expect(range('right') / range('left')).toBeCloseTo(1 - 0.219, 3)
  })

  it('arm pendulums: each arm follows the shoulder girdle 25.9 ms late on its own drifting lag, so the arms leave antiphase by Mirelman\'s arm PCI', () => {
    // bands-v5 walk `chain.shoulder-upperArm.lagMs` p50 25.9 ms; Mirelman et al. 2015, ages 30 to 40: arm PCI 1.68 % over
    // one-minute walks (about 60 strides). A 20 minute walk at the product's default.
    const run = createRun({ x: 0, yaw: Math.PI / 2 }, 7, traits, {})
    run.advance(1200, () => ({ goalX: 100000, arriveFacing: Math.PI / 2 }))
    // Upward zero crossings of a forward swing, interpolated between ticks, while walking after 5 s.
    const crossings = (read: (frame: LocomotionFrame) => number) => run.frames.flatMap((frame, tick) => {
      const previous = run.frames[tick - 1]
      if (!previous || tick * dt < 5 || frame.mode !== 'walking' || previous.mode !== 'walking')
        return []
      const [a, b] = [read(previous), read(frame)]
      return a < 0 && b >= 0 ? [(tick - 1 + a / (a - b)) * dt] : []
    })
    const arm = { left: crossings(frame => frame.armSwing.left.flexion - 2 * rad), right: crossings(frame => frame.armSwing.right.flexion - 2 * rad) }
    const clavicle = crossings(frame => frame.armSwing.left.clavProt)
    const lags = arm.left.flatMap(time => clavicle.filter(clav => clav <= time).slice(-1).map(clav => time - clav))
    const mean = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length
    // phi: where the right arm's crossing falls in the left arm's cycle, degrees; 180 is exact antiphase.
    const phases = arm.left.slice(1).flatMap((time, index) => {
      const from = arm.left[index] ?? time
      return arm.right.filter(right => right >= from && right < time).slice(0, 1).map(right => 360 * (right - from) / (time - from))
    })
    const windows = Array.from({ length: Math.floor(phases.length / 60) }, (_, index) => phases.slice(60 * index, 60 * index + 60))
    const pci = mean(windows.map((window) => {
      const m = mean(window)
      const sd = Math.sqrt(window.reduce((sum, value) => sum + (value - m) ** 2, 0) / (window.length - 1))
      return 100 * sd / m + 100 * mean(window.map(value => Math.abs(value - 180))) / 180
    }))
    console.info(`locomotion arm pendulums: lag behind the girdle ${(1000 * mean(lags)).toFixed(2)} ms over ${lags.length} swings, arm PCI ${pci.toFixed(2)} % over ${windows.length} one-minute windows`)
    expect(windows.length).toBeGreaterThan(15)
    expect(Math.abs(mean(lags) - 0.0259)).toBeLessThan(0.002)
    expect(pci).toBeGreaterThan(0.75 * 1.68)
    expect(pci).toBeLessThan(1.25 * 1.68)
  })

  it('arm pendulums: a halt leaves each arm on the swing it had and lets the trunk\'s links carry it to rest', () => {
    // Stopping the drive at once near the left arm's forward peak: the arm keeps its swing on that tick and settles, where
    // a swing sampled from the leg phase drops to rest in one tick.
    const run = createRun({ x: 0, yaw: Math.PI / 2 })
    let stopAt = Number.POSITIVE_INFINITY
    run.advance(6, (now) => {
      const last = run.frames.at(-1)
      if (stopAt === Number.POSITIVE_INFINITY && now > 4 && last && last.armSwing.left.flexion - 2 * rad > 0.8 * 16 * rad)
        stopAt = now
      return { goalX: 500, arriveFacing: Math.PI / 2, enabled: now < stopAt }
    })
    const { frames } = run
    const halt = frames.findIndex((frame, tick) => tick > 120 && frame.mode === 'idle')
    expect(halt).toBeGreaterThan(4 * 120)
    const swing = (frame: LocomotionFrame | undefined) => (frame?.armSwing.left.flexion ?? 0) - 2 * rad
    expect(swing(frames[halt - 1])).toBeGreaterThan(0.8 * 16 * rad)
    expect(swing(frames[halt])).toBeGreaterThan(0.5 * swing(frames[halt - 1]))
    expect(Math.abs(swing(frames.at(-1)))).toBeLessThan(1e-3 * rad)
  })

  it('variation streams: the strides and each arm\'s lag draw from their own seeded streams, and the first-foot draw is unchanged', () => {
    const walks = (variability: GaitVariability | undefined, seed = 7) => {
      const run = createRun({ x: 0, yaw: Math.PI / 2 }, seed, traits, variability ? { variability } : {})
      // Six walks onward, each departing from a centred stance with no turn, so the seed's own stream picks the first foot.
      run.advance(60, now => ({ goalX: 60 * (1 + Math.floor(now / 10)), arriveFacing: Math.PI / 2 }))
      const strikes = eventsOf(run.frames, 'heelStrike')
      const firstFeet = run.frames.flatMap((frame, tick) => frame.mode === 'starting' && run.frames[tick - 1]?.mode !== 'starting' ? [eventsOf(run.frames.slice(tick), 'liftOff')[0]?.foot] : [])
      return { strikes: strikes.map(strike => strike.tick).join(), firstFeet: firstFeet.join(), arms: run.frames.map(frame => frame.armSwing.left.flexion.toFixed(9)).join() }
    }
    const product = walks(undefined)
    const periodicWalk = walks({ strideTime: 0, strideLength: 0, armLag: 0 })
    const stridesOnly = walks({ strideTime: 0.018, strideLength: 0.039, armLag: 0 })
    expect(product.firstFeet.split(',').length).toBeGreaterThanOrEqual(6)
    expect(product.firstFeet).toBe(periodicWalk.firstFeet)
    expect(product.strikes).not.toBe(periodicWalk.strikes)
    expect(walks(undefined, 8).strikes).not.toBe(product.strikes)
    // The arms' lag streams move no stride.
    expect(stridesOnly.strikes).toBe(product.strikes)
    expect(stridesOnly.arms).not.toBe(product.arms)
  })

  it('start and stop: the root waits 0.22 s while the weight moves, and the lean overshoots once after arrival', () => {
    const { frames } = scenario('arrive')
    // The first frame after the rebase is idle; then 0.22 s of 'starting' before the root first moves.
    const moved = frames.findIndex(frame => frame.root.position.x !== 0)
    expect((moved - 1) * dt).toBeGreaterThanOrEqual(0.22)
    expect((moved - 1) * dt).toBeLessThan(0.22 + 2 * dt)
    const preparation = frames.slice(1, moved)
    expect(preparation.every(frame => frame.mode === 'starting' && frame.speed === 0)).toBe(true)
    expect(Math.abs(preparation.at(-1)?.support ?? 0)).toBeGreaterThan(0.25)
    expect(Math.min(...preparation.map(frame => frame.body.spinePitch))).toBeLessThan(0)
    expect(eventsOf(preparation, 'liftOff')).toHaveLength(0)
    // After the speed reaches 0 the trunk swings past upright once (the deceleration leans it back) and returns.
    const stopped = frames.findIndex((frame, tick) => tick > moved && frame.speed === 0)
    const after = frames.slice(stopped).map(frame => frame.body.spinePitch)
    const crossings = after.slice(1).filter((value, index) => Math.sign(value) !== Math.sign(after[index] ?? 0) && value !== 0)
    expect(crossings.length).toBeGreaterThanOrEqual(1)
    expect(Math.abs(after.at(-1) ?? 1)).toBeLessThan(0.05 * rad)
  })

  it('look ahead: a turn eases to the facing still to come within its first step, and a walk names its heading', () => {
    const run = createRun({ x: 0, yaw: 0 })
    run.advance(3, () => ({ goalX: -25, arriveFacing: 0 }))
    const turning = run.frames.filter(frame => frame.mode === 'turning')
    expect(turning.length).toBe(108)
    // Turning from 0 to face -x (-90 degrees) in two steps of 54 ticks: the look-ahead leaves the facing she has at
    // rest, never moves faster than a minimum-jerk move over one step, and names the final facing from that step's end.
    expect(Math.abs(turning[0]?.lookAhead ?? 1)).toBeLessThan(1e-3)
    const rates = turning.slice(1).map((frame, tick) => Math.abs(frame.lookAhead - (turning[tick]?.lookAhead ?? 0)))
    expect(Math.max(...rates)).toBeLessThan(1.01 * 1.875 * (Math.PI / 2) / 54)
    for (const frame of turning.slice(53))
      expect(frame.lookAhead).toBeCloseTo(-Math.PI / 2, 12)
    expect((turning[26]?.lookAhead ?? 0) - (turning[26]?.root.yaw ?? 0)).toBeLessThan(-0.25 * Math.PI / 2)
    const walking = run.frames.filter(frame => frame.mode === 'walking')
    expect(walking.length).toBeGreaterThan(50)
    for (const frame of walking)
      expect(frame.lookAhead - frame.root.yaw).toBeCloseTo(0, 12)
  })

  it('look ahead: a turn-around sweeps to its final facing over every step but the last', () => {
    const run = createRun({ x: 0, yaw: 0 })
    run.advance(3, () => ({ goalX: 0, arriveFacing: Math.PI }))
    const turning = run.frames.filter(frame => frame.mode === 'turning')
    // Four steps of 54 ticks: the look-ahead leaves the facing at rest, moves no faster than a minimum-jerk move over
    // three steps, and names the final facing as the last step starts, one step ahead of the body.
    expect(turning.length).toBe(216)
    expect(Math.abs(turning[0]?.lookAhead ?? 1)).toBeLessThan(1e-3)
    const rates = turning.slice(1).map((frame, tick) => Math.abs(frame.lookAhead - (turning[tick]?.lookAhead ?? 0)))
    expect(Math.max(...rates)).toBeLessThan(1.01 * 1.875 * Math.PI / 162)
    for (const frame of turning.slice(161))
      expect(Math.abs(frame.lookAhead)).toBeCloseTo(Math.PI, 12)
  })

  it('turn easing: a turn leaves and reaches its facing at rest and never stops between its steps', () => {
    const run = createRun({ x: 0, yaw: 0 })
    run.advance(2, () => ({ goalX: 0, arriveFacing: Math.PI / 2 }))
    const turning = run.frames.filter(frame => frame.mode === 'turning')
    const rates = turning.map((frame, tick) => Math.abs(frame.root.yaw - (turning[tick - 1]?.root.yaw ?? 0)))
    // Two steps of 54 ticks from yaw 0; a linear step moves pi/4 / 54 per tick.
    const linear = Math.PI / 4 / 54
    expect(rates[0]).toBeLessThan(0.05 * linear)
    expect(rates[107]).toBeLessThan(0.05 * linear)
    expect(Math.abs((rates[54] ?? 0) - (rates[53] ?? 0))).toBeLessThan(0.05 * linear)
    expect(Math.min(...rates.slice(20, 88))).toBeGreaterThan(0.9 * linear)
    expect(turning[53]?.root.yaw).toBeCloseTo(Math.PI / 4, 12)
    expect(turning.at(-1)?.root.yaw).toBeCloseTo(Math.PI / 2, 12)
  })

  it('continuity: start, stop and turn blends change no channel faster than steady walking does', () => {
    // The adapter blends the gait over the idle pose by the gait weight.
    const channels: Array<[string, (frame: LocomotionFrame) => number, number]> = [
      ...pelvisChannels.map(channel => [channel, (frame: LocomotionFrame) => frame.weight * frame.body[channel], 0.001 * legLength] as [string, (frame: LocomotionFrame) => number, number]),
      ...angleChannels.map(channel => [channel, (frame: LocomotionFrame) => frame.weight * frame.body[channel], 0.05 * rad] as [string, (frame: LocomotionFrame) => number, number]),
      ['support', frame => frame.support, 0],
      ...sides.flatMap(side => [
        [`${side} flexion`, (frame: LocomotionFrame) => frame.armSwing[side].flexion, 0.05 * rad],
        [`${side} elbowFlex`, (frame: LocomotionFrame) => frame.armSwing[side].elbowFlex, 0.05 * rad],
      ] as Array<[string, (frame: LocomotionFrame) => number, number]>),
    ]
    const maxStep = (frames: readonly LocomotionFrame[], read: (frame: LocomotionFrame) => number) => {
      let max = 0
      for (let tick = 1; tick < frames.length; tick++) {
        const frame = frames[tick]
        const previous = frames[tick - 1]
        if (frame && previous)
          max = Math.max(max, Math.abs(read(frame) - read(previous)))
      }
      return max
    }
    for (const name of ['journey', 'arrive', 'paces'] as const) {
      const { frames } = scenario(name)
      // Steady walking: consecutive cruise frames of this scenario at an unchanged speed.
      const steadyPairs = frames.flatMap((frame, tick) => {
        const previous = frames[tick - 1]
        return previous && frame.mode === 'walking' && previous.mode === 'walking' && frame.speed === previous.speed ? [[previous, frame]] : []
      })
      expect(steadyPairs.length, name).toBeGreaterThan(100)
      for (const [channel, read, floor] of channels) {
        const steadyStep = Math.max(...steadyPairs.map(pair => maxStep(pair, read)))
        expect(maxStep(frames, read), `${name} ${channel}`).toBeLessThanOrEqual(Math.max(1.5 * steadyStep, floor))
      }
    }
    for (const name of ['journey', 'arrive', 'paces'] as const) {
      const { frames } = scenario(name)
      expect(maxStep(frames, frame => frame.weight), name).toBeLessThanOrEqual(1.5 * dt / 0.3 + 1e-12)
      expect(frames.some(frame => frame.weight === 1), name).toBe(true)
      expect(frames.at(-1)?.weight, name).toBe(0)
    }
  })

  it('determinism: equal seeds and inputs replay equal frames; ties use the seed', () => {
    expect(simulate('journey', 11).frames).toEqual(simulate('journey', 11).frames)

    const firstFoot = (seed: number, idleSupport: number) => {
      const run = createRun({ x: 0, yaw: Math.PI / 2 }, seed)
      run.advance(1, () => ({ goalX: 50, arriveFacing: Math.PI / 2, idleSupport }))
      return eventsOf(run.frames, 'liftOff')[0]?.foot
    }
    const seeds = Array.from({ length: 16 }, (_, index) => index + 1)
    expect(new Set(seeds.map(seed => firstFoot(seed, 0)))).toEqual(new Set(['left', 'right']))
    // Weight on the right (s > 0.2) unloads the left foot, which swings first.
    expect(new Set(seeds.map(seed => firstFoot(seed, 0.5)))).toEqual(new Set(['left']))
    expect(new Set(seeds.map(seed => firstFoot(seed, -0.5)))).toEqual(new Set(['right']))
  })

  it('rebase: the root jumps to the new pose and stays idle with both feet planted beside it', () => {
    const run = createRun({ x: 0, yaw: Math.PI / 2 })
    run.advance(3, () => ({ goalX: 30, arriveFacing: Math.PI / 2 }))
    expect(['starting', 'walking']).toContain(run.frames.at(-1)?.mode)
    const before = run.frames.length
    run.locomotion.rebase({ x: 40, yaw: 0 })
    run.advance(2, () => ({ goalX: null }))
    const after = run.frames.slice(before)
    expect(after).toHaveLength(240)
    expect(after[0]?.weight).toBe(0)
    const beside = bindFeet({ x: 40, yaw: 0 })
    for (const frame of after) {
      expect(frame.mode).toBe('idle')
      expect(frame.root).toEqual({ position: { x: 40, y: 0, z: 0 }, yaw: 0 })
      expect(frame.speed).toBe(0)
      for (const side of sides) {
        expect(frame.feet[side].planted).toBe(true)
        expect(frame.feet[side].target).toEqual(beside[side])
      }
    }
  })
})
