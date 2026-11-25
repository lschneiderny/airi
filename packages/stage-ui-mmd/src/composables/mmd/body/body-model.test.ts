import { PmxObject } from '@moeru/three-mmd'
import { Vector3 } from 'three'
import { describe, expect, it } from 'vitest'

import { mmdTouchColliderCenter } from '../touch/colliders'
import { buildMMDBodyMeshSource, mmdJointMobility, readMMDBodyModel } from './body-model'
import { bodyFixture } from './fixture'

const vec3 = (x: number, y: number, z: number): [number, number, number] => [x, y, z]

function joint(a: number, b: number, position: [number, number, number], rotation: [number, number, number], rotationMin?: [number, number, number]) {
  return { rigidbodyIndexA: a, rigidbodyIndexB: b, position, rotationMin: rotationMin ?? vec3(-rotation[0], -rotation[1], -rotation[2]), rotationMax: rotation, positionMin: vec3(0, 0, 0), positionMax: vec3(0, 0, 0) }
}

describe('mmdJointMobility', () => {
  const bones = ['root', 'a', 'b', 'c', 'd'].map((name, index) => ({ name, parentBoneIndex: index - 1, position: vec3(0, 0, 0) }))
  const bodyOn = (boneIndex: number, physicsMode: number, y: number) => ({ boneIndex, physicsMode, shapePosition: vec3(0, y, 0) })

  it('sums each joint\'s rotation limit times its distance to the body along the chain to a bone-following body', () => {
    const mobility = mmdJointMobility({
      bones,
      rigidBodies: [bodyOn(0, 0, 10), bodyOn(1, 1, 9), bodyOn(2, 1, 7)],
      joints: [joint(0, 1, [0, 10, 0], [0.1, 0, 0]), joint(1, 2, [0, 8, 0], [0, 0, 0.2])],
    })
    expect(mobility.get(1)).toBeCloseTo(0.1 * 1, 9)
    expect(mobility.get(2)).toBeCloseTo(0.1 * 3 + 0.2 * 1, 9)
    expect(mobility.has(0)).toBe(false)
  })

  it('takes the path that allows the least, treats an axis whose minimum exceeds its maximum as free, and leaves an untied body unbounded', () => {
    const mobility = mmdJointMobility({
      bones,
      rigidBodies: [bodyOn(0, 0, 10), bodyOn(1, 1, 9), bodyOn(2, 1, 9), bodyOn(3, 1, 5)],
      // Body 1 hangs by a free joint and is also tied to the bone-following body through body 2, by 0.1 and 0.2 rad.
      joints: [joint(0, 1, [0, 10, 0], [0, 0, 0], [1, 0, 0]), joint(0, 2, [0, 10, 0], [0.1, 0, 0]), joint(2, 1, [0, 10, 0], [0.2, 0, 0])],
    })
    expect(mobility.get(1)).toBeCloseTo(0.2 + 0.1, 9)
    expect(mobility.get(3)).toBe(Infinity)
  })

  it('reads the fixture\'s hair pendulum', () => {
    // Limits of 1 rad about X and Z, 1 unit from the body's centre.
    expect(mmdJointMobility(bodyFixture(0, Math.PI, { hair: true }).mmd.pmx).get(18)).toBeCloseTo(Math.SQRT2, 6)
  })
})

