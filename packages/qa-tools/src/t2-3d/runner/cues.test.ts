import type { MotionTraceEvent } from '@proj-airi/motion-driver-humanoid/motion-trace'

import { moveStep, restHold } from '@proj-airi/motion-driver-natural/cursor-attention'
import { expect, it, vi } from 'vitest'

import { Motion3dCueDriver } from './cues'

function boundary() {
  const adapter = { impulse: vi.fn(), gesture: vi.fn(), poke: vi.fn(), setPet: vi.fn() }
  const events: MotionTraceEvent[] = []
  const driver = new Motion3dCueDriver(adapter, 2, event => events.push(event))
  return { adapter, events, driver }
}

it('maps gaze head widths and clearing to attention and labelled events', () => {
  const { driver, events } = boundary()
  driver.apply({ at: 0, kind: 'gaze', cursor: { x: 1.5, y: 0 } }, 10)
  expect(driver.cursor).toEqual({ x: 1.5, y: 0 })
  expect(driver.performance.attention).toBe('cursor')
  expect(events[0]).toMatchObject({ t: 10, kind: 'gaze-jump', yaw: Math.asin(0.5), pitch: 0, source: 'scenario' })
  driver.apply({ at: 1, kind: 'gaze', cursor: null }, 11)
  expect(driver.cursor).toBeNull()
  expect(driver.performance.attention).toBe('camera')
})

it('keeps a held gaze cursor moving by Natural\'s move step, as a hand on the mouse does', () => {
  for (const degrees of [0, 15, 80, -80]) {
    const { driver } = boundary()
    const target = { x: 3 * Math.sin(degrees * Math.PI / 180), y: 0 }
    driver.apply({ at: 0, kind: 'gaze', cursor: target }, 10)
    let anchor = { ...target }
    let movedAt = 10
    let longestRest = 0
    let farthest = 0
    for (let frame = 0; frame <= 5 * 60; frame++) {
      const t = 10 + frame / 60
      driver.step(t)
      const cursor = driver.cursor!
      // The scenario maps a cursor to angles by asin(x / 3) and asin(y / 3).
      expect(Math.max(Math.abs(cursor.x), Math.abs(cursor.y)), `${degrees} deg`).toBeLessThanOrEqual(3)
      farthest = Math.max(farthest, Math.hypot(Math.asin(cursor.x / 3) - Math.asin(target.x / 3), Math.asin(cursor.y / 3)) * 180 / Math.PI)
      if (Math.hypot(cursor.x - anchor.x, cursor.y - anchor.y) >= moveStep) {
        anchor = { ...cursor }
        movedAt = t
      }
      longestRest = Math.max(longestRest, t - movedAt)
    }
    expect(longestRest, `${degrees} deg`).toBeLessThan(restHold)
    expect(farthest, `${degrees} deg`).toBeLessThan(2.5)
  }
})

it('samples voice envelopes at 60 Hz, records peaks when due and ends speech', () => {
  const { driver, events } = boundary()
  driver.apply({ at: 0, kind: 'voice', seconds: 0.05, envelope: [0.2, 0.9, 0.4], emphasis: [{ at: 1 / 60, strength: 0.9 }] }, 10)
  driver.step(10 + 1 / 60)
  expect(driver.voice).toEqual({ speaking: true, speechActiveOrRecent: true, level: 0.9 })
  expect(driver.performance.mode).toBe('talking')
  expect(events.filter(event => event.kind === 'emphasis')).toEqual([{ t: 10 + 1 / 60, kind: 'emphasis', strength: 0.9, source: 'scenario' }])
  driver.step(10.05)
  expect(driver.voice.speaking).toBe(false)
  expect(driver.voice.level).toBe(0)
  expect(driver.performance.mode).toBe('idle')
})

it('sends emotion pulses at their band dose and labels placebo without a pulse', () => {
  const { adapter, driver, events } = boundary()
  driver.apply({ at: 0, kind: 'emotion', emotion: 'angry', band: 'clear', trialId: 'trial' }, 10)
  expect(adapter.impulse).toHaveBeenCalledWith({ id: 'trial', emotion: 'angry', nominal: 0.6, intensity: 0.6, band: 'clear', escalation: false })
  driver.apply({ at: 12, kind: 'placebo', trialId: 'null' }, 22)
  expect(adapter.impulse).toHaveBeenCalledTimes(1)
  expect(events[1]).toMatchObject({ kind: 'emotion', phase: 'placebo', trialId: 'null' })
})

it('forwards gesture counts to the Natural adapter', () => {
  const { adapter, driver } = boundary()
  driver.apply({ at: 0, kind: 'gesture', gesture: 'nod', count: 2 }, 0)
  expect(adapter.gesture).toHaveBeenCalledWith('nod', 2)
})

it('maps poke and pet start/end to their production touch inputs', () => {
  const { adapter, driver } = boundary()
  driver.apply({ at: 0, kind: 'touch', touch: 'poke', region: 'body', x: 0.2, y: -0.4 }, 0)
  driver.apply({ at: 1, kind: 'touch', touch: 'pet-start', region: 'head', x: 0.1, y: 0.3 }, 1)
  driver.apply({ at: 2, kind: 'touch', touch: 'pet-end', region: 'head', x: 0, y: 0 }, 2)
  expect(adapter.poke).toHaveBeenCalledWith('body', { x: 0.2, y: -0.4 })
  expect(adapter.setPet.mock.calls).toEqual([[{ x: 0.1, y: 0.3 }], [null]])
})

it('scales goals by leg length and signals cancellation', () => {
  const { driver, events } = boundary()
  driver.apply({ at: 0, kind: 'goal', x: 30, pace: 'stroll' }, 0)
  expect(driver.debugGoal).toEqual({ seq: 1, x: 60, pace: 'stroll' })
  driver.apply({ at: 1, kind: 'goal', x: null, pace: 'walk' }, 1)
  expect(driver.debugGoal).toBeNull()
  expect(driver.goalCancelled).toBe(true)
  expect(events[1]).toEqual({ t: 1, kind: 'goal', x: null, pace: null })
})

it('sets activity and away and records observation markers without adapter calls', () => {
  const { driver, events } = boundary()
  driver.apply({ at: 0, kind: 'activity', mode: 'watching', away: true }, 0)
  driver.apply({ at: 1, kind: 'marker', label: 'observe' }, 1)
  expect(driver.performance).toMatchObject({ mode: 'watching', away: true })
  expect(events).toEqual([{ t: 0, kind: 'mode', mode: 'watching' }, { t: 1, kind: 'marker', label: 'observe' }])
})
