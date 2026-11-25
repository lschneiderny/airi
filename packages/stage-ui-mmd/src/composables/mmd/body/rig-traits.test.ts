import type { BodyCollider } from '@proj-airi/motion-driver-humanoid/performance'

import { describe, expect, it } from 'vitest'

import { buildMMDHeadColliders } from '../touch/colliders'
import { bodyFixture } from './fixture'
import { buildBodyRigTraits } from './rig-traits'

const degrees = Math.PI / 180
const defaultRest = { left: { abduct: 12 * degrees, limit: null }, right: { abduct: 12 * degrees, limit: null } }

describe('buildBodyRigTraits', () => {
  it('hands the body model\'s volumes and each arm\'s rest abduction to the performer unchanged, with the leg IK joints that pose its leg volumes', () => {
    const { mmd, rig } = bodyFixture()
    const { skeleton, bindMatrix } = mmd.mesh
    const volumes: BodyCollider[] = [
      { bone: 'spine0', shape: 'capsule', radius: 0.8, length: 0.6, centre: { x: 0, y: 1, z: 0 }, rotation: { yaw: 0, pitch: 0, roll: Math.PI / 2 } },
      { bone: 'hips', shape: 'capsule', radius: 0.6, length: 5, centre: { x: 1, y: -2.5, z: 0 }, rotation: { yaw: 0, pitch: 0, roll: 0 }, leg: { side: 'left', segment: 'thigh' } },
    ]
    const traits = buildBodyRigTraits(mmd.pmx, rig, { volumes, rest: { left: { abduct: 19 * degrees, limit: null }, right: { abduct: 14 * degrees, limit: null } } }, [], { boneInverses: skeleton.boneInverses, bindMatrix })

    expect(traits?.colliders).toEqual(volumes)
    expect(traits?.colliders[1]).toBe(volumes[1])
    expect(traits?.arms.left.restAbduct).toBe(19 * degrees)
    expect(traits?.arms.right.restAbduct).toBe(14 * degrees)
    expect(traits?.legs?.left).toEqual({ hip: { x: 1, y: 11, z: 0 }, knee: { x: 1, y: 6, z: -0.1 }, ankle: { x: 1, y: 1, z: 0 } })
    expect(traits?.arms.left.shoulder).toEqual({ x: 1.5, y: 16, z: 0 })
  })

  it('puts the author\'s head and neck bodies after the model\'s volumes, each on its nearest canonical bone', () => {
    const { mmd, rig } = bodyFixture(0, Math.PI, {
      bodies: true,
      extraBodies: [
        { name: 'throat', bone: '首', position: [0, 17.5, 0.2], radius: 0.4, collisionMask: 65535 },
        { name: 'skull', bone: '頭', position: [0.1, 19, 0], radius: 0.7, collisionMask: 65535 },
      ],
    })
    const { skeleton, bindMatrix } = mmd.mesh
    const head = buildMMDHeadColliders(mmd.pmx, skeleton.boneInverses, bindMatrix, rig)
    // The author's torso capsule, hip box and simulated skirt stay out.
    expect(head.map(collider => collider.name)).toEqual(['throat', 'skull'])
    const volumes: BodyCollider[] = [{ bone: 'spine0', shape: 'capsule', radius: 0.8, length: 0.6, centre: { x: 0, y: 1, z: 0 }, rotation: { yaw: 0, pitch: 0, roll: Math.PI / 2 } }]
    const traits = buildBodyRigTraits(mmd.pmx, rig, { volumes, rest: defaultRest }, head, { boneInverses: skeleton.boneInverses, bindMatrix })

    expect(traits?.colliders).toHaveLength(3)
    expect(traits?.colliders[0]).toBe(volumes[0])
    // The neck bone sits at 17 and the head bone at 18 in this fixture; a body's centre is relative to its bone.
    expect(traits?.colliders[1]).toMatchObject({ bone: 'neck', shape: 'sphere', radius: 0.4, centre: { x: expect.closeTo(0, 9), y: expect.closeTo(0.5, 9), z: expect.closeTo(0.2, 9) } })
    expect(traits?.colliders[2]).toMatchObject({ bone: 'head', shape: 'sphere', radius: 0.7, centre: { x: expect.closeTo(0.1, 9), y: expect.closeTo(1, 9), z: expect.closeTo(0, 9) } })
  })

  it('returns null for a rig without arms', () => {
    const { mmd, rig } = bodyFixture(0, Math.PI, { arms: false })
    const { skeleton, bindMatrix } = mmd.mesh
    expect(buildBodyRigTraits(mmd.pmx, rig, { volumes: [], rest: defaultRest }, [], { boneInverses: skeleton.boneInverses, bindMatrix })).toBeNull()
  })
})
