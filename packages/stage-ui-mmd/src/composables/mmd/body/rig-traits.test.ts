import type { MMDTouchCollider } from '../touch/colliders'

import { PmxObject } from '@moeru/three-mmd'
import { Matrix4 } from 'three'
import { describe, expect, it } from 'vitest'

import { buildMMDArmTestColliders } from '../touch/colliders'
import { bodyFixture } from './fixture'
import { buildBodyRigTraits } from './rig-traits'

describe('buildBodyRigTraits', () => {
  it('ties a body on a leg bone, or on a deform bone that copies a leg bone, to that leg segment', () => {
    const { mmd, rig } = bodyFixture(0, Math.PI, {
      bodies: true,
      extraBodies: [
        { name: 'thigh', bone: '左足', position: [1, 8, 0], radius: 0.6, collisionMask: 65535 },
        { name: 'shin', bone: '右ひざ', position: [-1, 3, 0], radius: 0.5, collisionMask: 65535 },
      ],
    })
    const { skeleton, bindMatrix } = mmd.mesh
    const rightLeg = mmd.pmx.bones.findIndex(bone => bone.name === '右足')
    const hips = mmd.pmx.bones.findIndex(bone => bone.name === '下半身')
    // A PMX deform bone: a child of the hips that copies the whole rotation of 右足 through an append transform.
    const deform = { ...mmd.pmx.bones[rightLeg], name: '右足D', parentBoneIndex: hips, ik: undefined, flag: PmxObject.Bone.Flag.HasAppendRotate, appendTransform: { parentIndex: rightLeg, ratio: 1 } }
    const pmx = { ...mmd.pmx, bones: [...mmd.pmx.bones, deform] }
    const onDeform: MMDTouchCollider = { name: 'deform', boneIndex: pmx.bones.length - 1, region: 'body', shape: 'sphere', size: [0.5, 0, 0], offset: new Matrix4() }
    const colliders = [...buildMMDArmTestColliders(mmd.pmx, skeleton.boneInverses, bindMatrix, rig).kinematic, onDeform]
    const traits = buildBodyRigTraits(pmx, rig, colliders, { boneInverses: [...skeleton.boneInverses, new Matrix4()], bindMatrix })

    expect(traits?.legs?.left.hip).toEqual({ x: 1, y: 11, z: 0 })
    const legOf = (name: string) => traits?.colliders[colliders.findIndex(collider => collider.name === name)]
    expect(legOf('thigh')).toMatchObject({ bone: 'hips', leg: { side: 'left', segment: 'thigh' } })
    expect(legOf('shin')).toMatchObject({ bone: 'hips', leg: { side: 'right', segment: 'shin' } })
    expect(legOf('deform')).toMatchObject({ bone: 'hips', leg: { side: 'right', segment: 'thigh' } })
    expect(legOf('hip')?.leg).toBeUndefined()
    expect(legOf('torso')?.leg).toBeUndefined()
  })
})
