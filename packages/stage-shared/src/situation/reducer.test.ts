import type { ActivityObservation, ContextObservation, NotifyObservation, Observation, PresenceObservation, SituationEvent, SituationState } from '.'

import { describe, expect, it } from 'vitest'

import {
  advanceSituation,
  effectiveSalience,
  forgetForeground,
  forgetSource,
  initialSituationState,
  markAddressed,
  markShown,
  notifyTopicKey,
  reduceSituation,
  RETURNED_AFTER_AWAY_MS,
  SITUATION_EVENTS_MAX,
} from '.'

const T0 = 1_700_000_000_000
const SEC = 1000
const MIN = 60 * SEC

function activity(appId: string, atMs: number, overrides: Partial<ActivityObservation> = {}): ActivityObservation {
  return { kind: 'activity', appId, label: appId.toUpperCase(), category: 'other', title: null, atMs, ...overrides }
}

function presence(state: PresenceObservation['state'], atMs: number): PresenceObservation {
  return { kind: 'presence', state, atMs }
}

function context(sourceKey: string, text: string, atMs: number, overrides: Partial<ContextObservation> = {}): ContextObservation {
  return { kind: 'context', sourceKey, text, atMs, ...overrides }
}

function notify(overrides: Partial<NotifyObservation> = {}): NotifyObservation {
  return {
    kind: 'notify',
    sourceKey: 'plugin:widget',
    eventId: 'evt-1',
    headline: 'Tea is ready',
    urgency: 'soon',
    reminder: false,
    critical: false,
    atMs: T0,
    ...overrides,
  }
}

/** Feeds observations in order, each reduced at its own `atMs`, carrying state between them. */
function run(observations: Observation[], state: SituationState = initialSituationState): SituationState {
  for (const observation of observations)
    state = reduceSituation(state, observation, observation.atMs)
  return state
}

function eventsOf(state: SituationState, kind: SituationEvent['kind']): SituationEvent[] {
  return state.events.filter(event => event.kind === kind)
}

