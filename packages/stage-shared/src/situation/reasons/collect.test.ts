import type { SituationEvent, SituationState } from '../types'
import type { Reason, ReasonState, RitualDay, Thread, ThreadKind } from './types'

import { describe, expect, it } from 'vitest'

import { nextRandom, seedRng } from '../rng'
import { initialSituationState } from '../types'
import { collectReasons, pickCategory, pickReason } from './collect'
import { threadMinAgeMs } from './threads'
import { REASON_TEXT, THREAD_TUNING } from './types'

const T0 = 1_700_000_000_000
const MIN = 60_000
const HOUR = 60 * MIN

function worldEvent(overrides: Partial<SituationEvent> = {}): SituationEvent {
  return {
    id: `long-session:code@${T0}`,
    kind: 'long-session',
    topicKey: 'long-session:code',
    text: 'has been in VS Code for two hours',
    atMs: T0,
    salience: 0.6,
    halfLifeMs: 30 * MIN,
    tier: 2,
    origin: 'world',
    shownAtMs: null,
    addressedAtMs: null,
    ...overrides,
  }
}

function urgentNotify(): SituationEvent {
  return worldEvent({ id: `notify:timer@${T0}`, kind: 'notify', topicKey: 'notify:timer', text: 'the tea timer rang', salience: 1, tier: 0 })
}

function makeThread(kind: ThreadKind, overrides: Partial<Thread> = {}): Thread {
  return {
    id: `thread:${kind}:0:0`,
    topicKey: `thread:${kind}:0:0`,
    sessionId: 'chat-a',
    kind,
    summary: 'The interview',
    cue: 'ask how the interview went',
    bornAtMs: T0 - 2 * HOUR,
    dueAtMs: null,
    raisedCount: 0,
    lastRaisedAtMs: null,
    expiresAtMs: T0 + 24 * HOUR,
    ...overrides,
  }
}

/** When `thread` reaches its kind's peak salience. */
function peakAt(thread: Thread): number {
  const { riseMs, halfLifeMs } = THREAD_TUNING[thread.kind]
  return thread.bornAtMs + threadMinAgeMs(thread) + riseMs * Math.log1p(halfLifeMs / (riseMs * Math.LN2))
}

function ritualDay(overrides: Partial<RitualDay> = {}): RitualDay {
  return {
    dayKey: '2023-11-14',
    firstPresentAtMs: T0,
    lastAwayEndedAtMs: T0,
    states: { 'greeting': 'open', 'sign-off': 'open', 'welcome-back': 'open' },
    windowOpenedAtMs: { 'greeting': T0, 'sign-off': null, 'welcome-back': T0 },
    ...overrides,
  }
}

interface CollectOverrides {
  events?: readonly SituationEvent[]
  threads?: readonly Thread[]
  rituals?: RitualDay | null
  nowMs?: number
  sessionId?: string
  heldTopics?: ReadonlySet<string>
  lastOwnDayAtMs?: number | null
}

function collect(overrides: CollectOverrides = {}): readonly Reason[] {
  const situation: SituationState = { ...initialSituationState, events: overrides.events ?? [], nowMs: overrides.nowMs ?? T0 }
  const reasons: ReasonState = { threads: { threads: overrides.threads ?? [] }, rituals: overrides.rituals ?? null }
  return collectReasons({
    situation,
    reasons,
    nowMs: overrides.nowMs ?? T0,
    sessionId: overrides.sessionId ?? 'chat-a',
    heldTopics: overrides.heldTopics ?? new Set(),
    lastOwnDayAtMs: overrides.lastOwnDayAtMs === undefined ? null : overrides.lastOwnDayAtMs,
  })
}

function keys(reasons: readonly Reason[]): string[] {
  return reasons.map(reason => reason.key)
}

function reasonOf(overrides: Partial<Reason>): Reason {
  return {
    key: 'own-day',
    kind: 'own-day',
    category: 'open',
    text: 'something',
    sourceEventId: null,
    ripeness: 1,
    weight: 1,
    urgent: false,
    dueAtMs: null,
    dueNow: false,
    ...overrides,
  }
}

