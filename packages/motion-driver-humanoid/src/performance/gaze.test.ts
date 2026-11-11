import { describe, expect, it } from 'vitest'

import { channelIndex, DEG } from './channels'
import { createBodyPerformer } from './index'
import { fixtureRigs, quietInput } from './performance.test-fixtures'

const traits = fixtureRigs[0].traits
const c = channelIndex

function shift(degrees: number, seed = 1) {
  const performer = createBodyPerformer({ traits, seed })
  const line: number[] = []
  const head: number[] = []
  const trunk: number[] = []
  const input = quietInput()
  for (let i = 0; i < 720; i++) {
    const frame = performer.step({ ...input, gaze: { ...input.gaze, yaw: degrees * DEG, saccadeSeq: 1 } })
    line.push(frame.gaze.yaw)
    head.push(frame.channels[c('headYaw')] + frame.channels[c('neckYaw')])
    trunk.push(frame.channels[c('lowerYaw')] + frame.channels[c('midYaw')] + frame.channels[c('upperYaw')])
  }
  return { line, head, trunk }
}

describe('gaze performance', () => {
  it('eyes arrive before the head, which overshoots and settles', () => {
    const { line, head } = shift(30)
    const final = head.at(-1) ?? 0
    expect(final).toBeGreaterThan(10 * DEG)
    const eyeArrival = line.findIndex(x => x >= 30 * DEG * 0.9)
    const headArrival = head.findIndex(x => x >= final * 0.5)
    expect(eyeArrival).toBeGreaterThanOrEqual(0)
    expect(headArrival).toBeGreaterThan(eyeArrival)
    expect(Math.max(...head)).toBeGreaterThan(final + 0.05 * DEG)
    expect(Math.abs(head[600] - final)).toBeLessThan(0.5 * DEG)
  })

  it('recruits the head and trunk only for successively larger shifts', () => {
    const small = shift(4)
    const medium = shift(18)
    const large = shift(50)
    expect(Math.max(...small.head.map(Math.abs))).toBeLessThan(1e-6)
    expect(Math.max(...small.trunk.map(Math.abs))).toBeLessThan(1e-6)
    expect(Math.max(...medium.trunk.map(Math.abs))).toBeLessThan(1e-6)
    expect(medium.head.at(-1) ?? 0).toBeGreaterThan(small.head.at(-1) ?? 0)
    expect(large.head.at(-1) ?? 0).toBeGreaterThan(medium.head.at(-1) ?? 0)
    expect(large.trunk.at(-1) ?? 0).toBeGreaterThan(DEG)
  })

  it('keeps eye residuals bounded and compensates the moving head', () => {
    const performer = createBodyPerformer({ traits, seed: 2 })
    const input = quietInput()
    let movingSamples = 0
    for (let i = 0; i < 720; i++) {
      const frame = performer.step({ ...input, gaze: { ...input.gaze, yaw: 18 * DEG, saccadeSeq: 1 } })
      const body = frame.channels[c('headYaw')] + frame.channels[c('neckYaw')]
      expect(Math.abs(frame.eyes.yaw)).toBeLessThanOrEqual(traits.eyeYawLimit)
      expect(Math.abs(frame.eyes.pitch)).toBeLessThanOrEqual(traits.eyePitchLimit)
      if (i > 60 && i < 180) {
        expect(Math.abs(frame.eyes.yaw + body - 18 * DEG)).toBeLessThan(DEG)
        movingSamples += Math.abs(body) > DEG ? 1 : 0
      }
    }
    expect(movingSamples).toBeGreaterThan(60)
  })

  it('couples blinks more often to large shifts across seeds and respects Natural blinks', () => {
    function count(degrees: number, openness = 1) {
      let blinks = 0
      for (let seed = 0; seed < 200; seed++) {
        const performer = createBodyPerformer({ traits, seed })
        const input = quietInput()
        let closed = false
        for (let i = 0; i < 40; i++) {
          const frame = performer.step({ ...input, gaze: { ...input.gaze, yaw: degrees * DEG, blinkFactor: openness, saccadeSeq: 1 } })
          closed ||= frame.lidClose > 0.5
        }
        blinks += Number(closed)
      }
      return blinks
    }
    expect(count(45)).toBeGreaterThan(count(16) + 50)
    expect(count(45, 0.5)).toBe(0)
  })
})
