import { describe, expect, it } from 'vitest'

import { manualControlParameterIds, readLive2DRigProfile } from '../../composables/live2d/natural-motion/rig-profile'
import { findFreeParameters } from './free-parameters'

describe('free expression switches', () => {
  it('excludes expression writes, Natural channels, physics destinations, manual controls and fixed parameters', () => {
    const ids = ['free', 'written', 'ParamEyeBallX', 'physics', ...manualControlParameterIds, 'fixed']
    const parameters = {
      ids,
      minimumValues: ids.map(() => 0),
      maximumValues: ids.map(id => id === 'fixed' ? 0 : 2),
      defaultValues: ids.map(() => 0.5),
    }
    const physics = { settings: [], inputs: [], outputs: [{ destination: { id: 'physics' } }] }
    const profile = readLive2DRigProfile(parameters, physics)
    expect(findFreeParameters({
      parameters,
      exp3Definitions: [{ id: 'expression', parameters: [{ id: 'written', value: 0, blend: 'Add' }] }],
      drivenIds: new Set([...manualControlParameterIds, ...[...profile.channels.values()].map(channel => channel.id), ...physics.outputs.map(output => output.destination.id)]),
      displayNames: new Map([['free', 'Earphones']]),
    })).toEqual([{ id: 'free', name: 'Earphones', min: 0, max: 2, default: 0.5 }])
  })

  it('uses the parameter id when no display name exists and preserves model order', () => {
    expect(findFreeParameters({
      parameters: { ids: ['b', 'a'], minimumValues: [-2, 0], maximumValues: [2, 1], defaultValues: [0, 1] },
      exp3Definitions: [],
      drivenIds: new Set(),
      displayNames: new Map(),
    })).toEqual([
      { id: 'b', name: 'b', min: -2, max: 2, default: 0 },
      { id: 'a', name: 'a', min: 0, max: 1, default: 1 },
    ])
  })
})