describe('reduceSituation activity', () => {
  it('creates the app-switch event only after the app settles for 75 s', () => {
    const state = run([activity('z', T0 - 10 * MIN), activity('a', T0)])

    expect(eventsOf(advanceSituation(state, T0 + 74_999), 'app-switch').filter(e => e.topicKey === 'activity:a')).toHaveLength(0)
    const settled = advanceSituation(state, T0 + 75_000)
    const events = eventsOf(settled, 'app-switch').filter(e => e.topicKey === 'activity:a')
    expect(events).toHaveLength(1)
    expect(events[0].atMs).toBe(T0 + 75_000)
    expect(settled.activity?.appId).toBe('a')
  })

  it('emits no app-switch event for the first app ever seen', () => {
    const state = advanceSituation(run([activity('a', T0)]), T0 + 10 * MIN)

    expect(eventsOf(state, 'app-switch')).toHaveLength(0)
  })

  it('merges a detour that returns within 30 s and keeps the original span', () => {
    const base = run([activity('z', T0 - 10 * MIN), activity('a', T0)])
    const state = advanceSituation(run([activity('b', T0 + 10 * SEC), activity('a', T0 + 30 * SEC)], base), T0 + 5 * MIN)

    expect(state.activity).toMatchObject({ appId: 'a', sinceMs: T0 })
    expect(eventsOf(state, 'app-switch').map(e => e.topicKey)).toEqual(['activity:a'])
    expect(state.recentActivities.map(a => a.appId)).toEqual(['z'])
  })

  it('does not merge a detour longer than 30 s', () => {
    const base = run([activity('z', T0 - 10 * MIN), activity('a', T0)])
    const state = run([activity('b', T0 + 10 * SEC), activity('a', T0 + 41 * SEC)], base)

    expect(state.activity).toMatchObject({ appId: 'a', sinceMs: T0 + 41 * SEC })
    expect(state.recentActivities.map(a => a.appId)).toEqual(['b', 'a', 'z'])
  })

  it('emits one burst event for 3 switches within 2 min', () => {
    const base = run([activity('a', T0)])
    const two = run([activity('b', T0 + 30 * SEC), activity('c', T0 + 60 * SEC)], base)
    expect(eventsOf(two, 'switching-burst')).toHaveLength(0)

    const three = run([activity('d', T0 + 90 * SEC)], two)
    expect(eventsOf(three, 'switching-burst').map(e => e.text)).toEqual(['switching between C and D'])

    const four = run([activity('e', T0 + 100 * SEC)], three)
    expect(eventsOf(four, 'switching-burst')).toHaveLength(1)
    expect(eventsOf(four, 'app-switch')).toHaveLength(0)
  })

  it('does not count switches older than 2 min as a burst', () => {
    const state = run([activity('a', T0), activity('b', T0 + 60 * SEC), activity('c', T0 + 130 * SEC), activity('d', T0 + 190 * SEC)])

    expect(eventsOf(state, 'switching-burst')).toHaveLength(0)
  })

  it('emits long-session events at exactly 30 min, 1 h, 2 h and 3 h, once each', () => {
    let state = run([activity('a', T0, { label: 'Elden Ring', category: 'game' })])
    const seen: SituationEvent[] = []
    const record = (next: SituationState): void => {
      for (const event of next.events) {
        if (event.kind === 'long-session' && !seen.some(s => s.id === event.id))
          seen.push(event)
      }
    }

    state = advanceSituation(state, T0 + 30 * MIN - 1)
    expect(eventsOf(state, 'long-session')).toHaveLength(0)
    state = advanceSituation(state, T0 + 30 * MIN)
    expect(eventsOf(state, 'long-session').map(e => [e.topicKey, e.text, e.atMs])).toEqual([
      ['activity:a:tier:1', 'Elden Ring (game) for about 30 min', T0 + 30 * MIN],
    ])
    record(state)

    for (let minute = 31; minute <= 190; minute += 1) {
      state = advanceSituation(state, T0 + minute * MIN)
      record(state)
      if (minute === 59)
        expect(state.events.some(e => e.topicKey === 'activity:a:tier:2')).toBe(false)
      if (minute === 60)
        expect(state.events.some(e => e.topicKey === 'activity:a:tier:2')).toBe(true)
    }
    expect(seen.map(e => [e.topicKey, e.tier, e.atMs - T0])).toEqual([
      ['activity:a:tier:1', 1, 30 * MIN],
      ['activity:a:tier:2', 2, 60 * MIN],
      ['activity:a:tier:3', 3, 120 * MIN],
      ['activity:a:tier:4', 4, 180 * MIN],
    ])
    expect(seen.map(e => e.text.split('about ')[1])).toEqual(['30 min', '1 h', '2 h', '3 h'])
  })

  it('catches up every missed tier when advanced far ahead in one step', () => {
    const state = advanceSituation(run([activity('a', T0)]), T0 + 4 * 60 * MIN)

    expect(eventsOf(state, 'long-session').map(e => e.tier)).toEqual([4])
    const midway = advanceSituation(run([activity('a', T0)]), T0 + 125 * MIN)
    expect(eventsOf(midway, 'long-session').map(e => e.tier)).toEqual([1, 2, 3])
  })

  it('updates the title without an event when only the title changes', () => {
    const base = run([activity('z', T0 - 10 * MIN), activity('a', T0, { title: 'one' })])
    const state = run([activity('a', T0 + 10 * MIN, { title: 'two' })], base)

    expect(state.activity).toMatchObject({ appId: 'a', title: 'two', sinceMs: T0 })
    expect(eventsOf(state, 'app-switch').map(e => e.atMs)).toEqual([T0 + 75 * SEC])
    expect(state.recentActivities.map(a => a.appId)).toEqual(['z'])
  })

  it('keeps at most 5 recent activities, newest first', () => {
    const apps = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    const state = run(apps.map((appId, index) => activity(appId, T0 + index * 10 * MIN)))

    expect(state.recentActivities.map(a => a.appId)).toEqual(['g', 'f', 'e', 'd', 'c'])
  })

  it('ignores activity from selfAppIds without touching state', () => {
    const base = run([activity('a', T0)])
    const state = reduceSituation(base, activity('AIRI', T0 + 5 * MIN), T0 + 5 * MIN, { selfAppIds: ['airi'] })

    expect(state.activity?.appId).toBe('a')
    expect(state.recentActivities).toEqual([])
  })
})

