import type { SalienceKey } from '.'

import { describe, expect, it } from 'vitest'

import {
  activityTierTopicKey,
  activityTopicKey,
  BASE_SALIENCE,
  contextTopicKey,
  HALF_LIFE_MS,
  initialSituationState,
  LONG_SESSION_SALIENCE_MAX,
  longSessionSalience,
  notifyTopicKey,
  PRESENCE_RETURN_TOPIC_KEY,
  WAKE_TOPIC_KEY,
} from '.'

const MINUTE_MS = 60_000

describe('topic keys', () => {
  it('builds the documented formats', () => {
    expect(activityTopicKey('code')).toBe('activity:code')
    expect(activityTierTopicKey('code', 2)).toBe('activity:code:tier:2')
    expect(contextTopicKey('vision')).toBe('context:vision')
    expect(notifyTopicKey('plugin:calendar', 'evt-1')).toBe('notify:plugin:calendar:evt-1')
    expect(PRESENCE_RETURN_TOPIC_KEY).toBe('presence:return')
    expect(WAKE_TOPIC_KEY).toBe('wake')
  })

  it('gives the same notify key for a re-enqueued reminder and a different one per event id', () => {
    expect(notifyTopicKey('scheduler', 'r1')).toBe(notifyTopicKey('scheduler', 'r1'))
    expect(notifyTopicKey('scheduler', 'r1')).not.toBe(notifyTopicKey('scheduler', 'r2'))
  })
})

describe('salience constants', () => {
  it.each<[SalienceKey, number, number]>([
    ['app-switch', 0.5, 20],
    ['long-session', 0.6, 30],
    ['returned', 0.6, 15],
    ['went-away', 0.2, 10],
    ['wake', 0.5, 10],
    ['switching-burst', 0.35, 10],
    ['context', 0.3, 30],
    ['context-vision', 0.4, 30],
    ['notify-immediate', 1.0, 10],
    ['notify-soon', 0.7, 30],
    ['notify-later', 0.4, 60],
    ['notify-critical', 1.0, 30],
  ])('%s starts at %s with a %s min half-life', (key, salience, halfLifeMinutes) => {
    expect(BASE_SALIENCE[key]).toBe(salience)
    expect(HALF_LIFE_MS[key]).toBe(halfLifeMinutes * MINUTE_MS)
  })

  it.each([
    [1, 0.6],
    [2, 0.65],
    [3, 0.7],
    [4, 0.75],
    [9, LONG_SESSION_SALIENCE_MAX],
    [0, 0.6],
    [-3, 0.6],
    [Number.NaN, 0.6],
    [Number.POSITIVE_INFINITY, 0.6],
  ])('long-session tier %s => %s', (tier, expected) => {
    expect(longSessionSalience(tier)).toBeCloseTo(expected, 10)
  })
})

describe('initialSituationState', () => {
  it('starts unknown and survives a JSON round trip', () => {
    expect(initialSituationState.presence.state).toBe('unknown')
    expect(initialSituationState.busy.state).toBe('unknown')
    expect(JSON.parse(JSON.stringify(initialSituationState))).toEqual(initialSituationState)
    expect(initialSituationState.conversation.lastUnpromptedTopic).toBeNull()
    expect(initialSituationState.tracking.switchTimes).toEqual([])
  })

  it('is frozen so the reducer cannot mutate the shared start value', () => {
    expect(Object.isFrozen(initialSituationState)).toBe(true)
    expect(Object.isFrozen(initialSituationState.events)).toBe(true)
    expect(Object.isFrozen(initialSituationState.contexts)).toBe(true)
    expect(Object.isFrozen(initialSituationState.tracking)).toBe(true)
    expect(Object.isFrozen(initialSituationState.tracking.switchTimes)).toBe(true)
  })
})
