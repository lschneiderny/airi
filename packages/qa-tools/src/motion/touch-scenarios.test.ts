import type { MotionScenario } from '@proj-airi/stage-shared/motion-scenario'
import type { Live2DNaturalMotionFrame } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/frame-types'
import type { NaturalTrace } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion/trace'

import { buildPointerApproach, buildPointerPoke, buildPointerStroke } from '@proj-airi/stage-shared/motion-scenario'
import { Live2DNaturalMotion } from '@proj-airi/stage-ui-live2d/composables/live2d/natural-motion'
import { describe, expect, it, vi } from 'vitest'

import { runT1 } from './t1/runner'

const seed = 1

function pointerScenario(id: string, events: MotionScenario['events'], durationSeconds: number): MotionScenario {
  return { version: 1, id, seed, durationSeconds, levels: ['t1'], events }
}

/**
 * Runs a scenario through T1 and keeps the Natural frame the adapter composed at each sim time.
 * The adapter's own `advance` call is the last one at a timestamp, so the map keeps that frame.
 */
function runWithFrames(scenario: MotionScenario) {
  const frames = new Map<number, Live2DNaturalMotionFrame>()
  const advance = Live2DNaturalMotion.prototype.advance
  const spy = vi.spyOn(Live2DNaturalMotion.prototype, 'advance').mockImplementation(function (this: Live2DNaturalMotion, nowSeconds: number) {
    const frame = advance.call(this, nowSeconds)
    frames.set(nowSeconds, frame)
    return frame
  })
  try {
    const trace = runT1(scenario)
    return { trace, frames: [...frames].map(([t, frame]) => ({ t, frame })) }
  }
  finally {
    spy.mockRestore()
  }
}

function touches(trace: NaturalTrace) {
  return trace.events.flatMap(entry => entry.source === 'natural' && entry.event.kind === 'touch' ? [{ t: entry.t, touch: entry.event.touch }] : [])
}

function attention(trace: NaturalTrace) {
  return trace.events.flatMap(entry => entry.source === 'natural' && entry.event.kind === 'attention' ? [entry.event] : [])
}

const strokes = (rateHz: number, amplitude: number) => buildPointerStroke({ at: 1, durationSeconds: 4, rateHz, amplitude, speed: 1.2, axis: 'x' })