describe('reduceSituation presence', () => {
  it('emits returned only when away for at least 5 min', () => {
    const shortAway = run([presence('here', T0 - MIN), presence('away', T0), presence('here', T0 + 5 * MIN - 1)])
    expect(eventsOf(shortAway, 'returned')).toHaveLength(0)
    expect(eventsOf(shortAway, 'went-away')).toHaveLength(0)

    const longAway = run([presence('here', T0 - MIN), presence('away', T0), presence('here', T0 + 5 * MIN)])
    expect(eventsOf(longAway, 'returned').map(e => [e.topicKey, e.text])).toEqual([['presence:return', 'came back after 5 min away']])
    expect(eventsOf(longAway, 'went-away')).toHaveLength(1)
  })

  it('creates no stepped-away topic for an instant lock and unlock', () => {
    const state = run([presence('here', T0 - MIN), presence('away', T0), presence('here', T0 + SEC)])

    expect(eventsOf(advanceSituation(state, T0 + 10 * MIN), 'went-away')).toHaveLength(0)
    expect(state.presence).toMatchObject({ state: 'here', sinceMs: T0 + SEC })
  })

  it.each(['unlock', 'resume'] as const)('creates no wake topic and no away topic for a 1 s lock that ends with %s', (cause) => {
    const state = run([presence('here', T0 - MIN), presence('away', T0), { kind: 'wake', cause, atMs: T0 + SEC }, presence('here', T0 + SEC)])

    expect(state.events).toEqual([])
    expect(advanceSituation(state, T0 + 10 * MIN).events).toEqual([])
  })

  it('judges a wake that arrives after the return by the away span that just ended', () => {
    const instant = run([presence('here', T0 - MIN), presence('away', T0), presence('here', T0 + 495), { kind: 'wake', cause: 'unlock', atMs: T0 + 1003 }])
    expect(instant.events).toEqual([])

    const long = run([presence('here', T0 - MIN), presence('away', T0), presence('here', T0 + 6 * MIN), { kind: 'wake', cause: 'unlock', atMs: T0 + 6 * MIN + 500 }])
    expect(eventsOf(long, 'wake').map(e => [e.text, e.atMs])).toEqual([['unlocked the computer', T0 + 6 * MIN + 500]])
  })

  it('creates the wake topic only once the away span reaches the returned threshold', () => {
    const away = run([presence('here', T0 - MIN), presence('away', T0)])
    const wakesAt = (atMs: number) => eventsOf(reduceSituation(away, { kind: 'wake', cause: 'unlock', atMs }, atMs), 'wake')

    expect(wakesAt(T0 + RETURNED_AFTER_AWAY_MS - 1)).toHaveLength(0)
    expect(wakesAt(T0 + RETURNED_AFTER_AWAY_MS).map(e => [e.topicKey, e.text])).toEqual([['wake', 'unlocked the computer']])
  })

  it('keeps the stepped-away, wake and came-back topics for a 6 min absence', () => {
    const state = run([presence('here', T0 - MIN), presence('away', T0), { kind: 'wake', cause: 'unlock', atMs: T0 + 6 * MIN }, presence('here', T0 + 6 * MIN)])

    expect(state.events.map(e => [e.kind, e.topicKey, e.text, e.atMs])).toEqual([
      ['went-away', 'presence:away', 'stepped away', T0 + RETURNED_AFTER_AWAY_MS],
      ['wake', 'wake', 'unlocked the computer', T0 + 6 * MIN],
      ['returned', 'presence:return', 'came back after 6 min away', T0 + 6 * MIN],
    ])
    expect(state.presence).toEqual({ state: 'here', reason: null, sinceMs: T0 + 6 * MIN })
  })

  it('creates the stepped-away topic once the user has been away for the returned threshold, and only once', () => {
    const away = run([presence('here', T0 - MIN), presence('away', T0)])

    expect(eventsOf(advanceSituation(away, T0 + RETURNED_AFTER_AWAY_MS - 1), 'went-away')).toHaveLength(0)
    const settled = advanceSituation(away, T0 + RETURNED_AFTER_AWAY_MS)
    expect(eventsOf(settled, 'went-away').map(e => [e.topicKey, e.text, e.atMs])).toEqual([['presence:away', 'stepped away', T0 + RETURNED_AFTER_AWAY_MS]])

    // After the event decays out of the ring, the same away span does not create it again.
    const decayed = advanceSituation(settled, T0 + 60 * MIN)
    expect(eventsOf(decayed, 'went-away')).toHaveLength(0)
    expect(eventsOf(advanceSituation(decayed, T0 + 61 * MIN), 'went-away')).toHaveLength(0)
  })

  it('counts the away time through an unknown sample', () => {
    const state = run([presence('away', T0), presence('unknown', T0 + MIN), presence('here', T0 + 20 * MIN)])

    expect(eventsOf(state, 'returned').map(e => e.text)).toEqual(['came back after 20 min away'])
  })

  it('emits a wake event when no away span was seen to measure', () => {
    const state = run([{ kind: 'wake', cause: 'unlock', atMs: T0 }])

    expect(eventsOf(state, 'wake').map(e => [e.topicKey, e.salience])).toEqual([['wake', 0.5]])
  })
})

