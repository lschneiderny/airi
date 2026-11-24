import { GAIT_STYLE_BOUNDS } from '@proj-airi/motion-driver-humanoid/locomotion'
import { BODY_CHANNELS, channelIndex, DEFAULT_ARM_REST_POSE, HAND_SHAPES } from '@proj-airi/motion-driver-humanoid/performance'
import { describe, expect, it } from 'vitest'

import { writeWalkHand } from './locomotion'

const DEG = Math.PI / 180

function walkHand(handCurl: number) {
  const out = new Float64Array(BODY_CHANNELS.length)
  writeWalkHand(handCurl, 'right', out)
  return out
}

describe('writeWalkHand', () => {
  it('leaves the rest hand at a hand curl of 1', () => {
    expect(walkHand(1).every(v => v === 0)).toBe(true)
  })

  it('reaches the fist, thumb and opposition included, at the top of the walk\'s hand curl', () => {
    const out = walkHand(GAIT_STYLE_BOUNDS.handCurl[1])
    const { fist } = HAND_SHAPES
    const rest = DEFAULT_ARM_REST_POSE
    expect(out[channelIndex('rightMiddle1')]).toBeCloseTo(fist.fingers[1][1] * DEG - rest.fingerCurl[2][1], 9)
    expect(out[channelIndex('rightThumb2')]).toBeCloseTo(fist.thumb[2] * DEG - rest.fingerCurl[0][2], 9)
    expect(out[channelIndex('rightOpposition')]).toBeCloseTo(fist.opposition * DEG - rest.opposition, 9)
    expect(out[channelIndex('leftMiddle1')]).toBe(0)
  })

  it('opens toward the open hand at the bottom, halfway between in the hand\'s closing order', () => {
    const [least] = GAIT_STYLE_BOUNDS.handCurl
    const full = walkHand(least)
    const half = walkHand((1 + least) / 2)
    const spread = channelIndex('rightSpread')
    const middle = channelIndex('rightMiddle1')
    expect(full[spread]).toBeCloseTo(HAND_SHAPES.open.spread * DEG - HAND_SHAPES.relaxed.spread * DEG, 9)
    // An opening hand unrolls its fingers before it fans them; the middle joint moves with the hand.
    expect(half[middle]).toBeCloseTo(full[middle] / 2, 9)
    expect(half[spread]).toBeLessThan(full[spread] / 2)
  })
})