describe('buildMMDBodyMeshSource', () => {
  it('reads the mesh, the canonical bones and the simulated bones of a rig', () => {
    const { mmd, rig } = bodyFixture(0, Math.PI, { hair: true, skin: true })
    const source = buildMMDBodyMeshSource(mmd.pmx, mmd.mesh, rig)
    const index = (name: string) => mmd.pmx.bones.findIndex(bone => bone.name === name)

    expect(source?.canonical).toEqual({
      hips: index('下半身'),
      spine: [index('上半身'), index('上半身2')],
      neck: index('首'),
      head: index('頭'),
      arms: {
        left: { clavicle: index('左肩'), upper: index('左腕'), lower: index('左ひじ'), hand: index('左手首') },
        right: { clavicle: index('右肩'), upper: index('右腕'), lower: index('右ひじ'), hand: index('右手首') },
      },
      legs: {
        left: { upper: index('左足'), lower: index('左ひざ'), foot: index('左足首') },
        right: { upper: index('右足'), lower: index('右ひざ'), foot: index('右足首') },
      },
    })
    expect(source?.bones[index('左腕')]).toEqual({ parent: index('左肩'), position: { x: 1.5, y: 16, z: 0 } })
    expect(source?.simulated.map(entry => entry.bone)).toEqual([index('髪')])
    const count = mmd.mesh.geometry.getAttribute('position').count
    expect(count).toBeGreaterThan(0)
    expect(source?.positions.length).toBe(count * 3)
    expect(source?.skinIndices.length).toBe(count * 4)
  })

  it('reads the triangles from the geometry\'s index, and one for every three vertices of a geometry without one', () => {
    const { mmd, rig } = bodyFixture(0, Math.PI, { skin: true })
    const count = mmd.mesh.geometry.getAttribute('position').count
    expect(Array.from(buildMMDBodyMeshSource(mmd.pmx, mmd.mesh, rig)?.triangles ?? [])).toEqual(Array.from({ length: count - count % 3 }, (_, corner) => corner))
    mmd.mesh.geometry.setIndex([0, 1, 24, 1, 25, 24])
    expect(Array.from(buildMMDBodyMeshSource(mmd.pmx, mmd.mesh, rig)?.triangles ?? [])).toEqual([0, 1, 24, 1, 25, 24])
  })

  it('marks the simulated bones whose bodies the collision groups let touch a body that follows an arm', () => {
    const arm = { name: 'forearm', bone: '左ひじ', position: vec3(3, 14, 0), radius: 0.3, collisionMask: 0xFFFF }
    const { mmd, rig } = bodyFixture(0, Math.PI, { bodies: true, extraBodies: [arm] })
    const skirt = mmd.pmx.bones.findIndex(bone => bone.name === 'スカート')
    const flags = (pmx: typeof mmd.pmx) => buildMMDBodyMeshSource(pmx, mmd.mesh, rig)?.simulated.map(entry => [entry.bone, entry.collidesWithArm])

    expect(flags(mmd.pmx)).toEqual([[skirt, true]])
    // The arm body's mask leaves the skirt's group out: Ammo collides a pair only when each mask holds the other's group.
    const apart = mmd.pmx.rigidBodies.map(body => body.name === 'forearm' ? { ...body, collisionMask: 0xFFFE } : body)
    expect(flags({ ...mmd.pmx, rigidBodies: apart })).toEqual([[skirt, false]])
    // A simulated body on the arm (a sleeve) is not a body that follows the arm.
    const sleeve = mmd.pmx.rigidBodies.map(body => body.name === 'forearm' ? { ...body, physicsMode: PmxObject.RigidBody.PhysicsMode.Physics } : body)
    expect(flags({ ...mmd.pmx, rigidBodies: sleeve })?.find(([bone]) => bone === skirt)).toEqual([skirt, false])
  })

  it('lets a deform bone move with the leg bone whose rotation it copies in full', () => {
    const { mmd, rig } = bodyFixture()
    const rightLeg = mmd.pmx.bones.findIndex(bone => bone.name === '右足')
    const hips = mmd.pmx.bones.findIndex(bone => bone.name === '下半身')
    // A PMX deform bone: a child of the hips that copies the whole rotation of 右足 through an append transform.
    const deform = { ...mmd.pmx.bones[rightLeg], name: '右足D', parentBoneIndex: hips, ik: undefined, flag: PmxObject.Bone.Flag.HasAppendRotate, appendTransform: { parentIndex: rightLeg, ratio: 1 } }
    const half = { ...deform, name: '右足half', appendTransform: { parentIndex: rightLeg, ratio: 0.5 } }
    const source = buildMMDBodyMeshSource({ ...mmd.pmx, bones: [...mmd.pmx.bones, deform, half] }, mmd.mesh, rig)

    expect(source?.bones.at(-2)?.parent).toBe(rightLeg)
    expect(source?.bones.at(-1)?.parent).toBe(hips)
  })

  it('keeps the skinned torso without leg bones and refuses a rig missing only one arm', () => {
    const { mmd, rig } = bodyFixture(0, Math.PI, { arms: true, skin: true })
    const legless = {
      ...rig,
      bones: { ...rig.bones, leftUpperLeg: undefined, leftLowerLeg: undefined, leftFoot: undefined, rightUpperLeg: undefined, rightLowerLeg: undefined, rightFoot: undefined },
    }
    const source = buildMMDBodyMeshSource(mmd.pmx, mmd.mesh, legless)
    expect(source?.canonical.legs).toBeNull()
    expect(source?.simulated).toEqual([])
    expect(readMMDBodyModel({ pmx: mmd.pmx, mesh: mmd.mesh }, legless)?.model.volumes.some(volume => volume.bone === 'spine0')).toBe(true)

    const oneArm = { ...rig, bones: { ...rig.bones, rightUpperArm: undefined } }
    expect(buildMMDBodyMeshSource(mmd.pmx, mmd.mesh, oneArm)).toBeNull()
  })

  it('returns null for a rig without arms, and a source without vertices for a mesh without skin', () => {
    const armless = bodyFixture(0, Math.PI, { arms: false })
    expect(buildMMDBodyMeshSource(armless.mmd.pmx, armless.mmd.mesh, armless.rig)).toBeNull()
    const bare = bodyFixture()
    expect(buildMMDBodyMeshSource(bare.mmd.pmx, bare.mmd.mesh, bare.rig)?.positions.length).toBe(0)
  })
})

