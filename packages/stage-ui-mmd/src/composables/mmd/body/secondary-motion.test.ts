import type { BodyGarment, BodyModel } from '@proj-airi/motion-driver-humanoid/body-model'

import type { MMDCollisionBody } from './secondary-motion'

import { describe, expect, it } from 'vitest'

import { bodyFixture } from './fixture'
import { prepareMMDSecondaryMotion, readMMDArmCollisionReport, separateMMDArmCollisions } from './secondary-motion'

const FOLLOW = 0
const SIMULATED = 1
const ALL = 0xFFFF

// 0 root, 1 upper arm, 2 forearm, 3 and 4 skirt, 5 sleeve (on the forearm), 6 coat, 7 hair.
const bones = [-1, 0, 1, 0, 3, 2, 0, 0].map((parentBoneIndex, index) => ({ name: `bone-${index}`, parentBoneIndex, position: [0, 0, 0] as [number, number, number] }))
const ARMS = [1]

function body(boneIndex: number, physicsMode: number, collisionGroup: number, collisionMask: number): MMDCollisionBody {
  return { boneIndex, physicsMode, collisionGroup, collisionMask }
}

function modelOf(...garments: Pick<BodyGarment, 'bones' | 'pinched'>[]): BodyModel {
  return {
    volumes: [],
    garments: garments.map(garment => ({ ...garment, anchor: 'hips', silhouette: [], mobility: 1 })),
    limbs: { left: { upperArm: 0.15, forearm: 0.15 }, right: { upperArm: 0.15, forearm: 0.15 } },
    rest: { left: { abduct: 0.2, limit: null }, right: { abduct: 0.2, limit: null } },
    report: { vertices: { hard: 0, flesh: 0, garment: 0, arm: 0, ignored: 0 }, adjustments: [] },
  }
}

/** The pairs Ammo collides: each body's mask holds the other's group. */
function pairs(bodies: readonly MMDCollisionBody[]): Set<string> {
  const out = new Set<string>()
  for (let a = 0; a < bodies.length; a++) {
    for (let b = a + 1; b < bodies.length; b++) {
      if ((bodies[a].collisionMask & (1 << bodies[b].collisionGroup)) !== 0 && (bodies[b].collisionMask & (1 << bodies[a].collisionGroup)) !== 0)
        out.add(`${a}-${b}`)
    }
  }
  return out
}

const without = (mask: number, ...groups: number[]) => groups.reduce((value, group) => value & ~(1 << group), mask)