describe('reduceSituation wake ordering', () => {
  const wake = (cause: 'unlock' | 'resume', atMs: number): Observation => ({ kind: 'wake', cause, atMs })

  it('ignores a wake older than the newest recorded wake', () => {
    const base = run([wake('unlock', T0 + 10 * SEC)])
    const state = reduceSituation(base, wake('resume', T0 + 2 * SEC), T0 + 11 * SEC)

    expect(eventsOf(state, 'wake').map(e => [e.id, e.text, e.atMs])).toEqual([[`wake@${T0 + 10 * SEC}`, 'unlocked the computer', T0 + 10 * SEC]])
  })

  it('lets a newer wake replace the older one and treats an equal timestamp as a repeat', () => {
    const newer = run([wake('unlock', T0), wake('resume', T0 + 5 * SEC)])
    expect(eventsOf(newer, 'wake').map(e => [e.text, e.atMs])).toEqual([['woke the computer from sleep', T0 + 5 * SEC]])

    const equal = reduceSituation(newer, wake('unlock', T0 + 5 * SEC), T0 + 6 * SEC)
    expect(eventsOf(equal, 'wake').map(e => [e.text, e.atMs])).toEqual([['woke the computer from sleep', T0 + 5 * SEC]])
  })
})

describe('reduceSituation conversation, context, notify, stage, busy', () => {
  it('updates lastUserAtMs only for user turns with origin user', () => {
    const state = run([
      { kind: 'conversation', who: 'user', origin: 'unprompted', atMs: T0 },
      { kind: 'conversation', who: 'character', origin: 'user', atMs: T0 + SEC },
    ])
    expect(state.conversation).toEqual({ lastUserAtMs: null, lastCharacterAtMs: T0 + SEC, lastUnpromptedAtMs: null, lastUnpromptedTopic: null })

    const next = run([
      { kind: 'conversation', who: 'user', origin: 'user', atMs: T0 + 2 * SEC },
      { kind: 'conversation', who: 'character', origin: 'unprompted', atMs: T0 + 3 * SEC },
    ], state)
    expect(next.conversation).toEqual({ lastUserAtMs: T0 + 2 * SEC, lastCharacterAtMs: T0 + 3 * SEC, lastUnpromptedAtMs: T0 + 3 * SEC, lastUnpromptedTopic: null })
  })

  it('emits a context event only when the text changed, with default and vision salience', () => {
    let state = run([context('game', 'in a dungeon', T0), context('vision', 'a cat', T0)])
    expect(eventsOf(state, 'context').map(e => [e.topicKey, e.salience])).toEqual([['context:game', 0.3], ['context:vision', 0.4]])

    state = run([context('game', 'in a dungeon', T0 + MIN)], state)
    expect(state.contexts.game).toEqual({ text: 'in a dungeon', atMs: T0 + MIN })
    expect(eventsOf(state, 'context').find(e => e.topicKey === 'context:game')?.atMs).toBe(T0)

    state = run([context('game', 'at a boss', T0 + 2 * MIN, { salience: 0.9 })], state)
    const game = eventsOf(state, 'context').filter(e => e.topicKey === 'context:game')
    expect(game.map(e => [e.text, e.salience])).toEqual([['at a boss', 0.9]])
  })

  it('maps notify urgency and critical reminders to salience', () => {
    const state = run([
      notify({ eventId: 'a', urgency: 'immediate' }),
      notify({ eventId: 'b', urgency: 'soon' }),
      notify({ eventId: 'c', urgency: 'later' }),
      notify({ eventId: 'd', urgency: 'later', reminder: true, critical: true, note: 'now' }),
    ])

    expect(state.events.map(e => [e.topicKey, e.salience, e.text])).toEqual([
      ['notify:plugin:widget:a', 1.0, 'Tea is ready'],
      ['notify:plugin:widget:b', 0.7, 'Tea is ready'],
      ['notify:plugin:widget:c', 0.4, 'Tea is ready'],
      ['notify:plugin:widget:d', 1.0, 'Tea is ready: now'],
    ])
  })

  it('deduplicates notify observations by topic key, even when re-enqueued later', () => {
    const first = notify({ reminder: true })
    const state = run([first, { ...first, atMs: T0 + 30 * SEC }, { ...first, atMs: T0 + 60 * SEC }])

    expect(eventsOf(state, 'notify')).toHaveLength(1)
    expect(eventsOf(state, 'notify')[0].atMs).toBe(T0)
  })

  it('keys a widget-shaped notify by eventId, not by the widget id', () => {
    const widgetEvent = { ...notify({ sourceKey: 'plugin:widget', eventId: 'event-9' }), id: 'widget-1' }
    const state = run([widgetEvent])
    const topicKey = notifyTopicKey('plugin:widget', 'event-9')

    expect(eventsOf(state, 'notify').map(e => e.topicKey)).toEqual([topicKey])
    const addressed = markAddressed(state, topicKey, T0 + SEC)
    expect(eventsOf(addressed, 'notify')[0].addressedAtMs).toBe(T0 + SEC)
    expect(notifyTopicKey('plugin:widget', 'widget-1')).not.toBe(topicKey)
  })

  it('ignores a stage observation whose fields are not strings', () => {
    const base = run([{ kind: 'stage', exposed: 'a', active: 'b', mood: 'calm', atMs: T0 }])
    const bad: unknown[] = [
      { kind: 'stage', exposed: null, active: 'b', mood: 'calm', atMs: T0 + SEC },
      { kind: 'stage', exposed: 'a', active: undefined, mood: 'calm', atMs: T0 + SEC },
      { kind: 'stage', exposed: 'a', active: 'b', mood: { x: 1 }, atMs: T0 + SEC },
    ]

    for (const observation of bad) {
      const state = reduceSituation(base, observation as Observation, T0 + SEC)
      expect(state.stage).toEqual({ exposed: 'a', active: 'b', mood: 'calm', atMs: T0 })
    }
    expect(reduceSituation(initialSituationState, bad[0] as Observation, T0).stage).toBeNull()
  })

  it('replaces stage and busy without events', () => {
    const state = run([
      { kind: 'stage', exposed: 'a', active: 'b', mood: 'calm', atMs: T0 },
      { kind: 'busy', state: 'fullscreen', atMs: T0 },
    ])

    expect(state.stage).toEqual({ exposed: 'a', active: 'b', mood: 'calm', atMs: T0 })
    expect(state.busy).toEqual({ state: 'fullscreen', atMs: T0 })
    expect(state.events).toEqual([])
  })
})

