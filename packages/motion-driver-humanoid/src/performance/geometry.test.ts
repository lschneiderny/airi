import type { BodyCollider } from './contracts'

import { describe, expect, it } from 'vitest'

import { solveArmKey } from './arm-key'
import { ARM_START, BODY_CHANNELS, channelIndex, DEG } from './channels'
import { BodyCollision, colliderDistance, proxyColliders } from './collision'
import { createBodyPerformer } from './index'
import { fixtureRigs } from './performance.test-fixtures'
import { BodySkeleton, spineWeights } from './skeleton'

const traits = fixtureRigs[0].traits

describe('canonical geometry', () => {
  it.each([1, 2, 3, 4])('preserves total torso yaw across a %i-bone curve', (count) => {
    const chain = Array.from({ length: count }, (_, i) => ({ x: 0, y: 11 + i, z: 0 }))
    const weights = spineWeights(chain)
    for (let k = 0; k < 3; k++) {
      let sum = 0
      for (let i = 0; i < count; i++)
        sum += weights[i * 3 + k]
      expect(sum).toBeCloseTo(1, 12)
    }
    const skeleton = new BodySkeleton({ ...traits, spineChain: chain })
    const channels = new Float32Array(BODY_CHANNELS.length)
    channels[channelIndex('lowerYaw')] = 0.12
    channels[channelIndex('midYaw')] = -0.07
    channels[channelIndex('upperYaw')] = 0.04
    skeleton.update(channels)
    const head = skeleton.frames.head
    expect(Math.atan2(head[2], head[8])).toBeCloseTo(0.12 - 0.07 + 0.04, 6)
  })

  it.each(['left', 'right'] as const)('solves a shoulder-relative arm key back to its target on the %s', (side) => {
    const arm = traits.arms[side]
    const upperLength = Math.hypot(arm.upperArm.x, arm.upperArm.y, arm.upperArm.z)
    const forearmLength = Math.hypot(arm.forearm.x, arm.forearm.y, arm.forearm.z)
    const key = { hand: [0.2, -0.5, 0.45] as const, swivel: 0.2, pron: 0, wflex: 0, wdev: 0 }
    const solution = solveArmKey(key, { side, upperLength, forearmLength })
    expect(solution).not.toBeNull()
    if (!solution)
      throw new Error('Reachable key was refused')
    const channels = new Float32Array(BODY_CHANNELS.length)
    const start = ARM_START[side]
    channels[start + 2] = solution.flex
    channels[start + 3] = solution.abduct
    channels[start + 4] = solution.twist
    channels[start + 5] = solution.elbow
    const skeleton = new BodySkeleton(traits)
    skeleton.update(channels)
    const pose = skeleton.arm(side, channels)
    const length = upperLength + forearmLength
    const target = {
      x: pose.shoulder.x + (side === 'left' ? 1 : -1) * key.hand[0] * length,
      y: pose.shoulder.y + key.hand[1] * length,
      z: pose.shoulder.z + key.hand[2] * length,
    }
    expect(Math.hypot(pose.wrist.x - target.x, pose.wrist.y - target.y, pose.wrist.z - target.z)).toBeLessThan(length * 1e-6)
    expect(solveArmKey({ ...key, hand: [2, 0, 0] }, { side, upperLength, forearmLength })).toBeNull()
  })

  it('uses surface distances and outward normals for sphere, capsule and box proxies', () => {
    const base = { bone: 'hips', centre: { x: 0, y: 0, z: 0 }, rotation: { yaw: 0, pitch: 0, roll: 0 } } as const
    const shapes: BodyCollider[] = [
      { ...base, shape: 'sphere', radius: 1 },
      { ...base, shape: 'capsule', radius: 1, length: 2 },
      { ...base, shape: 'box', halfSize: { x: 1, y: 1, z: 1 } },
    ]
    const normal = { x: 0, y: 0, z: 0 }
    for (const shape of shapes) {
      expect(colliderDistance(shape, { x: 2, y: 0, z: 0 }, normal)).toBeCloseTo(1)
      expect(normal).toEqual({ x: 1, y: 0, z: 0 })
      expect(colliderDistance(shape, { x: 0.5, y: 0, z: 0 }, normal)).toBeLessThan(0)
    }
  })

  it.each(fixtureRigs)('corrects an actual arm-body crossing on $name', ({ traits }) => {
    const channels = createBodyPerformer({ traits, seed: 1 }).restChannels()
    const collision = new BodyCollision(traits, channels)
    channels[channelIndex('leftAbduct')] = -15 * DEG
    channels[channelIndex('leftFlex')] = 0
    channels[channelIndex('leftElbow')] = 3 * DEG
    collision.prepare(channels)
    expect(collision.measure('left', channels).depth).toBeGreaterThan(0)
    collision.correct(channels, 1)
    collision.prepare(channels)
    expect(collision.measure('left', channels).depth).toBe(0)
    expect(collision.correction.left).toBeGreaterThan(0)
  })

  it.each(fixtureRigs)('moves an arm continuously while it grazes into a proxy and out again on $name', ({ traits }) => {
    const rest = createBodyPerformer({ traits, seed: 1 }).restChannels()
    const collision = new BodyCollision(traits, rest)
    const abduct = channelIndex('leftAbduct')
    const probe = rest.slice()
    probe[channelIndex('leftFlex')] = 0
    probe[channelIndex('leftElbow')] = 3 * DEG
    collision.prepare(probe)
    let clear = 10 * DEG
    let inside = -15 * DEG
    for (let i = 0; i < 40; i++) {
      probe[abduct] = (clear + inside) / 2
      if (collision.measure('left', probe).depth > 0)
        inside = probe[abduct]
      else
        clear = probe[abduct]
    }
    // A slow idle drift (0.6 deg/s) crosses the contact abduction by 0.5 deg and returns.
    const step = 0.005 * DEG
    const path = [...Array.from({ length: 200 }, (_, i) => clear + 0.5 * DEG - i * step), ...Array.from({ length: 200 }, (_, i) => clear - 0.5 * DEG + i * step)]
    const arm = [2, 3, 4, 5].map(j => ARM_START.left + j)
    const output: number[][] = []
    for (const target of path) {
      const channels = probe.slice()
      channels[abduct] = target
      collision.correct(channels, output.length + 1)
      expect(collision.penetration.left).toBe(0)
      output.push(arm.map(index => channels[index]))
    }
    let jerk = 0
    for (let t = 2; t < output.length; t++)
      jerk = Math.max(jerk, ...arm.map((_, j) => Math.abs(output[t][j] - 2 * output[t - 1][j] + output[t - 2][j])))
    // A one-sixteenth guard-blend step is 2-4 deg; the approach itself changes velocity by at most 0.005 deg per tick.
    expect(jerk / DEG).toBeLessThan(0.02)
  })

  it.each(fixtureRigs)('moves an arm continuously through a forced deep forearm contact with no fallback on $name', ({ traits }) => {
    const rest = createBodyPerformer({ traits, seed: 1 }).restChannels()
    const collision = new BodyCollision(traits, rest)
    const arm = [2, 3, 4, 5].map(j => ARM_START.left + j)
    // The forearm folds across the chest from the side in 0.5 s, holds 0.5 s and unfolds: a hand-to-chest gone too deep.
    const key = [0, -20 * DEG, 0, 140 * DEG]
    const ease = (u: number) => u * u * u * (10 - 15 * u + 6 * u * u)
    const input: number[][] = []
    const output: number[][] = []
    for (let tick = 0; tick < 180; tick++) {
      const time = tick / 120
      const s = ease(time < 0.5 ? time / 0.5 : time < 1 ? 1 : Math.max(0, 1.5 - time) / 0.5)
      const channels = rest.slice()
      arm.forEach((index, k) => channels[index] = rest[index] + (key[k] - rest[index]) * s)
      input.push(arm.map(index => channels[index]))
      collision.correct(channels, tick + 1)
      output.push(arm.map(index => channels[index]))
    }
    let speed = 0
    let jerk = 0
    for (let t = 2; t < output.length; t++) {
      for (let j = 0; j < arm.length; j++) {
        speed = Math.max(speed, Math.abs(input[t][j] - input[t - 1][j]))
        jerk = Math.max(jerk, Math.abs(output[t][j] - 2 * output[t - 1][j] + output[t - 2][j]))
      }
    }
    expect(collision.corrector).toEqual({ capHits: 0, guardScans: 0 })
    expect(collision.collisions.count).toBe(0)
    // Stopping the incoming motion dead at the surface changes velocity by at most the input's own per-tick speed; the
    // one-sixteenth guard step jumped by 5 to 8 degrees per tick squared here.
    expect(jerk).toBeLessThan(speed)
  })

  it('protects head proxies as well as torso proxies', () => {
    const head: BodyCollider = { bone: 'head', shape: 'sphere', radius: 1.1, centre: { x: 0, y: 0, z: 0 }, rotation: { yaw: 0, pitch: 0, roll: 0 } }
    const rig = { ...traits, colliders: [...proxyColliders(traits), head] }
    const rest = createBodyPerformer({ traits: rig, seed: 1 }).restChannels()
    const collision = new BodyCollision(rig, rest)
    const upper = traits.arms.left.upperArm
    const budget = 0.015 * Math.hypot(upper.x, upper.y, upper.z)
    const depths: number[] = []
    for (let tick = 1; tick <= 2; tick++) {
      const channels = rest.slice()
      channels[channelIndex('leftAbduct')] = 0
      channels[channelIndex('leftFlex')] = 150 * DEG
      channels[channelIndex('leftElbow')] = 20 * DEG
      collision.prepare(channels)
      expect(collision.measure('left', channels).head).toBeGreaterThan(0)
      collision.correct(channels, tick)
      collision.prepare(channels)
      depths.push(collision.measure('left', channels).head)
    }
    // A contact that appears at once may keep half the corrector margin while the guard weight eases in (plan 3.1).
    expect(depths[0]).toBeLessThanOrEqual(budget)
    expect(depths[1]).toBe(0)
  })
})
