import type { PhysicsRigLike } from './rig-profile'

import { describe, expect, it } from 'vitest'

import { readLive2DRigProfile, resolveCheekParameterId } from './rig-profile'

function parameters(ids: string[] = []) {
  return {
    ids,
    minimumValues: new Float32Array(ids.map(() => -8)),
    maximumValues: new Float32Array(ids.map(() => 22)),
    defaultValues: new Float32Array(ids.map(() => 2)),
  }
}

function rig(links: [string, string, number?][]): PhysicsRigLike {
  return {
    settings: links.map((_, index) => ({ baseInputIndex: index, inputCount: 1, baseOutputIndex: index, outputCount: 1 })),
    inputs: links.map(([id]) => ({ source: { id } })),
    outputs: links.map(([, id, weight]) => ({ destination: { id }, weight })),
  }
}

describe('rig profile', () => {
  it.each(['ParamCheek2', 'Param_Blush', 'hoppe'])('resolves the conventional blush alias %s', (id) => {
    expect(readLive2DRigProfile(parameters([id]), undefined).channels.get('cheek')?.id).toBe(id)
  })

  it('resolves a blush display name without mistaking cheek inflation for blush', () => {
    const input = parameters(['cheekpuff', 'CustomBlush'])
    const displayInfo = { Parameters: [{ Id: 'cheekpuff', Name: 'Cheek Puff' }, { Id: 'CustomBlush', Name: '\u8138\u7EA2' }] }
    expect(readLive2DRigProfile(input, undefined, displayInfo).channels.get('cheek'))
      .toEqual({ id: 'CustomBlush', index: 1, min: -8, max: 22, neutral: 2 })
    expect(resolveCheekParameterId(['cheekpuff'])).toBeUndefined()
    expect(resolveCheekParameterId(['Other'], displayInfo)).toBeUndefined()
  })

  it('prefers the standard blush parameter over aliases and ignores invalid metadata', () => {
    expect(resolveCheekParameterId(['Param_Blush', 'ParamCheek'])).toBe('ParamCheek')
    for (const displayInfo of [null, {}, { Parameters: {} }, { Parameters: [null, { Id: 1, Name: 'Blush' }] }])
      expect(resolveCheekParameterId(['Other'], displayInfo)).toBeUndefined()
  })

  it('a: detects Bear-like body ownership from head inputs', () => {
    const profile = readLive2DRigProfile(parameters(), rig([['ParamAngleX', 'ParamBodyAngleX', 100]]))
    expect(profile.bodyFromHeadPhysics).toEqual({ x: true, y: false, z: false })
    expect(profile.physicsOutputs).toEqual(new Set(['ParamBodyAngleX']))
  })

  it('b: follows transitive links and terminates on self-loops and cycles', () => {
    const profile = readLive2DRigProfile(parameters(), rig([
      ['P1', 'ParamBodyAngleY'],
      ['ParamAngleY', 'P1'],
      ['P1', 'P1'],
      ['P1', 'ParamAngleY'],
    ]))
    expect(profile.bodyFromHeadPhysics).toEqual({ x: false, y: true, z: false })
  })

  it('c: ignores zero-weight outputs including transitive paths', () => {
    const profile = readLive2DRigProfile(parameters(), rig([
      ['ParamAngleX', 'ParamBodyAngleX', 0],
      ['ParamAngleY', 'P1', 0],
      ['P1', 'ParamBodyAngleY', 25],
    ]))
    expect(profile.physicsOutputs).toEqual(new Set(['ParamBodyAngleY']))
    expect(profile.bodyFromHeadPhysics).toEqual({ x: false, y: false, z: false })
  })

  it('d: preserves ForBOOTH suffixed outputs without claiming standard body axes', () => {
    const profile = readLive2DRigProfile(parameters(), rig([
      ['ParamAngleX', 'ParamAngleX2'],
      ['ParamAngleZ', 'ParamBodyAngleZ2'],
    ]))
    expect(profile.physicsOutputs).toEqual(new Set(['ParamAngleX2', 'ParamBodyAngleZ2']))
    expect(profile.bodyFromHeadPhysics).toEqual({ x: false, y: false, z: false })
  })

  it('e: handles absent physics and malformed setting bounds', () => {
    const empty = readLive2DRigProfile(parameters(), undefined)
    expect(empty.physicsOutputs.size).toBe(0)
    expect(empty.bodyFromHeadPhysics).toEqual({ x: false, y: false, z: false })
    for (const bounds of [{ baseInputIndex: 99 }, { inputCount: 99 }, { inputCount: Number.POSITIVE_INFINITY }, { baseOutputIndex: -1 }, { outputCount: 99 }]) {
      const malformed = rig([['ParamAngleX', 'ParamBodyAngleX']])
      Object.assign(malformed.settings[0], bounds)
      expect(readLive2DRigProfile(parameters(), malformed).bodyFromHeadPhysics).toEqual(empty.bodyFromHeadPhysics)
    }
  })

  it('f: skips missing and fixed channels while retaining indices and asymmetric ranges', () => {
    const input = parameters(['Unknown', 'ParamAngleX', 'ParamBreath', 'ParamMouthOpenY'])
    input.maximumValues[2] = input.minimumValues[2]
    const profile = readLive2DRigProfile(input, undefined)
    expect([...profile.channels.keys()]).toEqual(['headX', 'mouthOpen'])
    expect(profile.channels.get('headX')).toEqual({ id: 'ParamAngleX', index: 1, min: -8, max: 22, neutral: 2 })
    expect(profile.channels.get('mouthOpen')?.index).toBe(3)
  })
})