describe('events: decay, ring and marks', () => {
  it('computes effective salience by half-life', () => {
    const event = { salience: 0.8, atMs: T0, halfLifeMs: 10 * MIN }

    expect(effectiveSalience(event, T0)).toBeCloseTo(0.8)
    expect(effectiveSalience(event, T0 + 10 * MIN)).toBeCloseTo(0.4)
    expect(effectiveSalience(event, T0 + 20 * MIN)).toBeCloseTo(0.2)
    expect(effectiveSalience(event, T0 - MIN)).toBeCloseTo(0.8)
  })

  it('drops events below 0.05 effective salience', () => {
    const base = run([context('game', 'x', T0)])

    expect(advanceSituation(base, T0 + 70 * MIN).events).toHaveLength(1)
    const later = advanceSituation(base, T0 + 80 * MIN)
    expect(later.events).toHaveLength(0)
    expect(later.contexts.game.text).toBe('x')
  })

  it('keeps only the 32 newest events', () => {
    const state = run(Array.from({ length: 40 }, (_, index) => context(`s${index}`, `t${index}`, T0 + index * SEC)))

    expect(state.events).toHaveLength(SITUATION_EVENTS_MAX)
    expect(state.events[0].topicKey).toBe('context:s8')
    expect(state.events.at(-1)?.topicKey).toBe('context:s39')
  })

  it('marks shown and addressed once, keeping the first time', () => {
    const base = run([context('game', 'x', T0)])
    const id = base.events[0].id
    const shown = markShown(markShown(base, [id, 'missing'], T0 + SEC), [id], T0 + 2 * SEC)
    const addressed = markAddressed(markAddressed(shown, 'context:game', T0 + 3 * SEC), 'context:game', T0 + 4 * SEC)

    expect(addressed.events[0]).toMatchObject({ shownAtMs: T0 + SEC, addressedAtMs: T0 + 3 * SEC })
    expect(base.events[0]).toMatchObject({ shownAtMs: null, addressedAtMs: null })
  })
})

