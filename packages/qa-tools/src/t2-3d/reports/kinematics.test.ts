import { describe, expect, it } from 'vitest'

import { prepareTrace } from '../metrics'
import { apexTimes, handPath, kinematicStrokes, pops } from './kinematics'
import { armWorld, moves, rotX, trace } from './test-runs'

const DEG = Math.PI / 180

describe('kinematic strokes (plan 2.1)', () => {
  it('recovers every apex of minimum-jerk stroke trains at 110 to 250 ms and gain 0.5 to 1.5 within one frame', () => {
    const designed: number[] = []
    const list: { start: number, duration: number, by: number }[] = []
    let t = 1
    for (const duration of [0.11, 0.15, 0.2, 0.25]) {
      // 4a's smallest stroke (frame, 0.0583 A) at gain 0.5, then the beat (0.067 A) at gains 0.5, 1 and 1.5. The analytic
      // arm turns its upper arm by the same angle in radians. As in 4a, the post-stroke hold drifts 1.5 % A along the
      // stroke; a perfectly still hold leaves only float32 ripple.
      for (const amplitude of [0.0583 * 0.5, 0.067 * 0.5, 0.067, 0.067 * 1.5]) {
        for (const sign of [1, -1]) {
          list.push({ start: t, duration, by: sign * amplitude }, { start: t + duration, duration: 0.4, by: sign * 0.015 })
          designed.push(t + duration)
          t += duration + 0.5
        }
      }
    }
    const p = prepareTrace(trace({ seconds: t + 1, scenario: 'talk', world: armWorld({ upper: moves(list) }, {}) }))
    const apexes = apexTimes(p, ['left']).map(a => a.t)
    for (const end of designed)
      expect(Math.min(...apexes.map(a => Math.abs(a - end)))).toBeLessThanOrEqual(1 / 60 + 1e-9)
    // R1 stopped (unit M2): D_min 0.0146 A is below 4a's own 0.015 A hold drift, so each drift counts as a stroke too.
    expect(apexes).toHaveLength(2 * designed.length)
  })

  it('measures the hand in the frame the shoulder hangs from, so a trunk turn that carries a still arm is no stroke', () => {
    const carried = new Set(['upperChest', 'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand'])
    const pitch = moves(Array.from({ length: 8 }, (_, k) => ({ start: 1 + k, duration: 0.15, by: (k % 2 ? -1 : 1) * 0.2 })))
    const p = prepareTrace(trace({ seconds: 10, scenario: 'talk', world: (bone, t) => carried.has(bone) ? rotX(pitch(t)) : [0, 0, 0, 1] }))
    expect(kinematicStrokes(handPath(p, 'left')!)).toEqual([])
    expect(handPath(p, 'left')?.frame).toBe('upperChest')
  })

  it('finds no stroke when nothing moves', () => {
    const p = prepareTrace(trace({ seconds: 10, scenario: 'talk' }))
    expect(kinematicStrokes(handPath(p, 'left')!)).toEqual([])
  })
})

describe('pop classifier (plan 2.6)', () => {
  const chop = (start: number, duration: number) => moves([{ start, duration, by: 0.14 * 1.5 }])

  it.each([0.11, 0.15, 0.2, 0.25])('counts no pop on a %s s stroke at the largest designed amplitude', (duration) => {
    const p = prepareTrace(trace({ seconds: 3, scenario: 'talk', world: armWorld({ upper: chop(1, duration) }, {}) }))
    expect(pops(p, 'leftUpperArm')).toEqual([])
  })

  // A 2.3 deg one-frame step is a 138 deg/s spike, which the rule sees only where the stroke is slower. Plan 2.6 wants
  // every step found; 110 and 150 ms strokes miss mid-stroke ones (unit M controls/pops-injection.txt).
  it.each([[0.2, [-0.2, 0, 0.25, 0.5, 0.75, 1, 1.2]], [0.25, [-0.2, 0, 0.25, 0.5, 0.75, 1, 1.2]], [0.11, [-0.2, 0, 1, 1.2]], [0.15, [-0.2, 0, 1, 1.2]]] as const)('finds a 2.3 degree one-frame step injected into a %s s stroke', (duration, phases) => {
    for (const phase of phases) {
      const at = Math.round((1 + phase * duration) * 60) / 60
      const upper = (t: number) => chop(1, duration)(t) + (t >= at - 1e-9 ? 2.3 * DEG : 0)
      const found = pops(prepareTrace(trace({ seconds: 3, scenario: 'talk', world: armWorld({ upper }, {}) })), 'leftUpperArm')
      expect(found, `phase ${phase}`).toHaveLength(1)
      expect(Math.abs(found[0].t - at)).toBeLessThanOrEqual(2 / 60)
    }
  })
})
