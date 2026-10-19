import type { HoldCommand } from '@proj-airi/stage-shared/expression-performance'

import type { SlotLeaseSettings } from './slots'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { EmotionHoldPerformer } from './hold'

const settings: SlotLeaseSettings = { speechGrace: 0.25, unstartedExpiry: 10, holdCap: 15 }

function hold(overrides: Partial<HoldCommand> = {}): HoldCommand {
  return { emotion: 'happy', strength: 0.6, holdSeconds: 1.2, until: 'speech', turnId: 'A', ...overrides }
}

function performer() {
  const subject = new EmotionHoldPerformer()
  subject.setSlotSettings(settings)
  return subject
}

afterEach(() => vi.restoreAllMocks())

describe('emotion hold performer', () => {
  it('keeps a speech hold through clips until turn end plus grace', () => {
    const subject = performer()
    subject.applyHolds([hold()], 0)
    subject.onSpeech('clip-start', 'A', 0.1)
    subject.onSpeech('clip-end', 'A', 10)
    subject.onSpeech('turn-end', 'A', 10)
    expect(subject.current(10.24)).toEqual({ emotion: 'happy', strength: 0.6 })
    expect(subject.current(10.25)).toBeNull()
  })

  it('releases a speech hold when its clip is stopped', () => {
    const subject = performer()
    subject.applyHolds([hold()], 0)
    subject.onSpeech('clip-start', 'A', 0.1)
    subject.onSpeech('clip-stopped', 'A', 0.5)
    expect(subject.current(0.5)).toBeNull()
  })

  it('ignores speech of another turn', () => {
    const subject = performer()
    subject.applyHolds([hold()], 0)
    subject.onSpeech('clip-stopped', 'B', 0.5)
    expect(subject.current(0.5)).not.toBeNull()
  })

  it('ends a hold-lifetime hold at holdSeconds', () => {
    const subject = performer()
    subject.applyHolds([hold({ until: 'hold', holdSeconds: 4, turnId: undefined })], 1)
    expect(subject.current(4.99)?.emotion).toBe('happy')
    expect(subject.current(5)).toBeNull()
  })

  it('uses holdSeconds for a muted speech hold', () => {
    const subject = performer()
    subject.setMuted(true)
    subject.applyHolds([hold()], 0)
    expect(subject.current(1.19)?.emotion).toBe('happy')
    expect(subject.current(1.2)).toBeNull()
  })

  it('bounds every lifetime by holdCap', () => {
    const subject = performer()
    subject.applyHolds([hold({ until: 'hold', holdSeconds: 100 })], 0)
    expect(subject.current(14.99)?.emotion).toBe('happy')
    expect(subject.current(15)).toBeNull()
  })

  it('replaces an older hold with a newer one', () => {
    const subject = performer()
    subject.applyHolds([hold({ emotion: 'happy' })], 0)
    subject.applyHolds([hold({ emotion: 'sad', strength: 0.3 })], 1)
    expect(subject.current(1)).toEqual({ emotion: 'sad', strength: 0.3 })
  })

  it('releases on a null emotion', () => {
    const subject = performer()
    subject.applyHolds([hold()], 0)
    subject.applyHolds([hold({ emotion: null })], 1)
    expect(subject.current(1)).toBeNull()
  })

  it('lets a manual hold override the lease and falls back when cleared', () => {
    const subject = performer()
    subject.applyHolds([hold()], 0)
    subject.setManual({ emotion: 'love', strength: 1 })
    expect(subject.current(0.5)).toEqual({ emotion: 'love', strength: 1 })
    subject.setManual(null)
    expect(subject.current(0.5)).toEqual({ emotion: 'happy', strength: 0.6 })
  })

  it('does not resurrect a lease that expired while a manual hold was set', () => {
    const subject = performer()
    subject.applyHolds([hold({ until: 'hold' })], 0)
    subject.setManual({ emotion: 'love', strength: 1 })
    subject.setManual(null)
    expect(subject.current(2)).toBeNull()
  })

  it('lets a hold created after clip-start last through that clip', () => {
    const subject = performer()
    subject.onSpeech('clip-start', 'A', 0.1)
    subject.applyHolds([hold({ holdSeconds: 1 })], 0.5)
    // Beyond unstartedExpiry, but before the cap: this must rely on the active speech fact.
    expect(subject.current(11)?.emotion).toBe('happy')
    subject.onSpeech('clip-end', 'A', 12)
    subject.onSpeech('turn-end', 'A', 12)
    expect(subject.current(12.24)?.emotion).toBe('happy')
    expect(subject.current(12.25)).toBeNull()
  })

  it('lets a replacement hold adopt the active clip', () => {
    const subject = performer()
    subject.applyHolds([hold({ emotion: 'happy' })], 0)
    subject.onSpeech('clip-start', 'A', 0.1)
    subject.applyHolds([hold({ emotion: 'sad', holdSeconds: 1 })], 3)
    expect(subject.current(14)?.emotion).toBe('sad')
  })

  it('uses a fresh lease policy when applied after a completed turn', () => {
    const subject = performer()
    subject.onSpeech('clip-start', 'A', 0.1)
    subject.onSpeech('clip-end', 'A', 2)
    subject.onSpeech('turn-end', 'A', 2)
    subject.applyHolds([hold({ holdSeconds: 1 })], 3)
    expect(subject.current(5)).toEqual({ emotion: 'happy', strength: 0.6 })
    expect(subject.current(13)).toBeNull()
  })

  it('retains ongoing speech even when many other turns arrive', () => {
    const subject = performer()
    subject.onSpeech('clip-start', 'A', 0.1)
    for (let index = 0; index < 12; index++) {
      subject.onSpeech('clip-start', `other-${index}`, 0.2)
      subject.onSpeech('turn-end', `other-${index}`, 0.3)
    }
    subject.applyHolds([hold({ holdSeconds: 1 })], 1)
    expect(subject.current(12)?.emotion).toBe('happy')
  })

  it('does not let a hold adopt a stopped clip', () => {
    const subject = performer()
    subject.onSpeech('clip-start', 'A', 0.1)
    subject.onSpeech('clip-stopped', 'A', 0.2)
    subject.applyHolds([hold({ holdSeconds: 1 })], 0.5)
    // Back to unstarted semantics: waits unstartedExpiry for a clip that may still come.
    expect(subject.current(9.99)?.emotion).toBe('happy')
    expect(subject.current(10.5)).toBeNull()
  })

  it.each([
    ['non-finite holdSeconds', { holdSeconds: Number.NaN }],
    ['negative holdSeconds', { holdSeconds: -1 }],
    // Deliberately malformed boundary data, not a production type escape.
    ['unknown until', JSON.parse('{"until":"forever"}')],
  ])('drops a command with %s and warns', (_name, overrides) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const subject = performer()
    subject.applyHolds([hold(overrides)], 0)
    expect(subject.current(0)).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('keeps the previous hold when a later command is invalid', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const subject = performer()
    subject.applyHolds([hold(), hold({ emotion: 'sad', holdSeconds: Number.NaN })], 0)
    expect(subject.current(0)?.emotion).toBe('happy')
  })
})