describe('collectReasons', () => {
  it('drops a held urgent notify until the topic is released', () => {
    const events = [urgentNotify()]
    expect(collect({ events, heldTopics: new Set(['notify:timer']) }).some(reason => reason.kind === 'notify')).toBe(false)

    const released = collect({ events }).find(reason => reason.kind === 'notify')
    expect(released).toMatchObject({ key: 'notify:timer', urgent: true, sourceEventId: `notify:timer@${T0}`, category: 'open' })
  })

  it('drops held thread, ritual, and own-day keys', () => {
    const thread = makeThread('question')
    const all = collect({ threads: [thread], rituals: ritualDay(), nowMs: peakAt(thread) })
    expect(keys(all)).toEqual(['own-day', 'ritual:greeting', 'ritual:welcome-back', thread.topicKey])

    const held = collect({
      threads: [thread],
      rituals: ritualDay(),
      nowMs: peakAt(thread),
      heldTopics: new Set(['own-day', 'ritual:greeting', thread.topicKey]),
    })
    expect(keys(held)).toEqual(['ritual:welcome-back'])
  })

  it.each(['app-switch', 'switching-burst', 'wake', 'went-away', 'context'] as const)('never offers a %s event, even at full salience', (kind) => {
    const reasons = collect({ events: [worldEvent({ id: `${kind}@${T0}`, kind, topicKey: `${kind}:x`, salience: 1, tier: 0 })] })
    expect(reasons.filter(reason => reason.sourceEventId !== null)).toEqual([])
  })

  it('skips self-origin, addressed, and textless events', () => {
    const reasons = collect({
      events: [
        worldEvent({ id: 'a', origin: 'self' }),
        worldEvent({ id: 'b', addressedAtMs: T0 }),
        worldEvent({ id: 'c', text: '  ' }),
      ],
    })
    expect(reasons.filter(reason => reason.sourceEventId !== null)).toEqual([])
  })

  it('offers a long-session from tier 2, unless it matured before the latest return', () => {
    expect(collect({ events: [worldEvent({ tier: 1 })] }).some(reason => reason.kind === 'long-session')).toBe(false)

    const tier2 = collect({ events: [worldEvent({ tier: 2 })] }).find(reason => reason.kind === 'long-session')
    expect(tier2).toMatchObject({ key: 'long-session:code', ripeness: 1, urgent: false })
    expect(tier2?.weight).toBeCloseTo(0.15, 9)

    const returned = worldEvent({ id: `returned@${T0}`, kind: 'returned', topicKey: 'returned', text: 'is back', atMs: T0 - 5 * MIN, tier: 0 })
    const stale = collect({ events: [worldEvent({ atMs: T0 - 10 * MIN }), returned] })
    expect(stale.some(reason => reason.kind === 'long-session')).toBe(false)
  })

  it('offers a returned event once it is at least 3 minutes old, scaled by decayed ripeness', () => {
    const returned = worldEvent({ id: `returned@${T0}`, kind: 'returned', topicKey: 'returned', text: 'is back', tier: 0, halfLifeMs: 15 * MIN })
    expect(collect({ events: [returned], nowMs: T0 + 3 * MIN - 1 }).some(reason => reason.kind === 'returned')).toBe(false)

    const settled = collect({ events: [returned], nowMs: T0 + 15 * MIN }).find(reason => reason.kind === 'returned')
    expect(settled?.ripeness).toBeCloseTo(0.5, 9)
    expect(settled?.weight).toBeCloseTo(0.25 * 0.25, 9)
  })

  it('never offers a thread from another chat session', () => {
    const thread = makeThread('question', { sessionId: 'chat-b' })
    expect(collect({ threads: [thread], nowMs: peakAt(thread) }).some(reason => reason.key === thread.topicKey)).toBe(false)
    expect(collect({ threads: [thread], nowMs: peakAt(thread), sessionId: 'chat-b' }).some(reason => reason.key === thread.topicKey)).toBe(true)
  })

  it('turns an eligible thread into an open reason with its cue and ripeness-squared weight', () => {
    const thread = makeThread('question')
    const reason = collect({ threads: [thread], nowMs: peakAt(thread) }).find(item => item.key === thread.topicKey)
    expect(reason).toMatchObject({ kind: 'thread-question', category: 'open', text: thread.cue, sourceEventId: null, dueNow: false })
    expect(reason?.ripeness).toBeCloseTo(0.7, 6)
    expect(reason?.weight).toBeCloseTo(1.0 * 0.7 ** 2, 6)
  })

  it('flags a later thread as due only within the bump window after its due time', () => {
    const dueAtMs = T0 - 30 * MIN
    const later = makeThread('later', { id: 'thread:later:1:0', topicKey: 'thread:later:1:0', bornAtMs: T0 - 2 * HOUR, dueAtMs })
    const event = makeThread('event', { id: 'thread:event:1:0', topicKey: 'thread:event:1:0', bornAtMs: T0 - 2 * HOUR, dueAtMs: T0 - 90 * MIN })
    const reasons = collect({ threads: [later, event] })
    expect(reasons.find(reason => reason.key === later.topicKey)).toMatchObject({ dueAtMs, dueNow: true })
    expect(reasons.find(reason => reason.key === event.topicKey)).toMatchObject({ dueNow: false })

    const past = collect({ threads: [later], nowMs: dueAtMs + 2 * HOUR + 1 }).find(reason => reason.key === later.topicKey)
    expect(past?.dueNow).toBe(false)
  })

  it('recovers the own-day weight over its half-life', () => {
    const ownDay = (lastOwnDayAtMs: number | null) => collect({ lastOwnDayAtMs }).find(reason => reason.key === 'own-day')
    expect(ownDay(null)).toMatchObject({ kind: 'own-day', ripeness: 0.35, weight: 0.2 })
    expect(ownDay(T0)?.weight).toBe(0)
    expect(ownDay(T0 - 90 * MIN)?.weight).toBeCloseTo(0.1, 9)
    expect(ownDay(T0 + HOUR)?.weight).toBe(0)
  })

  it('offers every open ritual window at its hourly rate, so overlapping windows both compete', () => {
    // After an overnight absence of 3 h or more, the first morning presence
    // opens greeting and welcome-back together; both are offered and the
    // weighted pick decides between them.
    const reasons = collect({ rituals: ritualDay() }).filter(reason => reason.category === 'ritual')
    expect(reasons.map(reason => [reason.key, reason.kind, reason.weight])).toEqual([
      ['ritual:greeting', 'ritual-greeting', 12],
      ['ritual:welcome-back', 'ritual-welcome-back', 6],
    ])
    expect(reasons[0].text).toBe(REASON_TEXT['ritual-greeting'])

    const closed = collect({ rituals: ritualDay({ states: { 'greeting': 'done', 'sign-off': 'open', 'welcome-back': 'expired' } }) })
    expect(closed.some(reason => reason.category === 'ritual')).toBe(false)
  })

  it('returns reasons sorted by key', () => {
    const thread = makeThread('topic')
    const reasons = collect({ events: [urgentNotify(), worldEvent()], threads: [thread], rituals: ritualDay(), nowMs: peakAt(thread) })
    const sorted = [...keys(reasons)].sort()
    expect(keys(reasons)).toEqual(sorted)
  })
})

