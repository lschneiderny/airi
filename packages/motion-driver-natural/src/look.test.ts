import type { NaturalGlanceEvent } from './frame-types'

import { describe, expect, it } from 'vitest'

import { NaturalMotion } from './natural-motion'

const point = { x: 0.4, y: -0.2 }

describe('look tools', () => {
  it.each([1, 7, 41])('holds for eight active seconds across posture shifts, seed %i', (seed) => {
    const motion = new NaturalMotion({ seed })
    const events: NaturalGlanceEvent[] = []
    motion.setObserver((event) => {
      if (event.kind === 'glance')
        events.push(event)
    })
    const wallStart = 10_000
    motion.advance(wallStart)
    motion.look(point, 8, wallStart)
    for (let frame = 1; frame < 8 * 60; frame++) {
      const sampled = motion.advance(wallStart + frame / 60)
      if (frame >= 12)
        expect(sampled.fixation).toEqual(point)
    }
    expect(events).toEqual([{ kind: 'glance', cause: 'look-tool', outcome: 'started', point, hold: 8, at: 1 / 120 }])
    expect(motion.advance(wallStart + 8.2).fixation).not.toEqual(point)
  })

  it('keeps the hold on active time when wall time advances during suspension', () => {
    const motion = new NaturalMotion({ seed: 7 })
    motion.advance(0)
    motion.look(point, 8, 0)
    motion.advance(1)
    motion.setSuspended(true, 1)
    expect(motion.advance(1000).fixation).toEqual(point)
    motion.setSuspended(false, 1000)
    expect(motion.advance(1006).fixation).toEqual(point)
    expect(motion.advance(1008).fixation).not.toEqual(point)
  })

  it('reports a missing target as refused without changing the sampled frame', () => {
    const motion = new NaturalMotion({ seed: 7 })
    const control = new NaturalMotion({ seed: 7 })
    const events: NaturalGlanceEvent[] = []
    motion.setObserver((event) => {
      if (event.kind === 'glance')
        events.push(event)
    })
    motion.advance(0)
    control.advance(0)
    motion.look(null, 8, 0)
    expect(motion.advance(0.2)).toEqual(control.advance(0.2))
    expect(events).toEqual([{ kind: 'glance', cause: 'look-tool', outcome: 'refused', point: null, hold: 8, at: 1 / 120 }])
  })

  it('lets a poke interrupt the look and meet the camera', () => {
    const motion = new NaturalMotion({ seed: 7 })
    const events: NaturalGlanceEvent[] = []
    motion.setObserver((event) => {
      if (event.kind === 'glance')
        events.push(event)
    })
    motion.advance(0)
    motion.look(point, 8, 0)
    expect(motion.advance(1).fixation).toEqual(point)
    motion.poke('head', 0.2, -0.3, 1)
    expect(motion.advance(1.2).fixation).toEqual({ x: 0, y: 0 })
    expect(events.map(event => [event.cause, event.outcome])).toEqual([['look-tool', 'started'], ['poke', 'started']])
  })
})
