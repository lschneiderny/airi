import type { Foot, FootAnchor } from '../foot-contact'
import type { Vec3 } from '../types'
import type { GaitStyle, GaitTraits, GaitVariability, LocomotionFrame, LocomotionInput } from './index'

import { createHash } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { STROLL_URGENCY, WALK_URGENCY } from '../types'
import { brakingDistance, createLocomotion, NEUTRAL_GAIT_STYLE, SIDESTEP_MAX_LEGS, urgencySpeedShare } from './index'

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
// l_ref = 0.625 L and f_ref = 1.44 Hz: 0.9 L per second, as before the stride was refitted.
const referenceRate = 1.44
const referenceSpeed = 0.625 * legLength * referenceRate
// The leash's limit on a planted ankle's distance from its hip, in leg lengths.
const hardReach = 0.993
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
          urgency: WALK_URGENCY,
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
        return { goalX: 200, urgency: WALK_URGENCY, arriveFacing: Math.PI / 2 }
      if (now < 5)
        return { goalX: 200, urgency: STROLL_URGENCY, arriveFacing: Math.PI / 2 }
      return { goalX: -40, urgency: WALK_URGENCY, arriveFacing: -Math.PI / 2 }
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

describe('sidestep', () => {
  it.each([-0.55, -0.3, 0.3, 0.55, -SIDESTEP_MAX_LEGS, SIDESTEP_MAX_LEGS].flatMap(legs => [0, 0.2].map(yaw => ({ legs, yaw }))))('steps $legs legs sideways at yaw $yaw without turning or moving a planted foot', ({ legs, yaw }) => {
    const start = { x: 3, yaw }
    const goalX = start.x + legs * legLength
    const run = createRun(start)
    run.advance(8, () => ({ goalX, step: 'sidestep' as const, urgency: STROLL_URGENCY, arriveFacing: 0 }))
    const last = run.frames.at(-1)!
    expect(last.mode).toBe('idle')
    expect(Math.abs(last.root.position.x - goalX)).toBeLessThanOrEqual(0.05 * legLength)
    expect(run.frames.some(frame => frame.mode === 'turning')).toBe(false)
    expect(Math.max(...run.frames.map(frame => Math.abs(wrap(frame.root.yaw - start.yaw))))).toBeLessThanOrEqual(rad)
    expect(maxReach(run.frames)).toBeLessThanOrEqual(hardReach * legLength + 1e-9)
    expect(run.locomotion.leashClamps).toBe(0)
    const landed = bindFeet({ ...start, x: goalX })
    for (const side of sides) {
      expect(last.feet[side].planted).toBe(true)
      expect(distance(last.feet[side].target.position, landed[side].position)).toBeLessThan(1e-9)
      for (let tick = 1; tick < run.frames.length; tick++) {
        const previous = run.frames[tick - 1]!.feet[side]
        const foot = run.frames[tick]!.feet[side]
        if (previous.planted && foot.planted)
          expect(foot.target).toEqual(previous.target)
      }
    }
    const lifts = eventsOf(run.frames, 'liftOff')
    const strikes = eventsOf(run.frames, 'heelStrike')
    expect(lifts.length).toBeGreaterThanOrEqual(2)
    expect(lifts.length % 2).toBe(0)
    expect(lifts[0]!.foot).toBe(legs > 0 ? 'left' : 'right')
    expect(strikes.map(event => event.foot)).toEqual(lifts.map(event => event.foot))
    // Each foot lands on the same pair destination; no root translation can drag the planted partner there.
    strikes.forEach((strike, index) => {
      const pairDistance = Math.min(Math.abs(legs) * legLength, (Math.floor(index / 2) + 1) * 0.5 * legLength)
      const pairFeet = bindFeet({ ...start, x: start.x + Math.sign(legs) * pairDistance })
      expect(distance(strike.frame.feet[strike.foot].target.position, pairFeet[strike.foot].position)).toBeLessThan(1e-9)
    })
    const replay = createRun(start)
    replay.advance(8, () => ({ goalX, step: 'sidestep' as const, urgency: STROLL_URGENCY, arriveFacing: 0 }))
    expect(replay.frames).toEqual(run.frames)
  })

  it.each([-0.8, 0.8])('walks exactly as before for a requested sidestep of %s legs', (legs) => {
    const ordinary = createRun({ x: 0, yaw: 0 })
    const requested = createRun({ x: 0, yaw: 0 })
    ordinary.advance(10, () => ({ goalX: legs * legLength }))
    requested.advance(10, () => ({ goalX: legs * legLength, step: 'sidestep' as const }))
    expect(requested.frames).toEqual(ordinary.frames)
  })

  it('keeps unrequested sidesteps on the ordinary walk path', () => {
    const hash = createHash('sha256')
    for (const name of allScenarios) {
      const ordinary = simulate(name)
      const definition = scenarioDefinitions[name]
      const forwarded = createRun(definition.start)
      forwarded.advance(definition.seconds, now => ({ ...definition.drive(now), step: undefined }))
      expect(forwarded.frames).toEqual(ordinary.frames)
      hash.update(JSON.stringify(ordinary.frames, (_, value: unknown) => typeof value === 'number' ? Math.round(value * 1e9) / 1e9 : value))
    }
    // Ignore last-bit differences in transcendental math across V8 builds and optimization tiers. Re-pinned when the frame
    // gained `armSwing.wristFlex` and `handCurl` (hand carriage) and then the arm's `twist` and `pronation` (forearm
    // roll): without those keys the frames hash as before.
    expect(hash.digest('hex')).toBe('07b2b7bdbd17fee0c1534b7b70603de766e8a3ed6a859fedf076335d77afb768')
  })

  it('finishes a withdrawn pair and settles with both feet planted', () => {
    const run = createRun({ x: 0, yaw: 0 })
    run.advance(8, now => ({ goalX: now < 0.5 ? 0.55 * legLength : null, step: 'sidestep', urgency: now < 0.5 ? STROLL_URGENCY : WALK_URGENCY }))
    const last = run.frames.at(-1)!
    expect(last.mode).toBe('idle')
    expect(last.root.position.x).toBeCloseTo(0.5 * legLength)
    expect(last.feet.left.planted).toBe(true)
    expect(last.feet.right.planted).toBe(true)
    expect(eventsOf(run.frames, 'heelStrike')).toHaveLength(2)
    expect(run.frames.some(frame => frame.mode === 'turning')).toBe(false)
    const uninterrupted = createRun({ x: 0, yaw: 0 })
    uninterrupted.advance(8, () => ({ goalX: 0.55 * legLength, step: 'sidestep', urgency: STROLL_URGENCY }))
    const firstPairEnd = eventsOf(run.frames, 'heelStrike')[1]!.tick
    expect(run.frames.slice(0, firstPairEnd + 1).map(frame => frame.root))
      .toEqual(uninterrupted.frames.slice(0, firstPairEnd + 1).map(frame => frame.root))
  })

  it('finishes the pair before a replacement beyond the sidestep limit walks', () => {
    const run = createRun({ x: 0, yaw: 0 })
    run.advance(12, now => ({ goalX: now < 0.5 ? 0.55 * legLength : 2 * legLength, step: 'sidestep', urgency: STROLL_URGENCY }))
    const last = run.frames.at(-1)!
    expect(last.mode).toBe('idle')
    expect(last.root.position.x).toBeCloseTo(2 * legLength)
    // The walk turns while it steps off, so it has no turn on the spot; its turn starts where the pair ended.
    expect(run.frames.some(frame => frame.mode === 'turning')).toBe(false)
    const firstTurned = run.frames.find(frame => Math.abs(frame.root.yaw) > rad)!
    expect(firstTurned.root.position.x).toBeGreaterThanOrEqual(0.5 * legLength - 1e-9)
    expect(firstTurned.root.position.x).toBeLessThan(0.52 * legLength)
  })
})

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

  it('swing: the ankle is highest in the first 45 % of a swing and comes in under a quarter of that height by 90 %', () => {
    // Walking adults lift the ankle highest about a third into the swing and bring it in low over the last quarter
    // (Bandai Namco Research Motiondataset 2, walk clips, measured 2026-11-23).
    const { frames } = scenario('cruise')
    let swings = 0
    for (const side of sides) {
      let peak = { height: 0, progress: 0 }
      let late = 0
      let whole = false
      for (const [tick, frame] of frames.entries()) {
        const foot = frame.feet[side]
        if (tick * dt < 3)
          continue
        if (foot.swing === null) {
          if (whole && peak.height > 0) {
            swings++
            expect(peak.progress).toBeLessThan(0.45)
            expect(late).toBeLessThan(0.25 * peak.height)
          }
          peak = { height: 0, progress: 0 }
          late = 0
          whole = true
          continue
        }
        const height = foot.target.position.y - traits.footBaselineY
        if (height > peak.height)
          peak = { height, progress: foot.swing }
        if (foot.swing >= 0.9)
          late = Math.max(late, height)
      }
    }
    expect(swings).toBeGreaterThan(8)
  })

  it('reach: every planted ankle stays within 0.993 L of its hip without leash clamps', () => {
    let max = 0
    for (const name of allScenarios) {
      const run = scenario(name)
      const reach = maxReach(run.frames)
      max = Math.max(max, reach)
      expect(run.locomotion.leashClamps, `${name} leash clamps`).toBe(0)
      expect(reach, name).toBeLessThanOrEqual(hardReach * legLength + 1e-9)
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
    expect(times.length).toBeGreaterThan(800)
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

  it('step period: steady heel strikes at v_ref are 83 or 84 ticks apart', () => {
    const strikes = eventsOf(scenario('cruise').frames, 'heelStrike').filter(strike => strike.frame.speed === referenceSpeed)
    const gaps = strikes.slice(1).map((strike, index) => strike.tick - (strikes[index]?.tick ?? 0))
    console.info(`locomotion step period at v_ref: ${[...new Set(gaps)].sort().join(' or ')} ticks over ${gaps.length} steps`)
    expect(gaps.length).toBeGreaterThan(8)
    for (const gap of gaps) {
      expect([83, 84]).toContain(gap)
      expect(Math.abs(gap - 120 / referenceRate)).toBeLessThanOrEqual(1)
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

    // The arms swing in antiphase from one trunk drive; the forward swing (19.5) is larger than the back swing (15.5), so the two
    // arms' offsets from 2 degrees, the right one taken at the left's size, sum to a seventh of their difference.
    for (const name of allScenarios) {
      for (const frame of scenario(name).frames) {
        const left = frame.armSwing.left.flexion - 2 * rad
        const right = (frame.armSwing.right.flexion - 2 * rad) / (1 - 0.219)
        // Forward 19.5 and back 15.5 with a soft corner of 0.15 between them: the sum of the mirrored arms is that corner.
        const corner = left + right - Math.abs(left - right) / 8.75
        expect(corner).toBeLessThanOrEqual(1e-9)
        expect(corner).toBeGreaterThanOrEqual(-4 * 0.15 * rad - 1e-9)
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

  it('braking distance: the slide from v_ref is v_ref^2 / 2 a_max less half a tick of travel, and none from rest', () => {
    expect(brakingDistance(referenceSpeed, legLength)).toBeCloseTo(referenceSpeed ** 2 / (2 * maxAcceleration) - referenceSpeed * dt / 2, 9)
    expect(brakingDistance(maxAcceleration * dt / 2, legLength)).toBe(0)
    expect(brakingDistance(0, legLength)).toBe(0)
  })

  it('rest point: a walk that loses its goal comes to rest where the frame before said it would', () => {
    for (const [seconds, urgency] of [[0.6, WALK_URGENCY], [1.2, WALK_URGENCY], [4, WALK_URGENCY], [4, STROLL_URGENCY]] as const) {
      const run = createRun({ x: 0, yaw: Math.PI / 2 }, 7, traits, {})
      run.advance(seconds, () => ({ goalX: 500, urgency, arriveFacing: Math.PI / 2 }))
      const before = run.frames.at(-1)
      run.advance(4, () => ({ goalX: null }))
      const last = run.frames.at(-1)

      expect(before?.speed, `urgency ${urgency} ${seconds} s`).toBeGreaterThan(0)
      expect(before?.restX, `urgency ${urgency} ${seconds} s`).toBeGreaterThan(before?.root.position.x ?? Infinity)
      expect(Math.abs((last?.root.position.x ?? 0) - (before?.restX ?? 0)), `urgency ${urgency} ${seconds} s`).toBeLessThan(1e-9)
      expect(last?.restX).toBe(last?.root.position.x)
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
      expect(strike.frame.feet[strike.foot].roll.pitch).toBeGreaterThan(0.95 * 20 * rad)
    for (const lift of lifts)
      expect(lift.frame.feet[lift.foot].roll.pitch).toBeLessThan(-0.95 * 28 * rad)
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
    // The torso's counter-rotation runs ahead of the pelvis's twist (walking adults' shoulder girdle reaches its turn
    // before the pelvis reaches its own): minus the torso matches the pelvis yaw best some 8 to 30 ticks later, and
    // its size is the segments' shares, 0.6 of the pelvis's.
    const pelvis = steady.map(frame => frame.body.lowerBodyYaw)
    const torsos = steady.map(torso)
    const match = (shift: number) => mean(torsos.slice(0, torsos.length - 60).map((value, index) => -value * (pelvis[index + shift] ?? 0)))
    let best = 0
    for (let shift = 0; shift <= 60; shift++) {
      if (match(shift) > match(best))
        best = shift
    }
    expect(best).toBeGreaterThanOrEqual(8)
    expect(best).toBeLessThanOrEqual(30)
    const torsoPeak = Math.max(...torsos.map(Math.abs))
    expect(torsoPeak).toBeGreaterThan(0.55 * peak)
    expect(torsoPeak).toBeLessThan(0.62 * peak)
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

  it('arm swing: the forward swing is larger, the elbow follows the shoulder 30 ms late, and the clavicle protracts', () => {
    const { frames } = scenario('cruise')
    const steady = frames.filter((frame, tick) => tick * dt >= 3 && frame.mode === 'walking')
    const flexion = steady.map(frame => frame.armSwing.left.flexion)
    // The trunk's three lag links pass the stride frequency at 0.99 of its size.
    expect(Math.max(...flexion)).toBeLessThanOrEqual(2 * rad + 19.5 * rad)
    expect(Math.max(...flexion)).toBeGreaterThan(2 * rad + 0.98 * 19.5 * rad)
    expect(Math.min(...flexion)).toBeGreaterThanOrEqual(2 * rad - 15.5 * rad)
    expect(Math.min(...flexion)).toBeLessThan(2 * rad - 0.98 * 15.5 * rad)
    // The elbow's forward bend peaks when the shoulder's forward swing peaked 0.03 s (3.6 ticks) earlier.
    const peaks = (values: readonly number[]) => values.flatMap((value, index) => index > 0 && index < values.length - 1 && value > (values[index - 1] ?? 0) && value >= (values[index + 1] ?? 0) ? [index] : [])
    const shoulder = peaks(flexion)
    const elbow = peaks(steady.map(frame => frame.armSwing.left.elbowFlex))
    expect(shoulder.length).toBeGreaterThan(4)
    for (const peak of shoulder) {
      const next = elbow.find(index => index >= peak)
      if (next !== undefined)
        expect(Math.abs(next - peak - 4)).toBeLessThanOrEqual(1)
    }
    for (const frame of steady) {
      const swing = frame.armSwing.left
      // Forward of 2 degrees the clavicle protracts; behind it, it retracts. It leads the arm by 26 ms, over which the arm
      // moves under 3 degrees, so the signs are compared beyond that. The arm's floor on its hang runs from 14 degrees
      // out at the back of the swing to 19 at the front.
      if (Math.abs(swing.flexion - 2 * rad) > 3 * rad)
        expect(Math.sign(swing.clavProt)).toBe(Math.sign(swing.flexion - 2 * rad))
      expect(swing.abduct).toBeGreaterThanOrEqual(13.5 * rad)
      expect(swing.abduct).toBeLessThanOrEqual(19 * rad + 1e-9)
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
    expect(windows.length).toBeGreaterThan(12)
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

  it('look ahead: a start that turns sweeps the gaze to the heading ahead of the body, and a walk names its heading', () => {
    const run = createRun({ x: 0, yaw: 0 })
    run.advance(4, () => ({ goalX: -60, arriveFacing: 0 }))
    // She turns to face -x (-90 degrees) while she steps off, with no turn on the spot.
    expect(run.frames.some(frame => frame.mode === 'turning')).toBe(false)
    const done = run.frames.findIndex(frame => Math.abs(frame.root.yaw + Math.PI / 2) < 1e-9)
    expect(done).toBeGreaterThan(150)
    expect(done).toBeLessThan(300)
    // Until then the look-ahead runs ahead of her facing, never past the heading, by 25 to 45 degrees at its largest.
    let lead = 0
    for (const frame of run.frames.slice(0, done)) {
      expect(frame.lookAhead).toBeLessThanOrEqual(frame.root.yaw + 1e-9)
      expect(frame.lookAhead).toBeGreaterThanOrEqual(-Math.PI / 2 - 1e-9)
      lead = Math.max(lead, frame.root.yaw - frame.lookAhead)
    }
    expect(lead).toBeGreaterThan(25 * rad)
    expect(lead).toBeLessThan(45 * rad)
    const rates = run.frames.slice(1, done).map((frame, tick) => Math.abs(frame.lookAhead - (run.frames[tick]?.lookAhead ?? 0)))
    expect(Math.max(...rates)).toBeLessThan(3 * rad)
    const walking = run.frames.slice(done).filter(frame => frame.mode === 'walking')
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

  it('carries the planted toe-off pitch into the swing while braking', () => {
    const foot = { ankleHeight: 1, ballForward: 1.5, heelBack: 0.25 }
    const run = createRun({ x: 0, yaw: Math.PI / 2 }, 7, { ...traits, foot: { left: foot, right: foot } })
    run.advance(6, () => ({ goalX: 3 * legLength, arriveFacing: Math.PI / 2 }))
    const lifts = eventsOf(run.frames, 'liftOff').filter(event => event.frame.mode === 'stopping' && event.frame.weight === 1)
    expect(lifts.length).toBeGreaterThan(0)
    for (const event of lifts) {
      const planted = run.frames[event.tick - 1]!.feet[event.foot]
      expect(planted.planted).toBe(true)
      expect(Math.abs(event.frame.feet[event.foot].roll.pitch - planted.roll.pitch)).toBeLessThan(2 * rad)
    }
  })

  it('faces travel before stepping to an ordinary short goal', () => {
    const run = createRun({ x: 0, yaw: 0 })
    run.advance(8, () => ({ goalX: 0.3 * legLength, arriveFacing: 0 }))
    const moving = run.frames.find(frame => frame.speed > 0)
    expect(moving?.root.yaw).toBeCloseTo(Math.PI / 2)
    expect(run.frames.at(-1)?.root.position.x).toBeCloseTo(0.3 * legLength)
    expect(run.frames.at(-1)?.root.yaw).toBeCloseTo(0)
  })

  it('retargets an arrival turn during braking', () => {
    const run = createRun({ x: 0, yaw: Math.PI / 2 })
    const goalX = 3 * legLength
    const drive = () => ({ goalX, arriveFacing: 0 })
    while (!run.frames.some(frame => frame.mode === 'stopping') && run.frames.length < 600)
      run.advance(dt, drive)
    expect(run.frames.at(-1)?.mode).toBe('stopping')
    const braking = run.frames.length
    run.advance(6, () => ({ goalX, arriveFacing: Math.PI / 4 }))
    expect(run.frames.at(-1)?.root.yaw).toBeCloseTo(Math.PI / 4)
    expect(run.frames.slice(braking).some(frame => frame.mode === 'turning')).toBe(false)
  })

  it('carries yaw speed from an in-place turn into the weight shift', () => {
    const run = createRun({ x: 0, yaw: -Math.PI / 2 })
    run.advance(3, () => ({ goalX: 5 * legLength, arriveFacing: Math.PI / 2 }))
    const handoff = run.frames.findIndex((frame, i) => frame.mode === 'starting' && run.frames[i - 1]?.mode === 'turning')
    expect(handoff).toBeGreaterThan(1)
    const lastTurn = run.frames[handoff - 1]!.root.yaw - run.frames[handoff - 2]!.root.yaw
    const firstShift = run.frames[handoff]!.root.yaw - run.frames[handoff - 1]!.root.yaw
    expect(firstShift / lastTurn).toBeGreaterThan(0.8)
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
        [`${side} flexion`, (frame: LocomotionFrame) => frame.weight * frame.armSwing[side].flexion, 0.05 * rad],
        [`${side} elbowFlex`, (frame: LocomotionFrame) => frame.weight * frame.armSwing[side].elbowFlex, 0.05 * rad],
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

  it('arm phase: each arm is furthest back as the foot of its own side strikes, and forward as the other strikes', () => {
    const { frames } = scenario('cruise')
    const strikes = eventsOf(frames, 'heelStrike').filter(strike => strike.tick * dt >= 3)
    expect(strikes.length).toBeGreaterThan(8)
    for (const strike of strikes) {
      const own = strike.frame.armSwing[strike.foot].flexion - 2 * rad
      const other = strike.frame.armSwing[strike.foot === 'left' ? 'right' : 'left'].flexion - 2 * rad
      // Walking adults' upper arm is at the back of its swing within a twentieth of a stride of its own side's strike:
      // at the strike itself each arm is past 0.6 of its swing.
      expect(own).toBeLessThan(-0.6 * 12 * (strike.foot === 'right' ? 1 - 0.219 : 1) * rad)
      expect(other).toBeGreaterThan(0.6 * 16 * (strike.foot === 'left' ? 1 - 0.219 : 1) * rad)
    }
  })

  it('merged turns: a walk to the side turns while it steps off and while it brakes, and ends square to the viewer', () => {
    const run = createRun({ x: 0, yaw: 0 })
    run.advance(14, () => ({ goalX: 60, arriveFacing: 0 }))
    const { frames } = run
    expect(frames.some(frame => frame.mode === 'turning')).toBe(false)
    // The root is already under way when she has turned half way, and still under way when she is half way back: the
    // arrival turn starts before the braking, so it is not made on the spot after she has all but stopped.
    const halfOut = frames.find(frame => frame.root.yaw > Math.PI / 4)!
    expect(halfOut.speed).toBeGreaterThan(0.2 * referenceSpeed)
    const cruise = frames.findIndex(frame => frame.mode === 'walking')
    const halfBack = frames.slice(cruise).find(frame => frame.root.yaw < Math.PI / 4)!
    expect(halfBack.speed).toBeGreaterThan(0.2 * referenceSpeed)
    // No planted foot ever stands more than 60 degrees off her facing.
    for (const frame of frames) {
      for (const side of sides) {
        if (frame.feet[side].planted)
          expect(Math.abs(wrap(frame.feet[side].target.yaw - frame.root.yaw))).toBeLessThan(60 * rad)
      }
    }
    const last = frames.at(-1)!
    expect(last.mode).toBe('idle')
    expect(last.root.position.x).toBeCloseTo(60, 9)
    expect(last.root.yaw).toBeCloseTo(0, 9)
    // A foot already within its closing tolerance stays where it landed, a few millimetres from the bind stance.
    const square = bindFeet({ x: 60, yaw: 0 })
    for (const side of sides) {
      expect(distance(last.feet[side].target.position, square[side].position)).toBeLessThan(0.005 * legLength)
      expect(Math.abs(wrap(last.feet[side].target.yaw))).toBeLessThan(1e-9)
    }
    expect(run.locomotion.leashClamps).toBe(0)
  })

  it('stance line: a rig whose ankles stand behind its hips walks with its stance centred behind its hips', () => {
    // Ankles 0.1 L behind the root and hips 0.075 L ahead of them, as on an MMD rig measured on 2026-11-23. With the
    // hips taken to sit above the ankles, the feet landed 0.1 L too far forward and the pelvis sank to cover it.
    const rig: GaitTraits = {
      ...traits,
      bindAnkles: { left: { x: 1, y: 1, z: -1 }, right: { x: -1, y: 1, z: -1 } },
      bindHips: { left: { x: 0.9, y: 11, z: -0.25 }, right: { x: -0.9, y: 11, z: -0.25 } },
      foot: { left: { ankleHeight: 1.3, ballForward: 1.8, heelBack: 0 }, right: { ankleHeight: 1.3, ballForward: 1.8, heelBack: 0 } },
    }
    const locomotion = createLocomotion({ traits: rig, seed: 7, variability: { strideTime: 0, strideLength: 0, armLag: 0 } })
    locomotion.rebase({ x: 0, yaw: Math.PI / 2 })
    let planted: Record<Foot, FootAnchor> = {
      left: { position: { x: -1, y: 1, z: -1 }, yaw: Math.PI / 2 },
      right: { position: { x: -1, y: 1, z: 1 }, yaw: Math.PI / 2 },
    }
    const ahead: number[] = []
    const behind: number[] = []
    let deepest = 0
    for (let tick = 0; tick < 1200; tick++) {
      const frame = locomotion.step({ now: tick * dt, goalX: 500, urgency: WALK_URGENCY, arriveFacing: Math.PI / 2, enabled: true, idleSupport: 0, plantedFeet: planted }, dt)
      planted = { left: frame.feet.left.target, right: frame.feet.right.target }
      if (tick * dt < 4)
        continue
      deepest = Math.max(deepest, frame.body.pelvisDrop)
      for (const event of frame.events) {
        const offset = frame.feet[event.foot].target.position.x - frame.root.position.x + 1
        if (event.kind === 'heelStrike')
          ahead.push(offset)
        else
          behind.push(-offset)
      }
    }
    expect(ahead.length).toBeGreaterThan(4)
    // The stance is centred 0.14 of the step behind the hips, here 0.0125 L behind the ankle line: each foot lands 0.6 of
    // the 0.625 L step ahead of that and lifts as far behind it, less the 0.08 L its toe-off roll has carried the ankle
    // forward. Read on the tick of the event, up to a tick of travel late.
    for (const offset of ahead)
      expect(Math.abs(offset / legLength - 0.375)).toBeLessThan(0.025)
    for (const offset of behind) {
      expect(offset / legLength).toBeGreaterThan(0.27)
      expect(offset / legLength).toBeLessThan(0.4)
    }
    // The pelvis drops under 0.08 L; with the hips taken to sit above the ankles it dropped 0.11 L on the measured rig.
    expect(deepest).toBeLessThan(0.08 * legLength)
    expect(locomotion.leashClamps).toBe(0)
  })

  it('arrival: a goal withdrawn while the arrival turn leads the braking turns her over the braking\'s steps', () => {
    const run = createRun({ x: 0, yaw: Math.PI / 2 })
    let withdrawnAt = -1
    run.advance(10, () => {
      const last = run.frames.at(-1)
      if (withdrawnAt < 0 && last?.mode === 'walking' && Math.abs(wrap(last.root.yaw - Math.PI / 2)) > rad)
        withdrawnAt = run.frames.length
      return { goalX: withdrawnAt >= 0 ? null : 40, arriveFacing: 0 }
    })
    // She was in the lead: still walking, already turning to the viewer.
    expect(withdrawnAt).toBeGreaterThan(0)
    const strikes = eventsOf(run.frames.slice(0, withdrawnAt), 'heelStrike').map(event => event.tick)
    const step = strikes.at(-1)! - strikes.at(-2)!
    const faced = run.frames.findIndex((frame, tick) => tick >= withdrawnAt && Math.abs(wrap(frame.root.yaw)) < rad)
    // The braking turn takes 1.6 steps (1.43 to within a degree); kept on the arrival turn's plan she took 1.94.
    expect((faced - withdrawnAt) / step).toBeLessThan(1.7)
  })

  it('arrival: a foot a full step behind rolls off while she turns to face the viewer', () => {
    // Along her turning facing the trailing foot stood closer behind than along the path, so it lifted flat.
    const shoe = { ankleHeight: 1.3, ballForward: 1.8, heelBack: 0.25 }
    const run = createRun({ x: 0, yaw: 0 }, 7, { ...traits, foot: { left: shoe, right: shoe } })
    run.advance(14, () => ({ goalX: 60, arriveFacing: 0 }))
    const { frames } = run
    const cruise = frames.findIndex(frame => frame.mode === 'walking')
    const lifts = frames.slice(cruise).flatMap((frame, k) => frame.events.filter(event => event.kind === 'liftOff').map(event => ({ k: cruise + k, foot: event.foot }))).filter(({ k }) => frames[k].root.yaw < 80 * rad).filter(({ k, foot }) => frames[k].root.position.x - frames[k - 1].feet[foot].target.position.x > 0.2 * legLength)
    expect(lifts.length).toBeGreaterThan(0)
    for (const { k, foot } of lifts)
      expect(Math.min(...frames.slice(k - 10, k).map(frame => frame.feet[foot].roll.pitch))).toBeLessThan(-10 * rad)
  })

  it('step limit: a rig whose ball sits under its ankle takes shorter steps, so its trailing leg does not pull the pelvis down', () => {
    const walk = (foot: { ankleHeight: number, ballForward: number, heelBack: number }, style: Partial<GaitStyle> = {}, { seconds = 8, seed = 7, options = periodic } = {}) => {
      const run = createRun({ x: 0, yaw: Math.PI / 2 }, seed, { ...traits, foot: { left: foot, right: foot } }, options)
      run.advance(seconds, () => ({ goalX: 500, arriveFacing: Math.PI / 2, style: { ...NEUTRAL_GAIT_STYLE, ...style } }))
      const steady = run.frames.slice(4 * 120)
      const drops = steady.map(frame => frame.body.pelvisDrop)
      const strikes = steady.filter(frame => frame.events.some(event => event.kind === 'heelStrike')).map(frame => frame.root.position.x)
      const step = Math.max(...strikes.slice(1).map((x, k) => x - strikes[k])) / legLength
      return { limit: run.locomotion.stepLimit, limited: steady.map(frame => frame.limited.join()), bob: (Math.max(...drops) - Math.min(...drops)) / legLength, step }
    }
    const shoe = walk({ ankleHeight: 1.3, ballForward: 1.8, heelBack: 0.25 })
    const stiletto = walk({ ankleHeight: 1.3, ballForward: 0.3, heelBack: 0 })
    expect(shoe.limit).toBeGreaterThan(1)
    expect(new Set(shoe.limited)).toEqual(new Set(['']))
    // At the gait's full step the stiletto's pelvis bobbed 0.083 L, the shoe's 0.049 L.
    expect(stiletto.limit).toBeLessThan(0.9)
    expect(new Set(stiletto.limited)).toEqual(new Set(['stride']))
    expect(stiletto.bob).toBeLessThan(0.06)
    // The widest style asks the most of both: the least roll on the shoe, and on the stiletto a speed whose top cadence
    // would still lengthen the step past the limit, so the limit caps the speed too.
    const fast = { speed: 1.35, stride: 1.2, roll: 0.6 }
    expect(walk({ ankleHeight: 1.3, ballForward: 1.8, heelBack: 0.25 }, fast).bob).toBeLessThan(0.06)
    const hurried = walk({ ankleHeight: 1.3, ballForward: 0.3, heelBack: 0 }, fast)
    expect(new Set(hurried.limited)).toEqual(new Set(['stride,speed']))
    expect(hurried.step).toBeLessThan(hurried.limit * 0.625 + 0.01)
    // A stride's variation drifts some steps longer; at the limit the speed gives way instead. Seed 15 stepped 0.556 L.
    const varied = walk({ ankleHeight: 1.3, ballForward: 0.3, heelBack: 0 }, {}, { seconds: 20, seed: 15, options: {} })
    expect(varied.step).toBeLessThan(varied.limit * 0.625 + 0.01)
    expect(new Set(varied.limited)).toEqual(new Set(['stride']))
  })

  it('step limit: a hurried walk on a limited rig takes shorter, quicker steps, and only the top cadence slows it', () => {
    const hurry = (foot: { ankleHeight: number, ballForward: number, heelBack: number }, urgency: number) => {
      const run = createRun({ x: 0, yaw: Math.PI / 2 }, 7, { ...traits, foot: { left: foot, right: foot } })
      run.advance(10, () => ({ goalX: 5000, urgency, arriveFacing: Math.PI / 2 }))
      const steady = run.frames.slice(6 * 120)
      const strikes = steady.filter(frame => frame.events.some(event => event.kind === 'heelStrike')).map(frame => frame.root.position.x)
      return {
        speed: steady.reduce((sum, frame) => sum + frame.speed, 0) / steady.length / referenceSpeed,
        step: Math.max(...strikes.slice(1).map((x, k) => x - strikes[k])) / legLength,
        cap: run.locomotion.stepLimit * 0.625 + 0.01,
        limited: new Set(steady.map(frame => frame.limited.join())),
      }
    }
    // A shoe's limit, 1.03 of the gait's step, capped a chase at 1.056 of v_ref while the stride was held for the walk.
    const chase = hurry({ ankleHeight: 1.3, ballForward: 1.8, heelBack: 0.25 }, 0.75)
    expect(chase.speed).toBeCloseTo(urgencySpeedShare(0.75), 2)
    expect(chase.step).toBeLessThan(chase.cap)
    expect(chase.limited).toEqual(new Set(['stride']))
    const rush = hurry({ ankleHeight: 1.3, ballForward: 0.3, heelBack: 0 }, 1)
    expect(rush.speed).toBeGreaterThan(urgencySpeedShare(0.75))
    expect(rush.speed).toBeLessThan(urgencySpeedShare(1))
    expect(rush.step).toBeLessThan(rush.cap)
    expect(rush.limited).toEqual(new Set(['stride,speed']))
  })

  it('settle: the stop hands the feet back flat, since the standing feet take over without the gait\'s roll', () => {
    const stiletto = { ankleHeight: 1.3, ballForward: 0.3, heelBack: 0 }
    const run = createRun({ x: 0, yaw: Math.PI / 2 }, 7, { ...traits, foot: { left: stiletto, right: stiletto } }, {})
    run.advance(12, () => ({ goalX: 28.22, arriveFacing: Math.PI }))
    const released = run.frames.findIndex((frame, k) => k > 0 && frame.weight === 0 && run.frames[k - 1].weight > 0)
    expect(released).toBeGreaterThan(0)
    // Without the fade one foot stood 3.5 deg on its ball on the last weighted frame.
    const last = run.frames[released - 1]
    for (const side of sides)
      expect(Math.abs(last.feet[side].roll.pitch)).toBeLessThan(0.5 * rad)
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

describe('walk style', () => {
  const cruise = scenarioDefinitions.cruise
  function styled(style: Partial<GaitStyle>, seconds = cruise.seconds) {
    const run = createRun(cruise.start)
    run.advance(seconds, () => ({ ...cruise.drive(), style: { ...NEUTRAL_GAIT_STYLE, ...style } }))
    return run.frames
  }
  // Steady walking after the start, both sides.
  const steady = (frames: LocomotionFrame[]) => frames.slice(5 * 120)
  const span = (values: number[]) => Math.max(...values) - Math.min(...values)

  it('sizes the speed, the arm swing, the hip list and the twist by their style values', () => {
    const neutral = steady(styled({}))
    const shaped = steady(styled({ speed: 1.2, armSwing: 0.5, pelvisList: 2, pelvisTwist: 1.5 }))
    const mean = (frames: LocomotionFrame[]) => frames.reduce((sum, frame) => sum + frame.speed, 0) / frames.length
    expect(mean(shaped) / mean(neutral)).toBeCloseTo(1.2, 1)
    const flexion = (frames: LocomotionFrame[]) => span(frames.map(frame => frame.armSwing.left.flexion))
    expect(flexion(steady(styled({ armSwing: 0.5 }))) / flexion(neutral)).toBeCloseTo(0.5, 2)
    const roll = (frames: LocomotionFrame[]) => span(frames.map(frame => frame.body.lowerBodyRoll))
    expect(roll(shaped) / roll(neutral)).toBeGreaterThan(1.8)
    const yaw = (frames: LocomotionFrame[]) => span(frames.map(frame => frame.body.lowerBodyYaw))
    expect(yaw(shaped) / yaw(neutral)).toBeGreaterThan(1.4)
  })

  it('carries the elbow, the head and the trunk by their offsets, and a shorter stride steps faster at the same speed', () => {
    const neutral = steady(styled({}))
    const shaped = steady(styled({ elbowCarry: 20 * rad, head: 10 * rad, lean: 6 * rad, stride: 0.8 }))
    const mean = (frames: LocomotionFrame[], read: (frame: LocomotionFrame) => number) => frames.reduce((sum, frame) => sum + read(frame), 0) / frames.length
    expect(mean(shaped, frame => frame.armSwing.left.elbowFlex) - mean(neutral, frame => frame.armSwing.left.elbowFlex)).toBeCloseTo(20 * rad, 1)
    expect(mean(shaped, frame => frame.body.neckPitch)).toBeCloseTo(7 * rad, 3)
    expect(mean(shaped, frame => frame.body.spinePitch + frame.body.chestPitch) - mean(neutral, frame => frame.body.spinePitch + frame.body.chestPitch)).toBeCloseTo(6 * rad, 2)
    const strikes = (frames: LocomotionFrame[]) => frames.flatMap(frame => frame.events).filter(event => event.kind === 'heelStrike').length
    expect(strikes(shaped) / strikes(neutral)).toBeGreaterThan(1.1)
    expect(mean(shaped, frame => frame.speed) / mean(neutral, frame => frame.speed)).toBeCloseTo(1, 1)
  })

  it('rolls the arm inward as it swings forward, 7 to 20 degrees within a stride at the neutral style, sized by the swing', () => {
    const roll = (frame: LocomotionFrame) => frame.armSwing.left.twist + frame.armSwing.left.pronation
    const neutral = steady(styled({}))
    // Acted walks roll the forearm 7 to 19 degrees within a stride (arm-hand plan, section 1).
    expect(span(neutral.map(roll)) / rad).toBeGreaterThan(7)
    expect(span(neutral.map(roll)) / rad).toBeLessThan(20)
    // Inward (positive) at the front of the swing, outward behind it.
    for (const frame of neutral) {
      const swing = frame.armSwing.left.flexion - 2 * rad
      if (Math.abs(swing) > 10 * rad)
        expect(Math.sign(roll(frame))).toBe(Math.sign(swing))
    }
    // Pronation turns the hand alone and takes the larger share; the twist swings the bent forearm across the body.
    expect(span(neutral.map(frame => frame.armSwing.left.pronation))).toBeGreaterThan(span(neutral.map(frame => frame.armSwing.left.twist)))
    expect(span(steady(styled({ armSwing: 0.5 })).map(roll)) / span(neutral.map(roll))).toBeCloseTo(0.5, 2)
  })

  it('carries the hand by the style while walking and hands it back with the gait weight at the stop', () => {
    const style = { ...NEUTRAL_GAIT_STYLE, wristCarry: 20 * rad, handCurl: 3 }
    const run = createRun(scenarioDefinitions.arrive.start)
    run.advance(scenarioDefinitions.arrive.seconds, () => ({ ...scenarioDefinitions.arrive.drive(), style }))
    const walking = run.frames.filter(frame => frame.mode === 'walking')
    expect(walking.length).toBeGreaterThan(120)
    for (const frame of walking) {
      expect(frame.armSwing.left.wristFlex).toBeCloseTo(-20 * rad, 6)
      expect(frame.handCurl).toBeCloseTo(3, 6)
    }
    // The performer adds each gait channel by the weight, so the weighted carriage is what the hand shows: the weight's
    // smoothstep spreads it over the start and the stop, no tick moving it by more than 5 % of its size.
    const wrist = run.frames.map(frame => frame.weight * frame.armSwing.right.wristFlex)
    const curl = run.frames.map(frame => frame.weight * (frame.handCurl - 1))
    const steps = (values: number[]) => Math.max(...values.slice(1).map((value, index) => Math.abs(value - (values[index] as number))))
    expect(steps(wrist)).toBeLessThan(0.05 * 20 * rad)
    expect(steps(curl)).toBeLessThan(0.05 * 2)
    expect(run.frames.at(-1)?.mode).toBe('idle')
    expect(wrist.at(-1)).toBeCloseTo(0, 9)
    expect(curl.at(-1)).toBeCloseTo(0, 9)
  })

  it('eases into a new style under way without stepping any channel', () => {
    const run = createRun(cruise.start)
    run.advance(8, now => ({ ...cruise.drive(), style: now < 5 ? NEUTRAL_GAIT_STYLE : { ...NEUTRAL_GAIT_STYLE, head: 15 * rad, armSwing: 1.6, elbowCarry: 30 * rad } }))
    const steps = (read: (frame: LocomotionFrame) => number) => run.frames.slice(1).map((frame, index) => Math.abs(read(frame) - read(run.frames[index] as LocomotionFrame)))
    expect(Math.max(...steps(frame => frame.body.neckPitch))).toBeLessThan(0.3 * rad)
    expect(run.frames.at(-1)?.body.neckPitch).toBeCloseTo(15 * rad, 2)
  })

  it('keeps easing through the hand-off from a departure turn to the first step', () => {
    // Facing away from the goal: the start turns the excess on the spot, then the walk takes the turn over.
    const start = { x: 0, yaw: -Math.PI / 2 }
    const run = createRun(start)
    run.advance(4, now => ({ goalX: 500, arriveFacing: Math.PI / 2, style: now < 0.1 ? NEUTRAL_GAIT_STYLE : { ...NEUTRAL_GAIT_STYLE, head: 15 * rad } }))
    expect(run.frames.some(frame => frame.mode === 'turning')).toBe(true)
    const steps = run.frames.slice(1).map((frame, index) => Math.abs(frame.body.neckPitch * frame.weight - (run.frames[index] as LocomotionFrame).body.neckPitch * (run.frames[index] as LocomotionFrame).weight))
    expect(Math.max(...steps)).toBeLessThan(0.3 * rad)
  })

  it('leaves the walk unchanged under the neutral style', () => {
    const plain = createRun(cruise.start)
    plain.advance(cruise.seconds, cruise.drive)
    expect(styled({})).toEqual(plain.frames)
  })
})
