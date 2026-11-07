import type { NaturalMotionFrame } from '@proj-airi/motion-driver-natural/frame-types'
import type { MotionScenario, ScenarioEvent } from '@proj-airi/stage-shared/motion-scenario'

import { NaturalMotion } from '@proj-airi/motion-driver-natural/natural-motion'
import { withPostureShiftsHeld } from '@proj-airi/motion-driver-natural/posture-shift-hold'
import { MotionScenarioSchema } from '@proj-airi/stage-shared/motion-scenario'
import { safeParse } from 'valibot'
import { describe, expect, it, vi } from 'vitest'

import { runT1 } from './t1/runner'

/** T1 sim step. The adapter drains a scene gesture at the event's frame; Natural starts it on the next grid step. */
const dt = 1 / 120
const at = 1

type GestureEvent = Extract<ScenarioEvent, { kind: 'gesture' }>

function gesture(time: number, kind: GestureEvent['gesture'], count?: number): GestureEvent {
  return { kind: 'gesture', at: time, gesture: kind, ...(count === undefined ? {} : { count }) }
}

function scenario(id: string, events: ScenarioEvent[], durationSeconds: number): MotionScenario {
  return { version: 1, id, seed: 41, durationSeconds, levels: ['t1'], settings: { heldEmotions: false }, events }
}

/** Every Natural frame the adapter composed, by sim time; the adapter's own `advance` is the last at a timestamp. */
function framesOf(input: MotionScenario) {
  const frames = new Map<number, NaturalMotionFrame>()
  const advance = NaturalMotion.prototype.advance
  const spy = vi.spyOn(NaturalMotion.prototype, 'advance').mockImplementation(function (this: NaturalMotion, nowSeconds: number) {
    const frame = advance.call(this, nowSeconds)
    frames.set(nowSeconds, frame)
    return frame
  })
  try {
    runT1(input)
    return frames
  }
  finally {
    spy.mockRestore()
  }
}

/**
 * Runs the scenario and its twin with each gesture replaced by a marker, through the full T1 sink, and returns the
 * per-frame difference from the gesture's start (`rel` 0). Continuous posture wobble is silenced in both runs, as in
 * the stage-ui-live2d facade tests, so the difference is the clip rather than its idle duck. Idle posture shifts are
 * held off in both runs too: a gesture postpones a due shift only in its own run, and with human-length holds
 * (median about 0.3 s) a shift is due inside almost every gesture window.
 */
function capture(events: ScenarioEvent[], durationSeconds: number, start = at) {
  return withPostureShiftsHeld(() => {
    const twin = events.map((event): ScenarioEvent => event.kind === 'gesture' ? { kind: 'marker', at: event.at, label: `no-${event.gesture}` } : event)
    const actual = framesOf(scenario('gesture', events, durationSeconds))
    const idle = framesOf(scenario('gesture-idle', twin, durationSeconds))
    return [...actual].filter(([t]) => t >= start + dt - 1e-9).map(([t, a]) => {
      const b = idle.get(t)!
      return {
        rel: t - start - dt,
        head: [a.pose.headX - b.pose.headX, a.pose.headY - b.pose.headY, a.pose.headZ - b.pose.headZ],
        body: [a.pose.bodyX! - b.pose.bodyX!, a.pose.bodyY! - b.pose.bodyY!, a.pose.bodyZ! - b.pose.bodyZ!],
        brow: a.face.browLY - b.face.browLY,
        mouth: a.face.mouthForm - b.face.mouthForm,
        eyeX: a.pose.eyeX - b.pose.eyeX,
        fixation: a.fixation.x,
      }
    })
  }, { seconds: durationSeconds + 60, quietContinuous: true })
}

type Frame = ReturnType<typeof capture>[number]
const within = (frames: Frame[], from: number, to: number) => frames.filter(frame => frame.rel >= from - 1e-9 && frame.rel <= to + 1e-9)
const peak = (values: number[]) => Math.max(...values.map(Math.abs))