describe('pickReason', () => {
  it('picks a thread at peak ripeness in at least 70% of seeded rolls against own-day and a tier-2 long-session', () => {
    // An event thread at peak (weight 1.2 * 0.85^2 = 0.867) against a fully
    // recovered own-day (never raised, weight 0.2) and a fresh tier-2
    // long-session (0.15): expected share 0.867 / 1.217, about 71%.
    const thread = makeThread('event')
    const nowMs = peakAt(thread)
    const reasons = collect({ events: [worldEvent({ atMs: nowMs })], threads: [thread], nowMs, lastOwnDayAtMs: null })
    expect(keys(reasons)).toEqual(['long-session:code', 'own-day', thread.topicKey])

    let state = seedRng(20261029)
    let threadPicks = 0
    for (let i = 0; i < 1000; i++) {
      const [roll, next] = nextRandom(state)
      state = next
      if (pickReason(reasons, 'open', roll)?.key === thread.topicKey)
        threadPicks++
    }
    expect(threadPicks).toBeGreaterThanOrEqual(700)
  })

  it('returns the last positive-weight open candidate for a roll near 1', () => {
    const reasons = [
      reasonOf({ key: 'a', weight: 0.2 }),
      reasonOf({ key: 'b', weight: 0.3 }),
      reasonOf({ key: 'c', weight: 0 }),
      reasonOf({ key: 'd', category: 'ritual', weight: 12 }),
    ]
    expect(pickReason(reasons, 'open', 0.999)?.key).toBe('b')
    expect(pickReason(reasons, 'open', 0)?.key).toBe('a')
  })

  it('picks greeting over welcome-back for rolls below 2/3', () => {
    const reasons = collect({ rituals: ritualDay() })
    expect(pickReason(reasons, 'ritual', 0)?.key).toBe('ritual:greeting')
    expect(pickReason(reasons, 'ritual', 2 / 3 - 1e-9)?.key).toBe('ritual:greeting')
    expect(pickReason(reasons, 'ritual', 2 / 3 + 1e-9)?.key).toBe('ritual:welcome-back')
  })

  it('picks the earliest due reason without a roll', () => {
    const reasons = [
      reasonOf({ key: 'thread:later:2', kind: 'thread-later', dueAtMs: T0 - 10 * MIN, dueNow: true }),
      reasonOf({ key: 'thread:later:1', kind: 'thread-later', dueAtMs: T0 - 40 * MIN, dueNow: true }),
      reasonOf({ key: 'thread:event:1', kind: 'thread-event', dueAtMs: T0 - 90 * MIN, dueNow: false }),
    ]
    expect(pickReason(reasons, 'due', 0.5)?.key).toBe('thread:later:1')
  })

  it('returns null when nothing qualifies', () => {
    expect(pickReason([reasonOf({ weight: 0 })], 'open', 0.5)).toBeNull()
    expect(pickReason([reasonOf({})], 'ritual', 0.5)).toBeNull()
    expect(pickReason([reasonOf({})], 'due', 0.5)).toBeNull()
  })
})

describe('pickCategory', () => {
  it('picks cumulatively in open, continuation, ritual, due order', () => {
    const hazards = { open: 1, continuation: 0, ritual: 2, due: 1 }
    expect(pickCategory(hazards, 0)).toBe('open')
    expect(pickCategory(hazards, 0.249)).toBe('open')
    expect(pickCategory(hazards, 0.25)).toBe('ritual')
    expect(pickCategory(hazards, 0.749)).toBe('ritual')
    expect(pickCategory(hazards, 0.75)).toBe('due')
    expect(pickCategory(hazards, 0.999999)).toBe('due')
    expect(pickCategory({ open: 0, continuation: 1, ritual: 0, due: 0 }, 0.5)).toBe('continuation')
  })
})
