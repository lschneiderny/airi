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

  it('protects head proxies as well as torso proxies', () => {
    const head: BodyCollider = { bone: 'head', shape: 'sphere', radius: 1.1, centre: { x: 0, y: 0, z: 0 }, rotation: { yaw: 0, pitch: 0, roll: 0 } }
    const rig = { ...traits, colliders: [...proxyColliders(traits), head] }
    const channels = createBodyPerformer({ traits: rig, seed: 1 }).restChannels()
    const collision = new BodyCollision(rig, channels)
    channels[channelIndex('leftAbduct')] = 0
    channels[channelIndex('leftFlex')] = 150 * DEG
    channels[channelIndex('leftElbow')] = 20 * DEG
    collision.prepare(channels)
    expect(collision.measure('left', channels).head).toBeGreaterThan(0)
    collision.correct(channels, 1)
    collision.prepare(channels)
    expect(collision.measure('left', channels).head).toBe(0)
  })
})