describe('t1 gesture scenarios', () => {
  it('nods twice with decaying pitch dips and returns without yaw or roll', () => {
    const frames = capture([gesture(at, 'nod', 2)], 2.5)
    expect(Math.min(...within(frames, 0.2, 0.25).map(f => f.head[1]))).toBeLessThanOrEqual(-0.95 * 0.22)
    expect(Math.abs(Math.min(...within(frames, 0.65, 0.7).map(f => f.head[1])) + 0.176)).toBeLessThanOrEqual(0.05 * 0.176)
    expect(peak(frames.map(f => f.head[0]))).toBeLessThan(0.01)
    expect(peak(frames.map(f => f.head[2]))).toBeLessThan(0.01)
    expect(peak(within(frames, 0.9, 1.4).map(f => f.head[1]))).toBeLessThan(1e-3)
  })

  it('shakes at 2 Hz with four lobes and a quarter-strength body yaw, using the default count of 2', () => {
    const frames = capture([gesture(at, 'shake')], 2.5)
    const moving = within(frames, 1e-6, 1 - 1e-6).filter(f => Math.abs(f.head[0]) > 1e-8)
    const signs = moving.map(f => Math.sign(f.head[0]))
    expect(signs.filter((sign, i) => i === 0 || sign !== signs[i - 1])).toHaveLength(4)
    expect(peak(moving.map(f => f.head[0]))).toBeGreaterThanOrEqual(0.18)
    expect(peak(moving.map(f => f.head[0]))).toBeLessThanOrEqual(0.25)
    for (const frame of frames)
      expect(frame.body[0]).toBeCloseTo(0.25 * frame.head[0], 8)
    expect(peak(within(frames, 1, 1.4).map(f => f.head[0]))).toBeLessThan(1e-8)
  })

  it('shrugs with a held body lift, raised brows, and a negative mouth form, then settles at 1.1 s', () => {
    const frames = capture([gesture(at, 'shrug')], 2.5)
    const held = within(frames, 0.25, 0.65)
    expect(Math.max(...held.map(f => f.body[1]))).toBeGreaterThanOrEqual(0.1425)
    expect(Math.max(...held.map(f => f.brow))).toBeGreaterThanOrEqual(0.28)
    expect(Math.min(...held.map(f => f.mouth))).toBeLessThanOrEqual(-0.14)
    for (const frame of within(frames, 1.1, 1.4))
      expect(peak([...frame.head, ...frame.body, frame.brow, frame.mouth])).toBeLessThan(1e-8)
  })

  // A head or body cue postpones Natural's idle posture shifts (`activeUntil`), so after about 0.85 s the idle twin
  // drifts away by a few thousandths. The facade test pins the exact 2%; T1 allows 5% and checks the roll axis only.
  it.each([-1, 1])('leans toward the inward placement side %i and releases by 2.6 s', (inward) => {
    const frames = capture([{ kind: 'placement', at: 0, inward }, gesture(at, 'lean')], 4)
    for (const frame of within(frames, 0.3, 2.3))
      expect(Math.abs(frame.body[2] - inward * 0.12)).toBeLessThanOrEqual(0.05 * 0.12)
    expect(peak(within(frames, 2.6, 2.9).map(f => f.body[2]))).toBeLessThan(0.005)
  })

  it('glances with the eyes only and returns after the hold', () => {
    const frames = capture([gesture(at, 'glance')], 2.5)
    const landed = within(frames, 0.1, 0.2)
    const side = Math.sign(landed[0].fixation)
    expect(Math.max(...landed.map(f => side * f.eyeX))).toBeGreaterThanOrEqual(0.28)
    expect(Math.max(...frames.map(f => Math.hypot(...f.head)))).toBeLessThan(0.005)
    expect(frames.at(-1)!.fixation).not.toBeCloseTo(side * 0.35, 3)
  })

  it('queues a conflicting shake until a two-dip nod ends at 0.9 s', () => {
    const frames = capture([gesture(at, 'nod', 2), gesture(at + 0.3, 'shake', 2)], 3.5)
    expect(peak(within(frames, 0, 0.9).map(f => f.head[0]))).toBeLessThan(0.01)
    expect(peak(within(frames, 0.9, 1.9).map(f => f.head[0]))).toBeGreaterThanOrEqual(0.18)
  })

  it('replaces the queued shake with a newer conflicting shrug', () => {
    const frames = capture([gesture(at, 'nod', 2), gesture(at + 0.3, 'shake', 2), gesture(at + 0.5, 'shrug')], 3.5)
    expect(peak(frames.map(f => f.head[0]))).toBeLessThan(0.01)
    expect(peak(within(frames, 0, 0.89).map(f => f.body[1]))).toBeLessThan(1e-8)
    expect(Math.max(...within(frames, 1.15, 1.55).map(f => f.body[1]))).toBeGreaterThanOrEqual(0.1425)
  })

  it('drops a gesture that would wait longer than 1.5 s', () => {
    const frames = capture([gesture(at, 'lean'), gesture(at + 0.2, 'shrug')], 4.5)
    // The shrug would wait until the lean ends at 2.6 s, so it never plays: the run equals the lean alone.
    expect(frames).toEqual(capture([gesture(at, 'lean')], 4.5))
    expect(peak(frames.map(f => f.brow))).toBe(0)
  })

  it('runs disjoint channels together: a nod with a glance', () => {
    const frames = capture([gesture(at, 'nod', 1), gesture(at, 'glance')], 2.5)
    expect(Math.min(...within(frames, 0.2, 0.25).map(f => f.head[1]))).toBeLessThanOrEqual(-0.95 * 0.22)
    const side = Math.sign(within(frames, 0.1, 0.2)[0].fixation)
    expect(Math.max(...within(frames, 0.1, 0.2).map(f => side * f.eyeX))).toBeGreaterThan(0.1)
  })

  it('rejects a gesture event at T3 and an out-of-range count', () => {
    const t3 = { ...scenario('gesture-t3', [gesture(at, 'nod')], 2), levels: ['t1', 't3'] }
    expect(safeParse(MotionScenarioSchema, t3).success).toBe(false)
    for (const count of [0, 4, 1.5])
      expect(safeParse(MotionScenarioSchema, scenario('gesture-count', [gesture(at, 'nod', count)], 2)).success).toBe(false)
    const unknownKind: unknown = { ...scenario('gesture-kind', [], 2), events: [{ kind: 'gesture', at, gesture: 'wave' }] }
    expect(safeParse(MotionScenarioSchema, unknownKind).success).toBe(false)
  })
})