describe('t1 touch scenarios', () => {
  it.each([60, 144])('(a) pets once for 4 s of +/-0.3 strokes at %i Hz and ends within 0.8 s after they stop', (rateHz) => {
    const trace = runT1(pointerScenario(`pet-strokes-${rateHz}`, strokes(rateHz, 0.3), 6.5))
    const pets = touches(trace).filter(entry => entry.touch !== 'poke')

    expect(pets.map(entry => entry.touch)).toEqual(['pet-start', 'pet-end'])
    expect(pets[0].t).toBeLessThan(5)
    expect(pets[1].t).toBeGreaterThan(5)
    expect(pets[1].t).toBeLessThanOrEqual(5.8)
  })

  it('(b) pets for +/-0.6 strokes that overshoot into the head margin', () => {
    const trace = runT1(pointerScenario('pet-strokes-wide', strokes(60, 0.6), 6.5))

    expect(touches(trace).filter(entry => entry.touch === 'pet-start')).toHaveLength(1)
  })

  it('(c) does not pet for one straight pass across the head', () => {
    const pass = buildPointerStroke({ at: 1, durationSeconds: 2.5, rateHz: 60, amplitude: 1.5, speed: 1.2, axis: 'x' })
    const trace = runT1(pointerScenario('straight-pass', pass, 4))

    expect(trace.events.some(entry => entry.source === 'scenario' && entry.event.kind === 'pointer')).toBe(true)
    expect(touches(trace)).toEqual([])
  })

  describe('(d) approaches from 8 to 0.6 head widths at 3 head/s', () => {
    const at = 1
    const end = at + (8 - 0.6) / 3
    const durationSeconds = end + 0.5
    const approach = (from: 'left' | 'right' | 'top' | 'bottom') => {
      const run = runWithFrames(pointerScenario(`approach-${from}`, buildPointerApproach({ at, from, startDistance: 8, endDistance: 0.6, speed: 3, rateHz: 60 }), durationSeconds))
      const final = run.frames.filter(entry => entry.t > durationSeconds - 1)
      const mean = (read: (frame: Live2DNaturalMotionFrame) => number) => final.reduce((sum, entry) => sum + read(entry.frame), 0) / final.length
      return {
        events: attention(run.trace),
        fixation: { x: mean(frame => frame.fixation.x), y: mean(frame => frame.fixation.y) },
        headX: run.frames.at(-1)!.frame.pose.headX,
      }
    }
    // Built on first use, so test collection does not run the simulations.
    let cached: Record<'left' | 'right' | 'top' | 'bottom', ReturnType<typeof approach>> | undefined
    const approaches = () => cached ??= { left: approach('left'), right: approach('right'), top: approach('top'), bottom: approach('bottom') }

    it.each(['left', 'right', 'top', 'bottom'] as const)('notices before engaging from the %s', (from) => {
      const phases = approaches()[from].events.map(event => event.phase)

      expect(phases).toContain('engage')
      expect(phases.indexOf('notice')).toBeGreaterThanOrEqual(0)
      expect(phases.indexOf('notice')).toBeLessThan(phases.indexOf('engage'))
    })

    it('pulls gaze and head toward the side the cursor came from', () => {
      const runs = approaches()
      // Equal seeds and mirrored distances give the same episodes, so only the cursor side differs.
      expect(runs.left.events).toEqual(runs.right.events)
      expect(runs.left.fixation.x).toBeLessThan(0)
      expect(runs.right.fixation.x).toBeGreaterThan(0)
      expect(runs.right.headX - runs.left.headX).toBeGreaterThan(0)
      expect(runs.top.fixation.y).toBeGreaterThan(0)
      expect(runs.bottom.fixation.y).toBeLessThan(0)
    })
  })

  it.each([
    { name: 'a still press commits after 90 ms', holdSeconds: 0.5, from: 2.09, tolerance: 0.1 },
    { name: 'a 50 ms click commits on release', holdSeconds: 0.05, from: 2.05, tolerance: 1 / 120 },
  ])('(e) pokes once: $name', ({ holdSeconds, from, tolerance }) => {
    const trace = runT1(pointerScenario('poke', buildPointerPoke({ at: 2, x: 0.1, y: 0, holdSeconds }), 3))
    const pokes = touches(trace).filter(entry => entry.touch === 'poke')

    expect(pokes).toHaveLength(1)
    expect(pokes[0].t).toBeGreaterThanOrEqual(from - 1e-9)
    expect(pokes[0].t).toBeLessThanOrEqual(from + tolerance)
  })

  it('(f) moves the head by at most 0.02 per frame across pet start and pet end', () => {
    const { trace, frames } = runWithFrames(pointerScenario('pet-strokes-continuity', strokes(60, 0.3), 6.5))
    const marks = touches(trace).filter(entry => entry.touch !== 'poke')
    expect(marks.map(entry => entry.touch)).toEqual(['pet-start', 'pet-end'])

    for (const mark of marks) {
      const window = frames.filter(entry => Math.abs(entry.t - mark.t) <= 0.5)
      expect(window.length).toBeGreaterThan(10)
      for (let index = 1; index < window.length; index++) {
        const [a, b] = [window[index - 1].frame.pose, window[index].frame.pose]
        expect(Math.abs(b.headX - a.headX)).toBeLessThanOrEqual(0.02)
        expect(Math.abs(b.headY - a.headY)).toBeLessThanOrEqual(0.02)
      }
    }
  })
})
