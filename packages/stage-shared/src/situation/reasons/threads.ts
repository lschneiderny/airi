import type { Thread, ThreadKind, ThreadState } from './types'

import { THREAD_MIN_RIPENESS, THREAD_TUNING, THREADS_MAX } from './types'

export interface ThreadDraft {
  readonly kind: ThreadKind
  readonly summary: string
  readonly cue: string
  readonly dueInMinutes?: number
}

/** Age at which ripening starts, relative to the thread's birth, not an absolute timestamp. */
export function threadMinAgeMs(thread: Thread): number {
  const minAge = THREAD_TUNING[thread.kind].minAgeMs
  if (typeof minAge === 'number')
    return minAge
  return thread.dueAtMs === null
    ? minAge.defaultMs
    : thread.dueAtMs + minAge.dueAtMsOffsetMs - thread.bornAtMs
}

/** Delayed rise followed by decay, normalized so the peak equals the kind's salience. */
export function threadRipeness(thread: Thread, nowMs: number): number {
  const x = nowMs - thread.bornAtMs - threadMinAgeMs(thread)
  if (x <= 0)
    return 0
  const { salience, riseMs, halfLifeMs } = THREAD_TUNING[thread.kind]
  const peakAt = riseMs * Math.log1p(halfLifeMs / (riseMs * Math.LN2))
  const peak = (1 - Math.exp(-peakAt / riseMs)) * 2 ** (-peakAt / halfLifeMs)
  return salience * (1 - Math.exp(-x / riseMs)) * 2 ** (-x / halfLifeMs) / peak
}

/** Drafts are validated by the extraction boundary; duplicate summaries are scoped to their chat session. */
export function addThreads(
  state: ThreadState,
  drafts: readonly ThreadDraft[],
  sessionId: string,
  nowMs: number,
  { dayEndsAtMs }: { dayEndsAtMs: number },
): ThreadState {
  const normalize = (summary: string) => summary.trim().replace(/\s+/g, ' ').toLowerCase()
  const summaries = new Set(state.threads.filter(thread => thread.sessionId === sessionId).map(thread => normalize(thread.summary)))
  const threads = [...state.threads]
  drafts.forEach((draft, index) => {
    const summary = normalize(draft.summary)
    if (summaries.has(summary))
      return
    summaries.add(summary)
    const id = `thread:${draft.kind}:${nowMs}:${index}` as const
    const thread: Thread = {
      id,
      topicKey: id,
      sessionId,
      kind: draft.kind,
      summary: draft.summary,
      cue: draft.cue,
      bornAtMs: nowMs,
      dueAtMs: (draft.kind === 'later' || draft.kind === 'event') && draft.dueInMinutes !== undefined
        ? nowMs + draft.dueInMinutes * 60_000
        : null,
      raisedCount: 0,
      lastRaisedAtMs: null,
      expiresAtMs: dayEndsAtMs,
    }
    threads.push({
      ...thread,
      expiresAtMs: Math.min(dayEndsAtMs, nowMs + threadMinAgeMs(thread) + 2 * THREAD_TUNING[thread.kind].halfLifeMs),
    })
  })
  // Stable ties retain the earlier thread rather than churning equally unripe drafts.
  if (threads.length > THREADS_MAX)
    threads.sort((a, b) => threadRipeness(b, nowMs) - threadRipeness(a, nowMs))
  return { threads: threads.slice(0, THREADS_MAX) }
}

/** Only spoken turns raise a thread; callers leave declined, cancelled, and failed turns untouched. */
export function raiseThread(state: ThreadState, id: string, nowMs: number): ThreadState {
  return {
    threads: state.threads.map(thread => thread.id === id
      ? { ...thread, raisedCount: thread.raisedCount + 1, lastRaisedAtMs: nowMs }
      : thread),
  }
}

export function closeThread(state: ThreadState, id: string): ThreadState {
  return { threads: state.threads.filter(thread => thread.id !== id) }
}

export function pruneThreads(state: ThreadState, nowMs: number): ThreadState {
  return { threads: state.threads.filter(thread => thread.expiresAtMs > nowMs && thread.raisedCount < 1) }
}

export function eligibleThreads(
  state: ThreadState,
  nowMs: number,
  { sessionId, heldTopics }: { sessionId: string, heldTopics: ReadonlySet<string> },
): readonly Thread[] {
  return state.threads.filter(thread =>
    thread.sessionId === sessionId
    && thread.raisedCount === 0
    && thread.expiresAtMs > nowMs
    && !heldTopics.has(thread.topicKey)
    && threadRipeness(thread, nowMs) >= THREAD_MIN_RIPENESS,
  )
}