describe('readMMDBodyModel', () => {
  it('builds the model once a model and poses each volume with the bone it follows', () => {
    const { mmd, rig, bone } = bodyFixture(0, Math.PI, { skin: [{ bone: '左足', fromY: 6.4, toY: 10.6, halfWidth: 0.6, halfDepth: 0.6, x: 1 }] })
    const built = readMMDBodyModel(mmd, rig)
    expect(readMMDBodyModel(mmd, rig)).toBe(built)
    if (!built)
      throw new TypeError('The fixture rig must yield a body model')
    const { model, colliders, source } = built
    expect(colliders).toHaveLength(model.volumes.length)

    const index = (name: string) => mmd.pmx.bones.findIndex(entry => entry.name === name)
    const followed = { hips: index('下半身'), spine0: index('上半身'), spine1: index('上半身2'), spine2: -1, spine3: -1, neck: index('首'), head: index('頭') }
    mmd.mesh.updateMatrixWorld(true)
    model.volumes.forEach((volume, at) => {
      const collider = colliders[at]
      expect(collider.boneIndex).toBe(volume.leg ? index('左足') : followed[volume.bone])
      expect(collider.region).toBe(volume.bone === 'head' || volume.bone === 'neck' ? 'head' : 'body')
      // In the bind pose the collider sits where the volume does: its canonical bone's bind position plus its centre.
      const anchor = source.bones[followed[volume.bone]].position
      const centre = mmdTouchColliderCenter(collider, mmd.mesh.skeleton.bones[collider.boneIndex].matrixWorld, new Vector3())
      expect(centre.x).toBeCloseTo(anchor.x + volume.centre.x, 5)
      expect(centre.y).toBeCloseTo(anchor.y + volume.centre.y, 5)
      expect(centre.z).toBeCloseTo(anchor.z + volume.centre.z, 5)
    })
    const thigh = model.volumes.findIndex(volume => volume.leg)
    expect(model.volumes[thigh].leg).toEqual({ side: 'left', segment: 'thigh' })
    expect(colliders[thigh].shape).toBe('capsule')

    // A leg volume turns with its leg bone, not with the hips it is anchored to.
    const before = mmdTouchColliderCenter(colliders[thigh], bone('左足').matrixWorld, new Vector3())
    bone('左足').rotateX(0.5)
    mmd.mesh.updateMatrixWorld(true)
    expect(mmdTouchColliderCenter(colliders[thigh], bone('左足').matrixWorld, new Vector3()).distanceTo(before)).toBeGreaterThan(0.5)
  })

  it('gives a rig without a skinned surface no volumes, so the performer keeps its proportional proxies', () => {
    const { mmd, rig, body } = bodyFixture()
    expect(readMMDBodyModel(mmd, rig)?.model.volumes).toEqual([])
    expect(body.traits?.colliders).toEqual([])
  })
})
