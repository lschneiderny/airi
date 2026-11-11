import { defaultExpressionPerformanceSettings } from '@proj-airi/stage-shared/expression-performance'
import { describe, expect, it, vi } from 'vitest'

import { MMDNaturalAdapter } from './adapter'

const input = {
  performance: { mode: 'idle', attention: 'cursor', away: false, reactSeq: 0, reactKind: 'none' },
  energy: 0.5,
  voice: { speaking: false, speechActiveOrRecent: false, level: 0 },
  cursor: { x: 4, y: 0 },
  chat: null,
  placement: null,
  emotionStrengths: {},
} as const

const happy = { id: 'happy', emotion: 'happy', nominal: 0.7, intensity: 0.7, band: 'clear', escalation: false } as const

function fixture() {
  return { adapter: new MMDNaturalAdapter('fixture') }
}

describe('mmd Natural adapter', () => {
  it('adds and removes event listeners without changing seeded motion or event counts', () => {
    const { adapter } = fixture()
    const { adapter: control } = fixture()
    const listener = vi.fn()
    const unsubscribe = adapter.onEvent(listener)
    for (const current of [adapter, control])
      current.impulse(happy)
    for (let frame = 0; frame < 120; frame++) {
      adapter.advance(1 / 60, input)
      control.advance(1 / 60, input)
      expect(adapter.bodyFrame.frame).toEqual(control.bodyFrame.frame)
    }
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ kind: 'impulse', emotion: 'happy' }))
    unsubscribe()
    listener.mockClear()
    for (const current of [adapter, control]) {
      current.gesture('nod', 1)
      current.advance(1, input)
    }
    expect(listener).not.toHaveBeenCalled()
    expect(adapter.diagnostics.events).toBe(control.diagnostics.events)
  })

  it('performs no emotion whose per-model strength is 0', () => {
    const { adapter } = fixture()
    const silenced = { ...input, emotionStrengths: { happy: 0 } }
    adapter.impulse(happy)
    adapter.advance(2 / 120, silenced, 100)
    adapter.advance(2 / 120, silenced, 100 + 2 / 120)
    expect(adapter.mood.valence).toBe(0)
    const { adapter: standard } = fixture()
    standard.impulse(happy)
    standard.advance(2 / 120, input, 100)
    standard.advance(2 / 120, input, 100 + 2 / 120)
    expect(standard.mood.valence).toBeGreaterThan(0)
  })

  it('adds a decided mood dose at the next frame', () => {
    const { adapter } = fixture()
    adapter.addMood({ id: 'touch-1-pet', valence: 0.4, arousal: 0, tension: 0 })
    expect(adapter.mood.valence).toBe(0)
    adapter.advance(2 / 120, input, 100)
    adapter.advance(2 / 120, input, 100 + 2 / 120)
    expect(adapter.mood.valence).toBeGreaterThan(0)
  })

  it('plays a cue gesture through the head pose it writes', () => {
    const { adapter } = fixture()
    const { adapter: control } = fixture()
    adapter.gesture('nod', 2)
    let largest = 0
    for (let step = 1; step <= 60; step++) {
      adapter.advance(2 / 120, input, 100 + step * 2 / 120)
      control.advance(2 / 120, input, 100 + step * 2 / 120)
      largest = Math.max(largest, Math.abs(adapter.bodyFrame.frame.pose.headY - control.bodyFrame.frame.pose.headY))
    }
    expect(largest).toBeGreaterThan(0.05)
  })

  it('queues episodes until settings reach the next frame and exposes the resulting mood', () => {
    const { adapter } = fixture()
    adapter.setPerformanceSettings({ ...defaultExpressionPerformanceSettings, moodDynamics: { ...defaultExpressionPerformanceSettings.moodDynamics, clearGain: 0 } })
    const impulse = vi.spyOn(adapter.natural, 'impulse')
    adapter.impulse({ id: 'happy', emotion: 'happy', nominal: 0.7, intensity: 0.7, band: 'clear', escalation: false })
    expect(impulse).not.toHaveBeenCalled()
    adapter.advance(2 / 120, input, 100)
    expect(impulse).toHaveBeenCalledOnce()
    adapter.advance(2 / 120, input, 100 + 2 / 120)
    expect(adapter.mood.valence).toBe(0)
    const { adapter: enabled } = fixture()
    enabled.impulse({ id: 'happy', emotion: 'happy', nominal: 0.7, intensity: 0.7, band: 'clear', escalation: false })
    enabled.advance(2 / 120, input, 100)
    enabled.advance(2 / 120, input, 100 + 2 / 120)
    expect(enabled.mood.valence).toBeGreaterThan(0)
  })

  it('hands the face baseline to Natural, whose face output feeds the morph mapping', () => {
    const { adapter } = fixture()
    const { adapter: control } = fixture()
    const forwarded = vi.spyOn(adapter.natural, 'setFaceBaseline')
    const baseline = { mouthForm: -0.3, eyeOpen: 0, blinkRateOffset: 0, browAngle: 0 }
    adapter.setFaceBaseline(baseline)
    expect(forwarded).toHaveBeenCalledWith(baseline)
    // Ten seconds is more than six filter time constants of 1.5 s.
    for (let step = 0; step < 600; step++) {
      adapter.advance(1 / 60, input)
      control.advance(1 / 60, input)
    }
    expect(adapter.bodyFrame.frame.face.mouthForm - control.bodyFrame.frame.face.mouthForm).toBeCloseTo(-0.3, 2)
  })

  it('uses the conductor clock for holds, remembers ongoing speech, and releases on stop or mute', () => {
    const { adapter } = fixture()
    const held = vi.spyOn(adapter.natural, 'setHeldEmotion')
    adapter.onSpeech('clip-start', 'turn', 100)
    adapter.applyHolds([{ emotion: 'happy', strength: 0.7, holdSeconds: 1, until: 'speech', turnId: 'turn' }], 100)
    adapter.advance(1 / 60, input, 102)
    expect(held).toHaveBeenLastCalledWith(expect.objectContaining({ emotion: 'happy', strength: 0.7 }), expect.any(Number))
    adapter.onSpeech('clip-stopped', 'other-turn', 102)
    adapter.advance(1 / 60, input, 102.1)
    expect(held).toHaveBeenLastCalledWith(expect.objectContaining({ emotion: 'happy' }), expect.any(Number))
    adapter.onSpeech('clip-stopped', 'turn', 102.1)
    adapter.advance(1 / 60, input, 102.2)
    expect(held).toHaveBeenLastCalledWith(null, expect.any(Number))
    adapter.applyHolds([{ emotion: 'sad', strength: 0.6, holdSeconds: 1, until: 'speech', turnId: 'next' }], 103)
    adapter.setMuted(true)
    adapter.advance(1 / 60, input, 104)
    expect(held).toHaveBeenLastCalledWith(null, expect.any(Number))
  })
})
