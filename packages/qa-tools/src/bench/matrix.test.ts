import { describe, expect, it } from 'vitest'

import { BenchUsageError, planLaunches, selectScenarios } from './matrix'

describe('bench matrix', () => {
  it('selects one scenario by id, or the whole matrix without one', () => {
    expect(selectScenarios('mmd-talk').map(scenario => scenario.id)).toEqual(['mmd-talk'])
    expect(selectScenarios(undefined).map(scenario => scenario.id)).toEqual(['mmd-idle', 'mmd-talk', 'live2d-idle'])
  })

  it('refuses an id outside the matrix', () => {
    expect(() => selectScenarios('vrm-idle')).toThrow(BenchUsageError)
  })

  it('reverses the scenario order every other round, so no scenario always launches after the same one', () => {
    const order = planLaunches(selectScenarios(undefined), 3).map(launch => `${launch.scenario.id}#${launch.run}`)

    expect(order).toEqual([
      'mmd-idle#1',
      'mmd-talk#1',
      'live2d-idle#1',
      'live2d-idle#2',
      'mmd-talk#2',
      'mmd-idle#2',
      'mmd-idle#3',
      'mmd-talk#3',
      'live2d-idle#3',
    ])
  })
})
