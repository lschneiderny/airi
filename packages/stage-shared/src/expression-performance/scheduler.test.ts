import type { PlanRequest, SchedulerState } from './scheduler'
import type { TimingEvent } from './types'

import { describe, expect, it } from 'vitest'

import { cancelTurn, createSchedulerState, earliestExpiry, expire, schedule, take } from './scheduler'

function plan(reactionId: string, overrides: Partial<PlanRequest<string>> = {}): PlanRequest<string> {
  return { reactionId, slot: 'sentence_start', turnId: 'turn-a', notBefore: 0, expiresAt: 6, priority: 0, intensity: 0.6, payload: reactionId, ...overrides }
}

function event(kind: TimingEvent['kind'], at: number, turnId = 'turn-a'): TimingEvent {
  return { id: `${kind}@${at}`, kind, turnId, at }
}

function build(...requests: PlanRequest<string>[]) {
  return requests.reduce<SchedulerState<string>>(schedule, createSchedulerState())
}

describe('decision scheduler', () => {
  it('takes a plan scheduled from a marker before any playback with the turn\'s next sentence_start', () => {
    // The marker fires at 1.0 s, before the first clip of its turn starts at 1.5 s.
    const state = build(plan('happy', { notBefore: 1, expiresAt: 7 }))

    const result = take(state, event('sentence_start', 1.5))

    expect(result.plans.map(item => item.payload)).toEqual(['happy'])
    expect(result.state.plans).toEqual([])
  })

  it('takes a plan only within notBefore <= at < expiresAt', () => {
    const state = build(plan('happy', { notBefore: 2, expiresAt: 4 }))

    expect(take(state, event('sentence_start', 1.99)).plans).toEqual([])
    expect(take(state, event('sentence_start', 4)).plans).toEqual([])
    expect(take(state, event('sentence_start', 2)).plans.map(item => item.payload)).toEqual(['happy'])
  })

  it('rejects an event of a different turn or kind', () => {
    const state = build(plan('happy'))

    expect(take(state, event('sentence_start', 1, 'turn-b')).plans).toEqual([])
    expect(take(state, event('pause', 1)).plans).toEqual([])
    expect(take(state, event('sentence_start', 1, 'turn-b')).state).toBe(state)
  })

  it('orders released plans by priority, then intensity, then insertion order', () => {
    const state = build(
      plan('low', { priority: 0, intensity: 0.9 }),
      plan('first-tie', { priority: 1, intensity: 0.6 }),
      plan('strong', { priority: 1, intensity: 0.9 }),
      plan('second-tie', { priority: 1, intensity: 0.6 }),
    )

    expect(take(state, event('sentence_start', 1)).plans.map(item => item.payload)).toEqual(['strong', 'first-tie', 'second-tie', 'low'])
  })

  it('consumes each plan once', () => {
    const first = take(build(plan('happy')), event('sentence_start', 1))

    const second = take(first.state, event('sentence_start', 2))

    expect(first.plans).toHaveLength(1)
    expect(second.plans).toEqual([])
  })

  it('cancels only the plans of one turn', () => {
    const state = build(plan('a1'), plan('b1', { turnId: 'turn-b' }), plan('a2', { slot: 'pause' }))

    const cancelled = cancelTurn(state, 'turn-a')

    expect(cancelled.plans.map(item => item.payload)).toEqual(['b1'])
    expect(take(cancelled, event('sentence_start', 1)).plans).toEqual([])
  })

  it('expires plans at expiresAt in expiry order and reports the earliest pending expiry', () => {
    const state = build(plan('late', { expiresAt: 8 }), plan('early', { expiresAt: 5 }), plan('tie', { expiresAt: 5 }))

    expect(earliestExpiry(state)).toBe(5)
    expect(expire(state, 4.99).expired).toEqual([])

    const result = expire(state, 5)

    expect(result.expired.map(item => item.payload)).toEqual(['early', 'tie'])
    expect(earliestExpiry(result.state)).toBe(8)
    expect(earliestExpiry(expire(result.state, 8).state)).toBeNull()
  })

  it('keeps plain JSON state and never mutates its input', () => {
    const state = build(plan('happy'), plan('sad', { turnId: 'turn-b' }))
    const snapshot = JSON.parse(JSON.stringify(state)) as SchedulerState<string>

    take(state, event('sentence_start', 1))
    cancelTurn(state, 'turn-b')
    expire(state, 10)

    expect(state).toEqual(snapshot)
    expect(take(snapshot, event('sentence_start', 1))).toEqual(take(state, event('sentence_start', 1)))
  })
})
