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
  it('starts a gaze turn in the neck ahead of the head', () => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const input = quietInput()
    const neck: number[] = []
    const head: number[] = []
    for (let i = 0; i < 360; i++) {
      const frame = performer.step({ ...input, gaze: { ...input.gaze, yaw: 38 * DEG, saccadeSeq: 1 } })
      neck.push(frame.channels[c('neckYaw')])
      head.push(frame.channels[c('headYaw')])
    }
    const halfway = (values: number[]) => values.findIndex(v => v >= 0.5 * (values.at(-1) ?? 0))
    expect(halfway(neck)).toBeLessThan(halfway(head))
  })

  it('passes the head\'s turn up the trunk, so the trunk is half-way at least 120 ms after the head', () => {
    for (const [from, to] of [[0, 38], [0, 60], [40, -38]] as const) {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const input = quietInput()
      const head: number[] = []
      const trunk: number[] = []
      for (let i = 0; i < 960; i++) {
        const after = i >= 480
        const frame = performer.step({ ...input, gaze: { ...input.gaze, yaw: (after ? to : from) * DEG, saccadeSeq: after ? 2 : 1 } })
        if (after) {
          head.push(frame.channels[c('headYaw')] + frame.channels[c('neckYaw')])
          trunk.push(frame.channels[c('lowerYaw')] + frame.channels[c('midYaw')] + frame.channels[c('upperYaw')])
        }
      }
      const halfway = (values: number[]) => {
        const travel = values.map(v => Math.sign(to - from) * (v - values[0]))
        const excursion = Math.max(...travel)
        return travel.findIndex(v => v >= 0.5 * excursion)
      }
      expect(halfway(trunk) - halfway(head)).toBeGreaterThanOrEqual(Math.round(0.12 * 120))
    }
  })

  it('holds the trunk until 120 ms after the head starts when a shift reverses or unwinds it', () => {
    for (const kind of ['sustained', 'free'] as const) {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const input = quietInput()
      const trunk: number[] = []
      for (let i = 0; i < 960; i++) {
        const after = i >= 480
        const frame = performer.step({ ...input, gaze: { ...input.gaze, yaw: (after ? -38 : 40) * DEG, kind: after ? kind : 'sustained', saccadeSeq: after ? 2 : 1 } })
        trunk.push(frame.channels[c('lowerYaw')] + frame.channels[c('midYaw')] + frame.channels[c('upperYaw')])
      }
      expect(trunk[479]).toBeGreaterThan(3 * DEG)
      const latency = Math.round(0.12 * 120)
      expect(Math.abs(trunk[480 + latency - 1] - trunk[479])).toBeLessThan(0.01 * DEG)
    }
  })

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

  it('holds the head in space while the feet turn the body under it', () => {
    // Architecture 5.5: the body turns under a head already there, at a 22.5 degree step's 56 degrees per second.
    // Re-pinned from a 40 degree goal, which now turns the chest too: this one stays within 25 degrees (no trunk).
    const performer = createBodyPerformer({ traits, seed: 1 })
    const input = quietInput()
    const space: number[] = []
    for (let i = 0; i < 600; i++) {
      const facingYaw = Math.min(10, Math.max(0, i - 360) * 56 / 120) * DEG
      const frame = performer.step({ ...input, gaze: { ...input.gaze, yaw: 25 * DEG, kind: 'free', saccadeSeq: 1 }, facingYaw })
      const body = ['lowerYaw', 'midYaw', 'upperYaw', 'neckYaw', 'headYaw'] as const
      space.push(facingYaw + body.reduce((sum, channel) => sum + frame.channels[c(channel)], 0))
    }
    const settled = space[359]
    expect(settled).toBeGreaterThan(10 * DEG)
    expect(Math.max(...space.slice(360).map(yaw => Math.abs(yaw - settled)))).toBeLessThan(0.01 * DEG)
  })

  it('turns the feet back to the viewer after a far look ends', () => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const input = quietInput()
    const release = 220
    let facingYaw = 0
    let turned = 0
    let backAt = -1
    for (let i = 0; i < release + 6 * 120; i++) {
      const look = i < release
      const gaze = { ...input.gaze, yaw: look ? -70 * DEG : 0, kind: look ? 'sustained' as const : 'free' as const, saccadeSeq: look ? 1 : 2 }
      facingYaw = performer.step({ ...input, gaze, facingYaw, allowTurn: true }).facingYaw
      turned = Math.min(turned, facingYaw)
      if (backAt < 0 && !look && Math.abs(facingYaw) < 1e-6)
        backAt = i
    }
    expect(turned).toBeLessThan(-40 * DEG)
    expect(backAt).toBeGreaterThan(release)
    expect(backAt - release).toBeLessThan(4 * 120)
    expect(Math.abs(facingYaw)).toBeLessThan(1e-6)
  })

  it('keeps the feet on the viewer through a free glance', () => {
    const performer = createBodyPerformer({ traits, seed: 1 })
    const input = quietInput()
    let facingYaw = 0
    for (let i = 0; i < 4 * 120; i++) {
      const gaze = { ...input.gaze, yaw: 40 * DEG, kind: 'free' as const, saccadeSeq: 1 }
      facingYaw = performer.step({ ...input, gaze, facingYaw, allowTurn: true }).facingYaw
    }
    expect(facingYaw).toBe(0)
  })

  it('keeps one saccade when the goal arrives over several ticks or Natural saccades toward it again', () => {
    const shifts = (goal: (tick: number) => { yaw: number, seq: number }) => {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const input = quietInput()
      let count = 0
      for (let i = 0; i < 240; i++) {
        const { yaw, seq } = goal(i)
        count = performer.step({ ...input, gaze: { ...input.gaze, yaw: yaw * DEG, saccadeSeq: seq } }).diagnostics.gazeShifts
      }
      return count
    }
    // A target sliding 60 degrees across three ticks, as a goal resolved over three display frames arrives.
    expect(shifts(i => ({ yaw: i < 120 ? 0 : 20 * Math.min(3, i - 119), seq: 0 }))).toBe(1)
    // Natural's own saccade toward the cursor the body already turned to, one display frame later.
    expect(shifts(i => ({ yaw: i < 120 ? 0 : 40, seq: i < 122 ? 0 : 1 }))).toBe(1)
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
    // Evinger et al. 1994: the lid-closing muscle fires with 97 % of gaze shifts larger than 33 degrees.
    expect(count(34)).toBeGreaterThanOrEqual(186)
  })

  it('turns the chest home with the head when a free goal comes back to the viewer over feet still turned away', () => {
    const trunkAfter = (facing: number, goal: number) => {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const input = quietInput()
      let trunk = 0
      for (let i = 0; i < 120; i++) {
        const frame = performer.step({ ...input, facingYaw: facing * DEG, gaze: { ...input.gaze, kind: 'free', yaw: goal * DEG, saccadeSeq: 1 } })
        trunk = frame.channels[c('lowerYaw')] + frame.channels[c('midYaw')] + frame.channels[c('upperYaw')]
      }
      return trunk / DEG
    }
    // Facing 60 degrees to her left, the viewer lies 60 to her right: the chest leads the way home.
    expect(trunkAfter(60, 0)).toBeLessThan(-3)
    // A free glance within 25 degrees of her facing leaves the trunk where it is.
    expect(Math.abs(trunkAfter(0, 20))).toBeLessThan(0.5)
  })

  it('brings the feet home for a goal held on the viewer, as for a free one', () => {
    const stepsFor = (kind: 'sustained' | 'free', goal: number) => {
      const performer = createBodyPerformer({ traits, seed: 1 })
      const input = quietInput()
      let facing = -24 * DEG
      let steps = 0
      for (let i = 0; i < 2 * 120; i++) {
        const frame = performer.step({ ...input, allowTurn: true, facingYaw: facing, gaze: { ...input.gaze, kind, yaw: goal * DEG, saccadeSeq: 1 } })
        steps += frame.turnSteps.length
        facing = frame.facingYaw
      }
      return steps
    }
    expect(stepsFor('free', 0)).toBeGreaterThan(0)
    expect(stepsFor('sustained', 0)).toBeGreaterThan(0)
    // A held look 15 degrees off the viewer is not her home: within 60 degrees of it the feet stay.
    expect(stepsFor('sustained', -15)).toBe(0)
  })
})
