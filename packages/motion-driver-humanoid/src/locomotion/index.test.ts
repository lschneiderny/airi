import type { Foot, FootAnchor } from '../foot-contact'
import type { Vec3 } from '../types'
import type { GaitTraits, LocomotionFrame, LocomotionInput } from './index'

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

// Closed loop: each frame's foot targets come back as the next frame's planted anchors.
function createRun(start: Pose, seed = 7) {
  const locomotion = createLocomotion({ traits, seed })
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

    for (const name of allScenarios) {
      for (const frame of scenario(name).frames)
        expect(Math.abs(frame.armSwing.left.flexion - 2 * rad + frame.armSwing.right.flexion - 2 * rad)).toBeLessThanOrEqual(1e-12)
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

  it('continuity: start, stop and turn blends change no channel faster than steady walking does', () => {
    // The adapter applies weight * locomotion + (1 - weight) * weight-shift.
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