describe('separateMMDArmCollisions', () => {
  it('lets every arm body collide with a garment its author let one arm body push, and changes no other pair', () => {
    const bodies = [
      body(1, FOLLOW, 0, ALL),
      // The forearm leaves the skirt's group out, so on the authored rig it passes through the skirt.
      body(2, FOLLOW, 0, without(ALL, 2)),
      body(3, SIMULATED, 2, without(ALL, 2)),
      body(4, SIMULATED, 2, without(ALL, 2)),
      // Hair collides with the arms; the coat is kept apart from them.
      body(7, SIMULATED, 3, ALL),
      body(6, SIMULATED, 4, without(ALL, 0)),
    ]
    const before = pairs(bodies)
    const report = separateMMDArmCollisions(bodies, bones, ARMS, modelOf({ bones: [3, 4], pinched: false }, { bones: [6], pinched: false }))

    expect(report).toEqual({ status: 'applied', groups: [1], armBodies: 2, garmentBodies: 2, skippedBodies: 0 })
    expect(bodies[0].collisionGroup).toBe(1)
    expect(bodies[1].collisionGroup).toBe(1)
    expect([...pairs(bodies)].sort()).toEqual([...before, '1-2', '1-3'].sort())
  })

  it('leaves a rig as authored when no garment collides with an arm body', () => {
    const bodies = [body(1, FOLLOW, 0, without(ALL, 2)), body(3, SIMULATED, 2, ALL), body(4, SIMULATED, 2, without(ALL, 0))]
    const authored = bodies.map(entry => ({ ...entry }))
    expect(separateMMDArmCollisions(bodies, bones, ARMS, modelOf({ bones: [3, 4], pinched: false }))).toMatchObject({ status: 'no-soft-garments', groups: [], garmentBodies: 0 })
    expect(bodies).toEqual(authored)
  })

  it('leaves a pinched garment and a garment body with an empty mask as authored', () => {
    const bodies = [
      body(1, FOLLOW, 0, ALL),
      body(2, FOLLOW, 0, without(ALL, 2, 5)),
      body(3, SIMULATED, 2, without(ALL, 2)),
      // A weight of the skirt: its author lets it collide with nothing.
      body(4, SIMULATED, 2, 0),
      body(6, SIMULATED, 5, without(ALL, 5)),
    ]
    const before = pairs(bodies)
    const report = separateMMDArmCollisions(bodies, bones, ARMS, modelOf({ bones: [3, 4], pinched: false }, { bones: [6], pinched: true }))

    expect(report).toMatchObject({ status: 'applied', garmentBodies: 1 })
    expect(bodies[3].collisionMask).toBe(0)
    // Only the forearm and the skirt's surface gain a pair; the pinched coat keeps the pairs it had.
    expect([...pairs(bodies)].sort()).toEqual([...before, '1-2'].sort())
  })

  it('moves a garment to a group of its own when an arm body must stay apart from another body of its group', () => {
    const bodies = [
      body(1, FOLLOW, 0, ALL),
      // The forearm does not collide with its own sleeve, which shares the skirt's group.
      body(2, FOLLOW, 0, without(ALL, 2)),
      body(5, SIMULATED, 2, ALL),
      body(3, SIMULATED, 2, without(ALL, 2)),
      body(7, SIMULATED, 3, without(ALL, 2)),
    ]
    const before = pairs(bodies)
    const report = separateMMDArmCollisions(bodies, bones, ARMS, modelOf({ bones: [3], pinched: false }))

    expect(report).toMatchObject({ status: 'applied', groups: [1], garmentBodies: 1, skippedBodies: 0 })
    expect(bodies[3].collisionGroup).toBe(4)
    expect(bodies[2].collisionGroup).toBe(2)
    // The forearm gains the skirt and still passes its sleeve; the hair that ignored the skirt's group still ignores it.
    expect([...pairs(bodies)].sort()).toEqual([...before, '1-3'].sort())
  })

  it('keeps apart the arm bodies their author put in different groups', () => {
    const bodies = [
      // The upper arm collides with the skirt and the hair; the forearm collides with neither, and the two arm bodies
      // do not collide with each other.
      body(1, FOLLOW, 0, 0b1101),
      body(2, FOLLOW, 1, 0b1010),
      body(3, SIMULATED, 2, 0b0001),
      body(7, SIMULATED, 3, 0b0001),
    ]
    const before = pairs(bodies)
    const report = separateMMDArmCollisions(bodies, bones, ARMS, modelOf({ bones: [3], pinched: false }))

    expect(report).toMatchObject({ status: 'applied', groups: [4, 5], armBodies: 2, garmentBodies: 1 })
    expect([bodies[0].collisionGroup, bodies[1].collisionGroup]).toEqual([4, 5])
    // Only the forearm and the skirt gain a pair: the arm bodies still pass each other, and the forearm the hair.
    expect([...pairs(bodies)].sort()).toEqual([...before, '1-2'].sort())
  })

  it('leaves a rig alone when its arm groups outnumber the unused groups', () => {
    const bodies = [body(1, FOLLOW, 0, ALL), body(2, FOLLOW, 1, ALL), body(3, SIMULATED, 2, ALL), ...Array.from({ length: 12 }, (_, i) => body(7, SIMULATED, i + 3, ALL))]
    const authored = bodies.map(entry => ({ ...entry }))
    expect(separateMMDArmCollisions(bodies, bones, ARMS, modelOf({ bones: [3], pinched: false }))).toMatchObject({ status: 'no-free-group', groups: [] })
    expect(bodies).toEqual(authored)
  })

  it('reports a rig without a bone-following arm body, and one without an unused group, and leaves both alone', () => {
    const armless = [body(3, SIMULATED, 2, ALL), body(7, FOLLOW, 0, ALL)]
    expect(separateMMDArmCollisions(armless, bones, ARMS, modelOf({ bones: [3], pinched: false }))).toMatchObject({ status: 'no-arm-bodies', armBodies: 0 })

    const crowded = [body(1, FOLLOW, 0, ALL), body(3, SIMULATED, 2, ALL), ...Array.from({ length: 16 }, (_, group) => body(7, SIMULATED, group, ALL))]
    const authored = crowded.map(entry => ({ ...entry }))
    expect(separateMMDArmCollisions(crowded, bones, ARMS, modelOf({ bones: [3], pinched: false }))).toEqual({ status: 'no-free-group', groups: [], armBodies: 1, garmentBodies: 0, skippedBodies: 1 })
    expect(crowded).toEqual(authored)
  })
})

describe('prepareMMDSecondaryMotion', () => {
  it('prepares a model once and keeps its report', () => {
    const { mmd } = bodyFixture(0, Math.PI, { bodies: true, skin: true })
    expect(readMMDArmCollisionReport(mmd)).toBeNull()
    const report = prepareMMDSecondaryMotion(mmd)
    // The fixture has no rigid body on an arm.
    expect(report.status).toBe('no-arm-bodies')
    expect(prepareMMDSecondaryMotion(mmd)).toBe(report)
    expect(readMMDArmCollisionReport(mmd)).toBe(report)
  })

  it('shows its status in the diagnostics of a body that was built before it ran, as the scene builds it', () => {
    const { mmd, body, pipeline } = bodyFixture(0, Math.PI, { arms: true, bodies: true, skin: true })
    pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.bodyModel?.armCollisions).toBeNull()
    const report = prepareMMDSecondaryMotion(mmd)
    pipeline.step(1 / 60)
    expect(body.diagnostics.arms?.bodyModel?.armCollisions).toBe(report.status)
  })
})
