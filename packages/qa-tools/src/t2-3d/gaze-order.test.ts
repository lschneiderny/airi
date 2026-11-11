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
const blink = (t: number): MotionTraceEvent => ({ t, kind: 'marker', label: 'blink' })

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

  it('refuses a trace without a head turn', () => {
    const still = { ...eyes, angle: 0 }
    const trace = gazeTrace({ eyes, head: { ...head, angle: 0.02 }, chest: still })
    expect(() => gazeOrderReport(trace, params)).toThrow(GazeOrderRefusal)
    expect(() => gazeOrderReport(trace, params)).toThrow(expect.objectContaining({ name: 'no-head-turns' }))
  })
})