describe('purity and time', () => {
  it('never lets time go backwards and ignores stale observations', () => {
    const base = run([presence('here', T0 + 10 * SEC), context('game', 'new', T0 + 10 * SEC)])
    const state = reduceSituation(base, presence('away', T0 + 5 * SEC), T0 + 5 * SEC)

    expect(state.nowMs).toBe(T0 + 10 * SEC)
    expect(state.presence.state).toBe('here')
    expect(eventsOf(state, 'went-away')).toHaveLength(0)

    const staleContext = reduceSituation(state, context('game', 'old', T0 + SEC), T0 + SEC)
    expect(staleContext.contexts.game.text).toBe('new')
    expect(staleContext.nowMs).toBe(T0 + 10 * SEC)
    expect(staleContext.events.map(e => e.id)).toEqual(base.events.map(e => e.id))
  })

  it('does not duplicate events for a repeated observation', () => {
    const wake: Observation = { kind: 'wake', cause: 'resume', atMs: T0 }
    const once = run([wake])
    const twice = run([wake, wake])

    expect(twice.events).toEqual(once.events)
    const shown = markShown(once, [once.events[0].id], T0 + SEC)
    expect(reduceSituation(shown, wake, T0 + 2 * SEC).events[0].shownAtMs).toBe(T0 + SEC)
  })

  it('ignores malformed observations', () => {
    const base = run([activity('a', T0)])
    const unknownKind: unknown = { kind: 'teleport', atMs: T0 + SEC }
    const bad = [
      activity('b', Number.NaN),
      activity('b', -5),
      activity('b', Number.POSITIVE_INFINITY),
      activity('', T0 + SEC),
      activity('   ', T0 + SEC),
      activity('b', T0 + SEC, { category: 'weird' as never }),
      unknownKind as Observation,
      notify({ eventId: '' }),
      notify({ urgency: 'now' as never }),
      context('', 'x', T0 + SEC),
      presence('sleeping' as never, T0 + SEC),
    ]

    for (const observation of bad) {
      const state = reduceSituation(base, observation, T0 + SEC)
      expect(state.activity?.appId).toBe('a')
      expect(state.events).toEqual([])
      expect(state.presence).toEqual(base.presence)
    }
    expect(reduceSituation(base, activity('b', T0 + SEC), Number.NaN)).toBe(base)
    expect(reduceSituation(base, activity('b', T0 + SEC), -1)).toBe(base)
    expect(advanceSituation(base, Number.NaN)).toBe(base)
  })

  it('clamps an observation from the future to now', () => {
    const state = reduceSituation(initialSituationState, activity('a', T0 + 10 * MIN), T0)

    expect(state.activity?.sinceMs).toBe(T0)
    expect(state.nowMs).toBe(T0)
  })

  it('is pure: identical inputs give deep-equal outputs and inputs stay untouched', () => {
    const base = run([activity('z', T0 - MIN), activity('a', T0), context('game', 'x', T0)])
    const snapshot = JSON.stringify(base)
    const observation = activity('b', T0 + 2 * MIN)

    const first = reduceSituation(base, observation, T0 + 2 * MIN)
    const second = reduceSituation(base, observation, T0 + 2 * MIN)

    expect(first).toEqual(second)
    expect(JSON.stringify(base)).toBe(snapshot)
    expect(first).not.toBe(base)
    expect(JSON.stringify(initialSituationState)).toBe(JSON.stringify(run([])))
  })

  it('reduces and advances from the deeply frozen initial state in strict mode without mutating it', () => {
    const snapshot = structuredClone(initialSituationState)

    // ES modules are strict, so writing to a frozen object here would throw a TypeError.
    expect(() => {
      let state = reduceSituation(initialSituationState, activity('a', T0), T0)
      state = reduceSituation(state, activity('b', T0 + MIN), T0 + MIN)
      state = reduceSituation(state, presence('away', T0 + 2 * MIN), T0 + 2 * MIN)
      state = reduceSituation(state, context('game', 'x', T0 + 2 * MIN), T0 + 2 * MIN)
      state = reduceSituation(state, { kind: 'conversation', who: 'character', origin: 'unprompted', atMs: T0 + 3 * MIN }, T0 + 3 * MIN)
      state = advanceSituation(state, T0 + 40 * MIN)
      state = markShown(state, state.events.map(e => e.id), T0 + 41 * MIN)
      markAddressed(state, 'context:game', T0 + 42 * MIN)
    }).not.toThrow()

    expect(initialSituationState).toEqual(snapshot)
  })
})

