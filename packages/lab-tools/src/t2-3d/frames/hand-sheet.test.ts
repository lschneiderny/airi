import type { HandShape } from '@proj-airi/motion-driver-humanoid/performance'

import { BODY_CHANNELS, channelIndex, HAND_SHAPES, limitChannel } from '@proj-airi/motion-driver-humanoid/performance'
import { describe, expect, it } from 'vitest'

import { HAND_SHEET_CELLS, handSheetChannels } from './hand-sheet'

const DEG = Math.PI / 180
/** A rest pose whose every channel differs, so a channel the sheet should leave alone cannot pass by chance. */
const REST = Float32Array.from(BODY_CHANNELS, (_, i) => (i + 1) * 0.001)
function cell(name: string) {
  const found = HAND_SHEET_CELLS.find(c => c.name === name)
  if (!found)
    throw new Error(`no cell ${name}`)
  return found
}
const changedAt = (a: Float32Array, b: Float32Array) => BODY_CHANNELS.flatMap((_, i) => a[i] === b[i] ? [] : [i])
const changed = (a: Float32Array, b: Float32Array) => changedAt(a, b).map(i => BODY_CHANNELS[i])

describe('hand sheet', () => {
  it('has a cell for every hand shape, and keeps the rest cell exactly at rest', () => {
    for (const shape of Object.keys(HAND_SHAPES) as HandShape[])
      expect(cell(shape).shape).toBe(shape)
    expect(handSheetChannels(REST, cell('rest'))).toEqual(REST)
  })

  it('writes a shape and a neutral wrist into both hands and leaves the arms, legs and trunk at rest', () => {
    const fist = handSheetChannels(REST, cell('fist'))
    // Only the wrist and hand channels move: from each side's Pron to its Opposition.
    const inHand = (i: number) => (['left', 'right'] as const).some(side => i >= channelIndex(`${side}Pron`) && i <= channelIndex(`${side}Opposition`))
    expect(changedAt(REST, fist).every(inHand)).toBe(true)
    for (const side of ['left', 'right'] as const) {
      expect(fist[channelIndex(`${side}Index1`)]).toBeCloseTo(limitChannel(channelIndex(`${side}Index1`), HAND_SHAPES.fist.fingers[0][1] * DEG), 6)
      expect(fist[channelIndex(`${side}Wflex`)]).toBe(0)
      expect(fist[channelIndex(`${side}Elbow`)]).toBe(REST[channelIndex(`${side}Elbow`)])
    }
  })

  it('moves only one wrist channel per side from the relaxed hand in each wrist cell', () => {
    const relaxed = handSheetChannels(REST, cell('relaxed'))
    for (const [name, channel] of [['wrist-flexed', 'Wflex'], ['wrist-extended', 'Wflex'], ['deviated-ulnar', 'Wdev'], ['deviated-radial', 'Wdev'], ['pronated', 'Pron'], ['supinated', 'Pron']] as const)
      expect(changed(relaxed, handSheetChannels(REST, cell(name)))).toEqual([`left${channel}`, `right${channel}`])
    expect(handSheetChannels(REST, cell('wrist-flexed'))[channelIndex('leftWflex')]).toBeGreaterThan(0)
    expect(handSheetChannels(REST, cell('pronated'))[channelIndex('rightPron')]).toBeGreaterThan(0)
  })

  it('puts a blend cell halfway between its two shapes', () => {
    const [relaxed, fist, half] = ['relaxed', 'fist', 'relaxed-to-fist'].map(name => handSheetChannels(REST, cell(name)))
    for (const channel of ['leftIndex1', 'rightOpposition'] as const) {
      const i = channelIndex(channel)
      expect(half[i]).toBeCloseTo((relaxed[i] + fist[i]) / 2, 6)
    }
  })

  it('closes the walking hand further under the angry fist, inside the joint limits', () => {
    const [closed, angry] = ['walk-closed', 'walk-angry'].map(name => handSheetChannels(REST, cell(name)))
    expect(changed(REST, closed).every(name => /Thumb|Index|Middle|Ring|Little|Opposition/.test(name))).toBe(true)
    const i = channelIndex('rightMiddle1')
    expect(angry[i]).toBeGreaterThan(closed[i])
    expect(angry[i]).toBeLessThanOrEqual(limitChannel(i, Infinity))
  })
})
