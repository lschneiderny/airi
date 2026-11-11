import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat } from './metrics/types'

import { describe, expect, it } from 'vitest'

import { GazeOrderRefusal, gazeOrderReport } from './gaze-order'
import { multiply } from './metrics/math'
import { analyticTrace, angleY, detectors } from './metrics/test-trace'

const bones: MotionTraceBone[] = ['hips', 'spine', 'chest', 'neck', 'head', 'leftEye', 'rightEye']
const identity: Quat = [0, 0, 0, 1]
const params = detectors(bones)

/** Minimum-jerk position share over `duration` seconds from `start`. */
function ramp(t: number, start: number, duration: number): number {
  const u = Math.min(1, Math.max(0, (t - start) / duration))
  return u * u * u * (10 - 15 * u + 6 * u * u)
}

interface Joint { readonly start: number, readonly angle: number, readonly duration: number }

/** Eight head turns of 30 degrees, 3 s apart; each joint turns by its own ramp in every turn. */
function gazeTrace(joints: { eyes: Joint, head: Joint, chest: Joint }, events: MotionTraceEvent[] = []) {
  const turn = (joint: Joint, t: number): Quat => {
    let angle = 0
    for (let k = 0; k < 8; k++)
      angle += (k % 2 ? -1 : 1) * joint.angle * ramp(t, 1 + 3 * k + joint.start, joint.duration)
    return angleY(angle)
  }
  return analyticTrace({
    seconds: 26,
    bones,
    scenario: 'gaze',
    events,
    world: (bone, t) => {
      const chest = turn(joints.chest, t)
      const head = multiply(chest, turn(joints.head, t))
      switch (bone) {
        case 'chest':
        case 'neck': return chest
        case 'head': return head
        case 'leftEye':
        case 'rightEye': return multiply(head, turn(joints.eyes, t))
        default: return identity
      }
    },
  })
}

const eyes = { start: 0, angle: 0.25, duration: 0.08 }
const head = { start: 0.1, angle: 0.52, duration: 0.5 }
const chest = { start: 0.25, angle: 0.1, duration: 0.6 }
const shift = (t: number, degrees: number): MotionTraceEvent => ({ t, kind: 'marker', label: `gaze-shift:${degrees.toFixed(2)}` })
const blink = (t: number, source = 'body'): MotionTraceEvent => ({ t, kind: 'marker', label: `blink:${source}` })

describe('gaze-order report', () => {
  it('orders head turns whose eyes, head and chest start one after another', () => {
    const report = gazeOrderReport(gazeTrace({ eyes, head, chest }), params)
    expect(report.episodes).toHaveLength(8)
    expect(report.episodes.every(e => e.pattern === 'full' && e.eyeLeadMs! > 0 && e.chestLagMs! > 0)).toBe(true)
    expect(report.ordered).toEqual({ ordered: 8, total: 8, share: 1 })
    expect(report.eyeBeforeHead.share).toBe(1)
    expect(report.headBeforeChest.share).toBe(1)
  })

  it('does not order head turns whose head starts before the eyes', () => {
    const report = gazeOrderReport(gazeTrace({ eyes: { ...eyes, start: 0.2 }, head: { ...head, start: 0 }, chest: { ...chest, start: 0.4 } }), params)
    expect(report.eyeBeforeHead.share).toBe(0)
    expect(report.ordered.share).toBe(0)
  })

  it('does not order simultaneous onsets, which the gate\'s non-strict indicator accepts', () => {
    const report = gazeOrderReport(gazeTrace({ eyes: { ...eyes, start: 0, duration: 0.5 }, head: { ...head, start: 0 }, chest: { ...chest, start: 0.25 } }), params)
    expect(report.episodes.every(e => e.eyeLeadMs === 0 && !e.ordered && e.gateOrdered)).toBe(true)
    expect(report.ordered.share).toBe(0)
  })

  it('orders a turn whose chest stays below its floor when the eyes lead, and names it', () => {
    const report = gazeOrderReport(gazeTrace({ eyes, head, chest: { ...chest, angle: 0 } }), params)
    expect(report.episodes.every(e => e.pattern === 'no-chest' && e.ordered)).toBe(true)
    expect(report.headBeforeChest.total).toBe(0)
    expect(report.ordered.share).toBe(1)
  })

  it('counts a blink inside a large shift\'s window and not one outside it', () => {
    const report = gazeOrderReport(gazeTrace({ eyes, head, chest }, [shift(1, 45), blink(1.5), shift(4, 45), blink(6.5), shift(7, 15), blink(7.2)]), params)
    expect(report.blink).toEqual({ ordered: 1, total: 2, share: 0.5 })
  })

  it('counts blinks from either source and splits them by source', () => {
    const report = gazeOrderReport(gazeTrace({ eyes, head, chest }, [shift(1, 45), blink(1.1, 'natural'), shift(4, 45), blink(4.2, 'body'), shift(7, 45)]), params)
    expect(report.blink).toEqual({ ordered: 2, total: 3, share: 2 / 3 })
    expect(report.blinkSources).toEqual({ body: 1, natural: 1 })
  })

  it('refuses a trace without a head turn', () => {
    const still = { ...eyes, angle: 0 }
    const trace = gazeTrace({ eyes, head: { ...head, angle: 0.02 }, chest: still })
    expect(() => gazeOrderReport(trace, params)).toThrow(GazeOrderRefusal)
    expect(() => gazeOrderReport(trace, params)).toThrow(expect.objectContaining({ name: 'no-head-turns' }))
  })
})

