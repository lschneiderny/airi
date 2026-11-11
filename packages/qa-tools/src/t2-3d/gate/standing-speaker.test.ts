import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseBands } from './load'
import { reportStandingSpeaker, STANDING_SPEAKER } from './policy'

const repoRoot = resolve(import.meta.dirname, '../../../../..')
// Version 2 is the last file fitted with every talk clip band gated, so it is the input the rule was stated against.
const v2 = parseBands(JSON.parse(await readFile(resolve(repoRoot, 'packages/qa-tools/fixtures/motion3d/bands-v2.json'), 'utf8')))

describe('standing-speaker talk reports', () => {
  it('reports exactly the talk bands fitted per clip from the talk window clips', () => {
    const talk = v2.classes.talk
    if (!talk)
      throw new TypeError('bands-v2.json has no talk class')
    const reported = reportStandingSpeaker('talk', talk)
    const changed = Object.keys(talk.metrics).filter(id => reported.metrics[id] !== talk.metrics[id])
    expect(changed.sort()).toEqual([
      'bilateral.hand.peakCorr',
      'bilateral.lowerArm.peakCorr',
      'bilateral.upperArm.peakCorr',
      'chain.chest-neck.zeroLagCorr',
      'chain.leftLowerArm-leftHand.zeroLagCorr',
      'chain.leftUpperArm-leftLowerArm.zeroLagCorr',
      'chain.neck-head.zeroLagCorr',
      'chain.rightLowerArm-rightHand.zeroLagCorr',
      'chain.rightUpperArm-rightLowerArm.zeroLagCorr',
      'chain.spine-chest.zeroLagCorr',
      'coverage.arms',
      'coverage.core',
      'dim.core',
      'dim.upper',
      'inter.speedCv',
      'smooth.armL.spikeRate',
      'smooth.armR.spikeRate',
      'smooth.head.spikeRate',
    ])
    for (const id of changed)
      expect(reported.metrics[id], id).toEqual({ ...talk.metrics[id], status: 'REPORT', detail: STANDING_SPEAKER.reason })
    expect(reported.holdout).toBe(talk.holdout)
    expect(reported.floors).toBe(talk.floors)
  })

  it('leaves every other class unchanged', () => {
    for (const scenario of ['idle', 'walk', 'gaze', 'emotion', 'react'] as const) {
      const c = v2.classes[scenario]
      if (c)
        expect(reportStandingSpeaker(scenario, c), scenario).toBe(c)
    }
  })
})