describe('markAddressed', () => {
  it('names a topic as her last remark only once her unprompted turn about it is spoken', () => {
    const spoken = (atMs: number): Observation => ({ kind: 'conversation', who: 'character', origin: 'unprompted', atMs })
    const state = run([context('game', 'in a dungeon', T0)])

    const addressed = markAddressed(state, 'context:game', T0 + MIN)
    expect(addressed.conversation.lastUnpromptedTopic).toBeNull()
    const first = reduceSituation(addressed, spoken(T0 + MIN + SEC), T0 + MIN + SEC)
    expect(first.conversation).toMatchObject({ lastUnpromptedAtMs: T0 + MIN + SEC, lastUnpromptedTopic: 'in a dungeon' })

    // The next fire addresses its topic before its prompt is rendered: the prompt still names the earlier remark.
    const second = markAddressed(run([context('vision', 'a cat', T0 + 10 * MIN)], first), 'context:vision', T0 + 10 * MIN)
    expect(second.conversation).toMatchObject({ lastUnpromptedAtMs: T0 + MIN + SEC, lastUnpromptedTopic: 'in a dungeon' })
    // A reply to the user is not her unprompted remark.
    const replied = reduceSituation(second, { kind: 'conversation', who: 'character', origin: 'user', atMs: T0 + 10 * MIN + SEC }, T0 + 10 * MIN + SEC)
    expect(replied.conversation.lastUnpromptedTopic).toBe('in a dungeon')
    expect(reduceSituation(replied, spoken(T0 + 11 * MIN), T0 + 11 * MIN).conversation.lastUnpromptedTopic).toBe('a cat')
    expect(state.conversation.lastUnpromptedTopic).toBeNull()
  })

  it('names no topic for a spoken unprompted turn whose topic matched no event', () => {
    const spoken: Observation = { kind: 'conversation', who: 'character', origin: 'unprompted', atMs: T0 + 2 * MIN }
    const first = reduceSituation(markAddressed(run([context('game', 'in a dungeon', T0)]), 'context:game', T0 + MIN), { ...spoken, atMs: T0 + MIN }, T0 + MIN)
    expect(first.conversation.lastUnpromptedTopic).toBe('in a dungeon')

    const unmatched = reduceSituation(markAddressed(first, 'context:nope', T0 + 2 * MIN), spoken, T0 + 2 * MIN)
    expect(unmatched.conversation).toMatchObject({ lastUnpromptedAtMs: T0 + 2 * MIN, lastUnpromptedTopic: null })
  })

  it('keeps addressed events in the ring until their salience drops below 0.05', () => {
    const state = markAddressed(run([context('game', 'in a dungeon', T0)]), 'context:game', T0 + MIN)

    const early = advanceSituation(state, T0 + 70 * MIN)
    expect(effectiveSalience(early.events[0], T0 + 70 * MIN)).toBeGreaterThanOrEqual(0.05)
    expect(early.events.map(e => [e.topicKey, e.addressedAtMs])).toEqual([['context:game', T0 + MIN]])

    expect(advanceSituation(state, T0 + 80 * MIN).events).toEqual([])
  })

  it('keeps addressed events until 32 newer events evict them', () => {
    let state = markAddressed(run([context('game', 'in a dungeon', T0)]), 'context:game', T0 + SEC)

    for (let index = 0; index < SITUATION_EVENTS_MAX - 1; index += 1)
      state = run([context(`s${index}`, `t${index}`, T0 + (index + 1) * SEC)], state)
    expect(state.events).toHaveLength(SITUATION_EVENTS_MAX)
    expect(state.events.some(e => e.topicKey === 'context:game' && e.addressedAtMs !== null)).toBe(true)

    state = run([context('last', 'newest', T0 + 40 * SEC)], state)
    expect(state.events).toHaveLength(SITUATION_EVENTS_MAX)
    expect(state.events.some(e => e.topicKey === 'context:game')).toBe(false)
  })
})