describe('gaze-order criterion (displacement)', () => {
  interface Part { readonly start: number, readonly share: number, readonly duration: number }
  /** One 30-degree shift at 1 s: the gaze line in the world, the head on the chest, the chest on the pelvis; the eye in its head makes up the rest. */
  const shiftTrace = (gaze: Part, head: Part, chest: Part, label = 'gaze-shift:30.00:+30.00:sustained', eyeLimitDeg = Number.POSITIVE_INFINITY) => {
    const amplitude = Number.parseFloat(label.split(':')[1]) * Math.PI / 180
    const eyeLimit = eyeLimitDeg * Math.PI / 180
    const move = (part: Part, t: number) => part.share * amplitude * ramp(t, part.start, part.duration)
    return analyticTrace({
      seconds: 4,
      bones,
      scenario: 'gaze',
      events: [{ t: 1, kind: 'marker', label }],
      world: (bone, t) => {
        const chestWorld = angleY(move(chest, t))
        const headWorld = multiply(chestWorld, angleY(move(head, t)))
        switch (bone) {
          case 'chest':
          case 'neck': return chestWorld
          case 'head': return headWorld
          case 'leftEye':
          case 'rightEye': return multiply(headWorld, angleY(Math.max(-eyeLimit, Math.min(eyeLimit, move(gaze, t) - move(head, t) - move(chest, t)))))
          default: return identity
        }
      },
    })
  }
  const eyesFirst = { start: 1, share: 1, duration: 0.1 }

  it('orders a shift whose gaze line nearly arrives before the head is halfway and the head before the chest', () => {
    const report = gazeOrderReport(shiftTrace(eyesFirst, { start: 1.03, share: 0.6, duration: 0.5 }, { start: 1.15, share: 0.2, duration: 0.6 }), params)
    expect(report.criterion.shifts[0]).toMatchObject({ pattern: 'full', ordered: true, headRecruited: true, chestRecruited: true })
    expect(report.criterion.share).toEqual({ ordered: 1, total: 1, share: 1 })
  })

  it('does not order a shift whose head is halfway before the gaze line nearly arrives', () => {
    const report = gazeOrderReport(shiftTrace({ start: 1.2, share: 1, duration: 0.1 }, { start: 1, share: 0.6, duration: 0.2 }, { start: 1, share: 0, duration: 0.6 }), params)
    expect(report.criterion.shifts[0]).toMatchObject({ eyesBeforeHead: false, ordered: false })
  })

  it('does not order a shift whose chest is halfway before the head', () => {
    const report = gazeOrderReport(shiftTrace(eyesFirst, { start: 1.03, share: 0.6, duration: 0.6 }, { start: 1, share: 0.2, duration: 0.2 }), params)
    expect(report.criterion.shifts[0]).toMatchObject({ eyesBeforeHead: true, headBeforeChest: false, ordered: false })
  })

  it('orders a large shift by the eyes\' own travel when the eye limit holds the gaze line back until the head carries it', () => {
    const report = gazeOrderReport(shiftTrace(eyesFirst, { start: 1.03, share: 0.9, duration: 0.5 }, { start: 1, share: 0, duration: 0.5 }, 'gaze-shift:60.00:+60.00:free', 20), params)
    const [shift] = report.criterion.shifts
    expect(shift.reachMs.gaze).toBeGreaterThan(shift.reachMs.head!)
    expect(shift.excursionDeg.eyes).toBeCloseTo(20, 1)
    expect(shift).toMatchObject({ eyesBeforeHead: true, ordered: true, pattern: 'no-chest' })
    expect(report.criterion.eyeLimitDeg).toBeCloseTo(20, 1)
  })

  it('names eyes-only and no-chest shifts, counts them as ordered and reports recruitment', () => {
    const eyesOnly = gazeOrderReport(shiftTrace(eyesFirst, { start: 1, share: 0, duration: 0.5 }, { start: 1, share: 0, duration: 0.5 }, 'gaze-shift:45.00:-45.00:sustained'), params)
    expect(eyesOnly.criterion.shifts[0]).toMatchObject({ pattern: 'eyes-only', ordered: true })
    expect(eyesOnly.criterion).toMatchObject({ eyesOnly: 1, noChest: 0, large: { shifts: 1, headRecruited: 0 } })
    const noChest = gazeOrderReport(shiftTrace(eyesFirst, { start: 1.03, share: 0.6, duration: 0.5 }, { start: 1, share: 0, duration: 0.5 }), params)
    expect(noChest.criterion.shifts[0]).toMatchObject({ pattern: 'no-chest', ordered: true })
    expect(noChest.criterion).toMatchObject({ noChest: 1, sustainedWide: { shifts: 1, chestRecruited: 0 } })
  })
})
