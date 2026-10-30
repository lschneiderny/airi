import type { Thread, ThreadKind } from './types'

import { describe, expect, it } from 'vitest'

import { addThreads, closeThread, eligibleThreads, pruneThreads, raiseThread, threadMinAgeMs, threadRipeness } from './threads'
import { THREAD_TUNING, THREADS_MAX } from './types'

const MINUTE_MS = 60_000
const DAY_END = 48 * 60 * MINUTE_MS

function makeThread(kind: ThreadKind, overrides: Partial<Thread> = {}): Thread {
  return {
    id: `thread:${kind}:0:0`,
    topicKey: `thread:${kind}:0:0`,
    sessionId: 'chat-a',
    kind,
    summary: 'The interview',
    cue: 'Ask how it went',
    bornAtMs: 0,
    dueAtMs: null,
    raisedCount: 0,
    lastRaisedAtMs: null,
    expiresAtMs: DAY_END,
    ...overrides,
  }
}

function peakTime(thread: Thread): number {
  const { riseMs, halfLifeMs } = THREAD_TUNING[thread.kind]
  return thread.bornAtMs + threadMinAgeMs(thread) + riseMs * Math.log(1 + halfLifeMs / (riseMs * Math.LN2))
}

describe('open conversation threads', () => {
  it.each(['question', 'event', 'later', 'topic'] as const)('delays, normalizes, and decays %s ripeness', (kind) => {
    const thread = makeThread(kind, { bornAtMs: 1000 })
    const startsAt = thread.bornAtMs + threadMinAgeMs(thread)
    expect(threadRipeness(thread, startsAt - 1)).toBe(0)
    expect(threadRipeness(thread, startsAt)).toBe(0)
    const peakAt = peakTime(thread)
    expect(threadRipeness(thread, peakAt)).toBeCloseTo(THREAD_TUNING[kind].salience, 6)
    expect(threadRipeness(thread, startsAt + MINUTE_MS)).toBeGreaterThan(0)
    let previous = threadRipeness(thread, peakAt)
    for (let hours = 1; hours <= 24; hours++) {
      const next = threadRipeness(thread, peakAt + hours * 60 * MINUTE_MS)
      expect(next).toBeLessThan(previous)
      previous = next
    }
  })

  it('uses known due times for later and event threads and defaults when absent', () => {
    const later = makeThread('later', { bornAtMs: 10 * MINUTE_MS, dueAtMs: 50 * MINUTE_MS })
    const event = makeThread('event', { bornAtMs: 10 * MINUTE_MS, dueAtMs: 50 * MINUTE_MS })
    expect(threadMinAgeMs(later)).toBe(40 * MINUTE_MS)
    expect(threadMinAgeMs(event)).toBe(55 * MINUTE_MS)
    expect(threadRipeness(later, 50 * MINUTE_MS)).toBe(0)
    expect(threadRipeness(later, 51 * MINUTE_MS)).toBeGreaterThan(0)
    expect(threadRipeness(event, 64 * MINUTE_MS)).toBe(0)
    expect(threadRipeness(event, 66 * MINUTE_MS)).toBeGreaterThan(0)
    expect(threadMinAgeMs(makeThread('later'))).toBe(120 * MINUTE_MS)
    expect(threadMinAgeMs(makeThread('event'))).toBe(90 * MINUTE_MS)
  })

  it('assigns identities and due times and caps expiry at the supplied logical-day end', () => {
    const nowMs = 1000
    const state = addThreads({ threads: [] }, [
      { kind: 'later', summary: 'Later', cue: 'Follow up', dueInMinutes: 30 },
      { kind: 'event', summary: 'Event', cue: 'Ask', dueInMinutes: 60 },
      { kind: 'question', summary: 'Question', cue: 'Ask', dueInMinutes: 10 },
      { kind: 'topic', summary: 'Topic', cue: 'Ask' },
    ], 'chat-a', nowMs, { dayEndsAtMs: DAY_END })
    expect(state.threads.map(thread => [thread.id, thread.topicKey, thread.sessionId, thread.bornAtMs])).toEqual(
      ['later', 'event', 'question', 'topic'].map((kind, index) => [`thread:${kind}:1000:${index}`, `thread:${kind}:1000:${index}`, 'chat-a', nowMs]),
    )
    expect(state.threads.map(thread => thread.dueAtMs)).toEqual([nowMs + 30 * MINUTE_MS, nowMs + 60 * MINUTE_MS, null, null])
    for (const thread of state.threads)
      expect(thread.expiresAtMs).toBe(nowMs + threadMinAgeMs(thread) + 2 * THREAD_TUNING[thread.kind].halfLifeMs)
    const capped = addThreads({ threads: [] }, [{ kind: 'topic', summary: 'Topic', cue: 'Ask' }], 'chat-a', nowMs, { dayEndsAtMs: 2000 })
    expect(capped.threads[0].expiresAtMs).toBe(2000)
  })

  it('deduplicates normalized summaries within a session without mutating prior state', () => {
    const original = { threads: [makeThread('question')] }
    const drafts = [
      { kind: 'event', summary: '  THE \n interview ', cue: 'Again' },
      { kind: 'topic', summary: 'Different', cue: 'Ask' },
      { kind: 'later', summary: 'different', cue: 'Again' },
    ] as const
    const state = addThreads(original, drafts, 'chat-a', 1000, { dayEndsAtMs: DAY_END })
    expect(state.threads.map(thread => thread.summary)).toEqual(['The interview', 'Different'])
    expect(original.threads).toEqual([makeThread('question')])
    expect(addThreads(original, drafts.slice(0, 1), 'chat-b', 1000, { dayEndsAtMs: DAY_END }).threads).toHaveLength(2)
  })

  it('keeps exactly 24 of 30 drafts and drops the lowest-ripeness threads first', () => {
    const drafts = Array.from({ length: 30 }, (_, index) => ({ kind: 'question' as const, summary: `Question ${index}`, cue: 'Ask' }))
    const initial = addThreads({ threads: [] }, drafts, 'chat-a', 0, { dayEndsAtMs: DAY_END })
    expect(initial.threads).toHaveLength(THREADS_MAX)
    expect(initial.threads.map(thread => thread.summary)).toEqual(drafts.slice(0, 24).map(draft => draft.summary))
    const nowMs = peakTime(initial.threads[0])
    const decayed = makeThread('question', { id: 'thread:old', topicKey: 'thread:old', bornAtMs: -48 * 60 * MINUTE_MS })
    const filled = { threads: [...initial.threads.slice(0, 23), decayed] }
    const capped = addThreads(filled, drafts.map(draft => ({ ...draft, summary: `New ${draft.summary}` })), 'chat-a', nowMs, { dayEndsAtMs: DAY_END })
    expect(capped.threads).toHaveLength(24)
    expect(capped.threads.map(thread => thread.id)).toEqual(filled.threads.map(thread => thread.id))
    expect(threadRipeness(decayed, nowMs)).toBeGreaterThan(0)
    expect(capped.threads.every(thread => threadRipeness(thread, nowMs) > 0)).toBe(true)
  })

  it.each(['question', 'event', 'later', 'topic'] as const)('raises %s only on speech and prunes it permanently from eligibility', (kind) => {
    const thread = makeThread(kind)
    const state = { threads: [thread] }
    const nowMs = peakTime(thread)
    const options = { sessionId: 'chat-a', heldTopics: new Set<string>() }
    expect(eligibleThreads(state, nowMs, options)).toEqual([thread])
    // Declines, cancellation, and failures do not call raiseThread, so the same state remains eligible.
    expect(eligibleThreads(state, nowMs + 1, options)).toEqual([thread])
    const raised = raiseThread(state, thread.id, nowMs)
    expect(raised.threads[0]).toMatchObject({ raisedCount: 1, lastRaisedAtMs: nowMs })
    expect(thread.raisedCount).toBe(0)
    expect(eligibleThreads(raised, nowMs, options)).toEqual([])
    expect(pruneThreads(raised, nowMs).threads).toEqual([])
    expect(raiseThread(raised, thread.id, nowMs + 1).threads[0].raisedCount).toBe(2)
  })

  it('filters session, held, immature, and expired threads and supports closing and expiry pruning', () => {
    const thread = makeThread('question')
    const nowMs = peakTime(thread)
    const others = [
      makeThread('event', { id: 'thread:other', topicKey: 'thread:other', sessionId: 'chat-b' }),
      makeThread('question', { id: 'thread:held', topicKey: 'thread:held' }),
      makeThread('question', { id: 'thread:new', topicKey: 'thread:new', bornAtMs: nowMs }),
      makeThread('question', { id: 'thread:expired', topicKey: 'thread:expired', expiresAtMs: nowMs }),
    ]
    const state = { threads: [thread, ...others] }
    const options = { sessionId: 'chat-a', heldTopics: new Set(['thread:held']) }
    expect(eligibleThreads(state, nowMs, options)).toEqual([thread])
    expect(pruneThreads(state, nowMs).threads.map(item => item.id)).not.toContain('thread:expired')
    expect(closeThread(state, thread.id).threads).toEqual(others)
    expect(closeThread(state, 'missing')).toEqual(state)
    expect(raiseThread(state, 'missing', nowMs)).toEqual(state)
  })
})