describe('forgetForeground', () => {
  it('drops the apps, their topics and the busy state, and keeps everything else', () => {
    const state = run([
      presence('here', T0),
      activity('z', T0, { title: 'draft.txt' }),
      activity('a', T0 + MIN, { title: 'secret plans', category: 'game' }),
      { kind: 'busy', state: 'fullscreen', atMs: T0 + MIN },
      context('vision', 'A cat on the desk', T0 + MIN),
      notify({ atMs: T0 + MIN }),
    ])
    const settled = advanceSituation(state, T0 + 3 * MIN)
    expect(eventsOf(settled, 'app-switch')).toHaveLength(1)

    const forgotten = forgetForeground(settled)

    expect(forgotten.activity).toBeNull()
    expect(forgotten.recentActivities).toEqual([])
    expect(forgotten.busy).toEqual(initialSituationState.busy)
    expect(forgotten.events.map(event => event.kind).sort()).toEqual(['context', 'notify'])
    expect(forgotten.presence).toEqual(settled.presence)
    expect(forgotten.contexts).toEqual(settled.contexts)
    expect(JSON.stringify(forgotten)).not.toMatch(/secret|draft/u)
    // A later app starts a new session instead of continuing the forgotten one.
    const next = reduceSituation(forgotten, activity('b', T0 + 4 * MIN), T0 + 4 * MIN)
    expect(next.activity).toMatchObject({ appId: 'b', sinceMs: T0 + 4 * MIN })
    expect(next.recentActivities).toEqual([])
  })
})

describe('forgetSource', () => {
  const extension = 'proj-airi:plugin-web-extension'
  const spoken = (atMs: number): Observation => ({ kind: 'conversation', who: 'character', origin: 'unprompted', atMs })

  function shared(): SituationState {
    return run([
      presence('here', T0),
      context(`${extension}:module-a`, 'User is browsing: Secret page (https://example.test/secret?token=1).', T0),
      context('vision', 'A cat on the desk', T0),
      // Another extension whose id only starts with the same characters is a different source.
      context(`${extension}-fork:module`, 'Fork page', T0),
      notify({ sourceKey: `${extension}:module-b`, eventId: 'video-1', headline: 'User is watching: Secret video', atMs: T0 }),
      notify({ atMs: T0 }),
    ])
  }

  it('drops the contexts and events of every module of one source, and keeps everything else', () => {
    const state = shared()

    const forgotten = forgetSource(state, extension)

    expect(Object.keys(forgotten.contexts).sort()).toEqual([`${extension}-fork:module`, 'vision'])
    expect(forgotten.events.map(event => event.topicKey).sort()).toEqual([
      `context:${extension}-fork:module`,
      'context:vision',
      notifyTopicKey('plugin:widget', 'evt-1'),
    ])
    expect(forgotten.presence).toEqual(state.presence)
    expect(JSON.stringify(forgotten)).not.toMatch(/secret/iu)
    expect(state.events).toHaveLength(5)
  })

  it('forgets her pending and last unprompted topic when it came from the source', () => {
    const remarked = reduceSituation(markAddressed(shared(), notifyTopicKey(`${extension}:module-b`, 'video-1'), T0 + MIN), spoken(T0 + MIN), T0 + MIN)
    expect(remarked.conversation.lastUnpromptedTopic).toBe('User is watching: Secret video')
    const pending = markAddressed(remarked, `context:${extension}:module-a`, T0 + 2 * MIN)
    expect(pending.tracking.addressedTopic).toMatch(/Secret page/u)

    const forgotten = forgetSource(pending, extension)

    expect(forgotten.conversation).toEqual({ ...pending.conversation, lastUnpromptedTopic: null })
    expect(forgotten.tracking.addressedTopic).toBeNull()
    expect(JSON.stringify(forgotten)).not.toMatch(/secret/iu)
    // A topic from another source stays her last remark.
    const vision = reduceSituation(markAddressed(shared(), 'context:vision', T0 + MIN), spoken(T0 + MIN), T0 + MIN)
    expect(forgetSource(vision, extension).conversation.lastUnpromptedTopic).toBe('A cat on the desk')
  })
})
