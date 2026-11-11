import type { MotionTraceBone, MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import type { Quat } from './metrics/types'

import { describe, expect, it } from 'vitest'

import { GazeOrderRefusal, gazeOrderReport } from './gaze-order'
import { multiply } from './metrics/math'
import { analyticTrace, angleY } from './metrics/test-trace'

const bones: MotionTraceBone[] = ['hips', 'spine', 'chest', 'neck', 'head', 'leftEye', 'rightEye']
const identity: Quat = [0, 0, 0, 1]

/** Minimum-jerk position share over 0.3 s from `start`. */
function ramp(t: number, start: number): number {
  const u = Math.min(1, Math.max(0, (t - start) / 0.3))
  return u * u * u * (10 - 15 * u + 6 * u * u)
}

interface Joint { readonly start: number, readonly angle: number }

function gazeTrace(joints: { eyes: Joint, head: Joint, chest: Joint }, events: MotionTraceEvent[], seconds = 4) {
  const turn = (joint: Joint, t: number): Quat => angleY(joint.angle * ramp(t, joint.start))
  return analyticTrace({
    seconds,
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

const shift = (t: number, degrees: number): MotionTraceEvent => ({ t, kind: 'marker', label: `gaze-shift:${degrees.toFixed(2)}` })
const blink = (t: number): MotionTraceEvent => ({ t, kind: 'marker', label: 'blink' })

describe('gaze-order report', () => {
  it('orders a shift whose eyes, head and chest start one after another', () => {
    const report = gazeOrderReport(gazeTrace({ eyes: { start: 1, angle: 0.3 }, head: { start: 1.1, angle: 0.3 }, chest: { start: 1.2, angle: 0.1 } }, [shift(1, 30)]))
    expect(report.shifts).toHaveLength(1)
    const [first] = report.shifts
    expect(first.pattern).toBe('full')
    expect(first.ordered).toBe(true)
    expect(first.onsetMs.eyes).toBeLessThan(first.onsetMs.head!)
    expect(first.onsetMs.head).toBeLessThan(first.onsetMs.chest!)
    expect(report.orderedShare).toBe(1)
  })

  it('does not order a shift whose head starts before its eyes', () => {
    const report = gazeOrderReport(gazeTrace({ eyes: { start: 1.1, angle: 0.3 }, head: { start: 1, angle: 0.3 }, chest: { start: 1.2, angle: 0.1 } }, [shift(1, 30)]))
    expect(report.shifts[0].ordered).toBe(false)
    expect(report.orderedShare).toBe(0)
  })

  it('does not order simultaneous onsets', () => {
    const report = gazeOrderReport(gazeTrace({ eyes: { start: 1, angle: 0.3 }, head: { start: 1, angle: 0.2 }, chest: { start: 1, angle: 0.1 } }, [shift(1, 30)]))
    const [first] = report.shifts
    expect(first.onsetMs.eyes).toBe(first.onsetMs.head)
    expect(first.ordered).toBe(false)
  })

  it('orders an eyes-only shift and names it', () => {
    const report = gazeOrderReport(gazeTrace({ eyes: { start: 1, angle: 0.2 }, head: { start: 1, angle: 0 }, chest: { start: 1, angle: 0 } }, [shift(1, 10)]))
    expect(report.shifts[0]).toMatchObject({ pattern: 'eyes-only', ordered: true, onsetMs: { head: null, chest: null } })
    expect(report.patterns['eyes-only']).toBe(1)
  })

  it('counts a blink inside a shift window and not one outside it', () => {
    const joints = { eyes: { start: 1, angle: 0.3 }, head: { start: 1.1, angle: 0.3 }, chest: { start: 1.2, angle: 0.1 } }
    // The first window ends at the second shift; the second ends 2 s after it starts.
    const report = gazeOrderReport(gazeTrace(joints, [shift(1, 45), blink(1.5), shift(2, 45), blink(4.5)], 5))
    expect(report.shifts.map(s => s.blink)).toEqual([true, false])
    expect(report.blinkShare).toBe(0.5)
    expect(report.largeShifts).toBe(2)
  })

  it('reports the criterion share over shifts of 10 degrees or more beside the all-events share', () => {
    const joints = { eyes: { start: 1, angle: 0.3 }, head: { start: 1.1, angle: 0.3 }, chest: { start: 1.2, angle: 0.1 } }
    // The 5-degree event's window holds no motion: it stays in all events, unordered, and outside the criterion.
    const report = gazeOrderReport(gazeTrace(joints, [shift(1, 30), shift(2.5, 5)], 5))
    expect(report.orderedShare).toBe(0.5)
    expect(report.criterion).toEqual({ minAmplitudeDeg: 10, ordered: 1, total: 1, share: 1 })
  })

  it('leaves a sub-half-degree event without joint motion out of both shares', () => {
    const joints = { eyes: { start: 1, angle: 0.3 }, head: { start: 1.1, angle: 0.3 }, chest: { start: 1.2, angle: 0.1 } }
    const report = gazeOrderReport(gazeTrace(joints, [shift(1, 0.3), shift(2.5, 0.2)], 5))
    expect(report.shifts.map(s => s.pattern)).toEqual(['full', 'null'])
    expect(report.nullEvents).toBe(1)
    expect(report.ordered).toBe(1)
    expect(report.orderedShare).toBe(1)
    expect(report.criterion).toEqual({ minAmplitudeDeg: 10, ordered: 0, total: 0, share: null })
  })

  it('refuses a trace with no gaze-shift events', () => {
    const trace = gazeTrace({ eyes: { start: 1, angle: 0.3 }, head: { start: 1.1, angle: 0.3 }, chest: { start: 1.2, angle: 0.1 } }, [blink(1)])
    expect(() => gazeOrderReport(trace)).toThrow(GazeOrderRefusal)
    expect(() => gazeOrderReport(trace)).toThrow(expect.objectContaining({ name: 'no-gaze-shifts' }))
  })
})
