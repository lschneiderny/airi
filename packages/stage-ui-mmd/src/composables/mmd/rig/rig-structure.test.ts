import type { MMDRigSource } from './rig-profile'

import { describe, expect, it } from 'vitest'

import { readMMDRigProfile } from './rig-profile'
import { carlottaRig, ellenRig, toPmxRigSource, vivianRig } from './rig-profile.fixtures'

function extendedSource() {
  const source = structuredClone(toPmxRigSource(ellenRig))
  const parent = (name: string) => source.bones.findIndex(bone => bone.name === name)
  const axis: [number, number, number] = [0.8, -0.6, 0]
  const extraBones: MMDRigSource['bones'] = [
    { name: '左足先EX', position: [1.2, 0.2, 1], parentBoneIndex: parent('左足首'), ik: undefined },
    { name: '右足先EX', position: [-1.2, 0.2, 1], parentBoneIndex: parent('右足首'), ik: undefined },
    { name: '左人指１', position: [5.2, 11.6, -0.3], parentBoneIndex: parent('左手首'), ik: undefined },
    { name: '右人指１', position: [-5.2, 11.6, -0.3], parentBoneIndex: parent('右手首'), ik: undefined },
  ]
  return {
    ...source,
    bones: [
      ...source.bones.map(bone => ({ ...bone, axisLimit: bone.name === '左腕捩' ? axis : undefined })),
      ...extraBones,
    ],
  }
}

describe('readMMDRigProfile structural facts', () => {
  it.each([
    ['Ellen', ellenRig, ['上半身', '上半身1', '上半身2']],
    ['Vivian', vivianRig, ['上半身', '上半身1', '上半身2']],
    ['Carlotta', carlottaRig, ['上半身', '上半身3', '上半身2']],
  ] as const)('orders %s spine bones by hierarchy and copies their bind positions', (_name, fixture, names) => {
    const source = toPmxRigSource(fixture)
    const profile = readMMDRigProfile(source)

    expect(profile.spineChain).toEqual(names.map(name => ({
      name,
      position: fixture.bones.find(bone => bone.name === name)?.position,
    })))
    expect(profile.structure.intermediateSpine).toBe(true)
  })

  it('reports only the remaining spine bone on a one-bone torso', () => {
    const source = toPmxRigSource(ellenRig)
    const spine = source.bones.findIndex(bone => bone.name === '上半身')
    const profile = readMMDRigProfile({
      ...source,
      bones: source.bones.map(bone => ({
        ...bone,
        name: ['上半身1', '上半身2'].includes(bone.name) ? `unmapped-${bone.name}` : bone.name,
        parentBoneIndex: bone.name === '首' ? spine : bone.parentBoneIndex,
      })),
    })

    expect(profile.spineChain.map(bone => bone.name)).toEqual(['上半身'])
    expect(profile.structure.intermediateSpine).toBe(false)
  })

  it('does not infer a chain from disconnected or cyclic torso names', () => {
    const source = toPmxRigSource(ellenRig)
    const chest = source.bones.findIndex(bone => bone.name === '上半身2')
    const disconnected = readMMDRigProfile({
      ...source,
      bones: source.bones.map(bone => bone.name === '首' ? { ...bone, parentBoneIndex: -1 } : bone),
    })
    const cyclic = readMMDRigProfile({
      ...source,
      bones: source.bones.map(bone => bone.name === '上半身1' ? { ...bone, parentBoneIndex: chest } : bone),
    })

    expect(disconnected.spineChain).toEqual([])
    expect(cyclic.spineChain).toEqual([])
  })

  it('distinguishes toe bend bones from toe IK targets and preserves twist axes', () => {
    const profile = readMMDRigProfile(extendedSource())
    const unextended = readMMDRigProfile(toPmxRigSource(ellenRig))

    expect(profile.toeBend).toEqual({ left: '左足先EX', right: '右足先EX' })
    expect(unextended.toeBend).toEqual({ left: null, right: null })
    expect(profile.twist).toEqual({
      left: { arm: { name: '左腕捩', fixedAxis: [0.8, -0.6, 0] }, wrist: { name: '左手捩', fixedAxis: null } },
      right: { arm: { name: '右腕捩', fixedAxis: null }, wrist: { name: '右手捩', fixedAxis: null } },
    })
  })

  it('reports posable bone classes independently on each side', () => {
    const source = extendedSource()
    const removed = ['左肩', '左人指１', '左つま先', '左足先EX', '左目', '右目']
    const profile = readMMDRigProfile({
      ...source,
      bones: source.bones.map(bone => removed.includes(bone.name) ? { ...bone, name: `unmapped-${bone.name}` } : bone),
    })

    expect(profile.structure).toEqual({
      intermediateSpine: true,
      shoulders: { left: false, right: true },
      fingers: { left: false, right: true },
      toes: { left: false, right: true },
      eyes: { left: false, right: false, shared: true },
    })
  })

  it.each([1, 2] as const)('excludes mode %s bones from every new posable field', (physicsMode) => {
    const source = extendedSource()
    const owned = ['上半身1', '左腕捩', '左手捩', '左足先EX', '左肩', '左人指１', '左つま先', '左目', '右目', '両目']
    const profile = readMMDRigProfile({
      ...source,
      rigidBodies: [
        ...source.rigidBodies,
        ...owned.map(name => ({ name, boneIndex: source.bones.findIndex(bone => bone.name === name), physicsMode })),
      ],
    })

    expect(profile.spineChain.map(bone => bone.name)).toEqual(['上半身', '上半身2'])
    expect(profile.toeBend).toEqual({ left: null, right: '右足先EX' })
    expect(profile.twist.left).toEqual({ arm: null, wrist: null })
    expect(profile.structure).toEqual({
      intermediateSpine: false,
      shoulders: { left: false, right: true },
      fingers: { left: false, right: true },
      toes: { left: false, right: true },
      eyes: { left: false, right: false, shared: false },
    })
  })

  it('returns detached plain data for the new profile fields', () => {
    const source = extendedSource()
    const profile = readMMDRigProfile(source)
    const fields = { spineChain: profile.spineChain, toeBend: profile.toeBend, twist: profile.twist, structure: profile.structure }
    const clone = structuredClone(fields)

    expect(clone.spineChain).toHaveLength(3)
    expect(clone).toEqual(fields)
    const spine = source.bones.find(bone => bone.name === '上半身')
    if (spine)
      spine.position[0] = 456
    const twist = source.bones.find(bone => bone.name === '左腕捩')
    if (twist?.axisLimit)
      twist.axisLimit[0] = 789
    expect(fields).toEqual(clone)
  })

  it('reports no structure on an empty skeleton', () => {
    const source: MMDRigSource = { bones: [], rigidBodies: [] }
    const profile = readMMDRigProfile(source)

    expect(profile.spineChain).toEqual([])
    expect(profile.toeBend).toEqual({ left: null, right: null })
    expect(profile.twist).toEqual({ left: { arm: null, wrist: null }, right: { arm: null, wrist: null } })
    expect(profile.structure).toEqual({
      intermediateSpine: false,
      shoulders: { left: false, right: false },
      fingers: { left: false, right: false },
      toes: { left: false, right: false },
      eyes: { left: false, right: false, shared: false },
    })
  })
})
